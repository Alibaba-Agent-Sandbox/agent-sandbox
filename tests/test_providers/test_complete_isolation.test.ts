import "../_support/isolatedHome.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sandbox } from "../../src/api/sandbox.js";
import { SandboxInfo } from "../../src/models/sandbox.js";
import { Provider, type ProviderInfra } from "../../src/providers/base.js";
import { getProvider, registerProvider, unregisterProvider } from "../../src/providers/registry.js";
import { loadLayeredConfig, type LayeredConfig } from "../../src/transport/config_layers.js";
import { setCliProvider, resetCliSelection } from "../../src/providers/selection.js";
import { TOOL_SCHEMAS, TOOL_HANDLERS, dispatchTool } from "../../src/agent/tools.js";
import { SandboxManager } from "../../src/agent/mcp.js";
import { deploy_shortcut } from "../../src/cli/commands/deploy.js";
import { main } from "../../src/cli/main.js";
import { build, providerTemplateCommand } from "../../src/cli/commands/template.js";
import { coreTarget } from "../../src/cli/commands/_config_providers.js";
import { SandboxProtocol as E2BProtocol } from "../../src/providers/shared/e2b/sandbox.js";
import { TransportConfig } from "../../src/transport/config.js";
import type { HttpClient } from "../../src/transport/http.js";
import { NodeProvider } from "../../src/providers/node_provider.js";
import { loadManifest } from "../../src/providers/manifest.js";
import { useIso } from "../_support/iso.js";

useIso();
afterEach(() => { vi.restoreAllMocks(); resetCliSelection(); unregisterProvider("isolation-test"); unregisterProvider("template-factory"); });
class IsolatedProvider extends Provider {
  readonly id = "isolation-test";
  override features = new Set(["sandbox.lifecycle"]);
  killed = vi.fn(async () => undefined);
  closed = vi.fn(async () => undefined);
  bound = vi.fn(() => { throw new Error("binding failed"); });
  async buildInfra(config: LayeredConfig): Promise<ProviderInfra> {
    const info = new SandboxInfo({ sandbox_id: "owned", template: "base", envd_url: "custom://session" });
    return { config, auth: null, http_client: null, sandbox_protocol: {
      create: async () => info, connect: async () => info, kill: this.killed,
    } as unknown as ProviderInfra["sandbox_protocol"], process_protocol: null,
    filesystem_protocol: null, code_interpreter_protocol: null, close: this.closed };
  }
  override createSessionAuth() { return this.bound(); }
}

describe("complete backend isolation", () => {
  it("cleans up an owned create when provider session binding fails", async () => {
    const provider = new IsolatedProvider(); registerProvider(provider);
    await expect(Sandbox.create({ provider: provider.id })).rejects.toThrow("binding failed");
    expect(provider.killed).toHaveBeenCalledExactlyOnceWith("owned");
    expect(provider.closed).toHaveBeenCalledTimes(1);
  });
  it("never deletes a borrowed resource when connect binding fails", async () => {
    const provider = new IsolatedProvider(); registerProvider(provider);
    await expect(Sandbox.connect("owned", { provider: provider.id })).rejects.toThrow("binding failed");
    expect(provider.killed).not.toHaveBeenCalled();
    expect(provider.closed).toHaveBeenCalledTimes(1);
  });
  it("has neither native endpoints nor undeclared native configuration targets", () => {
    const provider = new IsolatedProvider(); registerProvider(provider); setCliProvider(provider.id);
    const config = loadLayeredConfig({ provider: provider.id });
    expect([config.sandbox_base_url, config.sandbox_domain, config.region]).toEqual(["", "", ""]);
    expect(coreTarget("access_key_id", "access_key_id")).toBeNull();
    expect(coreTarget("region", "region")).toBeNull();
    expect(coreTarget("api_url", "api_url")).toBeNull();
  });
  it("recomputes CLI options and AI tools after selecting another backend in the same process", async () => {
    const provider = new IsolatedProvider(); registerProvider(provider);
    setCliProvider("alicloud-express");
    expect(deploy_shortcut.help).toContain("Runs one publish path");
    expect(TOOL_SCHEMAS.some(s => s.name === "submit_template_build")).toBe(true);
    expect(Object.hasOwn(TOOL_HANDLERS, "submit_template_build")).toBe(true);
    expect(build.params.some(p => p.name === "acr_namespace")).toBe(true);
    setCliProvider(provider.id);
    expect(deploy_shortcut.help).not.toContain("ACR");
    expect(TOOL_SCHEMAS.some(s => s.name === "submit_template_build")).toBe(false);
    expect(Object.hasOwn(TOOL_HANDLERS, "submit_template_build")).toBe(false);
    expect(Object.hasOwn(TOOL_HANDLERS, "validate_template")).toBe(true);
    expect(TOOL_SCHEMAS.some(s => s.name === "validate_template")).toBe(true);
    expect(build.params.some(p => p.name === "acr_namespace")).toBe(false);
    await expect(dispatchTool("submit_template_build", {}, new SandboxManager())).rejects.toThrow("Unknown tool");
    setCliProvider("alicloud-express");
    expect(TOOL_SCHEMAS.some(s => s.name === "submit_template_build")).toBe(true);
  });
  it("lets an installed Node plugin own template resources without building lifecycle infrastructure", async () => {
    const root = fs.mkdtempSync(path.join(process.cwd(), "template-plugin-"));
    try {
      fs.writeFileSync(path.join(root, "abx-provider.toml"), `manifest_version = 1
[provider]
id = "template-factory"
name = "Template factory"
version = "1.0.0"
[compat]
requires = { cli = ">=0.3" }
[runtime]
kind = "node"
protocol = "node/1"
entry = "provider.mjs"
[features]
supported = ["templates.read"]
`);
      fs.writeFileSync(path.join(root, "provider.mjs"), `export default () => ({
        buildInfra() { throw new Error("Unexpected lifecycle factory"); },
        async buildTemplateManager(ctx) {
          return new class {
            async list() { return [ctx.id]; }
            async close() {}
          };
        }
      });`);
      const provider = new NodeProvider(loadManifest(root), root);
      registerProvider(provider);
      const manager = await provider.buildTemplateManager(loadLayeredConfig({ provider: provider.id }), "templates.read");
      try { expect(await manager.list!()).toEqual([provider.id]); }
      finally { await manager.close!(); }
      await expect(provider.buildTemplateManager(loadLayeredConfig({ provider: provider.id }), "templates.build")).rejects.toMatchObject({ code: "E8004" });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it("routes a different provider after lazily loading the native command module", async () => {
    setCliProvider("alicloud-express");
    expect(await providerTemplateCommand("list")).not.toBeNull();
    const provider = new IsolatedProvider();
    provider.features = new Set(["templates.read"]);
    const closed = vi.fn(async () => undefined);
    const factory = vi.spyOn(provider, "buildTemplateManager").mockResolvedValue({
      list: async () => [], close: closed,
    });
    registerProvider(provider);
    expect(await main({ args: ["--json", "--provider", provider.id, "template", "list"] })).toBe(0);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledTimes(1);
  });
  it("derives a missing URL only through an explicitly selected protocol adapter", () => {
    const provider = new IsolatedProvider();
    const info = new SandboxInfo({ sandbox_id: "s", envd_url: null });
    const config = new TransportConfig({ domain: "protocol.test" });
    vi.spyOn(config, "buildEnvdUrl").mockImplementation(() => { throw new Error("legacy config URL helper used"); });
    expect(provider.resolveSessionUrl(info, config)).toBe("");
    expect(provider.resolveSessionUrl(info, config, new E2BProtocol({} as HttpClient)))
      .toBe("https://49983-s.protocol.test");
  });
  it("selects a real provider for the distribution default", () => {
    expect(getProvider("alicloud-express")).toBeInstanceOf(Provider);
  });
  it("never invents a native port address or token header for an async provider", async () => {
    const provider = new IsolatedProvider();
    provider.features.add("ports.url");
    Object.assign(provider, { createSessionAuth: () => ({ token: "opaque-token", sandbox_id: "owned",
      getHeaders: () => ({}), setToken: () => undefined, clear: () => undefined }) });
    const build = provider.buildInfra.bind(provider);
    vi.spyOn(provider, "buildInfra").mockImplementation(async (config) => {
      const infra = await build(config);
      Object.assign(infra.sandbox_protocol, { hasPortUrl: true, portUrl: async () =>
        ["https://gateway.example/owned/service", { "Provider-Gateway": "placeholder" }] });
      return infra;
    });
    registerProvider(provider);
    const sandbox = await Sandbox.create({ provider: provider.id });
    try {
      expect(() => sandbox.network.getUrl(8080)).toThrow(/does not support/);
      expect(() => sandbox.network.getAccessHeaders()).toThrow(/does not support/);
      expect(await sandbox.network.resolve(8080)).toEqual(
        ["https://gateway.example/owned/service", { "Provider-Gateway": "placeholder" }]);
    } finally { await sandbox.kill(); }
  });
  it("keeps concrete backend imports out of core implementation modules", () => {
    const composition = new Set(["cli/provider_extensions.ts", "agent/provider_template_extensions.ts",
      "utils/cli_config_keys.ts"]);
    const violations: string[] = [];
    const root = fileURLToPath(new URL("../../src/", import.meta.url));
    for (const file of fs.readdirSync(root, { recursive: true }).filter((p): p is string => typeof p === "string" && p.endsWith(".ts"))) {
      const relative = file.split(path.sep).join("/");
      // Concrete application deployment adapters are peers of sandbox provider adapters.
      if (relative.startsWith("providers/") || relative.startsWith("application/adapters/") || composition.has(relative)) continue;
      const source = ts.createSourceFile(relative, fs.readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true);
      // Public compatibility modules contain exports only; their implementations live in providers.
      if (source.statements.every(s => ts.isExportDeclaration(s) || (ts.isVariableStatement(s) && s.declarationList.declarations.every(d => ts.isIdentifier(d.name) && d.name.text === "__all__")))) continue;
      function visit(node: ts.Node) {
        if (ts.isStringLiteral(node) && /(?:^@alicloud\/|providers\/(?:alicloud_express|shared\/e2b)|(?:^|\/)protocol\/(?:sandbox|filesystem|process|terminal|code_interpreter)|(?:^|\/)transport\/auth\.js)/.test(node.text)) {
          violations.push(`${relative}: ${node.text}`);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect(violations).toEqual([]);
  });
});


it("compatibility URL views consume provider metadata without selecting a wire adapter", async () => {
  const { CONFIG_METADATA } = await import("../../src/providers/alicloud_express/metadata.js");
  const old = CONFIG_METADATA.legacyDataPlaneUrlTemplate;
  try {
    CONFIG_METADATA.legacyDataPlaneUrlTemplate = "https://{domain}/owned/{sandbox_id}";
    expect(new TransportConfig({ domain: "owned.example" }).buildEnvdUrl("$&")).toBe("https://owned.example/owned/$&");
    expect(loadLayeredConfig({ provider: "alicloud-express" }).buildEnvdUrl("owned")).toContain("/owned/owned");
  } finally {
    CONFIG_METADATA.legacyDataPlaneUrlTemplate = old;
  }
});
