#!/usr/bin/env node
// Mock-vs-oracle differential harness.
//   ABX_ORACLE=<reference abx> ABX_BIN=<abx under test> node parity/diff/diff.mjs [--filter re] [--fast] [--out dir] [--verbose]
// Runs identical argv against both binaries (isolated HOME/cwd, stub cloud, no CI env) and diffs
// exit code, normalised stdout/stderr, captured artifacts and the recorded HTTP wire traffic.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { startStub } from './stub.mjs';
import { CASES } from './cases.mjs';
import { createAllowList } from './sdk_defect_allowlist.mjs';

const args = process.argv.slice(2);
const opt = { filter: null, fast: false, out: null, verbose: false, list: false, show: false };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--filter') opt.filter = new RegExp(args[++i], 'i');
  else if (args[i] === '--fast') opt.fast = true;
  else if (args[i] === '--out') opt.out = args[++i];
  else if (args[i] === '--verbose') opt.verbose = true;
  else if (args[i] === '--list') opt.list = true;
  else if (args[i] === '--show') opt.show = true;
  else { console.error(`unknown option ${args[i]}`); process.exit(2); }
}
if (opt.list) { for (const c of CASES) console.log(`${c.id}${c.slow ? ' (slow)' : ''}${c.evidence ? `  <- ${c.evidence}` : ''}`); process.exit(0); }

const split = (s) => (s.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((x) => x.replace(/^["']|["']$/g, ''));
const ORACLE = process.env.ABX_ORACLE;
const BIN = process.env.ABX_BIN || 'abx';
if (!ORACLE) { console.error('ABX_ORACLE is required (path of the reference implementation, e.g. the Python abx)'); process.exit(2); }

const SECRET_KEY = 'k-stub-0123456789abcdef';

function normalize(text, ctx) {
  let t = String(text ?? '').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
  for (const [p, tag] of [[ctx.cwd, '<CWD>'], [ctx.home, '<HOME>'], [ctx.root, '<TMP>']]) if (p) t = t.split(p).join(tag);
  t = t.split(ctx.stubUrl).join('<STUB>').replace(/127\.0\.0\.1:\d+/g, '<STUB-HOST>');
  t = t.replace(/"command":\s*"[^"]*",(\s*)"args":\s*\[[^\]]*?"mcp",\s*"start"\s*\]/g, '"command": "<ABX-BIN>",$1"args": ["mcp", "start"]');
  t = t.replace(/"command":\s*"[^"]*abx(?:\.js)?"/g, '"command": "<ABX-BIN>"');
  t = t.replace(/\/(?:tmp|var\/folders)\/[^\s"'<>]+/g, '<TMPPATH>');
  t = t.replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)?/g, '<TS>');
  t = t.replace(/"execution_time":\s*[\d.eE+-]+/g, '"execution_time": 0.0').replace(/\bin \d+(\.\d+)?s\b/g, 'in <N>s');
  t = t.replace(/"command":\s*"[^"]*(?:\/|\\)?abx(?:\.js)?"/g, '"command": "<ABX-BIN>"');
  t = t.split(SECRET_KEY).join('<KEY>');
  return t.split('\n').map((l) => l.replace(/\s+$/g, '')).join('\n').trim();
}

function parseBin(spec) { return split(spec); }

function run(bin, argv, { env, cwd, stdin, timeoutMs }) {
  const [cmd, ...pre] = parseBin(bin);
  return new Promise((resolve) => {
    const child = spawn(cmd, [...pre, ...argv], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let timedOut = false;
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { stderr += `spawn error: ${e.message}`; });
    const t = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('close', (code) => { clearTimeout(t); resolve({ code: timedOut ? 124 : code, stdout, stderr, timedOut }); });
    child.stdin.on('error', () => {});
    child.stdin.end(stdin ?? '');
  });
}

async function control(stub, path, body) {
  const r = await fetch(`${stub.url}${path}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
  return r.json();
}

async function execCase(c, bin, label, stub, root) {
  const home = join(root, `${label}-${c.id}-home`);
  const cwd = join(root, `${label}-${c.id}-cwd`);
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  c.setup?.(home, cwd);
  await control(stub, '/__world', c.world ?? {});
  const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TERM: 'dumb', NO_COLOR: '1', COLUMNS: '120', PYTHONUNBUFFERED: '1', XDG_CONFIG_HOME: join(home, '.config') };
  if (c.creds !== false) Object.assign(env, { E2B_API_KEY: SECRET_KEY, E2B_API_URL: stub.url, E2B_DOMAIN: 'stub.invalid' });
  for (const [k, v] of Object.entries(c.env ?? {})) { if (v === null) delete env[k]; else env[k] = v; }
  const res = await run(bin, c.argv, { env, cwd, stdin: c.stdin, timeoutMs: c.slow ? 120_000 : 60_000 });
  const ctx = { home, cwd, root, stubUrl: stub.url };
  const out = {
    exit: res.code,
    stdout: normalize(res.stdout, ctx),
    stderr: normalize(res.stderr, ctx),
    artifacts: {},
    wire: null,
  };
  for (const a of c.artifacts ?? []) {
    const [where, rel] = a.split(/:(.*)/s);
    const p = join(where === 'home' ? home : cwd, rel);
    out.artifacts[a] = existsSync(p) ? normalize(readFileSync(p, 'utf8'), ctx) : '<missing>';
  }
  if (c.wire !== false) {
    const log = await control(stub, '/__log');
    out.wire = log.map((e) => `${e.method} ${e.path}${Object.keys(e.query).length ? `?${new URLSearchParams(e.query)}` : ''} ${e.ct}${e.body ? ` ${normalize(JSON.stringify(e.body), ctx)}` : ''}`);
  }
  return out;
}

function lineDiff(a, b) {
  const al = a.split('\n'); const bl = b.split('\n');
  const out = [];
  const n = Math.max(al.length, bl.length);
  for (let i = 0; i < n; i++) if (al[i] !== bl[i]) out.push(`  - ${al[i] ?? '<none>'}\n  + ${bl[i] ?? '<none>'}`);
  return out.slice(0, 12).join('\n');
}

function compare(a, b) {
  const diffs = [];
  if (a.exit !== b.exit) diffs.push(`exit code: oracle=${a.exit} bin=${b.exit}`);
  if (a.stdout !== b.stdout) diffs.push(`stdout differs:\n${lineDiff(a.stdout, b.stdout)}`);
  if (a.stderr !== b.stderr) diffs.push(`stderr differs:\n${lineDiff(a.stderr, b.stderr)}`);
  for (const k of new Set([...Object.keys(a.artifacts), ...Object.keys(b.artifacts)])) if (a.artifacts[k] !== b.artifacts[k]) diffs.push(`artifact ${k} differs:\n${lineDiff(a.artifacts[k] ?? '', b.artifacts[k] ?? '')}`);
  if (a.wire && b.wire && JSON.stringify(a.wire) !== JSON.stringify(b.wire)) diffs.push(`wire traffic differs:\n${lineDiff(a.wire.join('\n'), b.wire.join('\n'))}`);
  return diffs;
}

const root = realpathSync(mkdtempSync(join(tmpdir(), 'abx-diff-')));
const stub = await startStub();
const cases = CASES.filter((c) => (!opt.fast || !c.slow) && (!opt.filter || opt.filter.test(c.id)));
console.log(`differential run: ${cases.length} cases\n  oracle: ${ORACLE}\n  binary: ${BIN}\n  stub  : ${stub.url}`);
const results = [];
const allow = createAllowList('diff');
for (const c of cases) {
  const oracle = await execCase(c, ORACLE, 'oracle', stub, root);
  const bin = await execCase(c, BIN, 'bin', stub, root);
  let diffs = compare(oracle, bin);
  const ruling = diffs.length ? allow.judgeResults(c.id, oracle, bin) : null;
  const allowedKis = ruling?.allowed ? ruling.kis : null;
  if (allowedKis) diffs = [];
  if (opt.show) console.log(`--- ${c.id}  [exit ${oracle.exit}]\n${oracle.stdout}\n${oracle.stderr ? `[stderr] ${oracle.stderr}\n` : ''}${oracle.wire ? `[wire]\n${oracle.wire.join('\n')}\n` : ''}${Object.entries(oracle.artifacts).map(([k, v]) => `[artifact ${k}]\n${v}`).join('\n')}`);
  results.push({ id: c.id, evidence: c.evidence ?? null, ok: diffs.length === 0, allowed: allowedKis, diffs, oracle: { exit: oracle.exit }, bin: { exit: bin.exit } });
  console.log(`${diffs.length ? 'DIFF' : allowedKis ? `ALLOWED (${allowedKis.join(', ')}; parity/sdk-defect-fixes.md)` : 'same'}  ${c.id}${diffs.length ? ` (${diffs.length})` : ''}`);
  if (diffs.length && opt.verbose) console.log(diffs.map((d) => `    ${d.replace(/\n/g, '\n    ')}`).join('\n'));
}
await stub.close();
rmSync(root, { recursive: true, force: true });

const bad = results.filter((r) => !r.ok);
const stale = allow.report({ complete: !opt.fast && !opt.filter });
const nAllowed = results.filter((r) => r.ok && r.allowed).length;
console.log(`\n${results.length - bad.length - nAllowed}/${results.length} identical, ${nAllowed} allow-listed (SDK defect fixes), ${bad.length + stale} differing`);
if (opt.out) {
  mkdirSync(opt.out, { recursive: true });
  writeFileSync(join(opt.out, 'diff-report.json'), JSON.stringify({ oracle: ORACLE, bin: BIN, results }, null, 2));
  const md = ['| Case | Result | Evidence case | Details |', '|---|---|---|---|', ...results.map((r) => `| \`${r.id}\` | ${r.ok ? (r.allowed ? `allow-listed (${r.allowed.join(', ')})` : 'identical') : 'DIFF'} | ${r.evidence ?? ''} | ${r.diffs.map((d) => d.split('\n')[0]).join('; ').replace(/\|/g, '\\|')} |`)];
  writeFileSync(join(opt.out, 'diff-report.md'), `${md.join('\n')}\n`);
}
process.exitCode = bad.length || stale ? 1 : 0;
