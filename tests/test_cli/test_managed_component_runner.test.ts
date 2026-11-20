import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { COMPONENT_RUNNER_SOURCE } from "../../src/application/component_runner.js";

it("prepares and invokes a local component with the actual official loader in isolation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "abx-component-loader-test-"));
  try {
    const component = path.join(root, "component"), runner = path.join(root, "runner.cjs");
    fs.mkdirSync(component);
    fs.writeFileSync(path.join(component, "package.json"), JSON.stringify({ main: "index.cjs" }));
    fs.writeFileSync(path.join(component, "publish.yaml"), "Name: fixture\nVersion: 1.2.3\n");
    fs.writeFileSync(path.join(component, "index.cjs"), `module.exports = class {
      constructor({logger}) { this.logger = logger; logger.info("fixture loaded"); }
      async deploy(input) {
        const credential = await input.getCredential();
        this.logger.info("fixture invoked");
        return {accountId: credential.AccountID, tokenPresent: credential.SecurityToken === "fixture-sts",
          command: input.command, resource: input.resource.name, props: input.props};
      }
      async info() { return {}; }
      async remove() { return {}; }
    };`);
    fs.writeFileSync(runner, COMPONENT_RUNNER_SOURCE, { mode: 0o600 });
    const base = { loaderPath: createRequire(import.meta.url).resolve("@serverless-devs/load-component"),
      component, cwd: root, name: "fixture", command: "deploy", resource: "gateway", props: { memorySize: 4096 },
      credential: { AccountID: "1234567890123456", SecurityToken: "fixture-sts" } };
    const run = (action: string) => {
      const result = spawnSync(process.execPath, [runner], { cwd: root, env: { ...process.env, NODE_PATH: "" },
        input: JSON.stringify({ ...base, action }), stdio: ["pipe", "ignore", "ignore", "pipe"],
        encoding: "utf8", timeout: 10000 });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      return JSON.parse(result.output[3] || "");
    };
    expect(run("prepare")).toEqual({ componentPath: component, version: "1.2.3", logCount: 1 });
    expect(run("invoke")).toEqual({ result: { accountId: "1234567890123456", tokenPresent: true,
      command: "deploy", resource: "gateway", props: { memorySize: 4096 } }, logCount: 2 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
