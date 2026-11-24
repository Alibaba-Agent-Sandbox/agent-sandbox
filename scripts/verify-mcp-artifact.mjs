/** Run the generated ASGI app with its installed public requirements; no cloud calls. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function argument(name) {
  const index = process.argv.indexOf(name);
  assert(index >= 0 && process.argv[index + 1], `${name} is required`);
  return process.argv[index + 1];
}
const artifact = resolve(argument('--artifact'));
const output = resolve(argument('--output'));
const python = resolve(argument('--python'));
const ownershipFixture = fileURLToPath(new URL('../tests/fixtures/agent/mcp_ownership_probe.py', import.meta.url));
const requirements = readFileSync(join(artifact, 'requirements.txt'), 'utf8');
const pinnedVersion = /^agent-sandbox-client\[mcp\]==([^\s]+)$/m.exec(requirements)?.[1];
assert(pinnedVersion, 'Expected a fixed public MCP client dependency');
const home = mkdtempSync(join(tmpdir(), 'abx-mcp-verification-'));
const environment = Object.fromEntries(
  ['PATH', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT', 'WINDIR', 'LANG', 'LC_ALL', 'SSL_CERT_FILE', 'SSL_CERT_DIR']
    .filter(name => process.env[name]).map(name => [name, process.env[name]]),
);
environment.HOME = home;
const metadata = spawnSync(python, ['-c',
  'import json; from importlib.metadata import version; print(json.dumps({name: version(name) for name in ["agent-sandbox-client", "agent-sandbox-server"]}))'],
  { encoding: 'utf8', env: environment });
assert.equal(metadata.status, 0, metadata.stderr);
const versions = JSON.parse(metadata.stdout);
assert.equal(versions['agent-sandbox-client'], pinnedVersion);
assert.equal(versions['agent-sandbox-server'], pinnedVersion);
const token = randomBytes(32).toString('base64url');
Object.assign(environment, {
  ABX_MCP_AUTH_TOKEN: token,
  ABX_SANDBOX_API_KEY: 'placeholder-no-cloud-requests',
  ABX_SANDBOX_DOMAIN: 'placeholder.invalid',
});
const listener = net.createServer();
await new Promise((done, fail) => { listener.once('error', fail); listener.listen(0, '127.0.0.1', done); });
const port = listener.address().port;
await new Promise(done => listener.close(done));
const server = spawn(python, ['-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', String(port), '--log-level', 'warning'], {
  cwd: artifact, env: environment, stdio: ['ignore', 'ignore', 'pipe'],
});
let stderr = '';
server.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-8000); });
let stopped = false;
const exited = new Promise(done => {
  server.once('exit', () => { stopped = true; done(); });
  server.once('error', error => { stderr = error.message; stopped = true; done(); });
});

/** Direct loopback HTTP avoids ambient proxy configuration and source SDK imports. */
function request(body, auth, session, method = 'POST') {
  return new Promise((done, fail) => {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    if (auth) headers.Authorization = 'Bearer ' + auth;
    if (session) headers['Mcp-Session-Id'] = session;
    const message = http.request({ host: '127.0.0.1', port, path: '/mcp', method, headers }, response => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', text => { raw += text; });
      response.on('end', () => {
        try {
          const events = raw.split(/\r?\n/).filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
          done({ status: response.statusCode, body: events.at(-1) ?? (raw ? JSON.parse(raw) : {}), session: response.headers['mcp-session-id'] });
        } catch (error) { fail(error); }
      });
      response.once('error', fail);
    });
    message.setTimeout(10000, () => message.destroy(new Error('MCP HTTP request deadline exceeded')));
    message.once('error', fail);
    message.end(JSON.stringify(body));
  });
}
const checks = {};
const report = { passed: false, versions, transport: 'real generated ASGI HTTP', checks, cloud_requests: 0, readiness_connection_retries: { ECONNREFUSED: 0, ECONNRESET: 0 } };
try {
  const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'public-artifact-verifier', version: '1' },
  } };
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (stopped) throw new Error('Generated server exited: ' + stderr.trim().split('\n').at(-1));
    try { await request(initialize); ready = true; break; }
    catch (error) {
      if (error.code !== 'ECONNREFUSED' && error.code !== 'ECONNRESET') throw error;
      report.readiness_connection_retries[error.code]++;
    }
    await new Promise(done => setTimeout(done, 100));
  }
  assert(ready, 'Generated server readiness deadline');
  checks.missing_auth_rejected = (await request(initialize)).status === 401;
  checks.wrong_auth_rejected = (await request(initialize, 'placeholder-wrong')).status === 401;
  const initialized = await request(initialize, token);
  checks.initialize = initialized.status === 200 && Boolean(initialized.body.result);
  assert(Object.values(checks).every(Boolean), JSON.stringify(checks));
  await request({ jsonrpc: '2.0', method: 'notifications/initialized' }, token, initialized.session);
  const listed = await request({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, token, initialized.session);
  const tools = listed.body.result.tools;
  const names = new Set(tools.map(tool => tool.name));
  const required = ['create_sandbox', 'list_sandboxes', 'get_sandbox', 'set_sandbox_timeout', 'run_command', 'kill_sandbox'];
  checks.current_tool_catalog = listed.status === 200 && required.every(name => names.has(name)) && names.size === tools.length;
  checks.tool_schemas = tools.every(tool => tool.inputSchema && typeof tool.inputSchema === 'object');
  const second = await request(initialize, token);
  checks.distinct_sessions = second.status === 200 && Boolean(initialized.session) &&
    Boolean(second.session) && second.session !== initialized.session;
  const ended = await request(undefined, token, initialized.session, 'DELETE');
  const ping = { jsonrpc: '2.0', id: 3, method: 'ping' };
  checks.closed_session_rejected = ended.status === 200 && (await request(ping, token, initialized.session)).status === 404;
  checks.other_session_stays_open = (await request(ping, token, second.session)).status === 200;
  checks.second_session_closed = (await request(undefined, token, second.session, 'DELETE')).status === 200;
  assert(Object.values(checks).every(Boolean), JSON.stringify(checks));
  const ownership = spawnSync(python, [ownershipFixture, artifact], {
    env: environment, encoding: 'utf8', timeout: 10000,
  });
  assert.ifError(ownership.error);
  assert.equal(ownership.status, 0, ownership.stderr);
  report.ownership_with_provider_fixture = JSON.parse(ownership.stdout);
  Object.assign(report, { passed: true, tool_names: [...names].sort() });
} catch (error) {
  report.failure = error.name + ': ' + error.message;
  throw error;
} finally {
  if (!stopped) server.kill('SIGTERM');
  await Promise.race([exited, new Promise(done => setTimeout(done, 5000).unref())]);
  if (!stopped) { server.kill('SIGKILL'); await exited; }
  report.owned_process_stopped = stopped;
  rmSync(home, { recursive: true, force: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
