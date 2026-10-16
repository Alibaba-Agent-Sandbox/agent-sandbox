/** Lifecycle state/privacy boundaries; mock SDK tests are not cloud evidence. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SandboxInfo } from "../../src/models/sandbox.js";
import { AuthenticationError, SandboxError } from "../../src/models/errors.js";
import { ProviderFeatureNotSupportedError } from "../../src/providers/errors.js";
import { HTTPStatusError, Request, Response } from "../../src/transport/http.js";
import { getLogger } from "../../src/utils/logging.js";
import { SandboxManager, SandboxMCPServer, sdk } from "../../src/agent/mcp.js";
import { dispatchTool, TOOL_SCHEMA_MAP } from "../../src/agent/tools.js";

const SECRET = "synthetic-lifecycle-secret-never-return";
const statics = { create: vi.fn(), connect: vi.fn(), list: vi.fn(), killById: vi.fn(), getInfoById: vi.fn(), setTimeoutById: vi.fn() };

function info(id = "owned") {
  const record = new SandboxInfo({ sandboxID: id, templateID: "example", state: "running", region: "example-region",
    startedAt: "2026-10-16T00:00:00Z", endAt: "2026-10-16T00:05:00Z", cpuCount: 2, memoryMB: 4096, diskSizeMB: 10240,
    envdAccessToken: SECRET, accountID: SECRET, clientID: SECRET, userID: SECRET,
    metadata: { token: SECRET }, envdUrl: "https://example.invalid/?token=" + SECRET });
  // The boundary must not serialize the model wholesale, even if it gains fields.
  Object.assign(record, { envs: { API_KEY: SECRET }, unexpected: SECRET,
    toJSON: () => { throw new Error(SECRET); } });
  return record;
}

function handle(id = "owned") {
  return { id, status: "running", url: "https://example.invalid", kill: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined), setTimeout: vi.fn(async (_seconds: number): Promise<void> => undefined),
    refreshInfo: vi.fn(async () => info(id)) };
}

beforeEach(() => {
  vi.restoreAllMocks();
  for (const mock of Object.values(statics)) mock.mockReset();
  vi.spyOn(sdk, "loadSandbox").mockResolvedValue(statics);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("MCP lifecycle input and SDK forwarding", () => {
  it("forwards only supported creation controls and maps region to existing TS provider option", async () => {
    const sandbox = handle();
    statics.create.mockResolvedValue(sandbox);
    const manager = new SandboxManager({ api_key: SECRET, api_url: "https://example.invalid", domain: "example.invalid" });
    const result = await dispatchTool("create_sandbox", {
      template: "example", timeout: 600, provider: "configured", region: "example-region", cpu: 2, memory: 4096,
      envs: { MODEL_API_KEY: SECRET },
    }, manager);
    expect(statics.create).toHaveBeenCalledWith({ template: "example", timeout: 600, envs: { MODEL_API_KEY: SECRET },
      api_key: SECRET, api_url: "https://example.invalid", domain: "example.invalid", provider: "configured",
      provider_options: { region: "example-region" }, cpu: 2, memory: 4096 });
    expect(manager._default_sandbox).toBe(sandbox);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it.each([
    ["create_sandbox", { timeout: true }], ["create_sandbox", { timeout: "300" }],
    ["create_sandbox", { timeout: 0 }], ["create_sandbox", { timeout: 86401 }],
    ["create_sandbox", { cpu: 1.1 }], ["create_sandbox", { memory: 0 }],
    ["create_sandbox", { region: " " }], ["create_sandbox", { provider: null }],
    ["create_sandbox", { envs: { TOKEN: 1 } }], ["create_sandbox", { team: SECRET }],
    ["list_sandboxes", { limit: 101 }], ["list_sandboxes", { offset: -1 }],
    ["list_sandboxes", { status: "unsupported" }], ["list_sandboxes", { status: "pausing" }],
    ["list_sandboxes", { team_id: SECRET }], ["get_sandbox", { sandbox_id: " " }],
    ["get_sandbox", { team: SECRET }], ["set_sandbox_timeout", {}],
    ["set_sandbox_timeout", { timeout: false }], ["set_sandbox_timeout", { timeout: 600, team: SECRET }],
  ] as const)("rejects invalid %s inputs before SDK access", async (name, params) => {
    const result = await dispatchTool(name, params, new SandboxManager());
    expect(result).toHaveProperty("error");
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(sdk.loadSandbox).not.toHaveBeenCalled();
  });

  it("publishes strict lifecycle schemas and actual TS status support", () => {
    for (const name of ["create_sandbox", "list_sandboxes", "get_sandbox", "set_sandbox_timeout"]) {
      expect(TOOL_SCHEMA_MAP[name].inputSchema.additionalProperties).toBe(false);
    }
    expect(TOOL_SCHEMA_MAP.set_sandbox_timeout.inputSchema.required).toEqual(["timeout"]);
    expect(TOOL_SCHEMA_MAP.list_sandboxes.inputSchema.properties).not.toHaveProperty("team");
  });
});

describe("non-creating metadata and TTL state", () => {
  it("list only calls static SDK list, preserves default and filters model metadata", async () => {
    const manager = new SandboxManager({ api_key: SECRET, api_url: "https://example.invalid", domain: "unused-domain" });
    const current = handle();
    manager._sandboxes.set(current.id, current);
    manager._default_sandbox = current;
    statics.list.mockResolvedValue([info("visible-external")]);
    const result = await dispatchTool("list_sandboxes", { limit: 20, offset: 2, status: "running", provider: "configured", region: "example-region" }, manager);
    expect(statics.list).toHaveBeenCalledWith({ limit: 20, offset: 2, status: "running", provider: "configured",
      provider_options: { region: "example-region" }, api_key: SECRET, api_url: "https://example.invalid" });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(result).toEqual({ limit: 20, offset: 2, sandboxes: [{ sandbox_id: "visible-external", template: "example", status: "running", region: "example-region",
      started_at: "2026-10-16T00:00:00.000Z", end_at: "2026-10-16T00:05:00.000Z", cpu_count: 2, memory_mb: 4096, disk_size_mb: 10240 }] });
    expect(manager._default_sandbox).toBe(current);
    expect([...manager._sandboxes.keys()]).toEqual(["owned"]);
    expect(statics.create).not.toHaveBeenCalled();
    expect(statics.connect).not.toHaveBeenCalled();
    expect(current.setTimeout).not.toHaveBeenCalled();
  });

  it.each(["get_sandbox", "set_sandbox_timeout"])("%s without existing default never creates", async (name) => {
    const manager = new SandboxManager();
    const server = new SandboxMCPServer(); server._manager = manager;
    const response = await server.handleRequest({
      jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: name === "get_sandbox" ? {} : { timeout: 300 } },
    });
    expect(response?.result).toHaveProperty("isError", true);
    expect(statics.create).not.toHaveBeenCalled();
    expect(statics.connect).not.toHaveBeenCalled();
    expect(manager._sandboxes.size).toBe(0);
  });

  it("get cached metadata refreshes only, without TTL extension", async () => {
    const manager = new SandboxManager();
    const current = handle();
    manager._sandboxes.set(current.id, current); manager._default_sandbox = current;
    const result = await dispatchTool("get_sandbox", {}, manager);
    expect(result.sandbox_id).toBe(current.id);
    expect(current.refreshInfo).toHaveBeenCalledTimes(1);
    expect(current.setTimeout).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it.each([false, true])("external inspect calls pure metadata API and never adopts (failure=%s)", async (fail) => {
    const manager = new SandboxManager();
    if (fail) statics.getInfoById.mockRejectedValue(new Error(SECRET));
    else statics.getInfoById.mockResolvedValue(info("external"));
    const result = await dispatchTool("get_sandbox", { sandbox_id: "external" }, manager);
    expect(result).toHaveProperty(fail ? "error" : "sandbox_id");
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(statics.getInfoById).toHaveBeenCalledWith("external", {});
    expect(statics.connect).not.toHaveBeenCalled();
    expect(manager._sandboxes.size).toBe(0); expect(manager._lifetimes.size).toBe(0);
    expect(manager._default_sandbox).toBeNull();
    await manager.shutdown(); expect(statics.killById).not.toHaveBeenCalled();
  });

  it.each([false, true])("external timeout uses direct API without connect or adoption (failure=%s)", async (fail) => {
    const manager = new SandboxManager();
    if (fail) statics.setTimeoutById.mockRejectedValue(new Error(SECRET));
    const result = await dispatchTool("set_sandbox_timeout", { sandbox_id: "external", timeout: 700 }, manager);
    expect(result).toHaveProperty(fail ? "error" : "success");
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(statics.setTimeoutById).toHaveBeenCalledWith("external", 700, {});
    expect(statics.connect).not.toHaveBeenCalled();
    expect(manager._sandboxes.size).toBe(0); expect(manager._lifetimes.size).toBe(0);
    await manager.shutdown(); expect(statics.killById).not.toHaveBeenCalled();
  });

  it("successful managed TTL updates subsequent automatic renewal; failure keeps old policy", async () => {
    const manager = new SandboxManager(); const current = handle();
    manager._sandboxes.set(current.id, current); manager._default_sandbox = current; manager._lifetimes.set(current.id, 300);
    expect(await dispatchTool("set_sandbox_timeout", { timeout: 800 }, manager)).toEqual({ success: true, sandbox_id: "owned", timeout: 800 });
    await manager.getSandbox(); expect(current.setTimeout).toHaveBeenLastCalledWith(800);
    current.setTimeout.mockRejectedValueOnce(new Error(SECRET));
    expect(await dispatchTool("set_sandbox_timeout", { timeout: 900 }, manager)).toHaveProperty("error");
    expect(manager._lifetimes.get(current.id)).toBe(800);
  });

  it("late TTL completion after shutdown does not resurrect managed lifetime state", async () => {
    const manager = new SandboxManager(); const current = handle(); const pending = deferred<void>();
    current.setTimeout.mockImplementation(() => pending.promise);
    manager._sandboxes.set(current.id, current); manager._default_sandbox = current;
    const operation = manager.setSandboxTimeout(800);
    await vi.waitFor(() => expect(current.setTimeout).toHaveBeenCalled());
    await manager.shutdown(); pending.resolve(); await operation;
    expect(manager._sandboxes.size).toBe(0); expect(manager._lifetimes.size).toBe(0); expect(manager._default_sandbox).toBeNull();
  });

  it("external inspection finishing after shutdown never changes session ownership", async () => {
    const manager = new SandboxManager(); const pending = deferred<SandboxInfo>();
    statics.getInfoById.mockImplementation(() => pending.promise);
    const operation = manager.inspectSandbox("external");
    await vi.waitFor(() => expect(statics.getInfoById).toHaveBeenCalled());
    await manager.shutdown(); pending.resolve(info("external")); await operation;
    expect(statics.connect).not.toHaveBeenCalled(); expect(statics.killById).not.toHaveBeenCalled();
    expect(manager._sandboxes.size).toBe(0);
  });
});

describe("lifecycle error and log privacy", () => {
  it.each([
    new Error(SECRET),
    new TypeError(SECRET),
    new AuthenticationError(SECRET, { suggestion: SECRET, docs_url: SECRET }),
    new SandboxError(SECRET, { code: SECRET, suggestion: SECRET }),
    new ProviderFeatureNotSupportedError(SECRET, SECRET, { message: SECRET, suggestion: SECRET }),
  ])("omits all raw provider exception values from lifecycle responses/logs", async (error) => {
    const log = vi.spyOn(getLogger("agent.tools"), "error");
    statics.list.mockRejectedValue(error);
    const result = await dispatchTool("list_sandboxes", {}, new SandboxManager());
    expect(result).toHaveProperty("error");
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(log.mock.calls)).not.toContain(SECRET);
    expect(log.mock.calls[0]).toHaveLength(3); // No ExcInfo carrying a hidden traceback.
  });

  it("keeps HTTP status but strips URLs, bodies and headers", async () => {
    const request = new Request("GET", "https://example.invalid/" + SECRET);
    const response = new Response(403, { request, text: SECRET, headers: { authorization: SECRET } });
    statics.list.mockRejectedValue(new HTTPStatusError(SECRET, { request, response }));
    expect(await dispatchTool("list_sandboxes", {}, new SandboxManager())).toEqual({ error: "Sandbox lifecycle request failed (HTTP 403)." });
  });

  it("TTL refresh and shutdown warnings omit exception text and traceback", async () => {
    const log = vi.spyOn(getLogger("agent.mcp"), "warning"); const current = handle();
    current.setTimeout.mockRejectedValue(new Error(SECRET)); current.kill.mockRejectedValue(new Error(SECRET));
    const manager = new SandboxManager(); manager._sandboxes.set(current.id, current); manager._default_sandbox = current;
    await manager.getSandbox(); await manager.shutdown();
    expect(JSON.stringify(log.mock.calls)).not.toContain(SECRET);
    expect(log.mock.calls.every((call) => call.length === 1)).toBe(true);
  });
});
