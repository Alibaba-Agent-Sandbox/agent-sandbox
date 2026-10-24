import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProviderVersionError } from "../../src/models/provider_errors.js";
import { ExecProvider } from "../../src/providers/exec_provider.js";
import { install } from "../../src/providers/installer.js";
import { loadManifest } from "../../src/providers/manifest.js";
import { NodeProvider } from "../../src/providers/node_provider.js";
import { getProvider, loadInstalled } from "../../src/providers/registry.js";
import { RestProvider } from "../../src/providers/rest_provider.js";
import { LayeredConfig } from "../../src/transport/config_layers.js";
import { useIso } from "../_support/iso.js";

useIso();
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "abx-runtime-")); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function plugin(requires = ">=0.3"): void {
  fs.writeFileSync(path.join(root, "abx-provider.toml"), `manifest_version = 1
operation_contract_version = 1
[operations]
cli = []
python = []
[workflow]
inputs = ["managed"]
startups = ["none"]
[provider]
id = "runtime-fixture"
name = "Runtime fixture"
version = "1.0.0"
[compat]
protocol = "node/1"
requires = { cli = "${requires}" }
[runtime]
kind = "node"
entry = "provider.mjs"
[features]
supported = ["sandbox.lifecycle"]
`);
  fs.writeFileSync(path.join(root, "dependency.mjs"), 'export const version = "v1";\n');
  fs.writeFileSync(path.join(root, "provider.mjs"), `import { version } from "./dependency.mjs";
export default () => ({ buildInfra: async () => ({ operation_contract_version: 1, operations: {cli: [], python: []}, sandbox_protocol: { list: async () => [version] } }) });\n`);
}

const config = (): LayeredConfig => new LayeredConfig({ provider: "runtime-fixture" });

describe("runtime provider loading", () => {
  it("loads updated dependencies in a fresh execution snapshot with the same manifest version", async () => {
    plugin();
    await install(root, { yes: true });
    const original = getProvider("runtime-fixture");
    const old = await original.buildInfra(config());
    try {
      expect(await old.sandbox_protocol.list()).toEqual(["v1"]);
      fs.writeFileSync(path.join(root, "dependency.mjs"), 'export const version = "v2";\n');
      await install(root, { yes: true, force: true });
      const updated = await getProvider("runtime-fixture").buildInfra(config());
      try { expect(await updated.sandbox_protocol.list()).toEqual(["v2"]); } finally { await updated.close?.(); }
      // An update does not interrupt existing sessions or relabel old dependencies as the new tree.
      expect(await old.sandbox_protocol.list()).toEqual(["v1"]);
    } finally { await old.close?.(); }
  });

  it("isolates dependency updates in a linked development tree", async () => {
    plugin();
    const provider = new NodeProvider(loadManifest(root), root);
    const old = await provider.buildInfra(config());
    try {
      fs.writeFileSync(path.join(root, "dependency.mjs"), 'export const version = "v2";\n');
      const updated = await provider.buildInfra(config());
      try { expect(await updated.sandbox_protocol.list()).toEqual(["v2"]); } finally { await updated.close?.(); }
      expect(await old.sandbox_protocol.list()).toEqual(["v1"]);
    } finally { await old.close?.(); }
  });

  it("checks the executing host after installation by a compatible different host", async () => {
    plugin(">=999");
    await install(root, { yes: true, hostVersion: "999.0.0" });
    expect(() => loadInstalled("runtime-fixture")).toThrow(ProviderVersionError);
  });

  it("checks direct node, exec and rest factories before executing or validating credentials", async () => {
    plugin(">=999");
    fs.writeFileSync(path.join(root, "provider.mjs"), 'throw new Error("plugin must not execute");\n');
    const manifest = loadManifest(root);
    const providers = [new NodeProvider(manifest, root), new ExecProvider(manifest, root), new RestProvider(manifest)];
    for (const provider of providers) await expect(provider.buildInfra(config())).rejects.toBeInstanceOf(ProviderVersionError);
  });
});
