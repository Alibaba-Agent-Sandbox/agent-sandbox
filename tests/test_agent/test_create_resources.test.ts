import { expect, it, vi } from "vitest";
import { verifyCreatedResources } from "../../src/agent/create_resources.js";
import { SandboxNotFoundError } from "../../src/models/errors.js";
import type { SandboxManager } from "../../src/agent/mcp.js";

function manager() {
  return { observeSandbox: vi.fn(), killSandbox: vi.fn().mockResolvedValue("new-owned") };
}
it("rejects ignored resource overrides and verifies rollback of only the new resource", async () => {
  const m = manager(); m.observeSandbox.mockResolvedValueOnce({ cpu_count: 2, memory_mb: 2048 })
    .mockRejectedValueOnce(new SandboxNotFoundError("new-owned"));
  expect(await verifyCreatedResources(m as unknown as SandboxManager, "new-owned", { cpu: 1, memory: 1024 })).toMatchObject({
    error: expect.any(String), category: "resource_configuration", verified: false, cleanup_verified: true,
    requested_resources: { cpu: 1, memory: 1024 }, observed_resources: { cpu: 2, memory: 2048 },
  });
  expect(m.killSandbox).toHaveBeenCalledExactlyOnceWith("new-owned");
});
it("accepts independently observed requested resources without deleting the sandbox", async () => {
  const m = manager(); m.observeSandbox.mockResolvedValue({ cpu_count: 1, memory_mb: 1024 });
  expect(await verifyCreatedResources(m as unknown as SandboxManager, "new-owned", { cpu: 1, memory: 1024 })).toBeNull();
  expect(m.killSandbox).not.toHaveBeenCalled();
});
it("keeps unknown metadata unverified and exposes cleanup uncertainty without provider secrets", async () => {
  const m = manager(); m.observeSandbox.mockRejectedValue(new Error("synthetic-private-token"));
  const result = await verifyCreatedResources(m as unknown as SandboxManager, "new-owned", { cpu: 1 });
  expect(result).toMatchObject({ verified: false, cleanup_verified: false, sandbox_id: "new-owned", observed_resources: { cpu: null } });
  expect(JSON.stringify(result)).not.toContain("synthetic-private-token");
  expect(m.killSandbox).toHaveBeenCalledExactlyOnceWith("new-owned");
});
it("does not request metadata or mutate resources when no explicit requirement was supplied", async () => {
  const m = manager(); expect(await verifyCreatedResources(m as unknown as SandboxManager, "new-owned", {})).toBeNull();
  expect(m.observeSandbox).not.toHaveBeenCalled(); expect(m.killSandbox).not.toHaveBeenCalled();
});
