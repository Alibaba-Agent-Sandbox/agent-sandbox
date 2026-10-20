/** Shared manifest version gate. Reading a template never executes application hooks. */
import fs from "node:fs";
import path from "node:path";
import type { ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parseDocument } from "yaml";
import schema from "./template-v3.schema.json" with { type: "json" };
import { TemplateParseError } from "../models/errors.js";

/** Invalid or unsupported template contract, with no raw secret values in messages. */
export class TemplateContractError extends TemplateParseError {}
let cachedValidator: ValidateFunction | undefined;

/** Defer construction/compilation until v3; the static class import keeps standalone bundling intact. */
function v3Validator(): ValidateFunction {
  if (!cachedValidator) {
    cachedValidator = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
  }
  return cachedValidator;
}

type Mapping = Record<string, unknown>;
const mapping = (value: unknown): value is Mapping => value !== null && typeof value === "object" && !Array.isArray(value);

/** Validate versioned contracts while retaining downstream legacy/v2 domain validation. */
export function validateTemplateVersion(raw: unknown, root?: string): void {
  if (!mapping(raw)) throw new TemplateContractError("Template manifest must be a mapping.");
  if (!Object.hasOwn(raw, "spec_version") || raw.spec_version === 2) {
    if (Object.hasOwn(raw, "application")) throw new TemplateContractError("Application configuration requires spec_version: 3.");
    return;
  }
  if (raw.spec_version !== 3) throw new TemplateContractError("Unsupported template spec_version; supported versions are 2 and 3.");
  const validate = v3Validator();
  if (!validate(raw)) throw new TemplateContractError(`Invalid template v3: ${validate.errors?.map(error => `${error.instancePath || "/"} ${error.keyword}`).join(", ")}`);
  const app = raw.application as Mapping | undefined;
  if (!app) return;
  const limits = app.limits as Record<string, number>;
  if (limits.maxToolSeconds > limits.maxRunSeconds) throw new TemplateContractError("Tool timeout exceeds the run budget.");
  const state = app.state as Mapping, bindings = app.bindings as Mapping;
  if (state.bindingRef && !Object.hasOwn(bindings, state.bindingRef as string)) throw new TemplateContractError("State bindingRef must resolve to a bindings key.");
  const runtime = app.runtime as Mapping, sandbox = app.sandbox as Mapping;
  const features = sandbox.requiredFeatures as string[];
  const needed = runtime.placement === "external" ? ["sandbox.lifecycle", "exec.run", "files.rw"] : ["sandbox.lifecycle", "ports.url"];
  if (needed.some(feature => !features.includes(feature))) throw new TemplateContractError("Required baseline sandbox features are missing.");
  const hooks = (app.hooks ?? {}) as Record<string, Mapping[]>;
  const ids = new Set<string>();
  for (const entries of Object.values(hooks)) for (const hook of entries) {
    const id = hook.id as string;
    if (ids.has(id)) throw new TemplateContractError("Hook IDs must be unique across phases.");
    ids.add(id);
    if ((hook.argv as string[]).some(argument => argument.includes("\0"))) throw new TemplateContractError("Hook argument contains NUL.");
    if (root) sourcePath(root, hook.cwd as string, true);
  }
  if (root) {
    const deployment = app.deployment as Mapping;
    for (const field of ["project", "toolchainLock"]) if (deployment[field]) sourcePath(root, deployment[field] as string, false);
  }
}

function sourcePath(root: string, relative: string, directory: boolean): void {
  let resolved: string;
  try {
    const base = fs.realpathSync(root);
    resolved = fs.realpathSync(path.resolve(base, relative));
    const part = path.relative(base, resolved);
    if (part === ".." || part.startsWith(`..${path.sep}`) || path.isAbsolute(part)) throw new TemplateContractError("Template input escapes its project root.");
    const stat = fs.statSync(resolved);
    if (directory ? !stat.isDirectory() : !stat.isFile()) throw new TemplateContractError("Template input has the wrong file type.");
  } catch (error) {
    if (error instanceof TemplateContractError) throw error;
    throw new TemplateContractError("Referenced template file or working directory is unavailable.");
  }
}

/** Read a bounded template with unique keys; validate before any provider preparation. */
export function readTemplateContract(file: string, validateInputs = true): Record<string, unknown> {
  if (fs.statSync(file).size > 1024 * 1024) throw new TemplateContractError("Template YAML exceeds 1 MiB.");
  const document = parseDocument(fs.readFileSync(file, "utf8"), { version: "1.1", uniqueKeys: true });
  if (document.errors.length || document.warnings.length) throw new TemplateContractError("Invalid template YAML (duplicate keys or unsupported syntax).");
  let raw: unknown;
  try { raw = document.toJS(); } catch { throw new TemplateContractError("Invalid template YAML aliases."); }
  if (mapping(raw) && raw.spec_version === 3) {
    try { raw = document.toJS({ maxAliasCount: 0 }); } catch { throw new TemplateContractError("YAML aliases are not supported in template v3."); }
  }
  validateTemplateVersion(raw, validateInputs ? path.dirname(file) : undefined);
  return raw as Record<string, unknown>;
}
