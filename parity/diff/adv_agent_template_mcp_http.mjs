#!/usr/bin/env node
/**
 * Adversarial differential of the MCP Streamable-HTTP server: `ebx mcp start --http` of the original (Starlette/uvicorn)
 * versus the port (node:http). Requests are written to a raw TCP socket so malformed / odd requests reach the servers
 * byte-for-byte. Status line, (lower-cased) headers minus Date/Server/Connection/Keep-Alive, and body are compared, with
 * session ids and ports masked.
 *
 *   ORACLE_VENV=/path/to/venv node parity/diff/adv_agent_template_mcp_http.mjs [--only substr] [--verbose]
 *
 * Exit 0 = identical (or oracle absent -> skipped), 1 = differences.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
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
const TOKEN = "tok-123";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((res) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

/** Send raw bytes, collect until the peer closes or the line goes idle. */
function rawExchange(port, payload, { idleMs = 500, maxMs = 6000, half = false, chunks = null } = {}) {
  return new Promise((res) => {
    const sock = net.connect(port, "127.0.0.1");
    const out = [];
    let done = false;
    let idle;
    const finish = (why) => {
      if (done) return;
      done = true;
      clearTimeout(idle);
      clearTimeout(hard);
      sock.destroy();
      res({ bytes: Buffer.concat(out), why });
    };
    const hard = setTimeout(() => finish("max"), maxMs);
    const bump = () => {
      clearTimeout(idle);
      idle = setTimeout(() => finish("idle"), idleMs);
    };
    sock.on("data", (d) => {
      out.push(d);
      bump();
    });
    sock.on("close", () => finish("close"));
    sock.on("error", () => finish("error"));
    sock.on("connect", async () => {
      bump();
      if (chunks) {
        for (const c of chunks) {
          if (c.wait) await sleep(c.wait);
          if (c.data !== undefined) sock.write(c.data);
        }
      } else sock.write(payload);
      if (half) sock.end();
    });
  });
}

const DROP = new Set(["date", "server", "connection", "keep-alive"]);
function parseResponses(buf) {
  const resps = [];
  let rest = buf;
  while (rest.length) {
    const he = rest.indexOf("\r\n\r\n");
    if (he < 0) {
      resps.push({ garbage: rest.toString("latin1") });
      break;
    }
    const head = rest.subarray(0, he).toString("latin1").split("\r\n");
    const statusLine = head.shift();
    const headers = [];
    const rawNames = [];
    for (const l of head) {
      const i = l.indexOf(":");
      const name = l.slice(0, i);
      rawNames.push(name);
      headers.push([name.toLowerCase(), l.slice(i + 1).trim()]);
    }
    let body = rest.subarray(he + 4);
    const te = headers.find(([n]) => n === "transfer-encoding")?.[1];
    const cl = headers.find(([n]) => n === "content-length")?.[1];
    let consumed;
    if (te && /chunked/i.test(te)) {
      let off = 0;
      const parts = [];
      for (;;) {
        const le = body.indexOf("\r\n", off);
        if (le < 0) break;
        const n = Number.parseInt(body.subarray(off, le).toString("latin1"), 16);
        off = le + 2;
        if (n === 0) {
          off += 2;
          break;
        }
        parts.push(body.subarray(off, off + n));
        off += n + 2;
      }
      consumed = off;
      body = Buffer.concat(parts);
    } else if (cl !== undefined) {
      const n = Number(cl);
      consumed = n;
      body = body.subarray(0, n);
    } else {
      consumed = body.length;
    }
    resps.push({ statusLine, headers, rawNames, body: body.toString("utf8") });
    rest = rest.subarray(he + 4 + consumed);
  }
  return resps;
}

function normResponses(resps, ctx) {
  return resps.map((r) => {
    if (r.garbage !== undefined) return `GARBAGE ${JSON.stringify(r.garbage.slice(0, 200))}`;
    const hs = r.headers
      .filter(([n]) => !DROP.has(n))
      .map(([n, v]) => `${n}: ${v}`)
      .join("\n");
    const mask = (s) =>
      s
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<SID>")
        .replace(new RegExp(String(ctx.port), "g"), "<PORT>")
        .replace(new RegExp(String(ctx.stubPort), "g"), "<SPORT>");
    return mask(`${r.statusLine}\n${hs}\n\n${r.body}`);
  });
}

function startServer(kind, cfg) {
  return (async () => {
    const stub = await startStub();
    const home = mkdtempSync(join(tmpdir(), "ebx-advhttp-"));
    const run = join(home, "run");
    mkdirSync(run, { recursive: true });
    await fetch(`${stub.url}/__world`, { method: "POST", body: JSON.stringify(cfg.world ?? {}) });
    const port = await freePort();
    const env = {
      PATH: process.env.PATH,
      HOME: home,
      EBX_NO_KEYCHAIN: "1",
      EBX_MCP_RUNTIME_DIR: run,
      NO_PROXY: "*",
      no_proxy: "*",
      LANG: "C.UTF-8",
      PYTHONUNBUFFERED: "1",
      ...(cfg.env ?? {}),
    };
    const args = ["mcp", "start", "--http", "--port", String(port), "--api-key", "k-stub", "--api-url", stub.url, "--template", "t", ...(cfg.auth ? ["--auth-token", TOKEN] : [])];
    const [cmd, argv] = kind === "py" ? [join(ORACLE_VENV, "bin", "ebx"), args] : [process.execPath, ["--import", TSX, join(CLI_ROOT, "src/bin/ebx.ts"), ...args]];
    const proc = spawn(cmd, argv, { cwd: home, env, stdio: ["ignore", "pipe", "pipe"] });
    const errs = [];
    proc.stderr.on("data", (d) => errs.push(d));
    proc.stdout.on("data", () => {});
    const exited = new Promise((r) => proc.on("exit", (c, s) => r(s ? `signal:${s}` : `code:${c}`)));
    let up = false;
    for (let i = 0; i < 300 && !up; i += 1) {
      const r = await rawExchange(port, "GET /health HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n", { idleMs: 100, maxMs: 500 });
      up = r.bytes.length > 0;
      if (!up) await sleep(100);
    }
    return {
      port,
      stub,
      stubPort: stub.port,
      async stop() {
        proc.kill("SIGTERM");
        const st = await Promise.race([exited, sleep(10000).then(() => "timeout")]);
        if (st === "timeout") proc.kill("SIGKILL");
        await stub.close();
        rmSync(home, { recursive: true, force: true });
        return st;
      },
      stderr: () => Buffer.concat(errs).toString(),
      up,
      proc,
      exited,
      async log() {
        return (await (await fetch(`${stub.url}/__log`)).json()).map((e) => `${e.method} ${e.path}`).join("\n");
      },
      cleanup: () => stub.close().then(() => rmSync(home, { recursive: true, force: true })),
    };
  })();
}

// ---- request builders ---------------------------------------------------------------------------------------------
const j = (o) => JSON.stringify(o);
const rpc = (id, method, params) => j({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
function req(method, path, { headers = {}, body, version = "1.1", host = "127.0.0.1:1", close = true, auth = false, ct = true, cl = true } = {}) {
  const hs = [];
  if (host !== null) hs.push(["Host", host]);
  if (auth) hs.push(["Authorization", `Bearer ${TOKEN}`]);
  if (body !== undefined && ct && !("Content-Type" in headers)) hs.push(["Content-Type", "application/json"]);
  for (const [k, v] of Object.entries(headers)) if (v !== null) hs.push([k, v]);
  const b = body === undefined ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (body !== undefined && cl && !("Content-Length" in headers)) hs.push(["Content-Length", String(b.length)]);
  if (close) hs.push(["Connection", "close"]);
  return Buffer.concat([Buffer.from(`${method} ${path} HTTP/${version}\r\n${hs.map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n`, "latin1"), b]);
}

const INIT = rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "adv", version: "0" } });
const cases = [];
const add = (name, cfg, steps, opts = {}) => cases.push({ name, cfg, steps, ...opts });
/** A step: (state) => Buffer | { payload, opts } ; state.sid is the session created by the most recent init step. */
const NOAUTH = { auth: false };
const AUTH = { auth: true };
const ORIGINENV = { auth: false, env: { EBX_MCP_ALLOWED_ORIGINS: "https://ok.example" } };
const initStep = (extra = {}) => () => req("POST", "/mcp", { body: INIT, ...extra });
const withSid = (fn) => (st) => fn(st.sid ?? "no-session");

// ---- routing / methods --------------------------------------------------------------------------------------------
add("health", NOAUTH, [() => req("GET", "/health")]);
add("health HEAD", NOAUTH, [() => req("HEAD", "/health")]);
add("health POST", NOAUTH, [() => req("POST", "/health", { body: "{}" })]);
add("health trailing slash", NOAUTH, [() => req("GET", "/health/")]);
add("health query", NOAUTH, [() => req("GET", "/health?x=1")]);
add("health with auth server no token", AUTH, [() => req("GET", "/health")]);
add("mcp trailing slash POST", NOAUTH, [() => req("POST", "/mcp/", { body: INIT })]);
add("mcp trailing slash GET", NOAUTH, [() => req("GET", "/mcp/")]);
add("MCP upper-case path", NOAUTH, [() => req("POST", "/MCP", { body: INIT })]);
add("mcp query string", NOAUTH, [() => req("POST", "/mcp?x=1", { body: INIT })]);
add("mcp fragment-like", NOAUTH, [() => req("POST", "/mcp#frag", { body: INIT })]);
add("mcp percent-encoded path", NOAUTH, [() => req("POST", "/%6dcp", { body: INIT })]);
add("mcp double slash", NOAUTH, [() => req("POST", "//mcp", { body: INIT })]);
add("mcp dot segments", NOAUTH, [() => req("POST", "/x/../mcp", { body: INIT })]);
add("mcp semicolon param", NOAUTH, [() => req("POST", "/mcp;a=1", { body: INIT })]);
add("root", NOAUTH, [() => req("GET", "/")]);
add("unknown path", NOAUTH, [() => req("GET", "/nope")]);
add("unknown path POST", NOAUTH, [() => req("POST", "/nope", { body: "{}" })]);
add("absolute-form target", NOAUTH, [() => req("POST", "http://127.0.0.1:1/mcp", { body: INIT })]);
add("asterisk target OPTIONS", NOAUTH, [() => req("OPTIONS", "*")]);
add("OPTIONS /mcp", NOAUTH, [() => req("OPTIONS", "/mcp")]);
add("OPTIONS /mcp with origin (CORS preflight)", NOAUTH, [() => req("OPTIONS", "/mcp", { headers: { Origin: "http://localhost:3000", "Access-Control-Request-Method": "POST" } })]);
add("PUT /mcp", NOAUTH, [() => req("PUT", "/mcp", { body: INIT })]);
add("PATCH /mcp", NOAUTH, [() => req("PATCH", "/mcp", { body: INIT })]);
add("HEAD /mcp", NOAUTH, [() => req("HEAD", "/mcp")]);
add("lowercase method", NOAUTH, [() => req("post", "/mcp", { body: INIT })]);
add("TRACE /mcp", NOAUTH, [() => req("TRACE", "/mcp")]);
add("CONNECT", NOAUTH, [() => Buffer.from("CONNECT 127.0.0.1:1 HTTP/1.1\r\nHost: 127.0.0.1:1\r\n\r\n")]);
add("GET /mcp no auth", NOAUTH, [() => req("GET", "/mcp")]);
add("GET /mcp Accept event-stream", NOAUTH, [() => req("GET", "/mcp", { headers: { Accept: "text/event-stream" } })]);
add("GET /mcp with auth", AUTH, [() => req("GET", "/mcp", { auth: true })]);
add("GET /mcp bad auth", AUTH, [() => req("GET", "/mcp")]);
add("GET /mcp with body", NOAUTH, [() => req("GET", "/mcp", { body: INIT })]);

// ---- Origin -------------------------------------------------------------------------------------------------------
for (const [n, o] of Object.entries({
  localhost: "http://localhost:3000",
  "localhost upper": "http://LOCALHOST",
  "127.0.0.1": "http://127.0.0.1:9",
  "ipv6 loopback": "http://[::1]:5173",
  "evil": "https://evil.example",
  "evil.localhost": "http://evil.localhost",
  "localhost.evil": "http://localhost.evil.example",
  "userinfo trick": "http://localhost@evil.example",
  "userinfo trick 2": "http://evil.example@localhost",
  "null": "null",
  "empty": "",
  "space": " ",
  "bare localhost": "localhost",
  "bare localhost port": "localhost:3000",
  "file": "file://",
  "ok.example (env allowlist)": "https://ok.example",
  "ok.example trailing slash": "https://ok.example/",
  "ok.example upper": "https://OK.example",
  "ftp localhost": "ftp://localhost",
  "scheme-less //localhost": "//localhost",
  "localhost trailing dot": "http://localhost.",
  "127.0.0.1 octal-ish": "http://0177.0.0.1",
  "0.0.0.0": "http://0.0.0.0",
  "127.1": "http://127.1",
  "localhost with path": "http://localhost/x",
  "localhost bad port": "http://localhost:abc",
  "localhost huge port": "http://localhost:99999",
  "ipv6 unclosed": "http://[::1",
  "ipv6 full loopback": "http://[0:0:0:0:0:0:0:1]",
  "ipv6 mapped": "http://[::ffff:127.0.0.1]",
  "unicode": "http://lоcalhost",
  "tab in host": "http://local\thost",
  "backslash": "http:\\\\localhost",
  "javascript scheme": "javascript://localhost/%0aalert(1)",
})) {
  if (n === "tab in host") continue;
  add(`origin ${n} POST`, ORIGINENV, [() => req("POST", "/mcp", { body: INIT, headers: { Origin: o } })]);
  add(`origin ${n} GET`, ORIGINENV, [() => req("GET", "/mcp", { headers: { Origin: o } })]);
}
add("origin DELETE evil", ORIGINENV, [() => req("DELETE", "/mcp", { headers: { Origin: "https://evil.example", "Mcp-Session-Id": "x" } })]);
add("origin health evil (not checked)", ORIGINENV, [() => req("GET", "/health", { headers: { Origin: "https://evil.example" } })]);
add("origin duplicated headers", ORIGINENV, [() => Buffer.from(`POST /mcp HTTP/1.1\r\nHost: x\r\nOrigin: https://evil.example\r\nOrigin: http://localhost\r\nContent-Type: application/json\r\nContent-Length: ${INIT.length}\r\nConnection: close\r\n\r\n${INIT}`)]);
add("origin duplicated headers rev", ORIGINENV, [() => Buffer.from(`POST /mcp HTTP/1.1\r\nHost: x\r\nOrigin: http://localhost\r\nOrigin: https://evil.example\r\nContent-Type: application/json\r\nContent-Length: ${INIT.length}\r\nConnection: close\r\n\r\n${INIT}`)]);
add("origin before auth (evil + no token)", AUTH, [() => req("POST", "/mcp", { body: INIT, headers: { Origin: "https://evil.example" } })]);
add("origin ok + bad token", AUTH, [() => req("POST", "/mcp", { body: INIT, headers: { Origin: "http://localhost", Authorization: "Bearer nope" } })]);

// ---- auth ---------------------------------------------------------------------------------------------------------
for (const [n, h] of Object.entries({
  none: null,
  "correct": `Bearer ${TOKEN}`,
  "lowercase scheme": `bearer ${TOKEN}`,
  "uppercase scheme": `BEARER ${TOKEN}`,
  "basic": `Basic ${TOKEN}`,
  "no scheme": TOKEN,
  "bearer only": "Bearer",
  "bearer space only": "Bearer ",
  "bearer empty with spaces": "Bearer    ",
  "double space": `Bearer  ${TOKEN}`,
  "tab separator": `Bearer\t${TOKEN}`,
  "trailing space": `Bearer ${TOKEN} `,
  "trailing tab": `Bearer ${TOKEN}\t`,
  "wrong": "Bearer wrong",
  "prefix": `Bearer ${TOKEN.slice(0, -1)}`,
  "extended": `Bearer ${TOKEN}x`,
  "case differs": `Bearer ${TOKEN.toUpperCase()}`,
  "token twice": `Bearer ${TOKEN} Bearer ${TOKEN}`,
  "non-ascii": "Bearer tök",
  "latin1 byte": "Bearer \u00e9",
  "leading space": ` Bearer ${TOKEN}`,
  "empty header": "",
})) {
  add(`auth ${n} POST`, AUTH, [() => req("POST", "/mcp", { body: INIT, headers: h === null ? {} : { Authorization: h } })]);
}
add("auth GET wrong", AUTH, [() => req("GET", "/mcp", { headers: { Authorization: "Bearer wrong" } })]);
add("auth DELETE none", AUTH, [() => req("DELETE", "/mcp")]);
add("auth DELETE ok no session", AUTH, [() => req("DELETE", "/mcp", { auth: true })]);
add("auth duplicated Authorization (bad, good)", AUTH, [() => Buffer.from(`POST /mcp HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer bad\r\nAuthorization: Bearer ${TOKEN}\r\nContent-Type: application/json\r\nContent-Length: ${INIT.length}\r\nConnection: close\r\n\r\n${INIT}`)]);
add("auth duplicated Authorization (good, bad)", AUTH, [() => Buffer.from(`POST /mcp HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${TOKEN}\r\nAuthorization: Bearer bad\r\nContent-Type: application/json\r\nContent-Length: ${INIT.length}\r\nConnection: close\r\n\r\n${INIT}`)]);
add("auth header name case", AUTH, [() => req("POST", "/mcp", { body: INIT, headers: { aUtHoRiZaTiOn: `Bearer ${TOKEN}` } })]);
add("auth before body parse (bad token + bad json)", AUTH, [() => req("POST", "/mcp", { body: "{not json", headers: { Authorization: "Bearer bad" } })]);
add("auth ok + bad json", AUTH, [() => req("POST", "/mcp", { body: "{not json", auth: true })]);

// ---- body ---------------------------------------------------------------------------------------------------------
for (const [n, b] of Object.entries({
  "empty": "",
  "whitespace": "   ",
  "invalid json": "{",
  "array": "[]",
  "array batch": `[${rpc(1, "ping")}]`,
  "string": '"x"',
  "number": "1",
  "null": "null",
  "true": "true",
  "empty object": "{}",
  "bom": `\ufeff${INIT}`,
  "trailing garbage": `${INIT} x`,
  "trailing newline": `${INIT}\n`,
  "leading newline": `\n${INIT}`,
  "NaN id": '{"jsonrpc":"2.0","id":NaN,"method":"initialize"}',
  "Infinity param": '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"x":Infinity}}',
  "dup keys": '{"jsonrpc":"2.0","id":1,"id":2,"method":"ping","method":"initialize"}',
  "float id 1.0 init": '{"jsonrpc":"2.0","id":1.0,"method":"initialize"}',
  "float id 1e2 init": '{"jsonrpc":"2.0","id":1e2,"method":"initialize"}',
  "float id 1.5 init": '{"jsonrpc":"2.0","id":1.5,"method":"initialize"}',
  "big int id init": '{"jsonrpc":"2.0","id":12345678901234567890123,"method":"initialize"}',
  "string id init": '{"jsonrpc":"2.0","id":"a-é-😀","method":"initialize"}',
  "null id init": '{"jsonrpc":"2.0","id":null,"method":"initialize"}',
  "no id init (notification)": '{"jsonrpc":"2.0","method":"initialize"}',
  "obj id init": '{"jsonrpc":"2.0","id":{"a":1},"method":"initialize"}',
  "list id init": '{"jsonrpc":"2.0","id":[1],"method":"initialize"}',
  "bool id init": '{"jsonrpc":"2.0","id":true,"method":"initialize"}',
  "method missing": '{"jsonrpc":"2.0","id":1}',
  "method null": '{"jsonrpc":"2.0","id":1,"method":null}',
  "method number": '{"jsonrpc":"2.0","id":1,"method":5}',
  "method list (unhashable)": '{"jsonrpc":"2.0","id":1,"method":["initialize"]}',
  "method dict (unhashable)": '{"jsonrpc":"2.0","id":1,"method":{"a":1}}',
  "method empty string": '{"jsonrpc":"2.0","id":1,"method":""}',
  "method unknown": '{"jsonrpc":"2.0","id":1,"method":"nope"}',
  "method initialize with sid-less ping": rpc(1, "ping"),
  "notifications/initialized w/o session": '{"jsonrpc":"2.0","method":"notifications/initialized"}',
  "jsonrpc missing": '{"id":1,"method":"initialize"}',
  "jsonrpc wrong": '{"jsonrpc":"1.0","id":1,"method":"initialize"}',
  "params string": '{"jsonrpc":"2.0","id":1,"method":"initialize","params":"x"}',
  "params list": '{"jsonrpc":"2.0","id":1,"method":"initialize","params":[1]}',
  "params null": '{"jsonrpc":"2.0","id":1,"method":"initialize","params":null}',
  "protocolVersion old": rpc(1, "initialize", { protocolVersion: "2024-11-05" }),
  "protocolVersion newer": rpc(1, "initialize", { protocolVersion: "2099-01-01" }),
  "protocolVersion number": rpc(1, "initialize", { protocolVersion: 5 }),
  "protocolVersion null": rpc(1, "initialize", { protocolVersion: null }),
  "protocolVersion list": rpc(1, "initialize", { protocolVersion: ["2025-06-18"] }),
  "lone surrogate": '{"jsonrpc":"2.0","id":"\\ud800","method":"initialize"}',
  "deep nesting 200": `{"jsonrpc":"2.0","id":1,"method":"initialize","params":${"[".repeat(200)}${"]".repeat(200)}}`,
  "deep nesting 20000": `{"jsonrpc":"2.0","id":1,"method":"initialize","params":${"[".repeat(20000)}${"]".repeat(20000)}}`,
  "huge int 5000": `{"jsonrpc":"2.0","id":${"9".repeat(5000)},"method":"initialize"}`,
  "1MB body": `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"pad":"${"a".repeat(1 << 20)}"}}`,
  "12MB body": `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"pad":"${"a".repeat(12 << 20)}"}}`,
})) {
  add(`body ${n}`, NOAUTH, [() => req("POST", "/mcp", { body: b })], { idleMs: 800 });
}
add("body invalid utf-8", NOAUTH, [() => req("POST", "/mcp", { body: Buffer.from([0x7b, 0xff, 0xfe, 0x7d]) })]);
add("body utf-16 le", NOAUTH, [() => req("POST", "/mcp", { body: Buffer.from(INIT, "utf16le") })]);
add("body utf-16 le with BOM", NOAUTH, [() => req("POST", "/mcp", { body: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(INIT, "utf16le")]) })]);
add("body latin1 content-type charset ignored", NOAUTH, [() => req("POST", "/mcp", { body: Buffer.from(rpc("é", "initialize"), "latin1"), headers: { "Content-Type": "application/json; charset=iso-8859-1" } })]);
add("body NUL byte", NOAUTH, [() => req("POST", "/mcp", { body: `${INIT}\u0000` })]);

// content-type variants (Starlette's request.json() ignores it)
for (const ct of ["text/plain", "application/x-www-form-urlencoded", "application/json; charset=utf-8", "APPLICATION/JSON", "", "multipart/form-data; boundary=x", "application/jsonx", "application/vnd.api+json"]) {
  add(`content-type [${ct}]`, NOAUTH, [() => req("POST", "/mcp", { body: INIT, headers: { "Content-Type": ct } })]);
}
add("no content-type", NOAUTH, [() => req("POST", "/mcp", { body: INIT, ct: false })]);
add("Accept: application/json only", NOAUTH, [() => req("POST", "/mcp", { body: INIT, headers: { Accept: "application/json" } })]);
add("Accept: text/event-stream only", NOAUTH, [() => req("POST", "/mcp", { body: INIT, headers: { Accept: "text/event-stream" } })]);
add("Accept: */*", NOAUTH, [() => req("POST", "/mcp", { body: INIT, headers: { Accept: "*/*" } })]);
add("Accept-Encoding gzip", NOAUTH, [() => req("POST", "/mcp", { body: INIT, headers: { "Accept-Encoding": "gzip, br" } })]);
add("Content-Encoding gzip body (not decoded)", NOAUTH, [() => req("POST", "/mcp", { body: INIT, headers: { "Content-Encoding": "gzip" } })]);
add("MCP-Protocol-Version header bogus", NOAUTH, [() => req("POST", "/mcp", { body: INIT, headers: { "MCP-Protocol-Version": "1999-01-01" } })]);

// ---- framing ------------------------------------------------------------------------------------------------------
add("chunked body", NOAUTH, [
  () => Buffer.from(`POST /mcp HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n${(INIT.length >> 1).toString(16)}\r\n${INIT.slice(0, INIT.length >> 1)}\r\n${(INIT.length - (INIT.length >> 1)).toString(16)}\r\n${INIT.slice(INIT.length >> 1)}\r\n0\r\n\r\n`),
]);
add("chunked + content-length (smuggling)", NOAUTH, [
  () => Buffer.from(`POST /mcp HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nContent-Length: 5\r\nConnection: close\r\n\r\n${INIT.length.toString(16)}\r\n${INIT}\r\n0\r\n\r\n`),
]);
add("bad chunk size", NOAUTH, [() => Buffer.from("POST /mcp HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\nZZ\r\nabc\r\n0\r\n\r\n")]);
add("content-length too small", NOAUTH, [() => req("POST", "/mcp", { body: INIT, headers: { "Content-Length": "5" } })]);
add("content-length too large (half-close)", NOAUTH, [() => req("POST", "/mcp", { body: INIT, headers: { "Content-Length": String(INIT.length + 50) } })], { half: true });
add("content-length negative", NOAUTH, [() => req("POST", "/mcp", { body: INIT, headers: { "Content-Length": "-1" } })]);
add("content-length non-numeric", NOAUTH, [() => req("POST", "/mcp", { body: INIT, headers: { "Content-Length": "abc" } })]);
add("duplicate content-length differing", NOAUTH, [() => Buffer.from(`POST /mcp HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\nContent-Length: ${INIT.length}\r\nConnection: close\r\n\r\n${INIT}`)]);
add("no content-length POST", NOAUTH, [() => req("POST", "/mcp", { body: INIT, cl: false })]);
add("Expect: 100-continue", NOAUTH, [() => req("POST", "/mcp", { body: INIT, headers: { Expect: "100-continue" } })]);
add("HTTP/1.0", NOAUTH, [() => req("POST", "/mcp", { body: INIT, version: "1.0", close: false })]);
add("HTTP/1.0 keep-alive", NOAUTH, [() => req("POST", "/mcp", { body: INIT, version: "1.0", close: false, headers: { Connection: "keep-alive" } })]);
add("HTTP/0.9 style", NOAUTH, [() => Buffer.from("GET /health\r\n")]);
add("HTTP/2.0 request line", NOAUTH, [() => req("GET", "/health", { version: "2.0" })]);
add("HTTP/1.2", NOAUTH, [() => req("GET", "/health", { version: "1.2" })]);
add("no Host header HTTP/1.1", NOAUTH, [() => req("GET", "/health", { host: null })]);
add("no Host header HTTP/1.0", NOAUTH, [() => req("GET", "/health", { host: null, version: "1.0", close: false })]);
add("garbage request", NOAUTH, [() => Buffer.from("\x00\x01\x02garbage\r\n\r\n")]);
add("bare LF line endings", NOAUTH, [() => Buffer.from("GET /health HTTP/1.1\nHost: x\nConnection: close\n\n")]);
add("header with no colon", NOAUTH, [() => Buffer.from("GET /health HTTP/1.1\r\nHost: x\r\nbadheader\r\nConnection: close\r\n\r\n")]);
add("obs-fold header", NOAUTH, [() => Buffer.from("GET /health HTTP/1.1\r\nHost: x\r\nX-A: a\r\n  b\r\nConnection: close\r\n\r\n")]);
add("header name with space", NOAUTH, [() => Buffer.from("GET /health HTTP/1.1\r\nHost: x\r\nX A: b\r\nConnection: close\r\n\r\n")]);
add("very long URL 20k", NOAUTH, [() => req("GET", `/${"a".repeat(20000)}`)]);
add("very long URL 100k", NOAUTH, [() => req("GET", `/${"a".repeat(100000)}`)]);
add("very long header 20k", NOAUTH, [() => req("GET", "/health", { headers: { "X-Big": "a".repeat(20000) } })]);
add("very long header 100k", NOAUTH, [() => req("GET", "/health", { headers: { "X-Big": "a".repeat(100000) } })]);
add("200 headers", NOAUTH, [() => req("GET", "/health", { headers: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`X-H${i}`, "v"])) })]);
add("2000 headers", NOAUTH, [() => req("GET", "/health", { headers: Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`X-H${i}`, "v"])) })]);
add("pipelined 3 health", NOAUTH, [() => Buffer.concat([req("GET", "/health", { close: false }), req("GET", "/health", { close: false }), req("GET", "/health")])]);
add("pipelined init then ping w/o sid", NOAUTH, [() => Buffer.concat([req("POST", "/mcp", { body: INIT, close: false }), req("POST", "/mcp", { body: rpc(2, "ping"), close: true })])]);
add("keep-alive two requests (second after wait)", NOAUTH, [
  () => ({ chunks: [{ data: req("GET", "/health", { close: false }) }, { wait: 150, data: req("GET", "/health") }] }),
]);
add("slow headers split bytes", NOAUTH, [() => ({ chunks: [{ data: "GET /hea" }, { wait: 100, data: "lth HTTP/1.1\r\nHost: x\r\n" }, { wait: 100, data: "Connection: close\r\n\r\n" }] })]);
add("slow body split bytes", NOAUTH, [() => ({ chunks: [{ data: `POST /mcp HTTP/1.1\r\nHost: x\r\nContent-Length: ${INIT.length}\r\nConnection: close\r\n\r\n${INIT.slice(0, 10)}` }, { wait: 200, data: INIT.slice(10) }] })]);
add("client aborts mid-body then health", NOAUTH, [() => ({ chunks: [{ data: `POST /mcp HTTP/1.1\r\nHost: x\r\nContent-Length: 1000\r\n\r\n{"jsonrpc"` }] }), () => req("GET", "/health")]);

// ---- sessions -----------------------------------------------------------------------------------------------------
const S = (name, cfg, steps, opts) => add(name, cfg, steps, opts);
S("initialize -> session header present", NOAUTH, [initStep()]);
S("initialize no session header on notification-only", NOAUTH, [() => req("POST", "/mcp", { body: '{"jsonrpc":"2.0","method":"initialize"}' })]);
S("init then ping", NOAUTH, [initStep(), withSid((sid) => req("POST", "/mcp", { body: rpc(2, "ping"), headers: { "Mcp-Session-Id": sid } }))]);
S("init then tools/list", NOAUTH, [initStep(), withSid((sid) => req("POST", "/mcp", { body: rpc(2, "tools/list"), headers: { "Mcp-Session-Id": sid } }))]);
S("init then notifications/initialized (202)", NOAUTH, [initStep(), withSid((sid) => req("POST", "/mcp", { body: '{"jsonrpc":"2.0","method":"notifications/initialized"}', headers: { "Mcp-Session-Id": sid } }))]);
S("init then any notification", NOAUTH, [initStep(), withSid((sid) => req("POST", "/mcp", { body: '{"jsonrpc":"2.0","method":"nope"}', headers: { "Mcp-Session-Id": sid } }))]);
S("init twice on same session", NOAUTH, [initStep(), withSid((sid) => req("POST", "/mcp", { body: INIT, headers: { "Mcp-Session-Id": sid } }))]);
S("session header lowercase", NOAUTH, [initStep(), withSid((sid) => req("POST", "/mcp", { body: rpc(2, "ping"), headers: { "mcp-session-id": sid } }))]);
S("session header uppercase value", NOAUTH, [initStep(), withSid((sid) => req("POST", "/mcp", { body: rpc(2, "ping"), headers: { "Mcp-Session-Id": sid.toUpperCase() } }))]);
S("session header with spaces", NOAUTH, [initStep(), withSid((sid) => req("POST", "/mcp", { body: rpc(2, "ping"), headers: { "Mcp-Session-Id": ` ${sid} ` } }))]);
S("session header duplicated (bad, good)", NOAUTH, [initStep(), withSid((sid) => Buffer.from(`POST /mcp HTTP/1.1\r\nHost: x\r\nMcp-Session-Id: bad\r\nMcp-Session-Id: ${sid}\r\nContent-Length: ${rpc(2, "ping").length}\r\nConnection: close\r\n\r\n${rpc(2, "ping")}`))]);
S("session header duplicated (good, bad)", NOAUTH, [initStep(), withSid((sid) => Buffer.from(`POST /mcp HTTP/1.1\r\nHost: x\r\nMcp-Session-Id: ${sid}\r\nMcp-Session-Id: bad\r\nContent-Length: ${rpc(2, "ping").length}\r\nConnection: close\r\n\r\n${rpc(2, "ping")}`))]);
S("session header empty value", NOAUTH, [() => req("POST", "/mcp", { body: INIT, headers: { "Mcp-Session-Id": "" } })]);
S("session header empty + ping", NOAUTH, [() => req("POST", "/mcp", { body: rpc(2, "ping"), headers: { "Mcp-Session-Id": "" } })]);
S("unknown session ping", NOAUTH, [() => req("POST", "/mcp", { body: rpc(2, "ping"), headers: { "Mcp-Session-Id": "nope" } })]);
S("unknown session init", NOAUTH, [() => req("POST", "/mcp", { body: INIT, headers: { "Mcp-Session-Id": "nope" } })]);
S("unknown session weird id (unicode)", NOAUTH, [() => req("POST", "/mcp", { body: rpc(2, "ping"), headers: { "Mcp-Session-Id": "é😀" } })]);
S("unknown session id quotes/html", NOAUTH, [() => req("POST", "/mcp", { body: rpc(2, "ping"), headers: { "Mcp-Session-Id": '"><b>\\' } })]);
S("unknown session id 1000 chars", NOAUTH, [() => req("POST", "/mcp", { body: rpc(2, "ping"), headers: { "Mcp-Session-Id": "s".repeat(1000) } })]);
S("unknown session id echo with id types", NOAUTH, [() => req("POST", "/mcp", { body: '{"jsonrpc":"2.0","id":1.0,"method":"ping"}', headers: { "Mcp-Session-Id": "nope" } })]);
S("unknown session with unhashable method", NOAUTH, [() => req("POST", "/mcp", { body: '{"jsonrpc":"2.0","id":1,"method":["x"]}', headers: { "Mcp-Session-Id": "nope" } })]);
S("no session non-init", NOAUTH, [() => req("POST", "/mcp", { body: rpc(2, "tools/list") })]);
S("no session non-init float id", NOAUTH, [() => req("POST", "/mcp", { body: '{"jsonrpc":"2.0","id":2.0,"method":"tools/list"}' })]);
S("no session non-init id object", NOAUTH, [() => req("POST", "/mcp", { body: '{"jsonrpc":"2.0","id":{"a":[1,2.0]},"method":"tools/list"}' })]);
S("no session unhashable method -> 500?", NOAUTH, [() => req("POST", "/mcp", { body: '{"jsonrpc":"2.0","id":1,"method":["initialize"]}' })]);
S("session unhashable method -> 500?", NOAUTH, [initStep(), withSid((sid) => req("POST", "/mcp", { body: '{"jsonrpc":"2.0","id":1,"method":["initialize"]}', headers: { "Mcp-Session-Id": sid } }))]);
S("session unhashable method dict", NOAUTH, [initStep(), withSid((sid) => req("POST", "/mcp", { body: '{"jsonrpc":"2.0","id":1,"method":{"a":1}}', headers: { "Mcp-Session-Id": sid } }))]);
S("session then server still alive after 500", NOAUTH, [initStep(), withSid((sid) => req("POST", "/mcp", { body: '{"jsonrpc":"2.0","id":1,"method":{"a":1}}', headers: { "Mcp-Session-Id": sid } })), withSid((sid) => req("POST", "/mcp", { body: rpc(3, "ping"), headers: { "Mcp-Session-Id": sid } }))]);
S("session body array", NOAUTH, [initStep(), withSid((sid) => req("POST", "/mcp", { body: `[${rpc(2, "ping")}]`, headers: { "Mcp-Session-Id": sid } }))]);
S("session invalid json", NOAUTH, [initStep(), withSid((sid) => req("POST", "/mcp", { body: "{", headers: { "Mcp-Session-Id": sid } }))]);
S("session tools/call missing params", NOAUTH, [initStep(), withSid((sid) => req("POST", "/mcp", { body: rpc(2, "tools/call"), headers: { "Mcp-Session-Id": sid } }))]);
S("session tools/call unknown tool", NOAUTH, [initStep(), withSid((sid) => req("POST", "/mcp", { body: rpc(2, "tools/call", { name: "nope", arguments: {} }), headers: { "Mcp-Session-Id": sid } }))]);
S("session tools/call bad args", NOAUTH, [initStep(), withSid((sid) => req("POST", "/mcp", { body: rpc(2, "tools/call", { name: "create_sandbox", arguments: { timeout: "x" } }), headers: { "Mcp-Session-Id": sid } }))]);
S("session tools/call create_sandbox ok", NOAUTH, [initStep(), withSid((sid) => req("POST", "/mcp", { body: rpc(2, "tools/call", { name: "create_sandbox", arguments: {} }), headers: { "Mcp-Session-Id": sid } })), withSid((sid) => req("POST", "/mcp", { body: rpc(3, "tools/call", { name: "run_command", arguments: { command: "echo hi" } }), headers: { "Mcp-Session-Id": sid } })), withSid((sid) => req("DELETE", "/mcp", { headers: { "Mcp-Session-Id": sid } }))]);
S("session tools/call float arg echo", NOAUTH, [initStep(), withSid((sid) => req("POST", "/mcp", { body: rpc(2, "tools/call", { name: "run_command", arguments: { command: "x", timeout: 1.0 } }), headers: { "Mcp-Session-Id": sid } }))]);
S("session tools/call float id echo", NOAUTH, [initStep(), withSid((sid) => req("POST", "/mcp", { body: '{"jsonrpc":"2.0","id":7.0,"method":"tools/list"}', headers: { "Mcp-Session-Id": sid } }))]);
S("DELETE ok", NOAUTH, [initStep(), withSid((sid) => req("DELETE", "/mcp", { headers: { "Mcp-Session-Id": sid } }))]);
S("DELETE twice", NOAUTH, [initStep(), withSid((sid) => req("DELETE", "/mcp", { headers: { "Mcp-Session-Id": sid } })), withSid((sid) => req("DELETE", "/mcp", { headers: { "Mcp-Session-Id": sid } }))]);
S("DELETE then use", NOAUTH, [initStep(), withSid((sid) => req("DELETE", "/mcp", { headers: { "Mcp-Session-Id": sid } })), withSid((sid) => req("POST", "/mcp", { body: rpc(2, "ping"), headers: { "Mcp-Session-Id": sid } }))]);
S("DELETE no session header", NOAUTH, [() => req("DELETE", "/mcp")]);
S("DELETE empty session header", NOAUTH, [() => req("DELETE", "/mcp", { headers: { "Mcp-Session-Id": "" } })]);
S("DELETE unknown session", NOAUTH, [() => req("DELETE", "/mcp", { headers: { "Mcp-Session-Id": "nope" } })]);
S("DELETE unknown session unicode", NOAUTH, [() => req("DELETE", "/mcp", { headers: { "Mcp-Session-Id": "é\"\\</" } })]);
S("DELETE with body", NOAUTH, [initStep(), withSid((sid) => req("DELETE", "/mcp", { body: "xxx", headers: { "Mcp-Session-Id": sid } }))]);
S("DELETE with query", NOAUTH, [initStep(), withSid((sid) => req("DELETE", "/mcp?a=1", { headers: { "Mcp-Session-Id": sid } }))]);
S("DELETE /mcp/ trailing slash", NOAUTH, [initStep(), withSid((sid) => req("DELETE", "/mcp/", { headers: { "Mcp-Session-Id": sid } }))]);
S("DELETE /health", NOAUTH, [() => req("DELETE", "/health")]);
S("two sessions independent", NOAUTH, [
  initStep(),
  (st) => {
    st.first = st.sid;
    return req("POST", "/mcp", { body: INIT });
  },
  (st) => req("DELETE", "/mcp", { headers: { "Mcp-Session-Id": st.first } }),
  (st) => req("POST", "/mcp", { body: rpc(5, "ping"), headers: { "Mcp-Session-Id": st.sid } }),
  (st) => req("POST", "/mcp", { body: rpc(5, "ping"), headers: { "Mcp-Session-Id": st.first } }),
]);
S("auth: session use with wrong token", AUTH, [
  initStep({ auth: true }),
  withSid((sid) => req("POST", "/mcp", { body: rpc(2, "ping"), headers: { "Mcp-Session-Id": sid, Authorization: "Bearer bad" } })),
  withSid((sid) => req("DELETE", "/mcp", { headers: { "Mcp-Session-Id": sid, Authorization: "Bearer bad" } })),
  withSid((sid) => req("POST", "/mcp", { auth: true, body: rpc(2, "ping"), headers: { "Mcp-Session-Id": sid } })),
]);
S("auth: ok full flow", AUTH, [initStep({ auth: true }), withSid((sid) => req("POST", "/mcp", { auth: true, body: rpc(2, "tools/list"), headers: { "Mcp-Session-Id": sid } })), withSid((sid) => req("DELETE", "/mcp", { auth: true, headers: { "Mcp-Session-Id": sid } }))]);

// session capacity: 100 live sessions then the 101st is refused
cases.push({
  name: "session capacity 101st",
  cfg: NOAUTH,
  steps: [
    async (st, port) => {
      const codes = [];
      for (let i = 0; i < 101; i += 1) {
        const r = await rawExchange(port, req("POST", "/mcp", { body: INIT }), { idleMs: 200 });
        const rs = parseResponses(r.bytes);
        codes.push(rs[0]?.statusLine);
        if (i === 100) return { synthetic: [`${[...new Set(codes.slice(0, 100))].join("|")} ... ${rs[0]?.statusLine}\n${rs[0]?.body}`] };
      }
      return null;
    },
    () => req("POST", "/mcp", { body: INIT }),
  ],
  slow: true,
});
// after hitting the cap, DELETE frees a slot
cases.push({
  name: "session capacity then free slot",
  cfg: NOAUTH,
  steps: [
    async (st, port) => {
      const sids = [];
      for (let i = 0; i < 100; i += 1) {
        const r = await rawExchange(port, req("POST", "/mcp", { body: INIT }), { idleMs: 200 });
        const rs = parseResponses(r.bytes);
        sids.push(rs[0]?.headers.find(([n]) => n === "mcp-session-id")?.[1]);
      }
      st.sids = sids;
      const refused = parseResponses((await rawExchange(port, req("POST", "/mcp", { body: INIT }), { idleMs: 200 })).bytes);
      const del = parseResponses((await rawExchange(port, req("DELETE", "/mcp", { headers: { "Mcp-Session-Id": sids[0] } }), { idleMs: 200 })).bytes);
      const again = parseResponses((await rawExchange(port, req("POST", "/mcp", { body: INIT }), { idleMs: 200 })).bytes);
      return { synthetic: [refused[0]?.statusLine + refused[0]?.body, del[0]?.statusLine, again[0]?.statusLine] };
    },
  ],
  slow: true,
});

// ---- run ----------------------------------------------------------------------------------------------------------
const cfgKey = (c) => JSON.stringify(c);
const groups = new Map();
for (const c of cases) {
  if (only && !c.name.includes(only)) continue;
  const k = cfgKey(c.cfg);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(c);
}

async function runCase(srv, c) {
  const st = { sid: null };
  const outs = [];
  const raws = [];
  for (const step of c.steps) {
    const built = await step(st, srv.port);
    if (built === null) continue;
    if (built && built.synthetic) {
      outs.push(...built.synthetic);
      continue;
    }
    const exch = built && built.chunks ? await rawExchange(srv.port, null, { chunks: built.chunks, idleMs: c.idleMs ?? (/tools\/call|float id echo/.test(c.name) ? 2500 : 500) }) : await rawExchange(srv.port, built, { idleMs: c.idleMs ?? (/tools\/call|float id echo/.test(c.name) ? 2500 : 500), half: c.half });
    const resps = parseResponses(exch.bytes);
    for (const r of resps) {
      raws.push(r.rawNames ?? []);
      const sid = r.headers?.find(([n]) => n === "mcp-session-id")?.[1];
      if (sid && !/^nope$/.test(sid)) st.sid = sid;
    }
    const n = normResponses(resps, srv);
    outs.push(n.length ? n.join("\n--\n") : `<no response; ${exch.why}>`);
  }
  return { out: outs.join("\n=====\n"), rawNames: raws };
}

let diffs = 0;
let total = 0;
const notes = new Map();
for (const [k, list] of groups) {
  const cfg = JSON.parse(k);
  const [py, nd] = await Promise.all([startServer("py", cfg), startServer("node", cfg)]);
  if (!py.up || !nd.up) {
    console.log(`SERVER-START-FAIL cfg=${k} py=${py.up} node=${nd.up}`);
    console.log(py.stderr().slice(-500));
    console.log(nd.stderr().slice(-500));
    await py.stop();
    await nd.stop();
    diffs += 1;
    continue;
  }
  for (const c of list) {
    total += 1;
    const a = await runCase(py, c);
    const b = await runCase(nd, c);
    if (a.out === b.out) {
      if (verbose) console.log(`ok   ${c.name}`);
    } else {
      diffs += 1;
      console.log(`DIFF ${c.name}`);
      console.log(`  --- oracle\n${a.out.slice(0, 1500).replace(/^/gm, "    ")}`);
      console.log(`  --- port\n${b.out.slice(0, 1500).replace(/^/gm, "    ")}`);
    }
    const ap = JSON.stringify(a.rawNames);
    const bp = JSON.stringify(b.rawNames);
    if (ap !== bp && !notes.has("hdr-case")) notes.set("hdr-case", `${c.name}: oracle ${ap.slice(0, 120)} vs port ${bp.slice(0, 120)}`);
  }
  const [sp, sn] = [await py.stop(), await nd.stop()];
  console.log(`server cfg=${k} exit oracle=${sp} port=${sn}`);
  const ep = py.stderr().split("\n").filter((l) => /Traceback|Error/.test(l)).length;
  const en = nd.stderr().split("\n").filter((l) => /Traceback|Error/.test(l)).length;
  console.log(`  stderr error-ish lines: oracle=${ep} port=${en}`);
}

// ---- lifecycle / concurrency (custom flows) -----------------------------------------------------------------------
const lifeFlows = {
  async "shutdown deletes session sandboxes (SIGTERM)"(srv) {
    const sid = await openSession(srv);
    await post(srv, sid, rpc(2, "tools/call", { name: "create_sandbox", arguments: {} }), 4000);
    return { sig: "SIGTERM" };
  },
  async "shutdown deletes session sandboxes (SIGINT)"(srv) {
    const sid = await openSession(srv);
    await post(srv, sid, rpc(2, "tools/call", { name: "create_sandbox", arguments: {} }), 4000);
    return { sig: "SIGINT" };
  },
  async "shutdown with two sessions, one deleted"(srv) {
    const a = await openSession(srv);
    const b = await openSession(srv);
    await post(srv, a, rpc(2, "tools/call", { name: "create_sandbox", arguments: {} }), 4000);
    await post(srv, b, rpc(2, "tools/call", { name: "create_sandbox", arguments: {} }), 4000);
    await rawExchange(srv.port, req("DELETE", "/mcp", { headers: { "Mcp-Session-Id": a } }), { idleMs: 300 });
    return { sig: "SIGTERM" };
  },
  async "client disconnect mid tool call (create_sandbox) still runs it"(srv) {
    const sid = await openSession(srv);
    await rawExchange(srv.port, req("POST", "/mcp", { body: rpc(2, "tools/call", { name: "create_sandbox", arguments: {} }), headers: { "Mcp-Session-Id": sid }, close: false }), { idleMs: 5, maxMs: 5 });
    await sleep(2500);
    return { sig: "SIGTERM" };
  },
  async "hung tool does not block ping/health on same session"(srv) {
    const sid = await openSession(srv);
    const hung = rawExchange(srv.port, req("POST", "/mcp", { body: rpc(2, "tools/call", { name: "run_command", arguments: { command: "sleep 100" } }), headers: { "Mcp-Session-Id": sid } }), { idleMs: 60000, maxMs: 3500 });
    await sleep(1200);
    const ping = parseResponses((await rawExchange(srv.port, req("POST", "/mcp", { body: rpc(3, "ping"), headers: { "Mcp-Session-Id": sid } }), { idleMs: 500, maxMs: 2500 })).bytes);
    const health = parseResponses((await rawExchange(srv.port, req("GET", "/health"), { idleMs: 500, maxMs: 2500 })).bytes);
    const h = await hung;
    return { sig: "SIGTERM", extra: `ping=${ping[0]?.statusLine} ${ping[0]?.body}\nhealth=${health[0]?.statusLine}\nhung=${h.bytes.length}` };
  },
  async "SIGTERM with a hung in-flight request exits"(srv) {
    const sid = await openSession(srv);
    void rawExchange(srv.port, req("POST", "/mcp", { body: rpc(2, "tools/call", { name: "run_command", arguments: { command: "sleep 100" } }), headers: { "Mcp-Session-Id": sid } }), { idleMs: 60000, maxMs: 20000 });
    await sleep(1200);
    return { sig: "SIGTERM", waitMs: 12000 };
  },
  async "SIGTERM with open keep-alive idle connection exits"(srv) {
    const sock = net.connect(srv.port, "127.0.0.1");
    await sleep(100);
    sock.write(req("GET", "/health", { close: false }));
    await sleep(300);
    return { sig: "SIGTERM", waitMs: 12000, hold: sock };
  },
  async "health after SIGTERM refused"(srv) {
    return { sig: "SIGTERM", probeAfter: true };
  },
};
async function openSession(srv) {
  const r = parseResponses((await rawExchange(srv.port, req("POST", "/mcp", { body: INIT }), { idleMs: 300 })).bytes);
  return r[0].headers.find(([n]) => n === "mcp-session-id")[1];
}
async function post(srv, sid, body, idleMs = 500) {
  return parseResponses((await rawExchange(srv.port, req("POST", "/mcp", { body, headers: { "Mcp-Session-Id": sid } }), { idleMs, maxMs: idleMs + 3000 })).bytes);
}
async function runLife(kind, name, flow) {
  const world = /hung/.test(name) ? { hangProcessStart: true } : {};
  const srv = await startServer(kind, { auth: false, world });
  let out = "";
  try {
    const r = await flow(srv);
    const t0 = Date.now();
    srv.proc.kill(r.sig);
    const st = await Promise.race([srv.exited, sleep(r.waitMs ?? 8000).then(() => "timeout")]);
    if (st === "timeout") srv.proc.kill("SIGKILL");
    r.hold?.destroy();
    let after = "";
    if (r.probeAfter) after = `\nprobe-after=${(await rawExchange(srv.port, req("GET", "/health"), { idleMs: 200, maxMs: 500 })).bytes.length}`;
    await sleep(200);
    out = `exit=${st}${r.extra ? `\n${r.extra}` : ""}\nstub-log:\n${await srv.log()}${after}`;
    void t0;
  } finally {
    srv.proc.kill("SIGKILL");
    await srv.cleanup();
  }
  return out.replace(/sbx-new-\d+/g, "sbx-new");
}
for (const [name, flow] of Object.entries(lifeFlows)) {
  if (only && !name.includes(only)) continue;
  total += 1;
  const a = await runLife("py", name, flow);
  const b = await runLife("node", name, flow);
  if (process.env.ADV_SHOW) console.log(`SHOW ${name}\n--oracle\n${a}\n--port\n${b}`);
  if (a === b) {
    if (verbose) console.log(`ok   ${name}`);
  } else {
    diffs += 1;
    console.log(`DIFF ${name}\n  --- oracle\n${a.replace(/^/gm, "    ")}\n  --- port\n${b.replace(/^/gm, "    ")}`);
  }
}
for (const [k, v] of notes) console.log(`NOTE ${k}: ${v}`);
console.log(`${total - diffs}/${total} equal, ${diffs} differ`);
process.exit(diffs ? 1 : 0);
