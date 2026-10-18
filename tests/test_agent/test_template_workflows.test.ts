import { afterEach, describe, expect, it, vi } from "vitest";
import * as adapter from "../../src/providers/alicloud_express/fc_template.js";
import * as config from "../../src/transport/config.js";
import { SandboxManager } from "../../src/agent/mcp.js";
import { handleTemplateOperation } from "../../src/agent/template_operations.js";
import { useIso } from "../_support/iso.js";

useIso();
afterEach(() => vi.restoreAllMocks());
function credentials(): void {
  vi.spyOn(config, "loadConfig").mockReturnValue(new config.TransportConfig({ access_key_id: "mock-ak", access_key_secret: "mock-sk" }));
}
describe("template workflow contracts", () => {
  it("sends generation 2 for image startup/readiness commands", async () => {
    credentials(); vi.spyOn(adapter, "listOfficialTemplates").mockResolvedValue([]);
    const create = vi.spyOn(adapter, "createOfficialTemplate").mockResolvedValue({ templateID: "test-template", requestId: "test-request" });
    const result = await handleTemplateOperation("submit_template_build", { team_id: "test-team", name: "test-new-version", image: "example/image:1", start_command: "/start.sh", ready_command: "test -f /ready" }, new SandboxManager());
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ generation: 2, start_command: "/start.sh", ready_command: "test -f /ready" }));
    expect(result).toMatchObject({ state: "submitted", runtime_verified: false });
  });
  it("refuses generation 1 startup parameters before contacting the create API", async () => {
    credentials(); const create = vi.spyOn(adapter, "createOfficialTemplate");
    await expect(handleTemplateOperation("submit_template_build", { team_id: "test-team", name: "test-new-version", image: "example/image:1", generation: 1, start_command: "/start.sh" }, new SandboxManager())).rejects.toThrow("require generation 2");
    expect(create).not.toHaveBeenCalled();
  });
  it("does not update an existing template under a name collision", async () => {
    credentials(); vi.spyOn(adapter, "listOfficialTemplates").mockResolvedValue([{ name: "test-existing" }]);
    const create = vi.spyOn(adapter, "createOfficialTemplate");
    await expect(handleTemplateOperation("submit_template_build", { team_id: "test-team", name: "test-existing", image: "example/image:1" }, new SandboxManager())).rejects.toThrow("already exists");
    expect(create).not.toHaveBeenCalled();
  });
  it("keeps runtime verification and cleanup failure separate while restoring the previous default", async () => {
    const manager = new SandboxManager(), previous = { id: "user-default" };
    manager._default_sandbox = previous;
    manager.createSandbox = vi.fn().mockImplementation(async () => {
      const sandbox = { id: "test-validation" }; manager._default_sandbox = sandbox; return sandbox;
    });
    manager.getSandbox = vi.fn().mockResolvedValue({ commands: { run: async () => { throw new Error("probe failed"); } }, files: { remove: vi.fn() } });
    manager.killSandbox = vi.fn().mockRejectedValue(new Error("cleanup unavailable"));
    manager.observeSandbox = vi.fn().mockResolvedValue({ sandbox_id: "test-validation" });
    const result = await handleTemplateOperation("validate_template", { template_id: "test-template" }, manager);
    expect(result).toMatchObject({ verified: false, error: "probe failed", cleanup_verified: false, cleanup_error: "cleanup unavailable" });
    expect(manager._default_sandbox).toBe(previous);
  });
});
