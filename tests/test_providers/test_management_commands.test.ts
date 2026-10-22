import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Provider, type ProviderInfra } from "../../src/providers/base.js";
import { parseCommandSection, type ProviderCommand, type ProviderCommandRunner } from "../../src/providers/command_contract.js";
import { commandTuning, getProviderCommand, listProviderCommands, runProviderCommand } from "../../src/providers/commands.js";
import { ProviderConfigError, ProviderFeatureNotSupportedError, ProviderIntegrityError, ProviderManifestError, ProviderProtocolError, ProviderTimeoutError } from "../../src/models/provider_errors.js";
import { diffAspects, install } from "../../src/providers/installer.js";
import { manifestSummary, parseManifest } from "../../src/providers/manifest.js";
import { registerProvider } from "../../src/providers/registry.js";
import { LayeredConfig } from "../../src/transport/config_layers.js";
import { HttpClient } from "../../src/transport/http.js";
import { useIso } from "../_support/iso.js";

const iso = useIso();
afterEach(() => { commandTuning.cleanupTimeoutMs = 1000; vi.restoreAllMocks(); });
const descriptor: ProviderCommand = {
  id: "volume.list", description: "List volumes.", description_zh: "列出存储卷。", effect: "read", idempotent: true,
  input_schema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false },
  output_schema: { type: "object", properties: { items: { type: "array", items: { type: "string" } } }, required: ["items"], additionalProperties: false },
};
const section = (entries: unknown = [descriptor]) => ({ protocol: "provider-commands/1", entries });
const base = `manifest_version = 1
[provider]
id = "command-demo"
version = "1.0.0"
[runtime]
kind = "node"
entry = "provider.mjs"
[features]
supported = []
`;
const commandsToml = `
[commands]
protocol = "provider-commands/1"
[[commands.entries]]
id = "volume.list"
description = "List volumes."
description_zh = "列出存储卷。"
effect = "read"
idempotent = true
input_schema = { type = "object", properties = { limit = {type = "integer", minimum = 1, maximum = 100} }, additionalProperties = false }
output_schema = { type = "object", properties = { items = {type = "array", items = {type = "string"}} }, required = ["items"], additionalProperties = false }
`;

class Demo extends Provider {
  readonly id = "command-demo";
  override commands = [structuredClone(descriptor)];
  readonly close = vi.fn(async () => undefined);
  readonly run = vi.fn(async (_command: string, _input: Record<string, unknown>, _signal: AbortSignal): Promise<unknown> => ({ items: [] }));
  readonly build = vi.fn(async (_config: LayeredConfig): Promise<ProviderCommandRunner> => ({ run: this.run, close: this.close }));
  async buildInfra(): Promise<ProviderInfra> { throw new Error("must not connect to a sandbox"); }
  override buildCommandRunner(config: LayeredConfig): Promise<ProviderCommandRunner> { return this.build(config); }
}

describe("provider management command contract", () => {
  it("keeps legacy manifests empty and includes descriptors in update consent", () => {
    const old = parseManifest(base), next = parseManifest(base + commandsToml);
    expect(old.commands).toEqual([]);
    expect(next.commands).toEqual([descriptor]);
    const receipt = { consented: manifestSummary(old) };
    expect(diffAspects(receipt, next)).toEqual(["commands"]);
    const { commands: _old, ...legacy } = manifestSummary(old);
    expect(diffAspects({ consented: legacy }, old)).toEqual([]);
    expect(diffAspects({ consented: manifestSummary(next) }, parseManifest((base + commandsToml).replace('effect = "read"', 'effect = "delete"')))).toEqual(["commands"]);
  });

  it("compares cross-language consent by schema content and sorts command ids identically", () => {
    const manifest = parseManifest(base + commandsToml);
    const reverse = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reverse);
      if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverse(child)]));
      return value;
    };
    expect(diffAspects({ consented: reverse(manifestSummary(manifest)) }, manifest)).toEqual([]);
    expect(parseCommandSection(section([{ ...descriptor, id: "a.b" }, { ...descriptor, id: "a-b" }]), "node").map((entry) => entry.id)).toEqual(["a-b", "a.b"]);
  });

  it.each([
    [descriptor, descriptor],
    [{ ...descriptor, id: "../exec" }],
    [{ ...descriptor, effect: "execute" }],
    [{ ...descriptor, idempotent: "true" }],
    [{ ...descriptor, description_zh: "" }],
    [{ ...descriptor, shell: "echo unexpected" }],
    [{ ...descriptor, input_schema: { type: "object" } }],
    [{ ...descriptor, input_schema: { type: "object", additionalProperties: false, properties: { q: { $ref: "https://example.com" } } } }],
    [{ ...descriptor, output_schema: { type: "string", pattern: "(x+)+" } }],
    [{ ...descriptor, output_schema: { type: "string", format: "email" } }],
    [{ ...descriptor, output_schema: { type: "invalid" } }],
    [{ ...descriptor, description: "x".repeat(64 * 1024) }],
    Array.from({ length: 129 }, (_, i) => ({ ...descriptor, id: `command${i}` })),
  ])("rejects malformed, excessive or unsafe declarations before execution %#", (...entries) => {
    expect(() => parseCommandSection(section(entries), "node")).toThrow(ProviderManifestError);
  });

  it("rejects unsupported protocols and executable descriptors on REST plugins", () => {
    expect(() => parseCommandSection({ ...section(), protocol: "provider-commands/99" }, "node")).toThrow(ProviderManifestError);
    expect(() => parseCommandSection(section(), "rest")).toThrow(ProviderManifestError);
  });

  it("allows keyword-like property names while rejecting keyword use within schemas", () => {
    expect(parseCommandSection(section([{ ...descriptor, input_schema: { type: "object", properties: { format: { type: "string" }, pattern: { type: "boolean" } }, additionalProperties: false } }]), "node")).toHaveLength(1);
  });

  it("discovery is static and returned descriptors cannot modify the registry", () => {
    const provider = registerProvider(new Demo()) as Demo;
    listProviderCommands(provider.id)[0].effect = "delete";
    expect(getProviderCommand(provider.id, descriptor.id).effect).toBe("read");
    expect(provider.build).not.toHaveBeenCalled();
  });

  it("rejects unknown commands and invalid input without infrastructure or credentials", async () => {
    const provider = registerProvider(new Demo()) as Demo;
    await expect(runProviderCommand(provider.id, "volume.delete", {})).rejects.toBeInstanceOf(ProviderFeatureNotSupportedError);
    for (const input of [null, [], new Date(), { limit: "5" }, { limit: 0 }, { unknown: "value" }, JSON.parse('{"__proto__":{}}')]) {
      await expect(runProviderCommand(provider.id, descriptor.id, input)).rejects.toBeInstanceOf(ProviderConfigError);
    }
    expect(provider.build).not.toHaveBeenCalled();
  });

  it("validates output, closes resources and never retries a failed invocation", async () => {
    const provider = registerProvider(new Demo()) as Demo;
    provider.run.mockResolvedValueOnce({ items: ["entry"] });
    expect(await runProviderCommand(provider.id, descriptor.id, { limit: 5 })).toEqual({ items: ["entry"] });
    expect(provider.close).toHaveBeenCalledTimes(1);
    provider.run.mockResolvedValueOnce({ wrong: [] });
    await expect(runProviderCommand(provider.id, descriptor.id, {})).rejects.toBeInstanceOf(ProviderProtocolError);
    provider.run.mockRejectedValueOnce(new Error("credential body should not escape"));
    await expect(runProviderCommand(provider.id, descriptor.id, {})).rejects.toThrow("No retry was made");
    expect(provider.run).toHaveBeenCalledTimes(3);
    expect(provider.close).toHaveBeenCalledTimes(3);
  });

  it("redacts configured credentials from structured errors and results", async () => {
    const provider = registerProvider(new Demo()) as Demo;
    const options = { access_key_id: "placeholder-access-id", access_key_secret: "placeholder-access-secret" };
    provider.run.mockResolvedValueOnce({ items: [options.access_key_secret] });
    expect(await runProviderCommand(provider.id, descriptor.id, {}, options)).toEqual({ items: ["***"] });
    provider.run.mockRejectedValueOnce(new ProviderConfigError(options.access_key_secret, { suggestion: options.access_key_id, docs_url: options.access_key_secret }));
    try { await runProviderCommand(provider.id, descriptor.id, {}, options); throw new Error("missing error"); }
    catch (exc) { expect(JSON.stringify(exc)).not.toContain("placeholder-access"); }
  });

  it("times out once, aborts the operation and closes resources", async () => {
    const provider = registerProvider(new Demo()) as Demo;
    provider.commandTimeoutMs = 10;
    provider.run.mockImplementationOnce(async (_id, _input, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    await expect(runProviderCommand(provider.id, descriptor.id, {})).rejects.toBeInstanceOf(ProviderTimeoutError);
    expect(provider.run).toHaveBeenCalledTimes(1);
    expect(provider.close).toHaveBeenCalledTimes(1);
  });

  it("bounds hanging cleanup without hiding a timeout or silently claiming success", async () => {
    const provider = registerProvider(new Demo()) as Demo;
    commandTuning.cleanupTimeoutMs = 5;
    provider.commandTimeoutMs = 5;
    provider.close.mockImplementation(async () => new Promise(() => undefined));
    provider.run.mockImplementationOnce(async () => new Promise(() => undefined));
    await expect(runProviderCommand(provider.id, descriptor.id, {})).rejects.toMatchObject({ code: "E8022", suggestion: expect.stringContaining("cleanup failed") });
    provider.run.mockResolvedValueOnce({ items: [] });
    await expect(runProviderCommand(provider.id, descriptor.id, {})).rejects.toMatchObject({ code: "E8020", message: expect.stringContaining("cleanup failed") });
  });

  it("closes a runner that finishes initialization after the timeout", async () => {
    const provider = registerProvider(new Demo()) as Demo;
    provider.commandTimeoutMs = 5;
    let finish!: (runner: ProviderCommandRunner) => void;
    provider.build.mockImplementationOnce(async () => new Promise((resolve) => { finish = resolve; }));
    await expect(runProviderCommand(provider.id, descriptor.id, {})).rejects.toBeInstanceOf(ProviderTimeoutError);
    finish({ run: provider.run, close: provider.close });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(provider.close).toHaveBeenCalledTimes(1);
    expect(provider.run).not.toHaveBeenCalled();
  });

  it("redacts secrets in nested result keys as well as values", async () => {
    const provider = registerProvider(new Demo()) as Demo;
    provider.commands[0].output_schema = { type: "object" };
    provider.run.mockResolvedValueOnce({ nested: { "placeholder-secret": "placeholder-secret" } });
    const result = await runProviderCommand(provider.id, descriptor.id, {}, { access_key_secret: "placeholder-secret" });
    expect(result).toEqual({ nested: { "***": "***" } });
  });

  it("installs a real Node plugin, discovers without import and invokes only declared dispatch", async () => {
    const root = path.join(iso.root, "node-plugin");
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, "abx-provider.toml"), base + commandsToml);
    fs.writeFileSync(path.join(root, "provider.mjs"), `export default function create() { return { async buildInfra(ctx) { return { sandbox_protocol: {}, provider_commands: { async run(command, input) { return {items: [ctx.id, command, String(input.limit)]}; } } }; } }; }`);
    await install(root, { yes: true });
    expect(listProviderCommands("command-demo")).toHaveLength(1);
    expect(await runProviderCommand("command-demo", "volume.list", { limit: 3 })).toEqual({ items: ["command-demo", "volume.list", "3"] });
    fs.appendFileSync(path.join(iso.home, "providers", "command-demo", "provider.mjs"), "\n// tampered");
    expect(() => listProviderCommands("command-demo")).toThrow(ProviderIntegrityError);
  });

  it("calls declared commands through a real EPP process", async () => {
    const root = path.join(iso.root, "exec-plugin");
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, "abx-provider.toml"), (base + commandsToml).replace('kind = "node"\nentry = "provider.mjs"', 'kind = "exec"\ncommand = ["node", "./provider.mjs"]'));
    fs.writeFileSync(path.join(root, "provider.mjs"), `import readline from 'node:readline';
const lines = readline.createInterface({input:process.stdin});
lines.on('line', line => { const q=JSON.parse(line); let result={};
if(q.method==='initialize') result={protocol:'epp/1',features:[]};
else if(q.method==='provider.commands.run') result={items:[q.params.command,String(q.params.input.limit)]};
if(q.id!==undefined) process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n');
if(q.method==='shutdown') setTimeout(()=>process.exit(0),5);
});`);
    await install(root, { yes: true });
    expect(await runProviderCommand("command-demo", "volume.list", { limit: 3 })).toEqual({ items: ["volume.list", "3"] });
  });

  it("calls declared commands through a real Node EPP helper and closes its dispatcher", async () => {
    const root = path.join(iso.root, "node-epp-plugin");
    const events = path.join(iso.root, "node-epp-events.jsonl");
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, "abx-provider.toml"), base + commandsToml);
    fs.writeFileSync(path.join(root, "provider.mjs"), `import { appendFileSync } from 'node:fs';
export default kit => ({ buildInfra: ctx => kit.epp.infra(ctx, () => ({
  async dispatch(method, params) {
    appendFileSync(${JSON.stringify(events)}, JSON.stringify({method, params})+'\\n');
    if (method === 'initialize') return {protocol:'epp/1',features:[]};
    if (method === 'provider.commands.run') return {items:[params.command,String(params.input.limit)]};
    return {};
  }
})) });`);
    await install(root, { yes: true });
    expect(listProviderCommands("command-demo")).toHaveLength(1);
    await expect(runProviderCommand("command-demo", "volume.delete", {})).rejects.toBeInstanceOf(ProviderFeatureNotSupportedError);
    expect(fs.existsSync(events)).toBe(false);
    expect(await runProviderCommand("command-demo", "volume.list", { limit: 3 })).toEqual({ items: ["volume.list", "3"] });
    const calls = fs.readFileSync(events, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { method: string });
    expect(calls.map((call) => call.method)).toEqual(["initialize", "provider.commands.run", "shutdown"]);
  });

  it("maps a real Node EPP helper's missing command handler to E8004", async () => {
    const root = path.join(iso.root, "node-epp-plugin-missing");
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, "abx-provider.toml"), base + commandsToml);
    fs.writeFileSync(path.join(root, "provider.mjs"), `export default kit => ({ buildInfra: ctx => kit.epp.infra(ctx, () => ({
  async dispatch(method) {
    if (method === 'initialize') return {protocol:'epp/1',features:[]};
    if (method === 'shutdown') return {};
    throw {code:-32601,message:'Method not found'};
  }
})) });`);
    await install(root, { yes: true });
    await expect(runProviderCommand("command-demo", "volume.list", {})).rejects.toMatchObject({ code: "E8004", feature: "command:volume.list" });
  });

  it("preserves a real Node EPP helper's declared null result", async () => {
    const root = path.join(iso.root, "node-epp-plugin-null-result");
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, "abx-provider.toml"), base + commandsToml.replace(/^output_schema.*$/m, 'output_schema = { type = "null" }'));
    fs.writeFileSync(path.join(root, "provider.mjs"), `export default kit => ({ buildInfra: ctx => kit.epp.infra(ctx, () => ({
  async dispatch(method) {
    if (method === 'initialize') return {protocol:'epp/1',features:[]};
    return null;
  }
})) });`);
    await install(root, { yes: true });
    expect(await runProviderCommand("command-demo", "volume.list", {})).toBeNull();
  });

  it("shuts down a real Node EPP helper after failed initialization", async () => {
    const root = path.join(iso.root, "node-epp-plugin-init-failure");
    const marker = path.join(iso.root, "node-epp-shutdown");
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, "abx-provider.toml"), base + commandsToml);
    fs.writeFileSync(path.join(root, "provider.mjs"), `import { writeFileSync } from 'node:fs';
export default kit => ({ buildInfra: ctx => kit.epp.infra(ctx, () => ({
  async dispatch(method) {
    if (method === 'initialize') return {protocol:'unsupported',features:[]};
    if (method === 'shutdown') writeFileSync(${JSON.stringify(marker)}, 'closed');
    return {};
  }
})) });`);
    await install(root, { yes: true });
    await expect(runProviderCommand("command-demo", "volume.list", {})).rejects.toThrow("expected 'epp/1'");
    expect(fs.readFileSync(marker, "utf8")).toBe("closed");
  });

  it("closes host clients even when a real Node plugin close hook fails", async () => {
    const root = path.join(iso.root, "node-plugin-close");
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, "abx-provider.toml"), base + commandsToml);
    fs.writeFileSync(path.join(root, "provider.mjs"), `export default function create() { return { async buildInfra(ctx) { ctx.http({base_url:'http://127.0.0.1',domain:'example.com'}); return { sandbox_protocol: {}, provider_commands: { async run() { return {items:[]}; } }, async close() { throw new Error('plugin cleanup failed'); } }; } }; }`);
    const close = vi.spyOn(HttpClient.prototype, "close").mockResolvedValue();
    await install(root, { yes: true });
    await expect(runProviderCommand("command-demo", "volume.list", {})).rejects.toThrow("resource cleanup failed");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("cleans a real Node plugin with a malformed management dispatcher", async () => {
    const root = path.join(iso.root, "node-plugin-malformed");
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, "abx-provider.toml"), base + commandsToml);
    fs.writeFileSync(path.join(root, "provider.mjs"), `export default function create() { return { async buildInfra(ctx) { ctx.http({base_url:'http://127.0.0.1',domain:'example.com'}); return { sandbox_protocol: {}, provider_commands: {} }; } }; }`);
    const close = vi.spyOn(HttpClient.prototype, "close").mockResolvedValue();
    await install(root, { yes: true });
    await expect(runProviderCommand("command-demo", "volume.list", {})).rejects.toBeInstanceOf(ProviderFeatureNotSupportedError);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("cleans host clients when a real Node plugin returns null infrastructure", async () => {
    const root = path.join(iso.root, "node-plugin-null");
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, "abx-provider.toml"), base + commandsToml);
    fs.writeFileSync(path.join(root, "provider.mjs"), `export default function create() { return { async buildInfra(ctx) { ctx.http({base_url:'http://127.0.0.1',domain:'example.com'}); return null; } }; }`);
    const close = vi.spyOn(HttpClient.prototype, "close").mockResolvedValue();
    await install(root, { yes: true });
    await expect(runProviderCommand("command-demo", "volume.list", {})).rejects.toThrow("invalid infrastructure");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
