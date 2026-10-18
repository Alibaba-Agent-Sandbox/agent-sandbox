/**
 * Adversarial review, area `core`: httpx shim (`src/transport/_httpx.ts`), plain `fetch` call sites driven by raw TCP/TLS servers. Expected behaviour was captured from Python httpx 0.28.1 / h11 /
 * `filelock` and is frozen in the assertions. Tests FAIL while the port differs. Full matrix:
 * `parity/diff/adv_core_net.mjs` (needs ORACLE_VENV).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AsyncClient } from "../../../src/transport/_httpx.js";
import { _getAcrAuthTokenPersonal } from "../../../src/api/docker_builder.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function rawServer(handler: (sock: net.Socket) => void): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer((sock) => {
      sock.on("error", () => {});
      sock.once("data", () => handler(sock));
    });
    srv.listen(0, "127.0.0.1", () => {
      cleanups.push(() => new Promise<void>((r) => srv.close(() => r())));
      resolve((srv.address() as net.AddressInfo).port);
    });
  });
}

async function getErr(url: string, env: Record<string, string | undefined> = {}): Promise<{ name: string; message: string } | { status: number; text: string }> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    const c = new AsyncClient({ trust_env: true, timeout: 3 });
    try {
      const r = await c.get(url);
      return { status: r.status_code, text: r.text };
    } finally {
      await c.aclose();
    }
  } catch (e) {
    return { name: (e as Error).constructor.name, message: (e as Error).message };
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe("ADV-core httpx shim: response parsing / error classes", () => {
  it("ADV-core-20 garbage status line -> RemoteProtocolError \"illegal status line: bytearray(b'garbage')\"", async () => {
    const port = await rawServer((s) => s.end("garbage\r\n\r\n"));
    expect(await getErr(`http://127.0.0.1:${port}/`, {})).toEqual({
      name: "RemoteProtocolError",
      message: "illegal status line: bytearray(b'garbage')",
    });
  });

  it("ADV-core-21 TCP RST before any response byte -> ReadError with empty message", async () => {
    const port = await rawServer((s) => s.resetAndDestroy());
    expect(await getErr(`http://127.0.0.1:${port}/`, {})).toEqual({ name: "ReadError", message: "" });
  });

  it("ADV-core-22 short Content-Length body -> 'peer closed connection ... (received 2 bytes, expected 10)'", async () => {
    const port = await rawServer((s) => s.end("HTTP/1.1 200 OK\r\nContent-Length: 10\r\nConnection: close\r\n\r\nok"));
    expect(await getErr(`http://127.0.0.1:${port}/`, {})).toEqual({
      name: "RemoteProtocolError",
      message: "peer closed connection without sending complete message body (received 2 bytes, expected 10)",
    });
  });

  it.each([
    ["40 KB header value (h11 allows 64 KiB)", `HTTP/1.1 200 OK\r\nX-Big: ${"a".repeat(40000)}\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok`],
    ["bare-LF line endings", "HTTP/1.1 200 OK\nContent-Length: 2\nConnection: close\n\nok"],
    ["both Transfer-Encoding and Content-Length", "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Length: 2\r\nConnection: close\r\n\r\n2\r\nok\r\n0\r\n\r\n"],
    ["obsolete folded header line", "HTTP/1.1 200 OK\r\nX-A: a\r\n b\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"],
  ])("ADV-core-23 h11 accepts: %s", async (_n, raw) => {
    const port = await rawServer((s) => s.end(raw));
    expect(await getErr(`http://127.0.0.1:${port}/`, {})).toEqual({ status: 200, text: "ok" });
  });

  it("ADV-core-24 ftp:// proxy in env -> ValueError \"Unknown scheme for proxy URL URL('ftp://127.0.0.1:1')\"", async () => {
    const got = await getErr("http://example.invalid/", { HTTP_PROXY: "ftp://127.0.0.1:1", http_proxy: "ftp://127.0.0.1:1" });
    expect(got).toEqual({ name: "ValueError", message: "Unknown scheme for proxy URL URL('ftp://127.0.0.1:1')" });
  });
});

describe("ADV-core TLS trust store (httpx honours SSL_CERT_FILE / SSL_CERT_DIR)", () => {
  let dir = "";
  let certPath = "";
  let port = 0;
  let haveOpenssl = true;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "adv-core-tls-"));
    const key = join(dir, "k.pem");
    certPath = join(dir, "c.pem");
    try {
      execFileSync(
        "openssl",
        ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", certPath, "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"],
        { stdio: "ignore" },
      );
    } catch {
      haveOpenssl = false;
      return;
    }
    const srv = https.createServer({ key: readFileSync(key), cert: readFileSync(certPath) }, (_q, res) => res.end("ok"));
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    port = (srv.address() as net.AddressInfo).port;
    return () => {
      srv.close();
      rmSync(dir, { recursive: true, force: true });
    };
  });

  it("ADV-core-25 SSL_CERT_FILE pointing at the server's self-signed cert makes the request succeed", async () => {
    if (!haveOpenssl) return;
    const got = await getErr(`https://127.0.0.1:${port}/`, { SSL_CERT_FILE: certPath, NODE_EXTRA_CA_CERTS: undefined });
    expect(got).toEqual({ status: 200, text: "ok" });
  });

  it("ADV-core-26 SSL_CERT_DIR (hashed dir) is honoured", async () => {
    if (!haveOpenssl) return;
    const hash = execFileSync("openssl", ["x509", "-hash", "-noout", "-in", certPath]).toString().trim();
    const cdir = join(dir, "certs");
    mkdirSync(cdir, { recursive: true });
    writeFileSync(join(cdir, `${hash}.0`), readFileSync(certPath));
    const got = await getErr(`https://127.0.0.1:${port}/`, { SSL_CERT_DIR: cdir, SSL_CERT_FILE: undefined, NODE_EXTRA_CA_CERTS: undefined });
    expect(got).toEqual({ status: 200, text: "ok" });
  });

  it("ADV-core-27 SSL_CERT_FILE pointing at a missing file fails like ssl.load_verify_locations (\"[Errno 2] No such file or directory\")", async () => {
    const got = await getErr("https://127.0.0.1:1/", { SSL_CERT_FILE: join(tmpdir(), "adv-core-no-such-ca.pem") });
    expect(JSON.stringify(got)).toContain("No such file or directory");
  });
});

describe("ADV-core plain `fetch` call sites bypass the httpx shim", () => {
  it("ADV-core-30 ACR GetAuthorizationToken honours HTTPS_PROXY (httpx trust_env) instead of dialing directly", async () => {
    const seen: string[] = [];
    const proxy = net.createServer((c) => {
      c.on("error", () => {});
      c.once("data", (d) => {
        seen.push(d.toString().split("\r\n")[0]!);
        c.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
      });
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    cleanups.push(() => new Promise<void>((r) => proxy.close(() => r())));
    const url = `http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`;
    const saved = { a: process.env.HTTPS_PROXY, b: process.env.https_proxy, c: process.env.NO_PROXY, d: process.env.no_proxy };
    process.env.HTTPS_PROXY = process.env.https_proxy = url;
    delete process.env.NO_PROXY;
    delete process.env.no_proxy;
    try {
      await _getAcrAuthTokenPersonal("ak", "sk", "cn-hangzhou").catch(() => undefined);
    } finally {
      for (const [k, v] of [["HTTPS_PROXY", saved.a], ["https_proxy", saved.b], ["NO_PROXY", saved.c], ["no_proxy", saved.d]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
    expect(seen.some((l) => l.startsWith("CONNECT cr.cn-hangzhou.aliyuncs.com:443"))).toBe(true);
  }, 20000);
});
