/** Backend selection and cloud administration must not cross provider ownership. */
import "../_support/isolatedHome.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requireTemplateFeature } from "../../src/cli/template_provider.js";
import { _generateAndDeployTemplate } from "../../src/cli/commands/sandbox.js";
import { _doDeploy, templateSeams } from "../../src/cli/commands/template.js";
import type { Context } from "../../src/cli/kit.js";
import { Provider, type ProviderInfra } from "../../src/providers/base.js";
import { ProviderFeatureNotSupportedError } from "../../src/providers/errors.js";
import { registerProvider, unregisterProvider } from "../../src/providers/registry.js";
import { resetCliSelection, setCliProvider } from "../../src/providers/selection.js";

class ForeignTemplateProvider extends Provider {
  readonly id = "foreign-template-test";
  override features = new Set(["templates.read", "templates.build"]);
  async buildInfra(): Promise<ProviderInfra> { throw new Error("must not prepare unrelated infrastructure"); }
}

afterEach(() => { resetCliSelection(); unregisterProvider("foreign-template-test"); vi.restoreAllMocks(); });

function selectForeign(): void {
  registerProvider(new ForeignTemplateProvider());
  setCliProvider("foreign-template-test");
}

describe("provider template boundary", () => {
  it("does not treat a declared template feature as an FC adapter", () => {
    selectForeign();
    for (const feature of ["templates.read", "templates.build"] as const) {
      expect(() => requireTemplateFeature(feature)).toThrow(ProviderFeatureNotSupportedError);
      expect(() => requireTemplateFeature(feature)).toThrow("refusing the Alibaba Express pipeline");
    }
  });

  it("blocks internal deployment before loading Express credentials or reading a project", async () => {
    selectForeign();
    const config = vi.spyOn(templateSeams, "loadConfig");
    await expect(_doDeploy("nonexistent-project", { acr_namespace: "placeholder" })).rejects.toBeInstanceOf(ProviderFeatureNotSupportedError);
    expect(config).not.toHaveBeenCalled();
  });

  it("checks the selected backend before invoking natural-language generation for cloud deploy", async () => {
    selectForeign();
    await expect(_generateAndDeployTemplate({} as Context, "test environment", {
      yes: true, acr_namespace: null, verbose: false,
    })).rejects.toBeInstanceOf(ProviderFeatureNotSupportedError);
  });

  it("retains the built-in Express template adapter", () => {
    setCliProvider("alicloud-express");
    expect(() => requireTemplateFeature("templates.read")).not.toThrow();
    expect(() => requireTemplateFeature("templates.build")).not.toThrow();
  });
});
