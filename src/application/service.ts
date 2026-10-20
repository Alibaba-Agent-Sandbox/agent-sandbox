/** Explicit application plans, durable local receipts and replaceable deployment adapters. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { stringify } from "yaml";
import { ApplicationError, contained, digest, readTemplate, readToolchain, serverlessProject, sourceDigest, toolDigest } from "./config.js";
import { execute, operationId, runHook } from "./process.js";
import type { ApplicationPlan, ApplicationReceipt, FunctionReceipt, ServerlessProject } from "./types.js";

export interface ApplicationServices {
  prepare(plan: ApplicationPlan): Promise<{ provider: string; reference: string; ownership: "created" }>;
  deleteTemplate(provider: string, reference: string): Promise<void>;
  invoke(plan: ApplicationPlan, project: ServerlessProject, command: "info" | "deploy" | "remove"): Promise<unknown>;
  smoke(endpoint: string, revision: string): Promise<void>;
  templateExists(provider: string, reference: string): Promise<boolean>;
  describe(plan: ApplicationPlan, project: ServerlessProject): Promise<{ accountId: string; functions: Record<string, Record<string, unknown> | null> }>;
  reserve(plan: ApplicationPlan, project: ServerlessProject, onCreated: (logicalName: string, body: Record<string, unknown>) => void): Promise<void>;
}
/** Reject output symlinks before creating state or writing generated artifacts. */
export function assertOutputPath(file: string): void {
  const absolute = path.resolve(file), root = path.parse(absolute).root;
  let current = root;
  for (const part of path.relative(root, absolute).split(path.sep)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new ApplicationError("Application output paths must not traverse symlinks."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}
/** Default bounded HTTP health probe; runtime credentials never enter published URLs. */
export async function probe(endpoint: string, revision: string): Promise<void> {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new ApplicationError("Published endpoint must be an unsigned HTTPS URL.");
  url.pathname = "/healthz";
  const response = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: "error" });
  if (!response.ok) throw new ApplicationError("Candidate gateway health probe failed.");
  if (!response.body) throw new ApplicationError("Candidate gateway health contract is missing.");
  const reader = response.body.getReader(); let bytes = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength; if (bytes > 4096) throw new ApplicationError("Candidate health response exceeded its budget."); chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    const operations = body.operations;
    if (body.status !== "ok" || body.revision !== revision || body.protocol !== "agent-sandbox-runs/v1" || !Array.isArray(operations) || ["create", "get", "cancel", "events", "result", "artifact"].some(operation => !operations.includes(operation))) throw new ApplicationError("Candidate gateway protocol/revision does not match the planned application.");
  } finally { await reader.cancel(); }
}
/** Write receipts atomically, with no raw SD responses or credentials. */
export function writeJson(file: string, value: unknown): void {
  assertOutputPath(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, file);
}
function makeId(input: Omit<ApplicationPlan, "id">): string { return `plan_${digest(input)}`; }
/** Produce an offline plan: no hook, provider build or s subprocess is invoked. */
export function planApplication(file: string, now = new Date()): ApplicationPlan {
  file = fs.realpathSync(file);
  const root = path.dirname(file), template = readTemplate(file), serverless = serverlessProject(template, root);
  const input: Omit<ApplicationPlan, "id"> = {
    schemaVersion: 1, kind: "ApplicationPlan", operation: "apply", createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 3600000).toISOString(), projectRoot: root,
    templateFile: path.basename(file), sourceDigest: sourceDigest(root), template,
    serverless, toolchain: readToolchain(template, root, serverless),
  };
  return { ...input, id: makeId(input) };
}
/** Validate stored plan checksums and all inputs again before a mutating operation. */
export function verifyPlan(plan: ApplicationPlan, expiry = true, frozenOnly = false): void {
  const { id, ...input } = plan;
  if (plan.schemaVersion !== 1 || plan.kind !== "ApplicationPlan" || !["apply", "destroy"].includes(plan.operation) || id !== makeId(input)) throw new ApplicationError("Invalid application plan checksum or format.");
  if (expiry && (!Number.isFinite(Date.parse(plan.expiresAt)) || Date.parse(plan.expiresAt) <= Date.now())) throw new ApplicationError("Application plan has expired; create a new plan.");
  if (frozenOnly || plan.operation === "destroy") return;
  if (sourceDigest(plan.projectRoot) !== plan.sourceDigest) throw new ApplicationError("Project inputs changed; create a new plan.");
  const actual = readTemplate(contained(plan.projectRoot, plan.templateFile));
  if (digest(actual) !== digest(plan.template) || digest(serverlessProject(actual, plan.projectRoot)) !== digest(plan.serverless) || digest(readToolchain(actual, plan.projectRoot, plan.serverless)) !== digest(plan.toolchain)) throw new ApplicationError("Application plan does not match current configuration.");
}
/** Verify the complete local execution bundles rather than an npm launcher alone. */
export function verifyTools(plan: ApplicationPlan): void {
  const lock = plan.toolchain;
  if (!lock) return;
  if (createHash("sha256").update(fs.readFileSync(process.execPath)).digest("hex") !== lock.node.sha256 || toolDigest(lock.serverlessDevs.directory) !== lock.serverlessDevs.sha256 || toolDigest(lock.fc3.directory) !== lock.fc3.sha256) throw new ApplicationError("Locked Node/Serverless Devs/fc3 bundle changed or is unavailable.");
  const relative = path.relative(lock.serverlessDevs.directory, lock.serverlessDevs.executable);
  contained(lock.serverlessDevs.directory, relative);
  for (const [directory, version] of [[lock.serverlessDevs.directory, lock.serverlessDevs.version], [lock.fc3.directory, lock.fc3.version]]) {
    const pkg = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8")) as { version: string; main?: string };
    if (pkg.version !== version) throw new ApplicationError("Installed tool version does not match its lock.");
    if (pkg.main) contained(directory, pkg.main);
  }
}
/** Invoke only a verified local s bundle, with verified fc3 loaded by absolute path. */
export async function invokeServerless(plan: ApplicationPlan, project: ServerlessProject, command: "info" | "deploy" | "remove", environment: NodeJS.ProcessEnv = process.env): Promise<unknown> {
  verifyTools(plan);
  const lock = plan.toolchain!, location = fs.mkdtempSync(path.join(os.tmpdir(), "abx-app-s-work-"));
  const actual = structuredClone(project);
  for (const resource of Object.values(actual.resources)) resource.component = lock.fc3.directory;
  const file = path.join(location, "s.yaml");
  fs.writeFileSync(file, stringify(actual), { mode: 0o600 });
  const argv = [process.execPath, lock.serverlessDevs.executable, "-t", file, "-a", plan.template.application.deployment.accessRef!, "-o", "json", "--silent", command];
  if (command !== "info") argv.push("--assume-yes");
  // Functions are atomically created by the SDK first; SD must never upsert them.
  if (command === "deploy") argv.push("--trigger", "--async-invoke-config");
  const env = { ...environment };
  delete env.core_load_serverless_devs_component;
  delete env.ALIYUN_DEVS_REMOTE_PROJECT_NAME;
  for (const key of ["NODE_OPTIONS", "NODE_PATH", "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH"]) delete env[key];
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "abx-app-s-home-"));
  env.serverless_devs_config_home = home;
  try {
    const output = await execute({ argv, cwd: location, env, timeoutSeconds: command === "info" ? 60 : 900 });
    verifyTools(plan);
    if (command !== "info") return null;
    try { return JSON.parse(output) as unknown; } catch { throw new ApplicationError("Serverless Devs returned an unsupported JSON envelope; inspect resources before retrying."); }
  } finally { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(location, { recursive: true, force: true }); }
}
/** Keep only identity/readiness data from fc3's current flat GetFunction envelope. */
export function normalizeInfo(raw: unknown, project: ServerlessProject): FunctionReceipt[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ApplicationError("Unsupported fc3 info response.");
  const data = raw as Record<string, unknown>, names = Object.keys(project.resources);
  return names.map(logicalName => {
    const candidate = names.length === 1 && typeof data.functionName === "string" ? data : data[logicalName];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new ApplicationError("fc3 info omitted a planned function.");
    const body = candidate as Record<string, unknown>, wanted = project.resources[logicalName].props;
    const image = (wanted.customContainerConfig as Record<string, unknown>).image as string;
    const actual = body.customContainerConfig as Record<string, unknown> | undefined;
    if (body.region !== wanted.region || body.functionName !== wanted.functionName || typeof body.functionArn !== "string" || !/^acs:fc:[a-z0-9-]+:\d+:/.test(body.functionArn) || typeof body.functionId !== "string" || !body.functionId || typeof body.createdTime !== "string" || !body.createdTime) throw new ApplicationError("fc3 returned an unexpected native function identity.");
    if (body.state !== "Active" || (body.lastUpdateStatus !== undefined && body.lastUpdateStatus !== "Successful") || actual?.resolvedImageUri !== image) throw new ApplicationError("FC candidate is not Active/Successful at the planned image digest.");
    const url = body.url as Record<string, unknown> | undefined;
    const endpoint = typeof url?.system_url === "string" ? url.system_url : undefined;
    if (endpoint) { const parsed = new URL(endpoint); if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) throw new ApplicationError("FC endpoint contains unsupported authentication or URL fields."); }
    return { logicalName, nativeId: body.functionArn, region: body.region as string, functionName: body.functionName as string, functionId: body.functionId, createdTime: body.createdTime, image, ownership: "created", state: "Active", ...(endpoint ? { endpoint } : {}) };
  });
}
function receiptFile(plan: ApplicationPlan): string { return path.join(plan.projectRoot, ".abx", "app", plan.id, "receipt.json"); }
async function withLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  const directory = path.join(root, ".abx", "app"); assertOutputPath(directory); fs.mkdirSync(directory, { recursive: true });
  const lock = path.join(directory, "operation.lock");
  try { fs.mkdirSync(lock); } catch { throw new ApplicationError("Another local deployment holds the application lock; inspect it before recovery. Shared CI requires an external lock."); }
  try { return await action(); } finally { fs.rmdirSync(lock); }
}
function runtimeProject(plan: ApplicationPlan, reference: string): ServerlessProject {
  const project = structuredClone(plan.serverless!);
  const app = plan.template.application;
  const spec = JSON.stringify({ name: plan.template.name, runtime: app.runtime, sandbox: app.sandbox, state: app.state, bindings: app.bindings, limits: app.limits });
  for (const resource of Object.values(project.resources)) resource.props.environmentVariables = {
    ...(resource.props.environmentVariables as Record<string, string> ?? {}), ABX_APP_REVISION: plan.id,
    ABX_APP_SANDBOX_TEMPLATE: reference, ABX_APP_SANDBOX_PROVIDER: app.sandbox.provider, ABX_APP_SPEC_JSON: spec,
  };
  return project;
}
function persist(receipt: ApplicationReceipt): ApplicationReceipt {
  receipt.updatedAt = new Date().toISOString(); writeJson(receiptFile(receipt.plan), receipt); return receipt;
}
function ownedBinding(body: Record<string, unknown>, spec: Record<string, unknown>): boolean {
  const actual = body.environmentVariables as Record<string, unknown> | undefined;
  const expected = spec.environmentVariables as Record<string, string>;
  return Boolean(actual && expected && ["ABX_APP_REVISION", "ABX_APP_SANDBOX_TEMPLATE", "ABX_APP_SANDBOX_PROVIDER", "ABX_APP_SPEC_JSON"].every(key => actual[key] === expected[key]));
}
function incarnation(resource: FunctionReceipt, body: Record<string, unknown>): boolean {
  return body.functionArn === resource.nativeId && body.functionId === resource.functionId && body.createdTime === resource.createdTime;
}
async function verifyIdentities(receipt: ApplicationReceipt, project: ServerlessProject, services: ApplicationServices): Promise<void> {
  const observed = await services.describe(receipt.plan, project);
  if (observed.accountId !== receipt.accountId) throw new ApplicationError("Deployment account changed; refuse to operate on another account.");
  for (const [name, specification] of Object.entries(project.resources)) {
    const live = observed.functions[name];
    if (!live || !ownedBinding(live, specification.props)) throw new ApplicationError("Remote function does not carry this operation's immutable runtime bindings; ownership is unconfirmed.");
  }
  for (const resource of receipt.resources) {
    const live = observed.functions[resource.logicalName];
    if (!live || live.functionArn !== resource.nativeId || live.functionId !== resource.functionId || live.createdTime !== resource.createdTime) throw new ApplicationError("Remote native resource identity changed; inspect replacement before continuing.");
  }
}
/** Apply once; an uncertain result is reconciled, never silently replayed or removed. */
export async function applyApplication(plan: ApplicationPlan, services: ApplicationServices): Promise<ApplicationReceipt> {
  verifyPlan(plan);
  if (plan.operation !== "apply") throw new ApplicationError("Expected an apply plan.");
  return await withLock(plan.projectRoot, async () => {
    if (fs.existsSync(receiptFile(plan))) {
      const old = readReceipt(receiptFile(plan));
      if (old.status === "ready") return old;
      throw new ApplicationError("This operation already has a receipt; reconcile it instead of applying again.");
    }
    const operation = operationId();
    for (const hook of plan.template.application.hooks?.beforeApply ?? []) await runHook(hook, "beforeApply", plan, operation);
    verifyPlan(plan); verifyTools(plan);
    const before = plan.serverless ? await services.describe(plan, plan.serverless) : null;
    if (before && (Object.keys(before.functions).length !== Object.keys(plan.serverless!.resources).length || Object.values(before.functions).some(f => f !== null))) throw new ApplicationError("A planned FC function already exists or could not be inspected; choose fresh revision names. Existing functions are never imported or overwritten.");
    // Receipt exists before the first external side effect, including provider preparation.
    const receipt = persist({ schemaVersion: 1, kind: "ApplicationReceipt", plan, operationId: operation, intent: "apply", accountId: before?.accountId, status: "applying", resources: [], updatedAt: "" });
    try {
      receipt.sandboxTemplate = await services.prepare(plan); persist(receipt);
      verifyPlan(plan);
      if (plan.serverless) {
        const project = runtimeProject(plan, receipt.sandboxTemplate.reference);
        await services.reserve(plan, project, (logicalName, body) => {
          const specification = project.resources[logicalName].props;
          if (typeof body.functionArn !== "string" || typeof body.functionId !== "string" || typeof body.createdTime !== "string") throw new ApplicationError("CreateFunction omitted native creation identity; reconcile before continuing.");
          receipt.resources.push({ logicalName, nativeId: body.functionArn, functionId: body.functionId, createdTime: body.createdTime,
            region: specification.region as string, functionName: specification.functionName as string,
            image: (specification.customContainerConfig as { image: string }).image, ownership: "created", state: String(body.state ?? "Creating") });
          persist(receipt);
        });
        await verifyIdentities(receipt, project, services);
        await services.invoke(plan, project, "deploy");
        const ready = normalizeInfo(await services.invoke(plan, project, "info"), project);
        for (const created of receipt.resources) {
          const live = ready.find(resource => resource.logicalName === created.logicalName);
          if (!live || live.nativeId !== created.nativeId || live.functionId !== created.functionId || live.createdTime !== created.createdTime) throw new ApplicationError("Native function was replaced during deployment.");
        }
        receipt.resources = ready; persist(receipt);
        await verifyIdentities(receipt, project, services);
        const endpoint = receipt.resources.find(r => r.logicalName === "gateway")?.endpoint;
        if (!endpoint) throw new ApplicationError("Candidate gateway has no verified HTTPS endpoint.");
        await services.smoke(endpoint, plan.id);
        for (const hook of plan.template.application.hooks?.afterReady ?? []) await runHook(hook, "afterReady", plan, receipt.operationId, receipt.resources.map(r => ({ logicalId: r.logicalName, nativeId: r.nativeId, ownership: "owned" })));
      }
      receipt.status = "ready"; return persist(receipt);
    } catch {
      receipt.status = "requires_reconcile"; persist(receipt);
      throw new ApplicationError("Application operation needs reconciliation. Its receipt was saved; no broad rollback or automatic retry was attempted.");
    }
  });
}
/** Validate a receipt without printing its inputs or any cloud response. */
export function readReceipt(file: string): ApplicationReceipt {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as ApplicationReceipt;
  if (raw.schemaVersion !== 1 || raw.kind !== "ApplicationReceipt" || !["apply", "destroy"].includes(raw.intent) || !["applying", "requires_reconcile", "ready", "destroying", "destroyed"].includes(raw.status) || !Array.isArray(raw.resources)) throw new ApplicationError("Invalid deployment receipt.");
  const { id, ...plan } = raw.plan;
  if (id !== makeId(plan)) throw new ApplicationError("Receipt plan checksum does not match.");
  return raw;
}
/** Re-observe uncertain deployment without creating resources; afterReady must pass again. */
export async function reconcileApplication(file: string, services: ApplicationServices): Promise<ApplicationReceipt> {
  let receipt = readReceipt(file); const plan = receipt.plan;
  verifyPlan(plan, false, true);
  return await withLock(plan.projectRoot, async () => {
    receipt = readReceipt(file);
    if (receipt.status === "destroyed") return receipt;
    if (receipt.intent === "destroy") {
      if (plan.serverless) {
        const state = await services.describe(plan, plan.serverless);
        if (state.accountId !== receipt.accountId || receipt.resources.some(resource => state.functions[resource.logicalName] !== null)) throw new ApplicationError("Function absence is not confirmed; no destructive operation was replayed.");
      }
      if (!receipt.sandboxTemplate) throw new ApplicationError("Template cleanup outcome is unavailable.");
      if (await services.templateExists(receipt.sandboxTemplate.provider, receipt.sandboxTemplate.reference)) throw new ApplicationError("Owned template still exists; inspect cleanup before creating a recovery operation.");
      receipt.status = "destroyed"; return persist(receipt);
    }
    if (!receipt.sandboxTemplate) throw new ApplicationError("Sandbox preparation outcome is unknown; inspect the provider before continuing.");
    if (!await services.templateExists(receipt.sandboxTemplate.provider, receipt.sandboxTemplate.reference)) throw new ApplicationError("Prepared template no longer exists; reconciliation does not rebuild it.");
    if (plan.serverless) {
      const project = runtimeProject(plan, receipt.sandboxTemplate.reference);
      const observed = await services.describe(plan, project);
      if (observed.accountId !== receipt.accountId) throw new ApplicationError("Deployment account changed.");
      for (const previous of receipt.resources) {
        const live = observed.functions[previous.logicalName];
        if (live && !incarnation(previous, live)) throw new ApplicationError("Remote native resource identity changed; reconciliation cannot adopt a replacement.");
      }
      // Resolve an ambiguous create response using this revision's immutable runtime bindings.
      for (const [name, spec] of Object.entries(project.resources)) {
        const body = observed.functions[name];
        if (!receipt.resources.some(resource => resource.logicalName === name) && body && ownedBinding(body, spec.props)) {
          if (typeof body.functionArn !== "string" || typeof body.functionId !== "string" || typeof body.createdTime !== "string") throw new ApplicationError("Observed creation identity is incomplete.");
          receipt.resources.push({ logicalName: name, nativeId: body.functionArn, functionId: body.functionId, createdTime: body.createdTime,
            region: spec.props.region as string, functionName: spec.props.functionName as string, image: (spec.props.customContainerConfig as { image: string }).image,
            ownership: "created", state: String(body.state ?? "Unknown") });
        }
      }
      receipt.status = "requires_reconcile"; persist(receipt);
      if (Object.entries(project.resources).some(([name, spec]) => !observed.functions[name] || !ownedBinding(observed.functions[name]!, spec.props))) return receipt;
      await verifyIdentities(receipt, project, services);
      const refreshed = normalizeInfo(await services.invoke(plan, project, "info"), project);
      for (const previous of receipt.resources) {
        const next = refreshed.find(r => r.logicalName === previous.logicalName);
        if (!next || next.nativeId !== previous.nativeId || next.functionId !== previous.functionId || next.createdTime !== previous.createdTime) throw new ApplicationError("Remote native resource identity changed; reconciliation cannot adopt a replacement.");
      }
      receipt.resources = refreshed;
      await verifyIdentities(receipt, project, services);
      const endpoint = receipt.resources.find(r => r.logicalName === "gateway")?.endpoint;
      if (!endpoint) throw new ApplicationError("Candidate gateway endpoint is unavailable.");
      await services.smoke(endpoint, plan.id);
      if ((plan.template.application.hooks?.afterReady ?? []).length) verifyPlan(plan, false);
      for (const hook of plan.template.application.hooks?.afterReady ?? []) await runHook(hook, "afterReady", plan, receipt.operationId, receipt.resources.map(r => ({ logicalId: r.logicalName, nativeId: r.nativeId, ownership: "owned" })));
    }
    receipt.status = "ready"; return persist(receipt);
  });
}
/** Destruction is a separate accepted plan bound to the exact saved receipt. */
export function planDestroy(file: string): ApplicationPlan {
  const receipt = readReceipt(file);
  if (!["ready", "requires_reconcile"].includes(receipt.status) || !receipt.sandboxTemplate || receipt.intent !== "apply") throw new ApplicationError("Destruction requires a deployment receipt with an owned prepared template; reconcile unknown preparation first.");
  const { id: _id, ...original } = receipt.plan;
  const now = new Date();
  const input: Omit<ApplicationPlan, "id"> = { ...original, operation: "destroy", createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3600000).toISOString(), receiptPath: fs.realpathSync(file), receiptDigest: digest(receipt) };
  return { ...input, id: makeId(input) };
}
/** Delete only functions created by this operation, after matching live native identities. */
export async function destroyApplication(plan: ApplicationPlan, services: ApplicationServices): Promise<ApplicationReceipt> {
  verifyPlan(plan);
  if (plan.operation !== "destroy" || !plan.receiptPath) throw new ApplicationError("Expected a separate accepted destroy plan.");
  return await withLock(plan.projectRoot, async () => {
    const receipt = readReceipt(plan.receiptPath!);
    if (receipt.status === "destroyed") return receipt;
    if (digest(receipt) !== plan.receiptDigest || !["ready", "requires_reconcile"].includes(receipt.status)) throw new ApplicationError("Receipt changed; create a new destroy plan.");
    if (!receipt.sandboxTemplate || receipt.sandboxTemplate.ownership !== "created") throw new ApplicationError("Template ownership is not established.");
    let removal: ServerlessProject | null = null;
    if (plan.serverless) {
      const project = runtimeProject(receipt.plan, receipt.sandboxTemplate.reference), state = await services.describe(receipt.plan, project);
      if (state.accountId !== receipt.accountId) throw new ApplicationError("Deployment account changed; refuse destruction.");
      removal = { ...project, resources: {} };
      for (const [name, spec] of Object.entries(project.resources)) {
        const live = state.functions[name], saved = receipt.resources.find(resource => resource.logicalName === name);
        if (!saved) {
          if (live && ownedBinding(live, spec.props)) throw new ApplicationError("An ambiguous created resource needs reconciliation before destruction.");
          continue; // A foreign function that won a create race is never removed.
        }
        if (live) {
          if (!incarnation(saved, live) || !ownedBinding(live, spec.props)) throw new ApplicationError("Remote native resource identity changed; refuse removal.");
          removal.resources[name] = spec;
        }
      }
    }
    receipt.status = "destroying"; receipt.intent = "destroy"; persist(receipt);
    try {
      if (removal && Object.keys(removal.resources).length) await services.invoke(receipt.plan, removal, "remove");
      if (plan.serverless) {
        const observed = await services.describe(receipt.plan, plan.serverless);
        if (observed.accountId !== receipt.accountId || receipt.resources.some(resource => observed.functions[resource.logicalName] !== null)) throw new ApplicationError("Remote function absence is not confirmed.");
      }
      await services.deleteTemplate(receipt.sandboxTemplate.provider, receipt.sandboxTemplate.reference);
      if (await services.templateExists(receipt.sandboxTemplate.provider, receipt.sandboxTemplate.reference)) throw new ApplicationError("Template absence is not confirmed.");
      receipt.status = "destroyed"; return persist(receipt);
    } catch {
      receipt.status = "requires_reconcile"; persist(receipt);
      throw new ApplicationError("Destruction requires remote absence reconciliation; the resource receipt was preserved.");
    }
  });
}
/** Public CLI summary intentionally omits all raw configuration/tool output. */
export function receiptSummary(receipt: ApplicationReceipt): Record<string, unknown> {
  return { operation_id: receipt.operationId, plan_id: receipt.plan.id, status: receipt.status, receipt: receiptFile(receipt.plan), sandbox_template: receipt.sandboxTemplate, resources: receipt.resources };
}
