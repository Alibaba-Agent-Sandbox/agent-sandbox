/** Offline application validation and immutable source/tool identities. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseDocument } from "yaml";
import { resolveProject, type PrivateProject, type ProjectResolutionOptions } from "../template/project.js";
import { validateManagedInstance } from "./instance.js";
import { DeployError } from "../models/errors.js";
import type { ApplicationTemplate, ApplicationPlan, BuildReceipt, ToolchainLock } from "./types.js";

export class ApplicationError extends DeployError {}
const ignored = new Set([".git", ".abx", ".agents", "node_modules", ".venv", "__pycache__", ".pytest_cache"]);
export const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Stable SHA-256 of JSON, independent of object key insertion order. */
export function digest(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : record(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : v;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
/** Existing project input without traversal, absolute paths or symlink escape. */
export function contained(root: string, relative: string): string {
  if (!relative || path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative) || relative.includes("\\") || /[\x00-\x1f]/.test(relative) || relative.split("/").includes("..")) throw new ApplicationError("Expected a contained project-relative path.");
  const result = fs.realpathSync(path.resolve(root, relative));
  const rel = path.relative(fs.realpathSync(root), result);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new ApplicationError("Application input escapes its project.");
  return result;
}
/** A source snapshot excludes local secrets and generated/engineering metadata. */
export function sourceDigest(root: string): string {
  const rows: Array<[string, string]> = [];
  const walk = (directory: string): void => {
    for (const name of fs.readdirSync(directory).sort()) {
      if (ignored.has(name) || name === ".env" || name.startsWith(".env.")) continue;
      const file = path.join(directory, name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new ApplicationError("Symlinked application inputs are unsupported.");
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) rows.push([path.relative(root, file), createHash("sha256").update(fs.readFileSync(file)).digest("hex")]);
      else throw new ApplicationError("Application inputs must be regular files.");
    }
  };
  walk(root); return digest(rows);
}
/** Digest the complete installed tool tree, with contained symbolic links only. */
export function toolDigest(root: string): string {
  const rows: Array<[string, string]> = [], absolute = fs.realpathSync(root);
  const walk = (directory: string): void => {
    for (const name of fs.readdirSync(directory).sort()) {
      if (name === ".git") continue;
      const file = path.join(directory, name), stat = fs.lstatSync(file), relative = path.relative(root, file);
      if (stat.isSymbolicLink()) {
        const target = path.relative(absolute, fs.realpathSync(file));
        if (target === ".." || target.startsWith(`..${path.sep}`) || path.isAbsolute(target)) throw new ApplicationError("Tool dependencies escape the locked bundle.");
        rows.push([relative, `link:${target}`]);
      } else if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) rows.push([relative, createHash("sha256").update(fs.readFileSync(file)).digest("hex")]);
      else throw new ApplicationError("Unsupported tool bundle entry.");
    }
  };
  walk(root); return digest(rows);
}
/** Plans must contain references, not credential literals or credential-bearing URLs. */
export function rejectInlineSecrets(value: unknown, trail: string[] = []): void {
  if (Array.isArray(value)) { value.forEach(child => rejectInlineSecrets(child, trail)); return; }
  if (record(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (/(?:access_?key_?(?:id|secret)|password|api_?key|private_?key|secret|token)$/i.test(key) && child !== "" && child !== null && child !== undefined && !(typeof child === "string" && /^\$\{[\s\S]+\}$/.test(child))) throw new ApplicationError("Credential literals are not allowed in plans; use native configuration references.");
      rejectInlineSecrets(child, [...trail, key]);
    }
  } else if (typeof value === "string" && (/[a-z][a-z0-9+.-]*:\/\/[^\s/]+@/i.test(value) || /[?&](?:access_token|token|signature|x-oss-signature|x-amz-signature|api_key)=/i.test(value))) throw new ApplicationError("Credential-bearing URLs are not allowed in plans.");
}
/** Parse strict JSON-compatible YAML; application planning never executes YAML. */
export function readYaml(file: string): unknown {
  if (fs.statSync(file).size > 1024 * 1024) throw new ApplicationError("Application YAML exceeds 1 MiB.");
  const doc = parseDocument(fs.readFileSync(file, "utf8"), { uniqueKeys: true });
  if (doc.errors.length) throw new ApplicationError("Invalid YAML or duplicate keys.");
  try { return doc.toJS({ maxAliasCount: 0 }); } catch { throw new ApplicationError("YAML aliases are unsupported in application plans."); }
}
export interface PrivateManagedProject {
  template: ApplicationTemplate;
  bindingValues: Record<string, unknown>;
  roleProps: Record<string, Record<string, unknown>>;
  project: PrivateProject;
}
const controlledProps = ["cpu", "memorySize", "diskSize", "timeout", "instanceConcurrency", "internetAccess", "region", "runtime", "role"];
const unmanagedProps = ["triggers", "asyncInvokeConfig", "concurrencyConfig", "provisionConfig", "scalingConfig", "vpcBinding", "supplement"];

/** Resolve private inputs, retaining only original references and non-secret controls in the plan template. */
export function readManagedProject(file: string, options: ProjectResolutionOptions = {}): PrivateManagedProject {
  const project = resolveProject(file, options), { compiled, intent } = project;
  if (compiled.kind !== "application" || !compiled.application || !intent.application || !intent.deployment || !compiled.roleProps || !compiled.roleResources || !compiled.bindingValues) throw new ApplicationError("Expected an agents-api application project.");
  try { validateManagedInstance(compiled.sandbox?.instance ?? {}); }
  catch (error) { throw new ApplicationError(error instanceof TypeError ? error.message : "Invalid Managed instance configuration."); }
  if (project.actions.some(action => record(action.definition) ? Object.keys(action.definition).length > 0 : Boolean(action.definition)) || Object.keys(intent.deployment.flow ?? {}).length) throw new ApplicationError("Native actions/flow are parsed but are not yet supported by the Managed lifecycle; no resources were changed.");
  const nativeControls: Record<string, Record<string, unknown>> = {};
  for (const [role, props] of Object.entries(compiled.roleProps)) {
    for (const key of unmanagedProps) if (Object.hasOwn(props, key)) throw new ApplicationError(`Managed ${role} props.${key} needs a resource lifecycle adapter and is currently unsupported.`);
    for (const key of ["vpcConfig", "nasConfig", "ossMountConfig", "logConfig"]) if (props[key] === "auto") throw new ApplicationError(`Managed ${role} props.${key}: auto has no owned-resource cleanup contract; use an explicit supported existing-resource configuration.`);
    if (props.environmentVariables !== undefined && (!record(props.environmentVariables) || Object.values(props.environmentVariables).some(value => typeof value !== "string"))) throw new ApplicationError(`Managed ${role} environmentVariables must contain string values.`);
    nativeControls[role] = Object.fromEntries(controlledProps.filter(key => Object.hasOwn(props, key)).map(key => [key, props[key]]));
  }
  const app = structuredClone(compiled.application);
  // Hook argv can also contain resolved values. Persist its original declarations.
  if (intent.application.hooks) app.hooks = structuredClone(intent.application.hooks);
  const nativeEnvironmentNames: Record<string, string[]> = {};
  const rawRoleProps = Object.fromEntries(Object.entries(compiled.roleResources).map(([role, id]) => {
    const props = structuredClone(intent.deployment!.resources[id].props) as Record<string, unknown>;
    nativeEnvironmentNames[role] = Object.keys((compiled.roleProps![role].environmentVariables ?? {}) as Record<string, unknown>).sort();
    delete props.environmentVariables;
    return [role, props];
  }));
  const instance = compiled.sandbox?.instance ?? {}, {envs, metadata, ...instanceControls} = instance;
  const template = { name: compiled.name, specVersion: 1, provider: compiled.provider, resources: compiled.resources,
    start_cmd: intent.sandbox?.start ?? null, ready_cmd: intent.sandbox?.ready ?? null, provides: compiled.provides, ports: compiled.ports,
    env: {}, application: app, sandboxInstanceControls: instanceControls,
    sandboxEnvironmentNames: Object.keys(envs ?? {}).sort(), sandboxMetadataNames: Object.keys(metadata ?? {}).sort(),
    nativeRoleProps: rawRoleProps, nativeControls, nativeEnvironmentNames } as unknown as ApplicationTemplate;
  rejectInlineSecrets(template);
  validateManagedTemplate(template, file);
  return { template, bindingValues: compiled.bindingValues, roleProps: compiled.roleProps, project };
}

/** Plan-safe application template: private resolved credentials never leave readManagedProject's context. */
export function readTemplate(file: string, options: ProjectResolutionOptions = {}): ApplicationTemplate {
  return readManagedProject(file, options).template;
}

function validateManagedTemplate(template: ApplicationTemplate, file: string): void {
  const app = template.application;
  if (app?.deployment.profile !== "fc-managed-agents" || app.runtime.profile !== "managed-bridge-v1") throw new ApplicationError("Expected the managed Agents application profile.");
  if (app.limits.maxToolSeconds > app.limits.maxRunSeconds || Number(app.sessions.maxConcurrentTurnsPerSession) !== 1) throw new ApplicationError("Invalid managed execution budgets.");
  if (Number(app.sessions.idleTimeoutSeconds) > Number(app.sessions.maxLifetimeSeconds) || app.limits.maxRunSeconds >= Number(app.sessions.maxLifetimeSeconds)
    || Number(app.storage.maxArtifactBytes) > Number(app.storage.maxTurnArtifactBytes)
    || Math.max(Number(app.storage.maxFileBytes), Number(app.storage.maxTurnArtifactBytes)) > Number(app.storage.maxRetainedBytesPerOwner)) throw new ApplicationError("Managed session and storage budgets are inconsistent.");
  if (!app.bindings[app.state.bindingRef] || !app.bindings[app.deployment.ingressBindingRef]) throw new ApplicationError("State and ingress references must resolve to declared bindings.");
  const targets: Array<[string, string[]]> = [[app.state.bindingRef, ["dispatcher", "gateway", "worker"]], [app.deployment.ingressBindingRef, ["deployment-publisher"]],
    ["sandboxAccess", ["dispatcher", "worker"]], ["clientAuth", ["gateway"]], ["internalAuth", ["dispatcher", "gateway", "worker"]], ["model", ["sandbox-creation"]]];
  for (const [key, expected] of targets) if (JSON.stringify([...(app.bindings[key]?.targets ?? [])].sort()) !== JSON.stringify(expected)) throw new ApplicationError(`Binding '${key}' has unsupported target roles.`);
  for (const binding of Object.values(app.bindings)) {
    if (!Array.isArray(binding.targets)) throw new ApplicationError("Every binding needs supported target roles.");
    if (binding.targets.includes("sandbox-creation")) {
      if (binding.targets.length !== 1 || binding.resolverRole !== "worker" || !binding.allowedEnv?.length || binding.allowedEnv.some(key => !["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL", "CODEX_API_KEY"].includes(key))) throw new ApplicationError("Guest model injection requires the explicit worker resolver and a model-only environment whitelist.");
    } else if (binding.resolverRole || binding.allowedEnv) throw new ApplicationError("Guest injection fields are only valid for the sandbox-creation target.");
  }
  const provided = record(template.provides) ? Object.values(template.provides).filter(record) : [];
  if (!provided.some(value => value.protocol === "agent-sandbox-managed-bridge" && value.version === 1 && value.port === 9000)
    || provided.some(value => !Array.isArray(template.ports) || !template.ports.includes(value.port))) throw new ApplicationError("Managed bridge v1 on declared port 9000 is required.");
  const root = path.dirname(file), ids = new Set<string>();
  if (app.deployment.serverBuildRecipe) {
    contained(root, app.deployment.serverBuildRecipe.dockerfile);
    if (app.deployment.serverBuildRecipe.context !== ".") throw new ApplicationError("Server build context must be the template root.");
  }
  for (const phase of Object.values(app.hooks ?? {})) for (const hook of phase) {
    if (ids.has(hook.id)) throw new ApplicationError("Application hook IDs must be unique.");
    ids.add(hook.id);
    if (hook.type === "custom") contained(root, hook.cwd ?? ".");
    else if (hook.command !== "info" || !["gateway", "worker", "dispatcher"].includes(hook.step ?? "")) throw new ApplicationError("Component hooks may only inspect a declared role.");
  }
}
/** Atomic private JSON output; credentials must never be passed to this writer. */
export function writeJson(file: string, value: unknown): void {
  rejectInlineSecrets(value);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`, handle = fs.openSync(temp, "wx", 0o600);
  try { fs.writeFileSync(handle, JSON.stringify(value, null, 2) + "\n"); fs.fsyncSync(handle); }
  finally { fs.closeSync(handle); }
  fs.renameSync(temp, file);
  if (process.platform !== "win32") { const dir = fs.openSync(path.dirname(file), "r"); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } }
}
/** Verify the exact binary, loader dependencies and downloaded component before execution. */
export function verifyTools(lock: ToolchainLock): void {
  if (lock.schemaVersion !== 1 || createHash("sha256").update(fs.readFileSync(lock.node.path)).digest("hex") !== lock.node.sha256 || toolDigest(lock.loader.directory) !== lock.loader.sha256 || toolDigest(lock.component.directory) !== lock.component.sha256) throw new ApplicationError("Locked toolchain changed; rebuild before planning.");
}
export function readBuild(file: string): BuildReceipt {
  const value = JSON.parse(fs.readFileSync(file, "utf8")) as BuildReceipt;
  if (value.schemaVersion !== 1 || value.kind !== "ManagedApplicationBuild" || (value.status && value.status !== "ready") || !/^[-a-zA-Z0-9._:/]+@sha256:[a-f0-9]{64}$/.test(value.image)) throw new ApplicationError("Invalid or incomplete application build receipt.");
  verifyTools(value.toolchain); return value;
}
export function planId(plan: Omit<ApplicationPlan, "id">): string {
  const input = { ...plan } as Partial<ApplicationPlan>; delete input.id;
  return `app_${digest(input).slice(0, 32)}`;
}
