// Deterministic stub of the Easy Sandbox cloud: platform REST API + envd (Connect) data plane, on ONE
// plain-HTTP port. Sandbox/template responses carry `envdUrl` pointing back at this server, which both
// the Python oracle and the Node port honour. Every request is recorded so wire traffic can be diffed.
import http from 'node:http';
import { createHash } from 'node:crypto';

export const DEFAULT_WORLD = () => ({
  sandboxes: {
    'sbx-ev-001': { sandboxID: 'sbx-ev-001', templateID: 'base', state: 'running', cpuCount: 2, memoryMB: 2048, startedAt: '2026-01-02T03:04:05Z', endAt: '2026-01-02T03:09:05Z', envdVersion: '0.5.2', metadata: {} },
    'sbx-ev-002': { sandboxID: 'sbx-ev-002', templateID: 'python-hello', state: 'paused', cpuCount: 2, memoryMB: 2048, startedAt: '2026-01-02T03:05:05Z', endAt: '2026-01-02T03:10:05Z', envdVersion: '0.5.2', metadata: { project: 'demo' } },
  },
  templates: [
    { templateID: 'tmpl-001', aliases: ['python-base'], names: ['python-base'], cpuCount: 2, memoryMB: 2048, public: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', builds: [{ buildID: 'b-1', status: 'ready' }] },
    { templateID: 'tmpl-002', aliases: ['node-web'], names: ['node-web'], cpuCount: 1, memoryMB: 1024, public: true, createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', builds: [{ buildID: 'b-2', status: 'ready' }] },
  ],
  files: { '/app/result.csv': 'a,b\n1,2\n', '/home/user/hello.txt': 'hello\n' },
  dirs: { '/home/user': [{ name: 'hello.txt', type: 'file', size: 6 }, { name: 'src', type: 'directory', size: 4096 }], '/app': [{ name: 'result.csv', type: 'file', size: 8 }] },
  faults: {},
  nextSandboxId: 'sbx-new-001',
  hangProcessStart: false,
});

function frame(obj, flags = 0) {
  const body = Buffer.from(JSON.stringify(obj));
  const head = Buffer.alloc(5);
  head[0] = flags;
  head.writeUInt32BE(body.length, 1);
  return Buffer.concat([head, body]);
}

function unframe(buf) {
  if (buf.length >= 5 && (buf[0] === 0 || buf[0] === 2)) {
    const len = buf.readUInt32BE(1);
    if (buf.length >= 5 + len) { try { return JSON.parse(buf.subarray(5, 5 + len).toString('utf8')); } catch { /* fallthrough */ } }
  }
  try { return JSON.parse(buf.toString('utf8')); } catch { return null; }
}

function parseMultipart(body, ct) {
  const boundary = /boundary=([^;]+)/.exec(ct)?.[1]?.replace(/^"|"$/g, '');
  if (!boundary) return { multipart: true };
  const text = body.toString('latin1');
  const parts = text.split(`--${boundary}`).filter((p) => p && !p.startsWith('--') && p.trim());
  return {
    multipart: parts.map((p) => {
      const [head, ...rest] = p.replace(/^\r\n/, '').split('\r\n\r\n');
      const content = rest.join('\r\n\r\n').replace(/\r\n$/, '');
      return { name: /name="([^"]*)"/.exec(head)?.[1] ?? null, bytes: Buffer.byteLength(content, 'latin1'), sha1: createHash('sha1').update(Buffer.from(content, 'latin1')).digest('hex').slice(0, 12) };
    }),
  };
}

const B64 = (s) => Buffer.from(s).toString('base64');

/** Canned command emulator: returns {stdout, stderr, exit} or null for "executable not found". */
function emulate(cmd, args, world) {
  const joined = [cmd, ...args].join(' ');
  let script = joined;
  if (/(^|\/)(ba)?sh$/.test(cmd)) {
    const i = args.indexOf('-c');
    if (i >= 0) script = args.slice(i + 1).join(' ');
  }
  if (script.includes(';') && !/[|`$&]{1}(?!>)/.test(script.replace(/>&2/g, ''))) {
    let stdout = ''; let stderr = ''; let exit = 0;
    for (const stmt of script.split(';').map((x) => x.trim()).filter(Boolean)) {
      let m = /^echo (.*?)( >&2)?$/.exec(stmt);
      if (m) { const text = `${m[1].replace(/^["']|["']$/g, '')}\n`; if (m[2]) stderr += text; else stdout += text; continue; }
      m = /^exit (\d+)$/.exec(stmt);
      if (m) { exit = Number(m[1]); break; }
      return null;
    }
    return { stdout, stderr, exit };
  }
  if (/^echo /.test(script) && !/[;&|`$]/.test(script)) return { stdout: `${script.slice(5).replace(/^["']|["']$/g, '')}\n`, stderr: '', exit: 0 };
  if (script === 'ls' || /^ls( |$)/.test(script)) return { stdout: 'a.txt\nb.txt\n', stderr: '', exit: 0 };
  if (script === 'pwd') return { stdout: '/home/user\n', stderr: '', exit: 0 };
  if (/^find /.test(script)) return { stdout: '/home/user\n/home/user/hello.txt\n', stderr: '', exit: 0 };
  if (/^(uname|env|ps|df|pip|cat \/proc|python3? -m pip|ss |netstat)/.test(script) || /^(set -e|#!)/.test(script) || script.includes('uname') || script.includes('/proc/')) {
    return { stdout: 'OS=Linux\nArch=x86_64\nHostname=stub-host\nCPU_Count=2\nPython=3.10.12\nDisk_Total_GB=9.81\nDisk_Free_GB=9.29\n', stderr: '', exit: 0 };
  }
  if (script.startsWith('printf') || script === 'true') return { stdout: '', stderr: '', exit: 0 };
  if (script === 'false') return { stdout: '', stderr: '', exit: 1 };
  if (/^sleep /.test(script)) return { stdout: '', stderr: '', exit: 0, hang: true };
  if (/exit (\d+)/.test(script)) return { stdout: '', stderr: '', exit: Number(/exit (\d+)/.exec(script)[1]) };
  return null;
}

export function startStub({ port = 0 } = {}) {
  let world = DEFAULT_WORLD();
  let log = [];
  const sockets = new Set();

  const json = (res, status, body, extra = {}) => {
    const b = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json', ...extra });
    res.end(b);
  };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', async () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://stub');
      const path = url.pathname;
      const ct = req.headers['content-type'] || '';
      const entry = { method: req.method, path, query: Object.fromEntries(url.searchParams), ct: ct.split(';')[0] };
      if (path.startsWith('/__')) return control(req, res, path, body);

      let parsed = null;
      if (/json/.test(ct)) parsed = unframe(body);
      else if (/multipart/.test(ct)) parsed = parseMultipart(body, ct);
      if (parsed) entry.body = parsed;
      log.push(entry);

      const fault = world.faults[`${req.method} ${path}`] ?? world.faults[`* ${path}`] ?? world.faults['*'];
      if (fault) return json(res, fault.status ?? 500, fault.body ?? { message: 'fault' }, fault.headers);

      try { await route(req, res, path, url, body, parsed); } catch (e) { json(res, 500, { code: 'unknown', message: `stub error: ${e.message}` }); }
    });
  });

  const origin = () => `http://127.0.0.1:${server.address().port}`;
  const withEnvd = (s) => ({ ...s, envdUrl: origin(), envdAccessToken: 'tok-stub', clientID: 'client-stub', status: undefined });

  function control(req, res, path, body) {
    if (path === '/__world') { world = { ...DEFAULT_WORLD(), ...JSON.parse(body.toString() || '{}') }; log = []; return json(res, 200, { ok: true }); }
    if (path === '/__log') return json(res, 200, log);
    return json(res, 404, {});
  }

  async function route(req, res, path, url, body, parsed) {
    const m = req.method;
    // ---------------- platform ----------------
    if (path === '/sandboxes' && m === 'GET') {
      const status = url.searchParams.get('status') ?? url.searchParams.get('state');
      const list = Object.values(world.sandboxes).filter((s) => !status || s.state === status).map(withEnvd);
      return json(res, 200, list);
    }
    if (path === '/v2/sandboxes' && m === 'GET') return json(res, 200, Object.values(world.sandboxes).map(withEnvd));
    if (path === '/sandboxes' && m === 'POST') {
      const id = world.nextSandboxId;
      const s = { sandboxID: id, templateID: parsed?.templateID ?? 'base', state: 'running', cpuCount: 2, memoryMB: 2048, startedAt: '2026-01-02T03:04:05Z', endAt: '2026-01-02T03:09:05Z', envdVersion: '0.5.2', metadata: parsed?.metadata ?? {}, envVars: parsed?.envVars };
      world.sandboxes[id] = s;
      return json(res, 201, withEnvd(s));
    }
    let mm = /^\/sandboxes\/([^/]+)$/.exec(path);
    if (mm) {
      const s = world.sandboxes[mm[1]];
      if (!s) return json(res, 404, { code: 404, message: `sandbox ${mm[1]} not found` });
      if (m === 'GET') return json(res, 200, withEnvd(s));
      if (m === 'DELETE') { delete world.sandboxes[mm[1]]; res.writeHead(204); return res.end(); }
    }
    mm = /^\/sandboxes\/([^/]+)\/(timeout|pause|resume|refreshes)$/.exec(path);
    if (mm) { res.writeHead(204); return res.end(); }
    if (path === '/templates' && m === 'GET') return json(res, 200, world.templates);
    mm = /^\/templates\/([^/]+)$/.exec(path);
    if (mm) {
      const t = world.templates.find((x) => x.templateID === mm[1] || x.aliases?.includes(mm[1]));
      if (!t) return json(res, 404, { code: 404, message: 'template not found' });
      if (m === 'GET') return json(res, 200, t);
      if (m === 'DELETE') { world.templates = world.templates.filter((x) => x !== t); res.writeHead(204); return res.end(); }
    }

    // ---------------- envd ----------------
    if (path === '/process.Process/Start') {
      const p = parsed?.process ?? {};
      const out = emulate(p.cmd ?? '', p.args ?? [], world);
      if (!out) return json(res, 500, { code: 'unknown', message: `exec: "${p.cmd}": executable file not found in $PATH` });
      if (out.hang || world.hangProcessStart) { await new Promise((r) => setTimeout(r, 60_000)); }
      res.writeHead(200, { 'content-type': 'application/connect+json' });
      res.write(frame({ event: { start: { pid: 4242 } } }));
      if (out.stdout) res.write(frame({ event: { data: { stdout: B64(out.stdout) } } }));
      if (out.stderr) res.write(frame({ event: { data: { stderr: B64(out.stderr) } } }));
      res.write(frame({ event: { end: { exitCode: out.exit, exited: true, status: 'exited' } } }));
      res.write(frame({}, 2));
      return res.end();
    }
    if (path === '/process.Process/List') return json(res, 200, { processes: [{ pid: 1, config: { cmd: 'entrypoint', args: [] } }] });
    if (path.startsWith('/process.Process/')) return json(res, 200, {});
    if (path === '/filesystem.Filesystem/ListDir') {
      const entries = world.dirs[parsed?.path];
      if (!entries) return json(res, 404, { code: 'not_found', message: 'directory not found' });
      return json(res, 200, { entries: entries.map((e) => ({ name: e.name, type: e.type === 'directory' ? 'FILE_TYPE_DIRECTORY' : 'FILE_TYPE_FILE', size: e.size, path: `${parsed.path}/${e.name}`, isDir: e.type === 'directory' })) });
    }
    if (path === '/filesystem.Filesystem/Stat') {
      const f = world.files[parsed?.path];
      if (f === undefined && !world.dirs[parsed?.path]) return json(res, 404, { code: 'not_found', message: 'file not found' });
      return json(res, 200, { entry: { name: parsed.path.split('/').pop(), path: parsed.path, type: f === undefined ? 'directory' : 'file', size: f?.length ?? 4096 } });
    }
    if (path.startsWith('/filesystem.Filesystem/')) return json(res, 200, {});
    if (path === '/files' && m === 'GET') {
      const f = world.files[url.searchParams.get('path')];
      if (f === undefined) return json(res, 404, { code: 'not_found', message: 'file not found' });
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      return res.end(f);
    }
    if (path === '/files' && m === 'POST') { res.writeHead(201, { 'content-type': 'application/json' }); return res.end('[]'); }
    return json(res, 404, { code: 404, message: `stub: no route ${m} ${path}` });
  }

  return new Promise((resolve) => {
    server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
    server.listen(port, '127.0.0.1', () => resolve({
      url: origin(),
      port: server.address().port,
      close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
    }));
  });
}
