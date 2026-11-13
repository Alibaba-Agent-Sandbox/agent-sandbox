import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {afterAll, beforeAll, expect, it} from "vitest";
import * as esbuild from "esbuild";
import {execute} from "../../src/application/process.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "abx-worker-assets-"));
const parser = path.join(root, "devs-parser.cjs"), component = path.join(root, "devs-component.cjs");
beforeAll(async () => {
  const builder = await import(pathToFileURL(path.resolve("scripts/build_binary.mjs")).href);
  await builder.bundleWorkers(esbuild, {"abx/devs-parser.cjs": parser, "abx/devs-component.cjs": component});
}, 60000);
afterAll(() => fs.rmSync(root, {recursive: true, force: true}));
const env = {...process.env, NODE_PATH: "", ABX_APP_NODE: "", PATH: "", HOME: root};

it("bundles the actual native parser without an external parser path or node_modules", async () => {
  fs.writeFileSync(path.join(root, "values.json"), JSON.stringify({memory: 4096}));
  fs.writeFileSync(path.join(root, ".env"), "ABX_ASSET_TEST_VALUE=private-child-value\n");
  const output = await execute({argv: [process.execPath, parser], cwd: root, env, privateResult: true, timeoutSeconds: 15,
    input: JSON.stringify({command: "deploy", content: JSON.stringify({edition: "3.0.0", name: "asset-test", vars: {memory: "${json(file('./values.json')).memory}"}, resources: {api: {component: "fc3@0.1.26", props: {memorySize: "${vars.memory}", value: "${env('ABX_ASSET_TEST_VALUE')}"}}}})})});
  const result = JSON.parse(output);
  expect(result.content.resources.api.props).toEqual({memorySize: 4096, value: "private-child-value"});
  expect(result.steps).toEqual([{resource: "api", component: "fc3@0.1.26"}]);
});

it("bundles the official loader while preserving dynamic component requires and isolated log/result channels", async () => {
  const fixture = path.join(root, "fixture"); fs.mkdirSync(fixture);
  fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({main: "index.cjs"}));
  fs.writeFileSync(path.join(fixture, "publish.yaml"), "Name: fixture\nVersion: 1.2.3\n");
  fs.writeFileSync(path.join(fixture, "value.cjs"), "module.exports = 'relative-module';");
  fs.writeFileSync(path.join(fixture, "index.cjs"), `module.exports = class {
    constructor({logger}) {this.logger=logger; logger.info('loaded official component');}
    async build(input) {const credentials=await input.getCredential(); this.logger.info(credentials.AccessKeySecret); return {value:require('./value.cjs'),args:input.args};}
  };`);
  let events = "";
  const output = await execute({argv: [process.execPath, component], cwd: root, env, privateResult: true, onEventData: data => {events += data;}, timeoutSeconds: 15,
    input: JSON.stringify({action: "invoke", events: true, component: fixture, componentReference: "fixture@1.2.3", cwd: root, name: "fixture", resource: "api", command: "build", args: ["--context", "."], props: {}, credential: {AccessKeyID: "placeholder-id", AccessKeySecret: "placeholder-private-value"}})});
  expect(JSON.parse(output).result).toEqual({value: "relative-module", args: ["--context", "."]});
  const logs = events.trim().split("\n").map(line => JSON.parse(line));
  expect(logs).toContainEqual({level: "info", message: "loaded official component", component: "fixture@1.2.3", resource: "api", command: "build"});
  expect(events).toContain("[REDACTED]"); expect(events).not.toContain("placeholder-private-value");
});
