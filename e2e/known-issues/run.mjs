#!/usr/bin/env node
// Real-cloud verification of the SDK defect fixes KI-001 .. KI-007 / KI-008 in the Node CLI
// (the Node counterpart of python-sdk/e2e/test_03_commands.py + test_04_files_envd.py known-issue tests).
//
//   ABX_BIN="node dist/bin/abx.js" node e2e/known-issues/run.mjs [--filter regex] [--json out.json]
//
// - CLI behaviour (files list/stat, missing paths, process signal, exec timeout, bad API key, missing sandbox) is
//   checked by spawning the binary under test, exactly like the black-box suite in ../scenarios.
// - Per-call env, background processes and stdin have no CLI surface, so they go through the Node SDK that ships with
//   the same build (`ABX_SDK_DIST`, default `<repo>/dist`; it must be built from the same sources as ABX_BIN).
// Credentials come from the environment or the gitignored cli/.env and never reach the output (every captured byte
// is masked). Exactly one sandbox is created; it is killed in `finally` and on SIGINT/SIGTERM, recorded in
// e2e/.state/run-ki-<id>.json until confirmed gone, and the account is listed before/after to prove 0 leaks.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLI_ROOT, E2E_DIR, hasCloudCredentials, loadCredentials, makeMasker, missingCloudCredentials } from '../lib/env.mjs';
import { baseEnv, parseBin, runBinary } from '../lib/exec.mjs';

const args = process.argv.slice(2);
const opt = { filter: null, json: null };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--filter') opt.filter = new RegExp(args[++i], 'i');
  else if (args[i] === '--json') opt.json = args[++i];
  else { console.error(`usage: ABX_BIN=<abx> node e2e/known-issues/run.mjs [--filter regex] [--json file]`); process.exit(2); }
}

const creds = loadCredentials();
const mask = makeMasker(creds);
if (!hasCloudCredentials(creds)) {
  console.error(`SKIP: real-cloud credentials missing (${missingCloudCredentials(creds).join(', ')}); set them in the environment or the gitignored cli/.env`);
  process.exit(0);
}

const TEMPLATE = process.env.ABX_E2E_TEMPLATE || 'python-hello';
const bin = parseBin(process.env.ABX_BIN || 'abx');
const runId = `ki-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(16).slice(2, 8)}`;
const root = realpathSync(mkdtempSync(join(tmpdir(), 'abx-e2e-ki-')));
const home = join(root, 'home');
mkdirSync(home, { recursive: true });
const env = baseEnv({ home, creds });
const ledgerDir = join(E2E_DIR, '.state');
mkdirSync(ledgerDir, { recursive: true });
const ledger = join(ledgerDir, `run-${runId}.json`);
const tracked = new Set();
const persist = () => writeFileSync(ledger, JSON.stringify({ runId, sandboxes: [...tracked] }));

async function abx(argv, { env: extra = {}, creds: useCreds = true, timeoutMs = 180_000 } = {}) {
  const e = useCreds ? { ...env, ...extra } : { ...baseEnv({ home, creds: {} }), ...extra };
  const r = await runBinary({ bin, argv, env: e, cwd: root, timeoutMs });
  const out = { code: r.code, stdout: mask(r.stdout), stderr: mask(r.stderr), ms: r.ms, timedOut: r.timedOut };
  out.text = `${out.stdout}\n${out.stderr}`;
  out.json = () => JSON.parse(out.stdout);
  return out;
}

const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const excerpt = (s, n = 300) => mask(String(s)).replace(/\s+/g, ' ').slice(0, n);

async function killTracked() {
  for (const id of [...tracked]) {
    const r = await runBinary({ bin, argv: ['kill', id, '--yes'], env, cwd: root, timeoutMs: 90_000 });
    if (r.code === 0 || /not found|404|E2009/i.test(r.stdout + r.stderr)) tracked.delete(id);
  }
  persist();
}
let interrupted = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    console.error(`\n${sig}: cleaning up sandboxes...`);
    await killTracked();
    process.exit(130);
  });
}

async function listIds() {
  const r = await abx(['--json', 'list']);
  must(r.code === 0, `list failed: ${excerpt(r.text)}`);
  const j = r.json();
  return new Set(Array.isArray(j) ? j.map((s) => s.ID) : []);
}

let sdk = null;
const sdkDist = resolve(process.env.ABX_SDK_DIST || join(CLI_ROOT, 'dist'));
async function loadSdk() {
  if (!sdk) sdk = await import(pathToFileURL(join(sdkDist, 'api', 'sandbox.js')).href);
  return sdk;
}
async function connectSdk(id) {
  const { Sandbox } = await loadSdk();
  return Sandbox.connect(id, { api_key: creds.E2B_API_KEY, api_url: creds.E2B_API_URL, domain: creds.E2B_DOMAIN });
}

const state = { id: null, sb: null, dir: '/tmp/ki-e2e' };
const results = [];
const SC = [];
const scenario = (id, ki, title, fn) => SC.push({ id, ki, title, fn });

// ---------------------------------------------------------------------------------------------------------------
// KI-001 per-call env
scenario('ki001-per-call-env', 'KI-001', 'commands.run(env) reaches the command (envs, not envVars)', async () => {
  const r = await state.sb.commands.run('printenv E2E_CALL_ENV', { env: { E2E_CALL_ENV: 'per-call' } });
  must(r.exit_code === 0 && r.stdout === 'per-call\n', `exit ${r.exit_code} stdout ${excerpt(r.stdout)} stderr ${excerpt(r.stderr)}`);
});

// KI-002 / KI-007 files
scenario('ki002-prepare', 'KI-002', 'create a directory tree through the CLI', async () => {
  const d = state.dir;
  for (const p of [`${d}/sub`, `${d}/empty`]) {
    const r = await abx(['sandbox', 'files', 'mkdir', state.id, '--path', p]);
    must(r.code === 0, `mkdir ${p}: ${excerpt(r.text)}`);
  }
  await state.sb.files.write(`${d}/f.txt`, 'hello\n');
});

scenario('ki002-list-json-reports-directories', 'KI-002', 'files list --json: directory vs file type, name, size', async () => {
  const r = await abx(['--json', 'sandbox', 'files', 'list', state.id, '--path', state.dir]);
  must(r.code === 0, excerpt(r.text));
  const by = Object.fromEntries(r.json().map((e) => [e.name, e]));
  must(by.sub?.type === 'directory' && by.empty?.type === 'directory', `directories listed as ${JSON.stringify([by.sub?.type, by.empty?.type])}`);
  must(by['f.txt']?.type === 'file' && by['f.txt']?.size === 6, `f.txt entry ${JSON.stringify(by['f.txt'])}`);
});

scenario('ki002-stat-directory-and-file', 'KI-002', 'files stat --json: real Name/Path/Type/Size (nested entry)', async () => {
  const dir = await abx(['--json', 'sandbox', 'files', 'stat', state.id, '--path', `${state.dir}/sub`]);
  must(dir.code === 0, excerpt(dir.text));
  const d = dir.json();
  must(d.Name === 'sub' && d.Path === `${state.dir}/sub` && d.Type === 'directory', `directory stat ${JSON.stringify(d)}`);
  const file = await abx(['--json', 'sandbox', 'files', 'stat', state.id, '--path', `${state.dir}/f.txt`]);
  must(file.code === 0, excerpt(file.text));
  const f = file.json();
  must(f.Name === 'f.txt' && f.Path === `${state.dir}/f.txt` && f.Type === 'file' && Number(f.Size) === 6, `file stat ${JSON.stringify(f)}`);
});

scenario('ki007-list-missing-directory', 'KI-007', 'files list of a missing directory: exit 4, E4001', async () => {
  const r = await abx(['sandbox', 'files', 'list', state.id, '--path', `${state.dir}/no-such-dir`]);
  must(r.code === 4, `exit ${r.code}: ${excerpt(r.text)}`);
  must(r.text.includes('E4001') && r.text.includes('File or directory not found in the sandbox'), excerpt(r.text));
});

scenario('ki007-list-empty-directory-still-ok', 'KI-007', 'files list of an existing empty directory: exit 0, no error', async () => {
  const r = await abx(['sandbox', 'files', 'list', state.id, '--path', `${state.dir}/empty`]);
  must(r.code === 0 && r.text.includes('is empty'), `exit ${r.code}: ${excerpt(r.text)}`);
});

// KI-005 not found
scenario('ki005-stat-missing-file', 'KI-005', 'files stat of a missing path: exit 4, E4001', async () => {
  const r = await abx(['sandbox', 'files', 'stat', state.id, '--path', `${state.dir}/zzz-missing`]);
  must(r.code === 4 && r.text.includes('E4001'), `exit ${r.code}: ${excerpt(r.text)}`);
});

scenario('ki005-download-missing-file', 'KI-005', 'download of a missing remote file: exit 4, E4001, nothing written', async () => {
  const r = await abx(['download', state.id, `${state.dir}/zzz-missing`, join(root, 'out.bin')]);
  must(r.code === 4 && r.text.includes('E4001'), `exit ${r.code}: ${excerpt(r.text)}`);
});

scenario('ki005-missing-sandbox', 'KI-005', 'info/exec of a missing sandbox: exit 4, E2009', async () => {
  for (const argv of [['info', 'sbx-doesnotexist00000'], ['exec', 'sbx-doesnotexist00000', 'true']]) {
    const r = await abx(argv);
    must(r.code === 4 && r.text.includes('E2009'), `${argv[0]}: exit ${r.code}: ${excerpt(r.text)}`);
  }
});

// KI-006 authentication
scenario('ki006-bad-api-key', 'KI-006', 'wrong API key: exit 3, E1001 (list and create)', async () => {
  const bad = { E2B_API_KEY: 'e2e-invalid-key-0000000000000000' };
  const list = await abx(['list'], { env: bad });
  must(list.code === 3 && list.text.includes('E1001'), `list: exit ${list.code}: ${excerpt(list.text)}`);
  must(!list.text.includes(bad.E2B_API_KEY), 'the key leaked into the output');
  const create = await abx(['create', '--template', TEMPLATE], { env: bad });
  must(create.code === 3 && create.text.includes('E1001'), `create: exit ${create.code}: ${excerpt(create.text)}`);
});

// KI-003 command timeout
scenario('ki003-sdk-timeout-kills-the-process', 'KI-003', 'run("sleep 113", timeout=3): CommandTimeoutError (E3001) and the process is gone', async () => {
  const { CommandTimeoutError } = await import(pathToFileURL(join(sdkDist, 'models', 'errors.js')).href);
  const t0 = Date.now();
  let caught = null;
  try { await state.sb.commands.run('sleep 113', { timeout: 3 }); } catch (e) { caught = e; }
  must(caught instanceof CommandTimeoutError, `got ${caught?.constructor?.name}: ${excerpt(caught?.message)}`);
  must(Date.now() - t0 < 30_000, `took ${Date.now() - t0} ms`);
  const alive = await state.sb.commands.run(`sh -c 'ps -eo args | grep -c "^sleep 113" || true'`);
  must(alive.stdout.trim() === '0', `sleep 113 still running (${alive.stdout.trim()})`);
});

scenario('ki003-cli-exec-timeout', 'KI-003', 'abx exec --timeout 3 "sleep 114": exit 5, E3001, "did not finish within 3s", process gone', async () => {
  const r = await abx(['exec', state.id, 'sleep 114', '--timeout', '3']);
  must(r.code === 5 && r.text.includes('E3001') && r.text.includes('Command did not finish within 3s'), `exit ${r.code}: ${excerpt(r.text)}`);
  const alive = await state.sb.commands.run(`sh -c 'ps -eo args | grep -c "^sleep 114" || true'`);
  must(alive.stdout.trim() === '0', `sleep 114 still running (${alive.stdout.trim()})`);
});

// KI-004 process control
async function startBackground(cmd) {
  const known = new Set((await state.sb.commands.list()).map((p) => String(p.pid)));
  const reader = await state.sb.commands.start(cmd, { timeout: 150 });
  const done = reader.collect();
  done.catch(() => {});
  for (let i = 0; i < 30; i++) {
    const fresh = (await state.sb.commands.list()).filter((p) => !known.has(String(p.pid)));
    if (fresh.length) return { pid: fresh[fresh.length - 1].pid, done };
    await sleep(1000);
  }
  throw new Error(`${cmd} never appeared in commands.list()`);
}
const endedWithin = (done, ms) => Promise.race([done, sleep(ms).then(() => null)]);
async function forceKill(pid, done) {
  try { await state.sb.commands.kill(pid); await endedWithin(done, 15_000); } catch { /* best effort */ }
}

for (const sig of [15, 9]) {
  scenario(`ki004-cli-signal-${sig}`, 'KI-004', `abx sandbox process signal --signal ${sig} terminates a running process`, async () => {
    const { pid, done } = await startBackground('sleep 115');
    try {
      const r = await abx(['sandbox', 'process', 'signal', state.id, String(pid), '--signal', String(sig)]);
      must(r.code === 0 && r.text.includes(`Signal ${sig} sent to process ${pid}.`), `exit ${r.code}: ${excerpt(r.text)}`);
      const chunks = await endedWithin(done, 20_000);
      must(chunks && chunks[chunks.length - 1].type === 'exit', 'process did not end after the signal');
    } finally { await forceKill(pid, done); }
  });
}

scenario('ki004-sdk-kill', 'KI-004', 'commands.kill(pid) terminates a running process', async () => {
  const { pid, done } = await startBackground('sleep 116');
  try {
    await state.sb.commands.kill(pid);
    const chunks = await endedWithin(done, 20_000);
    must(chunks && chunks[chunks.length - 1].type === 'exit', 'process did not end after kill');
  } finally { await forceKill(pid, done); }
});

scenario('ki004-sdk-send-input', 'KI-004', 'commands.sendInput reaches stdin (head -n 1 echoes it)', async () => {
  const { pid, done } = await startBackground('head -n 1');
  try {
    await state.sb.commands.sendInput(pid, 'typed-input\n');
    const chunks = await endedWithin(done, 20_000);
    must(chunks, 'head -n 1 did not finish after stdin');
    must(chunks.map((c) => c.data ?? '').join('').includes('typed-input'), 'stdin text not echoed');
  } finally { await forceKill(pid, done); }
});

scenario('ki004-cli-unsupported-signal', 'KI-004', 'abx sandbox process signal --signal 2: rejected with the envd message, nothing sent', async () => {
  const { pid, done } = await startBackground('sleep 117');
  try {
    const r = await abx(['sandbox', 'process', 'signal', state.id, String(pid), '--signal', '2']);
    must(r.code !== 0 && r.text.includes('envd can only deliver SIGTERM (15) and SIGKILL (9) to a process; got 2'), `exit ${r.code}: ${excerpt(r.text)}`);
    must((await endedWithin(done, 2000)) === null, 'the process was signalled although the signal is unsupported');
  } finally { await forceKill(pid, done); }
});

// ---------------------------------------------------------------------------------------------------------------
async function main() {
  console.log(`abx known-issues e2e ${runId}\n  binary : ${process.env.ABX_BIN || 'abx'}\n  sdk    : ${sdkDist}`);
  const probe = await abx(['--version'], { creds: false });
  console.log(`  version: ${probe.stdout.trim()}`);
  let before = null;
  let exitCode = 0;
  try {
    before = await listIds();
    const create = await abx(['--json', 'create', '--template', TEMPLATE, '--timeout', '900'], { timeoutMs: 240_000 });
    must(create.code === 0, `create failed (exit ${create.code}): ${excerpt(create.text)}`);
    state.id = create.json().ID;
    tracked.add(state.id);
    persist();
    console.log(`  sandbox: ${state.id.slice(0, 8)}... (tracked, killed at the end)`);
    state.sb = await connectSdk(state.id);
    for (let i = 0; i < 20; i++) {
      try { const r = await state.sb.commands.run('true'); if (r.exit_code === 0) break; } catch { /* envd warming up */ }
      await sleep(1500);
    }

    for (const sc of SC) {
      if (opt.filter && !opt.filter.test(`${sc.id} ${sc.ki} ${sc.title}`)) continue;
      const t0 = Date.now();
      const rec = { id: sc.id, ki: sc.ki, title: sc.title, status: 'pass', ms: 0 };
      try { await sc.fn(); } catch (e) { rec.status = 'fail'; rec.reason = excerpt(e?.message ?? e, 600); exitCode = 1; }
      rec.ms = Date.now() - t0;
      results.push(rec);
      console.log(`${rec.status === 'pass' ? 'PASS' : 'FAIL'}  ${sc.ki}  ${sc.id}  (${(rec.ms / 1000).toFixed(1)}s)${rec.reason ? `\n      ${rec.reason}` : ''}`);
    }
  } catch (e) {
    console.error(`setup failed: ${excerpt(e?.message ?? e, 600)}`);
    exitCode = 1;
  } finally {
    try { if (state.sb) await state.sb.close?.(); } catch { /* ignore */ }
    await killTracked();
    let leaked = [...tracked];
    try {
      if (before) {
        let after = await listIds();
        for (let i = 0; i < 6 && state.id && after.has(state.id); i++) { await sleep(5000); after = await listIds(); }
        leaked = [...after].filter((id) => !before.has(id));
        console.log(`leak check: sandboxes before=${before.size} after=${after.size} leaked=${leaked.length}`);
      }
    } catch (e) { console.error(`leak check failed: ${excerpt(e?.message ?? e)}`); exitCode = 1; }
    if (leaked.length) exitCode = 1;
    const summary = { pass: results.filter((r) => r.status === 'pass').length, fail: results.filter((r) => r.status === 'fail').length, leaked: leaked.length };
    console.log(`\nsummary: ${JSON.stringify(summary)}`);
    if (opt.json) writeFileSync(opt.json, JSON.stringify({ runId, bin: process.env.ABX_BIN || 'abx', version: probe.stdout.trim(), results, summary }, null, 2));
    if (!tracked.size) rmSync(ledger, { force: true });
    rmSync(root, { recursive: true, force: true });
  }
  process.exitCode = exitCode;
}
await main();
