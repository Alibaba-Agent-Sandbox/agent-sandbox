#!/usr/bin/env node
/**
 * Adversarial differential of the MCP STDIO server: original (`python -m agent_sandbox.agent.mcp` or `abx mcp start`) versus the
 * port (`src/agent/mcp_main.ts` or `src/bin/abx.ts mcp start`). Every case is a script of timed stdin writes / signals /
 * closes against a stub platform; stdout bytes, normalised stderr, exit status/signal, stub request log and the runtime-dir
 * state file are compared.
 *
 *   ORACLE_VENV=/path/to/venv node parity/diff/adv_agent_template_mcp_stdio.mjs [--only substr] [--verbose]
 *
 * Exit 0 = identical (or oracle absent -> skipped), 1 = differences.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startStub } from "./stub.mjs";

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORACLE_VENV = process.env.ORACLE_VENV;
if (!ORACLE_VENV || !existsSync(join(ORACLE_VENV, "bin", "python"))) {
  console.error("ORACLE_VENV not set; skipping.");
  process.exit(0);
}
const verbose = process.argv.includes("--verbose");
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const TSX = pathToFileURL(join(CLI_ROOT, "node_modules", "tsx", "dist", "esm", "index.mjs")).href;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rpc = (id, method, params) => `${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })}\n`;
const INIT = rpc(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "adv", version: "0" } });
const call = (id, name, args) => rpc(id, "tools/call", { name, arguments: args });

const cases = [];
const add = (name, steps, opts = {}) => cases.push({ name, steps, ...opts });
const lines = (...ls) => ls.map((l) => ({ send: l.endsWith("\n") ? l : `${l}\n` }));

// ---- framing / whitespace -----------------------------------------------------------------------------------------
add("crlf line endings", [{ send: '{"jsonrpc":"2.0","id":1,"method":"ping"}\r\n' }, { send: '{"jsonrpc":"2.0","id":2,"method":"ping"}\r\n' }]);
add("lone CR separators", [{ send: '{"jsonrpc":"2.0","id":1,"method":"ping"}\r{"jsonrpc":"2.0","id":2,"method":"ping"}\n' }]);
add("leading/trailing spaces", [{ send: '   {"jsonrpc":"2.0","id":1,"method":"ping"}   \n' }]);
add("python-only whitespace x1c-x1f", [{ send: '\u001f\n' }, { send: '\u001c{"jsonrpc":"2.0","id":1,"method":"ping"}\u001d\n' }]);
add("nbsp / unicode whitespace line", [{ send: "\u00a0\n" }, { send: '\u00a0{"jsonrpc":"2.0","id":1,"method":"ping"}\u00a0\n' }, { send: "\u2003\n" }, { send: "\u0085\n" }]);
add("bom prefix", [{ send: '\ufeff{"jsonrpc":"2.0","id":1,"method":"ping"}\n' }]);
add("bom only line", [{ send: "\ufeff\n" }]);
add("form feed / vtab line", [{ send: "\f\n" }, { send: "\v\n" }, { send: '\f{"jsonrpc":"2.0","id":1,"method":"ping"}\v\n' }]);
add("nul byte in line", [{ send: Buffer.from('{"jsonrpc":"2.0","id":1,"method":"ping"}\u0000\n') }]);
add("invalid utf-8 line then valid", [{ send: Buffer.from([0xff, 0xfe, 0x0a]) }, { send: rpc(1, "ping") }]);
add("many blank lines", [{ send: "\n\n\n   \n\t\n" + rpc(1, "ping") }]);
add("eof without newline", [{ send: '{"jsonrpc":"2.0","id":1,"method":"ping"}' }]);
add("eof without newline after valid", [{ send: rpc(1, "ping") }, { send: '{"jsonrpc":"2.0","id":2,"method":"ping"}' }]);
add("immediate eof", []);
add("two requests one chunk", [{ send: rpc(1, "ping") + rpc(2, "ping") + rpc(3, "tools/list") }]);
add("tools/list bytes", lines(rpc(1, "tools/list")));

// ---- JSON syntax --------------------------------------------------------------------------------------------------
for (const [n, l] of Object.entries({
  "nan literal": '{"jsonrpc":"2.0","id":NaN,"method":"ping"}',
  "infinity literal": '{"jsonrpc":"2.0","id":Infinity,"method":"ping"}',
  "neg infinity": '{"jsonrpc":"2.0","id":-Infinity,"method":"ping"}',
  "dup keys last wins": '{"jsonrpc":"2.0","id":1,"id":2,"method":"ping","method":"tools/list"}',
  "big int id": '{"jsonrpc":"2.0","id":123456789012345678901234567890,"method":"ping"}',
  "float id": '{"jsonrpc":"2.0","id":1.5,"method":"ping"}',
  "float id 1.0": '{"jsonrpc":"2.0","id":1.0,"method":"ping"}',
  "float id exp": '{"jsonrpc":"2.0","id":1e2,"method":"ping"}',
  "float id 1e-7": '{"jsonrpc":"2.0","id":1e-7,"method":"ping"}',
  "float id 1e16": '{"jsonrpc":"2.0","id":1e16,"method":"ping"}',
  "float id 1.5e300": '{"jsonrpc":"2.0","id":1.5e300,"method":"ping"}',
  "float id -0": '{"jsonrpc":"2.0","id":-0,"method":"ping"}',
  "float id -0.0": '{"jsonrpc":"2.0","id":-0.0,"method":"ping"}',
  "float id 0.1+": '{"jsonrpc":"2.0","id":0.30000000000000004,"method":"ping"}',
  "float id long digits": '{"jsonrpc":"2.0","id":3.14159265358979323846264338,"method":"ping"}',
  "float id 1e400": '{"jsonrpc":"2.0","id":1e400,"method":"ping"}',
  "float id -1e400": '{"jsonrpc":"2.0","id":-1e400,"method":"ping"}',
  "float id 1E+2": '{"jsonrpc":"2.0","id":1E+2,"method":"ping"}',
  "float id 5e-324": '{"jsonrpc":"2.0","id":5e-324,"method":"ping"}',
  "float id 123456789.123456789": '{"jsonrpc":"2.0","id":123456789.123456789,"method":"ping"}',
  "leading zero": '{"jsonrpc":"2.0","id":01,"method":"ping"}',
  "plus sign": '{"jsonrpc":"2.0","id":+1,"method":"ping"}',
  "trailing comma": '{"jsonrpc":"2.0","id":1,"method":"ping",}',
  "single quotes": "{'jsonrpc':'2.0','id':1,'method':'ping'}",
  "unquoted key": '{jsonrpc:"2.0","id":1,"method":"ping"}',
  "comment": '{"jsonrpc":"2.0","id":1,"method":"ping"} // c',
  "trailing garbage": '{"jsonrpc":"2.0","id":1,"method":"ping"} x',
  "two objects": '{"jsonrpc":"2.0","id":1,"method":"ping"}{"jsonrpc":"2.0","id":2,"method":"ping"}',
  "control char in string": '{"jsonrpc":"2.0","id":"a\tb","method":"ping"}',
  "bad escape": '{"jsonrpc":"2.0","id":"a\\qb","method":"ping"}',
  "bad unicode escape": '{"jsonrpc":"2.0","id":"a\\u12","method":"ping"}',
  "lone high surrogate escape": '{"jsonrpc":"2.0","id":"\\ud83d","method":"ping"}',
  "lone low surrogate escape": '{"jsonrpc":"2.0","id":"\\ude00","method":"ping"}',
  "valid surrogate pair escape": '{"jsonrpc":"2.0","id":"\\ud83d\\ude00","method":"ping"}',
  "escaped slash and controls": '{"jsonrpc":"2.0","id":"\\/\\b\\f\\n\\r\\t\\u0000\\u001f\\u007f\\u2028","method":"ping"}',
  "nonascii id": '{"jsonrpc":"2.0","id":"héllo 模板 😀 \u2028 \u007f","method":"ping"}',
  "empty key": '{"":1,"jsonrpc":"2.0","id":1,"method":"ping"}',
  "unterminated string": '{"jsonrpc":"2.0","id":"abc,"method":"ping"}',
  "unterminated object": '{"jsonrpc":"2.0","id":1,"method":"ping"',
  "unterminated array": "[1,2",
  "only colon": ":",
  "only brace": "{",
  "bare word": "ping",
  "true": "true",
  "false": "false",
  "null": "null",
  "number": "42",
  "string": '"x"',
  "empty array": "[]",
  "batch of requests": '[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","id":2,"method":"ping"}]',
  "empty object": "{}",
  "deep nesting 500": `{"jsonrpc":"2.0","id":1,"method":"ping","x":${"[".repeat(500)}${"]".repeat(500)}}`,
  "deep nesting 5000": `{"jsonrpc":"2.0","id":1,"method":"ping","x":${"[".repeat(5000)}${"]".repeat(5000)}}`,
  "deep nesting 100000": `${"[".repeat(100000)}${"]".repeat(100000)}`,
  "error col/line": '{"a":\n1,}',
  "error at unicode": '{"é":}',
  "error 1e999999": '{"x":1e999999999999,"id":1,"method":"ping"}',
  "huge exponent int": `{"jsonrpc":"2.0","id":${"9".repeat(5000)},"method":"ping"}`,
  "huge int over 4300 digits": `{"jsonrpc":"2.0","id":${"9".repeat(4301)},"method":"ping"}`,
})) {
  add(`json ${n}`, [{ send: `${l}\n` }, { wait: 300 }, { send: rpc("after", "ping") }, { wait: 200 }]);
}

// ---- JSON-RPC shapes ----------------------------------------------------------------------------------------------
for (const [n, obj] of Object.entries({
  "id null": { jsonrpc: "2.0", id: null, method: "ping" },
  "id false": { jsonrpc: "2.0", id: false, method: "ping" },
  "id true": { jsonrpc: "2.0", id: true, method: "ping" },
  "id zero": { jsonrpc: "2.0", id: 0, method: "ping" },
  "id empty string": { jsonrpc: "2.0", id: "", method: "ping" },
  "id array": { jsonrpc: "2.0", id: [1, "a", null], method: "ping" },
  "id object": { jsonrpc: "2.0", id: { b: 2, a: 1 }, method: "ping" },
  "id nested key order": { jsonrpc: "2.0", id: { "10": 1, "2": 2, a: 3, "1": 4 }, method: "ping" },
  "id missing": { jsonrpc: "2.0", method: "ping" },
  "no jsonrpc field": { id: 1, method: "ping" },
  "jsonrpc 1.0": { jsonrpc: "1.0", id: 1, method: "ping" },
  "method missing": { jsonrpc: "2.0", id: 1 },
  "method null": { jsonrpc: "2.0", id: 1, method: null },
  "method number": { jsonrpc: "2.0", id: 1, method: 5 },
  "method true": { jsonrpc: "2.0", id: 1, method: true },
  "method list": { jsonrpc: "2.0", id: 1, method: ["ping"] },
  "method dict": { jsonrpc: "2.0", id: 1, method: { a: 1 } },
  "method empty": { jsonrpc: "2.0", id: 1, method: "" },
  "method case": { jsonrpc: "2.0", id: 1, method: "PING" },
  "method trailing space": { jsonrpc: "2.0", id: 1, method: "ping " },
  "method unicode": { jsonrpc: "2.0", id: 1, method: "模板/😀" },
  "method long": { jsonrpc: "2.0", id: 1, method: "m".repeat(5000) },
  "method notifications/initialized with id": { jsonrpc: "2.0", id: 1, method: "notifications/initialized" },
  "method notifications/cancelled": { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } },
  "method initialize no params": { jsonrpc: "2.0", id: 1, method: "initialize" },
  "method initialize params null": { jsonrpc: "2.0", id: 1, method: "initialize", params: null },
  "method initialize params list": { jsonrpc: "2.0", id: 1, method: "initialize", params: [] },
  "method initialize params string": { jsonrpc: "2.0", id: 1, method: "initialize", params: "x" },
  "method initialize params 0": { jsonrpc: "2.0", id: 1, method: "initialize", params: 0 },
  "method initialize params false": { jsonrpc: "2.0", id: 1, method: "initialize", params: false },
  "method initialize params list notification": { jsonrpc: "2.0", method: "initialize", params: [] },
  "initialize 2025-06-18": { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
  "initialize 2024-11-05": { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
  "initialize unknown version": { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } },
  "initialize version number": { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 20241105 } },
  "initialize version null": { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: null } },
  "initialize version list": { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: ["2024-11-05"] } },
  "initialize version dict": { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: {} } },
  "initialize version case": { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05 " } },
  "initialize as notification": { jsonrpc: "2.0", method: "initialize", params: { protocolVersion: "2024-11-05" } },
  "tools/list with params": { jsonrpc: "2.0", id: 1, method: "tools/list", params: { cursor: "x" } },
  "ping with params list": { jsonrpc: "2.0", id: 1, method: "ping", params: [1] },
  "ping params string notification": { jsonrpc: "2.0", method: "ping", params: "x" },
  "ping extra fields": { jsonrpc: "2.0", id: 1, method: "ping", result: 1, error: 2, junk: [1, 2] },
  "tools/call no params": { jsonrpc: "2.0", id: 1, method: "tools/call" },
  "tools/call params list": { jsonrpc: "2.0", id: 1, method: "tools/call", params: [] },
  "tools/call empty params": { jsonrpc: "2.0", id: 1, method: "tools/call", params: {} },
  "tools/call name null": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: null } },
  "tools/call name number": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: 5 } },
  "tools/call name float": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: 1.5 } },
  "tools/call name true": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: true } },
  "tools/call name list": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: ["run_code"] } },
  "tools/call name dict": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: { a: 1 } } },
  "tools/call name empty": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "" } },
  "tools/call name unicode": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "工具 😀 \u2028" } },
  "tools/call args list": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "run_code", arguments: [1] } },
  "tools/call args string": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "run_code", arguments: "x" } },
  "tools/call args 0": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "run_code", arguments: 0 } },
  "tools/call args empty list": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "run_code", arguments: [] } },
  "tools/call args null": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "run_code", arguments: null } },
  "tools/call args false": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "run_code", arguments: false } },
  "tools/call unknown tool": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "nope", arguments: {} } },
  "tools/call run_code bad types": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "run_code", arguments: { code: 5 } } },
  "tools/call run_code language bad": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "run_code", arguments: { code: "1", language: "cobol" } } },
  "tools/call run_command empty": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "run_command", arguments: { command: "" } } },
  "tools/call run_command list": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "run_command", arguments: { command: ["ls"] } } },
  "tools/call run_command timeout str": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "run_command", arguments: { command: "ls", timeout: "abc" } } },
  "tools/call run_command timeout neg": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "run_command", arguments: { command: "ls", timeout: -5 } } },
  "tools/call read_file no path": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_file", arguments: {} } },
  "tools/call write_file content num": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "write_file", arguments: { path: "/a", content: 5 } } },
  "tools/call kill_sandbox none": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "kill_sandbox", arguments: {} } },
  "tools/call kill_sandbox id list": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "kill_sandbox", arguments: { sandbox_id: ["x"] } } },
  "tools/call create_sandbox envs bad": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_sandbox", arguments: { envs: [1] } } },
  "tools/call create_sandbox timeout bad": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_sandbox", arguments: { timeout: "x" } } },
  "tools/call create_sandbox timeout float": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_sandbox", arguments: { timeout: 30.5 } } },
  "tools/call create_sandbox timeout bool": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_sandbox", arguments: { timeout: true } } },
  "tools/call create_sandbox timeout huge": { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_sandbox", arguments: { timeout: 99999999999 } } },
})) {
  add(`rpc ${n}`, [{ send: `${JSON.stringify(obj)}\n` }, { wait: 400 }, { send: rpc("after", "ping") }, { wait: 200 }]);
}
add("rpc 1.0 literal timeouts", [{ send: '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_sandbox","arguments":{"timeout":30.0}}}\n' }, { wait: 800 }]);
add("tool call then immediate eof (validation error)", [{ send: call(1, "create_sandbox", { timeout: "x" }) }]);

// ---- lifecycle against the stub -----------------------------------------------------------------------------------
add("create then eof kills sandbox", [{ send: call(1, "create_sandbox", {}) }, { wait: 800 }]);
add("create then sigterm kills sandbox", [{ send: call(1, "create_sandbox", {}) }, { wait: 800 }, { signal: "SIGTERM" }, { wait: 600 }], { cli: true });
add("create then sigint kills sandbox", [{ send: call(1, "create_sandbox", {}) }, { wait: 800 }, { signal: "SIGINT" }, { wait: 600 }], { cli: true });
add("sigterm idle", [{ send: INIT }, { wait: 500 }, { signal: "SIGTERM" }, { wait: 500 }], { cli: true });
add("sigint idle", [{ send: INIT }, { wait: 500 }, { signal: "SIGINT" }, { wait: 500 }], { cli: true });
add("sighup idle", [{ send: INIT }, { wait: 500 }, { signal: "SIGHUP" }, { wait: 500 }], { cli: true });
add("sigpipe idle", [{ send: INIT }, { wait: 500 }, { signal: "SIGPIPE" }, { wait: 500 }, { send: rpc(2, "ping") }], { cli: true });
add("double sigterm", [{ send: INIT }, { wait: 500 }, { signal: "SIGTERM" }, { signal: "SIGTERM" }, { wait: 500 }], { cli: true });
add("sigterm during hung tool call", [{ send: call(1, "run_command", { command: "sleep 30" }) }, { wait: 800 }, { signal: "SIGTERM" }, { wait: 800 }], { cli: true, world: { hangProcessStart: true } });
add("eof during hung tool call", [{ send: call(1, "run_command", { command: "sleep 30" }) }, { wait: 800 }], { world: { hangProcessStart: true } });
add("ping answered while tool hangs", [{ send: call(1, "run_command", { command: "sleep 30" }) }, { wait: 500 }, { send: rpc(2, "ping") }, { wait: 500 }], { world: { hangProcessStart: true }, killAfterMs: 2500 });
add("tool calls serialized", [{ send: call(1, "run_command", { command: "echo one" }) + call(2, "run_command", { command: "echo two" }) + call(3, "read_file", { path: "/app/result.csv" }) }, { wait: 1500 }]);
add("default sandbox reuse then kill", [{ send: call(1, "run_command", { command: "echo a" }) }, { wait: 800 }, { send: call(2, "run_command", { command: "echo b" }) }, { wait: 600 }, { send: call(3, "kill_sandbox", {}) }, { wait: 600 }, { send: call(4, "kill_sandbox", {}) }, { wait: 600 }]);
add("explicit sandbox id connect", [{ send: call(1, "run_command", { command: "echo a", sandbox_id: "sbx-ev-001" }) }, { wait: 1000 }, { send: call(2, "kill_sandbox", { sandbox_id: "sbx-ev-001" }) }, { wait: 600 }]);
add("explicit missing sandbox id", [{ send: call(1, "run_command", { command: "echo a", sandbox_id: "sbx-nope" }) }, { wait: 1000 }]);
add("kill by id unknown", [{ send: call(1, "kill_sandbox", { sandbox_id: "sbx-nope" }) }, { wait: 800 }]);
add("sandbox id weird chars", [{ send: call(1, "run_command", { command: "echo a", sandbox_id: "../x?y=1#z" }) }, { wait: 800 }, { send: call(2, "kill_sandbox", { sandbox_id: "a b/c" }) }, { wait: 600 }]);
add("write_file unicode + binary-ish", [{ send: call(1, "write_file", { path: "/home/user/ü😀.txt", content: "模板\u0000\u2028x" }) }, { wait: 1200 }]);
add("run_code python", [{ send: call(1, "run_code", { code: "print(1)" }) }, { wait: 2500 }]);
add("run_code with envs", [{ send: call(1, "create_sandbox", { envs: { A: "1", B: "模板" }, template: "t2", timeout: 60 }) }, { wait: 1000 }]);
add("list_files", [{ send: call(1, "list_files", { path: "/home/user" }) }, { wait: 1200 }]);
add("list_files missing", [{ send: call(1, "list_files", { path: "/nope" }) }, { wait: 1200 }]);
add("read_file missing", [{ send: call(1, "read_file", { path: "/nope" }) }, { wait: 1200 }]);
add("read_file ok", [{ send: call(1, "read_file", { path: "/app/result.csv" }) }, { wait: 1200 }]);

// ---- size limits --------------------------------------------------------------------------------------------------
const bigObj = (n) => `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", pad: "x".repeat(n) })}\n`;
add("line just under 8MiB", [{ send: bigObj(8 * 1024 * 1024 - 100) }, { send: rpc(2, "ping") }]);
add("line over 8MiB", [{ send: bigObj(8 * 1024 * 1024 + 10) }, { wait: 400 }, { send: rpc(2, "ping") }]);
add("line over 8MiB no newline then eof", [{ send: Buffer.alloc(8 * 1024 * 1024 + 10, 120) }]);
add("two overlong lines", [{ send: bigObj(8 * 1024 * 1024 + 10) }, { wait: 400 }, { send: bigObj(8 * 1024 * 1024 + 10) }, { wait: 400 }, { send: rpc(2, "ping") }]);
add("1MiB write_file", [{ send: call(1, "write_file", { path: "/a", content: "y".repeat(1 << 20) }) }, { wait: 1500 }]);

// ---------------------------------------------------------------------------------------------------------------------

function normalise(text, ctx) {
  let t = text.split(ctx.home).join("<home>").split(ctx.run).join("<run>");
  t = t.replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>");
  t = t.replace(/pid[ =:]+\d+/g, "pid <n>");
  t = t.replace(/\((pid) \d+/g, "($1 <n>");
  t = t.replace(/"pid": \d+/g, '"pid": <n>');
  return t;
}

async function runOne(kind, testCase) {
  const stub = await startStub();
  const home = mkdtempSync(join(tmpdir(), "abx-advmcp-"));
  const run = join(home, "run");
  mkdirSync(run, { recursive: true });
  await fetch(`${stub.url}/__world`, { method: "POST", body: JSON.stringify(testCase.world ?? {}) });
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    ABX_NO_KEYCHAIN: "1",
    ABX_MCP_RUNTIME_DIR: run,
    E2B_API_KEY: "k-stub",
    E2B_API_URL: stub.url,
    NO_PROXY: "*",
    no_proxy: "*",
    LANG: "C.UTF-8",
    PYTHONUNBUFFERED: "1",
    SANDBOX_TEMPLATE: "t",
  };
  let cmd;
  let args;
  let cwd = home;
  if (testCase.cli) {
    if (kind === "py") [cmd, args] = [join(ORACLE_VENV, "bin", "abx"), ["mcp", "start"]];
    else [cmd, args] = [process.execPath, ["--import", TSX, join(CLI_ROOT, "src/bin/abx.ts"), "mcp", "start"]];
  } else if (kind === "py") [cmd, args] = [join(ORACLE_VENV, "bin", "python"), ["-m", "agent_sandbox.agent.mcp"]];
  else {
    [cmd, args] = [process.execPath, ["--import", TSX, join(CLI_ROOT, "src/agent/mcp_main.ts")]];
    cwd = CLI_ROOT;
  }
  const proc = spawn(cmd, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  const out = [];
  const err = [];
  proc.stdout.on("data", (d) => out.push(d));
  proc.stderr.on("data", (d) => err.push(d));
  const exited = new Promise((r) => proc.on("exit", (code, sig) => r(sig ? `signal:${sig}` : `code:${code}`)));
  proc.stdin.on("error", () => {});
  proc.stdin.write(call("ready", "create_sandbox", { timeout: "warm-up" }));
  for (let i = 0; i < 300 && Buffer.concat(out).length === 0; i += 1) await sleep(100);
  const readyBytes = Buffer.concat(out).length;
  for (const step of testCase.steps) {
    if (step.wait) await sleep(step.wait);
    if (step.send !== undefined) proc.stdin.write(step.send);
    if (step.signal) proc.kill(step.signal);
  }
  const hasSignal = testCase.steps.some((s) => s.signal);
  if (!hasSignal && !testCase.killAfterMs) proc.stdin.end();
  const status = await Promise.race([exited, sleep(testCase.killAfterMs ?? 20000).then(() => "timeout")]);
  let finalStatus = status;
  if (status === "timeout") {
    proc.kill("SIGKILL");
    finalStatus = `timeout(${testCase.killAfterMs ? "expected" : "UNEXPECTED"})`;
    await exited;
  }
  await sleep(150);
  const log = await (await fetch(`${stub.url}/__log`)).json();
  let state = [];
  try {
    state = readdirSync(run).map((n) => `${n}:${readFileSync(join(run, n), "utf8").replace(/\s+/g, " ").slice(0, 120)}`);
  } catch {
    /* none */
  }
  await stub.close();
  const ctx = { home, run };
  rmSync(home, { recursive: true, force: true });
  return {
    status: finalStatus,
    stdout: normalise(Buffer.concat(out).subarray(readyBytes).toString("utf8"), ctx),
    stderr: normalise(Buffer.concat(err).toString("utf8"), ctx)
      .split("\n")
      .filter((l) => !/^(DEBUG|INFO|WARNING):?/.test(l) && !/^\s+at |^Traceback|^\s+File |^\w*Error: /.test(l))
      .join("\n")
      .replace(/(^|\n)(ERROR|\s+\w*create_sandbox failed)[\s\S]*$/, "$1<error log trimmed>"),
    log: log.map((e) => JSON.stringify(e)).join("\n").replace(/_abx_code_[0-9a-f]{32}/g, "_abx_code_<uuid>"),
    state: state.map((s) => normalise(s, ctx)),
  };
}

const selected = cases.filter((c) => !only || c.name.includes(only));
let diffs = 0;
const results = [];
let next = 0;
await Promise.all(
  Array.from({ length: Number(process.env.ADV_CONC ?? 4) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= selected.length) return;
      const c = selected[i];
      const [py, node] = [await runOne("py", c), await runOne("node", c)];
      results[i] = { py, node };
    }
  }),
);
selected.forEach((c, i) => {
  const { py, node } = results[i];
  const problems = [];
  for (const k of ["status", "stdout", "log"]) if (py[k] !== node[k]) problems.push(`${k}:\n    py:   ${JSON.stringify(py[k]).slice(-Number(process.env.ADV_TAIL ?? 700))}\n    node: ${JSON.stringify(node[k]).slice(-Number(process.env.ADV_TAIL ?? 700))}`);
  if (c.cli && py.stderr !== node.stderr) problems.push(`stderr:\n    py:   ${JSON.stringify(py.stderr).slice(-Number(process.env.ADV_TAIL ?? 700))}\n    node: ${JSON.stringify(node.stderr).slice(-Number(process.env.ADV_TAIL ?? 700))}`);
  if (JSON.stringify(py.state) !== JSON.stringify(node.state)) problems.push(`state:\n    py: ${JSON.stringify(py.state)}\n    node: ${JSON.stringify(node.state)}`);
  if (problems.length) {
    diffs += 1;
    console.log(`DIFF ${c.name}\n  ${problems.join("\n  ")}`);
  } else if (verbose) console.log(`ok   ${c.name} ${py.status} out=${JSON.stringify(py.stdout.slice(0, 100))}`);
});
console.log(`adv_agent_template_mcp_stdio: ${diffs === 0 ? "IDENTICAL" : "DIFFERENCES"}: ${diffs} differing case(s) of ${selected.length}`);
process.exit(diffs === 0 ? 0 : 1);
