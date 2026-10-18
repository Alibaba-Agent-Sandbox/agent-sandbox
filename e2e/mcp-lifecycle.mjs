#!/usr/bin/env node
// Real-cloud MCP STDIO acceptance. Run after build with authorized credentials in env.
// Only fixed check labels are printed; raw provider output is never logged.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { loadCredentials } from './lib/env.mjs';

const cli = fileURLToPath(new URL('../dist/bin/abx.js', import.meta.url));
const checks = [];
const credentials = loadCredentials();
const provider = process.env.ABX_PROVIDER || "alicloud-express";
// Child and finally fallback must use exactly the same authorized configuration.
Object.assign(process.env, credentials, { SANDBOX_LOG_LEVEL: "CRITICAL" });
function check(name, ok) {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) throw new Error('AcceptanceFailure');
}
function client() {
  const home = mkdtempSync(join(tmpdir(), 'abx-mcp-lifecycle-'));
  const child = spawn(process.execPath, [cli, 'mcp', 'start', '--template', process.env.ABX_E2E_TEMPLATE || 'base'], {
    env: { ...process.env, ABX_PROVIDER: provider, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), SANDBOX_LOG_LEVEL: 'CRITICAL' },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const pending = new Map();
  let counter = 0;
  child.on('error', () => { for (const p of pending.values()) p.reject(new Error('ChildFailure')); });
  child.on('exit', () => { for (const p of pending.values()) p.reject(new Error('ChildExit')); });
  createInterface({ input: child.stdout }).on('line', (line) => {
    try {
      const message = JSON.parse(line);
      const p = pending.get(message.id);
      if (p) p.resolve(message);
    } catch { /* Non-RPC output cannot fulfill a request. */ }
  });
  async function request(method, params = {}) {
    const id = ++counter;
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('RequestDeadline')), 90_000);
        pending.set(id, { resolve, reject });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    } finally { clearTimeout(timer); pending.delete(id); }
  }
  return {
    request,
    async tool(name, args = {}) {
      const response = await request('tools/call', { name, arguments: args });
      if (response.error) throw new Error('RpcFailure');
      const payload = JSON.parse(response.result.content[0].text);
      return { payload, error: response.result.isError === true };
    },
    async close() {
      if (child.exitCode === null) {
        child.stdin.end();
        await new Promise((resolve) => {
          const timer = setTimeout(() => { child.kill('SIGTERM'); resolve(); }, 5000);
          child.once('exit', () => { clearTimeout(timer); resolve(); });
        });
      }
      rmSync(home, { recursive: true, force: true });
    },
  };
}
const owner = client();
const observer = client();
let owned;
let destroyed = false;
try {
  for (const c of [owner, observer]) await c.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'lifecycle-e2e', version: '1' } });
  const catalog = await owner.request('tools/list');
  check('STDIO advertises all lifecycle tools', ['list_sandboxes', 'get_sandbox', 'set_sandbox_timeout'].every((name) => catalog.result.tools.some((t) => t.name === name)));
  check('get without default returns tool error', (await observer.tool('get_sandbox')).error);
  check('unsupported account selector returns tool error', (await observer.tool('create_sandbox', { team: 'unsupported' })).error);
  const created = await owner.tool('create_sandbox', { timeout: 600, cpu: 2, memory: 1024 });
  owned = created.payload.sandbox_id;
  check('real create with CPU and memory', !created.error && typeof owned === 'string' && owned.length > 0);
  const info = await owner.tool('get_sandbox', { sandbox_id: owned });
  const allowed = ['sandbox_id', 'template', 'status', 'region', 'timeout', 'started_at', 'end_at', 'cpu_count', 'memory_mb'];
  check('default refresh returns only safe metadata', !info.error && info.payload.sandbox.sandbox_id === owned && Object.keys(info.payload.sandbox).length === allowed.length && Object.keys(info.payload.sandbox).every((k) => allowed.includes(k)));
  let listed = false;
  // List visibility is the only intentionally retried platform operation.
  for (let n = 0; n < 10; n++) {
    const result = await observer.tool('list_sandboxes', { limit: 100, offset: 0 });
    if (result.error) throw new Error('ListFailure');
    listed = result.payload.sandboxes.some((s) => s.sandbox_id === owned);
    if (listed) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  check('eventually consistent list contains owned sandbox', listed);
  const external = await observer.tool('get_sandbox', { sandbox_id: owned });
  check('external ID refresh over STDIO', !external.error && external.payload.sandbox.sandbox_id === owned);
  const renewed = await observer.tool('set_sandbox_timeout', { sandbox_id: owned, timeout: 720 });
  check('external ID TTL update over STDIO', !renewed.error && renewed.payload.accepted);
  await observer.close();
  const alive = await owner.tool('get_sandbox', { sandbox_id: owned });
  check('observer EOF preserves external sandbox', !alive.error && alive.payload.sandbox.status === 'running');
  const ttl = await owner.tool('set_sandbox_timeout', { sandbox_id: owned, timeout: 600 });
  check('default TTL update over STDIO', !ttl.error && ttl.payload.accepted);
  const write = await owner.tool('write_file', { path: '/tmp/mcp-node-lifecycle.txt', content: 'lifecycle roundtrip\n' });
  const read = await owner.tool('read_file', { path: '/tmp/mcp-node-lifecycle.txt' });
  check('MCP real file roundtrip', !write.error && !read.error && read.payload.content === 'lifecycle roundtrip\n');
  const run = await owner.tool('run_command', { command: 'printf 42', timeout: 30 });
  check('MCP real command execution', !run.error && run.payload.exit_code === 0 && run.payload.stdout.trim() === '42');
  const killed = await owner.tool('kill_sandbox');
  destroyed = !killed.error && killed.payload.success;
  check('owned sandbox destruction', destroyed);
} catch {
  checks.push({ name: 'acceptance exception (raw details suppressed)', ok: false });
  console.log('FAIL acceptance exception (raw details suppressed)');
} finally {
  if (owned) {
    let cleanupPassed;
    try {
      // Idempotent cleanup of exactly this test-created ID, even after child failure.
      const { Sandbox } = await import('../dist/api/sandbox.js');
      if (!destroyed) await Sandbox.killById(owned, { provider });
      const visible = await Sandbox.list({ provider });
      cleanupPassed = !visible.some((s) => s.sandbox_id === owned);
    } catch { cleanupPassed = false; }
    checks.push({ name: 'finally cleanup and readonly absence check', ok: cleanupPassed });
    console.log(`${cleanupPassed ? 'PASS' : 'FAIL'} finally cleanup and readonly absence check`);
  }
  await Promise.allSettled([observer.close(), owner.close()]);
}
const passed = checks.length > 0 && checks.every((c) => c.ok);
console.log(JSON.stringify({ provider: 'configured cloud', transport: 'real CLI STDIO JSON-RPC', checks, passed }));
process.exitCode = passed ? 0 : 1;
