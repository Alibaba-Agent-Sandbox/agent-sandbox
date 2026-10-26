import { expect, it, vi } from "vitest";
import { verifyCreatedResources } from "../../src/agent/create_resources.js";
import { SandboxManager, sdk } from "../../src/agent/mcp.js";

const resources = { state: "found", info: { cpu_count: 2, memory_mb: 2048 } };
it("rejects ignored overrides and verifies rollback of only the new resource", async () => {
  const read = vi.fn().mockResolvedValueOnce(resources).mockResolvedValueOnce({ state: "absent" });
  const rollback = vi.fn().mockResolvedValue(undefined);
  expect(await verifyCreatedResources("express:new-owned", { cpu: 1, memory: 1024 }, read, rollback)).toMatchObject({
    category: "resource_configuration", verified: false, cleanup_verified: true,
    requested_resources: { cpu: 1, memory: 1024 }, observed_resources: { cpu: 2, memory: 2048 },
  });
  expect(rollback).toHaveBeenCalledOnce(); expect(read).toHaveBeenCalledTimes(2);
});
it("accepts independently observed resources without deleting the sandbox", async () => {
  const read = vi.fn().mockResolvedValue(resources); const rollback = vi.fn();
  expect(await verifyCreatedResources("express:new-owned", { cpu: 2, memory: 2048 }, read, rollback)).toBeNull();
  expect(rollback).not.toHaveBeenCalled();
});
it("keeps unknown metadata unverified with a qualified recovery handle and no private text", async () => {
  const read = vi.fn().mockRejectedValue(new Error("synthetic-private-token")); const rollback = vi.fn();
  const result = await verifyCreatedResources("express:new-owned", { cpu: 1 }, read, rollback);
  expect(result).toMatchObject({ verified: false, cleanup_verified: false, recovery_sandbox_id: "express:new-owned", observed_resources: { cpu: null } });
  expect(JSON.stringify(result)).not.toContain("synthetic-private-token"); expect(rollback).toHaveBeenCalledOnce();
});
it("does not request metadata or mutate resources without explicit requirements", async () => {
  const read = vi.fn(); const rollback = vi.fn();
  expect(await verifyCreatedResources("express:new-owned", {}, read, rollback)).toBeNull();
  expect(read).not.toHaveBeenCalled(); expect(rollback).not.toHaveBeenCalled();
});
it("reads back committed deletion even when the kill response fails", async () => {
  const read = vi.fn().mockResolvedValueOnce(resources).mockResolvedValueOnce({ state: "absent" });
  expect(await verifyCreatedResources("express:new-owned", { cpu: 1 }, read, vi.fn().mockRejectedValue(new Error("private"))))
    .toMatchObject({ cleanup_verified: true });
});
it("fails closed without a complete created-instance observation binding", async () => {
  const rollback = vi.fn();
  expect(await verifyCreatedResources("express:new-owned", { cpu: 1 }, undefined, rollback))
    .toMatchObject({ cleanup_verified: false, recovery_sandbox_id: "express:new-owned" });
  expect(rollback).toHaveBeenCalledOnce();
});
it.each(["removed", "replaced"])("only rolls back the captured handle when its cache entry is %s during metadata IO", async replacement => {
  const staticKill = vi.fn(); const originalLoader = sdk.loadSandbox;
  sdk.loadSandbox = vi.fn().mockResolvedValue({ killById: staticKill });
  try {
    const manager = new SandboxManager(); const kill = vi.fn().mockResolvedValue(undefined);
    const created = { id: "new-shanghai", provider: "express", kill }; const other = { ...created, kill: vi.fn() };
    manager._sandboxes.set("express:new-shanghai", created); manager._default_sandbox = created;
    const read = vi.fn().mockImplementationOnce(async () => {
      if (replacement === "replaced") { manager._sandboxes.set("express:new-shanghai", other); manager._default_sandbox = other; }
      else { manager._sandboxes.clear(); manager._default_sandbox = null; }
      return resources;
    }).mockResolvedValueOnce({ state: "absent" });
    const result = await verifyCreatedResources("express:new-shanghai", { cpu: 1 }, read, () => manager.rollbackCreatedSandbox(created));
    expect(result).toMatchObject({ cleanup_verified: true });
    expect(kill).toHaveBeenCalledOnce(); expect(other.kill).not.toHaveBeenCalled(); expect(staticKill).not.toHaveBeenCalled();
    expect(manager._sandboxes.get("express:new-shanghai")).toBe(replacement === "replaced" ? other : undefined);
    expect(manager._default_sandbox).toBe(replacement === "replaced" ? other : null);
  } finally { sdk.loadSandbox = originalLoader; }
});
