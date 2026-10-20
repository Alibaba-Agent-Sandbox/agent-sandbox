/** Generic template entrypoints must validate v3 before invoking any provider. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { readTemplateContract, validateTemplateVersion } from "../../src/utils/template_contract.js";

const directories: string[] = [];
const fixture = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "abx-template-contract-"));
  directories.push(root); return root;
};
afterEach(() => { for (const root of directories.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function template(): Record<string, unknown> {
  return { name: "example", version: "1.0.0", description: "Example", author: "example", license: "Apache-2.0", spec_version: 3,
    base: "fc-e2b-registry.<region>.cr.aliyuncs.com/runtime/base:<tag>", generation: 2,
    start_cmd: "agent-sandbox-server serve --port 9000 --commands /home/user/app/commands.py", ready_cmd: "agent-sandbox-server healthcheck --port 9000",
    resources: { cpu: 2, memory: 2048 }, ports: [9000], tags: ["example"], priority: "P2", wave: "other", tested_on: [],
    capabilities: ["ports"], env: {}, smoke: [{ command: "hello", expect: "hello" }] };
}
function application(): Record<string, any> {
  return { runtime: { placement: "in-sandbox", driver: "sandbox-local-api", profile: "server-core-agents" }, gateway: { placement: "client-direct" },
    deployment: { adapter: "none" }, sandbox: { provider: "alicloud-express", lifetime: "per-run", workspace: "exclusive", requiredFeatures: ["sandbox.lifecycle", "ports.url"] },
    state: { profile: "ephemeral" }, bindings: {}, limits: { maxRunSeconds: 900, maxToolSeconds: 60, maxConcurrentRuns: 1, maxQueuedRuns: 8,
      maxRunsPerMinute: 10, maxEventsPerRun: 10000, maxOutputBytes: 8388608 } };
}
function external(): Record<string, any> {
  const app = application();
  app.runtime = { placement: "external", driver: "python-remote-tools" }; app.gateway = { placement: "fc-web" };
  app.deployment = { adapter: "serverless-devs-fc3", accessRef: "deploy-access", project: "s.yaml", toolchainLock: "toolchain.json" };
  app.state = { profile: "durable", bindingRef: "run-store" }; app.bindings = { "run-store": "database" };
  app.sandbox.requiredFeatures = ["sandbox.lifecycle", "exec.run", "files.rw"];
  return app;
}
const hook = (id = "check"): Record<string, unknown> => ({ id, executor: "host-command", argv: ["node", "check.mjs"], cwd: ".", timeoutSeconds: 10, envAllowlist: [] });

describe("template contract version gate", () => {
  it("retains legacy/v2 domain validation and accepts plain v3", () => {
    expect(() => validateTemplateVersion({ name: "legacy", custom: true })).not.toThrow();
    expect(() => validateTemplateVersion({ spec_version: 2, name: "v2" })).not.toThrow();
    expect(() => validateTemplateVersion(template())).not.toThrow();
  });
  it.each([null, false, "3", 1, 4, 999])("rejects unsupported explicit version %s", version => {
    expect(() => validateTemplateVersion({ spec_version: version })).toThrow(/Unsupported/);
  });
  it("requires a version3 contract for application declarations", () => {
    for (const data of [{ application: application() }, { spec_version: 2, application: application() }]) expect(() => validateTemplateVersion(data)).toThrow(/requires spec_version/);
  });
  it("accepts both runtime modes without executing hooks", () => {
    expect(() => validateTemplateVersion({ ...template(), application: application() })).not.toThrow();
    const app = external(); app.hooks = { beforeApply: [hook()] };
    expect(() => validateTemplateVersion({ ...template(), application: app })).not.toThrow();
  });
  it("rejects unknown fields, invalid mode, budgets, bindings and feature omissions", () => {
    for (const mutate of [
      (app: Record<string, any>) => { app.unrecognized = true; },
      (app: Record<string, any>) => { app.runtime.driver = "sandbox-local-api"; },
      (app: Record<string, any>) => { app.limits.maxToolSeconds = 901; },
      (app: Record<string, any>) => { app.state.bindingRef = "missing"; },
      (app: Record<string, any>) => { app.sandbox.requiredFeatures = ["exec.run", "files.rw"]; },
      (app: Record<string, any>) => { app.hooks = { afterReady: [hook()], beforeApply: [hook()] }; },
    ]) {
      const app = external(); mutate(app);
      expect(() => validateTemplateVersion({ ...template(), application: app })).toThrow();
    }
  });
  it("checks referenced source and cwd types and symlink containment", () => {
    const root = fixture(), outside = fixture(), app = external();
    fs.writeFileSync(path.join(root, "s.yaml"), "edition: 3.0.0\n"); fs.writeFileSync(path.join(root, "toolchain.json"), "{}\n");
    app.hooks = { afterReady: [hook()] };
    expect(() => validateTemplateVersion({ ...template(), application: app }, root)).not.toThrow();
    app.hooks.afterReady[0].cwd = "s.yaml";
    expect(() => validateTemplateVersion({ ...template(), application: app }, root)).toThrow(/file type/);
    app.hooks.afterReady[0].cwd = "."; app.deployment.project = ".";
    expect(() => validateTemplateVersion({ ...template(), application: app }, root)).toThrow(/file type/);
    fs.writeFileSync(path.join(outside, "external.yaml"), "{}"); fs.symlinkSync(path.join(outside, "external.yaml"), path.join(root, "link.yaml"));
    app.deployment.project = "link.yaml";
    expect(() => validateTemplateVersion({ ...template(), application: app }, root)).toThrow(/escapes/);
    app.deployment.project = "missing.yaml";
    expect(() => validateTemplateVersion({ ...template(), application: app }, root)).toThrow(/unavailable/);
  });
  it("strictly reads YAML, rejecting duplicates, aliases and oversized files", () => {
    const root = fixture(), file = path.join(root, "template.yaml");
    fs.writeFileSync(file, stringify(template())); expect(readTemplateContract(file).spec_version).toBe(3);
    fs.appendFileSync(file, "spec_version: 4\n"); expect(() => readTemplateContract(file)).toThrow(/Invalid template YAML/);
    fs.writeFileSync(file, stringify(template()) + "unused: &x {}\nalias: *x\n"); expect(() => readTemplateContract(file)).toThrow(/aliases/);
    fs.writeFileSync(file, "x".repeat(1024 * 1024 + 1)); expect(() => readTemplateContract(file)).toThrow(/1 MiB/);
  });
});
