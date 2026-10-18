/** Tests for MCP Streamable HTTP transport (agent/mcp_http.ts). */

import * as http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MCP_PROTOCOL_VERSION,
  MCPAuthConfigError,
  SessionStore,
  _jsonrpcError,
  _jsonrpcResponse,
  _validateBearerToken,
  createMcpApp,
  hmac,
  requireAuthToken,
  time,
  type CreateMcpAppOptions,
  type McpHttpApp,
} from "../../src/agent/mcp_http.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

describe("TestJsonRpcHelpers", () => {
  // Test JSON-RPC response/error builders (HTTP variant).

  it("test_success_response", () => {
    const resp = _jsonrpcResponse(1, { tools: [] });
    expect(resp.jsonrpc).toBe("2.0");
    expect(resp.id).toBe(1);
    expect(resp.result).toEqual({ tools: [] });
  });

  it("test_error_response", () => {
    const resp: any = _jsonrpcError(2, -32601, "Method not found");
    expect(resp.error.code).toBe(-32601);
    expect(resp.error.message).toBe("Method not found");
  });

  it("test_error_with_data", () => {
    const resp: any = _jsonrpcError(3, -32603, "Internal error", { x: 1 });
    expect(resp.error.data).toEqual({ x: 1 });
  });
});

// ---------------------------------------------------------------------------
// Bearer token validation
// ---------------------------------------------------------------------------

describe("TestRequireAuthToken", () => {
  // Remote entry points must not boot with authentication disabled.

  it("test_returns_stripped_token", () => {
    expect(requireAuthToken("  secret  ")).toBe("secret");
  });

  it.each([
    ["None", null],
    ["", ""],
    ["   ", "   "],
    ["\\n", "\n"],
  ])("test_rejects_empty_token [%s]", (_label, value) => {
    expect(() => requireAuthToken(value)).toThrow(MCPAuthConfigError);
  });
});

describe("TestBearerTokenValidation", () => {
  // Test _validate_bearer_token helper.

  it("test_no_token_required", () => {
    const req = {};
    expect(_validateBearerToken(req, null)).toBe(true);
  });

  it("test_valid_token_uses_constant_time_comparison", () => {
    const req = { headers: new Headers({ authorization: "Bearer my-secret-token" }) };
    const compareDigest = vi.spyOn(hmac, "compareDigest").mockReturnValue(true);
    expect(_validateBearerToken(req, "my-secret-token")).toBe(true);
    expect(compareDigest).toHaveBeenCalledTimes(1);
    expect(compareDigest).toHaveBeenCalledWith(
      Buffer.from("my-secret-token"),
      Buffer.from("my-secret-token"),
    );
  });

  it("test_invalid_token", () => {
    const req = { headers: new Headers({ authorization: "Bearer wrong-token" }) };
    expect(_validateBearerToken(req, "my-secret-token")).toBe(false);
  });

  it("test_missing_header", () => {
    const req = { headers: new Headers() };
    expect(_validateBearerToken(req, "token")).toBe(false);
  });

  it("test_non_bearer_scheme", () => {
    const req = { headers: new Headers({ authorization: "Basic dXNlcjpwYXNz" }) };
    expect(_validateBearerToken(req, "token")).toBe(false);
  });

  it.each([
    ["", ""],
    ["   ", "   "],
    ["\\n\\t", "\n\t"],
  ])("test_configured_empty_token_fails_closed [%s]", (_label, expectedToken) => {
    const req = { headers: new Headers({ authorization: "Bearer " }) };
    expect(_validateBearerToken(req, expectedToken)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SessionStore
// ---------------------------------------------------------------------------

describe("TestSessionStore", () => {
  // Test the SessionStore session lifecycle.

  it("test_create_session", async () => {
    const store = new SessionStore({ api_key: "test-key", template: "python-base" });
    const [sid, server] = await store.createSession();
    expect(typeof sid).toBe("string");
    expect(sid.length).toBeGreaterThan(0);
    expect(server).not.toBeNull();
    expect(store.getSession(sid)).toBe(server);
  });

  it("test_get_nonexistent_session", () => {
    const store = new SessionStore();
    expect(store.getSession("nonexistent")).toBeNull();
  });

  it("test_destroy_session", async () => {
    const store = new SessionStore();
    const [sid, server] = await store.createSession();
    server.shutdown = vi.fn(async () => undefined);
    const result = await store.destroySession(sid);
    expect(result).toBe(true);
    expect(server.shutdown).toHaveBeenCalledTimes(1);
    expect(store.getSession(sid)).toBeNull();
  });

  it("test_destroy_nonexistent_session", async () => {
    const store = new SessionStore();
    const result = await store.destroySession("nope");
    expect(result).toBe(false);
  });

  it("test_shutdown_all", async () => {
    const store = new SessionStore();
    const [, s1] = await store.createSession();
    const [, s2] = await store.createSession();
    s1.shutdown = vi.fn(async () => undefined);
    s2.shutdown = vi.fn(async () => undefined);
    await store.shutdownAll();
    expect(s1.shutdown).toHaveBeenCalledTimes(1);
    expect(s2.shutdown).toHaveBeenCalledTimes(1);
  });

  it("test_cleanup_expired_session", async () => {
    const store = new SessionStore({ session_ttl_seconds: 10 });
    const [sid, server] = await store.createSession();
    server.shutdown = vi.fn(async () => undefined);
    store._sessions.get(sid)!.last_access = 0;

    vi.spyOn(time, "monotonic").mockReturnValue(11);
    const removed = await store.cleanupExpired();

    expect(removed).toBe(1);
    expect(store.getSession(sid)).toBeNull();
    expect(server.shutdown).toHaveBeenCalledTimes(1);
  });

  it("test_session_limit_rejects_new_session", async () => {
    const store = new SessionStore({ max_sessions: 1 });
    await store.createSession();

    await expect(store.createSession()).rejects.toThrow(/session limit reached/);
  });
});

// ---------------------------------------------------------------------------
// HTTP protocol version negotiation
// ---------------------------------------------------------------------------

describe("TestHttpProtocolVersionNegotiation", () => {
  // Sessions created by SessionStore negotiate the HTTP transport version.
  //
  // The shared SandboxMCPServer is wired with the HTTP supported-version set
  // (2025-06-18), not the STDIO default (2024-11-05).

  it("test_session_server_negotiates_2025_06_18", async () => {
    const store = new SessionStore();
    const [, server] = await store.createSession();
    const resp: any = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "t", version: "1" },
      },
    });
    expect(resp).not.toBeNull();
    expect(resp.result.protocolVersion).toBe("2025-06-18");
    expect(resp.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
  });

  it("test_session_server_rejects_stdio_version_echo", async () => {
    // HTTP 会话不回显 STDIO 的 2024-11-05，而是回退到 HTTP 支持版本。
    const store = new SessionStore();
    const [, server] = await store.createSession();
    const resp: any = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "t", version: "1" },
      },
    });
    expect(resp.result.protocolVersion).toBe("2025-06-18");
  });
});

// ---------------------------------------------------------------------------
// HTTP app (stand-in for Starlette's TestClient)
// ---------------------------------------------------------------------------

interface ClientResponse {
  status_code: number;
  headers: http.IncomingHttpHeaders;
  rawHeaders: string[];
  text: string;
  json(): any;
}

const openServers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

class TestClient {
  private server: http.Server | undefined;

  constructor(readonly app: McpHttpApp) {}

  private async port(): Promise<number> {
    if (this.server === undefined) {
      this.server = this.app.createServer();
      openServers.push(this.server);
      await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    }
    return (this.server.address() as AddressInfo).port;
  }

  private async request(
    method: string,
    path: string,
    options: { json?: unknown; content?: Buffer; headers?: Record<string, string> } = {},
  ): Promise<ClientResponse> {
    const port = await this.port();
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    let body: Buffer | undefined = options.content;
    if (options.json !== undefined) {
      body = Buffer.from(JSON.stringify(options.json));
      headers["Content-Type"] ??= "application/json";
    }
    if (body !== undefined) headers["Content-Length"] = String(body.length);
    return new Promise<ClientResponse>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, method, path, headers, agent: false },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf-8");
            resolve({
              status_code: res.statusCode ?? 0,
              headers: res.headers,
              rawHeaders: res.rawHeaders,
              text,
              json: () => JSON.parse(text),
            });
          });
        },
      );
      req.on("error", reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  }

  get(path: string, headers?: Record<string, string>): Promise<ClientResponse> {
    return this.request("GET", path, { headers });
  }

  post(
    path: string,
    options: { json?: unknown; content?: Buffer; headers?: Record<string, string> } = {},
  ): Promise<ClientResponse> {
    return this.request("POST", path, options);
  }

  delete(path: string, headers?: Record<string, string>): Promise<ClientResponse> {
    return this.request("DELETE", path, { headers });
  }
}

describe("TestMcpHttpApp", () => {
  // Integration tests for the HTTP MCP app (Starlette TestClient in the Python suite).

  function makeApp(authToken: string | null = null, kwargs: Partial<CreateMcpAppOptions> = {}): McpHttpApp {
    // Create a test app with a controlled configuration.
    return createMcpApp({
      auth_token: authToken,
      api_key: "test-key",
      template: "test-tpl",
      ...kwargs,
    });
  }

  // ---- Health check ----

  it("test_health", async () => {
    const app = makeApp();
    const client = new TestClient(app);
    const resp = await client.get("/health");
    expect(resp.status_code).toBe(200);
    const data = resp.json();
    expect(data.status).toBe("ok");
    expect(data.protocol).toBe(MCP_PROTOCOL_VERSION);
  });

  // ---- POST /mcp — initialize ----

  it("test_initialize_creates_session", async () => {
    const app = makeApp();
    const client = new TestClient(app);
    const resp = await client.post("/mcp", {
      json: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0" },
        },
      },
    });
    expect(resp.status_code).toBe(200);
    expect(resp.headers).toHaveProperty("mcp-session-id");
    const body = resp.json();
    expect(body.id).toBe(1);
    // Regression guard for the E2E-found inconsistency: initialize over
    // HTTP must negotiate 2025-06-18, not the shared STDIO constant.
    expect(body.result.protocolVersion).toBe("2025-06-18");
  });

  // ---- Protocol version negotiation (consistent with GET /health) ----

  it("test_health_and_initialize_report_same_protocol_version", async () => {
    // HTTP /health 与 initialize 声明的协议版本必须一致（回归守卫）。
    const app = makeApp();
    const client = new TestClient(app);
    const health = await client.get("/health");
    expect(health.status_code).toBe(200);

    const init = await client.post("/mcp", {
      json: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "t", version: "1" },
        },
      },
    });
    expect(init.status_code).toBe(200);
    expect(init.json().result.protocolVersion).toBe(health.json().protocol);
    expect(health.json().protocol).toBe(MCP_PROTOCOL_VERSION);
  });

  it("test_initialize_with_unsupported_version_responds_supported", async () => {
    // 请求不支持的版本 → 按规范返回服务器支持的版本（200，非错误）。
    const app = makeApp();
    const client = new TestClient(app);
    const resp = await client.post("/mcp", {
      json: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "t", version: "1" },
        },
      },
    });
    expect(resp.status_code).toBe(200);
    expect(resp.json().result.protocolVersion).toBe("2025-06-18");
  });

  it("test_initialize_without_protocol_version_defaults_to_supported", async () => {
    // 请求缺失 protocolVersion → 协商到 HTTP 传输支持的版本。
    const app = makeApp();
    const client = new TestClient(app);
    const resp = await client.post("/mcp", {
      json: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    });
    expect(resp.status_code).toBe(200);
    expect(resp.json().result.protocolVersion).toBe("2025-06-18");
  });

  it("test_session_limit_returns_503", async () => {
    const app = makeApp(null, { max_sessions: 1 });
    const client = new TestClient(app);
    const first = await client.post("/mcp", {
      json: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    });
    const second = await client.post("/mcp", {
      json: { jsonrpc: "2.0", id: 2, method: "initialize", params: {} },
    });

    expect(first.status_code).toBe(200);
    expect(second.status_code).toBe(503);
    expect(second.json().error.code).toBe(-32000);
  });

  it("test_post_without_session_or_initialize", async () => {
    const app = makeApp();
    const client = new TestClient(app);
    const resp = await client.post("/mcp", {
      json: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      },
    });
    expect(resp.status_code).toBe(400);
    expect(resp.json().error.message).toContain("Mcp-Session-Id");
  });

  it("test_post_with_invalid_session", async () => {
    const app = makeApp();
    const client = new TestClient(app);
    const resp = await client.post("/mcp", {
      json: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      },
      headers: { "Mcp-Session-Id": "nonexistent-session" },
    });
    expect(resp.status_code).toBe(404);
  });

  it("test_tools_list_after_initialize", async () => {
    const app = makeApp();
    const client = new TestClient(app);
    // Initialize
    const resp = await client.post("/mcp", {
      json: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "t", version: "1" },
        },
      },
    });
    const sessionId = resp.headers["mcp-session-id"] as string;

    // tools/list
    const resp2 = await client.post("/mcp", {
      json: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      },
      headers: { "Mcp-Session-Id": sessionId },
    });
    expect(resp2.status_code).toBe(200);
    const tools = resp2.json().result.tools;
    expect(tools.length).toBe(21);
    const names = new Set(tools.map((t: any) => t.name));
    expect(names.has("create_sandbox")).toBe(true);
    expect(names.has("run_code")).toBe(true);
  });

  it.each([
    ["create_sandbox", { template: "base" }],
    ["run_code", { code: "print('ok')" }],
    ["run_command", { command: "echo ok" }],
    ["read_file", { path: "/tmp/a" }],
    ["write_file", { path: "/tmp/a", content: "ok" }],
    ["list_files", { path: "/tmp" }],
    ["kill_sandbox", { sandbox_id: "sbx-1" }],
  ])("test_tool_call_is_delegated_over_http [%s]", async (toolName, args) => {
    const app = makeApp();
    const client = new TestClient(app);
    const initResponse = await client.post("/mcp", {
      json: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    });
    const sessionId = initResponse.headers["mcp-session-id"] as string;
    const server = app.state.session_store.getSession(sessionId)!;
    const expected = {
      jsonrpc: "2.0",
      id: 2,
      result: {
        content: [{ type: "text", text: '{"ok": true}' }],
        isError: false,
      },
    };
    server.handleRequest = vi.fn(async () => expected);
    const requestBody = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    };

    const response = await client.post("/mcp", {
      json: requestBody,
      headers: { "Mcp-Session-Id": sessionId },
    });

    expect(response.status_code).toBe(200);
    expect(response.json()).toEqual(expected);
    expect(server.handleRequest).toHaveBeenCalledTimes(1);
    expect(server.handleRequest).toHaveBeenCalledWith(requestBody);
  });

  // ---- Notifications ----

  it("test_notification_returns_202", async () => {
    const app = makeApp();
    const client = new TestClient(app);
    // Initialize first
    const resp = await client.post("/mcp", {
      json: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "t", version: "1" },
        },
      },
    });
    const sid = resp.headers["mcp-session-id"] as string;

    // Send notification (no id)
    const resp2 = await client.post("/mcp", {
      json: {
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      },
      headers: { "Mcp-Session-Id": sid },
    });
    expect(resp2.status_code).toBe(202);
  });

  // ---- Auth ----

  it("test_auth_required_post", async () => {
    const app = makeApp("test-token-abc");
    const client = new TestClient(app);
    // No auth header
    const resp = await client.post("/mcp", {
      json: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      },
    });
    expect(resp.status_code).toBe(401);
  });

  it("test_auth_valid_post", async () => {
    const app = makeApp("test-token-abc");
    const client = new TestClient(app);
    const resp = await client.post("/mcp", {
      json: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "t", version: "1" },
        },
      },
      headers: { Authorization: "Bearer test-token-abc" },
    });
    expect(resp.status_code).toBe(200);
    expect(resp.headers).toHaveProperty("mcp-session-id");
  });

  it("test_auth_wrong_token", async () => {
    const app = makeApp("test-token-abc");
    const client = new TestClient(app);
    const resp = await client.post("/mcp", {
      json: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      headers: { Authorization: "Bearer wrong" },
    });
    expect(resp.status_code).toBe(401);
  });

  it("test_empty_configured_token_rejects_request", async () => {
    const app = makeApp("  ");
    const client = new TestClient(app);
    const resp = await client.post("/mcp", {
      json: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      headers: { Authorization: "Bearer " },
    });
    expect(resp.status_code).toBe(401);
  });

  // ---- DELETE /mcp ----

  it("test_delete_session", async () => {
    const app = makeApp();
    const client = new TestClient(app);
    // Initialize
    const resp = await client.post("/mcp", {
      json: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "t", version: "1" },
        },
      },
    });
    const sid = resp.headers["mcp-session-id"] as string;

    // Patch shutdown to avoid real sandbox cleanup
    const store = app.state.session_store;
    const server = store.getSession(sid)!;
    server.shutdown = vi.fn(async () => undefined);

    // Delete
    const resp2 = await client.delete("/mcp", { "Mcp-Session-Id": sid });
    expect(resp2.status_code).toBe(200);
    expect(resp2.json().status).toBe("session_terminated");
    expect(store.getSession(sid)).toBeNull();
  });

  it("test_delete_without_session_header", async () => {
    const app = makeApp();
    const client = new TestClient(app);
    const resp = await client.delete("/mcp");
    expect(resp.status_code).toBe(400);
  });

  it("test_delete_unknown_session", async () => {
    const app = makeApp();
    const client = new TestClient(app);
    const resp = await client.delete("/mcp", { "Mcp-Session-Id": "no-such-session" });
    expect(resp.status_code).toBe(404);
  });

  // ---- GET /mcp (Phase 2 stub) ----

  it("test_get_returns_405", async () => {
    const app = makeApp();
    const client = new TestClient(app);
    const resp = await client.get("/mcp");
    expect(resp.status_code).toBe(405);
    expect((resp.headers.allow as string | undefined) ?? "").toContain("POST");
  });

  it("test_foreign_origin_is_rejected", async () => {
    const app = makeApp();
    const client = new TestClient(app);
    const resp = await client.post("/mcp", {
      json: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      headers: { Origin: "http://evil.example" },
    });
    expect(resp.status_code).toBe(403);
  });

  it("test_localhost_origin_is_allowed", async () => {
    const app = makeApp();
    const client = new TestClient(app);
    const resp = await client.post("/mcp", {
      json: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18" },
      },
      headers: { Origin: "http://127.0.0.1:9999" },
    });
    expect(resp.status_code).toBe(200);
  });

  // ---- Invalid JSON ----

  it("test_invalid_json_body", async () => {
    const app = makeApp();
    const client = new TestClient(app);
    const resp = await client.post("/mcp", {
      content: Buffer.from("not-json!!!"),
      headers: { "Content-Type": "application/json" },
    });
    expect(resp.status_code).toBe(400);
  });

  it.each([
    ["[]", []],
    ['[{"jsonrpc": "2.0", "id": 1, "method": "initialize"}]', [{ jsonrpc: "2.0", id: 1, method: "initialize" }]],
  ])("test_json_array_returns_invalid_request [%s]", async (_label, body) => {
    const app = makeApp();
    const client = new TestClient(app);
    const resp = await client.post("/mcp", { json: body });

    expect(resp.status_code).toBe(400);
    expect(resp.json().error.code).toBe(-32600);
  });

  // ---- Auth on DELETE ----

  it("test_delete_auth_required", async () => {
    const app = makeApp("sec");
    const client = new TestClient(app);
    const resp = await client.delete("/mcp", { "Mcp-Session-Id": "some-id" });
    expect(resp.status_code).toBe(401);
  });

  // ---- Auth on GET ----

  it("test_get_auth_required", async () => {
    const app = makeApp("sec");
    const client = new TestClient(app);
    const resp = await client.get("/mcp");
    expect(resp.status_code).toBe(401);
  });
});
