#!/usr/bin/env node
/**
 * ADV-core: differential of the httpx shim / transport layer. A raw-socket (and TLS) misbehaving server is started per
 * scenario; the SAME `abx` argv is run against the Python oracle and the Node CLI (isolated HOME, scrubbed env) and the
 * stdout / stderr / exit code and the raw request bytes the server received (header names+values, minus user-agent)
 * are compared.
 *
 *   ORACLE_VENV=/path/to/venv node parity/diff/adv_core_net.mjs [--filter re] [--verbose] [--list]
 *
 * Exit: 0 identical, 1 differences, 2 oracle missing (skipped cleanly).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import * as http2 from "node:http2";
import * as net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import * as tls from "node:tls";
import { fileURLToPath } from "node:url";
import { gzipSync, deflateSync, brotliCompressSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, "..", "..");
const ORACLE_VENV = process.env.ORACLE_VENV;
const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const filterIdx = args.indexOf("--filter");
const FILTER = filterIdx >= 0 ? new RegExp(args[filterIdx + 1], "i") : null;

if (!ORACLE_VENV || !existsSync(join(ORACLE_VENV, "bin", "abx"))) {
  console.error("[adv_core_net] ORACLE_VENV not set / missing: SKIPPED");
  process.exit(2);
}
const ORACLE = join(ORACLE_VENV, "bin", "abx");

const root = realpathSync(mkdtempSync(join(tmpdir(), "adv-net-")));

// ---- certificates (self-signed, SAN 127.0.0.1/localhost; plus a mismatching one) ----------------------------------
function mkCert(name, cn, san, days = 30) {
  const key = join(root, `${name}.key`);
  const crt = join(root, `${name}.crt`);
  const r = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", crt, "-days", String(days), "-subj", `/CN=${cn}`, "-addext", `subjectAltName=${san}`], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`openssl failed: ${r.stderr}`);
  return { key: readFileSync(key), cert: readFileSync(crt), certPath: crt };
}
const GOOD = mkCert("good", "localhost", "DNS:localhost,IP:127.0.0.1");
const WRONG = mkCert("wrong", "other.example", "DNS:other.example");

// ---- raw server ---------------------------------------------------------------------------------------------------
const CRLF = "\r\n";
const frame = (obj, flags = 0) => {
  const body = Buffer.isBuffer(obj) ? obj : Buffer.from(JSON.stringify(obj));
  const head = Buffer.alloc(5);
  head[0] = flags;
  head.writeUInt32BE(body.length, 1);
  return Buffer.concat([head, body]);
};
const resp = (status, headers, body = "", reason = "") => {
  const b = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const h = { "Content-Length": String(b.length), ...headers };
  const lines = Object.entries(h).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${v}`);
  return Buffer.concat([Buffer.from(`HTTP/1.1 ${status} ${reason}${CRLF}${lines.join(CRLF)}${CRLF}${CRLF}`), b]);
};
const J = (status, obj, headers = {}) => resp(status, { "Content-Type": "application/json", ...headers }, JSON.stringify(obj), status === 200 ? "OK" : "X");

const SANDBOX = (origin) => ({ sandboxID: "sbx-1", templateID: "base", state: "running", cpuCount: 2, memoryMB: 2048, startedAt: "2026-01-02T03:04:05Z", endAt: "2026-01-02T03:09:05Z", envdVersion: "0.5.2", metadata: {}, envdUrl: origin, envdAccessToken: "tok" });
const okStream = () => Buffer.concat([
  frame({ event: { start: { pid: 7 } } }),
  frame({ event: { data: { stdout: Buffer.from("hi\n").toString("base64") } } }),
  frame({ event: { end: { exitCode: 0, exited: true, status: "exited" } } }),
  frame({}, 2),
]);
const streamResp = (body, extra = {}) => resp(200, { "Content-Type": "application/connect+json", ...extra }, body, "OK");

/** Default behaviour: platform JSON + well formed envd stream. */
function defaultRespond(req, ctx) {
  const path = req.path.split("?")[0];
  if (path === "/sandboxes" && req.method === "GET") return J(200, [SANDBOX(ctx.origin)]);
  if (/^\/sandboxes\/[^/]+$/.test(path) && req.method === "GET") return J(200, SANDBOX(ctx.origin));
  if (path === "/process.Process/Start") return streamResp(okStream());
  return J(404, { code: 404, message: "no route" });
}

async function startServer(scn) {
  const reqs = [];
  const sockets = new Set();
  const state = { n: 0 };
  const handleConn = (sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    sock.on("error", () => {});
    let buf = Buffer.alloc(0);
    let busy = false;
    const ctx = { get origin() { return scn._origin; }, port: () => server.address().port };
    const tryParse = () => {
      if (busy) return;
      const idx = buf.indexOf("\r\n\r\n");
      if (idx < 0) return;
      const headText = buf.subarray(0, idx).toString("latin1");
      const lines = headText.split("\r\n");
      const [method, path] = lines[0].split(" ");
      const headers = {};
      const rawHeaders = [];
      for (const l of lines.slice(1)) {
        const i = l.indexOf(":");
        if (i > 0) { headers[l.slice(0, i).toLowerCase()] = l.slice(i + 1).trim(); rawHeaders.push([l.slice(0, i), l.slice(i + 1).trim()]); }
      }
      let bodyStart = idx + 4;
      let body;
      if (method === "CONNECT") body = Buffer.alloc(0);
      else if (/chunked/i.test(headers["transfer-encoding"] ?? "")) {
        const end = buf.indexOf("0\r\n\r\n", bodyStart);
        if (end < 0) return;
        body = buf.subarray(bodyStart, end + 5);
        bodyStart = end + 5;
      } else {
        const len = Number(headers["content-length"] ?? 0);
        if (buf.length < bodyStart + len) return;
        body = buf.subarray(bodyStart, bodyStart + len);
        bodyStart += len;
      }
      buf = buf.subarray(bodyStart);
      const req = { method, path, headers, rawHeaders, body, line: lines[0], compareBody: !!scn.compareBody };
      reqs.push(req);
      busy = true;
      const i = state.n++;
      Promise.resolve(scn.respond ? scn.respond(req, { ...ctx, i, sock, state }) : undefined).then((r) => {
        if (r === undefined || r === "default") r = defaultRespond(req, ctx);
        busy = false;
        if (r === "hang") return;
        if (r === "close") return sock.destroy();
        if (r === "reset") return sock.resetAndDestroy();
        if (r && r.chunks) {
          (async () => {
            for (const c of r.chunks) {
              if (c === "close") return sock.end();
              if (c === "reset") return sock.resetAndDestroy();
              if (c === "hang") return;
              if (typeof c === "number") { await new Promise((x) => setTimeout(x, c)); continue; }
              sock.write(c);
            }
            if (!r.keep) sock.end();
          })();
          return;
        }
        if (r && r.raw !== undefined) { sock.write(r.raw); if (r.end !== false) sock.end(); return; }
        sock.write(r);
        tryParse();
      });
    };
    sock.on("data", (d) => { buf = Buffer.concat([buf, d]); tryParse(); });
    return ctx;
  };
  let server;
  if (scn.tls === "h2") {
    server = http2.createSecureServer({ ...(scn.cert ?? GOOD), allowHTTP1: false });
    server.on("stream", (stream, headers) => {
      const chunks = [];
      stream.on("data", (d) => chunks.push(d));
      stream.on("end", () => {
        reqs.push({ method: headers[":method"], path: headers[":path"], headers: Object.fromEntries(Object.entries(headers).filter(([k]) => !k.startsWith(":"))), rawHeaders: [], body: Buffer.concat(chunks), line: `${headers[":method"]} ${headers[":path"]} HTTP/2`, h2: true });
        const body = JSON.stringify([SANDBOX(scn._origin)]);
        stream.respond({ ":status": 200, "content-type": "application/json" });
        stream.end(body);
      });
    });
    server.on("sessionError", () => {});
  } else if (scn.tls) {
    server = tls.createServer({ ...(scn.cert ?? GOOD), ALPNProtocols: scn.alpn ?? ["http/1.1"], ...(scn.tlsOpts ?? {}) }, handleConn);
    server.on("tlsClientError", () => {});
  } else {
    server = net.createServer(handleConn);
  }
  await new Promise((r) => server.listen(scn.port ?? 0, "127.0.0.1", r));
  scn._origin = `${scn.tls ? "https" : "http"}://127.0.0.1:${server.address().port}`;
  return {
    port: server.address().port,
    reqs,
    close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); setTimeout(r, 500); }),
  };
}

// ---- runner -------------------------------------------------------------------------------------------------------
function runCli(bin, argv, env, cwd, timeoutMs = 60000) {
  return new Promise((resolveP) => {
    const [cmd, ...pre] = bin;
    const child = spawn(cmd, [...pre, ...argv], { env, cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let killed = false;
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => { stderr += `spawn error: ${e.message}`; });
    const t = setTimeout(() => { killed = true; child.kill("SIGKILL"); }, timeoutMs);
    child.on("close", (code) => { clearTimeout(t); resolveP({ code: killed ? 124 : code, stdout, stderr }); });
    child.stdin.on("error", () => {});
    child.stdin.end("");
  });
}

const norm = (s, ctx) => String(s)
  .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
  .split(ctx.origin).join("<ORIGIN>")
  .replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:<PORT>")
  .replace(/:\d{4,5}\b/g, ":<PORT>")
  .replace(new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "<TMP>")
  .replace(/\/tmp\/[^\s"']+/g, "<TMPPATH>")
  .split("\n").map((l) => l.replace(/\s+$/g, "")).join("\n").trim();

const normBody = (r) => {
  const ct = r.headers["content-type"] ?? "";
  let t = r.body.toString("latin1");
  const m = /boundary=([^;]+)/.exec(ct);
  if (m) t = t.split(m[1]).join("BOUNDARY");
  if (t.length > 3000) t = `${t.slice(0, 600)}...[${t.length}]...${t.slice(-300)}`;
  return JSON.stringify(t);
};
const normReq = (r) => {
  const hs = r.rawHeaders.length ? r.rawHeaders : Object.entries(r.headers);
  const names = hs.map(([k, v]) => [k.toLowerCase(), v]).filter(([k]) => !["user-agent", "host"].includes(k));
  const host = r.headers.host ?? r.headers[":authority"] ?? "";
  return `${r.line.replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:<PORT>")} | host=${host.replace(/:\d+$/, ":<PORT>")} | ${names.map(([k, v]) => `${k}=${String(v).replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:<PORT>").replace(/^gzip, deflate, br$/, "gzip, deflate").replace(/boundary=[0-9a-f]{32}/, "boundary=BOUNDARY")}`).sort().join("; ")}${r.body.length ? ` | body=${r.body.length}b` : ""}${r.compareBody ? ` | ${normBody(r)}` : ""}`;
};

async function runScenario(scn) {
  const out = {};
  for (const [label, bin] of [["oracle", [ORACLE]], ["node", [join(CLI_ROOT, "node_modules/.bin/tsx"), join(CLI_ROOT, "src/bin/abx.ts")]]]) {
    const server = await startServer(scn);
    const home = join(root, `${scn.id}-${label}-home`);
    const cwd = join(root, `${scn.id}-${label}-cwd`);
    mkdirSync(home, { recursive: true });
    mkdirSync(cwd, { recursive: true });
    scn.setup?.(home, cwd, server);
    const origin = scn._origin;
    const env = {
      PATH: process.env.PATH,
      HOME: home,
      USERPROFILE: home,
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      TERM: "dumb",
      NO_COLOR: "1",
      COLUMNS: "120",
      PYTHONUNBUFFERED: "1",
      ABX_NO_KEYCHAIN: "1",
      E2B_API_KEY: "k-adv-0123456789abcdef",
      E2B_API_URL: scn.apiUrl ? scn.apiUrl(origin, server) : origin,
      E2B_DOMAIN: "adv.invalid",
      SANDBOX_HTTP_TIMEOUT: "2",
    };
    for (const [k, v] of Object.entries(typeof scn.env === "function" ? scn.env(origin, server) : (scn.env ?? {}))) { if (v === null) delete env[k]; else env[k] = v; }
    const res = await runCli(bin, scn.argv ?? ["--json", "list"], env, cwd, scn.timeoutMs ?? 60000);
    await new Promise((r) => setTimeout(r, 100));
    const ctx = { origin };
    out[label] = {
      code: res.code,
      stdout: norm(res.stdout, ctx),
      stderr: norm(res.stderr, ctx),
      reqs: server.reqs.map(normReq),
    };
    await server.close();
    scn._origin = undefined;
  }
  return out;
}

// ---- scenarios ----------------------------------------------------------------------------------------------------
const S = [];
const add = (id, scn) => S.push({ id, ...scn });
const LIST = ["--json", "list"];
const EXEC = ["exec", "sbx-1", "echo hi"];
const TRUST_GOOD = () => ({ SSL_CERT_FILE: GOOD.certPath, NODE_EXTRA_CA_CERTS: GOOD.certPath });
const raw = (s) => ({ raw: Buffer.from(s) });

add("p-refused", { argv: LIST, port: 0, respond: () => "close", env: (o) => ({ E2B_API_URL: "http://127.0.0.1:1" }) });
add("p-accept-close", { argv: LIST, respond: () => "close" });
add("p-reset", { argv: LIST, respond: () => "reset" });
add("p-partial-head", { argv: LIST, respond: () => raw("HTTP/1.1 200 OK\r\nContent-Le") });
add("p-garbage", { argv: LIST, respond: () => raw("garbage\r\n\r\n") });
add("p-garbage2", { argv: LIST, respond: () => raw("\x00\x01\x02binary") });
add("p-short-body", { argv: LIST, respond: () => raw("HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\n[]") });
add("p-chunk-trunc", { argv: LIST, respond: () => raw("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\n[{\"a\"") });
add("p-chunk-bad-size", { argv: LIST, respond: () => raw("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nZZ\r\n[]\r\n0\r\n\r\n") });
add("p-hang-head", { argv: LIST, respond: () => "hang", timeoutMs: 30000 });
add("p-hang-body", { argv: LIST, respond: () => ({ chunks: ["HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n[", "hang"] }), timeoutMs: 30000 });
add("p-slow-body-ok", { argv: LIST, respond: () => ({ chunks: ["HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n[", 1500, "]"] }), timeoutMs: 30000 });
add("p-slow-trickle", { argv: LIST, respond: () => ({ chunks: ["HTTP/1.1 200 OK\r\nContent-Length: 6\r\n\r\n", 1200, "[", 1200, " ", 1200, " ", 1200, " ", 1200, " ", 1200, "]"] }), timeoutMs: 30000 });
for (const [code, reason] of [[301, "Moved Permanently"], [302, "Found"], [303, "See Other"], [307, "Temporary Redirect"], [308, "Permanent Redirect"]]) {
  add(`p-redirect-${code}`, { argv: LIST, respond: (r, c) => (r.path === "/sandboxes" ? resp(code, { Location: "/elsewhere" }, "", reason) : J(200, [])) });
}
add("p-redirect-abs", { argv: LIST, respond: (r, c) => resp(302, { Location: `${c.origin}/sandboxes` }, "", "Found") });
add("p-redirect-nolocation", { argv: LIST, respond: () => resp(302, {}, "", "Found") });
add("p-redirect-300", { argv: LIST, respond: () => resp(300, { Location: "/x" }, "", "Multiple Choices") });
add("p-304", { argv: LIST, respond: () => resp(304, {}, "", "Not Modified") });
for (const [id, body, ct] of [["invalid-json", "{not json", "application/json"], ["empty", "", "application/json"], ["null", "null", "application/json"], ["obj", "{}", "application/json"], ["str", '"x"', "application/json"], ["html", "<html>x</html>", "text/html"], ["bom", "\ufeff[]", "application/json"], ["latin1-charset", "[]", "application/json; charset=latin-1"], ["utf16", "[]", "application/json; charset=utf-16"], ["bad-charset", "[]", "application/json; charset=bogus"], ["nan", "[NaN]", "application/json"], ["bigint", '[{"sandboxID":"x","timeout":123456789012345678901234567890}]', "application/json"], ["dupkeys", '[{"sandboxID":"a","sandboxID":"b"}]', "application/json"], ["lone-surrogate", '[{"sandboxID":"\\ud800"}]', "application/json"], ["deep", "[".repeat(2000) + "]".repeat(2000), "application/json"], ["badutf8", Buffer.from([0x5b, 0x22, 0xff, 0x22, 0x5d]), "application/json"]]) {
  add(`p-body-${id}`, { argv: LIST, respond: () => resp(200, { "Content-Type": ct }, body, "OK") });
}
const GZ = (s) => gzipSync(Buffer.from(s));
for (const [id, enc, body] of [["gzip", "gzip", GZ("[]")], ["gzip-bad", "gzip", Buffer.from("not gzip")], ["gzip-trunc", "gzip", GZ('[{"sandboxID":"abcdefghijklmnop"}]').subarray(0, 12)], ["deflate", "deflate", deflateSync(Buffer.from("[]"))], ["deflate-bad", "deflate", Buffer.from("zzzz")], ["br", "br", brotliCompressSync(Buffer.from("[]"))], ["unknown", "foo", Buffer.from("[]")], ["identity", "identity", Buffer.from("[]")], ["gzip-gzip", "gzip, gzip", GZ(GZ("[]").toString("latin1"))], ["zstd", "zstd", Buffer.from("[]")], ["x-gzip", "x-gzip", GZ("[]")], ["uppercase", "GZIP", GZ("[]")], ["gzip-trailing-garbage", "gzip", Buffer.concat([GZ("[]"), Buffer.from("junk")])], ["empty-gzip", "gzip", Buffer.alloc(0)]]) {
  add(`p-enc-${id}`, { argv: LIST, respond: () => resp(200, { "Content-Type": "application/json", "Content-Encoding": enc }, body, "OK") });
}
add("p-bighead", { argv: LIST, respond: () => resp(200, { "Content-Type": "application/json", "X-Big": "a".repeat(70000) }, "[]", "OK") });
add("p-bighead-count", { argv: LIST, respond: () => resp(200, Object.fromEntries([["Content-Type", "application/json"], ...Array.from({ length: 200 }, (_, i) => [`X-H${i}`, "v"])]), "[]", "OK") });
add("p-http10-close-delim", { argv: LIST, respond: () => raw("HTTP/1.0 200 OK\r\nContent-Type: application/json\r\n\r\n[]") });
add("p-http-no-reason", { argv: LIST, respond: () => raw("HTTP/1.1 200\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n[]") });
add("p-http-lowercase", { argv: LIST, respond: () => raw("http/1.1 200 OK\r\nContent-Length: 2\r\n\r\n[]") });
add("p-http2-line", { argv: LIST, respond: () => raw("HTTP/2.0 200 OK\r\nContent-Length: 2\r\n\r\n[]") });
add("p-http11-bare-lf", { argv: LIST, respond: () => raw("HTTP/1.1 200 OK\nContent-Type: application/json\nContent-Length: 2\n\n[]") });
add("p-status-99", { argv: LIST, respond: () => raw("HTTP/1.1 99 X\r\nContent-Length: 0\r\n\r\n") });
add("p-status-600", { argv: LIST, respond: () => raw("HTTP/1.1 600 Weird\r\nContent-Length: 0\r\n\r\n") });
add("p-status-1000", { argv: LIST, respond: () => raw("HTTP/1.1 1000 Weird\r\nContent-Length: 0\r\n\r\n") });
add("p-100-continue", { argv: LIST, respond: () => ({ raw: Buffer.concat([Buffer.from("HTTP/1.1 100 Continue\r\n\r\n"), J(200, [])]) }) });
add("p-103-early", { argv: LIST, respond: () => ({ raw: Buffer.concat([Buffer.from("HTTP/1.1 103 Early Hints\r\nLink: </x>\r\n\r\n"), J(200, [])]) }) });
add("p-101", { argv: LIST, respond: () => raw("HTTP/1.1 101 Switching Protocols\r\nUpgrade: x\r\nConnection: Upgrade\r\n\r\n") });
add("p-dup-cl", { argv: LIST, respond: () => raw("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Length: 3\r\n\r\n[] ") });
add("p-te-and-cl", { argv: LIST, respond: () => raw("HTTP/1.1 200 OK\r\nContent-Length: 50\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n[]\r\n0\r\n\r\n") });
add("p-cl-neg", { argv: LIST, respond: () => raw("HTTP/1.1 200 OK\r\nContent-Length: -1\r\n\r\n[]") });
add("p-header-ws", { argv: LIST, respond: () => raw("HTTP/1.1 200 OK\r\nContent-Length : 2\r\n\r\n[]") });
add("p-header-folded", { argv: LIST, respond: () => raw("HTTP/1.1 200 OK\r\nX-A: 1\r\n 2\r\nContent-Length: 2\r\n\r\n[]") });
add("p-header-nocolon", { argv: LIST, respond: () => raw("HTTP/1.1 200 OK\r\nBadHeader\r\nContent-Length: 2\r\n\r\n[]") });
add("p-head-latin1", { argv: LIST, respond: () => ({ raw: Buffer.concat([Buffer.from("HTTP/1.1 200 OK\r\nX-Name: caf"), Buffer.from([0xe9]), Buffer.from("\r\nContent-Length: 2\r\n\r\n[]")]) }) });
for (const [code, extra] of [[429, { "Retry-After": "1" }], [429, { "Retry-After": "0" }], [429, { "Retry-After": "-5" }], [429, { "Retry-After": "abc" }], [429, { "Retry-After": "Wed, 21 Oct 2099 07:28:00 GMT" }], [429, {}], [503, { "Retry-After": "1" }], [500, {}], [502, {}], [504, {}], [401, {}], [403, {}], [404, {}], [409, {}], [422, {}], [418, {}], [400, {}], [413, {}], [507, {}]]) {
  for (const body of [JSON.stringify({ code: code, message: "msg here" }), "plain text error", "", "x".repeat(5000), JSON.stringify({ error: { message: "nested" } })]) {
    add(`p-status-${code}-${Object.values(extra)[0] ?? "none"}-${body.length}`, { argv: LIST, respond: () => resp(code, { "Content-Type": body.startsWith("{") ? "application/json" : "text/plain", ...extra }, body, "Err"), timeoutMs: 90000 });
  }
}
add("p-keepalive-close", { argv: LIST, respond: (r) => J(200, [], { Connection: "close" }) });
add("p-conn-keepalive-twice", { argv: ["--json", "info", "sbx-1"], respond: (r, c) => (c.i === 0 ? J(200, SANDBOX(c.origin), { Connection: "keep-alive" }) : "default") });

// api url shapes
for (const [id, fn] of [
  ["prefix", (o) => `${o}/prefix`], ["prefix-slash", (o) => `${o}/prefix/`], ["userinfo", (o) => o.replace("//", "//user:p%40ss@")], ["query", (o) => `${o}?a=b`], ["double-slash", (o) => `${o}//`],
  ["fragment", (o) => `${o}#frag`], ["noscheme", (o) => o.replace("http://", "")], ["upper-scheme", (o) => o.replace("http", "HTTP")], ["ws-scheme", (o) => o.replace("http", "ws")], ["ftp", (o) => o.replace("http", "ftp")], ["ipv6", (o) => o.replace("127.0.0.1", "[::1]")], ["localhost", (o) => o.replace("127.0.0.1", "localhost")],
  ["trailing-spaces", (o) => ` ${o} `], ["unicode-host", (o) => o.replace("127.0.0.1", "例え.invalid")], ["space-in-host", (o) => o.replace("127.0.0.1", "a b")], ["bad-port", (o) => o.replace(/:\d+$/, ":99999")], ["empty-port", (o) => o.replace(/:\d+$/, ":")], ["port0", (o) => o.replace(/:\d+$/, ":0")], ["dot-segments", (o) => `${o}/a/../b/./c`], ["encoded-path", (o) => `${o}/a%2Fb/%e4%b8%ad`], ["unicode-path", (o) => `${o}/中文`], ["only-scheme", () => "http://"], ["just-colon", () => "http:"], ["host-only", () => "example.invalid"],
]) {
  add(`u-${id}`, { argv: LIST, apiUrl: (o) => fn(o), respond: (r) => J(200, []) });
}

// proxies (apiUrl points to an unresolvable host, the "proxy" is the raw server)
add("x-http-proxy", { argv: LIST, apiUrl: () => "http://target.invalid:8080", env: (o) => ({ HTTP_PROXY: o }), respond: () => J(200, []) });
add("x-http-proxy-lower", { argv: LIST, apiUrl: () => "http://target.invalid:8080", env: (o) => ({ http_proxy: o }), respond: () => J(200, []) });
add("x-http-proxy-both-cases", { argv: LIST, apiUrl: () => "http://target.invalid:8080", env: (o) => ({ http_proxy: o, HTTP_PROXY: "http://127.0.0.1:1" }), respond: () => J(200, []) });
add("x-all-proxy", { argv: LIST, apiUrl: () => "http://target.invalid:8080", env: (o) => ({ ALL_PROXY: o }), respond: () => J(200, []) });
add("x-all-proxy-lower", { argv: LIST, apiUrl: () => "http://target.invalid:8080", env: (o) => ({ all_proxy: o }), respond: () => J(200, []) });
add("x-https-proxy-for-http-url", { argv: LIST, apiUrl: () => "http://target.invalid:8080", env: (o) => ({ HTTPS_PROXY: o }), respond: () => J(200, []) });
add("x-proxy-userinfo", { argv: LIST, apiUrl: () => "http://target.invalid:8080", env: (o) => ({ HTTP_PROXY: o.replace("//", "//us%40er:pa%3Ass@") }), respond: () => J(200, []) });
add("x-proxy-noscheme", { argv: LIST, apiUrl: () => "http://target.invalid:8080", env: (o) => ({ HTTP_PROXY: o.replace("http://", "") }), respond: () => J(200, []) });
add("x-proxy-empty", { argv: LIST, env: (o) => ({ HTTP_PROXY: "" }), respond: () => J(200, []) });
add("x-proxy-socks", { argv: LIST, apiUrl: () => "http://target.invalid:8080", env: (o) => ({ HTTP_PROXY: o.replace("http", "socks5") }), respond: () => J(200, []) });
add("x-proxy-garbage", { argv: LIST, apiUrl: () => "http://target.invalid:8080", env: () => ({ HTTP_PROXY: "http://[bad" }), respond: () => J(200, []) });
add("x-proxy-ftp", { argv: LIST, apiUrl: () => "http://target.invalid:8080", env: (o) => ({ HTTP_PROXY: o.replace("http", "ftp") }), respond: () => J(200, []) });
for (const [id, np, url] of [
  ["exact", "target.invalid", "http://target.invalid:8080"], ["suffix", ".invalid", "http://target.invalid:8080"], ["star", "*", "http://target.invalid:8080"], ["port-match", "target.invalid:8080", "http://target.invalid:8080"], ["port-nomatch", "target.invalid:9", "http://target.invalid:8080"],
  ["wildcard-sub", "*.invalid", "http://target.invalid:8080"], ["spaces", " target.invalid , other", "http://target.invalid:8080"], ["upper", "TARGET.INVALID", "http://target.invalid:8080"], ["ip", "127.0.0.1", null], ["cidr", "127.0.0.0/8", null], ["localhost-name", "localhost", "http://localhost:@PORT@"], ["other", "other.invalid", "http://target.invalid:8080"], ["no-dot-suffix", "invalid", "http://target.invalid:8080"],
]) {
  add(`x-no-proxy-${id}`, { argv: LIST, apiUrl: (o) => (url ? url.replace("@PORT@", o.split(":").pop()) : o), env: (o) => ({ HTTP_PROXY: "http://127.0.0.1:1", NO_PROXY: np }), respond: () => J(200, []) });
}
add("x-no-proxy-lower", { argv: LIST, apiUrl: () => "http://target.invalid:8080", env: () => ({ HTTP_PROXY: "http://127.0.0.1:1", no_proxy: "target.invalid" }), respond: () => J(200, []) });
add("x-proxy-implicit-localhost", { argv: LIST, env: () => ({ HTTP_PROXY: "http://127.0.0.1:1" }), respond: () => J(200, []) });
add("x-proxy-implicit-loopback-name", { argv: LIST, apiUrl: (o) => o.replace("127.0.0.1", "localhost"), env: () => ({ HTTP_PROXY: "http://127.0.0.1:1" }), respond: () => J(200, []) });
add("x-https-proxy-connect", { argv: LIST, apiUrl: () => "https://target.invalid:8443", env: (o) => ({ HTTPS_PROXY: o }), respond: (r) => (r.method === "CONNECT" ? raw("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n") : J(200, [])) });
add("x-https-proxy-connect-407", { argv: LIST, apiUrl: () => "https://target.invalid:8443", env: (o) => ({ HTTPS_PROXY: o.replace("//", "//u:p@") }), respond: (r) => (r.method === "CONNECT" ? raw("HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n") : J(200, [])) });
add("x-https-proxy-connect-close", { argv: LIST, apiUrl: () => "https://target.invalid:8443", env: (o) => ({ HTTPS_PROXY: o }), respond: () => "close" });
add("x-https-proxy-connect-200-then-garbage", { argv: LIST, apiUrl: () => "https://target.invalid:8443", env: (o) => ({ HTTPS_PROXY: o }), respond: (r) => ({ raw: Buffer.from("HTTP/1.1 200 Connection established\r\n\r\nGARBAGE-NOT-TLS") }) });
add("x-proxy-down", { argv: LIST, apiUrl: () => "http://target.invalid:8080", env: () => ({ HTTP_PROXY: "http://127.0.0.1:1" }), respond: () => J(200, []) });
add("x-proxy-hang", { argv: LIST, apiUrl: () => "http://target.invalid:8080", env: (o) => ({ HTTP_PROXY: o }), respond: () => "hang", timeoutMs: 30000 });

// TLS
add("t-plain-server-https-url", { argv: LIST, apiUrl: (o) => o.replace("http", "https"), respond: () => J(200, []) });
add("t-selfsigned", { argv: LIST, tls: true, respond: () => J(200, []) });
add("t-selfsigned-sslcertfile", { argv: LIST, tls: true, env: () => ({ SSL_CERT_FILE: GOOD.certPath }), respond: () => J(200, []) });
add("t-selfsigned-sslcertdir", { argv: LIST, tls: true, env: () => { const d = join(root, "certdir"); mkdirSync(d, { recursive: true }); const h = spawnSync("openssl", ["x509", "-hash", "-noout", "-in", GOOD.certPath], { encoding: "utf8" }).stdout.trim(); writeFileSync(join(d, `${h}.0`), readFileSync(GOOD.certPath)); return { SSL_CERT_DIR: d }; }, respond: () => J(200, []) });
add("t-selfsigned-nodeextra", { argv: LIST, tls: true, env: () => ({ NODE_EXTRA_CA_CERTS: GOOD.certPath }), respond: () => J(200, []) });
add("t-selfsigned-requests-ca", { argv: LIST, tls: true, env: () => ({ REQUESTS_CA_BUNDLE: GOOD.certPath, CURL_CA_BUNDLE: GOOD.certPath }), respond: () => J(200, []) });
add("t-sslcertfile-missing", { argv: LIST, tls: true, env: () => ({ SSL_CERT_FILE: "/nonexistent/ca.pem" }), respond: () => J(200, []) });
add("t-sslcertfile-garbage", { argv: LIST, tls: true, env: () => { const p = join(root, "garbage.pem"); writeFileSync(p, "not a cert"); return { SSL_CERT_FILE: p }; }, respond: () => J(200, []) });
add("t-sslcertfile-empty-env", { argv: LIST, tls: true, env: () => ({ SSL_CERT_FILE: "" }), respond: () => J(200, []) });
add("t-wrong-host", { argv: LIST, tls: true, cert: WRONG, env: () => ({ SSL_CERT_FILE: WRONG.certPath, NODE_EXTRA_CA_CERTS: WRONG.certPath }), respond: () => J(200, []) });
add("t-wrong-host-nocert", { argv: LIST, tls: true, cert: WRONG, respond: () => J(200, []) });
add("t-good-trusted-localhost-name", { argv: LIST, tls: true, apiUrl: (o) => o.replace("127.0.0.1", "localhost"), env: () => TRUST_GOOD(), respond: () => J(200, []) });
add("t-handshake-close", { argv: LIST, tls: true, tlsOpts: {}, env: () => TRUST_GOOD(), respond: () => "close" });
add("t-tls-hang-in-handshake", { argv: LIST, apiUrl: (o) => o.replace("http", "https"), respond: () => "hang", timeoutMs: 30000 });
add("t-tls-oldproto", { argv: LIST, tls: true, tlsOpts: { maxVersion: "TLSv1.1", minVersion: "TLSv1", ciphers: "DEFAULT:@SECLEVEL=0" }, env: () => TRUST_GOOD(), respond: () => J(200, []) });
add("t-tls12-only", { argv: LIST, tls: true, tlsOpts: { maxVersion: "TLSv1.2" }, env: () => TRUST_GOOD(), respond: () => J(200, []) });
add("t-good-https-alpn-h2-offered", { argv: LIST, tls: true, alpn: ["h2", "http/1.1"], env: () => TRUST_GOOD(), respond: () => J(200, []) });
add("t-h2-only-server", { argv: LIST, tls: "h2", env: () => TRUST_GOOD() });
add("t-h2-sslverify-fail", { argv: LIST, tls: "h2" });

// envd streaming / unary
const startThen = (...bufs) => Buffer.concat(bufs);
const envdOnly = (fn) => (r, c) => (r.path.startsWith("/process.Process/") ? fn(r, c) : "default");
add("e-ok", { argv: EXEC, respond: () => "default" });
add("e-status-500-json", { argv: EXEC, respond: envdOnly(() => J(500, { code: "unknown", message: "boom" })) });
add("e-status-500-text", { argv: EXEC, respond: envdOnly(() => resp(500, { "Content-Type": "text/plain" }, "plain failure", "X")) });
add("e-status-500-empty", { argv: EXEC, respond: envdOnly(() => resp(500, {}, "", "X")) });
add("e-status-502-html", { argv: EXEC, respond: envdOnly(() => resp(502, { "Content-Type": "text/html" }, "<html><body>Bad gateway</body></html>", "Bad Gateway")) });
add("e-status-500-big", { argv: EXEC, respond: envdOnly(() => resp(500, {}, "é".repeat(20000), "X")) });
add("e-status-500-nested", { argv: EXEC, respond: envdOnly(() => J(500, { error: { code: "x", message: "nested msg" } })) });
add("e-status-500-flat-code", { argv: EXEC, respond: envdOnly(() => J(500, { code: "only_code" })) });
add("e-status-401", { argv: EXEC, respond: envdOnly(() => J(401, { code: "unauthenticated", message: "no" })) });
add("e-status-404", { argv: EXEC, respond: envdOnly(() => J(404, { code: "not_found", message: "no" })) });
add("e-status-429", { argv: EXEC, respond: envdOnly(() => J(429, { code: "resource_exhausted", message: "slow" }, { "Retry-After": "1" })) });
add("e-status-503", { argv: EXEC, respond: envdOnly(() => J(503, { code: "unavailable", message: "later" })) });
add("e-trunc-frame", { argv: EXEC, respond: envdOnly(() => ({ raw: Buffer.concat([Buffer.from("HTTP/1.1 200 OK\r\nContent-Type: application/connect+json\r\nTransfer-Encoding: chunked\r\n\r\n"), Buffer.from("10\r\n"), okStream().subarray(0, 16), Buffer.from("\r\n0\r\n\r\n")]) })) });
add("e-no-end-event", { argv: EXEC, respond: envdOnly(() => streamResp(startThen(frame({ event: { start: { pid: 7 } } }), frame({}, 2)))) });
add("e-only-endstream", { argv: EXEC, respond: envdOnly(() => streamResp(frame({}, 2))) });
add("e-empty-body", { argv: EXEC, respond: envdOnly(() => streamResp("")) });
add("e-endstream-error", { argv: EXEC, respond: envdOnly(() => streamResp(startThen(frame({ event: { start: { pid: 7 } } }), frame({ error: { code: "internal", message: "stream failed" } }, 2)))) });
add("e-endstream-error-nomsg", { argv: EXEC, respond: envdOnly(() => streamResp(startThen(frame({ event: { start: { pid: 7 } } }), frame({ error: { code: "deadline_exceeded" } }, 2)))) });
add("e-frame-invalid-json", { argv: EXEC, respond: envdOnly(() => streamResp(startThen(frame(Buffer.from("{not json")), frame({}, 2)))) });
add("e-frame-non-object", { argv: EXEC, respond: envdOnly(() => streamResp(startThen(frame(Buffer.from("[1,2]")), frame({}, 2)))) });
add("e-frame-gzip-flag", { argv: EXEC, respond: envdOnly(() => streamResp(startThen(frame(gzipSync(Buffer.from(JSON.stringify({ event: { start: { pid: 7 } } }))), 1), frame(gzipSync(Buffer.from(JSON.stringify({ event: { end: { exitCode: 0, exited: true } } }))), 1), frame({}, 2)))) });
add("e-frame-unknown-flag", { argv: EXEC, respond: envdOnly(() => streamResp(startThen(frame({ event: { start: { pid: 7 } } }, 4), frame({ event: { end: { exitCode: 0, exited: true } } }), frame({}, 2)))) });
add("e-frame-huge-len", { argv: EXEC, respond: envdOnly(() => streamResp(Buffer.from([0, 0xff, 0xff, 0xff, 0xff, 1, 2, 3]))) });
add("e-frame-zero-len", { argv: EXEC, respond: envdOnly(() => streamResp(startThen(frame(Buffer.alloc(0)), frame({ event: { end: { exitCode: 0, exited: true } } }), frame({}, 2)))) });
add("e-data-bad-b64", { argv: EXEC, respond: envdOnly(() => streamResp(startThen(frame({ event: { data: { stdout: "***not-b64***" } } }), frame({ event: { end: { exitCode: 0, exited: true } } }), frame({}, 2)))) });
add("e-data-bad-b64-padding", { argv: EXEC, respond: envdOnly(() => streamResp(startThen(frame({ event: { data: { stdout: "aGk" } } }), frame({ event: { end: { exitCode: 0, exited: true } } }), frame({}, 2)))) });
add("e-data-invalid-utf8", { argv: EXEC, respond: envdOnly(() => streamResp(startThen(frame({ event: { data: { stdout: Buffer.from([0xff, 0xfe, 0x41, 0x0a]).toString("base64") } } }), frame({ event: { end: { exitCode: 0, exited: true } } }), frame({}, 2)))) });
add("e-data-not-string", { argv: EXEC, respond: envdOnly(() => streamResp(startThen(frame({ event: { data: { stdout: 5 } } }), frame({ event: { end: { exitCode: 0, exited: true } } }), frame({}, 2)))) });
add("e-exit-code-string", { argv: EXEC, respond: envdOnly(() => streamResp(startThen(frame({ event: { end: { exitCode: "3", exited: true } } }), frame({}, 2)))) });
add("e-exit-code-neg", { argv: EXEC, respond: envdOnly(() => streamResp(startThen(frame({ event: { end: { exitCode: -1, exited: true } } }), frame({}, 2)))) });
add("e-exit-code-256", { argv: EXEC, respond: envdOnly(() => streamResp(startThen(frame({ event: { end: { exitCode: 256, exited: true } } }), frame({}, 2)))) });
add("e-exit-error-field", { argv: EXEC, respond: envdOnly(() => streamResp(startThen(frame({ event: { end: { exitCode: 1, exited: true, status: "exited", error: "cmd failed" } } }), frame({}, 2)))) });
add("e-reset-mid", { argv: EXEC, respond: envdOnly(() => ({ chunks: ["HTTP/1.1 200 OK\r\nContent-Type: application/connect+json\r\nTransfer-Encoding: chunked\r\n\r\n", `${frame({ event: { start: { pid: 7 } } }).length.toString(16)}\r\n`, frame({ event: { start: { pid: 7 } } }), "\r\n", 50, "reset"] })) });
add("e-hang-mid", { argv: ["exec", "--timeout", "1", "sbx-1", "echo hi"], respond: envdOnly(() => ({ chunks: ["HTTP/1.1 200 OK\r\nContent-Type: application/connect+json\r\nTransfer-Encoding: chunked\r\n\r\n", `${frame({ event: { start: { pid: 7 } } }).length.toString(16)}\r\n`, frame({ event: { start: { pid: 7 } } }), "\r\n", "hang"] })), timeoutMs: 40000 });
add("e-hang-head", { argv: ["exec", "--timeout", "1", "sbx-1", "echo hi"], respond: envdOnly(() => "hang"), timeoutMs: 40000 });
add("e-ct-json", { argv: EXEC, respond: envdOnly(() => resp(200, { "Content-Type": "application/json" }, JSON.stringify({}), "OK")) });
add("e-ct-text", { argv: EXEC, respond: envdOnly(() => resp(200, { "Content-Type": "text/plain" }, okStream(), "OK")) });
add("e-gzip-stream", { argv: EXEC, respond: envdOnly(() => streamResp(gzipSync(okStream()), { "Content-Encoding": "gzip" })) });
add("e-connect-content-encoding-header", { argv: EXEC, respond: envdOnly(() => streamResp(okStream(), { "Connect-Content-Encoding": "gzip" })) });
add("e-refused", { argv: EXEC, respond: (r, c) => (r.path.startsWith("/sandboxes") ? J(200, { ...SANDBOX(c.origin), envdUrl: "http://127.0.0.1:1" }) : "default") });
add("e-envd-url-garbage", { argv: EXEC, respond: (r, c) => (r.path.startsWith("/sandboxes") ? J(200, { ...SANDBOX(c.origin), envdUrl: "not a url" }) : "default") });
add("e-envd-url-trailing-slash", { argv: EXEC, respond: (r, c) => (r.path.startsWith("/sandboxes") ? J(200, { ...SANDBOX(c.origin), envdUrl: `${c.origin}/` }) : "default") });
add("e-envd-url-prefix", { argv: EXEC, respond: (r, c) => (r.path.startsWith("/sandboxes") ? J(200, { ...SANDBOX(c.origin), envdUrl: `${c.origin}/pre` }) : "default") });
add("e-envd-url-null", { argv: EXEC, respond: (r, c) => (r.path.startsWith("/sandboxes") ? J(200, { ...SANDBOX(c.origin), envdUrl: null }) : "default") });
add("e-envd-url-https-plain-server", { argv: EXEC, respond: (r, c) => (r.path.startsWith("/sandboxes") ? J(200, { ...SANDBOX(c.origin), envdUrl: c.origin.replace("http", "https") }) : "default") });
add("e-envd-tls-ok", { argv: EXEC, tls: true, env: () => TRUST_GOOD(), respond: (r, c) => "default" });
add("e-envd-tls-selfsigned", { argv: EXEC, tls: true, respond: (r, c) => "default" });
add("e-sandbox-info-bad", { argv: EXEC, respond: () => J(200, { sandboxID: 5 }) });
add("e-sandbox-info-paused", { argv: EXEC, respond: (r, c) => (r.path.startsWith("/sandboxes") ? J(200, { ...SANDBOX(c.origin), state: "paused" }) : "default") });

const wf = (cwd, name, data) => { mkdirSync(dirname(join(cwd, name)), { recursive: true }); writeFileSync(join(cwd, name), data); };
for (const [id, fname, data] of [
  ["basic", "a.txt", "hello\n"], ["empty", "e.txt", ""], ["unicode-name", "文件é.txt", "x"], ["quote-name", 'q"uote.txt', "x"], ["space-name", "a b.txt", "x"], ["backslash-name", "a\\b.txt", "x"], ["semicolon-name", "a;b.txt", "x"], ["newline-name", "a\nb.txt", "x"], ["percent-name", "a%20b.txt", "x"],
  ["binary", "b.bin", Buffer.from([0, 1, 2, 255, 254, 13, 10, 13, 10, 45, 45])], ["png", "p.png", "x"], ["json", "p.json", "{}"], ["noext", "Makefile", "x"], ["tarball", "a.tar.gz", "x"], ["upper-ext", "A.TXT", "x"], ["py", "s.py", "x"], ["csv", "d.csv", "a,b"], ["svg", "i.svg", "<svg/>"], ["wasm", "m.wasm", "x"], ["md", "r.md", "x"], ["yaml", "c.yaml", "a: 1"], ["jsx", "c.jsx", "x"], ["unknown-ext", "c.zzz", "x"], ["dotfile", ".env", "A=1"], ["big", "big.bin", Buffer.alloc(3 * 1024 * 1024, 7)],
]) {
  add(`up-${id}`, { argv: ["upload", "sbx-1", fname, "/app/dest/"], compareBody: true, setup: (h, c) => wf(c, fname, data), respond: (r, c) => (r.path.startsWith("/files") ? resp(200, { "Content-Type": "application/json" }, "[]", "OK") : "default") });
}
add("up-dir", { argv: ["upload", "sbx-1", "d", "/app/x/"], compareBody: true, setup: (h, c) => { wf(c, "d/a.txt", "a"); wf(c, "d/sub/b.txt", "b"); wf(c, "d/.hid", "h"); wf(c, "d/ü.txt", "u"); }, respond: (r, c) => (r.path.startsWith("/files") ? resp(200, { "Content-Type": "application/json" }, "[]", "OK") : "default") });
add("up-resp-500", { argv: ["upload", "sbx-1", "a.txt", "/app/x"], setup: (h, c) => wf(c, "a.txt", "hi"), respond: (r) => (r.path.startsWith("/files") ? resp(500, {}, "oops", "X") : "default") });
add("up-resp-413", { argv: ["upload", "sbx-1", "a.txt", "/app/x"], setup: (h, c) => wf(c, "a.txt", "hi"), respond: (r) => (r.path.startsWith("/files") ? resp(413, { "Content-Type": "application/json" }, JSON.stringify({ message: "too big" }), "X") : "default") });
add("up-resp-200-badjson", { argv: ["upload", "sbx-1", "a.txt", "/app/x"], setup: (h, c) => wf(c, "a.txt", "hi"), respond: (r) => (r.path.startsWith("/files") ? resp(200, {}, "not json", "OK") : "default") });
add("up-resp-reset-after-read", { argv: ["upload", "sbx-1", "a.txt", "/app/x"], setup: (h, c) => wf(c, "a.txt", "hi"), respond: (r) => (r.path.startsWith("/files") ? "reset" : "default") });
for (const [id, hdrs, body] of [["ok", { "Content-Type": "application/octet-stream" }, "data"], ["empty", {}, ""], ["gzip", { "Content-Encoding": "gzip" }, gzipSync(Buffer.from("zipped"))], ["gzip-bad", { "Content-Encoding": "gzip" }, Buffer.from("notgzip")], ["big", {}, Buffer.alloc(5 * 1024 * 1024, 65)]]) {
  add(`down-${id}`, { argv: ["download", "sbx-1", "/app/result.csv", "out.csv"], respond: (r) => (r.path.startsWith("/files") ? resp(200, hdrs, body, "OK") : "default"), artifactsOf: ["out.csv"] });
}
add("down-chunked-trunc", { argv: ["download", "sbx-1", "/app/result.csv", "out.csv"], respond: (r) => (r.path.startsWith("/files") ? { raw: Buffer.from("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhel") } : "default") });
add("down-404", { argv: ["download", "sbx-1", "/app/missing", "out.csv"], respond: (r) => (r.path.startsWith("/files") ? resp(404, { "Content-Type": "application/json" }, JSON.stringify({ code: 404, message: "file not found" }), "Not Found") : "default") });
add("down-416-text", { argv: ["download", "sbx-1", "/app/x", "out.csv"], respond: (r) => (r.path.startsWith("/files") ? resp(416, {}, "range", "X") : "default") });
add("down-dest-is-dir", { argv: ["download", "sbx-1", "/app/result.csv", "outdir"], setup: (h, c) => mkdirSync(join(c, "outdir")), respond: (r) => (r.path.startsWith("/files") ? resp(200, {}, "data", "OK") : "default") });

const cases = S.filter((s) => !FILTER || FILTER.test(s.id));
if (args.includes("--list")) { for (const s of cases) console.log(s.id); process.exit(0); }
console.log(`[adv_core_net] ${cases.length} scenarios`);
let diffs = 0;
const lineDiff = (a, b) => {
  const al = a.split("\n");
  const bl = b.split("\n");
  const out = [];
  for (let i = 0; i < Math.max(al.length, bl.length); i++) if (al[i] !== bl[i]) out.push(`      - ${al[i] ?? "<none>"}\n      + ${bl[i] ?? "<none>"}`);
  return out.slice(0, 8).join("\n");
};
const report = [];
const concurrency = Number(process.env.ADV_NET_CONCURRENCY ?? 4);
let next = 0;
async function worker() {
  while (next < cases.length) {
    const scn = cases[next++];
    let res;
    try { res = await runScenario(scn); } catch (e) { console.log(`ERROR ${scn.id}: ${e.message}`); continue; }
    const d = [];
    const { oracle: o, node: n } = res;
    if (o.code !== n.code) d.push(`exit: oracle=${o.code} node=${n.code}`);
    if (o.stdout !== n.stdout) d.push(`stdout:\n${lineDiff(o.stdout, n.stdout)}`);
    if (o.stderr !== n.stderr) d.push(`stderr:\n${lineDiff(o.stderr, n.stderr)}`);
    if (JSON.stringify(o.reqs) !== JSON.stringify(n.reqs)) d.push(`requests:\n${lineDiff(o.reqs.join("\n"), n.reqs.join("\n"))}`);
    console.log(`${d.length ? "DIFF" : "same"}  ${scn.id}`);
    if (d.length) { diffs++; report.push({ id: scn.id, d }); if (verbose) console.log(d.map((x) => `    ${x}`).join("\n")); }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
console.log(`\n[adv_core_net] ${cases.length - diffs}/${cases.length} identical, ${diffs} differing`);
if (!verbose) for (const r of report) console.log(`--- ${r.id}\n${r.d.map((x) => `    ${x}`).join("\n")}`);
rmSync(root, { recursive: true, force: true });
process.exit(diffs ? 1 : 0);
