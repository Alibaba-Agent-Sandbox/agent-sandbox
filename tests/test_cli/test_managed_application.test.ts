import "../_support/isolatedHome.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { rootCertificates } from "node:tls";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import schemaSource from "../../src/application/schema-source.json" with { type: "json" };
import { digest, readTemplate, sourceDigest, toolDigest, writeJson } from "../../src/application/config.js";
import { bootstrapEnvironment, businessTokenDigest, resolveBindings, stateConnectionIdentity, type ResolvedBindings } from "../../src/application/bindings.js";
import { applyPlan, createDestroyPlan, createPlan, destroyPlan, observeReceipt, readPlan, readReceipt, retireRevision, withApplicationLock, type ApplicationServices } from "../../src/application/service.js";
import { createFcTransport, signInvocation, type FcTransport } from "../../src/application/fc.js";
import { execute } from "../../src/application/process.js";
import { buildApplication, cleanBuild } from "../../src/application/tools.js";
import { createRegistryClient, type RegistryClient } from "../../src/providers/alicloud_express/application/registry.js";
import { runPreparation } from "../../src/providers/alicloud_express/application/preparation_runner.js";
import { CLI_EXTENSION } from "../../src/providers/alicloud_express/cli/extension.js";
import { paths, _setPaths } from "../../src/transport/config_layers.js";
import type { ApplicationPlan, BuildReceipt } from "../../src/application/types.js";

const temporary: string[] = [];
const scratch = (): string => { const folder = fs.mkdtempSync(path.join(os.tmpdir(), "abx-managed-test-")); temporary.push(folder); return folder; };
afterEach(() => { vi.restoreAllMocks(); for (const folder of temporary.splice(0)) fs.rmSync(folder, { recursive: true, force: true }); });
const templateFixture = fileURLToPath(new URL("../fixtures/application-managed/template.yaml", import.meta.url));
function fixture(source = templateFixture) {
  const directory = scratch(), file = path.join(directory, "template.yaml"), tools = scratch(); fs.copyFileSync(templateFixture, file);
  if (source !== templateFixture) {
    const recipe = readTemplate(source).application.deployment.serverBuildRecipe;
    fs.copyFileSync(source, file);
    if (recipe) { const target = path.join(directory, recipe.dockerfile); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(path.dirname(source), recipe.dockerfile), target); }
  }
  fs.mkdirSync(path.join(tools, "loader")); fs.mkdirSync(path.join(tools, "component"));
  const template = readTemplate(file), buildFile = path.join(directory, ".abx", "build.json");
  const build: BuildReceipt = { schemaVersion: 1, kind: "ManagedApplicationBuild", sourceDigest: sourceDigest(directory), image: template.application.deployment.serverImage ?? "registry.example.test/agents@sha256:" + "a".repeat(64), createdAt: new Date().toISOString(), toolchain: {
    schemaVersion: 1, node: { path: process.execPath, version: process.version, sha256: createHash("sha256").update(fs.readFileSync(process.execPath)).digest("hex") },
    loader: { path: path.join(tools, "loader", "index.cjs"), version: "fixture", directory: path.join(tools, "loader"), sha256: toolDigest(path.join(tools, "loader")) },
    component: { reference: "fc3@0.1.26", directory: path.join(tools, "component"), sha256: toolDigest(path.join(tools, "component")) } } };
  writeJson(buildFile, build); const plan = createPlan(file, buildFile), receiptFile = path.join(directory, ".abx", "receipt.json");
  return { directory, file, tools, template, buildFile, plan, receiptFile };
}
function binding(): ResolvedBindings {
  return { databaseUrl: "postgresql://private:private@database.test/agents", auth: { tokens: [{ sha256: "b".repeat(64), owner: "business", scopes: ["agents:read", "agents:write"] }] },
    model: { apiKey: "private-model-key", baseUrl: "https://model.test/v1", model: "qwen3.5-plus", adapter: "qwen-code" },
    provider: { provider: "alicloud-express", apiKey: "private-sandbox-key", baseUrl: "https://api.cn-hangzhou.e2b.fc.aliyuncs.com", domain: "cn-hangzhou.e2b.fc.aliyuncs.com", region: "cn-hangzhou" },
    internal: { token: "internal-random-secret-".repeat(3), roleArn: "acs:ram::123:role/managed-agents" }, ingress: { kind: "function-alias", aliasName: "prod", allowTestDomain: true } };
}
function services(plan: ApplicationPlan) {
  const native = new Map<string, Record<string, unknown>>(), aliases = new Map<string, string>(), triggers = new Map<string, string>(), versions = new Set<string>(), calls: string[] = [];
  let counter = 0;
  const fc: FcTransport = {
    accountId: "123",
    async describeFunction(name) { return native.get(name) ?? null; },
    async createFunction(props) { calls.push(`create:${String(props.functionName)}`); const value = { ...props, functionArn: `acs:fc:cn-hangzhou:123:functions/${String(props.functionName)}`, functionId: `native-${++counter}`, createdTime: new Date().toISOString(), state: "Active", lastUpdateStatus: "Successful", customContainerConfig: { ...(props.customContainerConfig as Record<string, unknown>), resolvedImageUri: plan.image } }; native.set(String(props.functionName), value); return value; },
    async describeAlias(name, alias) { return aliases.get(`${name}/${alias}`) ?? null; },
    async setAlias(name, alias, version, expected) { expect(aliases.get(`${name}/${alias}`) ?? null).toBe(expected); aliases.set(`${name}/${alias}`, version); calls.push(`alias:${version}`); },
    async publishVersion() { const version = String(++counter); versions.add(version); return version; },
    async createHttpTrigger(name, trigger, qualifier) { const endpoint = `https://${trigger}.example.test`; triggers.set(`${name}/${trigger}/${qualifier}`, endpoint); calls.push(`trigger:${trigger}`); return endpoint; },
    async describeHttpTrigger(name, trigger, qualifier) { return triggers.get(`${name}/${trigger}/${qualifier}`) ?? null; },
    async deleteTrigger(name, trigger) { calls.push(`delete-trigger:${trigger}`); for (const key of triggers.keys()) if (key.startsWith(`${name}/${trigger}/`)) triggers.delete(key); },
    async deleteAlias(name, alias) { aliases.delete(`${name}/${alias}`); },
    async configureWorker(name) { calls.push(`async:${name}`); },
    async configureTimer(name, _token, enabled) { calls.push(`timer:${name}:${enabled}`); },
    async invokeControl(_name, envelope) { calls.push("control"); expect(envelope.signature).toBe(signInvocation("dispatcher", envelope.payload as Record<string, unknown>, deps.binding.internal.token).signature); return { activeSessions: 0, pendingCleanup: 0, uncertainResources: 0, draining: (envelope.payload as Record<string, unknown>).operation === "drain", stateInstanceId: "1".repeat(32) }; },
    async deleteFunction(name) { calls.push(`delete:${name}`); native.delete(name); },
    async deleteVersion(_name, version) { calls.push(`delete-version:${version}`); versions.delete(version); },
    async hasVersion(_name, version) { return versions.has(version); },
    async publishDomain() { calls.push("domain"); },
  };
  const deps: ApplicationServices = { fc, credential: { AccountID: "123", AccessKeyID: "test", AccessKeySecret: "test" }, binding: binding(),
    async prepare(frozen, progress) { const sandbox = { provider: "alicloud-express", reference: `template-${frozen.revision}`, journalId: "owned-journal", resources: [{ kind: "template", id: `template-${frozen.revision}`, state: "created", cleanup: "template.delete", intent_id: "intent-1" }] }; progress(sandbox); return sandbox; },
    async deploy(frozen, _role, props) { const name = String(props.functionName); native.set(name, { ...native.get(name), ...props, state: "Active", lastUpdateStatus: "Successful", customContainerConfig: { ...(props.customContainerConfig as Record<string, unknown>), resolvedImageUri: frozen.image } }); },
    async deleteTemplate(value) { calls.push(`delete-template:${value.reference}`); },
    async probe(_endpoint, pathname) { return pathname === "/health" ? { status: 200, body: { revision: plan.revision } } : { status: 401, body: {} }; },
    async hooks() {},
  };
  return { deps, native, aliases, triggers, calls };
}
function sourceBindings(template: ReturnType<typeof readTemplate>, data: ResolvedBindings) {
  const source: Record<string, unknown> = {};
  for (const [key, value] of Object.entries({ state: data.databaseUrl, clientAuth: data.auth, model: data.model, sandboxAccess: data.provider, internalAuth: data.internal, ingress: data.ingress })) source[template.application.bindings[key].reference] = value;
  return source;
}
describe("managed application boundary", () => {
  it("reproduces the official stream serializer's rejection of string chunks in an isolated process", () => {
    const result = spawnSync(process.execPath, ["-e", "require('@darabonba/typescript').Stream.readAsBytes(require('node:stream').Readable.from(['{\"role\":\"dispatcher\"}']))"], { cwd: process.cwd(), encoding: "utf8", timeout: 5000 });
    expect(result.error).toBeUndefined(); expect(result.status).toBe(1); expect(result.stderr).toContain("ERR_INVALID_ARG_TYPE"); expect(result.stderr).toContain("Function.concat"); expect(result.stderr).toContain("Readable.onEnd");
  });
  it("serializes the signed UTF-8 control envelope through the real FC SDK before the network boundary", async () => {
    const require = createRequire(import.meta.url), dara = require("@darabonba/typescript"), core = require("@darabonba/typescript/dist/core") as { doAction(request: { protocol: string; pathname: string; method: string; query: Record<string, string>; headers: Record<string, string>; body: Readable }): Promise<unknown> };
    const envelope = signInvocation("dispatcher", { action: "status", marker: "证据🔒" }, binding().internal.token), expected = Buffer.from(JSON.stringify(envelope), "utf8");
    let outbound: Buffer | undefined;
    const network = vi.spyOn(core, "doAction").mockImplementation(async request => {
      expect(request.protocol).toBe("https"); expect(request.headers.host).toBe("fcv3.cn-hangzhou.aliyuncs.com");
      expect(request.pathname).toBe("/2023-03-30/functions/test-dispatcher/invocations"); expect(request.query.qualifier).toBe("LATEST");
      expect(request.method).toBe("POST"); expect(request.headers["x-fc-invocation-type"]).toBe("Sync"); expect(request.headers["x-fc-log-type"]).toBe("None");
      outbound = await dara.Stream.readAsBytes(request.body);
      expect(request.headers["x-acs-content-sha256"]).toBe(createHash("sha256").update(expected).digest("hex"));
      return new dara.Response(Object.assign(Readable.from([Buffer.from('{"activeSessions":0}', "utf8")]), { statusCode: 200, headers: {} }));
    });
    const fc = createFcTransport({ AccountID: "123", AccessKeyID: "test", AccessKeySecret: "test" }, "cn-hangzhou");
    await expect(fc.invokeControl("test-dispatcher", envelope)).resolves.toEqual({ activeSessions: 0 });
    expect(network).toHaveBeenCalledTimes(1); expect(outbound).toEqual(expected); expect(JSON.parse(outbound!.toString("utf8"))).toEqual(envelope);
  });
  it.each(["errorType", "ErrorType", "errorMessage", "ErrorMessage", "error", "Error"])("withholds native HTTP 200 error field %s through the official SDK", async key => {
    const require = createRequire(import.meta.url), dara = require("@darabonba/typescript"), core = require("@darabonba/typescript/dist/core") as { doAction(...args: unknown[]): Promise<unknown> };
    const raw = "test-native-output-must-stay-private";
    const network = vi.spyOn(core, "doAction").mockImplementation(async () => new dara.Response(Object.assign(Readable.from([Buffer.from(JSON.stringify({ [key]: raw }), "utf8")]), { statusCode: 200, headers: {} })));
    const fc = createFcTransport({ AccountID: "123", AccessKeyID: "test", AccessKeySecret: "test" }, "cn-hangzhou");
    await expect(fc.invokeControl("test-dispatcher", signInvocation("dispatcher", { operation: "status" }, binding().internal.token))).rejects.toMatchObject({ message: "Private invocation failed or returned an invalid bounded result." });
    expect(network).toHaveBeenCalledTimes(1);
  });
  it("freezes non-secret state routing while allowing password/TLS material changes", () => {
    expect(stateConnectionIdentity("postgresql://user:old@db.test/agents?sslmode=require")).toBe(stateConnectionIdentity("postgres://user:new@db.test:5432/agents?sslmode=verify-full&sslrootcert=%2Fca.pem"));
    for (const suffix of ["?host=other", "?options=-csearch_path%3Dother", "?dbname=other", "?unrecognized=value"]) expect(() => stateConnectionIdentity(`postgresql://user:private@db.test/agents${suffix}`)).toThrow(/overrides/);
  });
  it.each([true, undefined])("withholds candidates when the initial ledger admission is %s", async draining => {
    const value = fixture(), external = services(value.plan), operations: unknown[] = [];
    external.deps.fc.invokeControl = async (_name, envelope) => { operations.push(envelope.payload); return { stateInstanceId: "1".repeat(32), activeSessions: 0, pendingCleanup: 0, uncertainResources: 0, ...(draining === undefined ? {} : { draining }) }; };
    await expect(applyPlan(value.plan, external.deps, value.receiptFile)).rejects.toThrow(/new application name or a fresh state database/);
    expect(operations).toEqual([expect.objectContaining({ operation: "status" })]);
    expect(external.triggers.size).toBe(0); expect(external.aliases.size).toBe(0); expect(external.native.size).toBe(3);
    expect(readReceipt(value.receiptFile).status).toBe("requires_reconcile");
  });
  it("keeps the schema consumer pinned to immutable producer bytes", () => {
    const schema = fs.readFileSync(fileURLToPath(new URL("../../src/application/template-v6.schema.json", import.meta.url)));
    expect(createHash("sha256").update(schema).digest("hex")).toBe(schemaSource.sha256); expect(schemaSource.commit).toMatch(/^[a-f0-9]{40}$/);
  });
  it("freezes source and tool identity with a stable read-back plan digest", () => {
    const value = fixture(), file = path.join(value.directory, ".abx", "plan.json"); writeJson(file, value.plan); expect(readPlan(file).id).toBe(value.plan.id);
    const modified = { ...value.plan, image: "changed" }; fs.writeFileSync(file, JSON.stringify(modified)); expect(() => readPlan(file)).toThrow(/modified/);
    fs.writeFileSync(path.join(value.directory, "new.py"), "changed"); expect(() => createPlan(value.file, value.buildFile)).toThrow(/Source changed/);
  });
  it.each(["budget", "targets", "model-env"])("rejects producer semantic violations: %s", kind => {
    const value = fixture(); if (kind === "budget") value.template.application.sessions.idleTimeoutSeconds = 100000;
    if (kind === "targets") value.template.application.bindings.model.targets = ["gateway"];
    if (kind === "model-env") value.template.application.bindings.model.allowedEnv = ["ALICLOUD_ACCESS_KEY_SECRET"];
    fs.writeFileSync(value.file, stringify(value.template)); expect(() => readTemplate(value.file)).toThrow();
  });
  it("injects model secrets only into worker bootstrap and never into Gateway or Dispatcher", () => {
    const value = fixture(), input = binding();
    const gateway = bootstrapEnvironment(value.template.application, input, "gateway", {}), dispatcher = bootstrapEnvironment(value.template.application, input, "dispatcher", {}), worker = bootstrapEnvironment(value.template.application, input, "worker", {});
    expect(gateway.ABX_MANAGED_AUTH_JSON).toBeDefined(); expect(gateway.ABX_MANAGED_PROVIDER_CONFIG_JSON).toBeUndefined();
    expect(dispatcher.ABX_MANAGED_MODEL_CONFIG_JSON).toBeUndefined(); expect(dispatcher.ABX_MANAGED_AUTH_JSON).toBeUndefined();
    expect(worker.ABX_MANAGED_MODEL_CONFIG_JSON).toContain("private-model-key"); expect(JSON.stringify(gateway)).not.toContain("private-model-key");
  });
  it("generates and privately reuses application credentials only during explicit initial apply", () => {
    const value = fixture(), input = sourceBindings(value.template, binding()), file = path.join(value.directory, ".abx", "bindings.json"), store = scratch(); fs.mkdirSync(path.dirname(file), { recursive: true });
    input[value.template.application.bindings.clientAuth.reference] = { generate: true };
    input[value.template.application.bindings.internalAuth.reference] = { generate: true, roleArn: "acs:ram::123:role/managed-agents" };
    fs.writeFileSync(file, JSON.stringify(input), { mode: 0o600 });
    expect(() => resolveBindings(value.template.application, file)).toThrow(/explicit apply/);
    const scope = { applicationId: "agents-api", accountId: "123", region: "cn-hangzhou" }, first = resolveBindings(value.template.application, file, { scope, mode: "initial-apply", credentialDirectory: store });
    const next = resolveBindings(value.template.application, file, { scope, mode: "existing", credentialDirectory: store }); expect(next.internal.token).toBe(first.internal.token); expect(next.auth).toEqual(first.auth);
    expect(fs.statSync(first.credentialsFile!).mode & 0o077).toBe(0); expect(fs.readFileSync(file, "utf8")).not.toContain(first.internal.token);
    fs.rmSync(first.credentialsFile!); expect(() => resolveBindings(value.template.application, file, { scope, mode: "existing", credentialDirectory: store })).toThrow(/missing/);
  });
  it("rejects a public binding file and explicitly resolves nested env references", () => {
    const value = fixture(), input = sourceBindings(value.template, binding()), file = path.join(value.directory, "private.json");
    input[value.template.application.bindings.model.reference] = { ...binding().model, apiKey: { env: "ABX_MANAGED_UNIT_MODEL" } }; process.env.ABX_MANAGED_UNIT_MODEL = "test-env-model";
    try { fs.writeFileSync(file, JSON.stringify(input), { mode: 0o600 }); expect(resolveBindings(value.template.application, file).model.apiKey).toBe("test-env-model"); fs.chmodSync(file, 0o644); if (process.platform !== "win32") expect(() => resolveBindings(value.template.application, file)).toThrow(/private/); } finally { delete process.env.ABX_MANAGED_UNIT_MODEL; }
  });
  it("accepts only the closed native VPC fields in a state binding", () => {
    const value = fixture(), file = path.join(value.directory, "private.json"), input = sourceBindings(value.template, binding());
    const vpcConfig = { vpcId: "vpc-example", vSwitchIds: ["vsw-example"], securityGroupId: "sg-example" };
    input[value.template.application.bindings.state.reference] = { databaseUrl: binding().databaseUrl, vpcConfig };
    fs.writeFileSync(file, JSON.stringify(input), { mode: 0o600 }); expect(resolveBindings(value.template.application, file).vpcConfig).toEqual(vpcConfig);
    input[value.template.application.bindings.state.reference] = { databaseUrl: binding().databaseUrl, vpcConfig: { ...vpcConfig, role: "unexpected" } };
    fs.writeFileSync(file, JSON.stringify(input)); expect(() => resolveBindings(value.template.application, file)).toThrow(/vpcConfig/);
  });
  it("resolves a relative private CA source and keeps it only in Server bootstrap", () => {
    const value = fixture(), file = path.join(value.directory, "private.json"), input = sourceBindings(value.template, binding()), ca = rootCertificates[0];
    fs.writeFileSync(path.join(value.directory, "database-ca.pem"), ca); input[value.template.application.bindings.state.reference] = { databaseUrl: `${binding().databaseUrl}?sslmode=verify-full`, databaseCa: { file: "database-ca.pem" } };
    fs.writeFileSync(file, JSON.stringify(input), { mode: 0o600 }); const resolved = resolveBindings(value.template.application, file);
    expect(resolved.databaseCa).toContain("BEGIN CERTIFICATE");
    for (const role of ["gateway", "worker", "dispatcher"] as const) expect(bootstrapEnvironment(value.template.application, resolved, role, {}).ABX_MANAGED_DATABASE_CA_PEM).toBeUndefined();
    expect(JSON.stringify(value.plan)).not.toContain(ca);
  });
  it("rejects private keys and malformed certificate material in the state CA binding", () => {
    const value = fixture(), file = path.join(value.directory, "private.json"), input = sourceBindings(value.template, binding());
    for (const databaseCa of ["-----BEGIN PRIVATE KEY-----\ninvalid\n-----END PRIVATE KEY-----", "-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----"]) {
      input[value.template.application.bindings.state.reference] = { databaseUrl: binding().databaseUrl, databaseCa }; fs.writeFileSync(file, JSON.stringify(input), { mode: 0o600 }); expect(() => resolveBindings(value.template.application, file)).toThrow(/CA input/);
    }
  });
  it("serializes local deployments without claiming an FC CAS", async () => {
    const directory = scratch(); await withApplicationLock(directory, "one-app", async () => { await expect(withApplicationLock(directory, "one-app", async () => true)).rejects.toThrow(/locked/); });
    await expect(withApplicationLock(directory, "one-app", async () => true)).resolves.toBe(true);
  });
});
describe("managed application effects", () => {
  it("keeps public database CA in the verified command instead of the bounded environment", async () => {
    const value = fixture(), external = services(value.plan), chain = `${rootCertificates[0]}\n${rootCertificates[0]}\n${rootCertificates[0]}`; external.deps.binding.databaseCa = chain;
    await applyPlan(value.plan, external.deps, value.receiptFile);
    for (const [role, name] of Object.entries(value.plan.identities)) {
      const body = external.native.get(name)!, command = (body.customContainerConfig as Record<string, string[]>).command;
      expect(command.slice(0, 2)).toEqual([role, "--database-ca-base64"]); expect(command.length).toBeGreaterThan(3); expect(command.slice(2).every(part => part.length <= 1920 && part.length % 4 === 0)).toBe(true); expect(Buffer.from(command.slice(2).join(""), "base64").toString("ascii")).toBe(chain);
      expect((body.environmentVariables as Record<string, string>).ABX_MANAGED_DATABASE_CA_PEM).toBeUndefined();
    }
  });
  it("preflights future candidate authentication before any FC creation", async () => {
    const value = fixture(), external = services(value.plan);
    external.deps.binding.auth.tokens = Array.from({ length: 30 }, () => ({ sha256: "a".repeat(64), owner: "owner", scopes: ["agents:read", "agents:write"] }));
    await expect(applyPlan(value.plan, external.deps, value.receiptFile)).rejects.toThrow(/4 KiB/); expect(external.native.size).toBe(0);
  });
  it("keeps maximum-length names within the native 64-character function limit", () => {
    const value = fixture(); value.template.name = "a".repeat(63); fs.writeFileSync(value.file, stringify(value.template));
    const build = JSON.parse(fs.readFileSync(value.buildFile, "utf8")); build.sourceDigest = sourceDigest(value.directory); writeJson(value.buildFile, build);
    expect(Math.max(...Object.values(createPlan(value.file, value.buildFile).identities).map(name => name.length))).toBe(64);
  });
  it("waits for native creation before deploying and for updates before publication", async () => {
    const value = fixture(), external = services(value.plan), create = external.deps.fc.createFunction, read = external.deps.fc.describeFunction;
    let reads = 0, updates = 0;
    external.deps.fc.createFunction = async props => { const body = await create(props); body.state = "Pending"; return body; };
    external.deps.fc.describeFunction = async name => { const body = await read(name); if (body?.state === "Pending" && ++reads % 2 === 0) body.state = "Active"; if (body?.lastUpdateStatus === "InProgress" && ++updates % 2 === 0) body.lastUpdateStatus = "Successful"; return body; };
    const deploy = external.deps.deploy; external.deps.deploy = async (plan, role, props) => { expect(external.native.get(String(props.functionName))!.state).toBe("Active"); await deploy(plan, role, props); external.native.get(String(props.functionName))!.lastUpdateStatus = "InProgress"; };
    const publish = external.deps.fc.publishVersion; external.deps.fc.publishVersion = async (name, revision) => { expect(external.native.get(name)!.lastUpdateStatus).toBe("Successful"); return await publish(name, revision); };
    await applyPlan(value.plan, external.deps, value.receiptFile); expect(reads).toBeGreaterThanOrEqual(6); expect(updates).toBeGreaterThanOrEqual(16);
  });
  it("uses the owned random tag for FC while freezing and verifying its resolved digest", async () => {
    const value = fixture(); delete value.template.application.deployment.serverImage; value.template.application.deployment.serverBuildRecipe = { dockerfile: "Dockerfile.server", context: "." };
    fs.writeFileSync(value.file, stringify(value.template)); fs.writeFileSync(path.join(value.directory, "Dockerfile.server"), "FROM scratch\n");
    const build = JSON.parse(fs.readFileSync(value.buildFile, "utf8")), digest = `sha256:${"d".repeat(64)}`, repository = "registry.cn-hangzhou.aliyuncs.com/example/agents-api-server", localTag = `${repository}:build-test`;
    build.image = `${repository}@${digest}`; build.sourceDigest = sourceDigest(value.directory); build.ownedServerImage = { accountId: "123", region: "cn-hangzhou", namespace: "example", repository: "agents-api-server", tag: "build-test", localTag, localImageId: `sha256:${"c".repeat(64)}`, digest, state: "confirmed", journalId: "11111111-1111-1111-1111-111111111111", intentId: "test-intent" }; writeJson(value.buildFile, build);
    const plan = createPlan(value.file, value.buildFile), external = services(plan); await applyPlan(plan, external.deps, value.receiptFile);
    expect(readReceipt(value.receiptFile).plan.image).toBe(build.image);
    for (const body of external.native.values()) expect(body.customContainerConfig).toMatchObject({ image: localTag, resolvedImageUri: build.image });
  });
  it("bounds readiness polling without redeploying a pending creation", async () => {
    const value = fixture(), external = services(value.plan), create = external.deps.fc.createFunction, read = external.deps.fc.describeFunction; let deployments = 0;
    external.deps.fc.createFunction = async props => { const body = await create(props); body.state = "Pending"; return body; };
    external.deps.fc.describeFunction = async name => { const body = await read(name); if (body?.state === "Pending") vi.spyOn(Date, "now").mockReturnValue(Date.now() + 300001); return body; };
    external.deps.deploy = async () => { deployments++; };
    await expect(applyPlan(value.plan, external.deps, value.receiptFile)).rejects.toThrow(/bounded wait/); expect(deployments).toBe(0); expect(external.native.size).toBe(1);
  });
  it.each(["Failed", "unknown"])("retains native creation without deployment when state is %s", async state => {
    const value = fixture(), external = services(value.plan), create = external.deps.fc.createFunction; let deployments = 0;
    external.deps.fc.createFunction = async props => { const body = await create(props); body.state = state; return body; };
    external.deps.deploy = async () => { deployments++; };
    await expect(applyPlan(value.plan, external.deps, value.receiptFile)).rejects.toThrow(/FC.*(?:failed|unconfirmed)/); expect(deployments).toBe(0); expect(external.native.size).toBe(1); expect(external.aliases.size).toBe(0);
  });
  it.each(["resolvedImageUri", "command", "entrypoint"])("withholds publication when native %s differs", async field => {
    const value = fixture(), external = services(value.plan), deploy = external.deps.deploy;
    external.deps.deploy = async (plan, role, props) => { await deploy(plan, role, props); (external.native.get(String(props.functionName))!.customContainerConfig as Record<string, unknown>)[field] = field === "resolvedImageUri" ? `registry.example/server@sha256:${"f".repeat(64)}` : ["unexpected"]; };
    await expect(applyPlan(value.plan, external.deps, value.receiptFile)).rejects.toThrow(/frozen image/); expect(external.aliases.size).toBe(0);
  });
  it("pins the actual ledger identity in every role before exposing a candidate", async () => {
    const value = fixture(), external = services(value.plan), receipt = await applyPlan(value.plan, external.deps, value.receiptFile);
    expect(receipt.stateInstanceId).toBe("1".repeat(32));
    for (const name of Object.values(value.plan.identities)) expect(JSON.parse((external.native.get(name)!.environmentVariables as Record<string, string>).ABX_MANAGED_CONFIG_JSON).expectedStateId).toBe(receipt.stateInstanceId);
  });
  it("compiles only numeric storage budgets while preserving the manifest's deployment descriptor", async () => {
    const value = fixture(), external = services(value.plan); await applyPlan(value.plan, external.deps, value.receiptFile);
    const expected = Object.fromEntries(Object.entries(value.template.application.storage).filter(([key]) => key !== "backend"));
    for (const name of Object.values(value.plan.identities)) {
      const compiled = JSON.parse((external.native.get(name)!.environmentVariables as Record<string, string>).ABX_MANAGED_CONFIG_JSON);
      expect(compiled.storage).toEqual(expected); expect(compiled.storage).not.toHaveProperty("backend");
    }
    expect(value.template.application.storage.backend).toBe("bounded-database");
  });
  it.skipIf(!process.env.ABX_MANAGED_RUNTIME_PYTHON)("passes full compiled role configuration through the installed final SDK parser", async () => {
    const value = fixture(process.env.ABX_MANAGED_TEMPLATE_FILE ?? templateFixture), external = services(value.plan); await applyPlan(value.plan, external.deps, value.receiptFile);
    const compiled = Object.values(value.plan.identities).map(name => JSON.parse((external.native.get(name)!.environmentVariables as Record<string, string>).ABX_MANAGED_CONFIG_JSON));
    const check = spawnSync(process.env.ABX_MANAGED_RUNTIME_PYTHON!, ["-I", "-c", [
      "import json, sys", "from agent_sandbox.managed_agents import ManagedConfig", "configs = json.load(sys.stdin)",
      "for value in configs:", "    config = ManagedConfig.from_dict(value)", "    assert config.storage == value['storage']",
      "    for key, extra in [('backend', 'bounded-database'), ('unknownBudget', 1)]:", "        invalid = {**value, 'storage': {**value['storage'], key: extra}}",
      "        try: ManagedConfig.from_dict(invalid)", "        except ValueError: pass", "        else: raise AssertionError('unknown storage field accepted')",
      "print('three compiled role configs accepted; descriptor and unknown field rejected')",
    ].join("\n")], { input: JSON.stringify(compiled), encoding: "utf8", timeout: 15000 });
    expect(check.error).toBeUndefined(); expect(check.status).toBe(0); expect(check.stdout.trim()).toBe("three compiled role configs accepted; descriptor and unknown field rejected");
  });
  it("withholds candidate publication when the backend ledger changes during initial pinning", async () => {
    const value = fixture(), external = services(value.plan); let calls = 0;
    external.deps.fc.invokeControl = async () => ({ stateInstanceId: (++calls === 1 ? "1" : "2").repeat(32), draining: false, activeSessions: 0, pendingCleanup: 0, uncertainResources: 0 });
    await expect(applyPlan(value.plan, external.deps, value.receiptFile)).rejects.toThrow(/state identity/); expect(external.triggers.size).toBe(0); expect(external.aliases.size).toBe(0);
  });
  it("preserves the actual created template identity when readiness subsequently fails", async () => {
    const value = fixture(), originalRead = fs.readFileSync, originalWrite = fs.writeSync, frames: Array<Record<string, unknown>> = [], initialPaths = { ...paths }, initialExit = process.exitCode;
    vi.spyOn(fs, "readFileSync").mockImplementation(((file: fs.PathOrFileDescriptor, ...args: unknown[]) => file === 0 ? JSON.stringify({ plan: value.plan, journalRoot: scratch() }) : Reflect.apply(originalRead, fs, [file, ...args])) as typeof fs.readFileSync);
    vi.spyOn(fs, "writeSync").mockImplementation(((fd: number, data: string | Buffer, ...args: unknown[]) => { if (fd !== 3) return Reflect.apply(originalWrite, fs, [fd, data, ...args]); frames.push(JSON.parse(String(data))); return Buffer.byteLength(data); }) as typeof fs.writeSync);
    vi.spyOn(CLI_EXTENSION, "prepareProject").mockImplementation(async (_directory, options) => {
      const intent = await options.journal!.intent({ kind: "template", correlation_key: "ready-failure-test", cleanup: "template.delete" });
      await options.journal!.created(intent, "native-created-template"); throw Error("readiness failed");
    });
    try { await runPreparation(); expect((frames.at(-1)!.sandbox as Record<string, unknown>).reference).toBe("native-created-template"); expect(frames.at(-1)!.type).toBe("failed"); }
    finally { _setPaths(initialPaths); process.exitCode = initialExit; }
  });
  it("keeps unresolved Sandbox template intents instead of declaring destruction complete", async () => {
    const value = fixture(), external = services(value.plan);
    external.deps.prepare = async (_plan, progress) => { progress({ provider: "alicloud-express", reference: "", journalId: "unknown-template-journal", resources: [{ kind: "template", state: "intent", cleanup: "template.delete", intent_id: "unknown" }] }); throw Error("unknown template create"); };
    await expect(applyPlan(value.plan, external.deps, value.receiptFile)).rejects.toThrow();
    await expect(destroyPlan(createDestroyPlan(value.receiptFile), external.deps)).rejects.toThrow(/template creation remains uncertain/);
  });
  it("runs candidate checks, removes verification auth and publishes one stable alias", async () => {
    const value = fixture(), external = services(value.plan); let temporaryToken = "";
    external.deps.hooks = async (phase, _receipt, _endpoint, token) => { if (phase === "afterReady") temporaryToken = token!; };
    const receipt = await applyPlan(value.plan, external.deps, value.receiptFile);
    expect(receipt.status).toBe("ready"); expect(receipt.executionMayHaveStarted).toBe(true); expect(receipt.publishedVersions).toHaveLength(2);
    const gateway = external.native.get(value.plan.identities.gateway)!; expect(JSON.stringify(gateway.environmentVariables)).not.toContain(businessTokenDigest(temporaryToken));
    const persisted = fs.readFileSync(value.receiptFile, "utf8"); for (const secret of [temporaryToken, external.deps.binding.internal.token, "private-model-key", "private-sandbox-key", "postgresql://"]) expect(persisted).not.toContain(secret);
    expect(external.aliases.get(`${value.plan.identities.gateway}/prod`)).toBe(receipt.gatewayVersion); expect(external.calls).toContain(`timer:${value.plan.identities.dispatcher}:true`);
    await expect(applyPlan(value.plan, external.deps, value.receiptFile)).rejects.toThrow(/already has a receipt/);
  });
  it("refuses same-name preexisting functions and keeps the borrowed resource", async () => {
    const value = fixture(), external = services(value.plan); external.native.set(value.plan.identities.worker, { functionName: value.plan.identities.worker });
    await expect(applyPlan(value.plan, external.deps, value.receiptFile)).rejects.toThrow(/already exists/); expect(external.calls.filter(item => item.startsWith("create:"))).toEqual([]); expect(readReceipt(value.receiptFile).functions).toEqual([]);
  });
  it("applies explicit private VPC access to all roles without copying deployment network into runtime env", async () => {
    const value = fixture(), external = services(value.plan), vpcConfig = { vpcId: "vpc-example", vSwitchIds: ["vsw-example"], securityGroupId: "sg-example" };
    external.deps.binding.vpcConfig = vpcConfig; await applyPlan(value.plan, external.deps, value.receiptFile);
    for (const functionName of Object.values(value.plan.identities)) { const actual = external.native.get(functionName)!; expect(actual.vpcConfig).toEqual(vpcConfig); expect(actual.internetAccess).toBe(true); expect(JSON.stringify(actual.environmentVariables)).not.toContain("vpc-example"); }
  });
  it("withholds publication when native readback loses the configured VPC", async () => {
    const value = fixture(), external = services(value.plan), deploy = external.deps.deploy;
    external.deps.binding.vpcConfig = { vpcId: "vpc-example", vSwitchIds: ["vsw-example"], securityGroupId: "sg-example" };
    external.deps.deploy = async (...args) => { await deploy(...args); delete external.native.get(args[0].identities[args[1]])!.vpcConfig; };
    await expect(applyPlan(value.plan, external.deps, value.receiptFile)).rejects.toThrow(/VPC configuration/); expect(external.aliases.size).toBe(0);
  });
  it("retains unknown create outcomes and reconcile never adopts a same-name native resource", async () => {
    const value = fixture(), external = services(value.plan), create = external.deps.fc.createFunction;
    external.deps.fc.createFunction = async props => { await create(props); throw new Error("network outcome unknown"); };
    await expect(applyPlan(value.plan, external.deps, value.receiptFile)).rejects.toThrow(); const receipt = readReceipt(value.receiptFile);
    expect(receipt.cleanup[0].status).toBe("uncertain"); const result = await observeReceipt(receipt, external.deps, value.receiptFile); expect(JSON.stringify(result)).toContain("unknown-present"); expect(receipt.functions).toEqual([]);
    const destruction = createDestroyPlan(value.receiptFile); await expect(destroyPlan(destruction, external.deps)).rejects.toThrow(/ownership/); expect(external.native.size).toBe(1);
  });
  it("cleans confirmed early resources without a dispatcher, before any execution endpoint exists", async () => {
    const value = fixture(), external = services(value.plan); external.deps.fc.configureWorker = async () => { throw new Error("configuration failed"); };
    await expect(applyPlan(value.plan, external.deps, value.receiptFile)).rejects.toThrow(); const receipt = readReceipt(value.receiptFile); expect(receipt.executionMayHaveStarted).not.toBe(true);
    await destroyPlan(createDestroyPlan(value.receiptFile), external.deps); expect(external.native.size).toBe(0); expect(external.calls).not.toContain("control");
  });
  it("keeps retained production workers when an update fails before its dispatcher exists", async () => {
    const value = fixture(), external = services(value.plan), previous = await applyPlan(value.plan, external.deps, value.receiptFile);
    const update = createPlan(value.file, value.buildFile, value.receiptFile), file = path.join(value.directory, ".abx", "failed-update.receipt.json");
    external.deps.fc.configureWorker = async () => { throw Error("new worker setup failed"); };
    await expect(applyPlan(update, external.deps, file)).rejects.toThrow(/setup failed/);
    expect(readReceipt(file).executionMayHaveStarted).not.toBe(true);
    external.calls.length = 0;
    external.deps.fc.invokeControl = async (name, envelope) => {
      external.calls.push(`drain:${name}`);
      expect(envelope.payload).toMatchObject({ operation: "drain", applicationId: value.template.name });
      return { stateInstanceId: "1".repeat(32), activeSessions: 1, pendingCleanup: 0, uncertainResources: 0, draining: true };
    };
    await expect(destroyPlan(createDestroyPlan(file), external.deps)).rejects.toThrow(/drain is still active/);
    expect(external.calls).toContain(`drain:${previous.plan.identities.dispatcher}`);
    expect(external.calls.some(item => item.startsWith("delete:"))).toBe(false);
    expect(external.native.has(previous.plan.identities.worker)).toBe(true);
  });
  it("cleans the inherited Gateway after an early update failure only after historical drain", async () => {
    const value = fixture(), external = services(value.plan), previous = await applyPlan(value.plan, external.deps, value.receiptFile);
    const update = createPlan(value.file, value.buildFile, value.receiptFile), file = path.join(value.directory, ".abx", "failed-update.receipt.json");
    external.deps.fc.configureWorker = async () => { throw Error("new worker setup failed"); };
    await expect(applyPlan(update, external.deps, file)).rejects.toThrow(/setup failed/);
    external.calls.length = 0;
    await destroyPlan(createDestroyPlan(file), external.deps);
    expect(external.calls).toContain("control");
    expect(external.calls).toContain(`delete:${previous.plan.identities.gateway}`);
    expect(external.native.size).toBe(0);
    expect(external.aliases.size).toBe(0);
  });
  it("retains every resource when historical Gateway creation identities conflict", async () => {
    const value = fixture(), external = services(value.plan); await applyPlan(value.plan, external.deps, value.receiptFile);
    const update = createPlan(value.file, value.buildFile, value.receiptFile), file = path.join(value.directory, ".abx", "update.receipt.json");
    external.deps.probe = async (_endpoint, pathname) => pathname === "/health" ? { status: 200, body: { revision: update.revision } } : { status: 401, body: {} };
    const receipt = await applyPlan(update, external.deps, file);
    receipt.functions.find(item => item.role === "gateway")!.functionId = "conflicting-creation"; writeJson(file, receipt);
    external.calls.length = 0;
    await expect(destroyPlan(createDestroyPlan(file), external.deps)).rejects.toThrow(/Historical Gateway ownership/);
    expect(external.calls.some(item => item.startsWith("delete:"))).toBe(false);
  });
  it("marks possible execution before a candidate trigger whose result becomes unknown", async () => {
    const value = fixture(), external = services(value.plan); external.deps.fc.createHttpTrigger = async () => { expect(readReceipt(value.receiptFile).executionMayHaveStarted).toBe(true); throw new Error("unknown trigger"); };
    await expect(applyPlan(value.plan, external.deps, value.receiptFile)).rejects.toThrow(); expect(readReceipt(value.receiptFile).status).toBe("requires_reconcile");
    await destroyPlan(createDestroyPlan(value.receiptFile), external.deps); expect(external.calls).toContain("control"); expect(external.native.size).toBe(0);
  });
  it("withholds publication if the verification credential survives production compilation", async () => {
    const value = fixture(), external = services(value.plan), deploy = external.deps.deploy; let gatewayDeploys = 0;
    external.deps.deploy = async (...args) => { if (args[1] === "gateway" && ++gatewayDeploys === 4) return; await deploy(...args); };
    await expect(applyPlan(value.plan, external.deps, value.receiptFile)).rejects.toThrow(/credential removal/); expect(external.aliases.size).toBe(0);
  });
  it("retains all workers while logical reusable sessions or uncertain cleanup remain", async () => {
    const value = fixture(), external = services(value.plan); await applyPlan(value.plan, external.deps, value.receiptFile);
    external.deps.fc.invokeControl = async () => ({ stateInstanceId: "1".repeat(32), activeSessions: 1, pendingCleanup: 0, uncertainResources: 0, draining: true });
    await expect(destroyPlan(createDestroyPlan(value.receiptFile), external.deps)).rejects.toThrow(/drain is still active/); expect(external.native.size).toBe(3);
  });
  it("continues partial destruction and retries without repeating drain or deleting a replacement", async () => {
    const value = fixture(), external = services(value.plan); await applyPlan(value.plan, external.deps, value.receiptFile);
    const remove = external.deps.fc.deleteFunction; let fail = true;
    external.deps.fc.deleteFunction = async name => { if (name === value.plan.identities.worker && fail) { fail = false; throw new Error("transient deletion unknown"); } await remove(name); };
    await expect(destroyPlan(createDestroyPlan(value.receiptFile), external.deps)).rejects.toThrow(/Some owned resources/); expect(external.native.size).toBe(1); expect(readReceipt(value.receiptFile).drainConfirmed).toBe(true);
    const count = external.calls.filter(item => item === "control").length;
    const final = await destroyPlan(createDestroyPlan(value.receiptFile), external.deps); expect(final.status).toBe("destroyed"); expect(external.native.size).toBe(0); expect(external.calls.filter(item => item === "control")).toHaveLength(count);
    await destroyPlan(createDestroyPlan(value.receiptFile), external.deps); expect(external.native.size).toBe(0);
  });
  it("rejects retire when an old idle logical session can still accept input", async () => {
    const value = fixture(), external = services(value.plan), receipt = await applyPlan(value.plan, external.deps, value.receiptFile);
    receipt.retained.push({ revision: "rev-old", worker: "old-worker", dispatcher: "old-dispatcher", template: "old-template" });
    external.deps.fc.invokeControl = async () => ({ stateInstanceId: "1".repeat(32), activeSessions: 1, pendingCleanup: 0, uncertainResources: 0 });
    await expect(retireRevision(receipt, "rev-old", external.deps, value.receiptFile)).rejects.toThrow(/reusable sessions/); expect(external.calls).not.toContain("delete:old-worker");
  });
  it("requires a durable revision drain fence rather than a zero-activity observation for retire", async () => {
    const value = fixture(), external = services(value.plan), old = await applyPlan(value.plan, external.deps, value.receiptFile);
    const update = createPlan(value.file, value.buildFile, value.receiptFile), file = path.join(value.directory, ".abx", "update.receipt.json");
    external.deps.probe = async (_endpoint, pathname) => pathname === "/health" ? { status: 200, body: { revision: update.revision } } : { status: 401, body: {} };
    const receipt = await applyPlan(update, external.deps, file);
    external.calls.length = 0;
    const operations: unknown[] = [];
    external.deps.fc.invokeControl = async (_name, envelope) => {
      operations.push(envelope.payload);
      return { stateInstanceId: "1".repeat(32), activeSessions: 0, pendingCleanup: 0, uncertainResources: 0, draining: false };
    };
    await expect(retireRevision(receipt, old.plan.revision, external.deps, file)).rejects.toThrow(/drain/);
    expect(operations).toEqual([expect.objectContaining({ operation: "drain", revision: old.plan.revision })]);
    expect(external.calls.some(item => item.startsWith("delete:"))).toBe(false);
  });
  it("rejects control results from a replacement ledger before any cleanup", async () => {
    const value = fixture(), external = services(value.plan); await applyPlan(value.plan, external.deps, value.receiptFile);
    external.calls.length = 0;
    external.deps.fc.invokeControl = async () => ({ stateInstanceId: "2".repeat(32), activeSessions: 0, pendingCleanup: 0, uncertainResources: 0, draining: true });
    await expect(destroyPlan(createDestroyPlan(value.receiptFile), external.deps)).rejects.toThrow(/state identity/);
    expect(external.calls.some(item => item.startsWith("delete:"))).toBe(false);
  });
  it("preserves old routing during update and retries retirement including historical Gateway versions", async () => {
    const value = fixture(), external = services(value.plan), old = await applyPlan(value.plan, external.deps, value.receiptFile), history = fs.readFileSync(value.receiptFile, "utf8");
    const update = createPlan(value.file, value.buildFile, value.receiptFile), file = path.join(value.directory, ".abx", "update.receipt.json");
    external.deps.probe = async (_endpoint, pathname) => pathname === "/health" ? { status: 200, body: { revision: update.revision } } : { status: 401, body: {} };
    const receipt = await applyPlan(update, external.deps, file);
    expect(receipt.plan.identities.gateway).toBe(old.plan.identities.gateway); expect(receipt.retained.map(item => item.revision)).toEqual([old.plan.revision]);
    const worker = external.native.get(update.identities.worker)!, config = JSON.parse((worker.environmentVariables as Record<string, string>).ABX_MANAGED_CONFIG_JSON);
    expect(config.workers[old.plan.revision]).toBe(old.plan.identities.worker); expect(receipt.sandbox!.reference).not.toBe(old.sandbox!.reference);
    const remove = external.deps.fc.deleteFunction; let once = true;
    external.deps.fc.deleteFunction = async name => { if (name === old.plan.identities.worker && once) { once = false; throw Error("delete unavailable"); } await remove(name); };
    await expect(retireRevision(receipt, old.plan.revision, external.deps, file)).rejects.toThrow(/Retirement cleanup/); expect(readReceipt(file).retained).toHaveLength(1);
    const final = await retireRevision(readReceipt(file), old.plan.revision, external.deps, file); expect(final.retained).toEqual([]);
    for (const version of old.publishedVersions!) expect(external.calls).toContain(`delete-version:${version}`);
    expect(fs.readFileSync(value.receiptFile, "utf8")).toBe(history); await destroyPlan(createDestroyPlan(file), external.deps); expect(external.native.size).toBe(0);
  });
  it("rejects an internal key rotation across retained revisions before cloud mutation", async () => {
    const value = fixture(), external = services(value.plan); await applyPlan(value.plan, external.deps, value.receiptFile);
    const next = createPlan(value.file, value.buildFile, value.receiptFile); external.deps.binding.internal.token = "test-new-random-control-token-".repeat(3);
    await expect(applyPlan(next, external.deps)).rejects.toThrow(/Internal credentials changed/); expect(external.native.size).toBe(3);
  });
});
describe("managed subprocess lifecycle", () => {
  it("terminates real timed out children and suppresses their sensitive diagnostics", async () => {
    const directory = scratch(), marker = path.join(directory, "late.txt");
    const script = `const fs=require('node:fs');console.error('secret-output');setTimeout(()=>fs.writeFileSync(${JSON.stringify(marker)},'late'),700);`;
    await expect(execute({ argv: [process.execPath, "-e", script], cwd: directory, env: { PATH: process.env.PATH }, timeoutSeconds: 0.05 })).rejects.toThrow(/deadline/);
    await new Promise(resolve => setTimeout(resolve, 800)); expect(fs.existsSync(marker)).toBe(false);
  });
  it("enforces output budgets on private and diagnostic pipes", async () => {
    await expect(execute({ argv: [process.execPath, "-e", "process.stderr.write('x'.repeat(10000));setTimeout(()=>{},10000)"], cwd: scratch(), timeoutSeconds: 10, maxBytes: 100 })).rejects.toThrow(/output budget/);
  });
  it("does not copy credentials into private JSON output", () => { expect(() => writeJson(path.join(scratch(), "bad.json"), { apiKey: "sensitive" })).toThrow(/Credential literals/); expect(digest({ b: 2, a: 1 })).toBe(digest({ a: 1, b: 2 })); });
});
describe("owned Server image lifecycle", () => {
  function buildFixture() {
    const value = fixture(), credential = { AccountID: "123", AccessKeyID: "test", AccessKeySecret: "test" };
    delete value.template.application.deployment.serverImage; value.template.application.deployment.serverBuildRecipe = { dockerfile: "Dockerfile.server", context: "." };
    fs.writeFileSync(value.file, stringify(value.template)); fs.writeFileSync(path.join(value.directory, "Dockerfile.server"), "FROM scratch\n");
    const output = path.join(value.directory, ".abx", "owned-build.json"); let pushed = false, removed = false;
    const registry: RegistryClient = { async inspect() { return pushed && !removed ? { digest: `sha256:${"d".repeat(64)}`, imageId: "c".repeat(64) } : null; }, async token() { return { username: "registry-user", password: "private-registry-token" }; }, async remove() { removed = true; } };
    const run = vi.fn(async (input: Parameters<typeof execute>[0]): Promise<string> => {
      if (input.argv[1] === "push") pushed = true;
      if (input.argv[1] === "image" && input.argv[2] === "inspect") return `sha256:${"c".repeat(64)}\n`;
      if (input.argv[1] === "image" && input.argv[2] === "ls") return "";
      return "";
    });
    const dependencies = { registry, run, namespace: "example-namespace", tools: async () => value.plan.toolchain };
    return { ...value, credential, output, dependencies, run, registry };
  }
  it("journals a random tag before effects and independently removes an isolated confirmed build", async () => {
    const value = buildFixture(), result = await buildApplication(value.template, value.directory, value.credential, value.output, value.dependencies);
    expect(result.ownedServerImage?.state).toBe("confirmed"); expect(result.ownedServerImage?.tag).toMatch(/^build-[a-f0-9]{24}$/); expect(result.image).toContain("@sha256:");
    const cleaned = await cleanBuild(value.output, value.credential, value.dependencies); expect(cleaned.status).toBe("cleaned");
    expect(fs.readFileSync(value.output, "utf8")).not.toContain("private-registry-token");
  });
  it("excludes private deployment inputs and environment files from the actual Docker context", async () => {
    const value = buildFixture();
    for (const name of [".abx/private/env", ".abx/wheels/private.whl", ".env", ".env.local", "nested/.env.production"]) {
      const file = path.join(value.directory, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "private-input");
    }
    const run = value.dependencies.run; let checked = false;
    value.dependencies.run = vi.fn(async input => {
      if (input.argv[1] === "build") {
        const context = input.argv.at(-1)!;
        for (const name of [".abx", ".env", ".env.local", "nested/.env.production"]) expect(fs.existsSync(path.join(context, name))).toBe(false);
        expect(fs.readFileSync(path.join(context, "Dockerfile.server"), "utf8")).toBe("FROM scratch\n"); checked = true;
      }
      return await run(input);
    });
    await buildApplication(value.template, value.directory, value.credential, value.output, value.dependencies); expect(checked).toBe(true);
  });
  it("retains the only recovery handle when push returns an unknown outcome", async () => {
    const value = buildFixture(), run = value.dependencies.run;
    value.dependencies.run = vi.fn(async input => { if (input.argv[1] === "push") { const saved = JSON.parse(fs.readFileSync(value.output, "utf8")); expect(saved.ownedServerImage.state).toBe("push-started"); throw Error("unknown push"); } return await run(input); });
    await expect(buildApplication(value.template, value.directory, value.credential, value.output, value.dependencies)).rejects.toThrow(/unknown push/);
    const saved = JSON.parse(fs.readFileSync(value.output, "utf8")); expect(saved.status).toBe("requires_reconcile"); expect(saved.ownedServerImage.journalId).toBeTruthy();
    await expect(cleanBuild(value.output, value.credential, value.dependencies)).rejects.toThrow(/ownership is uncertain/);
  });
  it("retries incomplete post-push metadata without pushing twice", async () => {
    const value = buildFixture(); let reads = 0;
    value.registry.inspect = async () => { reads++; return reads === 1 ? null : reads === 2 ? { digest: "", imageId: "c".repeat(64) } : { digest: `sha256:${"d".repeat(64)}`, imageId: "c".repeat(64) }; };
    const built = await buildApplication(value.template, value.directory, value.credential, value.output, value.dependencies);
    expect(built.status).toBe("ready"); expect(value.run.mock.calls.filter(([input]) => input.argv[1] === "push")).toHaveLength(1); expect(reads).toBe(3);
  });
  it("retains reconciliation state when post-push metadata stays incomplete", async () => {
    const value = buildFixture(); let reads = 0;
    value.registry.inspect = async () => ++reads === 1 ? null : { digest: "", imageId: "" };
    await expect(buildApplication(value.template, value.directory, value.credential, value.output, { ...value.dependencies, metadataTimeoutSeconds: 0.02 })).rejects.toThrow(/metadata remains incomplete/);
    expect(JSON.parse(fs.readFileSync(value.output, "utf8")).status).toBe("requires_reconcile"); expect(value.run.mock.calls.filter(([input]) => input.argv[1] === "push")).toHaveLength(1);
  });
  it("rejects a complete mismatched creation identity immediately", async () => {
    const value = buildFixture(); let reads = 0;
    value.registry.inspect = async () => ++reads === 1 ? null : { digest: `sha256:${"d".repeat(64)}`, imageId: "e".repeat(64) };
    await expect(buildApplication(value.template, value.directory, value.credential, value.output, value.dependencies)).rejects.toThrow(/does not match/); expect(reads).toBe(2);
  });
  it("never cleans a borrowed image or a build that has entered apply", async () => {
    const value = fixture(), external = services(value.plan); await applyPlan(value.plan, external.deps, value.receiptFile);
    await expect(cleanBuild(value.buildFile, external.deps.credential)).rejects.toThrow(/application lifecycle/);
    const file = path.join(value.directory, ".abx", "borrowed.json"), original = JSON.parse(fs.readFileSync(value.buildFile, "utf8")); delete original.usedBy; writeJson(file, original);
    const remove = vi.fn(); await cleanBuild(file, external.deps.credential, { registry: { token: vi.fn(), inspect: vi.fn(), remove } }); expect(remove).not.toHaveBeenCalled();
  });
  it("refuses to delete a changed native ACR tag identity", async () => {
    const value = buildFixture(), built = await buildApplication(value.template, value.directory, value.credential, value.output, value.dependencies);
    const core = createRequire(import.meta.url)("@alicloud/openapi-core");
    const call = vi.spyOn(core.default.prototype, "callApi").mockResolvedValue({ statusCode: 200, body: { data: { tags: [{ tag: built.ownedServerImage!.tag, digest: `sha256:${"e".repeat(64)}`, imageId: "c".repeat(64) }], total: 1 } } });
    await expect(createRegistryClient(value.credential, "cn-hangzhou").remove(built.ownedServerImage!)).rejects.toThrow(/identity changed/);
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("lets clean-build win admission before apply reaches any application effects", async () => {
    const value = buildFixture(); await buildApplication(value.template, value.directory, value.credential, value.output, value.dependencies);
    const plan = createPlan(value.file, value.output), external = services(plan); let release!: () => void, started!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { started = resolve; });
    value.registry.remove = async () => { started(); await barrier; };
    const cleaning = cleanBuild(value.output, value.credential, value.dependencies); await entered;
    try { await expect(applyPlan(plan, external.deps, value.receiptFile)).rejects.toThrow(/locked/); expect(external.native.size).toBe(0); }
    finally { release(); await cleaning; }
    expect(JSON.parse(fs.readFileSync(value.output, "utf8")).status).toBe("cleaned");
  });
  it("lets apply record permanent use before a competing clean-build can remove an image", async () => {
    const value = buildFixture(); await buildApplication(value.template, value.directory, value.credential, value.output, value.dependencies);
    const plan = createPlan(value.file, value.output), external = services(plan); let release!: () => void, started!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { started = resolve; });
    external.deps.hooks = async phase => { if (phase === "beforeApply") { started(); await barrier; } };
    const applying = applyPlan(plan, external.deps, value.receiptFile); await entered;
    try { await expect(cleanBuild(value.output, value.credential, value.dependencies)).rejects.toThrow(/application lifecycle/); }
    finally { release(); await applying; }
    expect(JSON.parse(fs.readFileSync(value.output, "utf8")).usedBy).toHaveLength(1);
  });
});
