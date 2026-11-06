/** Managed-profile deployment state machine. External effects are preceded by durable intent. */
import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { ApplicationError, digest, planId, readBuild, readTemplate, record, sourceDigest, verifyTools, writeJson } from "./config.js";
import { bootstrapEnvironment, businessTokenDigest, stateConnectionIdentity, type CredentialSnapshot, type ResolvedBindings } from "./bindings.js";
import { functionReceipt, signInvocation, verifyFunction, type FcTransport } from "./fc.js";
import { execute } from "./process.js";
import { withApplicationLock } from "./lock.js";
import { paths } from "../transport/config_layers.js";
export { withApplicationLock } from "./lock.js";
import type { ApplicationPlan, ApplicationReceipt, ApplicationTemplate, FunctionReceipt, OwnedServerImage, PreparedSandbox, Role } from "./types.js";

export interface ApplicationServices {
  fc: FcTransport;
  credential: CredentialSnapshot;
  binding: ResolvedBindings;
  prepare(plan: ApplicationPlan, progress: (sandbox: PreparedSandbox) => void): Promise<PreparedSandbox>;
  deploy(plan: ApplicationPlan, role: Role, props: Record<string, unknown>): Promise<void>;
  deleteTemplate(sandbox: PreparedSandbox): Promise<void>;
  removeImage?(image: OwnedServerImage): Promise<void>;
  probe?(endpoint: string, pathname: string, token?: string): Promise<{ status: number; body: unknown }>;
  hooks?(phase: "beforeApply" | "afterReady", receipt: ApplicationReceipt, endpoint?: string, token?: string): Promise<void>;
}
const roles: Role[] = ["worker", "dispatcher", "gateway"];
const appId = (template: ApplicationTemplate): string => template.name;
function safeName(value: string): string { return value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+/, "").slice(0, 35) || "agents"; }
export function createPlan(templateFile: string, buildFile: string, previousReceipt?: string): ApplicationPlan {
  const file = fs.realpathSync(templateFile), projectRoot = path.dirname(file), template = readTemplate(file), build = readBuild(buildFile);
  if (build.sourceDigest !== sourceDigest(projectRoot)) throw new ApplicationError("Source changed after build; build the current input before planning.");
  const previous = previousReceipt ? readReceipt(previousReceipt) : undefined;
  if (previous && (previous.status !== "ready" || previous.plan.template.name !== template.name || previous.plan.template.application.deployment.region !== template.application.deployment.region)) throw new ApplicationError("An update requires the ready receipt for this application and region.");
  const revision = `rev-${randomBytes(10).toString("hex")}`, base = safeName(template.name);
  const plan: ApplicationPlan = { schemaVersion: 2, kind: "ManagedApplicationPlan", operation: "apply", id: "", revision,
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 24 * 3600000).toISOString(), projectRoot, templateFile: file,
    sourceDigest: build.sourceDigest, template, image: build.image, toolchain: build.toolchain, buildReceipt: fs.realpathSync(buildFile), ...(build.ownedServerImage ? { ownedServerImage: build.ownedServerImage } : {}),
    identities: { gateway: previous?.plan.identities.gateway ?? `${base}-gateway`, worker: `${base}-worker-${revision.slice(4)}`, dispatcher: `${base}-dispatch-${revision.slice(4)}` },
    steps: [{ id: "sandbox-template", type: "sandbox-template", dependsOn: [] }, { id: "worker", type: "serverless-devs", dependsOn: ["sandbox-template"] },
      { id: "dispatcher", type: "serverless-devs", dependsOn: ["worker"] }, { id: "gateway", type: "serverless-devs", dependsOn: ["dispatcher"] },
      { id: "candidate-verification", type: "custom", dependsOn: ["gateway"] }, { id: "publish", type: "managed-ingress", dependsOn: ["candidate-verification"] }],
    ...(previousReceipt ? { previousReceipt: fs.realpathSync(previousReceipt), previousDigest: digest(previous) } : {}) };
  plan.id = planId(plan); return plan;
}
export function createDestroyPlan(receiptFile: string): ApplicationPlan {
  const previous = readReceipt(receiptFile);
  const plan: ApplicationPlan = { ...previous.plan, operation: "destroy", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), previousReceipt: fs.realpathSync(receiptFile), previousDigest: digest(previous), id: "" };
  plan.id = planId(plan); return plan;
}
export function readPlan(file: string): ApplicationPlan {
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!record(value) || value.kind !== "ManagedApplicationPlan" || value.schemaVersion !== 2 || !["apply", "destroy"].includes(String(value.operation)) || typeof value.id !== "string" || planId(value as unknown as ApplicationPlan) !== value.id) throw new ApplicationError("Invalid or modified application plan.");
  return value as unknown as ApplicationPlan;
}
export function readReceipt(file: string): ApplicationReceipt {
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!record(value) || value.kind !== "ManagedApplicationReceipt" || value.schemaVersion !== 2 || !record(value.plan) || !Array.isArray(value.functions) || !Array.isArray(value.cleanup) || !Array.isArray(value.retained) || typeof value.accountId !== "string") throw new ApplicationError("Invalid application receipt.");
  return value as unknown as ApplicationReceipt;
}
export function defaultReceiptFile(plan: ApplicationPlan): string { return path.join(plan.projectRoot, ".abx", "app", `${plan.revision}.receipt.json`); }
function save(file: string, receipt: ApplicationReceipt): void { receipt.updatedAt = new Date().toISOString(); writeJson(file, receipt); }
function assertPlan(plan: ApplicationPlan): void {
  if (Date.parse(plan.expiresAt) <= Date.now()) throw new ApplicationError("Application plan expired; compute a new plan.");
  verifyTools(plan.toolchain);
  if (plan.operation === "apply" && (sourceDigest(plan.projectRoot) !== plan.sourceDigest || digest(readTemplate(plan.templateFile)) !== digest(plan.template))) throw new ApplicationError("Frozen application source changed; build and plan again.");
  if (plan.operation === "apply" && plan.buildReceipt) { const build = readBuild(plan.buildReceipt); if (build.image !== plan.image || digest(build.ownedServerImage ?? null) !== digest(plan.ownedServerImage ?? null)) throw new ApplicationError("The frozen Server build identity changed; compute a fresh plan."); }
  if (plan.previousReceipt && digest(readReceipt(plan.previousReceipt)) !== plan.previousDigest) throw new ApplicationError("The previous receipt changed; compute a fresh plan.");
}
async function control(receipt: ApplicationReceipt, services: ApplicationServices, operation: "status" | "drain", revision?: string, controller?: FunctionReceipt): Promise<Record<string, unknown>> {
  const dispatcher = controller ?? receipt.functions.find(item => item.role === "dispatcher");
  if (!dispatcher) throw new ApplicationError("No confirmed dispatcher exists; retain unknown resources for reconciliation.");
  await inspectOwned(receipt, services, dispatcher);
  const result = await services.fc.invokeControl(dispatcher.functionName, signInvocation("dispatcher", { operation, applicationId: appId(receipt.plan.template), ...(revision ? { revision } : {}), limit: 20 }, services.binding.internal.token));
  if (receipt.stateInstanceId && result.stateInstanceId !== receipt.stateInstanceId) throw new ApplicationError("Dispatcher state identity differs from the saved application ledger; cleanup was withheld.");
  return result;
}
function drained(value: Record<string, unknown>): boolean { return ["activeSessions", "pendingCleanup", "uncertainResources"].every(key => Number.isSafeInteger(value[key]) && value[key] === 0); }
function validateBinding(plan: ApplicationPlan, services: ApplicationServices, previous?: ApplicationReceipt): void {
  const { binding, fc, credential } = services;
  if (fc.accountId !== credential.AccountID || (previous && previous.accountId !== fc.accountId)) throw new ApplicationError("Deployment identity differs from the saved application owner.");
  if (!binding.internal.roleArn) throw new ApplicationError("The managed FC profile requires an explicit execution role for private worker invocation.");
  if (binding.provider.region !== plan.template.application.deployment.region) throw new ApplicationError("Sandbox and application region must match this managed profile.");
  if (binding.ingress.functionName && binding.ingress.functionName !== plan.identities.gateway) throw new ApplicationError("Ingress function does not match the fixed Gateway identity.");
  if (previous?.controlDigest && previous.controlDigest !== businessTokenDigest(binding.internal.token)) throw new ApplicationError("Internal credentials changed while retained workers exist; restore the prior control binding.");
  if (previous?.stateIdentityDigest && previous.stateIdentityDigest !== stateConnectionIdentity(binding.databaseUrl)) throw new ApplicationError("State backend routing changed; restore the application ledger instead of switching databases during update.");
  stateConnectionIdentity(binding.databaseUrl);
}
function runtimeConfig(receipt: ApplicationReceipt, binding: ResolvedBindings): Record<string, unknown> {
  const app = receipt.plan.template.application;
  return { revision: receipt.plan.revision, template: receipt.sandbox!.reference, models: { [binding.model.model]: binding.model.adapter }, applicationId: appId(receipt.plan.template), provider: app.sandbox.provider,
    modelEnvAllowlist: app.bindings.model.allowedEnv,
    ...(receipt.stateInstanceId ? { expectedStateId: receipt.stateInstanceId } : {}),
    workspace: "/workspace", port: 9000, sessions: app.sessions, limits: app.limits, storage: app.storage,
    workers: Object.fromEntries([...receipt.retained.map(item => [item.revision, item.worker]), [receipt.plan.revision, receipt.plan.identities.worker]]) };
}
function propsFor(receipt: ApplicationReceipt, services: ApplicationServices, role: Role, auth = services.binding.auth): Record<string, unknown> {
  const plan = receipt.plan, binding = { ...services.binding, auth };
  return { functionName: plan.identities[role], description: `Agent Sandbox ${appId(plan.template)} ${plan.revision} ${receipt.operationId}`,
    runtime: "custom-container", cpu: role === "gateway" ? 1 : 2, memorySize: role === "gateway" ? 1024 : 2048, diskSize: 512, internetAccess: true, timeout: role === "worker" ? 86400 : 120,
    role: binding.internal.roleArn, customContainerConfig: { image: plan.image, port: 9000, entrypoint: ["python", "-m", "agent_sandbox.managed_agents"], command: [role] },
    ...(binding.vpcConfig ? { vpcConfig: binding.vpcConfig } : {}),
    environmentVariables: bootstrapEnvironment(plan.template.application, binding, role, runtimeConfig(receipt, binding)) };
}
async function inspectOwned(receipt: ApplicationReceipt, services: ApplicationServices, item: FunctionReceipt): Promise<void> {
  const body = await services.fc.describeFunction(item.functionName);
  if (!body) throw new ApplicationError("A recorded function is absent; recovery must not silently recreate it.");
  verifyFunction(body, receipt.accountId, receipt.plan.template.application.deployment.region, item.functionName, item);
}
async function verifyDeployment(receipt: ApplicationReceipt, services: ApplicationServices, role: Role): Promise<void> {
  const body = await services.fc.describeFunction(receipt.plan.identities[role]);
  if (!body) throw new ApplicationError("Deployed function could not be read back.");
  verifyFunction(body, receipt.accountId, receipt.plan.template.application.deployment.region, receipt.plan.identities[role], receipt.functions.find(item => item.role === role));
  if (body.internetAccess !== true) throw new ApplicationError("Deployed FC function did not confirm the required public model/Sandbox access setting.");
  const expected = propsFor(receipt, services, role);
  if (!record(body.environmentVariables) || digest(body.environmentVariables) !== digest(expected.environmentVariables) || !record(body.customContainerConfig) || body.customContainerConfig.image !== receipt.plan.image) throw new ApplicationError("Deployed FC runtime bootstrap did not match its frozen revision and state identity.");
  if (services.binding.vpcConfig) {
    const native = body.vpcConfig;
    if (!record(native) || native.vpcId !== services.binding.vpcConfig.vpcId || native.securityGroupId !== services.binding.vpcConfig.securityGroupId || !Array.isArray(native.vSwitchIds)
      || digest([...native.vSwitchIds].sort()) !== digest([...services.binding.vpcConfig.vSwitchIds].sort())) throw new ApplicationError("Deployed FC VPC configuration did not match the explicit state binding.");
  }
}
async function probe(services: ApplicationServices, endpoint: string, pathname: string, token?: string): Promise<{ status: number; body: unknown }> {
  if (services.probe) return services.probe(endpoint, pathname, token);
  try {
    const result = await fetch(`${endpoint}${pathname}`, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(15000), redirect: "error" });
    const bytes = await result.text(); if (bytes.length > 65536) throw new Error("Output limit");
    let body: unknown; try { body = JSON.parse(bytes); } catch { body = null; }
    return { status: result.status, body };
  } catch { throw new ApplicationError("Gateway probe failed; no request or response credentials were retained."); }
}
async function candidateHooks(receipt: ApplicationReceipt, services: ApplicationServices, endpoint: string, token: string): Promise<void> {
  let finished = false, dispatchFailure: unknown;
  const drive = async (): Promise<void> => { while (!finished) { try { await services.fc.invokeControl(receipt.plan.identities.dispatcher, signInvocation("dispatcher", { limit: 20 }, services.binding.internal.token)); } catch (error) { dispatchFailure = error; return; } if (!finished) await delay(250); } };
  const driving = drive();
  try { await services.hooks?.("afterReady", receipt, endpoint, token); } finally { finished = true; await driving; }
  if (dispatchFailure) throw new ApplicationError("Candidate private dispatch failed; publication was withheld.");
}
/** Apply executes once; an interrupted receipt must be observed by reconcile rather than replayed. */
export async function applyPlan(plan: ApplicationPlan, services: ApplicationServices, file = defaultReceiptFile(plan)): Promise<ApplicationReceipt> {
  if (plan.operation !== "apply") throw new ApplicationError("Use destroy for a destruction plan.");
  assertPlan(plan);
  if (fs.existsSync(file)) throw new ApplicationError("This plan already has a receipt; inspect or reconcile it instead of repeating side effects.");
  const previous = plan.previousReceipt ? readReceipt(plan.previousReceipt) : undefined;
  validateBinding(plan, services, previous);
  if (previous && !/^[a-f0-9]{32}$/.test(previous.stateInstanceId ?? "")) throw new ApplicationError("The previous receipt does not pin a durable state identity; reconcile that deployment before upgrading.");
  const retained = previous ? [...previous.retained, { revision: previous.plan.revision, worker: previous.plan.identities.worker, dispatcher: previous.plan.identities.dispatcher, template: previous.sandbox!.reference }] : [];
  const receipt: ApplicationReceipt = { schemaVersion: 2, kind: "ManagedApplicationReceipt", plan, operationId: randomUUID(), status: "applying", phase: "before-apply", accountId: services.fc.accountId,
    functions: [], retained, retainedImages: previous?.retainedImages ?? [], cleanup: [], controlDigest: businessTokenDigest(services.binding.internal.token), stateIdentityDigest: stateConnectionIdentity(services.binding.databaseUrl),
    ...(previous?.stateInstanceId ? { stateInstanceId: previous.stateInstanceId } : {}), ...(services.binding.credentialsFile ? { credentialsFile: services.binding.credentialsFile } : {}), updatedAt: new Date().toISOString() };
  const phase = (value: string): void => { receipt.phase = value; save(file, receipt); };
  save(file, receipt);
  try {
    if (plan.buildReceipt) {
      // CLI holds app lock first. The common build lock prevents clean-build racing this admission.
      await withApplicationLock(path.join(paths.abxDir, "build-locks"), fs.realpathSync(plan.buildReceipt), async () => {
        const build = readBuild(plan.buildReceipt!);
        if (build.image !== plan.image || digest(build.ownedServerImage ?? null) !== digest(plan.ownedServerImage ?? null)) throw new ApplicationError("Server build ownership changed before application admission.");
        build.usedBy ??= [];
        if (!build.usedBy.some(item => item.applicationId === appId(plan.template) && item.revision === plan.revision)) build.usedBy.push({ applicationId: appId(plan.template), revision: plan.revision });
        writeJson(plan.buildReceipt!, build);
      });
    }
    await services.hooks?.("beforeApply", receipt);
    assertPlan(plan); phase("prepare-sandbox-template");
    receipt.sandbox = await services.prepare(plan, value => { receipt.sandbox = value; save(file, receipt); });
    if (!receipt.sandbox.reference || !receipt.sandbox.resources.some(item => item.kind === "template" && item.id === receipt.sandbox!.reference && item.state === "created")) throw new ApplicationError("Sandbox preparation omitted a confirmed owned template receipt.");
    save(file, receipt);
    for (const role of roles) {
      phase(`reserve-${role}`);
      const existing = await services.fc.describeFunction(plan.identities[role]);
      const inherited = role === "gateway" ? previous?.functions.find(item => item.role === "gateway") : undefined;
      if (inherited) {
        if (!existing) throw new ApplicationError("The previous Gateway is absent; refusing to recreate the stable identity.");
        verifyFunction(existing, receipt.accountId, plan.template.application.deployment.region, plan.identities[role], inherited);
        receipt.functions.push({ ...inherited, ownership: "retained", revision: plan.revision, image: plan.image });
      } else {
        if (existing) throw new ApplicationError("A planned function name already exists; create-only deployment will not adopt it.");
        receipt.cleanup.push({ kind: "function", identity: plan.identities[role], status: "pending" }); save(file, receipt);
        let created: Record<string, unknown>;
        try { created = await services.fc.createFunction(propsFor(receipt, services, role)); }
        catch (error) { receipt.cleanup.at(-1)!.status = "uncertain"; save(file, receipt); throw error; }
        receipt.functions.push(functionReceipt(created, role, plan.image, plan.revision, "created")); save(file, receipt);
      }
      phase(`deploy-${role}`);
      await inspectOwned(receipt, services, receipt.functions.at(-1)!);
      await services.deploy(plan, role, propsFor(receipt, services, role));
      await verifyDeployment(receipt, services, role);
      if (role === "worker") await services.fc.configureWorker(plan.identities.worker);
      if (role === "dispatcher") await services.fc.configureTimer(plan.identities.dispatcher, services.binding.internal.token, false);
    }
    // All roles exist, timers are disabled and no public candidate exists. Pin the actual ledger
    // before any business verification can create Sessions, then verify every role's compiled pin.
    receipt.executionMayHaveStarted = true; phase("bootstrap-state-identity");
    const identity = await control(receipt, services, "status");
    if (!/^[a-f0-9]{32}$/.test(String(identity.stateInstanceId)) || (receipt.stateInstanceId && receipt.stateInstanceId !== identity.stateInstanceId)) throw new ApplicationError("Dispatcher did not confirm the expected durable application ledger identity.");
    if (!receipt.stateInstanceId) {
      receipt.stateInstanceId = String(identity.stateInstanceId); phase("pin-state-identity");
      for (const role of roles) { await inspectOwned(receipt, services, receipt.functions.find(item => item.role === role)!); await services.deploy(plan, role, propsFor(receipt, services, role)); await verifyDeployment(receipt, services, role); }
      if ((await control(receipt, services, "status")).stateInstanceId !== receipt.stateInstanceId) throw new ApplicationError("Pinned application state identity could not be confirmed.");
    }
    const verificationToken = randomBytes(32).toString("base64url"), verificationHash = businessTokenDigest(verificationToken);
    phase("candidate-auth");
    const auth = { ...services.binding.auth, tokens: [...services.binding.auth.tokens as unknown[], { sha256: verificationHash, owner: `verification:${plan.revision}`, scopes: ["agents:read", "agents:write"], expiresAt: Math.floor(Date.now() / 1000) + 3600 }] };
    await services.deploy(plan, "gateway", propsFor(receipt, services, "gateway", auth));
    phase("candidate-version"); receipt.gatewayVersion = await services.fc.publishVersion(plan.identities.gateway, plan.revision); save(file, receipt);
    receipt.publishedVersions = [receipt.gatewayVersion]; save(file, receipt);
    receipt.candidateTrigger = `verify-${plan.revision.slice(4)}`;
    // Existing production keys also authenticate against this candidate. Persist before exposure.
    receipt.executionMayHaveStarted = true; phase("candidate-trigger");
    receipt.candidateEndpoint = await services.fc.createHttpTrigger(plan.identities.gateway, receipt.candidateTrigger, receipt.gatewayVersion); save(file, receipt);
    phase("candidate-smoke");
    const health = await probe(services, receipt.candidateEndpoint, "/health");
    if (health.status !== 200 || !record(health.body) || health.body.revision !== plan.revision) throw new ApplicationError("Candidate Gateway health did not confirm the planned revision.");
    await candidateHooks(receipt, services, receipt.candidateEndpoint, verificationToken);
    assertPlan(plan);
    phase("remove-verification-auth");
    await services.deploy(plan, "gateway", propsFor(receipt, services, "gateway"));
    const latest = await services.fc.describeFunction(plan.identities.gateway);
    const environment = latest && record(latest.environmentVariables) ? latest.environmentVariables : null;
    const productionProps = propsFor(receipt, services, "gateway");
    if (!environment || digest(environment) !== digest(productionProps.environmentVariables) || JSON.stringify(environment).includes(verificationHash)
      || !record(latest?.customContainerConfig) || latest.customContainerConfig.image !== plan.image) throw new ApplicationError("Candidate verification credential removal was not independently confirmed; publication withheld.");
    await verifyDeployment(receipt, services, "gateway");
    phase("production-version"); receipt.gatewayVersion = await services.fc.publishVersion(plan.identities.gateway, plan.revision);
    receipt.publishedVersions.push(receipt.gatewayVersion); save(file, receipt);
    receipt.aliasName = services.binding.ingress.aliasName;
    receipt.previousAliasVersion = await services.fc.describeAlias(plan.identities.gateway, receipt.aliasName);
    if (previous && receipt.previousAliasVersion !== previous.gatewayVersion) throw new ApplicationError("Stable alias no longer points to the prior managed version.");
    if (!previous && receipt.previousAliasVersion !== null) throw new ApplicationError("A stable alias already exists without managed ownership.");
    phase("publish-alias"); await services.fc.setAlias(plan.identities.gateway, receipt.aliasName, receipt.gatewayVersion, receipt.previousAliasVersion);
    phase("stable-trigger");
    const stable = await services.fc.describeHttpTrigger(plan.identities.gateway, "abx-gateway", receipt.aliasName);
    if (stable && !previous) throw new ApplicationError("An unmanaged stable trigger already exists.");
    const testEndpoint = stable ?? await services.fc.createHttpTrigger(plan.identities.gateway, "abx-gateway", receipt.aliasName);
    if (services.binding.ingress.kind === "custom-domain") { await services.fc.publishDomain(services.binding.ingress.domainName!, plan.identities.gateway, receipt.aliasName); receipt.endpoint = `https://${services.binding.ingress.domainName}`; }
    else receipt.endpoint = testEndpoint;
    save(file, receipt);
    const rejected = await probe(services, receipt.endpoint, "/v1/agents/sessions", verificationToken);
    if (rejected.status !== 401) throw new ApplicationError("Production Gateway did not reject the temporary verification credential.");
    phase("candidate-cleanup"); await services.fc.deleteTrigger(plan.identities.gateway, receipt.candidateTrigger);
    delete receipt.candidateEndpoint; delete receipt.candidateTrigger;
    phase("enable-dispatch"); await services.fc.configureTimer(plan.identities.dispatcher, services.binding.internal.token, true);
    for (const item of retained) await services.fc.configureTimer(item.dispatcher, services.binding.internal.token, false);
    receipt.status = "ready"; phase("ready"); return receipt;
  } catch (error) { receipt.status = "requires_reconcile"; save(file, receipt); throw error; }
}
/** Observation never invents ownership or restarts an interrupted cloud mutation. */
export async function observeReceipt(receipt: ApplicationReceipt, services: ApplicationServices, file?: string): Promise<Record<string, unknown>> {
  validateBinding(receipt.plan, services, receipt);
  const resources: Record<string, unknown>[] = [];
  const history = [receipt, ...receipt.retained.map(item => findHistorical(receipt, item.revision))];
  for (const entry of receipt.cleanup.filter(item => item.kind === "function")) {
    const actual = await services.fc.describeFunction(entry.identity), known = history.flatMap(item => item.functions).find(item => item.functionName === entry.identity);
    if (actual && known) verifyFunction(actual, receipt.accountId, receipt.plan.template.application.deployment.region, entry.identity, known);
    resources.push({ kind: entry.kind, identity: entry.identity, state: actual ? known ? "owned-present" : "unknown-present" : "absent" });
    if (!actual && entry.status === "uncertain") entry.status = "confirmed";
  }
  let activity: Record<string, unknown> | undefined;
  if (receipt.functions.some(item => item.role === "dispatcher")) activity = await control(receipt, services, "status");
  if (file) save(file, receipt);
  return { ...publicSummary(receipt, file), resources, ...(activity ? { activity } : {}) };
}
export function publicSummary(receipt: ApplicationReceipt, file?: string): Record<string, unknown> {
  return { application_id: appId(receipt.plan.template), revision: receipt.plan.revision, status: receipt.status, phase: receipt.phase,
    ...(file ? { receipt_file: path.resolve(file) } : {}), ...(receipt.endpoint ? { endpoint: receipt.endpoint } : {}),
    ...(receipt.credentialsFile ? { credentials_file: receipt.credentialsFile } : {}), retained_revisions: receipt.retained.map(item => item.revision),
    retained_build_artifacts: receipt.sandbox?.resources.filter(item => item.kind === "image" && item.cleanup === "manual" && item.state !== "deleted") ?? [],
    recovery: [...(receipt.sandbox?.resources.filter(item => !["deleted", "retained"].includes(item.state)) ?? []), ...receipt.cleanup.filter(item => item.status !== "confirmed")] };
}
/** Explicit retirement cannot strand any logical Session capable of accepting another input. */
export async function retireRevision(receipt: ApplicationReceipt, revision: string, services: ApplicationServices, file: string): Promise<ApplicationReceipt> {
  validateBinding(receipt.plan, services, receipt);
  const retired = receipt.retained.find(item => item.revision === revision);
  if (!retired || revision === receipt.plan.revision || receipt.status !== "ready") throw new ApplicationError("Retire requires a non-current retained revision of a ready deployment.");
  const activity = await control(receipt, services, "drain", revision);
  if (activity.draining !== true || !drained(activity)) throw new ApplicationError("Retained revision drain is unconfirmed or still owns reusable sessions or unresolved cleanup; close them before retirement.");
  const historical = findHistorical(receipt, revision);
  const gateway = receipt.functions.find(item => item.role === "gateway");
  if (!gateway || !receipt.aliasName) throw new ApplicationError("Current Gateway publication ownership is missing.");
  await inspectOwned(receipt, services, gateway);
  const versions = historical.publishedVersions ?? (historical.gatewayVersion ? [historical.gatewayVersion] : []);
  const alias = await services.fc.describeAlias(gateway.functionName, receipt.aliasName);
  if (alias !== receipt.gatewayVersion || versions.includes(alias)) throw new ApplicationError("Retirement would affect the current stable Gateway version.");
  let failed = false;
  const remove = async (kind: string, identity: string, effect: () => Promise<void>): Promise<void> => {
    let entry = receipt.cleanup.find(item => item.kind === kind && item.identity === identity);
    if (entry?.status === "confirmed") return;
    if (!entry) { entry = { kind, identity, status: "pending" }; receipt.cleanup.push(entry); }
    receipt.phase = `retire-${revision}-${kind}`; save(file, receipt);
    try { await effect(); entry.status = "confirmed"; } catch { entry.status = "uncertain"; failed = true; }
    save(file, receipt);
  };
  for (const role of ["dispatcher", "worker"] as const) {
    const item = historical.functions.find(value => value.role === role); if (!item) throw new ApplicationError("Historical ownership receipt is missing.");
    await remove("function", item.functionName, async () => {
      const body = await services.fc.describeFunction(item.functionName); if (!body) return;
      verifyFunction(body, receipt.accountId, receipt.plan.template.application.deployment.region, item.functionName, item);
      if (role === "dispatcher") await services.fc.deleteTrigger(item.functionName, "abx-dispatch");
      await services.fc.deleteFunction(item.functionName);
    });
  }
  for (const version of versions) await remove("version", `${gateway.functionName}/${version}`, async () => {
    if (!await services.fc.hasVersion(gateway.functionName, version)) return;
    await services.fc.deleteVersion(gateway.functionName, version);
    if (await services.fc.hasVersion(gateway.functionName, version)) throw new ApplicationError("Retired version remains present.");
  });
  if (!failed && retired.template !== receipt.sandbox?.reference && !receipt.retained.some(item => item.revision !== revision && item.template === retired.template)) await remove("template", retired.template, () => services.deleteTemplate(historical.sandbox!));
  if (!failed && historical.plan.ownedServerImage && receipt.plan.image !== historical.plan.image && !receipt.retained.some(item => item.revision !== revision && findHistorical(receipt, item.revision).plan.image === historical.plan.image)) {
    await remove("server-image", historical.plan.ownedServerImage.localTag, async () => { if (!services.removeImage) throw new ApplicationError("Owned image cleanup is unavailable."); await services.removeImage(historical.plan.ownedServerImage!); });
  } else if (historical.plan.ownedServerImage) {
    receipt.retainedImages ??= [];
    if (!receipt.retainedImages.some(image => image.localTag === historical.plan.ownedServerImage!.localTag)) receipt.retainedImages.push(historical.plan.ownedServerImage);
  }
  if (failed) throw new ApplicationError("Retirement cleanup remains unconfirmed; the retained revision and successful progress were saved for retry.");
  receipt.retained = receipt.retained.filter(item => item.revision !== revision); receipt.phase = "ready"; save(file, receipt); return receipt;
}
function findHistorical(receipt: ApplicationReceipt, revision: string): ApplicationReceipt {
  let current = receipt; const seen = new Set<string>();
  while (current.plan.revision !== revision) {
    const file = current.plan.previousReceipt;
    if (!file || seen.has(file)) throw new ApplicationError("Retained resource history is incomplete; deletion withheld.");
    seen.add(file); current = readReceipt(file);
  }
  return current;
}
/** Drain is durable and bounded. Unknown resources retain the only worker/control path. */
export async function destroyPlan(plan: ApplicationPlan, services: ApplicationServices): Promise<ApplicationReceipt> {
  if (plan.operation !== "destroy" || !plan.previousReceipt) throw new ApplicationError("Destroy requires a reviewed destruction plan.");
  assertPlan(plan); const file = plan.previousReceipt, receipt = readReceipt(file); validateBinding(receipt.plan, services, receipt);
  const history = [receipt, ...receipt.retained.map(item => findHistorical(receipt, item.revision))];
  for (const item of history) {
    const templates = item.sandbox?.resources.filter(resource => resource.kind === "template") ?? [], created = templates.filter(resource => resource.state === "created");
    if (templates.some(resource => ["intent", "uncertain"].includes(resource.state)) || created.length > 1 || (created.length === 1 && created[0].id !== item.sandbox?.reference)) throw new ApplicationError("Sandbox template creation remains uncertain; preserve the exact native journal and reconcile before declaring destruction complete.");
  }
  if (receipt.cleanup.some(item => item.kind === "function" && item.status === "uncertain" && !history.some(older => older.functions.some(owned => owned.functionName === item.identity)))) throw new ApplicationError("Uncertain resource ownership blocks automatic destruction; reconcile first.");
  const recordedGateways = history.flatMap(item => item.functions.filter(resource => resource.role === "gateway"));
  if (new Set(recordedGateways.map(item => digest([item.functionName, item.functionArn, item.functionId, item.createdTime]))).size > 1) throw new ApplicationError("Historical Gateway ownership is inconsistent; deletion withheld.");
  const gateway = recordedGateways[0];
  receipt.status = "destroying"; receipt.phase = "drain"; save(file, receipt);
  if (history.some(item => item.executionMayHaveStarted || item.status === "ready" || item.endpoint) && !receipt.drainConfirmed) {
    // An update can fail before creating its Dispatcher while retained production Sessions exist.
    // Prefer the current controller; an older controller may only confirm zero after every
    // revision is actually quiescent. Native absence permits fallback, identity mismatch does not.
    let controller: FunctionReceipt | undefined;
    for (const candidate of history.flatMap(item => item.functions.filter(resource => resource.role === "dispatcher"))) {
      const body = await services.fc.describeFunction(candidate.functionName);
      if (!body) continue;
      verifyFunction(body, receipt.accountId, receipt.plan.template.application.deployment.region, candidate.functionName, candidate);
      controller = candidate; break;
    }
    const activity = await control(receipt, services, "drain", undefined, controller);
    if (activity.draining !== true || !drained(activity)) { receipt.status = "requires_reconcile"; save(file, receipt); throw new ApplicationError("Application drain is still active; resources were retained. Observe cleanup and prepare a fresh destruction plan."); }
    receipt.drainConfirmed = true; save(file, receipt);
  }
  const functions = new Map<string, FunctionReceipt>();
  for (const older of history) for (const item of older.functions) if (item.role !== "gateway") functions.set(item.functionName, item);
  let failed = false;
  const cleanup = async (kind: string, identity: string, action: () => Promise<void>): Promise<void> => {
    let entry = receipt.cleanup.find(value => value.kind === kind && value.identity === identity);
    if (entry?.status === "confirmed") return;
    if (!entry) { entry = { kind, identity, status: "pending" }; receipt.cleanup.push(entry); }
    receipt.phase = `delete-${kind}`; save(file, receipt);
    try { await action(); entry.status = "confirmed"; }
    catch { entry.status = "uncertain"; failed = true; }
    save(file, receipt);
  };
  const removeFunction = async (item: FunctionReceipt): Promise<void> => {
    const body = await services.fc.describeFunction(item.functionName); if (!body) return;
    verifyFunction(body, receipt.accountId, receipt.plan.template.application.deployment.region, item.functionName, item);
    if (item.role === "dispatcher") await services.fc.deleteTrigger(item.functionName, "abx-dispatch");
    await services.fc.deleteFunction(item.functionName);
  };
  for (const item of functions.values()) await cleanup("function", item.functionName, () => removeFunction(item));
  if (gateway) await cleanup("function", gateway.functionName, async () => {
    const body = await services.fc.describeFunction(gateway.functionName); if (!body) return;
    verifyFunction(body, receipt.accountId, receipt.plan.template.application.deployment.region, gateway.functionName, gateway);
    await services.fc.deleteTrigger(gateway.functionName, "abx-gateway");
    for (const trigger of new Set(history.flatMap(item => item.candidateTrigger ? [item.candidateTrigger] : []))) await services.fc.deleteTrigger(gateway.functionName, trigger);
    for (const alias of new Set(history.flatMap(item => item.aliasName ? [item.aliasName] : []))) await services.fc.deleteAlias(gateway.functionName, alias);
    for (const version of new Set(history.flatMap(item => item.publishedVersions ?? (item.gatewayVersion ? [item.gatewayVersion] : [])))) await services.fc.deleteVersion(gateway.functionName, version);
    await services.fc.deleteFunction(gateway.functionName);
  });
  for (const sandbox of new Map(history.filter(item => item.sandbox?.reference).map(item => [item.sandbox!.reference, item.sandbox!])).values()) await cleanup("template", sandbox.reference, () => services.deleteTemplate(sandbox));
  if (!failed) for (const image of new Map(history.flatMap(item => [...(item.plan.ownedServerImage ? [item.plan.ownedServerImage] : []), ...(item.retainedImages ?? [])]).map(image => [image.localTag, image])).values()) await cleanup("server-image", image.localTag, async () => {
    if (!services.removeImage) throw new ApplicationError("Owned image cleanup is unavailable."); await services.removeImage(image);
  });
  if (failed) { receipt.status = "requires_reconcile"; save(file, receipt); throw new ApplicationError("Some owned resources could not be confirmed absent; successful cleanup was retained. Reconcile and prepare a fresh destruction plan."); }
  receipt.cleanup.forEach(item => { item.status = "confirmed"; }); if (receipt.sandbox) receipt.sandbox.resources.forEach(item => { if (item.kind === "template") item.state = "deleted"; });
  receipt.retained = []; receipt.status = "destroyed"; receipt.phase = "destroyed"; save(file, receipt); return receipt;
}
/** Host hook protocol: file IDs are fixed; diagnostics never include unfiltered child output. */
export async function runHooks(phase: "beforeApply" | "afterReady", receipt: ApplicationReceipt, endpoint?: string, token?: string): Promise<void> {
  const hooks = receipt.plan.template.application.hooks?.[phase] ?? [];
  for (const hook of hooks) {
    if (hook.type !== "custom") continue;
    const directory = fs.mkdtempSync(path.join(receipt.plan.projectRoot, ".abx", "hook-"));
    const context = path.join(directory, "context.json"), result = path.join(directory, "result.json");
    writeJson(context, { schemaVersion: 1, hookId: hook.id, phase, applicationId: appId(receipt.plan.template), revision: receipt.plan.revision, operationId: receipt.operationId, planId: receipt.plan.id, inputDirectory: receipt.plan.projectRoot, resources: receipt.functions.map(item => ({ role: item.role, functionName: item.functionName })) });
    const env: Record<string, string> = {};
    for (const key of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "LANG", "LC_ALL", ...(hook.envAllowlist ?? [])]) if (process.env[key]) env[key] = process.env[key]!;
    Object.assign(env, { ABX_HOOK_CONTEXT_FILE: context, ABX_HOOK_RESULT_FILE: result, ...(endpoint ? { ABX_CANDIDATE_ENDPOINT: endpoint } : {}), ...(token ? { ABX_CANDIDATE_TOKEN: token } : {}) });
    try {
      await execute({ argv: hook.argv!, cwd: path.resolve(receipt.plan.projectRoot, hook.cwd ?? "."), env, timeoutSeconds: hook.timeoutSeconds ?? 60, maxBytes: 1024 * 1024 });
      const output: unknown = JSON.parse(fs.readFileSync(result, "utf8"));
      if (!record(output) || output.schemaVersion !== 1 || output.hookId !== hook.id || output.operationId !== receipt.operationId || output.status !== "passed") throw new Error("Hook receipt mismatch");
    } catch { throw new ApplicationError(`Application hook '${hook.id}' did not confirm success; raw diagnostics were withheld.`); }
    finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
}
