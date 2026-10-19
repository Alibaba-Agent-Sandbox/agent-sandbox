import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deployProviderImage } from "../../src/api/provider_template.js";
import { Provider, type ProviderImageRequest, type ProviderTemplates } from "../../src/providers/base.js";
import { AlicloudExpressProvider } from "../../src/providers/builtin.js";
import { ProviderFeatureNotSupportedError } from "../../src/providers/errors.js";
import { registerProvider, getProvider } from "../../src/providers/registry.js";
import type { LayeredConfig } from "../../src/transport/config_layers.js";
import { loadLayeredConfig } from "../../src/transport/config_layers.js";
import { HttpClient } from "../../src/transport/http.js";
import { addCliOptions, resetCliSelection, setCliProvider } from "../../src/providers/selection.js";
import { install } from "../../src/providers/installer.js";
import { cli } from "../../src/cli/main.js";
import { CliRunner } from "../helpers/cliRunner.js";
import * as templateSdk from "../../src/providers/shared/e2b/template_sdk.js";
import { useIso } from "../_support/iso.js";

const iso = useIso();
beforeEach(resetCliSelection);
const input: ProviderImageRequest = { source: { kind: "image", image: "python:3.12-slim" }, name: "test:v1" };
const result = { template_id: "tpl-test", build_id: "bld-test", status: "ready" as const, ref: input.source.image };
class ImageProvider extends Provider {
  readonly id = "image-test";
  override features = new Set(["templates.deploy"]);
  override async buildInfra(): Promise<never> { throw new Error("sandbox infra must never be built"); }
  override buildTemplates = vi.fn(async (_config: LayeredConfig): Promise<ProviderTemplates> => ({ deploy: vi.fn(async () => result) }));
}
function provider(): ImageProvider { const p = new ImageProvider(); registerProvider(p); return p; }

async function nodePlugin(code: string): Promise<string> {
  const root = path.join(iso.root, "image-plugin"); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "abx-provider.toml"), `manifest_version = 1
[provider]
id = "image-node"
name = "Image"
version = "1.0.0"
[compat]
requires = { cli = ">=0.3" }
[runtime]
kind = "node"
protocol = "node/1"
entry = "provider.mjs"
[features]
supported = ["templates.deploy"]
[core]
inherit = []
[config.fields.api_key]
secret = true
credential = true
required = true
`);
  fs.writeFileSync(path.join(root, "provider.mjs"), code);
  await install(root, { yes: true, hostVersion: "0.3.0" });
  return root;
}

describe("optional image templates", () => {
  it("does not infer a factory from legacy Express build support", async () => {
    const p = new AlicloudExpressProvider();
    expect(p.supports("templates.build")).toBe(true);
    expect(p.supports("templates.deploy")).toBe(false);
    await expect(deployProviderImage(input)).rejects.toBeInstanceOf(ProviderFeatureNotSupportedError);
  });
  it("forwards only provider-scoped configuration and returns a strict result allowlist", async () => {
    const p = provider();
    p.configFields = [{ key: "api_key", secret: true, credential: true }];
    const close = vi.fn();
    p.buildTemplates.mockImplementation(async (config) => {
      expect(config.provider_options).toEqual({ api_key: "own-key" });
      expect(config.sandbox_api_key).toBeNull();
      return { deploy: async () => ({ ...result, logs: "private-value" }), close };
    });
    iso.setenv("ABX_SANDBOX_API_KEY", "express-key");
    expect(await deployProviderImage(input, { provider: p.id, provider_options: { api_key: "own-key" } })).toEqual(result);
    expect(close).toHaveBeenCalledExactlyOnceWith();
  });
  it.each([
    { source: { kind: "steps", image: "python" } },
    { source: Object.assign([], { kind: "image", image: "python:3.12-slim" }) },
    { source: { kind: "image", image: "https://name:secret@example.com/image" } },
    { name: "bad name" }, { timeout: 0 }, { timeout: 3601 }, { timeout: NaN },
    { spec: { cpu: 0 } }, { spec: { memory: 1.5 } }, { spec: { generation: 2 } },
    { spec: { start_cmd: "server" } }, { registry: { username: "user" } },
    { secret: "unexpected" },
  ])("rejects invalid request before factory creation: %j", async (override) => {
    const p = provider();
    await expect(deployProviderImage({ ...input, ...override } as ProviderImageRequest, { provider: p.id })).rejects.toThrow("Invalid image deployment");
    expect(p.buildTemplates).not.toHaveBeenCalled();
  });
  it("rejects an aborted request before the factory", async () => {
    const p = provider(); const signal = AbortSignal.abort("private caller cancellation reason");
    await expect(deployProviderImage({ ...input, signal }, { provider: p.id })).rejects.toThrow("Provider image deployment was cancelled.");
    expect(p.buildTemplates).not.toHaveBeenCalled();
  });
  it("rejects CLI secret options before factory creation", async () => {
    const p = provider(); p.configFields = [{ key: "api_key", secret: true }];
    addCliOptions(["api_key=secret"]);
    await expect(deployProviderImage(input, { provider: p.id })).rejects.toThrow("secret");
    expect(p.buildTemplates).not.toHaveBeenCalled();
  });
  it("discards raw error messages and always closes failed factories", async () => {
    const p = provider(); const close = vi.fn();
    p.buildTemplates.mockResolvedValue({ deploy: async () => { throw new Error("sensitive-provider-response"); }, close });
    await expect(deployProviderImage(input, { provider: p.id })).rejects.toThrow("Provider image deployment failed");
    expect(close).toHaveBeenCalledOnce();
  });
  it.each([undefined, { ...result, status: "building" }, { ...result, template_id: "\nsecret" }, { ...result, ref: "unexpected" }])("closes invalid responses", async (value) => {
    const p = provider(); const close = vi.fn();
    p.buildTemplates.mockResolvedValue({ deploy: async () => value as typeof result, close });
    await expect(deployProviderImage(input, { provider: p.id })).rejects.toThrow("deployment failed");
    expect(close).toHaveBeenCalledOnce();
  });
  it("sanitizes both synchronous and asynchronous cleanup errors", async () => {
    const p = provider();
    for (const close of [() => { throw new Error("secret"); }, async () => { throw new Error("secret"); }]) {
      p.buildTemplates.mockResolvedValue({ deploy: async () => result, close });
      await expect(deployProviderImage(input, { provider: p.id })).rejects.toThrow("resources could not be closed");
    }
  });
  it("installs and dispatches a node template factory without building sandbox infra", async () => {
    await nodePlugin(`export default () => ({buildInfra(){throw Error('wrong path')}, async buildTemplates(ctx){
      if(ctx.core.sandbox_api_key || ctx.options.api_key !== 'own-key') throw Error('credential scope');
      return {deploy:async(input)=>({template_id:'tpl-test',build_id:'bld-test',status:'ready',ref:input.source.image})};
    }});`);
    const data = await deployProviderImage(input, { provider: "image-node", provider_options: { api_key: "own-key" } });
    expect(data).toEqual(result);
  });
  it.each(["throw Error('private factory error')", "return {deploy:1}"])("closes every context client when factory fails: %s", async (failure) => {
    await nodePlugin(`export default ()=>({buildInfra(){throw Error('wrong path')},async buildTemplates(ctx){
      ctx.http({base_url:'http://127.0.0.1:1',domain:'localhost'});${failure}
    }});`);
    const close = vi.spyOn(HttpClient.prototype, "close").mockResolvedValue();
    try {
      await expect(deployProviderImage(input, { provider: "image-node", provider_options: { api_key: "own-key" } })).rejects.toThrow("deployment failed");
      expect(close).toHaveBeenCalledOnce();
    } finally { close.mockRestore(); }
  });
  it("closes HTTP clients even if a plugin cleanup throws synchronously", async () => {
    await nodePlugin(`export default ()=>({buildInfra(){throw Error('wrong path')},async buildTemplates(ctx){
      ctx.http({base_url:'http://127.0.0.1:1',domain:'localhost'});
      return {deploy:async(input)=>({template_id:'tpl-test',build_id:'bld-test',status:'ready',ref:input.source.image}),close(){throw Error('private')}};
    }});`);
    const close = vi.spyOn(HttpClient.prototype, "close").mockResolvedValue();
    try {
      await expect(deployProviderImage(input, { provider: "image-node", provider_options: { api_key: "own-key" } })).rejects.toThrow("resources could not be closed");
      expect(close).toHaveBeenCalledOnce();
    } finally { close.mockRestore(); }
  });
  it("lets a plugin request a shared SDK without any provider-id selection", async () => {
    const load = vi.spyOn(templateSdk, "loadTemplate").mockResolvedValue({ fixture: true });
    try {
      await nodePlugin(`export default kit=>({buildInfra(){throw Error('wrong path')},async buildTemplates(){
        const sdk=await kit.e2b.loadTemplate(); if(!sdk.fixture) throw Error('missing explicit SDK');
        return {deploy:async(input)=>({template_id:'tpl-test',build_id:'bld-test',status:'ready',ref:input.source.image})};
      }});`);
      expect(await deployProviderImage(input, {provider:"image-node",provider_options:{api_key:"own-key"}})).toEqual(result);
      expect(load).toHaveBeenCalledOnce();
    } finally { load.mockRestore(); }
  });
  it("requires a real buildTemplates factory even with declared metadata", async () => {
    await nodePlugin(`export default ()=>({buildInfra(){throw Error('wrong path')}});`);
    await expect(getProvider("image-node").buildTemplates(loadLayeredConfig({ provider: "image-node", provider_options: { api_key: "own-key" } }))).rejects.toBeInstanceOf(ProviderFeatureNotSupportedError);
  });
  it("keeps Express from-image parameters owned by its existing adapter", async () => {
    const r = await new CliRunner().invoke(cli, ["template", "from-image", "--help"]);
    expect(r.exit_code, r.output).toBe(0);
    expect(r.stdout).toContain("--generation");
    expect(r.stdout).toContain("--team-id");
    expect(r.stdout).not.toContain("Requires templates.deploy");
  });
  it("runs the CLI image route and prints its exact JSON result", async () => {
    const p = provider();
    setCliProvider(p.id);
    const r = await new CliRunner().invoke(cli, ["--json", "template", "from-image", input.source.image, "--name", input.name, "-y"]);
    expect(r.exit_code, r.output).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(result);
    expect(p.buildTemplates).toHaveBeenCalledOnce();
  });
});
