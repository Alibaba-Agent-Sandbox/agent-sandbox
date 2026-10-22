import "../_support/isolatedHome.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli/main.js";

import { Provider, type ProviderInfra } from "../../src/providers/base.js";
import { ProviderInstallError } from "../../src/models/provider_errors.js";
import * as installer from "../../src/providers/installer.js";
import { registerProvider, unregisterProvider } from "../../src/providers/registry.js";
import { resetCliSelection, setCliProvider } from "../../src/providers/selection.js";
import * as store from "../../src/providers/store.js";
import { useIso } from "../_support/iso.js";
import { useCapsys } from "./conftest.js";

useIso();
const cap = useCapsys();
afterEach(() => { vi.restoreAllMocks(); resetCliSelection(); unregisterProvider("template-only"); });

class TemplateOnlyProvider extends Provider {
  readonly id = "template-only";
  override features = new Set(["templates.read", "templates.build"]);
  async buildInfra(): Promise<ProviderInfra> { throw new Error("No cloud infrastructure may be built by this check"); }
}

describe("provider ownership and updates", () => {
  it.each([["list", []], ["build", [".", "--yes"]]] as const)("does not route a plugin's template %s into FC", async (operation, options) => {
    registerProvider(new TemplateOnlyProvider());
    setCliProvider("template-only");
    const code = await main({ args: ["--json", "--provider", "template-only", "template", operation, ...options] });
    expect(code).not.toBe(0);
    const { out, err } = cap.readouterr();
    expect(out + err).toContain("E8004");
    expect(out + err).toContain("template-only");
  });

  it("reports the bundled update lifecycle without reading a plugin receipt or checking the network", async () => {
    const receipt = vi.spyOn(store, "readReceipt").mockImplementation(() => { throw new Error("Unexpected receipt read"); });
    const result = await installer.update("alicloud-express", { check: true });
    expect(result).toMatchObject({ id: "alicloud-express", status: "bundled", available: null, changes: [] });
    expect(result.message).toContain("Upgrade abx");
    expect(receipt).not.toHaveBeenCalled();
  });

  it("rejects a plugin ref for the bundled provider", async () => {
    await expect(installer.update("alicloud-express", { ref: "main" })).rejects.toThrow(ProviderInstallError);
  });

  it("makes the bundled update guidance available as CLI JSON", async () => {
    const code = await main({ args: ["--json", "provider", "update", "alicloud-express", "--check"] });
    const { out } = cap.readouterr();
    expect(code).toBe(0);
    expect(JSON.parse(out)[0]).toMatchObject({ status: "bundled", available: null, message: expect.stringContaining("Upgrade abx") });
  });

  it("reports manual sources during update-all instead of claiming they are current", async () => {
    vi.spyOn(store, "listInstalledIds").mockReturnValue(["local-demo"]);
    vi.spyOn(store, "readReceipt").mockReturnValue({ id: "local-demo", version: "1.0.0", source: { type: "local" } });
    const update = vi.spyOn(installer, "update");
    const code = await main({ args: ["--json", "provider", "update", "--all", "--check"] });
    const { out } = cap.readouterr();
    expect(code).toBe(0);
    expect(JSON.parse(out)[0]).toMatchObject({ id: "local-demo", status: "manual", available: null });
    expect(update).not.toHaveBeenCalled();
  });

  it("does not hide a Git download or verification failure in update-all", async () => {
    vi.spyOn(store, "listInstalledIds").mockReturnValue(["broken-demo"]);
    vi.spyOn(store, "readReceipt").mockReturnValue({ source: { type: "git" } });
    vi.spyOn(installer, "update").mockRejectedValue(new ProviderInstallError("placeholder download failed"));
    const code = await main({ args: ["--json", "provider", "update", "--all", "--check"] });
    const { out, err } = cap.readouterr();
    expect(code).not.toBe(0);
    expect(out + err).toContain("E8010");
    expect(out + err).not.toContain("up to date");
  });
});
