/** Real local engine and ES module initialization; no cloud lifecycle calls. */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startEngine, type EngineHandle } from "../../src/engine/server.js";
import { install } from "../../src/providers/installer.js";
import { useIso } from "../_support/iso.js";

const iso = useIso();
let engine: EngineHandle;
let root: string;
beforeEach(async () => {
  root = path.join(iso.root, "plugin");
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "abx-provider.toml"), `manifest_version = 1
operation_contract_version = 1
[operations]
cli = []
python = []
[workflow]
inputs = ["managed"]
startups = ["none"]
[provider]
id = "initialize-fixture"
name = "Initialize fixture"
version = "1.0.0"
[compat]
protocol = "node/1"
[runtime]
kind = "node"
entry = "provider.mjs"
[features]
supported = []
`);
  engine = await startEngine({ idle_timeout: 0 });
});
afterEach(async () => { await engine.close(); });
async function initialize(connection: Record<string, unknown> = {}) {
  const response = await fetch(`http://127.0.0.1:${engine.record.port}/v1/providers/initialize-fixture/initialize`, {
    method: "POST", headers: { Authorization: `Bearer ${engine.record.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ connection }),
  });
  return { status: response.status, body: await response.json() };
}
async function plugin(source: string) {
  fs.writeFileSync(path.join(root, "provider.mjs"), source);
  await install(root, { yes: true });
}

describe("provider initialization", () => {
  it("loads the real plugin, forwards options and closes infra without calling cloud lifecycle", async () => {
    const marker = path.join(iso.root, "initialized.json");
    await plugin(`import fs from 'node:fs';
export default () => ({ buildInfra: async ctx => ({
  operation_contract_version: 1, operations: {cli: [], python: []},
  sandbox_protocol: { create: () => { throw Error('must not create'); }, list: () => { throw Error('must not list'); } },
  close: async () => fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify(ctx.options))
}) });`);
    const result = await initialize();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ provider: "initialize-fixture", initialized: true });
    expect(JSON.parse(fs.readFileSync(marker, "utf8"))).toEqual({});
    const health = await fetch(`http://127.0.0.1:${engine.record.port}/v1/health`, { headers: { Authorization: `Bearer ${engine.record.token}` } });
    expect(await health.json()).toMatchObject({ sessions: 0 });
  });
  it("rejects invalid module syntax instead of reporting initialization", async () => {
    await plugin("this is invalid JavaScript;");
    const result = await initialize();
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.body).not.toHaveProperty("initialized");
  });
  it("rejects provider mismatch before executing code", async () => {
    await plugin("throw Error('must not import');");
    expect(await initialize({ provider: "other" })).toMatchObject({ status: 400, body: { error: { code: "E8030" } } });
  });
  it("does not report success when resource cleanup fails", async () => {
    await plugin("export default () => ({buildInfra: async () => ({operation_contract_version: 1, operations: {cli: [], python: []},close: async () => {throw Error('cleanup failed');}})});");
    const result = await initialize();
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.body).not.toHaveProperty("initialized");
  });
});
