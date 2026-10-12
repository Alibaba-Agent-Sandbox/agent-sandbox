#!/usr/bin/env node
/**
 * Differential fuzz of the MCP STDIO framing / response ORDER: the original `python -m easy_sandbox.agent.mcp` versus
 * `src/agent/mcp_main.ts`. Random sequences of valid, malformed, blank, non-object and notification lines are cut at random
 * byte offsets (including mid-line and mid-UTF-8), written with pauses between chunks, and the raw stdout bytes (response
 * order included) must be identical.
 *
 *   ORACLE_VENV=/path/to/venv node parity/diff/mcp_stdio_order.mjs [--cases N] [--seed S] [--verbose]
 *
 * Exit 0 = identical, 1 = differences, 2 = oracle missing. Tool calls use only argument-validation paths that fail before any network I/O (the relative latency of a network failure
 * against the chunk pauses is a race, not an ordering rule; tool-error text is covered by mcp_toolerr.mjs).
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORACLE_VENV = process.env.ORACLE_VENV;
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
};
const CASES = arg("--cases", 24);
const SEED = arg("--seed", 20261012);
const verbose = process.argv.includes("--verbose");

if (!ORACLE_VENV || !existsSync(join(ORACLE_VENV, "bin", "python"))) {
  console.error("ORACLE_VENV must point to a venv with the original easy-sandbox installed (see docs/PORTING.md).");
  process.exit(2);
}

let state = SEED >>> 0;
const rnd = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 2 ** 32;
};
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];

const LINES = [
  (i) => JSON.stringify({ jsonrpc: "2.0", id: i, method: "ping" }),
  (i) => JSON.stringify({ jsonrpc: "2.0", id: `s${i}`, method: "ping" }),
  (i) => JSON.stringify({ jsonrpc: "2.0", id: i, method: "initialize", params: { protocolVersion: pick(["2024-11-05", "2025-06-18", "1999-01-01", 5, null]), capabilities: {}, clientInfo: { name: "x" } } }),
  (i) => JSON.stringify({ jsonrpc: "2.0", id: i, method: "tools/list" }),
  (i) => JSON.stringify({ jsonrpc: "2.0", id: i, method: "tools/call", params: { name: "nope", arguments: {} } }),
  (i) => JSON.stringify({ jsonrpc: "2.0", id: i, method: "tools/call", params: { name: "run_code", arguments: {} } }),
  (i) => JSON.stringify({ jsonrpc: "2.0", id: i, method: "tools/call", params: { name: "write_file", arguments: { path: "/a" } } }),
  (i) => JSON.stringify({ jsonrpc: "2.0", id: i, method: "tools/call", params: "bad" }),
  (i) => JSON.stringify({ jsonrpc: "2.0", id: i, method: "no/such" }),
  () => JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  () => JSON.stringify({ jsonrpc: "2.0", method: "ping" }),
  () => JSON.stringify({ jsonrpc: "1.0", id: 3, method: "ping" }),
  () => "not json",
  () => "{",
  () => '{"jsonrpc":"2.0","id":1,"method":"ping"',
  () => "[]",
  () => "[1,2]",
  () => "1",
  () => "null",
  () => '"str"',
  () => "",
  () => "   ",
  () => "\t",
  () => "\r",
  () => '{"id":1}',
  () => '{"method":5,"id":2}',
  () => '{"jsonrpc":"2.0","id":[1],"method":"ping"}',
  () => '{"jsonrpc":"2.0","id":{"a":1},"method":"ping"}',
  (i) => JSON.stringify({ jsonrpc: "2.0", id: i, method: "ping", extra: "héllo \u{1f600}" }),
  () => '{"a":NaN}',
  () => '{"jsonrpc":"2.0","id":1e400,"method":"ping"}',
];

function makeCase() {
  const n = 2 + Math.floor(rnd() * 9);
  const lines = [];
  for (let i = 0; i < n; i += 1) lines.push(pick(LINES)(100 + i));
  let text = lines.join("\n");
  if (rnd() < 0.7) text += "\n";
  const bytes = Buffer.from(text, "utf8");
  const cuts = new Set();
  const k = Math.floor(rnd() * 5);
  for (let i = 0; i < k; i += 1) cuts.add(1 + Math.floor(rnd() * Math.max(1, bytes.length - 1)));
  const sorted = [...cuts].sort((a, b) => a - b);
  const chunks = [];
  let prev = 0;
  for (const c of sorted) {
    chunks.push(bytes.subarray(prev, c));
    prev = c;
  }
  chunks.push(bytes.subarray(prev));
  return chunks.filter((c) => c.length);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runOne(kind, chunks) {
  const env = { ...process.env, E2B_API_KEY: "k", E2B_API_URL: "http://127.0.0.1:9", SANDBOX_TEMPLATE: "t", PYTHONUNBUFFERED: "1" };
  const [cmd, args, cwd] =
    kind === "py"
      ? [join(ORACLE_VENV, "bin", "python"), ["-m", "easy_sandbox.agent.mcp"], "/tmp"]
      : [process.execPath, ["--import", "tsx", join(CLI_ROOT, "src", "agent", "mcp_main.ts")], CLI_ROOT];
  const proc = spawn(cmd, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  const out = [];
  proc.stdout.on("data", (d) => out.push(d));
  proc.stderr.on("data", () => {});
  const exited = new Promise((r) => proc.on("exit", (code, sig) => r(`${code}/${sig}`)));
  proc.stdin.on("error", () => {});
  proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 0, method: "ping" })}\n`);
  for (let i = 0; i < 100 && Buffer.concat(out).length === 0; i += 1) await sleep(100);
  const ready = Buffer.concat(out).length;
  for (const c of chunks) {
    proc.stdin.write(c);
    await sleep(150);
  }
  proc.stdin.end();
  const status = await Promise.race([exited, sleep(15000).then(() => "timeout")]);
  if (status === "timeout") proc.kill("SIGKILL");
  return { out: Buffer.concat(out).subarray(ready).toString("utf8"), status };
}

let diffs = 0;
for (let n = 0; n < CASES; n += 1) {
  const chunks = makeCase();
  const [py, node] = await Promise.all([runOne("py", chunks), runOne("node", chunks)]);
  const same = py.out === node.out && py.status === node.status;
  if (!same) diffs += 1;
  if (!same || verbose) {
    console.log(`${same ? "ok  " : "FAIL"} case ${n}: ${JSON.stringify(chunks.map((c) => c.toString("utf8")))}`);
    if (!same) console.log(`  py   (${py.status}): ${JSON.stringify(py.out)}\n  node (${node.status}): ${JSON.stringify(node.out)}`);
  }
}
console.log(`${diffs === 0 ? "IDENTICAL" : "DIFFERENCES"}: ${diffs} difference(s) over ${CASES} cases (seed ${SEED})`);
process.exit(diffs === 0 ? 0 : 1);
