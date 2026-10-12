/**
 * Wire-level checks of the Streamable HTTP app: exact status lines, header
 * names/order and body bytes. Expected values were captured from the original
 * Starlette/uvicorn app (`create_mcp_app`).
 */

import * as http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createMcpApp, serveMcpApp, type McpHttpApp } from "../../src/agent/mcp_http.js";

interface Raw {
  status: number;
  message: string;
  rawHeaders: string[];
  body: string;
}

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.closeAllConnections();
          s.close(() => resolve());
        }),
    ),
  );
});

async function listen(app: McpHttpApp): Promise<number> {
  const server = app.createServer();
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

function call(
  port: number,
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: string | Buffer } = {},
): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? undefined : Buffer.from(options.body);
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (body !== undefined) headers["Content-Length"] = String(body.length);
    const req = http.request({ host: "127.0.0.1", port, method, path, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          message: res.statusMessage ?? "",
          rawHeaders: res.rawHeaders,
          body: Buffer.concat(chunks).toString("utf-8"),
        }),
      );
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** Header pairs without the headers Node/uvicorn add on their own. */
function headers(raw: Raw): string[] {
  const out: string[] = [];
  for (let i = 0; i < raw.rawHeaders.length; i += 2) {
    const name = raw.rawHeaders[i] as string;
    if (["date", "connection", "keep-alive", "server"].includes(name.toLowerCase())) continue;
    out.push(`${name}: ${raw.rawHeaders[i + 1]}`);
  }
  return out;
}

const INIT = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}';

describe("TestMcpHttpWire", () => {
  const app = (): McpHttpApp => createMcpApp({ api_key: "k", template: "t" });

  it("health is compact JSON with lower-case header names", async () => {
    const port = await listen(app());
    const r = await call(port, "GET", "/health");
    expect(r.status).toBe(200);
    expect(headers(r)).toEqual(["content-length: 39", "content-type: application/json"]);
    expect(r.body).toBe('{"status":"ok","protocol":"2025-06-18"}');
  });

  it("initialize returns the session id header after the body headers", async () => {
    const port = await listen(app());
    const r = await call(port, "POST", "/mcp", { body: INIT });
    expect(r.status).toBe(200);
    const h = headers(r);
    expect(h.slice(0, 2)).toEqual(["content-length: 168", "content-type: application/json"]);
    expect(h[2]).toMatch(/^mcp-session-id: [0-9a-f-]{36}$/);
    expect(r.body).toBe(
      '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"easy-sandbox","version":"0.3.0"}}}',
    );
  });

  it("a notification gets 202 with an empty body and content-length 0", async () => {
    const port = await listen(app());
    const init = await call(port, "POST", "/mcp", { body: INIT });
    const sid = init.rawHeaders[init.rawHeaders.findIndex((h) => h.toLowerCase() === "mcp-session-id") + 1] as string;
    const r = await call(port, "POST", "/mcp", {
      headers: { "Mcp-Session-Id": sid },
      body: '{"jsonrpc":"2.0","method":"notifications/initialized"}',
    });
    expect(r.status).toBe(202);
    expect(headers(r)).toEqual(["content-length: 0", `mcp-session-id: ${sid}`]);
    expect(r.body).toBe("");
  });

  it("echoes request ids like json.loads/json.dumps (whole floats, big ints, key order) and 500s on NaN", async () => {
    const port = await listen(app());
    const miss = (id: string): string =>
      `{"jsonrpc":"2.0","id":${id},"error":{"code":-32600,"message":"Missing Mcp-Session-Id header. Send an 'initialize' request first."}}`;
    const cases: Array<[string, number, string]> = [
      ["1.0", 400, miss("1.0")],
      ["1e400", 500, "Internal Server Error"],
      ["NaN", 500, "Internal Server Error"],
      ['{"2":1,"1":2.0}', 400, miss('{"2":1,"1":2.0}')],
      ["12345678901234567890", 400, miss("12345678901234567890")],
      ["1e16", 400, miss("1e+16")],
      ["-0.0", 400, miss("-0.0")],
    ];
    for (const [id, status, body] of cases) {
      const r = await call(port, "POST", "/mcp", { body: `{"jsonrpc":"2.0","id":${id},"method":"ping"}` });
      expect({ id, status: r.status, body: r.body }).toEqual({ id, status, body });
    }
  });

  it("unauthorised requests get the JSON-RPC -32001 body", async () => {
    const port = await listen(createMcpApp({ auth_token: "sekret" }));
    const r = await call(port, "POST", "/mcp", { body: INIT });
    expect(r.status).toBe(401);
    expect(r.body).toBe('{"jsonrpc":"2.0","id":null,"error":{"code":-32001,"message":"Unauthorized"}}');
    const lowercase = await call(port, "POST", "/mcp", { headers: { Authorization: "bearer sekret" }, body: INIT });
    expect(lowercase.status).toBe(401);
    const padded = await call(port, "POST", "/mcp", { headers: { Authorization: "Bearer  sekret  " }, body: INIT });
    expect(padded.status).toBe(200);
  });

  it("GET /mcp is 405 with an Allow header", async () => {
    const port = await listen(app());
    const r = await call(port, "GET", "/mcp");
    expect(r.status).toBe(405);
    expect(headers(r)).toEqual([
      "allow: POST, DELETE",
      "content-length: 72",
      "content-type: application/json",
    ]);
    expect(r.body).toBe('{"error":"SSE server notifications are not implemented. Use POST /mcp."}');
  });

  it("HEAD /mcp reaches the GET handler and sends no body", async () => {
    const port = await listen(app());
    const r = await call(port, "HEAD", "/mcp");
    expect(r.status).toBe(405);
    expect(headers(r)[0]).toBe("allow: POST, DELETE");
    expect(r.body).toBe("");
  });

  it("other methods on /mcp get Starlette's plain 405", async () => {
    const port = await listen(app());
    const r = await call(port, "PUT", "/mcp");
    expect(r.status).toBe(405);
    expect(headers(r)).toEqual(["allow: POST", "content-length: 18", "content-type: text/plain; charset=utf-8"]);
    expect(r.body).toBe("Method Not Allowed");
  });

  it("unknown paths get a plain 404", async () => {
    const port = await listen(app());
    const r = await call(port, "GET", "/nope");
    expect(r.status).toBe(404);
    expect(headers(r)).toEqual(["content-length: 9", "content-type: text/plain; charset=utf-8"]);
    expect(r.body).toBe("Not Found");
  });

  it("trailing-slash paths redirect with 307 to the route", async () => {
    const port = await listen(app());
    const r = await call(port, "POST", "/mcp/?a=b%20c", { headers: { Host: "example.test:81" } });
    expect(r.status).toBe(307);
    expect(headers(r)).toEqual(["content-length: 0", "location: http://example.test:81/mcp?a=b%20c"]);
  });

  it("parse and shape errors use the documented bodies", async () => {
    const port = await listen(app());
    const bad = await call(port, "POST", "/mcp", { body: "not json" });
    expect(bad.status).toBe(400);
    expect(bad.body).toBe('{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Invalid JSON"}}');
    const array = await call(port, "POST", "/mcp", { body: "[]" });
    expect(array.body).toBe(
      '{"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"Request must be a JSON object"}}',
    );
    const noSession = await call(port, "POST", "/mcp", { body: '{"jsonrpc":"2.0","id":"é","method":"tools/list"}' });
    expect(noSession.status).toBe(400);
    expect(noSession.body).toBe(
      '{"jsonrpc":"2.0","id":"é","error":{"code":-32600,"message":"Missing Mcp-Session-Id header. Send an \'initialize\' request first."}}',
    );
    const unknown = await call(port, "POST", "/mcp", {
      headers: { "Mcp-Session-Id": "x" },
      body: '{"jsonrpc":"2.0","id":5,"method":"tools/list"}',
    });
    expect(unknown.status).toBe(404);
    expect(unknown.body).toBe('{"jsonrpc":"2.0","id":5,"error":{"code":-32600,"message":"Unknown session: x"}}');
  });

  it("origin rules: localhost forms pass, foreign and malformed origins do not", async () => {
    const port = await listen(createMcpApp({ allowed_origins: ["https://ide.example"] }));
    const ok = ["http://LOCALHOST:3000", "http://[::1]:3000", "http://127.0.0.1", "https://ide.example"];
    for (const origin of ok) {
      expect((await call(port, "POST", "/mcp", { headers: { Origin: origin }, body: INIT })).status, origin).toBe(200);
    }
    for (const origin of ["http://evil.example", "null", "http://localhost.evil.example"]) {
      const r = await call(port, "POST", "/mcp", { headers: { Origin: origin }, body: INIT });
      expect(r.status, origin).toBe(403);
      expect(r.body).toBe('{"error":"Origin is not allowed"}');
    }
    const broken = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const r = await call(port, "POST", "/mcp", { headers: { Origin: "http://[::1" }, body: INIT });
    broken.mockRestore();
    expect(r.status).toBe(500);
    expect(r.body).toBe("Internal Server Error");
  });

  it("request bodies are decoded like json.loads(bytes)", async () => {
    const port = await listen(app());
    const bom = await call(port, "POST", "/mcp", { body: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(INIT)]) });
    expect(bom.status).toBe(200);
    const utf16 = await call(port, "POST", "/mcp", {
      body: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(INIT, "utf16le")]),
    });
    expect(utf16.status).toBe(200);
    const big = await call(port, "POST", "/mcp", {
      body: '{"jsonrpc":"2.0","id":123456789012345678901234567890,"method":"initialize"}',
    });
    expect(big.body).toContain('"id":123456789012345678901234567890,');
  });
});

describe("TestServeMcpApp", () => {
  it("serves requests and destroys sessions on close", async () => {
    const mcpApp = createMcpApp({ api_key: "k" });
    const running = await serveMcpApp(mcpApp, { host: "127.0.0.1", port: 0, log_level: "critical", handleSignals: false });
    const init = await call(running.address.port, "POST", "/mcp", { body: INIT });
    expect(init.status).toBe(200);
    const store = mcpApp.state.session_store;
    expect(store._sessions.size).toBe(1);
    const entry = [...store._sessions.values()][0]!;
    entry.server.shutdown = vi.fn(async () => undefined);
    await running.close();
    await running.closed;
    expect(entry.server.shutdown).toHaveBeenCalledTimes(1);
    expect(store._sessions.size).toBe(0);
  });
});
