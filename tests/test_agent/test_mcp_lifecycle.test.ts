/** Current MCP lifecycle and privacy contracts, without the retired renewal state. */
import { beforeEach, expect, it, vi } from "vitest";
import { SandboxManager, sdk } from "../../src/agent/mcp.js";
import { dispatchTool } from "../../src/agent/tools.js";
import { AuthenticationError } from "../../src/models/errors.js";
import { HTTPStatusError, Request, Response } from "../../src/transport/http.js";
import { getLogger } from "../../src/utils/logging.js";
const secret = "synthetic-private-provider-value";
const statics = { create: vi.fn(), connect: vi.fn(), list: vi.fn(), getInfoById: vi.fn(), setTimeoutById: vi.fn(), killById: vi.fn() };
const row = { sandbox_id: "owned", template: "base", status: "running", region: "fixture", timeout: 600,
  cpu_count: 2, memory_mb: 1024, started_at: null, end_at: null, envd_access_token: secret, metadata: { token: secret } };
function handle() { return { id: "owned", url: "https://fixture.invalid", status: "running", setTimeout: vi.fn(), kill: vi.fn(), close: vi.fn(), _createdMetadataReader: vi.fn().mockResolvedValue({ state: "found", info: row }) }; }
beforeEach(() => { vi.restoreAllMocks(); for (const f of Object.values(statics)) f.mockReset(); vi.spyOn(sdk, "loadSandbox").mockResolvedValue(statics); });
it("forwards supported create inputs, rejecting unknown controls before SDK work", async () => {
  const sandbox = handle(); statics.create.mockResolvedValue(sandbox); statics.getInfoById.mockResolvedValue(row);
  const manager = new SandboxManager();
  expect(await dispatchTool("create_sandbox", { template: "base", timeout: 600, cpu: 2, memory: 1024, region: "fixture" }, manager)).toMatchObject({ sandbox_id: "owned" });
  expect(statics.create).toHaveBeenCalledWith(expect.objectContaining({ cpu: 2, memory: 1024, provider_options: { region: "fixture" } }));
  statics.create.mockClear();
  expect(await dispatchTool("create_sandbox", { team: secret }, manager)).toMatchObject({ error: expect.any(String) });
  expect(statics.create).not.toHaveBeenCalled();
});
it("list and metadata inspection neither adopt nor extend an external resource", async () => {
  statics.list.mockResolvedValue([row]); statics.getInfoById.mockResolvedValue(row);
  const manager = new SandboxManager();
  const listed = await dispatchTool("list_sandboxes", { limit: 10, offset: 0 }, manager);
  const observed = await dispatchTool("get_sandbox", { sandbox_id: "owned" }, manager);
  expect(listed).toMatchObject({ sandboxes: [{ sandbox_id: "owned" }] });
  expect(observed).toMatchObject({ sandbox: { sandbox_id: "owned", timeout: 600 } });
  expect(JSON.stringify([listed, observed])).not.toContain(secret);
  await manager.shutdown();
  expect(statics.create).not.toHaveBeenCalled(); expect(statics.connect).not.toHaveBeenCalled(); expect(statics.killById).not.toHaveBeenCalled();
  expect(manager._sandboxes.size).toBe(0);
});
it("only an explicit lifetime tool changes TTL, and reports observed metadata separately", async () => {
  const sandbox = handle(); const manager = new SandboxManager();
  manager._sandboxes.set("owned", sandbox); manager._default_sandbox = sandbox; statics.getInfoById.mockResolvedValue(row);
  await manager.getSandbox("owned"); await manager.getSandbox();
  expect(sandbox.setTimeout).not.toHaveBeenCalled();
  expect(await dispatchTool("set_sandbox_timeout", { sandbox_id: "owned", timeout: 600 }, manager)).toMatchObject({ accepted: true, requested_timeout: 600, timeout_verified: true });
  expect(sandbox.setTimeout).not.toHaveBeenCalled();
  expect(statics.setTimeoutById).toHaveBeenCalledExactlyOnceWith("owned", 600, {});
});
it.each([new AuthenticationError(secret), new Error(secret)])("does not expose lifecycle exception text or traces", async error => {
  statics.list.mockRejectedValue(error); const log = vi.spyOn(getLogger("agent.tools"), "error");
  const result = await dispatchTool("list_sandboxes", {}, new SandboxManager());
  expect(result).toMatchObject({ error: expect.any(String) });
  expect(JSON.stringify([result, log.mock.calls])).not.toContain(secret);
});
it("keeps HTTP status but strips provider URLs, headers and bodies", async () => {
  const request = new Request("GET", `https://fixture.invalid/?token=${secret}`);
  const response = new Response(403, { request, text: secret, headers: { authorization: secret } });
  statics.list.mockRejectedValue(new HTTPStatusError(secret, { request, response }));
  expect(await dispatchTool("list_sandboxes", {}, new SandboxManager())).toEqual({ error: "Sandbox lifecycle request failed (HTTP 403)." });
});
