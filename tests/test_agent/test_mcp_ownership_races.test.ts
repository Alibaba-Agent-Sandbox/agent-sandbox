/** Session shutdown wins atomically over a create/connect waiting to register its returned handle. */
import { afterEach, expect, it, vi } from "vitest";
import { SandboxManager, sdk } from "../../src/agent/mcp.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function handle(id: string) {
  return { id, provider: "alicloud-express", url: "https://fixture.invalid", status: "running",
    kill: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
}
afterEach(() => vi.restoreAllMocks());

it.each(["create", "connect"] as const)("does not register late %s behind a queued shutdown", async kind => {
  const returned = handle(kind === "create" ? "new-owned" : "borrowed-external");
  const entered = deferred<void>(); const response = deferred<typeof returned>();
  const request = vi.fn(async () => { entered.resolve(); return response.promise; });
  const statics = { create: request, connect: request, list: vi.fn(), getInfoById: vi.fn(), setTimeoutById: vi.fn(), killById: vi.fn() };
  vi.spyOn(sdk, "loadSandbox").mockResolvedValue(statics);
  const manager = new SandboxManager();
  const pending = kind === "create" ? manager.createSandbox() : manager.getSandbox("alicloud-express:borrowed-external");
  await entered.promise;
  const locked = deferred<void>(); const release = deferred<void>();
  const holder = manager._state_lock.runExclusive(async () => { locked.resolve(); await release.promise; });
  await locked.promise;
  const shutdown = manager.shutdown();
  response.resolve(returned);
  // Let the SDK response reach registration while shutdown is already queued.
  await new Promise<void>(done => setImmediate(done));
  release.resolve();
  const results = await Promise.allSettled([holder, shutdown, pending]);
  expect(results[2]).toMatchObject({ status: "rejected", reason: { name: "CancelledError" } });
  expect(manager._sandboxes.size).toBe(0);
  expect(manager._default_sandbox).toBeNull();
  if (kind === "create") {
    expect(returned.kill).toHaveBeenCalledOnce(); expect(returned.close).not.toHaveBeenCalled();
  } else {
    expect(returned.close).toHaveBeenCalledOnce(); expect(returned.kill).not.toHaveBeenCalled();
  }
  expect(statics.killById).not.toHaveBeenCalled();
});
