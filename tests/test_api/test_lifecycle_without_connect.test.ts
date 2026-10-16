/** Real core dispatch proves metadata/TTL never reaches side-effecting provider connect. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sandbox } from "../../src/api/sandbox.js";
import { SandboxManager } from "../../src/agent/mcp.js";
import { SandboxProtocol } from "../../src/protocol/sandbox.js";
import { HttpClient } from "../../src/transport/http.js";
import { SandboxInfo } from "../../src/models/sandbox.js";
import { Provider, type ProviderInfra } from "../../src/providers/base.js";
import { useIso } from "../_support/iso.js";

useIso();
afterEach(() => vi.restoreAllMocks());

class PausedProvider extends Provider {
  id = "paused-fixture";
  readonly close = vi.fn(async (): Promise<void> => undefined);
  readonly connect = vi.fn(async (): Promise<never> => { throw new Error("must never resume"); });
  readonly create = vi.fn();
  readonly kill = vi.fn();
  readonly getInfo = vi.fn(async () => new SandboxInfo({ sandbox_id: "paused", template: "base", status: "paused" }));
  readonly setTimeout = vi.fn(async (_id: string, _seconds: number): Promise<void> => undefined);
  async buildInfra(): Promise<ProviderInfra> {
    return { sandbox_protocol: { getInfo: this.getInfo, setTimeout: this.setTimeout,
      connect: this.connect, create: this.create, kill: this.kill }, close: this.close,
      http_client: null, auth: null, config: {} } as unknown as ProviderInfra;
  }
}

describe("direct lifecycle control plane", () => {
  it.each(["inspect", "timeout"])("built-in %s closes HTTP without connect", async (operation) => {
    const close = vi.spyOn(HttpClient.prototype, "close").mockResolvedValue();
    const connect = vi.spyOn(SandboxProtocol.prototype, "connect");
    const get = vi.spyOn(SandboxProtocol.prototype, "getInfo").mockResolvedValue(new SandboxInfo({ sandbox_id: "paused", status: "paused" }));
    const ttl = vi.spyOn(SandboxProtocol.prototype, "setTimeout").mockResolvedValue();
    const options = { api_key: "placeholder-key", api_url: "https://api.example.invalid" };
    if (operation === "inspect") {
      await Sandbox.getInfoById("paused", options);
      expect(get).toHaveBeenCalledWith("paused"); expect(ttl).not.toHaveBeenCalled();
    } else {
      await Sandbox.setTimeoutById("paused", 600, options);
      expect(ttl).toHaveBeenCalledWith("paused", 600); expect(get).not.toHaveBeenCalled();
    }
    expect(close).toHaveBeenCalledOnce(); expect(connect).not.toHaveBeenCalled();
  });
  it.each(["inspect", "timeout"])("%s preserves paused state and never connects/resumes", async (operation) => {
    const provider = new PausedProvider();
    // Register through the public provider selection path, including qualified ID parsing.
    await Sandbox.getInfoById("paused", { provider });
    provider.getInfo.mockClear(); provider.close.mockClear();
    const manager = new SandboxManager();
    if (operation === "inspect") {
      const info = await manager.inspectSandbox("paused-fixture:paused");
      expect(info.status).toBe("paused"); expect(provider.getInfo).toHaveBeenCalledWith("paused");
      expect(provider.setTimeout).not.toHaveBeenCalled();
    } else {
      await manager.setSandboxTimeout(700, "paused-fixture:paused");
      expect(provider.setTimeout).toHaveBeenCalledWith("paused", 700);
      expect(provider.getInfo).not.toHaveBeenCalled();
    }
    expect(provider.close).toHaveBeenCalledOnce();
    expect(provider.connect).not.toHaveBeenCalled(); expect(provider.create).not.toHaveBeenCalled();
    await manager.shutdown(); expect(provider.kill).not.toHaveBeenCalled();
  });
  it.each(["inspect", "timeout"])("%s failure still closes infra without connecting", async (operation) => {
    const provider = new PausedProvider();
    if (operation === "inspect") {
      provider.getInfo.mockRejectedValue(new Error("operation failed"));
      await expect(Sandbox.getInfoById("paused", { provider })).rejects.toThrow("operation failed");
    } else {
      provider.setTimeout.mockRejectedValue(new Error("operation failed"));
      await expect(Sandbox.setTimeoutById("paused", 600, { provider })).rejects.toThrow("operation failed");
    }
    expect(provider.close).toHaveBeenCalledOnce(); expect(provider.connect).not.toHaveBeenCalled();
  });
});
