/** Resource intent discovery and explicit private native resolution are separate operations. */
import fs from "node:fs";
import { TemplateParseError } from "../models/errors.js";
import { normalizeProjectIntent, compileResolvedProject, sandboxModelInput } from "./definition.mjs";
import { MAX_YAML_BYTES, parseYamlV1, type ContractOptions, type CompiledTemplateV1, type TemplateV1 } from "./contract-v1/normalize.mjs";
import { resolveDevsProject, type DevsActionDeclaration, type DevsStep, type DevsResolutionOptions } from "./devs_project.js";

const repairSuggestion = "Fix the reported YAML or field in template.yaml using the template v1 specification, then retry.";

/** Strict bounded JSON-compatible YAML, without dotenv, native expressions or component loading. */
export function readProjectDocument(file: string): unknown {
  if (fs.statSync(file).size > MAX_YAML_BYTES) throw new TemplateParseError("Template YAML exceeds 1 MiB.", { suggestion: repairSuggestion });
  try { return parseYamlV1(fs.readFileSync(file)); }
  catch (error) { throw new TemplateParseError(error instanceof TypeError ? error.message : "Invalid template YAML.", { suggestion: repairSuggestion }); }
}

/** Load source metadata without requiring credentials, Registry metadata or native file/config resolution. */
export function readProjectIntent(file: string, options: ContractOptions = {}): TemplateV1 {
  try { return normalizeProjectIntent(readProjectDocument(file), options); }
  catch (error) {
    if (error instanceof TemplateParseError) throw error;
    throw new TemplateParseError(error instanceof TypeError ? error.message : "Invalid template v1 intent.", { suggestion: repairSuggestion });
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
    throw new TemplateParseError(error instanceof TypeError ? error.message : "Invalid resolved template v1 configuration.", { suggestion: repairSuggestion });
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
