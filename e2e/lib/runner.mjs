import { readdirSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { E2E_DIR, loadCredentials, hasCloudCredentials, missingCloudCredentials, makeMasker } from './env.mjs';
import { baseEnv, makeSandboxDir, parseBin, runBinary, normalize } from './exec.mjs';
import { check, checkShape, fail, parseJsonLoose, ScenarioFailure, ScenarioSkip, excerpt } from './assert.mjs';

const STATE_DIR = join(E2E_DIR, '.state');
export const RUN_ID = `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(16).slice(2, 8)}`;

function preflightDocker() {
  if (process.env.ABX_E2E_DOCKER !== '1') {
    return 'opt-in: set ABX_E2E_DOCKER=1 (builds an image and pushes it to ACR; slow and costs real cloud resources)';
  }
  const r = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', timeout: 20_000 });
  if (r.error || r.status !== 0) return `docker daemon unusable (${(r.error?.message ?? r.stderr ?? '').trim().split('\n')[0] || `exit ${r.status}`})`;
  return null;
}

async function preflightGithub() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10_000);
    const res = await fetch('https://raw.githubusercontent.com/alibaba-agent-sandbox/awesome-templates/main/awesome-templates.yaml', { method: 'HEAD', signal: ctl.signal });
    clearTimeout(t);
    return res.ok ? null : `template index not reachable (HTTP ${res.status})`;
  } catch (e) {
    return `template index not reachable (${e.name === 'AbortError' ? 'timeout' : e.message})`;
  }
}

export async function loadSuites(only) {
  const dir = join(E2E_DIR, 'scenarios');
  const files = readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort();
  const suites = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(join(dir, f)).href);
    const suite = mod.default;
    suite.file = f;
    if (!only || only.some((o) => suite.id === o || f.startsWith(o))) suites.push(suite);
  }
  return suites;
}

export async function main(opts) {
  const binSpec = process.env.ABX_BIN || 'abx';
  const bin = parseBin(binSpec);
  const creds = loadCredentials();
  const mask = makeMasker(creds);
  const cloudOk = hasCloudCredentials(creds);
  const suites = await loadSuites(opts.suites);
  const timeoutDefault = Number(process.env.ABX_E2E_TIMEOUT_MS || 120_000);

  const root = makeSandboxDir('abx-e2e-');
  const tracker = { sandboxes: new Set(), killed: new Set(), uncertainCreates: new Set() };
  mkdirSync(STATE_DIR, { recursive: true });
  const ledger = join(STATE_DIR, `run-${RUN_ID}.json`);
  const persist = () => writeFileSync(ledger, JSON.stringify({ runId: RUN_ID, sandboxes: [...tracker.sandboxes].filter((s) => !tracker.killed.has(s)), uncertainCreates: [...tracker.uncertainCreates] }));

  const skipReasons = {
    cloud: cloudOk ? null : `real-cloud credentials missing (${missingCloudCredentials(creds).join(', ')}); provide them via environment or the gitignored cli/.env`,
    github: null,
    docker: preflightDocker(),
    killall: process.env.ABX_E2E_ALLOW_KILL_ALL === '1' ? null : 'opt-in: set ABX_E2E_ALLOW_KILL_ALL=1 (a buggy implementation could destroy every sandbox of the account)',
  };
  if (suites.some((s) => (s.needs ?? []).includes('github'))) skipReasons.github = await preflightGithub();

  const results = [];
  const meta = { runId: RUN_ID, bin: binSpec, startedAt: new Date().toISOString(), cloud: cloudOk, skipReasons, version: null };

  const probe = await runBinary({ bin, argv: ['--version'], env: baseEnv({ home: root, creds: {} }), cwd: root, timeoutMs: 60_000 });
  meta.version = probe.spawnError ? `UNRUNNABLE (${mask(probe.stderr).trim()})` : mask(probe.stdout || probe.stderr).trim().split('\n')[0];
  if (probe.spawnError) {
    console.error(`ABX_BIN is not runnable: ${meta.version}`);
    process.exitCode = 2;
    return;
  }
  console.log(`abx e2e run ${RUN_ID}\n  binary : ${binSpec}\n  version: ${meta.version}\n  cloud  : ${cloudOk ? 'credentials present' : 'NO credentials (cloud suites skip)'}`);

  const cleanup = () => cleanupTrackedSandboxes({ bin, creds, root, tracker, persist });
  let interrupted = false;
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => { if (interrupted) process.exit(130); interrupted = true; console.error(`\n${sig}: cleaning up sandboxes...`); await cleanup(); process.exit(130); });
  }

  try {
    for (const suite of suites) {
      const needs = suite.needs ?? [];
      const suiteSkip = needs.map((n) => skipReasons[n]).find(Boolean) ?? null;
      console.log(`\n== ${suite.id}: ${suite.title}${suiteSkip ? `  [SKIP: ${suiteSkip}]` : ''}`);
      const home = join(root, `home-${suite.id}`);
      const cwd = join(root, `cwd-${suite.id}`);
      mkdirSync(home, { recursive: true });
      mkdirSync(cwd, { recursive: true });
      const ctx = makeContext({ bin, creds, mask, home, cwd, root, tracker, persist, state: {}, suite, timeoutDefault });
      const failed = new Set();
      let setupError = null;
      if (!suiteSkip && suite.setup) {
        try { await suite.setup(ctx); } catch (e) { setupError = e; }
      }
      for (const sc of suite.scenarios) {
        if (opts.filter && !opts.filter.test(`${suite.id}/${sc.id} ${sc.title}`)) continue;
        const rec = { suite: suite.id, id: sc.id, title: sc.title, status: 'pass', ms: 0, attempts: 0, notes: [] };
        const t0 = Date.now();
        const sk = suiteSkip ?? (sc.needs ?? []).map((n) => skipReasons[n]).find(Boolean) ?? null;
        const missing = (sc.requires ?? []).find((r) => failed.has(r) || !ctx.state.done?.has(r));
        if (sk) { rec.status = 'skip'; rec.reason = sk; }
        else if (setupError) { rec.status = 'fail'; rec.reason = `suite setup failed: ${mask(String(setupError.message ?? setupError))}`; }
        else if (missing) { rec.status = 'skip'; rec.reason = `prerequisite scenario "${missing}" did not pass`; }
        else {
          try {
            await runScenario(sc, ctx, rec);
            (ctx.state.done ??= new Set()).add(sc.id);
          } catch (e) {
            rec.reason = mask(e instanceof ScenarioFailure || e instanceof ScenarioSkip ? e.message : `${e.stack ?? e}`);
            rec.status = e instanceof ScenarioSkip ? 'skip' : sc.known ? 'xfail' : 'fail';
            if (sc.known) rec.known = sc.known;
          }
          if (rec.status === 'pass' && sc.known) { rec.status = 'xpass'; rec.known = sc.known; }
        }
        if (rec.status === 'fail') failed.add(sc.id);
        if (rec.status === 'xfail' || rec.status === 'skip') failed.add(sc.id);
        rec.ms = Date.now() - t0;
        results.push(rec);
        const flag = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP', xfail: 'XFAIL', xpass: 'XPASS' }[rec.status];
        console.log(`  ${flag.padEnd(5)} ${sc.id.padEnd(34)} ${String(rec.ms).padStart(6)}ms${rec.attempts > 1 ? `  (attempts: ${rec.attempts})` : ''}${rec.status !== 'pass' && rec.reason ? `\n        ${rec.reason.split('\n').slice(0, opts.verbose ? 40 : 6).join('\n        ')}` : ''}`);
        if (opts.bail && rec.status === 'fail') break;
      }
      if (suite.teardown && !suiteSkip) { try { await suite.teardown(ctx); } catch (e) { console.log(`  teardown error: ${mask(String(e.message ?? e))}`); } }
      await cleanup();
    }
    const leak = await leakCheck({ bin, creds, root, tracker, persist, mask, cloudOk, skipOnlyOffline: suites.every((s) => !(s.needs ?? []).includes('cloud')) });
    results.push(leak);
    console.log(`\n  ${leak.status.toUpperCase().padEnd(5)} ${leak.id}${leak.reason ? ` - ${leak.reason}` : ''}`);
  } finally {
    await cleanup();
    if (!process.env.ABX_E2E_KEEP) rmSync(root, { recursive: true, force: true });
    if (tracker.sandboxes.size === tracker.killed.size && tracker.uncertainCreates.size === 0 && existsSync(ledger)) rmSync(ledger, { force: true });
  }

  meta.finishedAt = new Date().toISOString();
  meta.leakedSandboxes = [...tracker.sandboxes].filter((s) => !tracker.killed.has(s)).length;
  meta.createdSandboxes = tracker.sandboxes.size;
  meta.unresolvedCreateAttempts = tracker.uncertainCreates.size;
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  meta.counts = counts;
  console.log(`\nSummary: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}; known sandboxes created=${meta.createdSandboxes} unconfirmed=${meta.leakedSandboxes} unresolved creates=${meta.unresolvedCreateAttempts}`);
  const out = { meta, results };
  if (opts.json) writeFileSync(opts.json, mask(JSON.stringify(out, null, 2)));
  if (opts.markdown) writeFileSync(opts.markdown, mask(renderMarkdown(out)));
  process.exitCode = results.some((r) => r.status === 'fail') ? 1 : 0;
}

/** Preserve failed standard kill operations in the recovery ledger. */
export async function cleanupTrackedSandboxes({ bin, creds, root, tracker, persist }) {
  const env = baseEnv({ home: join(root, 'home-cleanup'), creds });
  mkdirSync(env.HOME, { recursive: true });
  for (const id of [...tracker.sandboxes]) {
    if (tracker.killed.has(id)) continue;
    await runBinary({ bin, argv: ['sandbox', 'kill', '--', id], env, cwd: root, timeoutMs: 90_000 });
    // A kill acknowledgement is not independent evidence that the resource is absent.
  }
  persist();
}

export async function leakCheck({ bin, creds, root, tracker, cloudOk, skipOnlyOffline, persist = () => {}, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const rec = { suite: 'builtin', id: 'leak-check', title: 'owned sandboxes are absent from inventory and exact-ID queries', status: 'pass', ms: 0, attempts: 1, notes: [] };
  const uncertain = tracker.uncertainCreates?.size ?? 0;
  if (uncertain && tracker.sandboxes.size === 0) { persist(); rec.status = 'fail'; rec.reason = `${uncertain} unresolved create attempt(s); no resource identity is available for safe cleanup`; return rec; }
  if (!cloudOk || skipOnlyOffline || tracker.sandboxes.size === 0) { rec.status = 'skip'; rec.reason = 'no cloud sandboxes were created'; return rec; }
  const env = baseEnv({ home: join(root, 'home-leak'), creds });
  mkdirSync(env.HOME, { recursive: true });
  for (let i = 0; i < 4; i++) {
    const r = await runBinary({ bin, argv: ['sandbox', 'list', '--format', 'json'], env, cwd: root, timeoutMs: 90_000 });
    const j = parseJsonLoose(r.stdout);
    if (r.code !== 0 || j === undefined) { rec.status = 'fail'; rec.reason = `could not list sandboxes: exit ${r.code}`; return rec; }
    if (!Array.isArray(j) || j.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.sandboxId !== 'string' || !entry.sandboxId.trim())) {
      rec.status = 'fail'; rec.reason = 'standard inventory must be an array with nonempty sandboxId strings'; return rec;
    }
    const ids = j.map((entry) => entry.sandboxId);
    const leaked = [];
    for (const id of tracker.sandboxes) {
      // Inventory can lag behind creation. Only the exact owned identity's NotFound
      // response, together with inventory absence, confirms cleanup.
      let absent = false;
      if (!ids.includes(id)) {
        const info = await runBinary({ bin, argv: ['sandbox', 'info', '--format', 'json', '--', id], env, cwd: root, timeoutMs: 90_000 });
        absent = info.code === 1 && /wasn't found/i.test(info.stdout + info.stderr);
      }
      if (absent) tracker.killed.add(id);
      else { tracker.killed.delete(id); leaked.push(id); }
    }
    persist();
    if (!leaked.length) {
      rec.status = 'pass'; delete rec.reason;
      if (uncertain) { rec.status = 'fail'; rec.reason = `${uncertain} unresolved create attempt(s) require reconciliation`; }
      return rec;
    }
    for (const id of leaked) await runBinary({ bin, argv: ['sandbox', 'kill', '--', id], env, cwd: root, timeoutMs: 90_000 });
    rec.status = 'fail';
    rec.reason = `${leaked.length} sandbox(es) have unconfirmed absence after cleanup: ${leaked.join(', ')}`;
    if (i < 3) await wait(3000);
  }
  return rec;
}

export function makeContext({ bin, creds, mask, home, cwd, root, tracker, persist, state, suite, timeoutDefault }) {
  const ctx = {
    bin, creds, home, cwd, root, state, suite, mask,
    beginCreateAttempt(label) {
      tracker.uncertainCreates ??= new Set();
      const attempt = `${suite.id}/${label}/${randomUUID()}`;
      tracker.uncertainCreates.add(attempt);
      persist();
      return attempt;
    },
    resolveCreateAttempt(attempt) {
      if (!tracker.uncertainCreates?.has(attempt)) throw new Error('unknown create attempt');
      tracker.uncertainCreates.delete(attempt);
      persist();
    },
    track(id) { tracker.sandboxes.add(id); persist(); },
    untrack(id) { tracker.killed.add(id); persist(); },
    env(extra = {}, { withCreds = true } = {}) { return baseEnv({ home: ctx.home, creds: withCreds ? creds : {}, extra }); },
    async abx(argv, o = {}) {
      const home2 = o.home ?? ctx.home;
      const env = baseEnv({ home: home2, creds: o.creds === false ? {} : { ...creds, ...(o.creds || {}) }, extra: o.env });
      const res = await runBinary({ bin, argv, env, cwd: o.cwd ?? ctx.cwd, stdin: o.stdin, timeoutMs: o.timeoutMs ?? timeoutDefault });
      const nopts = { home: home2, cwd: o.cwd ?? ctx.cwd, tmp: root };
      res.maskedStdout = mask(res.stdout);
      res.stdout = normalize(res.maskedStdout, nopts);
      res.stderr = normalize(mask(res.stderr), nopts);
      res.out = res.stdout + res.stderr;
      res.rawJson = () => parseJsonLoose(res.maskedStdout);
      return res;
    },
    async rawAbx(argv, o = {}) {
      const home2 = o.home ?? ctx.home;
      const env = baseEnv({ home: home2, creds: o.creds === false ? {} : { ...creds, ...(o.creds || {}) }, extra: o.env });
      return runBinary({ bin, argv, env, cwd: o.cwd ?? ctx.cwd, stdin: o.stdin, timeoutMs: o.timeoutMs ?? timeoutDefault });
    },
    newHome(name) { const h = join(root, `home-${suite.id}-${name}`); mkdirSync(h, { recursive: true }); return h; },
    newCwd(name) { const d = join(root, `cwd-${suite.id}-${name}`); mkdirSync(d, { recursive: true }); return d; },
    async eventually(fn, { timeoutMs = 30_000, intervalMs = 2_000, what = 'condition' } = {}) {
      const end = Date.now() + timeoutMs;
      let last;
      for (;;) {
        try { return await fn(); } catch (e) { last = e; }
        if (Date.now() > end) throw new ScenarioFailure(`timed out waiting for ${what}: ${last?.message ?? last}`);
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    },
    skip(reason) { throw new ScenarioSkip(reason); },
    fail, check, checkShape, parseJsonLoose, excerpt,
  };
  return ctx;
}

export async function runScenario(sc, ctx, rec) {
  const attempts = 1 + (sc.retries ?? 0);
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    rec.attempts = i;
    try {
      await runOnce(sc, ctx);
      if (i > 1) rec.notes.push(`passed on attempt ${i}/${attempts} (retry allowed for: ${sc.retryReason ?? 'eventually-consistent operation'})`);
      return;
    } catch (e) {
      if (e instanceof ScenarioSkip) throw e;
      lastErr = e;
      if (i < attempts) await new Promise((r) => setTimeout(r, sc.retryDelayMs ?? 3000));
    }
  }
  throw lastErr;
}

async function runOnce(sc, ctx) {
  if (sc.run) { await sc.run(ctx); return; }
  const argv = typeof sc.argv === 'function' ? sc.argv(ctx) : sc.argv;
  const o = {
    stdin: typeof sc.stdin === 'function' ? sc.stdin(ctx) : sc.stdin,
    env: typeof sc.env === 'function' ? sc.env(ctx) : sc.env,
    creds: sc.creds,
    home: sc.freshHome ? ctx.newHome(sc.id) : (sc.home ? sc.home(ctx) : undefined),
    cwd: sc.cwd ? sc.cwd(ctx) : undefined,
    timeoutMs: sc.timeoutMs,
  };
  const res = await ctx.abx(argv, o);
  if (res.timedOut) fail(`command timed out after ${sc.timeoutMs ?? 'default'}ms: abx ${argv.join(' ')}`);
  const want = sc.exit ?? 0;
  const ok = want === 'nonzero' ? res.code !== 0 : [].concat(want).includes(res.code);
  if (!ok) fail(`exit code ${res.code}, expected ${JSON.stringify(want)}\n--- stdout ---\n${excerpt(res.stdout)}\n--- stderr ---\n${excerpt(res.stderr)}`);
  check('stdout', res.stdout, sc.stdout);
  check('stderr', res.stderr, sc.stderr);
  check('output', res.out, sc.output);
  let json;
  if (sc.json || sc.jsonShape) {
    json = parseJsonLoose(res.stdout);
    if (json === undefined) fail(`stdout is not valid JSON\n--- stdout ---\n${excerpt(res.stdout)}`);
    if (sc.jsonShape) checkShape(json, sc.jsonShape);
    if (sc.json) await sc.json(json, ctx, res);
  }
  if (sc.after) await sc.after(ctx, res, json);
}

export function renderMarkdown({ meta, results }) {
  const icon = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP', xfail: 'XFAIL', xpass: 'XPASS' };
  const lines = [];
  lines.push('| Suite | Scenario | Result | Time | Notes |', '|---|---|---|---|---|');
  for (const r of results) {
    const note = [r.known ? `known: ${r.known}` : '', r.attempts > 1 ? `attempts ${r.attempts}` : '', ...(r.notes ?? []), r.status !== 'pass' && r.reason ? r.reason.split('\n')[0].slice(0, 160) : ''].filter(Boolean).join('; ').replace(/\|/g, '\\|');
    lines.push(`| ${r.suite} | \`${r.id}\` | ${icon[r.status]} | ${(r.ms / 1000).toFixed(1)}s | ${note} |`);
  }
  return lines.join('\n') + '\n';
}
