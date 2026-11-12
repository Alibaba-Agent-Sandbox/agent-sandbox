/** Resource intent discovery and explicit private native resolution are separate operations. */
import fs from "node:fs";
import { parseDocument } from "yaml";
import { TemplateParseError } from "../models/errors.js";
import { normalizeProjectIntent, compileResolvedProject, sandboxModelInput } from "./definition.mjs";
import type { ContractOptions, CompiledTemplateV1, TemplateV1 } from "./contract-v1/normalize.mjs";
import { resolveDevsProject, type DevsActionDeclaration, type DevsStep, type DevsResolutionOptions } from "./devs_project.js";

/** Strict bounded JSON-compatible YAML, without dotenv, native expressions or component loading. */
export function readProjectDocument(file: string): unknown {
  if (fs.statSync(file).size > 1024 * 1024) throw new TemplateParseError("Template YAML exceeds 1 MiB.");
  const bytes = fs.readFileSync(file, "utf8");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(bytes)) throw new TemplateParseError("Template YAML contains unsupported control characters.");
  const doc = parseDocument(bytes, { uniqueKeys: true });
  if (doc.errors.length || doc.warnings.length) throw new TemplateParseError("Invalid template YAML, duplicate keys or unsupported tags.");
  try { return doc.toJS({ maxAliasCount: 0 }); }
  catch { throw new TemplateParseError("Template YAML aliases are unsupported."); }
}

/** Load source metadata without requiring credentials, Registry metadata or native file/config resolution. */
export function readProjectIntent(file: string, options: ContractOptions = {}): TemplateV1 {
  try { return normalizeProjectIntent(readProjectDocument(file), options); }
  catch (error) {
    if (error instanceof TemplateParseError) throw error;
    throw new TemplateParseError(error instanceof TypeError ? error.message : "Invalid template v1 intent.");
  }
}

export interface PrivateProject {
  intent: TemplateV1;
  resolved: TemplateV1;
  compiled: CompiledTemplateV1;
  steps: DevsStep[];
  actions: DevsActionDeclaration[];
}
export interface ProjectResolutionOptions extends ContractOptions, DevsResolutionOptions {
  environment?: NodeJS.ProcessEnv;
}

/** Explicit execution-only resolution. The returned credentials and native props must never be persisted. */
export function resolveProject(file: string, options: ProjectResolutionOptions = {}): PrivateProject {
  const intent = readProjectIntent(file, options);
  const native = resolveDevsProject(intent as unknown as Record<string, unknown>, file, options.environment, options);
  try {
    const compiled = compileResolvedProject(native.document, options);
    return { intent, resolved: native.document as unknown as TemplateV1, compiled, steps: native.steps, actions: native.actions };
  } catch (error) {
    throw new TemplateParseError(error instanceof TypeError ? error.message : "Invalid resolved template v1 configuration.");
  }
}

/**
 * Private in-memory input for the existing startup executor/model.
 * This is never a public manifest and must not be serialized as template.yaml.
 */
export function sandboxExecutionInput(intent: TemplateV1, compiled?: CompiledTemplateV1): Record<string, unknown> {
  const input = sandboxModelInput(intent);
  if (compiled) {
    for (const key of ["name", "provider", "resources", "env", "provides", "ports", "template_id", "image", "build_profiles", "aliases"] as const) {
      if (compiled[key] !== undefined) input[key] = structuredClone(compiled[key]);
    }
    for (const key of ["start_cmd", "ready_cmd"] as const) if (compiled[key]) input[key] = compiled[key];
    const props = compiled.resources;
    if (props && typeof props.cpu === "number") input.cpu_count = props.cpu;
    if (props && typeof props.memory === "number") input.memory_mb = props.memory;
  }
  delete input.specVersion;
  if (!input.template_id) delete input.provider;
  return input;
}
