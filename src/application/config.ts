/** Offline application validation and immutable source/tool identities. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseDocument } from "yaml";
import { readProjectIntent, type PrivateProject, type ProjectResolutionOptions } from "../template/project.js";
import { DeployError } from "../models/errors.js";
import type { ApplicationTemplate, ApplicationPlan, BuildReceipt, ToolchainLock } from "./types.js";

export class ApplicationError extends DeployError {}
const ignored = new Set([".git", ".abx", ".s", ".agents", "node_modules", ".venv", "__pycache__", ".pytest_cache"]);
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
/** Retired manifest adapter. Stored managed receipts keep their independent cleanup contract. */
export function readManagedProject(file: string, options: ProjectResolutionOptions = {}): PrivateManagedProject {
  readProjectIntent(file, options);
  throw new ApplicationError("Use the named sandbox/serving resource deployment lifecycle. Managed application recipes are no longer part of template.yaml.");
}

/** Retained only for internal receipt code; new deployments use the resource executor. */
export function readTemplate(file: string, options: ProjectResolutionOptions = {}): ApplicationTemplate {
  return readManagedProject(file, options).template;
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
