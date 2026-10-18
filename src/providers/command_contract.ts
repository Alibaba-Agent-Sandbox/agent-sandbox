/** Static provider management command contract; independent of registry and transport. */
import { Ajv, type ValidateFunction } from "ajv";

import { ProviderConfigError, ProviderManifestError, ProviderProtocolError } from "./errors.js";

export const COMMAND_PROTOCOL = "provider-commands/1";
export const COMMAND_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
export interface ProviderCommand {
  id: string;
  description: string;
  description_zh: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  effect: "read" | "write" | "delete";
  idempotent: boolean;
}
export type ProviderCommandHandler = (input: Record<string, unknown>) => Promise<unknown>;
export interface ProviderCommandRunner {
  run(command: string, input: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
  close?(): Promise<void>;
}

const ajv = new Ajv({ strict: true, allErrors: false, coerceTypes: false, useDefaults: false, removeAdditional: false, ownProperties: true, validateFormats: false, addUsedSchema: false });
const validators = new WeakMap<object, ValidateFunction>();
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const forbiddenSchema = new Set(["$ref", "$dynamicRef", "$recursiveRef", "$id", "$async", "pattern", "patternProperties", "format"]);
const descriptorKeys = new Set(["id", "description", "description_zh", "input_schema", "output_schema", "effect", "idempotent"]);

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Reject non-JSON values, cycles, dangerous keys and excessive input before invoking any code. */
export function checkJson(value: unknown, maxBytes: number, maxDepth: number, schema = false): void {
  const seen = new Set<object>();
  const walk = (v: unknown, depth: number): void => {
    if (depth > maxDepth) throw new Error("JSON nesting limit exceeded");
    if (v === null || typeof v === "string" || typeof v === "boolean") return;
    if (typeof v === "number" && Number.isFinite(v)) return;
    if (typeof v !== "object" || v === null || seen.has(v)) throw new Error("Expected finite JSON data");
    if (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v))) throw new Error("Expected plain JSON data");
    seen.add(v);
    for (const [key, child] of Object.entries(v)) {
      if (forbidden.has(key)) throw new Error("Unsupported JSON key");
      walk(child, depth + 1);
    }
    seen.delete(v);
  };
  walk(value, 0);
  if (Buffer.byteLength(JSON.stringify(value)) > maxBytes) throw new Error("JSON size limit exceeded");
  if (schema) checkSchema(value);
}

function checkSchema(value: unknown): void {
  if (!object(value)) return;
  for (const key of Object.keys(value)) if (forbiddenSchema.has(key)) throw new Error("Unsupported schema keyword");
  // Property names are data; a field called "format" is distinct from the schema keyword.
  for (const key of ["properties", "definitions", "$defs"]) {
    if (object(value[key])) for (const child of Object.values(value[key])) checkSchema(child);
  }
  for (const key of ["items", "additionalItems", "additionalProperties", "propertyNames", "contains", "not", "if", "then", "else"]) {
    const child = value[key];
    if (Array.isArray(child)) child.forEach(checkSchema); else checkSchema(child);
  }
  for (const key of ["allOf", "anyOf", "oneOf"]) if (Array.isArray(value[key])) value[key].forEach(checkSchema);
  if (object(value["dependencies"])) for (const child of Object.values(value["dependencies"])) checkSchema(child);
}

function validator(schema: Record<string, unknown>): ValidateFunction {
  let result = validators.get(schema);
  if (!result) {
    checkJson(schema, 64 * 1024, 16, true);
    // Remove failed compilations too: Ajv caches a schema before validating it.
    try { result = ajv.compile(schema); }
    finally { ajv.removeSchema(schema); }
    validators.set(schema, result);
  }
  return result;
}

/** Validate metadata without importing the plugin or accessing credentials. */
export function parseCommandSection(raw: unknown, kind: string): readonly ProviderCommand[] {
  if (raw === undefined) return [];
  const fail = (): never => { throw new ProviderManifestError("Invalid provider commands: expected provider-commands/1 descriptors with valid bounded draft-7 schemas."); };
  if (!object(raw) || raw["protocol"] !== COMMAND_PROTOCOL || !Array.isArray(raw["entries"])) return fail();
  const entries = raw["entries"];
  if (entries.length > 128 || (kind === "rest" && entries.length > 0)) return fail();
  const ids = new Set<string>();
  const result: ProviderCommand[] = [];
  for (const entry of entries) {
    if (!object(entry)) return fail();
    if (Object.keys(entry).some((key) => !descriptorKeys.has(key))) return fail();
    try { checkJson(entry, 64 * 1024, 16); } catch { return fail(); }
    if (typeof entry["id"] !== "string" || entry["id"].length > 80 || !COMMAND_ID.test(entry["id"]) || ids.has(entry["id"])) return fail();
    if (!["description", "description_zh"].every((k) => typeof entry[k] === "string" && entry[k].trim())) return fail();
    if (!["read", "write", "delete"].includes(String(entry["effect"])) || typeof entry["idempotent"] !== "boolean") return fail();
    const input = entry["input_schema"], output = entry["output_schema"];
    if (!object(input) || !object(output) || input["type"] !== "object" || input["additionalProperties"] !== false) return fail();
    try { validator(input); validator(output); } catch { return fail(); }
    ids.add(entry["id"]);
    result.push({ id: entry["id"], description: entry["description"] as string, description_zh: entry["description_zh"] as string, effect: entry["effect"] as ProviderCommand["effect"], idempotent: entry["idempotent"], input_schema: input, output_schema: output });
  }
  return result.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Keep errors value-free: JSON/schema diagnostics can otherwise disclose credentials. */
export function validateCommandInput(command: ProviderCommand, input: unknown): asserts input is Record<string, unknown> {
  try {
    checkJson(input, 1024 * 1024, 32);
    if (!object(input) || !validator(command.input_schema)(input)) throw new Error();
  } catch {
    throw new ProviderConfigError(`Invalid input for provider command '${command.id}'; see its input_schema using 'abx provider command info'.`);
  }
}

export function validateCommandOutput(command: ProviderCommand, output: unknown): void {
  try {
    checkJson(output, 8 * 1024 * 1024, 32);
    if (!validator(command.output_schema)(output)) throw new Error();
  } catch {
    throw new ProviderProtocolError(`Provider command '${command.id}' returned a result that does not match its output_schema.`);
  }
}
