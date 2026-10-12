/**
 * The real `NodeTransport` against a loopback stub server (no network).
 *
 * Added during integration verification: the unit tests only ever ran over `MockTransport`, which hid two defects of
 * the real transport (array-valued `Host` header rejected by node:http, and connect failures not reported with the
 * anyio text `All connection attempts failed` that httpx surfaces).
 */

import http from "node:http";
import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AsyncClient, ConnectError } from "../../src/transport/_httpx.js";

let server: http.Server;
let base = "";
const seen: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders; body: string }> = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("TestNodeTransportLoopback", () => {
  it("sends single-valued headers (Host included) as plain strings and reads the JSON reply", async () => {
    const client = new AsyncClient({ trust_env: false });
    const response = await client.request("POST", `${base}/sandboxes?a=1`, { json: { template: "t" }, headers: { "X-API-Key": "k" } });
    await client.aclose();
    expect(response.status_code).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    const last = seen[seen.length - 1]!;
    expect(last.method).toBe("POST");
    expect(last.url).toBe("/sandboxes?a=1");
    expect(last.headers["host"]).toBe(base.replace("http://", ""));
    expect(last.headers["x-api-key"]).toBe("k");
    expect(last.body).toBe('{"template":"t"}');
  });

  it("uploads multipart files and rejects non-bytes file content with Python's AttributeError text", async () => {
    const client = new AsyncClient({ trust_env: false });
    const response = await client.request("POST", `${base}/files`, { files: { file: ["file", Buffer.from("hello")] } });
    expect(response.status_code).toBe(200);
    expect(seen[seen.length - 1]!.body).toContain('name="file"; filename="file"');
    expect(seen[seen.length - 1]!.body).toContain("hello");
    await expect(client.request("POST", `${base}/files`, { files: { file: ["file", 5 as unknown as Uint8Array] } })).rejects.toThrow(
      "'int' object has no attribute 'read'",
    );
    await client.aclose();
  });

  it("reports a refused TCP connection like anyio/httpx (All connection attempts failed)", async () => {
    const probe = net.createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const { port } = probe.address() as net.AddressInfo;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const client = new AsyncClient({ trust_env: false });
    const failure = await client.request("GET", `http://127.0.0.1:${port}/`).then(
      () => null,
      (e: unknown) => e,
    );
    await client.aclose();
    expect(failure).toBeInstanceOf(ConnectError);
    expect((failure as Error).message).toBe("All connection attempts failed");
  });

  it("keeps the resolver failure text for unknown hosts", async () => {
    const client = new AsyncClient({ trust_env: false });
    const failure = await client.request("GET", "http://nonexistent.invalid:1/").then(
      () => null,
      (e: unknown) => e,
    );
    await client.aclose();
    expect(failure).toBeInstanceOf(ConnectError);
    expect((failure as Error).message).toBe("[Errno -2] Name or service not known");
  });
});
