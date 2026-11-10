/** A real local HTTP request verifies lifecycle intent reaches the existing Express create wire. */
import "../_support/isolatedHome.js";
import { expect, it } from "vitest";
import { Sandbox } from "../../src/api/sandbox.js";
import { Provider } from "../../src/providers/base.js";
import { registerProvider } from "../../src/providers/registry.js";
import { startE2BMock } from "../_support/e2b_mock.js";
import { useIso } from "../_support/iso.js";
import type { SandboxLifecycle } from "../../src/models/sandbox.js";
useIso();
it.each([
  [{ onTimeout: "pause", autoResume: true }, true, { enabled: true }],
  [{ onTimeout: "pause", autoResume: false }, true, { enabled: false }],
  [{ onTimeout: "kill" }, false, undefined],
] as const)("sends %j with existing named Volume mounts", async (lifecycle, autoPause, autoResume) => {
  const backend = await startE2BMock();
  try {
    const sandbox = await Sandbox.create({ provider: "alicloud-express", template: "base", timeout: 60, api_key: "fixture-key", api_url: backend.origin, lifecycle, volume_mounts: { "/mnt/work": "shared-data" } });
    try {
      const request = backend.seen.find(item => item.method === "POST" && item.url === "/sandboxes");
      expect(request).toBeDefined(); const body = JSON.parse(request!.body.toString());
      expect(body).toMatchObject({ templateID: "base", timeout: 60, autoPause, volumeMounts: [{ name: "shared-data", path: "/mnt/work" }] });
      expect(body.autoResume).toEqual(autoResume); expect(body.lifecycle).toBeUndefined();
    } finally { await sandbox.kill(); await sandbox.close(); }
  } finally { await backend.close(); }
});
it("rejects unsupported providers and invalid lifecycle before opening a transport", async () => {
  class NoLifecycle extends Provider { override id = "without-lifecycle"; override buildInfra(): never { throw new Error("transport must not open"); } }
  registerProvider(new NoLifecycle(), { replace: true });
  await expect(Sandbox.create({ provider: "without-lifecycle", lifecycle: { onTimeout: "pause" } })).rejects.toMatchObject({ code: "E8004" });
  for (const lifecycle of [{ onTimeout: "kill", autoResume: true }, { onTimeout: "other" }, { onTimeout: "pause", ignored: true }]) {
    await expect(Sandbox.create({ provider: "alicloud-express", lifecycle: lifecycle as SandboxLifecycle })).rejects.toMatchObject({ code: "E8002" });
  }
});
