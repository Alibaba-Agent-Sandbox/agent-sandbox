// Shared runner for the adv_commands_* differential fuzzers (oracle `ebx` vs Node `ebx`).
// Needs ORACLE_VENV; Node side runs src/bin/ebx.ts through tsx. One private stub per run; HOME/cwd isolated.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createAllowList } from "./sdk_defect_allowlist.mjs";
import { startStub } from "./stub.mjs";

export const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ORACLE_VENV = process.env.ORACLE_VENV;
export const haveOracle = () => !!ORACLE_VENV && existsSync(join(ORACLE_VENV, "bin", "ebx"));
export const requireOracle = () => {
  if (!haveOracle()) {
    console.error("SKIP: ORACLE_VENV must point to a venv with the original easy-sandbox installed (docs/PORTING.md).");
    process.exit(0);
  }
};
const TSX = pathToFileURL(join(CLI_ROOT, "node_modules", "tsx", "dist", "esm", "index.mjs")).href;
const ENTRY = join(CLI_ROOT, "src", "bin", "ebx.ts");
export const SECRET_KEY = "k-stub-0123456789abcdef";
export const scratchRoot = () => realpathSync(mkdtempSync(join(tmpdir(), "ebx-advc-")));

export function normalize(text, ctx) {
  let t = String(text ?? "").replace(/\u001b\[[0-9;?]*[A-Za-z]/g, (m) => (ctx.keepAnsi ? m : ""));
  if (ctx.keepAnsi) t = String(text ?? "").replace(/\u001b/g, "<ESC>");
  for (const [p, tag] of [[ctx.cwd, "<CWD>"], [ctx.home, "<HOME>"], [ctx.root, "<TMP>"]]) if (p) t = t.split(p).join(tag);
  if (ctx.stubUrl) t = t.split(ctx.stubUrl).join("<STUB>");
  t = t.replace(/127\.0\.0\.1:\d+/g, "<STUB-HOST>");
  t = t.replace(/\/(?:tmp|var\/folders)\/[^\s"'<>]+/g, "<TMPPATH>");
  t = t.replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)?/g, "<TS>");
  t = t.replace(/"execution_time":\s*[\d.eE+-]+/g, '"execution_time": 0.0').replace(/\bin \d+(\.\d+)?s\b/g, "in <N>s");
  t = t.split(SECRET_KEY).join("<KEY>");
  if (ctx.dropInternal !== false) {
    // asyncio / httpcore internals have no Node counterpart (ACCEPTED-OK); "INFO: HTTP Request:" lines are kept.
    t = t.split("\n").filter((l) => !/^DEBUG: (Using selector:|connect_tcp\.|send_request_|receive_response_|response_closed\.|start_tls\.|close\.|connect_unix_socket\.)/.test(l)).join("\n");
  }
  if (process.env.ADV_DROP_HTTP_INFO === "1") t = t.split("\n").filter((l) => !/^INFO: HTTP Request:/.test(l)).join("\n");
  return t;
}

/** snapshot of files under home (relative path -> content) for artifact comparison */
export function snapshotTree(dir, ctx, limit = 200) {
  const out = {};
  const walk = (d, rel) => {
    let names = [];
    try { names = readdirSync(d).sort(); } catch { return; }
    for (const n of names) {
      if (Object.keys(out).length > limit) return;
      const p = join(d, n);
      const r = rel ? `${rel}/${n}` : n;
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { out[`${r}/`] = `<dir ${(st.mode & 0o777).toString(8)}>`; walk(p, r); }
      else if (!st.isFile()) out[r] = `<special ${(st.mode & 0o170000).toString(8)}>`;
      else {
        let txt;
        try { txt = readFileSync(p); } catch { txt = Buffer.from("<unreadable>"); }
        out[r] = `${(st.mode & 0o777).toString(8)} ${txt.length > 4000 ? `len=${txt.length}` : normalize(txt.toString("latin1"), ctx)}`;
      }
    }
  };
  walk(dir, "");
  return out;
}

/**
 * case = { name, argv, env?, stdin?, setup?(home,cwd,stub), creds?:bool, world?, timeoutMs?, tree?:bool, keepAnsi? , fault?}
 */
export async function runKind(kind, c, root) {
  const stub = await (c.stubFactory ?? startStub)(c);
  const home = mkdtempSync(join(root, `${kind}-h-`));
  const cwd = mkdtempSync(join(root, `${kind}-c-`));
  try {
    if (c.world) await fetch(`${stub.url}/__world`, { method: "POST", body: JSON.stringify(typeof c.world === "function" ? c.world(stub) : c.world) });
    c.setup?.(home, cwd, stub);
    const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TERM: "dumb", NO_COLOR: "1", COLUMNS: "100", PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8", EBX_NO_KEYCHAIN: "1" };
    if (c.creds !== false) Object.assign(env, { E2B_API_KEY: SECRET_KEY, E2B_API_URL: stub.url, E2B_DOMAIN: "stub.invalid" });
    for (const [k, v] of Object.entries(c.env ?? {})) {
      if (v === null) delete env[k];
      else env[k] = typeof v === "function" ? v({ home, cwd, stub }) : v;
    }
    const argv = typeof c.argv === "function" ? c.argv({ home, cwd, stub }) : c.argv;
    let [cmd, args] = kind === "py" ? [join(ORACLE_VENV, "bin", "ebx"), argv] : [process.execPath, ["--import", TSX, ENTRY, ...argv]];
    if (c.shell) {
      env.EBX = [cmd, ...args].map((x) => `'${x.replace(/'/g, "'\\''")}'`).join(" ");
      [cmd, args] = ["bash", ["-c", c.shell]];
    }
    if (c.pty) {
      const spec = { argv: [cmd, ...args], cwd, env, steps: c.pty.steps ?? [], timeout: c.pty.timeout ?? 40 };
      [cmd, args] = ["python3", [join(dirname(fileURLToPath(import.meta.url)), "pty_run.py"), JSON.stringify(spec)]];
    }
    const res = await new Promise((ok) => {
      const child = spawn(cmd, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], detached: false });
      const out = [];
      const err = [];
      child.stdout.on("data", (d) => out.push(d));
      child.stderr.on("data", (d) => err.push(d));
      const timer = setTimeout(() => child.kill("SIGKILL"), c.timeoutMs ?? 45_000);
      c.onSpawn?.(child);
      child.on("error", (e) => err.push(Buffer.from(`spawn error ${e.message}`)));
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        ok({ code: signal ? `signal:${signal}` : code, stdout: Buffer.concat(out), stderr: Buffer.concat(err) });
      });
      child.stdin.on("error", () => {});
      if (c.stdinFn) c.stdinFn(child.stdin);
      else child.stdin.end(c.stdin ?? "");
    });
    if (c.pty) {
      let r;
      try { r = JSON.parse(res.stdout.toString("utf8")); } catch { r = { code: "pty-harness-failed", output: res.stdout.toString("utf8") + res.stderr.toString("utf8") }; }
      res.code = r.timed_out ? `pty-timeout(${r.code})` : r.code;
      res.stdout = Buffer.from(r.output.replace(/\r+\n/g, "\n"), "utf8");
      res.stderr = Buffer.alloc(0);
    }
    const ctx = { home, cwd, root, stubUrl: stub.url, keepAnsi: c.keepAnsi, dropInternal: c.dropInternal };
    const log = await (await fetch(`${stub.url}/__log`)).json();
    return {
      code: res.code,
      stdout: normalize(res.stdout.toString("utf8"), ctx),
      stderr: normalize(res.stderr.toString("utf8"), ctx),
      stdoutHex: c.binary ? res.stdout.toString("hex") : undefined,
      wire: c.wire === false ? null : log.map((e) => `${e.method} ${e.path}${Object.keys(e.query).length ? `?${new URLSearchParams(e.query)}` : ""} ${e.ct}${e.body ? ` ${normalize(JSON.stringify(e.body), ctx)}` : ""}`),
      tree: c.tree ? { home: snapshotTree(home, ctx), cwd: snapshotTree(cwd, ctx) } : null,
    };
  } finally {
    await stub.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
}

export function compare(a, b) {
  const d = [];
  if (a.code !== b.code) d.push(`exit: py=${a.code} node=${b.code}`);
  if (a.stdout !== b.stdout) d.push(`stdout:\n   py:   ${JSON.stringify(a.stdout).slice(0, 600)}\n   node: ${JSON.stringify(b.stdout).slice(0, 600)}`);
  if (a.stderr !== b.stderr) d.push(`stderr:\n   py:   ${JSON.stringify(a.stderr).slice(0, 600)}\n   node: ${JSON.stringify(b.stderr).slice(0, 600)}`);
  if (a.stdoutHex !== b.stdoutHex) d.push("stdout bytes differ");
  if (a.wire && b.wire && JSON.stringify(a.wire) !== JSON.stringify(b.wire)) d.push(`wire:\n   py:   ${JSON.stringify(a.wire).slice(0, 500)}\n   node: ${JSON.stringify(b.wire).slice(0, 500)}`);
  if (a.tree && b.tree && JSON.stringify(a.tree) !== JSON.stringify(b.tree)) d.push(`files:\n   py:   ${JSON.stringify(a.tree).slice(0, 500)}\n   node: ${JSON.stringify(b.tree).slice(0, 500)}`);
  return d;
}

export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { for (;;) { const i = next++; if (i >= items.length) return; out[i] = await fn(items[i], i); } }));
  return out;
}

/** Run all cases, print diffs, return count of differing cases. */
export async function runAll(cases, { jobs = 6, verbose = true, only = null, harness = basename(process.argv[1] ?? "adv_commands", ".mjs") } = {}) {
  const root = scratchRoot();
  const allow = createAllowList(harness);
  const sel = cases.filter((c) => !only || c.name.includes(only));
  let n = 0;
  const diffs = [];
  await pool(sel, jobs, async (c) => {
    const py = await runKind("py", c, root);
    const node = await runKind("node", c, root);
    const d = compare(py, node);
    n++;
    if (d.length && allow.judgeResults(c.name, py, node).allowed) { if (verbose) console.log(`ALLOWED ${c.name} (SDK defect fix, parity/sdk-defect-fixes.md)`); }
    else if (d.length) { diffs.push({ name: c.name, argv: typeof c.argv === "function" ? "<fn>" : c.argv, d }); if (verbose) console.log(`DIFF ${c.name}  argv=${JSON.stringify(typeof c.argv === "function" ? "<fn>" : c.argv)}\n  ${d.join("\n  ")}`); }
  });
  rmSync(root, { recursive: true, force: true });
  const stale = allow.report({ complete: !only });
  for (let i = 0; i < stale; i += 1) diffs.push({ name: "<stale allow-list id>", argv: null, d: ["stale"] });
  console.log(`${diffs.length} differing of ${sel.length} cases`);
  return diffs;
}

export const argOf = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; };
