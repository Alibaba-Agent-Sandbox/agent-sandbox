/** Tests for MCP Server initialization and request handling. */

import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SandboxMock = vi.hoisted(() => ({
  list: vi.fn(),
  setTimeoutById: vi.fn(async () => undefined), getInfoById: vi.fn(),
  create: vi.fn(),
  connect: vi.fn(),
  killById: vi.fn(),
}));

import {
  INVALID_REQUEST,
  MCP_PROTOCOL_VERSION,
  METHOD_NOT_FOUND,
  SERVER_NAME,
  SERVER_VERSION,
  SandboxManager,
  SandboxMCPServer,
  _jsonrpcError,
  _jsonrpcResponse,
  sdk,
} from "../../src/agent/mcp.js";
import { dispatchTool } from "../../src/agent/tools.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** An `AsyncMock()` sandbox: every async SDK method exists and resolves. */
function mockSandbox(sandboxId: string, extra: Record<string, unknown> = {}): any {
  return {
    id: sandboxId,
    kill: vi.fn(async () => undefined),
    setTimeout: vi.fn(async () => undefined),
    ...extra,
  };
}

beforeEach(() => {
  vi.spyOn(sdk, "loadSandbox").mockResolvedValue(SandboxMock);
  SandboxMock.create.mockReset();
  SandboxMock.connect.mockReset();
  SandboxMock.killById.mockReset();
});

// ---------------------------------------------------------------------------
// JSON-RPC helper tests
// ---------------------------------------------------------------------------

describe("TestJsonRpcHelpers", () => {
  it("test_jsonrpc_response", () => {
    const resp = _jsonrpcResponse(1, { tools: [] });
    expect(resp.jsonrpc).toBe("2.0");
    expect(resp.id).toBe(1);
    expect(resp.result).toEqual({ tools: [] });
    expect(resp).not.toHaveProperty("error");
  });

  it("test_jsonrpc_error", () => {
    const resp: any = _jsonrpcError(2, -32601, "Method not found");
    expect(resp.jsonrpc).toBe("2.0");
    expect(resp.id).toBe(2);
    expect(resp.error.code).toBe(-32601);
    expect(resp.error.message).toBe("Method not found");
  });

  it("test_jsonrpc_error_with_data", () => {
    const resp: any = _jsonrpcError(3, -32603, "Internal error", { detail: "boom" });
    expect(resp.error.data.detail).toBe("boom");
  });
});

// ---------------------------------------------------------------------------
// SandboxManager tests
// ---------------------------------------------------------------------------

describe("TestSandboxManager", () => {
  it("test_init", () => {
    const mgr = new SandboxManager({ api_key: "test-key", template: "python-base" });
    expect(mgr._api_key).toBe("test-key");
    expect(mgr._default_template).toBe("python-base");
    expect(mgr._default_sandbox).toBeNull();
  });

  it("test_create_sandbox", async () => {
    const mgr = new SandboxManager({ api_key: "k" });
    const mockSb = mockSandbox("sbx-001");
    SandboxMock.create.mockResolvedValue(mockSb);
    const result = await mgr.createSandbox({ template: "test-tpl" });
    expect(result.id).toBe("sbx-001");
    expect(mgr._sandboxes.has("sbx-001")).toBe(true);
  });

  it("test_get_sandbox_creates_default", async () => {
    const mgr = new SandboxManager({ api_key: "k" });
    const mockSb = mockSandbox("sbx-default");
    mgr.createSandbox = vi.fn(async () => {
      mgr._default_sandbox = mockSb;
      return mockSb;
    });

    const result = await mgr.getSandbox(null);
    expect(result.id).toBe("sbx-default");
    expect(mgr.createSandbox).toHaveBeenCalledTimes(1);
    // Second call should reuse
    const result2 = await mgr.getSandbox(null);
    expect(result2.id).toBe("sbx-default");
    // Still only one create call
    expect(vi.mocked(mgr.createSandbox).mock.calls.length).toBe(1);
  });

  it("test_get_sandbox_by_id_from_cache", async () => {
    const mgr = new SandboxManager();
    const mockSb = mockSandbox("sbx-123");
    mgr._sandboxes.set("sbx-123", mockSb);

    const result = await mgr.getSandbox("sbx-123");
    expect(result).toBe(mockSb);
  });

  it("test_kill_sandbox_default", async () => {
    const mgr = new SandboxManager();
    const mockSb = mockSandbox("sbx-def");
    mgr._default_sandbox = mockSb;
    mgr._sandboxes.set("sbx-def", mockSb);

    await mgr.killSandbox(null);
    expect(mockSb.kill).toHaveBeenCalledTimes(1);
    expect(mgr._default_sandbox).toBeNull();
    expect(mgr._sandboxes.has("sbx-def")).toBe(false);
  });

  it("test_kill_sandbox_by_id", async () => {
    const mgr = new SandboxManager();
    const mockSb = mockSandbox("sbx-002");
    mgr._sandboxes.set("sbx-002", mockSb);

    await mgr.killSandbox("sbx-002");
    expect(mockSb.kill).toHaveBeenCalledTimes(1);
    expect(mgr._sandboxes.has("sbx-002")).toBe(false);
  });

  it("test_shutdown", async () => {
    const mgr = new SandboxManager();
    const sb1 = mockSandbox("sb1");
    const sb2 = mockSandbox("sb2");
    mgr._sandboxes = new Map([
      ["sb1", sb1],
      ["sb2", sb2],
    ]);
    mgr._default_sandbox = sb1;

    await mgr.shutdown();
    expect(sb1.kill).toHaveBeenCalledTimes(1);
    expect(sb2.kill).toHaveBeenCalledTimes(1);
    expect(mgr._default_sandbox).toBeNull();
    expect(mgr._sandboxes.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SandboxMCPServer tests
// ---------------------------------------------------------------------------

describe("TestSandboxMCPServer", () => {
  it("test_init", () => {
    const server = new SandboxMCPServer({ api_key: "k", template: "t" });
    expect(server.initialized).toBe(false);
    expect(server.manager).not.toBeNull();
  });

  it("test_initialize", async () => {
    const server = new SandboxMCPServer();
    const resp: any = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "0.1" },
      },
    });
    expect(resp).not.toBeNull();
    expect(resp.id).toBe(1);
    const result = resp.result;
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(result.serverInfo.name).toBe(SERVER_NAME);
    expect(result.serverInfo.version).toBe(SERVER_VERSION);
    expect(result.capabilities).toHaveProperty("tools");
    expect(server.initialized).toBe(true);
  });

  it("test_initialized_notification", async () => {
    const server = new SandboxMCPServer();
    // Notification (no id)
    const resp = await server.handleRequest({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    });
    expect(resp).toBeNull(); // Notifications get no response
  });

  it("test_tools_list", async () => {
    const server = new SandboxMCPServer();
    const resp: any = await server.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    expect(resp).not.toBeNull();
    const tools = resp.result.tools;
    expect(tools.length).toBe(21);
    const names = new Set(tools.map((t: any) => t.name));
    expect(names.has("run_code")).toBe(true);
    expect(names.has("create_sandbox")).toBe(true);
  });

  it("test_tools_call_unknown_tool", async () => {
    const server = new SandboxMCPServer();
    const resp: any = await server.handleRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "nonexistent", arguments: {} },
    });
    expect(resp).not.toBeNull();
    const result = resp.result;
    expect(result.isError).toBe(true);
    const text = JSON.parse(result.content[0].text);
    expect(text.error).toContain("Unknown tool");
  });

  it("test_tools_call_success", async () => {
    const server = new SandboxMCPServer();
    // Mock the manager's get_sandbox
    const mockSb = mockSandbox("sbx-t", {
      runCode: vi.fn(async () => ({
        text: "ok",
        stdout: "ok\n",
        stderr: "",
        exit_code: 0,
        output_files: [],
      })),
    });
    server._manager.getSandbox = vi.fn(async () => mockSb);

    const resp: any = await server.handleRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "run_code",
        arguments: { code: "print('ok')" },
      },
    });
    expect(resp).not.toBeNull();
    const result = resp.result;
    expect(result.isError).toBe(false);
    const text = JSON.parse(result.content[0].text);
    expect(text.stdout).toBe("ok\n");
  });

  it("test_unknown_method", async () => {
    const server = new SandboxMCPServer();
    const resp: any = await server.handleRequest({
      jsonrpc: "2.0",
      id: 5,
      method: "unknown/method",
      params: {},
    });
    expect(resp).not.toBeNull();
    expect(resp).toHaveProperty("error");
    expect(resp.error.code).toBe(METHOD_NOT_FOUND);
  });

  it.each([
    ["[]", []],
    ['[{"jsonrpc": "2.0", "id": 1, "method": "ping"}]', [{ jsonrpc: "2.0", id: 1, method: "ping" }]],
  ])("test_non_object_request_is_rejected [%s]", async (_label, payload) => {
    const server = new SandboxMCPServer();
    const resp: any = await server.handleRequest(payload);

    expect(resp).not.toBeNull();
    expect(resp.id).toBeNull();
    expect(resp.error.code).toBe(INVALID_REQUEST);
  });

  it("test_ping", async () => {
    const server = new SandboxMCPServer();
    const resp: any = await server.handleRequest({
      jsonrpc: "2.0",
      id: 6,
      method: "ping",
      params: {},
    });
    expect(resp).not.toBeNull();
    expect(resp.result).toEqual({});
  });

  it("test_unknown_notification_ignored", async () => {
    const server = new SandboxMCPServer();
    // Unknown notification (no id) should be silently ignored
    const resp = await server.handleRequest({
      jsonrpc: "2.0",
      method: "some/unknown/notification",
      params: {},
    });
    expect(resp).toBeNull();
  });

  it("test_shutdown", async () => {
    const server = new SandboxMCPServer();
    server._manager.shutdown = vi.fn(async () => undefined);
    await server.shutdown();
    expect(server._manager.shutdown).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Protocol version negotiation (per-transport)
// ---------------------------------------------------------------------------

describe("TestProtocolVersionNegotiation", () => {
  // Test initialize protocol version negotiation.
  //
  // STDIO keeps its legacy ``2024-11-05`` default; other transports declare
  // their own supported set. Supported requests are echoed; missing or
  // unsupported requests fall back to the preferred (first) version.

  async function initialize(server: SandboxMCPServer, requested: unknown = null): Promise<any> {
    const params: Record<string, unknown> = {
      capabilities: {},
      clientInfo: { name: "test", version: "0.1" },
    };
    if (requested !== null) {
      params.protocolVersion = requested;
    }
    return server.handleRequest({ jsonrpc: "2.0", id: 1, method: "initialize", params });
  }

  it.each([
    ["2024-11-05", "2024-11-05"],
    ["2025-06-18", "2025-06-18"],
    ["1999-01-01", "1999-01-01"],
    ["None", null],
    ["1", 1],
  ])("test_stdio_default_keeps_2024_11_05 [%s]", async (_label, requested) => {
    // STDIO 默认仅支持 2024-11-05 —— 与修复前行为完全一致（无回归）。
    const server = new SandboxMCPServer();
    const resp = await initialize(server, requested);
    expect(resp).not.toBeNull();
    expect(resp.result.protocolVersion).toBe("2024-11-05");
    expect(resp.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
  });

  it("test_echo_requested_version_when_transport_supports_it", async () => {
    const server = new SandboxMCPServer({
      supported_protocol_versions: ["2025-06-18", "2024-11-05"],
    });
    let resp = await initialize(server, "2025-06-18");
    expect(resp.result.protocolVersion).toBe("2025-06-18");
    resp = await initialize(server, "2024-11-05");
    expect(resp.result.protocolVersion).toBe("2024-11-05");
  });

  it("test_unsupported_version_falls_back_to_preferred", async () => {
    // 不支持的请求版本 → 回退到首选支持版本（MCP 规范协商规则）。
    const server = new SandboxMCPServer({ supported_protocol_versions: ["2025-06-18"] });
    const resp = await initialize(server, "2024-11-05");
    expect(resp.result.protocolVersion).toBe("2025-06-18");
  });

  it("test_missing_version_falls_back_to_preferred", async () => {
    // 请求缺失 protocolVersion → 回退到首选支持版本。
    const server = new SandboxMCPServer({
      supported_protocol_versions: ["2025-06-18", "2024-11-05"],
    });
    const resp = await initialize(server, null);
    expect(resp.result.protocolVersion).toBe("2025-06-18");
  });

  it("test_empty_supported_versions_rejected", () => {
    expect(() => new SandboxMCPServer({ supported_protocol_versions: [] })).toThrow(
      /at least one version/,
    );
  });
});

// ---------------------------------------------------------------------------
// Default-sandbox contract the agent workflow depends on
// ---------------------------------------------------------------------------

function fakeSandbox(sandboxId: string, template = "base"): any {
  return mockSandbox(sandboxId, {
    template,
    status: { value: "running" },
    url: `https://${sandboxId}.example`,
    files: {
      write: vi.fn(async () => undefined),
      read: vi.fn(async () => ""),
      list: vi.fn(async () => []),
    },
  });
}

describe("TestDefaultSandboxContract", () => {
  // create_sandbox becomes the default; kill of nothing is an error.

  it("test_explicit_create_is_reused_without_id", async () => {
    const manager = new SandboxManager({ template: "python-hello" });
    const created: any[] = [];

    SandboxMock.create.mockImplementation(async (kwargs: Record<string, unknown>) => {
      const sandbox = fakeSandbox(`sb-${created.length + 1}`, String(kwargs.template));
      created.push(sandbox);
      return sandbox;
    });

    const createdResult = await dispatchTool("create_sandbox", {}, manager);
    const written = await dispatchTool(
      "write_file",
      { path: "/tmp/app.py", content: "print(1)\n" },
      manager,
    );
    const killed = await dispatchTool("kill_sandbox", {}, manager);

    expect(createdResult.sandbox_id).toBe("sb-1");
    expect(created.length).toBe(1);
    expect(created[0].template).toBe("python-hello");
    expect(created[0].files.write).toHaveBeenCalledTimes(1);
    expect(written.success).toBe(true);
    expect(killed).toEqual({ success: true, sandbox_id: "sb-1" });
    expect(created[0].kill).toHaveBeenCalledTimes(1);
  });

  it("test_kill_without_sandbox_is_an_error", async () => {
    const manager = new SandboxManager();

    const result = await dispatchTool("kill_sandbox", {}, manager);
    expect(result.success).toBe(false);
    expect(result).toHaveProperty("error");
  });

  it("test_concurrent_lazy_create_is_single", async () => {
    const manager = new SandboxManager({ template: "python-hello" });
    let started = 0;
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });

    SandboxMock.create.mockImplementation(async (kwargs: Record<string, unknown>) => {
      started += 1;
      await released;
      return fakeSandbox("sb-shared", String(kwargs.template));
    });

    const first = manager.getSandbox(null);
    const second = manager.getSandbox(null);
    for (let i = 0; i < 50; i++) {
      if (started) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(started).toBe(1);
    release();
    const [left, right] = await Promise.all([first, second]);

    expect(left.id).toBe("sb-shared");
    expect(right.id).toBe("sb-shared");
    expect(started).toBe(1);
  });

  it("test_nonzero_exit_is_tool_error", async () => {
    const server = new SandboxMCPServer();
    const mockSb = mockSandbox("sbx-t", {
      runCode: vi.fn(async () => ({
        text: "",
        stdout: "",
        stderr: "nope\n",
        exit_code: 1,
        output_files: [],
      })),
    });
    server._manager.getSandbox = vi.fn(async () => mockSb);
    const resp: any = await server.handleRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "run_code", arguments: { code: "raise SystemExit(1)" } },
    });
    expect(resp).not.toBeNull();
    expect(resp.result.isError).toBe(true);
  });

  it("test_null_params_do_not_crash", async () => {
    const server = new SandboxMCPServer();
    const resp: any = await server.handleRequest({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: null,
    });
    expect(resp).not.toBeNull();
    expect(resp).not.toHaveProperty("error");
    expect(resp.result.isError).toBe(true);
  });

  it("test_tool_error_drops_httpx_doc_link", async () => {
    class BoomError extends Error {}

    const manager = new SandboxManager();

    manager.getSandbox = async (_sandboxId: string | null = null): Promise<never> => {
      throw new BoomError(
        "Server error '500 Internal' for url 'http://127.0.0.1/sandboxes'\n" +
          "For more information check: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/500",
      );
    };
    const result = await dispatchTool("run_code", { code: "print(1)" }, manager);
    expect((result.error as string).toLowerCase()).not.toContain("mozilla");
    expect(result.error as string).toContain("500");
  });
});

it("reports the installed CLI package version through MCP", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
  expect(SERVER_VERSION).toBe(pkg.version);
});
