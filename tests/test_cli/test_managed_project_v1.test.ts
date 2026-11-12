import "../_support/isolatedHome.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readManagedProject, readTemplate, sourceDigest, toolDigest, writeJson } from "../../src/application/config.js";
import { createPlan } from "../../src/application/service.js";
import { applicationServices, deploymentSeams } from "../../src/cli/commands/deploy.js";
import { snapshotTemplateSource } from "../../src/cli/template_build.js";
import type { BuildReceipt } from "../../src/application/types.js";

const folders: string[] = [];
function temporary(): string { const folder = fs.mkdtempSync(path.join(os.tmpdir(), "abx-managed-v1-")); folders.push(folder); return folder; }
afterEach(() => { vi.restoreAllMocks(); for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true }); });
const fixture = fileURLToPath(new URL("../fixtures/application-managed/template.yaml", import.meta.url));

function source() {
  const root = temporary(), file = path.join(root, "template.yaml");
  const raw = parse(fs.readFileSync(fixture, "utf8"));
  raw.application.state.databaseUrl = "${env('ABX_TEST_PRIVATE_DB')}";
  raw.application.bindings.model.apiKey = "${env('ABX_TEST_PRIVATE_MODEL')}";
  raw.application.bindings.sandboxAccess.apiKey = "${env('ABX_TEST_PRIVATE_SANDBOX')}";
  raw.sandbox.instance = {timeout: 3600, envs: {BUSINESS_VALUE: "${env('ABX_TEST_PRIVATE_ROLE')}"}, metadata: {business: "${env('ABX_TEST_PRIVATE_ROLE')}"}};
  const worker = raw.deployment.resources[raw.application.roles.worker].props;
  worker.memorySize = "${json(env('ABX_TEST_PRIVATE_MEMORY', '4096'))}";
  worker.environmentVariables = { CUSTOM_VALUE: "${env('ABX_TEST_PRIVATE_ROLE')}" };
  fs.writeFileSync(file, stringify(raw));
  fs.writeFileSync(path.join(root, "Dockerfile"), "FROM scratch\n");
  fs.writeFileSync(path.join(root, ".env"), [
    "ABX_TEST_PRIVATE_DB=postgresql://private:db-private-password@database.test/agents",
    "ABX_TEST_PRIVATE_MODEL=model-private-v1", "ABX_TEST_PRIVATE_SANDBOX=sandbox-private-v1",
    "ABX_TEST_PRIVATE_ROLE=role-private-v1", "",
  ].join("\n"));
  return { root, file, raw };
}

function planFor(original: ReturnType<typeof source>) {
  const container = temporary(), snapshot = path.join(container, "source");
  snapshotTemplateSource(original.root, snapshot);
  const tools = temporary(), loader = path.join(tools, "loader"), component = path.join(tools, "component");
  fs.mkdirSync(loader); fs.mkdirSync(component);
  const buildFile = path.join(snapshot, ".abx/build.json"), file = path.join(snapshot, "template.yaml");
  const receipt: BuildReceipt = { schemaVersion: 1, kind: "ManagedApplicationBuild", sourceDigest: sourceDigest(snapshot), image: "registry.example.test/agents@sha256:" + "a".repeat(64), createdAt: new Date().toISOString(), configurationSource: original.root,
    toolchain: { schemaVersion: 1, node: { path: process.execPath, version: process.version, sha256: createHash("sha256").update(fs.readFileSync(process.execPath)).digest("hex") },
      loader: { path: path.join(loader, "index.cjs"), directory: loader, version: "fixture", sha256: toolDigest(loader) }, component: { reference: "fc3@0.1.26", directory: component, sha256: toolDigest(component) } } };
  writeJson(buildFile, receipt);
  return { snapshot, file, plan: createPlan(file, buildFile) };
}

describe("managed v1 private configuration consumption", () => {
  it("accepts three custom native resource IDs referenced by application roles", () => {
    const value = source(), resources = value.raw.deployment.resources;
    value.raw.deployment.resources = { edge: resources.publicApi, task: resources.sessionWorker, timer: resources.scheduler };
    value.raw.application.roles = { gateway: "edge", worker: "task", dispatcher: "timer" };
    fs.writeFileSync(value.file, stringify(value.raw));
    const result = readManagedProject(value.file);
    expect(result.project.compiled.roleResources).toEqual({ gateway: "edge", worker: "task", dispatcher: "timer" });
    expect(Object.keys(result.roleProps).sort()).toEqual(["dispatcher", "gateway", "worker"]);
  });

  it.each(["productionDomain", "applicationVpc"])("rejects extra Managed native resource %s instead of silently skipping it", id => {
    const value = source();
    value.raw.deployment.resources[id] = id === "productionDomain"
      ? { component: "fc3-domain@0.0.29", props: { domainName: "agents.example.test" } }
      : { component: "vpc@0.0.1", props: { region: "cn-hangzhou" } };
    fs.writeFileSync(value.file, stringify(value.raw));
    expect(() => readManagedProject(value.file)).toThrow(`resources not referenced by application.roles are unsupported: ${id}`);
  });

  it("keeps dotenv out of snapshots/plans while actual services receive private bindings and native props", async () => {
    const original = source(), value = planFor(original);
    expect(fs.existsSync(path.join(value.snapshot, ".env"))).toBe(false);
    const encoded = JSON.stringify(value.plan);
    for (const secret of ["db-private-password", "model-private-v1", "sandbox-private-v1", "role-private-v1"]) expect(encoded).not.toContain(secret);
    expect(value.plan.template.nativeEnvironmentNames?.worker).toEqual(["CUSTOM_VALUE"]);
    expect(encoded).not.toContain("ABX_TEST_PRIVATE_ROLE");
    vi.spyOn(deploymentSeams, "credentials").mockResolvedValue({ AccountID: "123", AccessKeyID: "fixture", AccessKeySecret: "fixture" });
    const services = await applicationServices(value.plan, undefined, true);
    expect(services.binding.model.apiKey).toBe("model-private-v1");
    expect(services.binding.databaseUrl).toContain("db-private-password");
    expect(services.binding.provider.apiKey).toBe("sandbox-private-v1");
    expect(services.nativeRoleProps?.worker.memorySize).toBe(4096);
    expect(services.nativeRoleProps?.worker.environmentVariables).toEqual({ CUSTOM_VALUE: "role-private-v1" });
    expect(services.sandboxInstance?.envs).toEqual({BUSINESS_VALUE: "role-private-v1"});
    expect(services.sandboxInstance?.metadata).toEqual({business: "role-private-v1"});
    expect(process.env.ABX_TEST_PRIVATE_MODEL).toBeUndefined();
    expect(JSON.stringify(value.plan)).toBe(encoded);
  });

  it("rejects a changed resolved resource budget instead of silently applying a different plan", async () => {
    const original = source(), value = planFor(original);
    fs.appendFileSync(path.join(original.root, ".env"), "ABX_TEST_PRIVATE_MEMORY=2048\n");
    await expect(applicationServices(value.plan, undefined, true)).rejects.toThrow("resource budget");
  });

  it("returns a plan-safe template and keeps resolved role env only in private context", () => {
    const value = source(), resolved = readManagedProject(value.file);
    expect(JSON.stringify(resolved.template)).not.toContain("role-private-v1");
    expect(resolved.roleProps.worker.environmentVariables).toEqual({ CUSTOM_VALUE: "role-private-v1" });
    expect(readTemplate(value.file).nativeControls?.worker.memorySize).toBe(4096);
  });

  it.each(["vpcConfig", "nasConfig", "ossMountConfig", "logConfig"])("rejects unowned Managed %s auto before resource effects", key => {
    const value = source(); value.raw.deployment.resources.sessionWorker.props[key] = "auto"; fs.writeFileSync(value.file, stringify(value.raw));
    expect(() => readTemplate(value.file)).toThrow("owned-resource cleanup");
  });

  it.each(["environment", "metadata", "lifecycle", "workspace-volume", "state-volume"])("rejects unsupported Managed %s before cloud or configuration effects", kind => {
    const value = source(), instance = value.raw.sandbox.instance;
    if (kind === "environment") instance.envs = {OPENAI_API_KEY: "private"};
    if (kind === "metadata") instance.metadata = {"abx-managed": "replacement"};
    if (kind === "lifecycle") instance.lifecycle = {onTimeout: "pause"};
    if (kind === "workspace-volume") instance.volume_mounts = {"/workspace/data": "existing"};
    if (kind === "state-volume") instance.volume_mounts = {"/home/user": "existing"};
    fs.writeFileSync(value.file, stringify(value.raw)); expect(() => readManagedProject(value.file)).toThrow("Managed");
  });
});
