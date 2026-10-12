/**
 * Adversarial review, area `core`: `src/transport/ws.ts` (ws) vs `transport/ws.py` (websockets 17.2). Expected texts
 * were captured from the Python oracle against the same local servers. Full matrix: `parity/diff/adv_core_ws.mjs`.
 */
import { createServer, type IncomingMessage } from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

import { TransportConfig } from "../../../src/transport/config.js";
import { WebSocketClient } from "../../../src/transport/ws.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

type Behave = (ws: import("ws").WebSocket, sock: Duplex, req: IncomingMessage) => void;

async function wsServer(behave: Behave, onRaw?: (req: IncomingMessage, sock: Duplex) => boolean): Promise<number> {
  const wss = new WebSocketServer({ noServer: true });
  const srv = createServer();
  srv.on("upgrade", (req, sock, head) => {
    if (onRaw?.(req, sock)) return;
    wss.handleUpgrade(req, sock, head, (ws) => behave(ws, sock, req));
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  cleanups.push(() => {
    srv.closeAllConnections?.();
    srv.close();
  });
  return (srv.address() as net.AddressInfo).port;
}

const client = (url: string) => new WebSocketClient(url, { config: new TransportConfig({}) });

async function err(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return String((e as { __str__?: () => string }).__str__?.() ?? e);
  }
  return "<no error>";
}
const SUGGEST_RX = "\n  Suggestion: Check network connectivity and firewall rules.";

describe("ADV-core WebSocketClient close / error text", () => {
  it("ADV-core-50 the close reason is echoed in the 'then sent' half: 'received 1000 (OK) bye; then sent 1000 (OK) bye'", async () => {
    const port = await wsServer((ws) => setTimeout(() => ws.close(1000, "bye"), 30));
    const c = client(`ws://127.0.0.1:${port}/`);
    await c.connect();
    expect(await err(() => c.receive({ timeout: 3 }))).toBe(
      `[E5001] WebSocket receive error: received 1000 (OK) bye; then sent 1000 (OK) bye${SUGGEST_RX}`,
    );
  });

  it("ADV-core-51 codes 3000-3999 are 'registered', 4000-4999 'private use'", async () => {
    const port = await wsServer((ws) => setTimeout(() => ws.close(3000), 30));
    const c = client(`ws://127.0.0.1:${port}/`);
    await c.connect();
    expect(await err(() => c.receive({ timeout: 3 }))).toBe(
      `[E5001] WebSocket receive error: received 3000 (registered); then sent 3000 (registered)${SUGGEST_RX}`,
    );
  });

  it("ADV-core-52 an empty close frame (1005) ends recv_iter cleanly and keeps is_connected true", async () => {
    const port = await wsServer((ws) => setTimeout(() => ws.close(), 30));
    const c = client(`ws://127.0.0.1:${port}/`);
    await c.connect();
    const got: unknown[] = [];
    for await (const m of c.recvIter()) got.push(m);
    expect(got).toEqual([]);
    expect(c.is_connected).toBe(true);
  });

  it("ADV-core-53 a frame above max_size is reported as 'sent 1009 (message too big) frame with 1048577 bytes exceeds limit of 1048576 bytes; no close frame received'", async () => {
    const port = await wsServer((ws) => ws.send("y".repeat(2 ** 20 + 1)));
    const c = client(`ws://127.0.0.1:${port}/`);
    await c.connect();
    expect(await err(() => c.receive({ timeout: 5 }))).toBe(
      `[E5001] WebSocket receive error: sent 1009 (message too big) frame with 1048577 bytes exceeds limit of 1048576 bytes; no close frame received${SUGGEST_RX}`,
    );
  });

  it("ADV-core-54 invalid UTF-8 in a text frame closes with 1007 and the reason text 'invalid start byte at position 0'", async () => {
    const closes: [number, string][] = [];
    const port = await wsServer((ws, sock) => {
      ws.on("close", (code, reason) => closes.push([code, reason.toString()]));
      sock.write(Buffer.from([0x81, 0x02, 0xff, 0xfe]));
    });
    const c = client(`ws://127.0.0.1:${port}/`);
    await c.connect();
    const got = await err(() => c.receive({ timeout: 5 }));
    await new Promise((r) => setTimeout(r, 100));
    expect(got).toBe(
      `[E5001] WebSocket receive error: sent 1007 (invalid frame payload data) invalid start byte at position 0; no close frame received${SUGGEST_RX}`,
    );
    expect(closes).toEqual([[1007, "invalid start byte at position 0"]]);
  });
});

describe("ADV-core WebSocketClient connect semantics", () => {
  it("ADV-core-55 an HTTP 302 handshake response is followed (websockets 17 follows redirects)", async () => {
    const seen: string[] = [];
    const port = await wsServer(
      () => {},
      (req, sock) => {
        seen.push(req.url ?? "");
        if (req.url === "/old") {
          sock.end("HTTP/1.1 302 Found\r\nLocation: /new\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
          return true;
        }
        return false;
      },
    );
    const c = client(`ws://127.0.0.1:${port}/old`);
    await c.connect();
    expect(c.is_connected).toBe(true);
    expect(seen).toEqual(["/old", "/new"]);
    await c.close();
  });

  it("ADV-core-56 HTTP_PROXY / HTTPS_PROXY from the environment are honoured (websockets proxy=True): CONNECT is sent to the proxy", async () => {
    const lines: string[] = [];
    const proxy = net.createServer((s) => {
      s.on("error", () => {});
      s.once("data", (d) => {
        lines.push(d.toString().split("\r\n")[0]!);
        s.destroy();
      });
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    cleanups.push(() => new Promise<void>((r) => proxy.close(() => r())));
    const purl = `http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`;
    const port = await wsServer(() => {});
    const keys = ["HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy"];
    const saved = keys.map((k) => process.env[k]);
    process.env.HTTP_PROXY = process.env.http_proxy = purl;
    delete process.env.NO_PROXY;
    delete process.env.no_proxy;
    try {
      const c = client(`ws://127.0.0.1:${port}/`);
      const got = await err(() => c.connect());
      expect(got).toContain("did not receive a valid HTTP response from proxy");
      expect(lines).toEqual([`CONNECT 127.0.0.1:${port} HTTP/1.1`]);
    } finally {
      keys.forEach((k, i) => (saved[i] === undefined ? delete process.env[k] : (process.env[k] = saved[i])));
    }
  });

  it.each([
    ["http://127.0.0.1:1/x", "http://127.0.0.1:1/x isn't a valid URI: scheme isn't ws or wss"],
    ["", " isn't a valid URI: scheme isn't ws or wss"],
    ["ws://", "ws:// isn't a valid URI: hostname isn't provided"],
    ["ws://127.0.0.1:1/x#frag", "ws://127.0.0.1:1/x#frag isn't a valid URI: fragment identifier is meaningless"],
  ])("ADV-core-57 connect(%j) reports websockets' URI validation text", async (url, detail) => {
    expect(await err(() => client(url).connect())).toBe(
      `[E5001] Failed to establish WebSocket connection: ${detail}\n  Suggestion: Check WebSocket URL and network connectivity.`,
    );
  });

  it("ADV-core-58 a server that closes the socket during the handshake: 'did not receive a valid HTTP response'", async () => {
    const port = await wsServer(
      () => {},
      (_req, sock) => {
        sock.destroy();
        return true;
      },
    );
    expect(await err(() => client(`ws://127.0.0.1:${port}/`).connect())).toBe(
      "[E5001] Failed to establish WebSocket connection: did not receive a valid HTTP response\n  Suggestion: Check WebSocket URL and network connectivity.",
    );
  });
});
