#!/usr/bin/env node
/**
 * Differential fuzz of MCP *tool-error* text: the original Python stdio server (`python -m agent_sandbox.agent.mcp`)
 * versus the Node one (`src/agent/mcp_main.ts`), driven with the same malformed / unauthorized / missing-sandbox /
 * unreachable-platform tool calls against local stub platform servers. No real credentials or network are used.
 *
 *   ORACLE_VENV=/path/to/venv-for-original-abx node parity/diff/mcp_toolerr.mjs [--verbose] [--only <mode>]
 *
 * For every stub mode and every tool call, both servers must answer with byte-identical JSON-RPC lines (after
 * normalising the stub port) and must send the stub the same HTTP requests (method, path, body, auth headers).
 * Exit code 0 = identical, 1 = differences, 2 = oracle missing.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORACLE_VENV = process.env.ORACLE_VENV;
const verbose = process.argv.includes("--verbose");
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

if (!ORACLE_VENV || !existsSync(join(ORACLE_VENV, "bin", "python"))) {
  console.error("ORACLE_VENV must point to a venv with the original agent-sandbox installed (see docs/PORTING.md).");
  process.exit(2);
}

const SANDBOX_JSON = {
  sandboxID: "sbx-stub",
  templateID: "t",
  clientID: "c",
  state: "running",
  startedAt: "2026-01-01T00:00:00Z",
  endAt: "2026-01-01T01:00:00Z",
};

/** Stub platform behaviours: [status, content-type, body] per request, or "reset" to drop the socket. */
const MODES = {
  "401-json": () => [401, "application/json", '{"message":"Invalid API key"}'],
  "401-code": () => [401, "application/json", '{"code":401,"message":"unauthorized"}'],
  "403-json": () => [403, "application/json", '{"message":"forbidden"}'],
  "404-json": () => [404, "application/json", '{"message":"sandbox not found"}'],
  "404-empty": () => [404, "text/plain", ""],
  "409-json": () => [409, "application/json", '{"message":"conflict"}'],
  "422-json": () => [422, "application/json", '{"message":"bad template","detail":[{"loc":["body"],"msg":"x"}]}'],
  "429-json": () => [429, "application/json", '{"message":"Quota exceeded"}'],
  "500-json": () => [500, "application/json", '{"message":"unavailable"}'],
  "500-text": () => [500, "text/plain", "boom"],
  "502-html": () => [502, "text/html", "<html>bad gateway</html>"],
  "200-garbage": () => [200, "application/json", "not json at all"],
  "200-empty": () => [200, "application/json", ""],
  "200-array": () => [200, "application/json", "[]"],
  "200-null": () => [200, "application/json", "null"],
  "200-wrong-shape": () => [200, "application/json", '{"sandboxID":123}'],
  "200-sandbox": (req) =>
    req.method === "POST" && req.url.startsWith("/sandboxes")
      ? [200, "application/json", JSON.stringify(SANDBOX_JSON)]
      : [404, "application/json", '{"message":"sandbox not found"}'],
  reset: () => "reset",
  unreachable: null,
};

/** `envd-<mode>`: the platform creates/looks up sandboxes normally and points `envdUrl` at this stub, which then answers every envd call like `<mode>`. */
for (const sub of ["401-json", "404-json", "500-json", "500-text", "502-html", "200-garbage", "200-empty", "200-array", "200-null", "429-json", "reset"]) {
  MODES[`envd-${sub}`] = Object.assign(
    (req, ctx) => {
      if (req.url.startsWith("/sandboxes")) {
        const body = JSON.stringify({ ...SANDBOX_JSON, envdUrl: `http://127.0.0.1:${ctx.port}`, envdAccessToken: "tok" });
        return req.method === "DELETE" ? [204, "application/json", ""] : [200, "application/json", body];
      }
      return MODES[sub](req, ctx);
    },
    { wrapsEnvd: true },
  );
}

for (const [name, bytes] of Object.entries({
  "binary-ff": Buffer.from([0xff, 0xfe, 0x41]),
  "binary-trunc": Buffer.from([0x61, 0xe2, 0x82]),
  "binary-cont": Buffer.from([0x61, 0xf0, 0x9f, 0x98, 0x78]),
  "binary-surrogate": Buffer.from([0xed, 0xa0, 0x80]),
  "text-ok": Buffer.from("héllo \u{1f600}\n", "utf8"),
})) {
  MODES[`envd-${name}`] = (req, ctx) => {
    if (req.url.startsWith("/sandboxes")) {
      const body = JSON.stringify({ ...SANDBOX_JSON, envdUrl: `http://127.0.0.1:${ctx.port}`, envdAccessToken: "tok" });
      return req.method === "DELETE" ? [204, "application/json", ""] : [200, "application/json", body];
    }
    return [200, "application/octet-stream", bytes];
  };
}

const DNS_FAILURE_URL = "http://nonexistent.invalid:1";

const TOOL_CALLS = [
  // valid arguments (the error text depends on the stub)
  ["create_sandbox", {}],
  ["create_sandbox", { template: "x", timeout: 5, envs: { A: "1" } }],
  ["run_code", { code: "print(1)" }],
  ["run_code", { code: "print(1)", sandbox_id: "sbx-missing" }],
  ["run_command", { command: "ls", sandbox_id: "sbx-missing", cwd: "/tmp", timeout: 3 }],
  ["read_file", { path: "/a", sandbox_id: "sbx-missing" }],
  ["write_file", { path: "/a", content: "x", sandbox_id: "sbx-missing" }],
  ["list_files", { sandbox_id: "sbx-missing" }],
  ["kill_sandbox", { sandbox_id: "sbx-missing" }],
  ["kill_sandbox", {}],
  ["run_code", { code: "print(1)" }],
  ["run_command", { command: "ls" }],
  ["read_file", { path: "/a" }],
  ["list_files", {}],
  ["kill_sandbox", {}],
  // malformed arguments
  ["run_code", {}],
  ["run_code", { code: 123 }],
  ["run_code", { code: null }],
  ["run_code", { code: "x", language: "cobol" }],
  ["run_code", { code: "x", language: 5 }],
  ["run_code", { code: "x", timeout: "soon" }],
  ["run_code", { code: "x", timeout: -1 }],
  ["run_code", { code: "x", timeout: 0 }],
  ["run_code", { code: "x", timeout: 1.5 }],
  ["run_code", { code: "x", timeout: null }],
  ["run_code", { code: "x", timeout: [1] }],
  ["run_code", { code: "x", timeout: {} }],
  ["run_code", { code: "x", timeout: true }],
  ["run_code", { code: "x", timeout: "1e1" }],
  ["run_command", { command: "ls", timeout: null }],
  ["run_command", { command: "ls", timeout: [] }],
  ["run_command", { command: "ls", timeout: false }],
  ["run_command", { command: "ls", timeout: " 7 " }],
  ["run_code", { code: "x", sandbox_id: 7 }],
  ["run_code", { code: "x", sandbox_id: "" }],
  ["run_command", {}],
  ["run_command", { command: ["ls"] }],
  ["run_command", { command: "ls", timeout: "x" }],
  ["run_command", { command: "ls", cwd: 5 }],
  ["read_file", {}],
  ["read_file", { path: 1 }],
  ["read_file", { path: "/a", encoding: "no-such-codec" }],
  ["read_file", { path: "/a", encoding: 1 }],
  ["read_file", { path: "/a", encoding: null }],
  ["read_file", { path: "/a", encoding: "ascii" }],
  ["read_file", { path: "/a", encoding: "UTF8" }],
  ["read_file", { path: "/a", encoding: "latin-1" }],
  ["read_file", { path: "/a", encoding: "" }],
  ["write_file", { path: "/a" }],
  ["write_file", { content: "x" }],
  ["write_file", { path: "/a", content: 5 }],
  ["write_file", { path: "/a", content: 5.5 }],
  ["write_file", { path: "/a", content: null }],
  ["write_file", { path: "/a", content: true }],
  ["write_file", { path: "/a", content: ["x"] }],
  ["write_file", { path: "/a", content: { a: 1 } }],
  ["write_file", { path: "/a", content: "" }],
  ["write_file", { path: 5, content: "x" }],
  ["write_file", { path: null, content: "x" }],
  ["read_file", { path: null }],
  ["read_file", { path: ["a"] }],
  ["list_files", { path: null }],
  ["list_files", { path: { a: 1 } }],
  ["run_command", { command: null }],
  ["run_command", { command: 5 }],
  ["run_command", { command: "" }],
  ["run_code", { code: "" }],
  ["run_code", { code: "x", language: null }],
  ["list_files", { path: 5 }],
  ["list_files", { path: "" }],
  ["kill_sandbox", { sandbox_id: 5 }],
  ["create_sandbox", { timeout: "x" }],
  ["create_sandbox", { timeout: -5 }],
  ["create_sandbox", { envs: [] }],
  ["create_sandbox", { envs: { A: 1 } }],
  ["create_sandbox", { template: 5 }],
  ["create_sandbox", { unknown_extra: 1 }],
  ["run_code", { code: "x", unknown_extra: 1 }],
  // malformed envelopes
  ["no_such_tool", {}],
  ["", {}],
  ["RUN_CODE", { code: "x" }],
  ["__proto__", {}],
  ["constructor", {}],
  ["toString", {}],
  ["run_code", null],
  ["run_code", []],
  ["run_code", "str"],
  ["run_code", 5],
  [5, {}],
  [null, {}],
  [["run_code"], {}],
];

const RAW_CALLS = [
  { jsonrpc: "2.0", method: "tools/call", params: {} },
  { jsonrpc: "2.0", method: "tools/call" },
  { jsonrpc: "2.0", method: "tools/call", params: [] },
  { jsonrpc: "2.0", method: "tools/call", params: "x" },
  { jsonrpc: "2.0", method: "tools/call", params: { arguments: { code: "x" } } },
];

/**
 * Raw request lines (sent verbatim, so JSON number spellings survive): Python keeps `2.0` a float and big ints exact, and
 * `json.dumps` echoes them back (`id`, tool arguments that end up in error text / request bodies); dict keys keep
 * insertion order even when they look like integers.
 */
const call = (id, name, args) => `{"jsonrpc":"2.0","id":${id},"method":"tools/call","params":{"name":"${name}","arguments":${args}}}`;
const RAW_LINES = [
  '{"jsonrpc":"2.0","id":1.0,"method":"tools/list"}',
  '{"jsonrpc":"2.0","id":1e400,"method":"tools/list"}',
  '{"jsonrpc":"2.0","id":-0.0,"method":"tools/list"}',
  '{"jsonrpc":"2.0","id":-0,"method":"tools/list"}',
  '{"jsonrpc":"2.0","id":1E2,"method":"tools/list"}',
  '{"jsonrpc":"2.0","id":12345678901234567890,"method":"tools/list"}',
  '{"jsonrpc":"2.0","id":123456789012345678901234567890,"method":"tools/list"}',
  '{"jsonrpc":"2.0","id":0.1,"method":"tools/list"}',
  '{"jsonrpc":"2.0","id":1e16,"method":"tools/list"}',
  '{"jsonrpc":"2.0","id":123456789.123456789,"method":"tools/list"}',
  '{"jsonrpc":"2.0","id":NaN,"method":"tools/list"}',
  '{"jsonrpc":"2.0","id":[1.0,2,3.5,{"k":4.0}],"method":"tools/list"}',
  '{"jsonrpc":"2.0","id":{"2":1,"1":2.0,"b":3,"0":4},"method":"tools/list"}',
  '{"jsonrpc":"2.0","id":{"10":1,"9":2,"a":3,"1":{"3":1,"2":2}},"method":"initialize","params":{}}',
  '{"jsonrpc":"2.0","id":{"1":1,"1":2},"method":"tools/list"}',
  '{"jsonrpc":"2.0","id":4294967295,"method":"ping"}',
  '{"jsonrpc":"2.0","id":{"4294967295":1,"4294967294":2},"method":"ping"}',
  '{"jsonrpc":"2.0","id":2.0,"method":"no/such"}',
  call("1.0", "create_sandbox", "{}"),
  call("2.0", "create_sandbox", '{"timeout":30.0}'),
  call("3.0", "create_sandbox", '{"timeout":1e2,"envs":{"2":"a","1":"b","z":"c","0":"d"}}'),
  call("4.0", "create_sandbox", '{"timeout":12345678901234567890}'),
  call("5.0", "create_sandbox", '{"timeout":-0.0}'),
  call("6.0", "create_sandbox", '{"envs":{"B":2.0,"A":1}}'),
  call("7.0", "run_code", '{"code":"x","timeout":30.0}'),
  call("8.0", "run_code", '{"code":"x","timeout":30.0,"sandbox_id":"sbx-missing"}'),
  call("9.0", "run_code", '{"code":"x","timeout":0.5,"sandbox_id":"sbx-missing"}'),
  call("10.0", "run_code", '{"code":2.0}'),
  call("11.0", "run_code", '{"code":"x","language":1.0}'),
  call("12.0", "run_command", '{"command":"ls","timeout":7.0,"sandbox_id":"sbx-missing","cwd":"/"}'),
  call("13.0", "run_command", '{"command":"ls","timeout":1e1,"cwd":0.0}'),
  call("14.0", "run_command", '{"command":1e3}'),
  call("15.0", "read_file", '{"path":1.0}'),
  call("16.0", "read_file", '{"path":"/a","sandbox_id":5.0}'),
  call("17.0", "write_file", '{"path":"/a","content":5.0}'),
  call("18.0", "write_file", '{"path":"/a","content":12345678901234567890}'),
  call("19.0", "write_file", '{"path":"/a","content":1e400}'),
  call("20.0", "list_files", '{"path":0.0}'),
  call("21.0", "list_files", '{"path":2.0}'),
  call("22.0", "kill_sandbox", '{"sandbox_id":5.0}'),
  call("23.0", "kill_sandbox", '{"sandbox_id":0.0}'),
  call("24.0", "create_sandbox", '{"envs":{"2":"a","1":"b"},"template":"t"}'),
  call("25.0", "create_sandbox", '{"envs":1.0}'),
  call("26.5", "create_sandbox", '{"envs":0.0,"timeout":1.5}'),
  '{"jsonrpc":"2.0","id":27.0,"method":"tools/call","params":{"name":"run_code","arguments":2.0}}',
  '{"jsonrpc":"2.0","id":28.0,"method":"tools/call","params":{"name":1.0,"arguments":{}}}',
  '{"jsonrpc":"2.0","id":29.0,"method":"tools/call","params":1.0}',
  '{"jsonrpc":"2.0","id":30.0,"method":1.0}',
  '{"jsonrpc":"2.0","id":31.0,"method":"tools/call","params":{"name":"run_code","arguments":{"code":"x","timeout":30.0},"_meta":{"progressToken":1.0}}}',
];

function requestFor(id, name, args) {
  const params = { name };
  if (args !== undefined) params.arguments = args;
  return { jsonrpc: "2.0", id, method: "tools/call", params };
}

function startStub(mode) {
  const log = [];
  const handler = MODES[mode];
  const ctx = { port: 0 };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const h = req.headers;
      log.push({
        method: req.method,
        path: req.url,
        body,
        "x-api-key": h["x-api-key"] ?? null,
        authorization: h.authorization ?? null,
        "content-type": h["content-type"] ?? null,
      });
      const out = handler(req, ctx);
      if (out === "reset") {
        req.socket.destroy();
        return;
      }
      const [status, type, text] = out;
      res.writeHead(status, { "Content-Type": type, "Content-Length": Buffer.byteLength(text) });
      res.end(text);
    });
  });
  return new Promise((ok) =>
    server.listen(0, "127.0.0.1", () => {
      ctx.port = server.address().port;
      ok({ server, log, port: ctx.port });
    }),
  );
}

function closedPort() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

function startServer(kind, url, home) {
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    ABX_NO_KEYCHAIN: "1",
    E2B_API_KEY: "stub-key",
    E2B_API_URL: url,
    SANDBOX_TEMPLATE: "stub-template",
    NO_PROXY: "*",
    no_proxy: "*",
  };
  const [cmd, args, cwd] =
    kind === "py"
      ? [join(ORACLE_VENV, "bin", "python"), ["-m", "agent_sandbox.agent.mcp"], home]
      : [process.execPath, ["--import", "tsx", join(CLI_ROOT, "src", "agent", "mcp_main.ts")], CLI_ROOT];
  const proc = spawn(cmd, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "";
  const waiters = [];
  proc.stdout.on("data", (d) => {
    buffer += d.toString("utf8");
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      const w = waiters.shift();
      if (w) w(line);
    }
  });
  proc.stderr.resume();
  const readLine = () =>
    new Promise((ok) => {
      const timer = setTimeout(() => ok("<timeout>"), 45_000);
      waiters.push((l) => {
        clearTimeout(timer);
        ok(l);
      });
    });
  return {
    async call(message) {
      proc.stdin.write((typeof message === "string" ? message : JSON.stringify(message)) + "\n");
      return readLine();
    },
    async close() {
      proc.stdin.end();
      await new Promise((ok) => {
        const t = setTimeout(() => (proc.kill("SIGKILL"), ok()), 15_000);
        proc.on("exit", () => (clearTimeout(t), ok()));
      });
    },
  };
}

async function drive(kind, url, home) {
  const srv = startServer(kind, url, home);
  await new Promise((r) => setTimeout(r, 1500));
  const lines = [];
  let id = 0;
  for (const [name, args] of TOOL_CALLS) lines.push(await srv.call(requestFor(++id, name, args)));
  for (const raw of RAW_CALLS) lines.push(await srv.call({ ...raw, id: ++id }));
  for (const text of RAW_LINES) lines.push(await srv.call(text));
  await srv.close();
  return lines;
}

function normalise(text, port) {
  return text
    .replace(/[0-9a-f]{32}/g, "<boundary>")
    .split(`127.0.0.1:${port}`).join("127.0.0.1:<port>").replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>");
}

const labels = [...TOOL_CALLS.map(([n, a]) => `${JSON.stringify(n)} ${JSON.stringify(a)}`), ...RAW_CALLS.map((r) => JSON.stringify(r)), ...RAW_LINES];

let total = 0;
let diffs = 0;
const home = mkdtempSync(join(tmpdir(), "abx-toolerr-"));
const modes = [...Object.keys(MODES), "dns"].filter((m) => !only || m === only);

try {
  for (const mode of modes) {
    const results = {};
    for (const kind of ["py", "node"]) {
      let stub = null;
      let url;
      if (mode === "unreachable") url = `http://127.0.0.1:${await closedPort()}`;
      else if (mode === "dns") url = DNS_FAILURE_URL;
      else {
        stub = await startStub(mode);
        url = `http://127.0.0.1:${stub.port}`;
      }
      const port = stub?.port ?? Number(url.split(":").pop());
      const lines = (await drive(kind, url, home)).map((l) => normalise(l, port));
      const requests = stub ? stub.log.map((r) => normalise(JSON.stringify(r), port)) : [];
      stub?.server.close();
      results[kind] = { lines, requests };
    }
    let modeDiffs = 0;
    const n = Math.max(results.py.lines.length, results.node.lines.length);
    for (let i = 0; i < n; i += 1) {
      total += 1;
      if (results.py.lines[i] === results.node.lines[i]) continue;
      modeDiffs += 1;
      if (!verbose && modeDiffs > 6) continue;
      console.log(`DIFF [${mode}] ${labels[i]}\n  py:   ${results.py.lines[i]}\n  node: ${results.node.lines[i]}`);
    }
    total += 1;
    if (JSON.stringify(results.py.requests) !== JSON.stringify(results.node.requests)) {
      modeDiffs += 1;
      console.log(`DIFF [${mode}] stub request log`);
      const m = Math.max(results.py.requests.length, results.node.requests.length);
      for (let i = 0; i < m; i += 1) {
        if (results.py.requests[i] !== results.node.requests[i]) {
          console.log(`  #${i} py:   ${results.py.requests[i]}\n  #${i} node: ${results.node.requests[i]}`);
          break;
        }
      }
    }
    diffs += modeDiffs;
    console.log(`${modeDiffs === 0 ? "ok  " : "FAIL"} ${mode.padEnd(16)} ${results.py.lines.length} calls, ${results.py.requests.length} stub requests${modeDiffs > 6 && !verbose ? ` (${modeDiffs} diffs, first 6 shown; use --verbose)` : ""}`);
  }
} finally {
  rmSync(home, { recursive: true, force: true });
}

console.log(`${diffs === 0 ? "IDENTICAL" : "DIFFERENCES"}: ${diffs} difference(s) over ${total} comparisons`);
process.exit(diffs === 0 ? 0 : 1);
