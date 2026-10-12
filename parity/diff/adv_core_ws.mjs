#!/usr/bin/env node
/**
 * Adversarial differential: Python `easy_sandbox.transport.ws.WebSocketClient` (websockets) vs
 * `src/transport/ws.ts` (ws), driven against one local misbehaving server.
 *
 *   ORACLE_VENV=/path/to/venv node parity/diff/adv_core_ws.mjs [--filter re] [--verbose] [--list]
 *
 * Exit 0 identical / 1 diffs / 2 oracle absent (skip). Needs the `ws` package (a runtime dependency of the CLI).
 */
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createTls } from "node:https";
import net from "node:net";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { WebSocketServer } from "ws";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(HERE, "..", "..");
const ORACLE_VENV = process.env.ORACLE_VENV;
const ORIG_REPO = process.env.ORIG_REPO;
if (!ORACLE_VENV || !existsSync(join(ORACLE_VENV, "bin", "python"))) {
  console.log("[adv_core_ws] ORACLE_VENV not set / absent: skipping");
  process.exit(2);
}
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const FILTER = opt("--filter") ? new RegExp(opt("--filter")) : null;
const VERBOSE = flag("--verbose");

const PY_RUNNER = String.raw`
import asyncio, json, sys, hashlib
from easy_sandbox.transport.config import TransportConfig
from easy_sandbox.transport.ws import WebSocketClient
sc = json.loads(sys.argv[1])
def fmt(m):
    if isinstance(m, bytes): return ["bin", len(m), hashlib.md5(m).hexdigest()[:8]]
    return ["text", len(m), m if len(m) < 80 else hashlib.md5(m.encode()).hexdigest()[:8]]
async def main():
    out = []
    cfg = TransportConfig(ws_ping_interval=sc.get("ping", 30.0))
    c = WebSocketClient(sc["url"], config=cfg, extra_headers=sc.get("headers"))
    for st in sc["steps"]:
        op = st["op"]
        try:
            if op == "connect":
                await c.connect(); out.append("connect:ok")
            elif op == "recv":
                out.append(["recv", fmt(await c.receive(timeout=st.get("t")))])
            elif op == "send":
                await c.send(st["d"]); out.append("send:ok")
            elif op == "sendbin":
                await c.send(bytes.fromhex(st["d"])); out.append("send:ok")
            elif op == "sendbig":
                await c.send("x" * st["n"]); out.append("send:ok")
            elif op == "iter":
                got = []
                try:
                    async for m in c.recv_iter():
                        got.append(fmt(m))
                        if len(got) >= st["max"]: break
                    out.append(["iter-end", got])
                except Exception as e:
                    out.append(["iter-err", got, type(e).__name__ + ": " + str(e)])
                continue
            elif op == "sleep":
                await asyncio.sleep(st["s"])
            elif op == "close":
                await c.close(); out.append("close:ok")
            elif op == "state":
                out.append(["connected", c.is_connected])
        except asyncio.TimeoutError:
            out.append(["TimeoutError", ""])
        except Exception as e:
            out.append([op + ":ERR", type(e).__name__ + ": " + str(e)])
    print(json.dumps(out, separators=(",", ":"), ensure_ascii=True))
asyncio.run(main())
`;

const TS_RUNNER = `
import { createHash } from "node:crypto";
import { TransportConfig } from "${join(CLI_ROOT, "src/transport/config.ts")}";
import { WebSocketClient } from "${join(CLI_ROOT, "src/transport/ws.ts")}";
const sc = JSON.parse(process.argv[2]);
const md5 = (b) => createHash("md5").update(b).digest("hex").slice(0, 8);
function fmt(m) {
  if (Buffer.isBuffer(m)) return ["bin", m.length, md5(m)];
  const n = [...m].length;
  return ["text", n, n < 80 ? m : md5(Buffer.from(m))];
}
const es = (e) => (typeof e.__str__ === "function" ? e.__str__() : e.message);
const out = [];
const cfg = new TransportConfig({ ws_ping_interval: sc.ping ?? 30.0 });
const c = new WebSocketClient(sc.url, { config: cfg, extra_headers: sc.headers });
for (const st of sc.steps) {
  const op = st.op;
  try {
    if (op === "connect") { await c.connect(); out.push("connect:ok"); }
    else if (op === "recv") out.push(["recv", fmt(await c.receive({ timeout: st.t ?? null }))]);
    else if (op === "send") { await c.send(st.d); out.push("send:ok"); }
    else if (op === "sendbin") { await c.send(Buffer.from(st.d, "hex")); out.push("send:ok"); }
    else if (op === "sendbig") { await c.send("x".repeat(st.n)); out.push("send:ok"); }
    else if (op === "iter") {
      const got = [];
      try {
        for await (const m of c.recvIter()) { got.push(fmt(m)); if (got.length >= st.max) break; }
        out.push(["iter-end", got]);
      } catch (e) { out.push(["iter-err", got, e.constructor.name + ": " + es(e)]); }
      continue;
    }
    else if (op === "sleep") await new Promise((r) => setTimeout(r, st.s * 1000));
    else if (op === "close") { await c.close(); out.push("close:ok"); }
    else if (op === "state") out.push(["connected", c.is_connected]);
  } catch (e) {
    if (e && e.name === "TimeoutError" && e.message === "") out.push(["TimeoutError", ""]);
    else out.push([op + ":ERR", e.constructor.name + ": " + es(e)]);
  }
}
console.log(JSON.stringify(out).replace(/[^\\x00-\\x7f]/g, (c) => "\\\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")));
process.exit(0);
`;

const tmp = mkdtempSync(join(tmpdir(), "adv-ws-"));
const tsFile = join(tmp, "runner.mts");
writeFileSync(tsFile, TS_RUNNER);
const tsx = join(CLI_ROOT, "node_modules/.bin/tsx");
if (process.env.ADV_WS_KEEP) writeFileSync(process.env.ADV_WS_KEEP, TS_RUNNER);

function runPy(sc) {
  return new Promise((res) => {
    import("node:child_process").then(({ spawn }) => {
      const p = spawn(join(ORACLE_VENV, "bin/python"), ["-c", PY_RUNNER, JSON.stringify(sc)], {
        env: { ...process.env, HOME: tmp, PATH: process.env.PATH },
      });
      let o = "", e = "";
      p.stdout.on("data", (d) => (o += d));
      p.stderr.on("data", (d) => (e += d));
      const t = setTimeout(() => p.kill("SIGKILL"), 60000);
      p.on("close", () => { clearTimeout(t); res({ o: o.trim(), e: e.trim().split("\n").slice(-3).join(" | ") }); });
    });
  });
}
function runTs(sc) {
  return new Promise((res) => {
    import("node:child_process").then(({ spawn }) => {
      const p = spawn(tsx, [tsFile, JSON.stringify(sc)], { cwd: CLI_ROOT, env: { ...process.env, HOME: tmp, EBX_NO_KEYCHAIN: "1" } });
      let o = "", e = "";
      p.stdout.on("data", (d) => (o += d));
      p.stderr.on("data", (d) => (e += d));
      const t = setTimeout(() => p.kill("SIGKILL"), 60000);
      p.on("close", () => { clearTimeout(t); res({ o: o.trim().split("\n").pop(), e: e.trim().split("\n").slice(-3).join(" | ") }); });
    });
  });
}

// ---- servers ----------------------------------------------------------------------------------------------
let LOG = [];
const wss = new WebSocketServer({ noServer: true, autoPong: true, perMessageDeflate: true, maxPayload: 64 * 2 ** 20 });
const wssNoPong = new WebSocketServer({ noServer: true, autoPong: false, maxPayload: 64 * 2 ** 20 });

function behave(ws, path, sock) {
  const rec = (k, v) => LOG.push([path, k, v]);
  ws.on("close", (code, reason) => rec("server-saw-close", [code, reason.toString()]));
  ws.on("message", (d, isBin) => {
    rec("server-got", [isBin ? "bin" : "text", d.length]);
    if (path.startsWith("/echo")) ws.send(d, { binary: isBin });
    if (path === "/close-on-msg") ws.close(1008, "nope");
  });
  ws.on("error", () => {});
  const m = path.match(/^\/close\/(\d+)(?:\/(.*))?$/);
  if (m) setTimeout(() => ws.close(Number(m[1]), m[2] ? decodeURIComponent(m[2]) : undefined), 50);
  if (path === "/close-empty") setTimeout(() => ws.close(), 50);
  if (path === "/greet-then-close") { ws.send("hello"); ws.send(Buffer.from([1, 2, 3])); setTimeout(() => ws.close(1000, "bye"), 80); }
  if (path === "/greet-then-1001") { ws.send("hello"); setTimeout(() => ws.close(1001, "away"), 80); }
  if (path === "/greet-then-abrupt") { ws.send("hello"); setTimeout(() => sock.destroy(), 80); }
  if (path === "/abrupt") setTimeout(() => sock.destroy(), 50);
  if (path === "/abrupt-rst") setTimeout(() => sock.resetAndDestroy(), 50);
  if (path === "/big-text") ws.send("y".repeat(2 ** 20));
  if (path === "/big-text-over") ws.send("y".repeat(2 ** 20 + 1));
  if (path === "/big-bin-over") ws.send(Buffer.alloc(2 ** 20 + 1, 7));
  if (path === "/many") for (let i = 0; i < 50; i++) ws.send(`m${i}`);
  if (path === "/multi-byte") ws.send("héllo wörld ✓ 𝒜");
  if (path === "/invalid-utf8-text") {
    const f = Buffer.from([0x81, 0x02, 0xff, 0xfe]);
    sock.write(f);
  }
  if (path === "/bad-opcode") sock.write(Buffer.from([0x83, 0x00]));
  if (path === "/rsv-bit") sock.write(Buffer.from([0xc1, 0x00]));
  if (path === "/masked-from-server") sock.write(Buffer.from([0x81, 0x81, 0, 0, 0, 0, 0x41]));
  if (path === "/frag-then-close") { sock.write(Buffer.from([0x01, 0x01, 0x41])); setTimeout(() => ws.close(1000), 50); }
  if (path === "/ping-flood") for (let i = 0; i < 5; i++) ws.ping();
  if (path === "/close-bad-reason") sock.write(Buffer.from([0x88, 0x04, 0x03, 0xe8, 0xff, 0xfe]));
  if (path === "/close-1-byte") sock.write(Buffer.from([0x88, 0x01, 0x03]));
  if (path === "/close-invalid-code") sock.write(Buffer.from([0x88, 0x02, 0x03, 0xed]));
}

function onUpgrade(req, sock, head) {
  const path = decodeURIComponent(req.url.split("?")[0]).replace(/%2F/g, "/");
  const h = req.headers;
  LOG.push([path, "upgrade", {
    custom: h["x-adv"] ?? null,
    auth: h.authorization ?? null,
    origin: h.origin ?? null,
    exts: (h["sec-websocket-extensions"] ?? "").replace(/;.*/, ""),
    version: h["sec-websocket-version"],
    proto: h["sec-websocket-protocol"] ?? null,
    host: h.host ? "set" : null,
    query: req.url.includes("?") ? req.url.split("?")[1] : null,
  }]);
  const hs = path.match(/^\/hs\/(\d+)$/);
  if (hs) {
    sock.end(`HTTP/1.1 ${hs[1]} X\r\nContent-Length: 2\r\nConnection: close\r\n${hs[1][0] === "3" ? "Location: /echo\r\n" : ""}\r\nok`);
    return;
  }
  if (path === "/hs-garbage") { sock.end("SSH-2.0-OpenSSH_9\r\n"); return; }
  if (path === "/hs-nobody-close") { sock.destroy(); return; }
  if (path === "/hs-hang") return;
  if (path === "/hs-bad-accept") {
    sock.end("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: AAAA\r\n\r\n");
    return;
  }
  if (path === "/hs-no-upgrade-hdr") {
    sock.end("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\n\r\n");
    return;
  }
  if (path === "/hs-200-ws") {
    sock.end("HTTP/1.1 200 OK\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nContent-Length: 0\r\n\r\n");
    return;
  }
  if (path === "/hs-subproto") {
    const w = path === "/hs-subproto" ? wss : wss;
    w.handleUpgrade(req, sock, head, (ws) => { behave(ws, path, sock); });
    return;
  }
  const server = path === "/nopong" ? wssNoPong : wss;
  server.handleUpgrade(req, sock, head, (ws) => behave(ws, path, sock));
}

const httpSrv = createServer();
httpSrv.on("upgrade", onUpgrade);
httpSrv.on("request", (req, res) => { res.statusCode = 200; res.end("plain http"); });
await new Promise((r) => httpSrv.listen(0, "127.0.0.1", r));
const PORT = httpSrv.address().port;

// self-signed TLS server for wss://
import { execFileSync } from "node:child_process";
const keyF = join(tmp, "k.pem"), crtF = join(tmp, "c.pem");
let tlsPort = 0, tlsSrv = null;
try {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyF, "-out", crtF, "-days", "2", "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
  const { readFileSync } = await import("node:fs");
  tlsSrv = createTls({ key: readFileSync(keyF), cert: readFileSync(crtF) });
  tlsSrv.on("upgrade", onUpgrade);
  await new Promise((r) => tlsSrv.listen(0, "127.0.0.1", r));
  tlsPort = tlsSrv.address().port;
} catch { /* openssl absent: wss scenarios skipped */ }

// tiny CONNECT-capable HTTP proxy that records what was asked
let PROXY_LOG = [];
const proxySrv = net.createServer((c) => {
  c.once("data", (d) => {
    PROXY_LOG.push(d.toString().split("\r\n")[0]);
    c.destroy();
  });
});
await new Promise((r) => proxySrv.listen(0, "127.0.0.1", r));
const PROXY_PORT = proxySrv.address().port;

const U = (p, q = "") => `ws://127.0.0.1:${PORT}${p}${q}`;
const C = { op: "connect" };
const R = (t = 3) => ({ op: "recv", t });
const S = [];
const add = (name, sc, extra = {}) => S.push({ name, sc: { url: U("/echo"), steps: [C], ...sc }, ...extra });

add("echo-text", { steps: [C, { op: "send", d: "hi" }, R(), { op: "close" }] });
add("echo-unicode", { steps: [C, { op: "send", d: "héllo ✓ 𝒜 \u0000 \r\n" }, R(), { op: "close" }] });
add("echo-binary", { steps: [C, { op: "sendbin", d: "00ff10" }, R(), { op: "close" }] });
add("echo-empty-text", { steps: [C, { op: "send", d: "" }, R(), { op: "close" }] });
add("echo-empty-bin", { steps: [C, { op: "sendbin", d: "" }, R(), { op: "close" }] });
add("echo-1mib", { steps: [C, { op: "sendbig", n: 2 ** 20 }, R(10), { op: "close" }] });
add("echo-1mib-plus-1", { steps: [C, { op: "sendbig", n: 2 ** 20 + 1 }, R(10), { op: "state" }, { op: "close" }] });
add("echo-custom-header", { headers: { "X-Adv": "v1", Authorization: "Bearer t" }, steps: [C, { op: "close" }] });
add("echo-header-unicode", { headers: { "X-Adv": "caf\u00e9" }, steps: [C, { op: "close" }] });
add("echo-header-newline", { headers: { "X-Adv": "a\r\nInjected: 1" }, steps: [C, { op: "close" }] });
add("echo-header-empty", { headers: { "X-Adv": "" }, steps: [C, { op: "close" }] });
add("echo-header-override-origin", { headers: { Origin: "http://evil.example" }, steps: [C, { op: "close" }] });
add("echo-header-override-ext", { headers: { "Sec-WebSocket-Protocol": "chat" }, steps: [C, { op: "close" }] });
add("echo-header-host", { headers: { Host: "other.example" }, steps: [C, { op: "close" }] });
add("echo-query", { url: U("/echo", "?a=1&b=%20x"), steps: [C, { op: "close" }] });
add("echo-userinfo", { url: `ws://user:pw@127.0.0.1:${PORT}/echo`, steps: [C, { op: "close" }] });
add("echo-ipv6-literal-refused", { url: "ws://[::1]:1/echo", steps: [C] });
add("echo-double-connect", { steps: [C, C, { op: "send", d: "x" }, R(), { op: "close" }] });
add("send-before-connect", { steps: [{ op: "send", d: "x" }] });
add("recv-before-connect", { steps: [R(1)] });
add("iter-before-connect", { steps: [{ op: "iter", max: 3 }] });
add("close-before-connect", { steps: [{ op: "close" }, { op: "state" }] });
add("send-after-close", { steps: [C, { op: "close" }, { op: "send", d: "x" }] });
add("recv-after-close", { steps: [C, { op: "close" }, R(1)] });
add("recv-timeout", { steps: [C, R(0.3), R(0.3), { op: "state" }, { op: "close" }] });
add("recv-timeout-zero", { steps: [C, R(0), { op: "close" }] });
add("recv-timeout-negative", { steps: [C, R(-1), { op: "close" }] });
add("recv-timeout-then-msg", { steps: [C, R(0.2), { op: "send", d: "late" }, R(2), { op: "close" }] });
add("many-then-iter", { url: U("/many"), steps: [C, { op: "iter", max: 50 }, { op: "close" }] });
add("many-partial-iter-then-recv", { url: U("/many"), steps: [C, { op: "iter", max: 3 }, R(), { op: "close" }] });
add("multi-byte", { url: U("/multi-byte"), steps: [C, R(), { op: "close" }] });
for (const [n, u] of [
  ["close-1000", "/close/1000"], ["close-1000-reason", "/close/1000/bye"], ["close-1001", "/close/1001/away"],
  ["close-1002", "/close/1002"], ["close-1008-reason", "/close/1008/policy%20x"], ["close-1011", "/close/1011/boom"],
  ["close-4000", "/close/4000/app"], ["close-3000", "/close/3000"], ["close-1012", "/close/1012"], ["close-1013", "/close/1013"],
  ["close-empty", "/close-empty"],
  ["close-bad-reason", "/close-bad-reason"], ["close-1-byte", "/close-1-byte"], ["close-invalid-code", "/close-invalid-code"],
]) {
  add(`${n}-recv`, { url: U(u), steps: [C, R(2), { op: "state" }, R(1), { op: "send", d: "x" }, { op: "close" }] });
  add(`${n}-iter`, { url: U(u), steps: [C, { op: "iter", max: 5 }, { op: "state" }, { op: "close" }] });
  add(`${n}-send-after`, { url: U(u), steps: [C, { op: "sleep", s: 0.4 }, { op: "send", d: "x" }, { op: "state" }] });
}
add("greet-then-close-recv", { url: U("/greet-then-close"), steps: [C, R(), R(), R(), { op: "close" }] });
add("greet-then-close-iter", { url: U("/greet-then-close"), steps: [C, { op: "iter", max: 9 }, { op: "close" }] });
add("greet-then-1001-iter", { url: U("/greet-then-1001"), steps: [C, { op: "iter", max: 9 }, { op: "close" }] });
add("greet-then-abrupt-recv", { url: U("/greet-then-abrupt"), steps: [C, R(), R(), { op: "close" }] });
add("greet-then-abrupt-iter", { url: U("/greet-then-abrupt"), steps: [C, { op: "iter", max: 9 }, { op: "close" }] });
add("abrupt-recv", { url: U("/abrupt"), steps: [C, R(), { op: "close" }] });
add("abrupt-iter", { url: U("/abrupt"), steps: [C, { op: "iter", max: 9 }, { op: "close" }] });
add("abrupt-send-late", { url: U("/abrupt"), steps: [C, { op: "sleep", s: 0.4 }, { op: "send", d: "x" }] });
add("abrupt-rst-recv", { url: U("/abrupt-rst"), steps: [C, R(), { op: "close" }] });
add("close-on-msg", { url: U("/close-on-msg"), steps: [C, { op: "send", d: "x" }, R(), { op: "close" }] });
add("big-text-ok", { url: U("/big-text"), steps: [C, R(10), { op: "close" }] });
add("big-text-over", { url: U("/big-text-over"), steps: [C, R(10), { op: "state" }, { op: "close" }] });
add("big-bin-over-iter", { url: U("/big-bin-over"), steps: [C, { op: "iter", max: 2 }, { op: "close" }] });
add("invalid-utf8-text", { url: U("/invalid-utf8-text"), steps: [C, R(2), { op: "close" }] });
add("bad-opcode", { url: U("/bad-opcode"), steps: [C, R(2), { op: "close" }] });
add("rsv-bit", { url: U("/rsv-bit"), steps: [C, R(2), { op: "close" }] });
add("masked-from-server", { url: U("/masked-from-server"), steps: [C, R(2), { op: "close" }] });
add("frag-then-close", { url: U("/frag-then-close"), steps: [C, R(2), { op: "close" }] });
add("ping-flood", { url: U("/ping-flood"), steps: [C, R(0.5), { op: "send", d: "a" }, R(1), { op: "close" }] });
add("no-pong-keepalive", { url: U("/nopong"), ping: 1, steps: [C, R(6), { op: "state" }, { op: "close" }] }, { slow: true });
add("no-pong-keepalive-iter", { url: U("/nopong"), ping: 1, steps: [C, { op: "iter", max: 3 }, { op: "close" }] }, { slow: true });
add("pong-ok-long", { url: U("/echo"), ping: 1, steps: [C, { op: "sleep", s: 3.5 }, { op: "send", d: "x" }, R(), { op: "close" }] }, { slow: true });
for (const code of [200, 204, 301, 302, 307, 400, 401, 403, 404, 426, 429, 500, 502, 503, 101]) {
  add(`hs-${code}`, { url: U(`/hs/${code}`), steps: [C, { op: "state" }, { op: "close" }] });
}
add("hs-garbage", { url: U("/hs-garbage"), steps: [C] });
add("hs-closed", { url: U("/hs-nobody-close"), steps: [C] });
add("hs-bad-accept", { url: U("/hs-bad-accept"), steps: [C] });
add("hs-no-upgrade-header", { url: U("/hs-no-upgrade-hdr"), steps: [C] });
add("hs-200-ws", { url: U("/hs-200-ws"), steps: [C] });
add("hs-hang", { url: U("/hs-hang"), steps: [C] }, { slow: true });
add("plain-http-server", { url: U("/echo"), steps: [C] }, {});
add("refused", { url: "ws://127.0.0.1:1/x", steps: [C] });
add("refused-localhost", { url: "ws://localhost:1/x", steps: [C] });
add("dns-fail", { url: "ws://adv-no-such-host.invalid/x", steps: [C] });
for (const [n, u] of [
  ["url-http", "http://127.0.0.1:1/x"], ["url-https", "https://127.0.0.1:1/x"], ["url-noscheme", "127.0.0.1:1/x"],
  ["url-empty", ""], ["url-ftp", "ftp://127.0.0.1/x"], ["url-wss-no-host", "wss:///x"], ["url-ws-no-host", "ws://"],
  ["url-bad-port", "ws://127.0.0.1:99999/x"], ["url-port-nan", "ws://127.0.0.1:abc/x"], ["url-fragment", "ws://127.0.0.1:1/x#frag"],
  ["url-space", "ws://127.0.0.1:1/a b"], ["url-uppercase-scheme", "WS://127.0.0.1:1/x"],
]) add(n, { url: u, steps: [C] });
if (tlsPort) {
  const W = (p) => `wss://127.0.0.1:${tlsPort}${p}`;
  add("wss-untrusted", { url: W("/echo"), steps: [C] });
  add("wss-untrusted-localhost", { url: `wss://localhost:${tlsPort}/echo`, steps: [C] });
  add("wss-trusted-ssl-cert-file", { url: W("/echo"), steps: [C, { op: "send", d: "s" }, R(), { op: "close" }] }, { env: { SSL_CERT_FILE: crtF, NODE_EXTRA_CA_CERTS: crtF } });
  add("wss-trusted-wrong-host", { url: `wss://127.0.0.2:${tlsPort}/echo`, steps: [C] }, { env: { SSL_CERT_FILE: crtF, NODE_EXTRA_CA_CERTS: crtF } });
  add("wss-to-plain-port", { url: `wss://127.0.0.1:${PORT}/echo`, steps: [C] });
  add("ws-to-tls-port", { url: `ws://127.0.0.1:${tlsPort}/echo`, steps: [C] });
}
for (const [n, env] of [
  ["proxy-http", { HTTP_PROXY: `http://127.0.0.1:${PROXY_PORT}`, http_proxy: `http://127.0.0.1:${PROXY_PORT}` }],
  ["proxy-https-var", { HTTPS_PROXY: `http://127.0.0.1:${PROXY_PORT}`, https_proxy: `http://127.0.0.1:${PROXY_PORT}` }],
  ["proxy-all", { ALL_PROXY: `http://127.0.0.1:${PROXY_PORT}`, all_proxy: `http://127.0.0.1:${PROXY_PORT}` }],
  ["proxy-all-no-proxy-match", { ALL_PROXY: `http://127.0.0.1:${PROXY_PORT}`, NO_PROXY: "127.0.0.1" }],
  ["proxy-socks", { ALL_PROXY: `socks5://127.0.0.1:${PROXY_PORT}` }],
  ["proxy-garbage", { ALL_PROXY: "not a url" }],
]) add(n, { url: U("/echo"), steps: [C, { op: "send", d: "x" }, R(2), { op: "close" }] }, { env, proxyLog: true });

function normaliseLog(log) {
  return log.map(([p, k, v]) => {
    if (k === "upgrade") v = { ...v, query: v.query };
    return [p, k, v];
  });
}
function normalise(s) {
  return s
    .replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:PORT")
    .replace(/\('127\.0\.0\.1', \d+\)/g, "('127.0.0.1', PORT)")
    .replace(/port \d+/g, "port N");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runScenario(s) {
  const sc = { ...s.sc };
  const envx = s.env || {};
  const results = [];
  for (const side of ["py", "ts"]) {
    LOG = [];
    PROXY_LOG = [];
    const sc2 = JSON.parse(JSON.stringify(sc));
    const scr = { ...sc2 };
    const prevEnv = {};
    for (const [k, v] of Object.entries(envx)) { prevEnv[k] = process.env[k]; process.env[k] = v; }
    for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"]) {
      if (!(k in envx)) { prevEnv[k] = process.env[k]; delete process.env[k]; }
    }
    if (!envx.SSL_CERT_FILE) { prevEnv.SSL_CERT_FILE = process.env.SSL_CERT_FILE; delete process.env.SSL_CERT_FILE; }
    const r = await (side === "py" ? runPy(scr) : runTs(scr));
    for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await sleep(120);
    results.push({
      out: normalise(r.o || `(no output) ${normalise(r.e)}`),
      log: normalise(JSON.stringify(normaliseLog(LOG))),
      proxy: s.proxyLog ? normalise(JSON.stringify(PROXY_LOG)) : "",
    });
  }
  return results;
}

let todo = S.filter((s) => !FILTER || FILTER.test(s.name));
if (flag("--list")) { for (const s of S) console.log(s.name); process.exit(0); }
let diffs = 0, same = 0;
const CONC = Number(process.env.ADV_WS_CONCURRENCY || 1);
for (const s of todo) {
  const [py, ts] = await runScenario(s);
  const ident = py.out === ts.out && py.log === ts.log && py.proxy === ts.proxy;
  if (ident) {
    same++;
    if (VERBOSE) console.log(`OK    ${s.name}\n      ${py.out.slice(0, 300)}`);
  } else {
    diffs++;
    console.log(`DIFF  ${s.name}`);
    if (py.out !== ts.out) console.log(`   py  out: ${py.out.slice(0, 600)}\n   ts  out: ${ts.out.slice(0, 600)}`);
    if (py.log !== ts.log) console.log(`   py  srv: ${py.log.slice(0, 600)}\n   ts  srv: ${ts.log.slice(0, 600)}`);
    if (py.proxy !== ts.proxy) console.log(`   py proxy: ${py.proxy}\n   ts proxy: ${ts.proxy}`);
  }
}
console.log(`[adv_core_ws] scenarios=${todo.length} identical=${same} diffs=${diffs}`);
httpSrv.close(); tlsSrv?.close(); proxySrv.close();
rmSync(tmp, { recursive: true, force: true });
process.exit(diffs ? 1 : 0);
