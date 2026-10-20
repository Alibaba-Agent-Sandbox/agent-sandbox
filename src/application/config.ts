/** Strict, offline configuration loading and input locking. No scripts or cloud calls. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parseDocument } from "yaml";
import schema from "../utils/template-v3.schema.json" with { type: "json" };
import { validateTemplateVersion } from "../utils/template_contract.js";
import type { ApplicationTemplate, ServerlessProject, ToolchainLock } from "./types.js";
import { DeployError } from "../models/errors.js";

/** A validation failure contains paths/reasons, never raw configuration values. */
export class ApplicationError extends DeployError {}
const validator = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
const ignored = new Set([".git", ".abx", "node_modules", ".venv", "__pycache__", ".pytest_cache"]);
/** Plans contain references, not credential literals or authenticated URLs/DSNs. */
export function rejectInlineSecrets(value: unknown, trail: string[] = []): void {
  if (Array.isArray(value)) { for (const child of value) rejectInlineSecrets(child, trail); return; }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (trail.join(".") !== "application.bindings" && /(?:access_?key_?(?:id|secret)|security_?token|password|api_?key|credential|private_?key|secret|token)$/i.test(key) && child !== "" && child !== null && child !== undefined) throw new ApplicationError("Credential literals are not permitted in application plans; use runtime identity references.");
      rejectInlineSecrets(child, [...trail, key]);
    }
  } else if (typeof value === "string" && (/[a-z][a-z0-9+.-]*:\/\/[^\s/]+@/i.test(value) || /[?&](?:access_token|token|signature|x-oss-signature|x-amz-signature|security_token|api_key)=/i.test(value))) throw new ApplicationError("Credential-bearing URLs/DSNs are not permitted in application plans.");
}
/** Stable digest of JSON data, independent of mapping key order. */
export function digest(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
/** Resolve an existing project-relative input without traversal or symlink escape. */
export function contained(root: string, relative: string): string {
  if (!relative || path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative) || relative.includes("\\") || /[\x00-\x1f]/.test(relative) || relative.split("/").includes("..")) throw new ApplicationError("Expected a contained project-relative path.");
  const resolved = fs.realpathSync(path.resolve(root, relative));
  const rel = path.relative(fs.realpathSync(root), resolved);
  if (rel.startsWith(`..${path.sep}`) || rel === ".." || path.isAbsolute(rel)) throw new ApplicationError("Project input escapes its root.");
  return resolved;
}
/** Reject ambiguous keys, aliases and executable YAML expressions before conversion. */
export function readYaml(file: string): unknown {
  if (fs.statSync(file).size > 1024 * 1024) throw new ApplicationError("YAML input exceeds 1 MiB.");
  const document = parseDocument(fs.readFileSync(file, "utf8"), { uniqueKeys: true });
  if (document.errors.length) throw new ApplicationError("Invalid YAML (duplicate keys or unsupported syntax).");
  try { return document.toJS({ maxAliasCount: 0 }); } catch { throw new ApplicationError("YAML aliases are not supported in application configuration."); }
}
/** Validate the application extension, including cross-field constraints. */
export function readTemplate(file: string): ApplicationTemplate {
  const raw = readYaml(file);
  if (!validator(raw)) throw new ApplicationError(`Invalid template v3: ${validator.errors?.map(e => `${e.instancePath || "/"} ${e.keyword}`).join(", ")}`);
  const template = raw as unknown as ApplicationTemplate;
  rejectInlineSecrets(raw);
  validateTemplateVersion(raw, path.dirname(file));
  if (!template.application) throw new ApplicationError("This template has no application configuration; use template deploy for a sandbox template.");
  const app = template.application, root = path.dirname(file);
  if (app.limits.maxToolSeconds > app.limits.maxRunSeconds) throw new ApplicationError("Tool timeout exceeds the run budget.");
  if (app.state.bindingRef && !Object.hasOwn(app.bindings, app.state.bindingRef)) throw new ApplicationError("State bindingRef must resolve to a bindings key.");
  const need = app.runtime.placement === "external" ? ["sandbox.lifecycle", "exec.run", "files.rw"] : ["sandbox.lifecycle", "ports.url"];
  if (need.some(f => !app.sandbox.requiredFeatures.includes(f))) throw new ApplicationError("Required baseline sandbox features are missing.");
  const ids = new Set<string>();
  for (const hooks of Object.values(app.hooks ?? {})) for (const hook of hooks) {
    if (ids.has(hook.id)) throw new ApplicationError("Hook IDs must be unique across phases.");
    ids.add(hook.id); contained(root, hook.cwd);
    for (const arg of hook.argv) if (arg.includes("\0")) throw new ApplicationError("Hook argument contains NUL.");
  }
  for (const relative of [app.deployment.project, app.deployment.toolchainLock]) if (relative) contained(root, relative);
  return template;
}
/** Digest every non-generated source file; symlinks and sensitive .env inputs fail closed. */
export function sourceDigest(root: string): string {
  const entries: [string, string][] = [];
  const visit = (directory: string): void => {
    for (const name of fs.readdirSync(directory).sort()) {
      if (ignored.has(name) || name === ".env" || name.startsWith(".env.")) continue;
      const file = path.join(directory, name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new ApplicationError("Symlinked deployment inputs are not supported; copy reviewed inputs into the project.");
      if (stat.isDirectory()) visit(file);
      else if (stat.isFile()) entries.push([path.relative(root, file), createHash("sha256").update(fs.readFileSync(file)).digest("hex")]);
      else throw new ApplicationError("Deployment inputs must be regular files.");
    }
  };
  visit(root); return digest(entries);
}
/** Digest a complete installed tool bundle, including dependencies; reject external links. */
export function toolDigest(root: string): string {
  const files: [string, string][] = [];
  const visit = (directory: string): void => {
    for (const name of fs.readdirSync(directory).sort()) {
      if (name === ".git") continue;
      const file = path.join(directory, name), stat = fs.lstatSync(file), relative = path.relative(root, file);
      if (stat.isSymbolicLink()) {
        const target = fs.realpathSync(file), rel = path.relative(fs.realpathSync(root), target);
        if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new ApplicationError("Locked tool dependencies must remain inside their bundle.");
        files.push([relative, `link:${rel}`]);
      } else if (stat.isDirectory()) visit(file);
      else if (stat.isFile()) files.push([relative, createHash("sha256").update(fs.readFileSync(file)).digest("hex")]);
      else throw new ApplicationError("Locked tool bundles must contain regular files.");
    }
  };
  visit(root); return digest(files);
}
/** Initial immutable adapter accepts prebuilt digest-pinned FC containers only. */
export function serverlessProject(template: ApplicationTemplate, root: string): ServerlessProject | null {
  const deployment = template.application.deployment;
  if (deployment.adapter === "none") return null;
  const raw = deployment.inline ?? readYaml(contained(root, deployment.project!));
  const subSchema = { $schema: schema.$schema, $defs: schema.$defs, $ref: "#/$defs/serverlessProject" };
  const check = new Ajv2020({ strict: false }).compile(subSchema);
  if (!check(raw)) throw new ApplicationError("Unsupported Serverless Devs project structure; use literal v3 fc3 resources.");
  const project = structuredClone(raw) as ServerlessProject;
  rejectInlineSecrets(project);
  if (JSON.stringify(project).includes("${")) throw new ApplicationError("Dynamic Serverless Devs expressions cannot be frozen; supply literal reviewed inputs.");
  if (template.application.runtime.placement === "external" && ["gateway", "worker", "dispatcher"].some(k => !Object.hasOwn(project.resources, k))) throw new ApplicationError("External mode requires gateway, worker and dispatcher resources.");
  const identities = new Set<string>();
  for (const resource of Object.values(project.resources)) {
    const props = resource.props;
    const nativeFields = new Set(["region", "functionName", "runtime", "customContainerConfig", "role", "description", "timeout", "memorySize", "cpu", "diskSize", "environmentVariables", "internetAccess", "vpcConfig", "logConfig", "instanceConcurrency", "triggers", "asyncInvokeConfig"]);
    if (Object.keys(props).some(key => !nativeFields.has(key))) throw new ApplicationError("FC resource contains properties unsupported by the initial atomic creation adapter.");
    if (resource.actions && Object.keys(resource.actions).length) throw new ApplicationError("Deploy actions can mutate accepted inputs; build before planning and use application validation hooks.");
    if (props.runtime !== "custom-container" || !props.customContainerConfig || typeof props.customContainerConfig !== "object") throw new ApplicationError("Initial FC adapter requires prebuilt custom-container resources.");
    const image = (props.customContainerConfig as Record<string, unknown>).image;
    if (typeof image !== "string" || !/^[-a-zA-Z0-9._:/]+@sha256:[a-f0-9]{64}$/.test(image)) throw new ApplicationError("FC images must be pinned by sha256 digest.");
    if (typeof props.region !== "string" || !/^[a-z][a-z0-9-]+$/.test(props.region) || typeof props.functionName !== "string" || !/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(props.functionName)) throw new ApplicationError("Each FC resource requires a literal region and functionName.");
    const identity = `${props.region}/${props.functionName}`;
    if (identities.has(identity)) throw new ApplicationError("FC function identities must be distinct.");
    identities.add(identity);
    for (const [key, value] of Object.entries((props.environmentVariables ?? {}) as Record<string, unknown>)) {
      if (/(TOKEN|PASSWORD|SECRET|API_KEY|CREDENTIAL|PRIVATE_KEY)$/i.test(key) && value) throw new ApplicationError("Runtime secret values must be resolved by the trusted runtime factory, not stored in a deployment plan.");
      if (key.startsWith("ABX_APP_SANDBOX_") || key === "ABX_APP_REVISION" || key === "ABX_APP_SPEC_JSON") throw new ApplicationError("Reserved runtime bindings are supplied by the application deployer.");
    }
  }
  return project;
}
/** Read a local toolchain lock without executing its binary. */
export function readToolchain(template: ApplicationTemplate, root: string, project: ServerlessProject | null): ToolchainLock | null {
  if (!project) return null;
  const file = contained(root, template.application.deployment.toolchainLock!);
  if (fs.statSync(file).size > 1048576) throw new ApplicationError("Toolchain lock exceeds 1 MiB.");
  const lock = JSON.parse(fs.readFileSync(file, "utf8")) as ToolchainLock;
  rejectInlineSecrets(lock);
  const keys = (value: unknown, expected: string[]): boolean => Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)));
  if (!keys(lock, ["schemaVersion", "node", "serverlessDevs", "fc3"]) || !keys(lock.node, ["sha256"]) || !keys(lock.serverlessDevs, ["directory", "executable", "version", "sha256"]) || !keys(lock.fc3, ["directory", "version", "sha256"])) throw new ApplicationError("Toolchain lock contains missing or unknown fields.");
  if ([lock.serverlessDevs.directory, lock.serverlessDevs.executable, lock.fc3.directory].some(value => typeof value !== "string")) throw new ApplicationError("Toolchain locations must be absolute strings.");
  if (lock.schemaVersion !== 1 || !/^\d+\.\d+\.\d+$/.test(lock.serverlessDevs?.version ?? "") || !/^\d+\.\d+\.\d+$/.test(lock.fc3?.version ?? "") || !/^[a-f0-9]{64}$/.test(lock.node?.sha256 ?? "") || !/^[a-f0-9]{64}$/.test(lock.serverlessDevs?.sha256 ?? "") || !/^[a-f0-9]{64}$/.test(lock.fc3?.sha256 ?? "") || !path.isAbsolute(lock.serverlessDevs?.directory ?? "") || !path.isAbsolute(lock.serverlessDevs?.executable ?? "") || !path.isAbsolute(lock.fc3?.directory ?? "")) throw new ApplicationError("Invalid toolchain lock; pin Node, complete local tool bundles and sha256 digests.");
  if (Object.values(project.resources).some(r => r.component !== `fc3@${lock.fc3.version}`)) throw new ApplicationError("FC component version does not match the reviewed toolchain lock.");
  return lock;
}
