import { afterEach, describe, expect, it, vi } from "vitest";
import { runProviderCommand } from "../../src/providers/commands.js";
import { HttpClient, Response } from "../../src/transport/http.js";
import * as managedKeys from "../../src/providers/alicloud_express/managed_api_key.js";
import { useIso } from "../_support/iso.js";

useIso();
afterEach(() => vi.restoreAllMocks());

const invoke = (input: Record<string, unknown>) => runProviderCommand("alicloud-express", "sandbox.mounts.append", {
  sandbox_id: "source", ...input,
}, { sandbox_api_key: "placeholder-runtime-key", sandbox_base_url: "https://api.example.test" });

describe("Express append mount path validation", () => {
  it.each([
    ["/mnt/data", "/mnt/data-temp", "/mnt/data/log"],
    ["/mnt/data/log", "/mnt/data-temp", "/mnt/data"],
  ])("rejects nested mounts separated by a similar directory name before credential resolution: %j", async (...paths) => {
    const resolve = vi.spyOn(managedKeys, "resolveSandboxApiKey");
    const request = vi.spyOn(HttpClient.prototype, "platformRequest").mockResolvedValue(new Response(204));
    await expect(invoke({ named_volume_mounts: paths.map((path, index) => ({ name: `workspace-${index}`, path })) }))
      .rejects.toMatchObject({ code: "E8002" });
    expect(resolve).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("checks nested paths across named and inline mount groups before I/O", async () => {
    const resolve = vi.spyOn(managedKeys, "resolveSandboxApiKey");
    const request = vi.spyOn(HttpClient.prototype, "platformRequest").mockResolvedValue(new Response(204));
    await expect(invoke({
      named_volume_mounts: [{ name: "workspace", path: "/mnt/data" }, { name: "scratch", path: "/mnt/data-temp" }],
      inline_volume_mounts: { oss: { mount_points: [{ bucket_name: "workspace-bucket", endpoint: "example.test", mount_dir: "/mnt/data/log" }] } },
    })).rejects.toMatchObject({ code: "E8002" });
    expect(resolve).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps similarly named independent mount directories valid", async () => {
    const request = vi.spyOn(HttpClient.prototype, "platformRequest").mockResolvedValue(new Response(204));
    await expect(invoke({ named_volume_mounts: [
      { name: "workspace", path: "/mnt/data" }, { name: "scratch", path: "/mnt/data-temp" },
      { name: "logs", path: "/mnt/database/log" },
    ] })).resolves.toEqual({ sandbox_id: "source", appended: true });
    expect(request).toHaveBeenCalledOnce();
  });
});
