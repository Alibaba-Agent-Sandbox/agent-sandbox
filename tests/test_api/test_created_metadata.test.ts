import "../_support/isolatedHome.js";
import { afterEach, expect, it, vi } from "vitest";
import { freezeCreatedMetadataReader } from "../../src/api/created_metadata.js";
import { Sandbox } from "../../src/api/sandbox.js";
import { SandboxManager, sdk } from "../../src/agent/mcp.js";
import { dispatchTool } from "../../src/agent/tools.js";
import { SandboxNotFoundError } from "../../src/models/errors.js";
import { ProviderResourceNotFoundError } from "../../src/models/provider_errors.js";
import { SandboxInfo } from "../../src/models/sandbox.js";
import { Provider, type ProviderInfra } from "../../src/providers/base.js";
import { unregisterProvider } from "../../src/providers/registry.js";
import { LayeredConfig } from "../../src/transport/config_layers.js";
import { HTTPStatusError, Request, Response } from "../../src/transport/http.js";
import { useIso } from "../_support/iso.js";

useIso();
afterEach(() => { vi.restoreAllMocks(); unregisterProvider("created-observer-test"); });
const info = () => new SandboxInfo({ sandbox_id: "new-shanghai", template: "base", envd_url: "https://session.invalid", cpu_count: 2, memory_mb: 2048 });
function fixture() {
  const getInfo = vi.fn().mockResolvedValue(info()); const close = vi.fn().mockResolvedValue(undefined);
  const buildInfra = vi.fn(async (config: LayeredConfig) => ({ config, sandbox_protocol: { getInfo }, close }));
  const config = new LayeredConfig({ provider: "created-observer-test", region: "cn-shanghai", sandbox_base_url: "https://shanghai.example.test",
    sandbox_api_key: "synthetic-private-key", provider_options: { region: "cn-shanghai", route: { cluster: "created-cluster" } } });
  return { getInfo, close, buildInfra, config, provider: { buildInfra } as unknown as Provider };
}
it("freezes full creation configuration and gives every fresh read a separate deep copy", async () => {
  const f = fixture(); const read = freezeCreatedMetadataReader(f.provider, f.config, "new-shanghai");
  f.config.region = "cn-hangzhou"; f.config.sandbox_base_url = "https://wrong.example.test";
  (f.config.provider_options.route as { cluster: string }).cluster = "wrong";
  expect(await read()).toMatchObject({ state: "found", info: { cpu_count: 2 } });
  const first = f.buildInfra.mock.calls[0][0];
  expect(first).toMatchObject({ region: "cn-shanghai", sandbox_base_url: "https://shanghai.example.test", sandbox_api_key: "synthetic-private-key",
    provider_options: { region: "cn-shanghai", route: { cluster: "created-cluster" } } });
  (first.provider_options.route as { cluster: string }).cluster = "mutated-by-provider";
  await read();
  expect(f.buildInfra.mock.calls[1][0].provider_options.route).toEqual({ cluster: "created-cluster" });
  expect(f.getInfo).toHaveBeenNthCalledWith(1, "new-shanghai"); expect(f.close).toHaveBeenCalledTimes(2);
});
it.each(["setup", "query", "close"])("only query not-found proves absence: %s stage", async stage => {
  const f = fixture(); const error = new SandboxNotFoundError("synthetic-private-value");
  if (stage === "setup") f.buildInfra.mockRejectedValue(error);
  if (stage === "query") f.getInfo.mockRejectedValue(error);
  if (stage === "close") f.close.mockRejectedValue(error);
  expect(await freezeCreatedMetadataReader(f.provider, f.config, "new-shanghai")()).toEqual({ state: stage === "query" ? "absent" : "unknown" });
  if (stage !== "setup") expect(f.close).toHaveBeenCalledOnce();
});
it("does not confirm query absence if closing its infrastructure fails", async () => {
  const f = fixture(); f.getInfo.mockRejectedValue(new SandboxNotFoundError("new-shanghai")); f.close.mockRejectedValue(new Error("private"));
  expect(await freezeCreatedMetadataReader(f.provider, f.config, "new-shanghai")()).toEqual({ state: "unknown" });
});
it.each([new ProviderResourceNotFoundError("new-shanghai"), 404, 403])("recognizes only typed not-found and HTTP404 query failures: %s", async error => {
  const f = fixture();
  if (typeof error === "number") {
    const request = new Request("GET", "https://example.test");
    f.getInfo.mockRejectedValue(new HTTPStatusError("private", { request, response: new Response(error, { request }) }));
  } else f.getInfo.mockRejectedValue(error);
  expect(await freezeCreatedMetadataReader(f.provider, f.config, "new-shanghai")()).toEqual({ state: error === 403 ? "unknown" : "absent" });
});
it("does no provider IO when complete configuration cannot be snapshotted", async () => {
  const f = fixture(); f.config.provider_options.uncloneable = () => undefined;
  expect(await freezeCreatedMetadataReader(f.provider, f.config, "new-shanghai")()).toEqual({ state: "unknown" });
  expect(f.buildInfra).not.toHaveBeenCalled();
});
it("binds the actual newly created provider context through MCP without using default metadata lookup", async () => {
  const contexts: LayeredConfig[] = []; const getInfo = vi.fn(async () => info());
  class CreatedProvider extends Provider {
    readonly id = "created-observer-test"; override features = new Set(["sandbox.lifecycle"]);
    override createOptions = new Set(["cpu", "memory"]);
    override inherit = new Set(["sandbox_base_url"]);
    override configFields = [{ key: "region", type: "string" }, { key: "cluster", type: "string" }];
    async buildInfra(config: LayeredConfig): Promise<ProviderInfra> {
      contexts.push(config);
      return { config, auth: null, http_client: null, sandbox_protocol: { create: async () => info(), getInfo, kill: vi.fn() } as unknown as ProviderInfra["sandbox_protocol"],
        process_protocol: null, filesystem_protocol: null, code_interpreter_protocol: null, close: vi.fn() };
    }
  }
  const provider = new CreatedProvider(); const defaultRead = vi.fn().mockRejectedValue(new SandboxNotFoundError("default-region"));
  vi.spyOn(sdk, "loadSandbox").mockResolvedValue({ create: async (options: Record<string, unknown>) => Sandbox.create({ ...options, provider, api_url: "https://created.example.test",
    provider_options: { region: "cn-shanghai", cluster: "created-cluster" } }), getInfoById: defaultRead } as never);
  const manager = new SandboxManager();
  try {
    const result = await dispatchTool("create_sandbox", { cpu: 2, memory: 2048, region: "cn-shanghai" }, manager);
    expect(result).toMatchObject({ sandbox_id: "created-observer-test:new-shanghai" }); expect(result).not.toHaveProperty("error");
    expect(defaultRead).not.toHaveBeenCalled(); expect(getInfo).toHaveBeenCalledExactlyOnceWith("new-shanghai");
    expect(contexts).toHaveLength(2);
    expect(contexts[1].sandbox_base_url).toBe("https://created.example.test");
    expect(contexts[1].provider_options).toEqual({ region: "cn-shanghai", cluster: "created-cluster" });
  } finally { await manager.shutdown(); }
});
