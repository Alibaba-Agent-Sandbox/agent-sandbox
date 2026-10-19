#!/usr/bin/env node
/** Local real-component conditional acceptance; never dispatched by Actions. */
import assert from 'node:assert/strict';
import { loadCredentials, makeMasker } from './lib/env.mjs';
import { parseBin, runBinary } from './lib/exec.mjs';

const credentials = loadCredentials();
const mask = makeMasker(credentials);
const origin = credentials.E2B_API_URL;
assert.ok(origin && new URL(origin).hostname.endsWith('.aliyuncs.com'), 'An explicit Alibaba Express origin is required');
const bin = parseBin(process.env.ABX_BIN ?? 'abx');
const env = { ...process.env, ...credentials, NO_COLOR: '1' };
const sandboxes = new Set(), snapshots = new Set(), snapshotSources = new Set();
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function command(args) {
  const r = await runBinary({ bin, argv: args, env, timeoutMs: 360_000 });
  if (r.code !== 0) throw Object.assign(new Error(`Conditional command failed: ${args[0]} ${args[1] ?? ''}`), { detail: mask(r.stderr), exitCode: r.code });
  return r.stdout;
}
async function until(check, label) {
  const deadline = Date.now() + 120_000;
  do { if (await check()) return; await sleep(2000); } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${label}`);
}
async function kill(id) {
  await until(async () => {
    const r = await runBinary({ bin, argv: ['sandbox', 'kill', id], env });
    if (r.code === 0) return true;
    if (/409[: ]|PAUSING|RESUMING|snapshotting/i.test(r.stderr)) return false;
    throw new Error('Owned sandbox cleanup failed');
  }, 'owned deletion after lifecycle transition');
  const response = await fetch(`${origin.replace(/\/$/, '')}/sandboxes/${id}`, {
    headers: { 'X-API-Key': credentials.E2B_API_KEY }, signal: AbortSignal.timeout(20_000),
  });
  assert.equal(response.status, 404);
  sandboxes.delete(id);
}
const program = "import http.server,uuid; token=uuid.uuid4().hex; Handler=type('Handler',(http.server.BaseHTTPRequestHandler,),{'do_GET':lambda self:(self.send_response(200),self.end_headers(),self.wfile.write(token.encode())),'log_message':lambda *args:None}); http.server.HTTPServer(('127.0.0.1',8765),Handler).serve_forever()";
const query = "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8765',timeout=3).read().decode())";
async function create(template) {
  const id = (await command(['sandbox', 'create', template, '--detach', '--timeout', '900'])).trim();
  assert.match(id, /^[a-zA-Z0-9_-]+$/); sandboxes.add(id);
  await command(['exec', '--background', id, 'python3', '-u', '-c', program]);
  let token;
  await until(async () => {
    const r = await runBinary({ bin, argv: ['exec', id, 'python3', '-c', query], env });
    if (r.code !== 0) return false;
    token = r.stdout.trim(); return /^[0-9a-f]{32}$/.test(token);
  }, 'in-memory probe readiness');
  await command(['exec', id, 'sh', '-c', 'printf checkpoint > /tmp/conditional-file']);
  return { id, token };
}
async function snapshotList(id) {
  return JSON.parse(await command(['sandbox', 'snapshot', 'list', id, '--format', 'json']));
}
try {
  if (process.env.E2E_PAUSE_TEMPLATE) {
    const { id, token } = await create(process.env.E2E_PAUSE_TEMPLATE);
    await command(['sandbox', 'pause', id]);
    await until(async () => JSON.parse(await command(['list', '--state', 'paused', '--format', 'json']))
      .some(item => item.sandboxId === id), 'paused state');
    await command(['sandbox', 'resume', id]);
    assert.equal((await command(['exec', id, 'python3', '-c', query])).trim(), token);
    assert.equal(await command(['exec', id, 'cat', '/tmp/conditional-file']), 'checkpoint');
    await kill(id); console.log('PASS: standalone CLI pause/resume preserves memory and files');
  } else console.log('SKIP: E2E_PAUSE_TEMPLATE is not configured');
  if (process.env.E2E_SNAPSHOT_TEMPLATE) {
    const { id, token } = await create(process.env.E2E_SNAPSHOT_TEMPLATE);
    let snapshot;
    snapshotSources.add(id);
    try {
      const output = await command(['sandbox', 'snapshot', 'create', id]);
      snapshot = /Created snapshot ([a-zA-Z0-9_:-]+)/.exec(output)?.[1];
      assert.ok(snapshot); snapshots.add(snapshot);
    } finally {
      // Reconcile this uniquely owned source if create timed out after committing.
      for (const item of await snapshotList(id)) snapshots.add(item.snapshotId);
    }
    await until(async () => (await snapshotList(id)).some(item => item.snapshotId === snapshot), 'snapshot index');
    const restored = (await command(['create', snapshot, '--detach', '--timeout', '300'])).trim();
    assert.match(restored, /^[a-zA-Z0-9_-]+$/); sandboxes.add(restored);
    assert.equal((await command(['exec', restored, 'python3', '-c', query])).trim(), token);
    assert.equal(await command(['exec', restored, 'cat', '/tmp/conditional-file']), 'checkpoint');
    await command(['exec', restored, 'sh', '-c', 'printf clone > /tmp/conditional-file']);
    assert.equal(await command(['exec', id, 'cat', '/tmp/conditional-file']), 'checkpoint');
    await kill(restored); await kill(id);
    await command(['sandbox', 'snapshot', 'delete', snapshot]);
    await until(async () => !(await snapshotList(id)).some(item => item.snapshotId === snapshot), 'snapshot deletion');
    snapshots.delete(snapshot); console.log('PASS: standalone CLI snapshot/list/restore/clone isolation/delete');
  } else console.log('SKIP: E2E_SNAPSHOT_TEMPLATE is not configured');
} catch (error) {
  console.error(mask(error.message)); process.exitCode = 1;
} finally {
  for (const id of sandboxes) {
    try { await kill(id); } catch { console.error('FAIL: owned sandbox cleanup'); process.exitCode = 1; }
  }
  // Source deletion can settle a timed-out create before its snapshot is indexed.
  for (const source of snapshotSources) {
    try { for (const item of await snapshotList(source)) snapshots.add(item.snapshotId); }
    catch { console.error('FAIL: owned snapshot reconciliation'); process.exitCode = 1; }
  }
  for (const id of snapshots) {
    try { await command(['sandbox', 'snapshot', 'delete', id]); snapshots.delete(id); } catch { console.error('FAIL: owned snapshot cleanup'); process.exitCode = 1; }
  }
  console.log(`Owned residuals: sandboxes=${sandboxes.size} snapshots=${snapshots.size}`);
}
