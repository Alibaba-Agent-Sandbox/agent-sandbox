import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { stringify } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationError, readTemplate, serverlessProject, toolDigest } from "../../src/application/config.js";
import { applyApplication, destroyApplication, invokeServerless, normalizeInfo, planApplication, planDestroy, readReceipt, reconcileApplication, verifyPlan, verifyTools, writeJson, type ApplicationServices } from "../../src/application/service.js";
import { execute, runHook } from "../../src/application/process.js";
import type { ApplicationTemplate, ApplicationPlan, ServerlessProject } from "../../src/application/types.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture(external = false): { root: string; file: string; template: ApplicationTemplate } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "abx-application-test-")); roots.push(root);
  const template = {
    name: "review-agent", version: "0.1.0", description: "Application regression fixture", author: "agent-sandbox", license: "Apache-2.0", spec_version: 3,
    base: "example.invalid/base@sha256:" + "0".repeat(64), generation: 2,
    start_cmd: "agent-sandbox-server serve --port 9000", ready_cmd: "agent-sandbox-server healthcheck --port 9000",
    resources: { cpu: 2, memory: 2048 }, ports: [9000], tags: ["agent"], priority: "P0", wave: "other", tested_on: [], capabilities: ["shell", "files", "ports"], env: {},
    smoke: [{ command: "hello", args: {}, expect: "hello" }],
    application: {
      runtime: { placement: "in-sandbox", driver: "sandbox-local-api", profile: "server-core-agents" }, gateway: { placement: "client-direct" },
      deployment: { adapter: "none" }, sandbox: { provider: "alicloud-express", lifetime: "per-run", workspace: "exclusive", requiredFeatures: ["sandbox.lifecycle", "ports.url"] },
      state: { profile: "ephemeral" }, bindings: {},
      limits: { maxRunSeconds: 900, maxToolSeconds: 60, maxConcurrentRuns: 4, maxQueuedRuns: 32, maxRunsPerMinute: 60, maxEventsPerRun: 1000, maxOutputBytes: 65536 },
    },
  } as unknown as ApplicationTemplate;
  if (external) {
    const app = template.application;
    app.runtime = { placement: "external", driver: "python-remote-tools" }; app.gateway = { placement: "fc-web" };
    app.state = { profile: "durable", bindingRef: "state-store" }; app.bindings = { "state-store": "application-postgres" };
    app.sandbox.requiredFeatures = ["sandbox.lifecycle", "exec.run", "files.rw"];
    const project: ServerlessProject = { edition: "3.0.0", name: "review-agent", resources: {} };
    for (const name of ["gateway", "worker", "dispatcher"]) project.resources[name] = {
      component: "fc3@1.0.0", props: { region: "cn-hangzhou", functionName: `review-agent-${name}`, runtime: "custom-container", customContainerConfig: { image: "example.invalid/runtime@sha256:" + "0".repeat(64), port: 9000 } },
    };
    fs.mkdirSync(path.join(root, "tools", "s"), { recursive: true }); fs.mkdirSync(path.join(root, "tools", "fc3"));
    fs.writeFileSync(path.join(root, "tools/s/package.json"), JSON.stringify({ version: "3.0.0", main: "s.mjs" }));
    fs.writeFileSync(path.join(root, "tools/s/s.mjs"), "process.stdout.write('{}')");
    fs.writeFileSync(path.join(root, "tools/fc3/package.json"), JSON.stringify({ version: "1.0.0", main: "index.js" })); fs.writeFileSync(path.join(root, "tools/fc3/index.js"), "module.exports = {};");
    fs.writeFileSync(path.join(root, "toolchain.lock.json"), JSON.stringify({ schemaVersion: 1,
      node: { sha256: createHash("sha256").update(fs.readFileSync(process.execPath)).digest("hex") },
      serverlessDevs: { directory: path.join(root, "tools/s"), executable: path.join(root, "tools/s/s.mjs"), version: "3.0.0", sha256: toolDigest(path.join(root, "tools/s")) },
      fc3: { directory: path.join(root, "tools/fc3"), version: "1.0.0", sha256: toolDigest(path.join(root, "tools/fc3")) },
    }));
    app.deployment = { adapter: "serverless-devs-fc3", inline: project, toolchainLock: "toolchain.lock.json", accessRef: "test-access" };
  }
  const file = path.join(root, "template.yaml"); fs.writeFileSync(file, stringify(template)); return { root, file, template };
}
function cloudBody(name: string, project: ServerlessProject): Record<string, unknown> {
  const resource = project.resources[name].props;
  return { region: resource.region, functionName: resource.functionName, functionArn: `acs:fc:cn-hangzhou:123456789:functions/${resource.functionName}`,
    functionId: `id-${name}`, createdTime: "2026-10-20T00:00:00Z", state: "Active", lastUpdateStatus: "Successful",
    customContainerConfig: { resolvedImageUri: (resource.customContainerConfig as { image: string }).image },
    environmentVariables: { ...(resource.environmentVariables as Record<string, string> ?? {}), PRIVATE_SECRET: "must-not-persist" },
    ...(name === "gateway" ? { url: { system_url: "https://gateway.example.invalid" } } : {}) };
}
function services(): ApplicationServices & { deployed: boolean; templatePresent: boolean; calls: string[]; failSmoke: boolean } {
  const state = {
    deployed: false, templatePresent: false, calls: [] as string[], failSmoke: false,
    async prepare() { this.calls.push("prepare"); this.templatePresent = true; return { provider: "alicloud-express", reference: "owned-template", ownership: "created" as const }; },
    async deleteTemplate() { this.calls.push("delete-template"); this.templatePresent = false; },
    async templateExists() { return this.templatePresent; },
    async invoke(_plan: ApplicationPlan, project: ServerlessProject, operation: string) {
      this.calls.push(operation);
      if (operation === "deploy") this.deployed = true;
      if (operation === "remove") this.deployed = false;
      return Object.fromEntries(Object.keys(project.resources).map(name => [name, cloudBody(name, project)]));
    },
    async describe(_plan: ApplicationPlan, project: ServerlessProject) {
      return { accountId: "123456789", functions: Object.fromEntries(Object.keys(project.resources).map(name => [name, this.deployed ? cloudBody(name, project) : null])) };
    },
    async reserve(_plan: ApplicationPlan, project: ServerlessProject, onCreated: (name: string, body: Record<string, unknown>) => void) {
      this.calls.push("reserve"); this.deployed = true;
      for (const name of Object.keys(project.resources)) onCreated(name, cloudBody(name, project));
    },
    async smoke() { this.calls.push("smoke"); if (this.failSmoke) throw new Error("unready"); },
  };
  return state;
}
describe("template application deployment", () => {
  it("plans offline and detects stale files, edits, expired and forged plans", () => {
    const { root, file } = fixture(); const plan = planApplication(file);
    expect(fs.existsSync(path.join(root, ".abx"))).toBe(false); verifyPlan(plan);
    expect(() => verifyPlan({ ...plan, sourceDigest: "forged" })).toThrow(/checksum/);
    expect(() => verifyPlan(planApplication(file, new Date(0)))).toThrow(/expired/);
    fs.writeFileSync(path.join(root, "code.py"), "changed"); expect(() => verifyPlan(plan)).toThrow(/changed/);
  });
  it("rejects ambiguous YAML, unknown fields and incompatible placement", () => {
    const { file, template } = fixture(); fs.appendFileSync(file, "name: duplicate\n"); expect(() => readTemplate(file)).toThrow(/Invalid YAML/);
    fs.writeFileSync(file, stringify({ ...template, implicitDeploy: true })); expect(() => readTemplate(file)).toThrow(/Invalid template/);
    template.application.runtime.placement = "external"; fs.writeFileSync(file, stringify(template)); expect(() => readTemplate(file)).toThrow(/Invalid template/);
  });
  it("rejects external source symlinks", () => {
    const { root, file } = fixture(); fs.symlinkSync(process.execPath, path.join(root, "external")); expect(() => planApplication(file)).toThrow(/Symlink/);
  });
  it("rejects symlinked generated state before writing or starting cloud operations", async () => {
    const { root, file } = fixture(), plan = planApplication(file), outside = fs.mkdtempSync(path.join(os.tmpdir(), "abx-outside-")); roots.push(outside);
    fs.symlinkSync(outside, path.join(root, ".abx"));
    expect(() => writeJson(path.join(root, ".abx/app/plan.json"), plan)).toThrow(/symlinks/);
    const adapter = services(); await expect(applyApplication(plan, adapter)).rejects.toThrow(/symlinks/);
    expect(adapter.calls).toEqual([]); expect(fs.readdirSync(outside)).toEqual([]);
  });
  it("rejects nested registry secrets and credential-bearing runtime DSNs before writing a plan", () => {
    const { file, template } = fixture(true);
    template.application.deployment.inline!.resources.gateway.props.customContainerConfig = { image: "example.invalid/runtime@sha256:" + "0".repeat(64), registryConfig: { authConfig: { password: "private-value" } } };
    fs.writeFileSync(file, stringify(template)); expect(() => planApplication(file)).toThrow(/Credential literals/);
    template.application.deployment.inline!.resources.gateway.props.customContainerConfig = { image: "example.invalid/runtime@sha256:" + "0".repeat(64) };
    template.application.deployment.inline!.resources.gateway.props.environmentVariables = { ABX_APP_DATABASE_URL: "postgresql://account:private-value@db.example.invalid/app" };
    fs.writeFileSync(file, stringify(template)); expect(() => planApplication(file)).toThrow(/URLs\/DSNs/);
  });
  it("applies direct B once and deletes only its prepared template", async () => {
    const { file } = fixture(), plan = planApplication(file), adapter = services();
    const receipt = await applyApplication(plan, adapter); expect(receipt.status).toBe("ready");
    await applyApplication(plan, adapter); expect(adapter.calls).toEqual(["prepare"]);
    const saved = path.join(plan.projectRoot, ".abx/app", plan.id, "receipt.json");
    const destroyed = await destroyApplication(planDestroy(saved), adapter); expect(destroyed.status).toBe("destroyed"); expect(adapter.calls).toEqual(["prepare", "delete-template"]);
  });
  it("destroys the frozen owned deployment after normal source/template edits", async () => {
    const { root, file } = fixture(), plan = planApplication(file), adapter = services(); await applyApplication(plan, adapter);
    const saved = path.join(root, ".abx/app", plan.id, "receipt.json");
    fs.writeFileSync(path.join(root, "agent.py"), "new revision"); fs.writeFileSync(file, "not the deployed template\n");
    expect((await destroyApplication(planDestroy(saved), adapter)).status).toBe("destroyed");
    expect(adapter.calls).toEqual(["prepare", "delete-template"]);
  });
  it("freezes tool bundles and validates pinned images/actions/expressions", () => {
    const { root, file, template } = fixture(true), plan = planApplication(file); verifyTools(plan);
    fs.appendFileSync(path.join(root, "tools/fc3/index.js"), "// changed"); expect(() => verifyTools(plan)).toThrow(/bundle/);
    template.application.deployment.inline!.resources.gateway.props.customContainerConfig = { image: "example.invalid/runtime:latest" };
    expect(() => serverlessProject(template, root)).toThrow(/digest/);
    template.application.deployment.inline!.resources.gateway.actions = { "pre-deploy": [] };
    expect(() => serverlessProject(template, root)).toThrow(/actions/);
    template.application.deployment.inline!.name = "${env.DYNAMIC}"; expect(() => serverlessProject(template, root)).toThrow(/structure|Dynamic/);
  });
  it("rejects unknown or sensitive toolchain lock fields before plan persistence", () => {
    const { root, file } = fixture(true), lockFile = path.join(root, "toolchain.lock.json");
    const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
    fs.writeFileSync(lockFile, JSON.stringify({ ...lock, credentials: { password: "private-value" } }));
    expect(() => planApplication(file)).toThrow(/Credential literals/);
    fs.writeFileSync(lockFile, JSON.stringify({ ...lock, unreviewed: "extra" })); expect(() => planApplication(file)).toThrow(/unknown fields/);
  });
  it("uses fresh s workspace/home and strips ambient execution/plugin overrides", async () => {
    const { root, file } = fixture(true), executable = path.join(root, "tools/s/s.mjs"), lockFile = path.join(root, "toolchain.lock.json");
    fs.writeFileSync(executable, "process.stdout.write(JSON.stringify({cwd:process.cwd(),home:process.env.serverless_devs_config_home,nodeOptions:process.env.NODE_OPTIONS,remote:process.env.ALIYUN_DEVS_REMOTE_PROJECT_NAME,component:process.env.core_load_serverless_devs_component}))");
    const lock = JSON.parse(fs.readFileSync(lockFile, "utf8")); lock.serverlessDevs.sha256 = toolDigest(path.join(root, "tools/s")); fs.writeFileSync(lockFile, JSON.stringify(lock));
    const plan = planApplication(file);
    const output = await invokeServerless(plan, plan.serverless!, "info", { NODE_OPTIONS: "--unreviewed", serverless_devs_config_home: "/unreviewed", ALIYUN_DEVS_REMOTE_PROJECT_NAME: "unreviewed", core_load_serverless_devs_component: "unreviewed" }) as Record<string, string>;
    expect(output.nodeOptions).toBeUndefined(); expect(output.remote).toBeUndefined(); expect(output.component).toBeUndefined();
    expect(output.home).not.toBe("/unreviewed"); expect(fs.existsSync(output.home)).toBe(false); expect(fs.existsSync(output.cwd)).toBe(false);
  });
  it("never overwrites a pre-existing function or starts provider preparation", async () => {
    const { file } = fixture(true), plan = planApplication(file), adapter = services(); adapter.deployed = true;
    await expect(applyApplication(plan, adapter)).rejects.toThrow(/already exists/); expect(adapter.calls).toEqual([]);
  });
  it("publishes only verified identities; raw info secrets never enter a receipt", async () => {
    const { file } = fixture(true), plan = planApplication(file), adapter = services();
    const receipt = await applyApplication(plan, adapter); expect(receipt.status).toBe("ready"); expect(receipt.resources).toHaveLength(3);
    expect(JSON.stringify(receipt)).not.toContain("must-not-persist"); expect(adapter.calls).toEqual(["prepare", "reserve", "deploy", "info", "smoke"]);
    await applyApplication(plan, adapter); expect(adapter.calls.filter(x => x === "deploy")).toHaveLength(1);
    const saved = path.join(plan.projectRoot, ".abx/app", plan.id, "receipt.json"); await destroyApplication(planDestroy(saved), adapter);
    expect(readReceipt(saved).status).toBe("destroyed");
  });
  it("saves uncertain outcomes and reconciles without replaying deployment", async () => {
    const { file } = fixture(true), plan = planApplication(file), adapter = services(); adapter.failSmoke = true;
    await expect(applyApplication(plan, adapter)).rejects.toThrow(/reconciliation/);
    const saved = path.join(plan.projectRoot, ".abx/app", plan.id, "receipt.json"); expect(readReceipt(saved).status).toBe("requires_reconcile");
    await expect(applyApplication(plan, adapter)).rejects.toThrow(/reconcile/); adapter.failSmoke = false;
    expect((await reconcileApplication(saved, adapter)).status).toBe("ready"); expect(adapter.calls.filter(x => x === "deploy")).toHaveLength(1);
  });
  it("rejects stale/replaced native identity during destruction", async () => {
    const { file } = fixture(true), plan = planApplication(file), adapter = services(); await applyApplication(plan, adapter);
    const saved = path.join(plan.projectRoot, ".abx/app", plan.id, "receipt.json"), destroy = planDestroy(saved);
    const describe = adapter.describe.bind(adapter);
    adapter.describe = async (p, project) => { const state = await describe(p, project); state.functions.gateway!.functionId = "replacement"; return state; };
    await expect(destroyApplication(destroy, adapter)).rejects.toThrow(/identity changed/); expect(adapter.calls).not.toContain("remove");
  });
  it("does not adopt a replacement while reconciling an existing owned receipt", async () => {
    const { file } = fixture(true), plan = planApplication(file), adapter = services(); await applyApplication(plan, adapter);
    const saved = path.join(plan.projectRoot, ".abx/app", plan.id, "receipt.json"), before = readReceipt(saved).resources;
    const original = adapter.describe.bind(adapter);
    adapter.describe = async (p, project) => { const state = await original(p, project); state.functions.gateway!.functionId = "foreign-incarnation"; return state; };
    await expect(reconcileApplication(saved, adapter)).rejects.toThrow(/cannot adopt a replacement/);
    expect(readReceipt(saved).resources).toEqual(before);
  });
  it("cleans only recorded partial creations after an atomic create race", async () => {
    const { file } = fixture(true), plan = planApplication(file), adapter = services();
    let observedProject: ServerlessProject;
    let gatewayExists = false;
    adapter.reserve = async (_p, project, record) => { observedProject = project; gatewayExists = true; record("gateway", cloudBody("gateway", project)); throw new ApplicationError("Function already exists; refused overwrite"); };
    adapter.describe = async (_p, project) => ({ accountId: "123456789", functions: Object.fromEntries(Object.keys(project.resources).map(name => [name,
      name === "gateway" ? gatewayExists ? cloudBody(name, observedProject) : null : name === "worker" && observedProject ? { ...cloudBody(name, observedProject), functionId: "foreign-worker", environmentVariables: {} } : null])) });
    adapter.invoke = async (_p, project, operation) => { if (operation === "remove") { expect(Object.keys(project.resources)).toEqual(["gateway"]); gatewayExists = false; } return null; };
    await expect(applyApplication(plan, adapter)).rejects.toThrow(/reconciliation/);
    const saved = path.join(plan.projectRoot, ".abx/app", plan.id, "receipt.json"); expect(readReceipt(saved).resources.map(resource => resource.logicalName)).toEqual(["gateway"]);
    expect((await destroyApplication(planDestroy(saved), adapter)).status).toBe("destroyed");
  });
  it("does not call ready on an old image or in-progress update", () => {
    const { template } = fixture(true), project = template.application.deployment.inline!;
    const data = Object.fromEntries(Object.keys(project.resources).map(name => [name, cloudBody(name, project)]));
    data.gateway.lastUpdateStatus = "InProgress"; expect(() => normalizeInfo(data, project)).toThrow(/not Active/);
    data.gateway.lastUpdateStatus = "Successful"; (data.gateway.customContainerConfig as Record<string, unknown>).resolvedImageUri = "wrong"; expect(() => normalizeInfo(data, project)).toThrow(/planned image/);
  });
  it("checks plan drift again after beforeApply, before any cloud side effect", async () => {
    const { root, file, template } = fixture(true);
    fs.writeFileSync(path.join(root, "validate.mjs"), `import fs from 'node:fs'; const c=JSON.parse(fs.readFileSync(process.env.ABX_HOOK_CONTEXT_FILE)); fs.writeFileSync('changed.txt','changed'); fs.writeFileSync(process.env.ABX_HOOK_RESULT_FILE,JSON.stringify({schemaVersion:1,hookId:c.hookId,operationId:c.operationId,status:'passed',message:'ok'}));`);
    template.application.hooks = { beforeApply: [{ id: "validate", executor: "host-command", argv: [process.execPath, "validate.mjs"], cwd: ".", timeoutSeconds: 5, envAllowlist: [] }] };
    fs.writeFileSync(file, stringify(template)); const plan = planApplication(file), adapter = services();
    await expect(applyApplication(plan, adapter)).rejects.toThrow(/changed/); expect(adapter.calls).toEqual([]);
  });
});
describe("bounded hooks and subprocesses", () => {
  it("executes actual hook file protocol with observations and never trusts stdout", async () => {
    const { root, file } = fixture(); const plan = planApplication(file);
    const hook = { id: "validate", executor: "host-command" as const, argv: [process.execPath, "-e", `const f=require('node:fs');const c=JSON.parse(f.readFileSync(process.env.ABX_HOOK_CONTEXT_FILE));f.writeFileSync(process.env.ABX_HOOK_RESULT_FILE,JSON.stringify({schemaVersion:1,hookId:c.hookId,operationId:c.operationId,status:'passed',message:'ok',observations:{verified:true}}));`], cwd: ".", timeoutSeconds: 5, envAllowlist: [] };
    await runHook(hook, "beforeApply", plan, "op_real");
    await expect(runHook({ ...hook, argv: [process.execPath, "-e", "console.log('passed')"] }, "beforeApply", plan, "op_real")).rejects.toThrow(/result file/);
    expect(fs.readdirSync(root)).toEqual(["template.yaml"]);
  });
  it("kills timed-out/output-excess processes and withholds raw output", async () => {
    const { root } = fixture();
    await expect(execute({ argv: [process.execPath, "-e", "setInterval(()=>{},1000)"], cwd: root, env: {}, timeoutSeconds: 0.05 })).rejects.toThrow(/deadline/);
    await expect(execute({ argv: [process.execPath, "-e", "console.log('x'.repeat(10000))"], cwd: root, env: {}, timeoutSeconds: 5, maxBytes: 100 })).rejects.toThrow(/output budget/);
    await expect(execute({ argv: [process.execPath, "-e", "console.error('private-value');process.exit(4)"], cwd: root, env: {}, timeoutSeconds: 5 })).rejects.not.toThrow(/private-value/);
  });
  it.skipIf(process.platform === "win32")("cleans same-group background descendants after successful parent exit", async () => {
    const { root } = fixture(), marker = path.join(root, "late.txt");
    await execute({ argv: [process.execPath, "-e", `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(`setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'late'),500)`)}],{stdio:'ignore'}).unref()`], cwd: root, env: {}, timeoutSeconds: 5 });
    await new Promise(resolve => setTimeout(resolve, 700)); expect(fs.existsSync(marker)).toBe(false);
  });
});
