import "../_support/isolatedHome.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cli } from "../../src/cli/main.js";
import { HttpClient, Response } from "../../src/transport/http.js";
import { managedKeySeams } from "../../src/providers/alicloud_express/managed_api_key.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { useIso } from "../_support/iso.js";

const iso = useIso();
afterEach(() => vi.restoreAllMocks());
const run = (id: string, input: Record<string, unknown>) => new CliRunner().invoke(cli, [
  "--json", "provider", "command", "run", "alicloud-express", id, "--input", JSON.stringify(input), "--yes",
]);

describe("Express runtime CLI authentication", () => {
  it.each([
    ["sandbox.mounts.append", { sandbox_id: "source", named_volume_mounts: [{ name: "workspace", path: "/mnt/data" }] }],
    ["sandbox.network.update", { sandbox_id: "source", network: {} }],
    ["sandbox.timeout", { sandbox_id: "source", timeout: 600 }],
  ])("runs %s with only the selected Sandbox API key", async (id, input) => {
    iso.setenv("ABX_SANDBOX_API_KEY", "placeholder-runtime-key");
    const request = vi.spyOn(HttpClient.prototype, "platformRequest").mockResolvedValue(new Response(204));
    const loadSdk = vi.spyOn(managedKeySeams, "loadSdk");
    const result = await run(id, input);
    expect(result.exit_code, result.output).toBe(0);
    expect(request).toHaveBeenCalledOnce();
    expect(loadSdk).not.toHaveBeenCalled();
    expect(result.output).not.toContain("placeholder-runtime-key");
  });

  it("retains Alibaba Cloud credential requirements for native metadata management", async () => {
    iso.setenv("ABX_SANDBOX_API_KEY", "placeholder-runtime-key");
    const request = vi.spyOn(HttpClient.prototype, "platformRequest");
    const loadSdk = vi.spyOn(managedKeySeams, "loadSdk");
    const result = await run("volume.list", {});
    expect(result.exit_code).not.toBe(0);
    expect(result.output).toContain("access_key_id");
    expect(result.output).toContain("access_key_secret");
    expect(request).not.toHaveBeenCalled();
    expect(loadSdk).not.toHaveBeenCalled();
  });

  it("reports the runtime authentication choices without submitting a request when none is configured", async () => {
    const request = vi.spyOn(HttpClient.prototype, "platformRequest");
    const loadSdk = vi.spyOn(managedKeySeams, "loadSdk");
    const result = await run("sandbox.timeout", { sandbox_id: "source", timeout: 600 });
    expect(result.exit_code).not.toBe(0);
    expect(result.output).toContain("Configure one authentication method");
    expect(result.output).toContain("sandbox_api_key");
    expect(request).not.toHaveBeenCalled();
    expect(loadSdk).not.toHaveBeenCalled();
  });

  it("keeps managed-key creation subject to its separate confirmation", async () => {
    iso.setenv("ALICLOUD_ACCESS_KEY_ID", "placeholder-ak");
    iso.setenv("ALICLOUD_ACCESS_KEY_SECRET", "placeholder-sk");
    const request = vi.spyOn(HttpClient.prototype, "platformRequest");
    const loadSdk = vi.spyOn(managedKeySeams, "loadSdk");
    const result = await run("sandbox.timeout", { sandbox_id: "source", timeout: 600 });
    expect(result.exit_code).not.toBe(0);
    expect(result.output).toContain("E8012");
    expect(request).not.toHaveBeenCalled();
    expect(loadSdk).not.toHaveBeenCalled();
  });
});
