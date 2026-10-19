import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalize } from './normalize.mjs';

/** Split `ABX_BIN` ("abx", "/path/abx", or "node /path/dist/bin/abx.js") into [cmd, ...args]. */
export function parseBin(spec) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(spec ?? 'abx')) !== null) out.push(m[1] ?? m[2] ?? m[3]);
  return out.length ? out : ['abx'];
}

export function makeSandboxDir(prefix) {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

/**
 * A deterministic, hermetic environment for the binary under test: nothing is inherited from the
 * caller except PATH/LANG/proxy settings; CI flags are removed so the CLI does not silently switch
 * to --json/--quiet; HOME points at an isolated directory.
 */
export function baseEnv({ home, creds, extra = {} }) {
  const env = {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TERM: 'dumb',
    NO_COLOR: '1',
    COLUMNS: '200',
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
  };
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS', 'DOCKER_HOST', 'DOCKER_BUILDKIT', 'DOCKER_CONFIG', 'ABX_SERVER_SDK_SOURCE', 'ABX_BASE_IMAGE_TAG', 'ABX_BASE_IMAGE_REGION']) {
    if (process.env[k]) env[k] = process.env[k];
  }
  Object.assign(env, creds, extra);
  for (const k of Object.keys(env)) if (env[k] === undefined || env[k] === null) delete env[k];
  return env;
}

export function runBinary({ bin, argv, env, cwd, stdin, timeoutMs = 120_000 }) {
  const [cmd, ...pre] = bin;
  const started = Date.now();
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, [...pre, ...argv], { env, cwd, stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ code: 127, signal: null, stdout: '', stderr: `spawn failed: ${e.message}`, ms: 0, timedOut: false, spawnError: true });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnError = false;
    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('error', (e) => { spawnError = true; stderr += `spawn error: ${e.message}`; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code: code ?? (timedOut ? 124 : 1), signal, stdout, stderr, ms: Date.now() - started, timedOut, spawnError });
    });
    if (child.stdin) {
      child.stdin.on('error', () => {});
      if (stdin !== undefined) child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}

export { normalize, mkdirSync, rmSync };
