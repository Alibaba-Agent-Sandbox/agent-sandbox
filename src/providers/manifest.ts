/** `abx-provider.toml` manifest: parsing, validation and version comparison (port of `providers/manifest.py`). */

import { validateOperations, type OperationDeclaration } from "./operations.js";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { PyFloat } from "../utils/_pyformat.js";
import {
  CORE_KEY_NAMES,
  FIELD_KEY_RE,
  GENERIC_ENDPOINT_KEYS,
  validateProviderId,
} from "../utils/config_keys.js";
import { parseTomlText } from "../utils/toml_plain.js";
import { FEATURES, type ConfigField } from "./base.js";
import { ProviderManifestError, ProviderVersionError } from "../models/provider_errors.js";
import { parseCommandSection, type ProviderCommand } from "./command_contract.js";

export const MANIFEST_NAME = "abx-provider.toml";
/** Manifest names used before the product rename; recognised only to explain what to change. */
export const MANIFEST_MAX_BYTES = 256 * 1024;
export const SUPPORTED_PROTOCOLS: Readonly<Record<string, string>> = { exec: "epp/1", rest: "e2b-rest/1", node: "node/1" };
export const FIELD_TYPES = ["string", "int", "float", "bool", "enum", "path", "url", "csv"] as const;
export const FILESYSTEM_SCOPES = ["data_dir", "cwd", "home", "any"] as const;
const FORBIDDEN_ENV_PREFIXES = ["ABX_", "E2B_", "ALICLOUD_"];
const FORBIDDEN_LAUNCHERS = [".bat", ".cmd", ".ps1"];

export interface SecuritySection {
  network: string[];
  filesystem: string[];
  env_passthrough: string[];
  spawns_processes: boolean;
}

export interface Manifest {
  id: string;
  name: string;
  name_zh: string;
  version: string;
  description: string;
  kind: "exec" | "rest" | "node";
  protocol: string;
  requires: Record<string, string>;
  command: readonly string[];
  /** `node` providers: the ES module (relative to the plugin root) that `abx` loads in process. */
  entry: string;
  startup_timeout_ms: number;
  call_timeout_ms: number;
  platforms: readonly string[];
  features: readonly string[];
  operation_contract_version: 1;
  operations: OperationDeclaration;
  workflow_inputs: readonly string[];
  startup_modes: readonly string[];
  /** Optional separately versioned management command descriptors. */
  commands: readonly ProviderCommand[];
  security: SecuritySection;
  inherit: readonly string[];
  auth_any_of: ReadonlyArray<readonly string[]>;
  fields: readonly ConfigField[];
  endpoint: Record<string, unknown>;
  license: string;
  homepage: string;
  sha256: string;
  raw: Record<string, unknown>;
}

export interface ManifestSummary {
  runtime: string[];
  security: SecuritySection;
  features: string[];
  operations: OperationDeclaration;
  workflow_inputs: readonly string[];
  startup_modes: readonly string[];
  commands: readonly ProviderCommand[];
  inherit: string[];
  fields: string[];
}

/** Fields shown in the consent screen and compared on update. */
export function manifestSummary(m: Manifest): ManifestSummary {
  return {
    runtime: m.kind === "exec" ? [...m.command] : m.kind === "node" ? ["node", m.entry] : ["rest", String(m.endpoint["base_url"] ?? "")],
    security: m.security,
    features: [...m.features].sort(),
    operations: m.operations, workflow_inputs: m.workflow_inputs, startup_modes: m.startup_modes,
    commands: [...m.commands].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    inherit: [...m.inherit].sort(),
    fields: m.fields.map((f) => f.key).sort(),
  };
}

// ---------------------------------------------------------------- versions

type ParsedVersion = readonly [readonly number[], number];

function parseVersion(text: string): ParsedVersion {
  const m = /^\s*v?(\d+(?:\.\d+)*)([\s\S]*)$/.exec(text);
  if (!m) throw new Error(`invalid version '${text}'`);
  const nums = (m[1] as string).split(".").map((p) => Number.parseInt(p, 10));
  const rest = (m[2] as string).trim();
  return [nums, rest ? 0 : 1];
}

function cmp(a: ParsedVersion, b: ParsedVersion): number {
  const n = Math.max(a[0].length, b[0].length);
  for (let i = 0; i < n; i++) {
    const x = a[0][i] ?? 0;
    const y = b[0][i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return Math.sign(a[1] - b[1]);
}

/** Whether `version` satisfies a comma-separated AND list of comparators (`>= <= > < == != ~=`). */
export function versionSatisfies(version: string, spec: string): boolean {
  const have = parseVersion(version);
  for (const raw of spec.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^(>=|<=|==|!=|~=|>|<)\s*(.+)$/.exec(part);
    if (!m) throw new Error(`invalid version comparator '${part}'`);
    const op = m[1] as string;
    const rhs = parseVersion(m[2] as string);
    const c = cmp(have, rhs);
    if (op === ">=" && c < 0) return false;
    if (op === "<=" && c > 0) return false;
    if (op === ">" && c <= 0) return false;
    if (op === "<" && c >= 0) return false;
    if (op === "==" && c !== 0) return false;
    if (op === "!=" && c === 0) return false;
    if (op === "~=") {
      const nums = rhs[0];
      let upper: ParsedVersion;
      if (nums.length > 1) {
        const head = nums.slice(0, -1);
        upper = [[...head.slice(0, -1), (head[head.length - 1] as number) + 1], 1];
      } else {
        upper = [[(nums[0] as number) + 1], 1];
      }
      if (c < 0 || cmp(have, upper) >= 0) return false;
    }
  }
  return true;
}

/** Throws `ProviderVersionError` (E8013) unless this host satisfies `compat.requires`. */
export function checkRequires(manifest: Manifest, opts: { component: string; host_version: string }): void {
  const spec = manifest.requires[opts.component] ?? "";
  if (spec && !versionSatisfies(opts.host_version, spec)) {
    throw new ProviderVersionError(
      `Provider '${manifest.id}' requires ${opts.component} ${spec} (this is ${opts.host_version}).`,
      { suggestion: "Upgrade agent-sandbox/abx or install a compatible provider version." },
    );
  }
}

// ---------------------------------------------------------------- parsing

type Tbl = Record<string, unknown>;

function err(msg: string): ProviderManifestError {
  return new ProviderManifestError(`Invalid ${MANIFEST_NAME}: ${msg}.`);
}

function isTable(v: unknown): v is Tbl {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof PyFloat);
}

function table(doc: Tbl, name: string, required = false): Tbl {
  const val = doc[name];
  if (val === undefined || val === null) {
    if (required) throw err(`missing [${name}] table`);
    return {};
  }
  if (!isTable(val)) throw err(`[${name}] must be a table`);
  return val;
}

function str(tbl: Tbl, key: string, where: string, opts: { required?: boolean; default?: string } = {}): string {
  const val = tbl[key] ?? opts.default ?? "";
  if (opts.required && (val === "" || tbl[key] === undefined || tbl[key] === null)) throw err(`${where}.${key} is required`);
  if (typeof val !== "string") throw err(`${where}.${key} must be a string`);
  if (opts.required && !val.trim()) throw err(`${where}.${key} is required`);
  return val;
}

function strList(tbl: Tbl, key: string, where: string): string[] {
  const val = tbl[key] ?? [];
  if (!Array.isArray(val) || !val.every((v) => typeof v === "string")) throw err(`${where}.${key} must be an array of strings`);
  return [...(val as string[])];
}

function plainDefault(v: unknown): string | number | boolean | null {
  if (v === undefined || v === null || v === "") return null;
  if (v instanceof PyFloat) return v.value;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return null;
}

function unfloat(v: unknown): unknown {
  if (v instanceof PyFloat) return v.value;
  if (Array.isArray(v)) return v.map(unfloat);
  if (isTable(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unfloat(x)]));
  return v;
}

/** Parse and validate manifest bytes. Throws `ProviderManifestError` / `ProviderVersionError`. */
export function parseManifest(data: Uint8Array | string): Manifest {
  const rawBytes = typeof data === "string" ? Buffer.from(data, "utf-8") : Buffer.from(data);
  if (rawBytes.length > MANIFEST_MAX_BYTES) throw err(`file exceeds ${Math.floor(MANIFEST_MAX_BYTES / 1024)} KiB`);
  let doc: Tbl;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes);
    doc = parseTomlText(text, { keepFloats: true });
  } catch (exc) {
    throw err(exc instanceof Error ? exc.message : String(exc));
  }

  let operations: OperationDeclaration;
  try { operations = validateOperations(doc["operation_contract_version"], doc["operations"]); }
  catch (error) { throw err(String(error)); }
  if (doc["manifest_version"] !== 1) throw err("manifest_version must be 1");
  const workflow = table(doc, "workflow", true);
  if (Object.keys(workflow).some(key => !["inputs", "startups", "source_placeholders"].includes(key))) throw err("unknown workflow field");
  const sourcePlaceholders = strList(workflow, "source_placeholders", "workflow");
  if (new Set(sourcePlaceholders).size !== sourcePlaceholders.length || sourcePlaceholders.some(value => !["<region>", "<tag>"].includes(value))) throw err("unknown or duplicate source placeholder");
  const workflow_inputs = strList(workflow, "inputs", "workflow"), startup_modes = strList(workflow, "startups", "workflow");
  if (new Set(workflow_inputs).size !== workflow_inputs.length || new Set(startup_modes).size !== startup_modes.length) throw err("duplicate workflow declaration");
  if (workflow_inputs.some(v => !["source", "image", "managed", "service"].includes(v)) || startup_modes.some(v => !["exec", "entrypoint", "none"].includes(v))) throw err("unknown workflow input/startup mode");
  const prov = table(doc, "provider", true);
  const pid = str(prov, "id", "provider", { required: true });
  const problem = validateProviderId(pid);
  if (problem) throw err(problem);
  const version = str(prov, "version", "provider", { required: true });
  try {
    parseVersion(version);
  } catch (exc) {
    throw err(`provider.version: ${(exc as Error).message}`);
  }

  const runtime = table(doc, "runtime", true);
  const kind = str(runtime, "kind", "runtime", { required: true });
  if (kind === "python") {
    throw err(
      "runtime.kind 'python' is not supported. " +
        "Use 'node' (an ES module, create(kit)), 'exec' (EPP/1 on stdio) or 'rest'.",
    );
  }
  if (kind !== "exec" && kind !== "rest" && kind !== "node") throw err("runtime.kind must be 'exec', 'rest' or 'node'");
  const expected = SUPPORTED_PROTOCOLS[kind] as string;
  const compat = table(doc, "compat");
  const protocol = str(compat, "protocol", "compat", { default: expected });
  if (protocol !== expected) {
    throw new ProviderVersionError(`Provider '${pid}' uses protocol '${protocol}', which this host does not support.`, {
      suggestion: `Supported: ${expected}.`,
    });
  }
  const requiresRaw = compat["requires"] ?? {};
  if (!isTable(requiresRaw) || !Object.values(requiresRaw).every((v) => typeof v === "string")) {
    throw err("compat.requires must be a table of strings");
  }
  for (const [comp, spec] of Object.entries(requiresRaw)) {
    try {
      versionSatisfies("0", spec as string);
    } catch (exc) {
      throw err(`compat.requires.${comp}: ${(exc as Error).message}`);
    }
  }

  let command: string[] = [];
  let endpoint: Tbl = {};
  let entry = "";
  if (kind === "node") {
    entry = str(runtime, "entry", "runtime", { required: true });
    const normalized = path.posix.normalize(entry.replace(/\\/g, "/"));
    if (path.posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../") || !/\.(mjs|js)$/.test(normalized)) {
      throw err("runtime.entry must be a relative .mjs or .js file inside the plugin directory");
    }
    entry = normalized;
  } else if (kind === "exec") {
    const cmd = runtime["command"];
    if (!Array.isArray(cmd) || cmd.length === 0 || !cmd.every((c) => typeof c === "string" && c !== "" && !c.includes("\0"))) {
      throw err("runtime.command must be a non-empty array of non-empty strings");
    }
    const exe = cmd[0] as string;
    if (FORBIDDEN_LAUNCHERS.some((ext) => exe.toLowerCase().endsWith(ext))) {
      throw err("runtime.command may not start a .bat/.cmd/.ps1 launcher (they need a shell); use an .exe or an interpreter plus script");
    }
    if (/^(\.\.?)[/\\]/.test(exe)) {
      const normalized = path.posix.normalize(exe.replace(/\\/g, "/"));
      if (normalized === ".." || normalized.startsWith("../")) throw err("runtime.command executable must stay inside the plugin directory");
    }
    command = [...(cmd as string[])];
  } else {
    endpoint = { ...table(doc, "endpoint", true) };
    const base = endpoint["base_url"];
    if (base !== undefined && !(typeof base === "string" && /^https?:\/\//.test(base))) throw err("endpoint.base_url must be an http(s) URL");
    const auth = endpoint["auth"] ?? { scheme: "bearer" };
    if (!isTable(auth) || !["bearer", "header"].includes(String(auth["scheme"] ?? "bearer"))) {
      throw err("endpoint.auth.scheme must be 'bearer' or 'header'");
    }
    const derive = endpoint["derive"] ?? {};
    if (!isTable(derive) || !Object.values(derive).every((v) => typeof v === "string")) throw err("endpoint.derive must be a table of strings");
    for (const dk of Object.keys(derive)) {
      if (dk !== "sandbox_base_url" && dk !== "sandbox_domain") throw err(`endpoint.derive.${dk} is not derivable`);
    }
  }

  const ms = (key: string, dflt: number): number => {
    const v = runtime[key] ?? dflt;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 100 || v > 3_600_000) {
      throw err(`runtime.${key} must be an integer between 100 and 3600000`);
    }
    return v;
  };

  const platforms = strList(runtime, "platforms", "runtime");
  const feats = table(doc, "features", true);
  const supported = strList(feats, "supported", "features");
  const unknown = supported.filter((f) => !(FEATURES as readonly string[]).includes(f));
  if (unknown.length > 0) throw err(`unknown feature(s): ${[...new Set(unknown)].sort().join(", ")}`);

  const sec = table(doc, "security");
  const security: SecuritySection = {
    network: strList(sec, "network", "security"),
    filesystem: strList(sec, "filesystem", "security"),
    env_passthrough: strList(sec, "env_passthrough", "security"),
    spawns_processes: Boolean(sec["spawns_processes"] ?? false),
  };
  for (const scope of security.filesystem) {
    if (!(FILESYSTEM_SCOPES as readonly string[]).includes(scope)) throw err(`security.filesystem: unknown scope '${scope}'`);
  }
  for (const name of security.env_passthrough) {
    if (FORBIDDEN_ENV_PREFIXES.some((p) => name.toUpperCase().startsWith(p)) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw err(`security.env_passthrough may not name '${name}'`);
    }
  }

  const core = table(doc, "core");
  const inherit = strList(core, "inherit", "core");
  const bad = inherit.filter((k) => !GENERIC_ENDPOINT_KEYS.includes(k));
  if (bad.length > 0) {
    throw err(`core.inherit may only contain ${GENERIC_ENDPOINT_KEYS.join(", ")} (got ${[...new Set(bad)].sort().join(", ")})`);
  }

  const fieldsTbl = table(table(doc, "config"), "fields");
  const fields: ConfigField[] = [];
  for (const [fkey, specRaw] of Object.entries(fieldsTbl)) {
    if (!isTable(specRaw)) throw err(`config.fields.${fkey} must be a table`);
    const spec = specRaw;
    if (!FIELD_KEY_RE.test(fkey)) throw err(`field key '${fkey}' must match ^[a-z][a-z0-9_]*$`);
    if (CORE_KEY_NAMES.includes(fkey) || fkey.startsWith("shortcuts")) throw err(`field key '${fkey}' collides with a core key`);
    const where = `config.fields.${fkey}`;
    const ftype = str(spec, "type", where, { default: "string" });
    if (!(FIELD_TYPES as readonly string[]).includes(ftype)) throw err(`${where}.type '${ftype}' is not one of ${FIELD_TYPES.join(", ")}`);
    const secret = Boolean(spec["secret"] ?? false);
    if (secret && "default" in spec && spec["default"] !== "" && spec["default"] !== null) {
      throw err(`${where}: secret fields may not have a default`);
    }
    const envNames = strList(spec, "env", where);
    for (const en of envNames) {
      if (FORBIDDEN_ENV_PREFIXES.some((p) => en.toUpperCase().startsWith(p))) throw err(`${where}.env may not use the reserved name '${en}'`);
    }
    const choices = strList(spec, "choices", where);
    if (ftype === "enum" && choices.length === 0) throw err(`${where}: enum fields need 'choices'`);
    fields.push({
      key: fkey,
      type: ftype === "string" ? "str" : ftype,
      required: Boolean(spec["required"] ?? false),
      secret,
      credential: Boolean(spec["credential"] ?? false),
      default: plainDefault(spec["default"]),
      description: str(spec, "description", where),
      description_zh: str(spec, "description_zh", where),
      env: envNames,
      choices,
    });
  }
  const fieldKeys = new Set(fields.map((f) => f.key));

  const authTbl = table(doc, "auth");
  const anyOfRaw = authTbl["any_of"] ?? [];
  const anyOf: string[][] = [];
  if (!Array.isArray(anyOfRaw)) throw err("auth.any_of must be an array of arrays");
  for (const grp of anyOfRaw) {
    if (!Array.isArray(grp) || !grp.every((g) => typeof g === "string")) throw err("auth.any_of must be an array of arrays of strings");
    const missing = (grp as string[]).filter((g) => !fieldKeys.has(g) && !GENERIC_ENDPOINT_KEYS.includes(g));
    if (missing.length > 0) throw err(`auth.any_of references undeclared field(s): ${missing.join(", ")}`);
    anyOf.push([...(grp as string[])]);
  }

  const name = str(prov, "name", "provider", { default: pid }) || pid;
  return {
    id: pid,
    name,
    name_zh: str(prov, "name_zh", "provider"),
    version,
    description: str(prov, "description", "provider"),
    license: str(prov, "license", "provider"),
    homepage: str(prov, "homepage", "provider"),
    kind,
    protocol,
    requires: { ...(requiresRaw as Record<string, string>) },
    command,
    entry,
    startup_timeout_ms: ms("startup_timeout_ms", 10_000),
    call_timeout_ms: ms("call_timeout_ms", 60_000),
    platforms,
    features: supported,
    operation_contract_version: 1, operations, workflow_inputs, startup_modes,
    commands: parseCommandSection(unfloat(doc["commands"]), kind),
    security,
    inherit,
    auth_any_of: anyOf,
    fields,
    endpoint: unfloat(endpoint) as Record<string, unknown>,
    sha256: createHash("sha256").update(rawBytes).digest("hex"),
    raw: unfloat(doc) as Record<string, unknown>,
  };
}

/** The error for a plugin root without `abx-provider.toml`. */
export function missingManifestError(): ProviderManifestError {
  return new ProviderManifestError(`Invalid ${MANIFEST_NAME}: file not found at the plugin root.`, {
    suggestion: "Point SOURCE at the directory that contains abx-provider.toml (owner/repo//subdir or --subdir).",
  });
}

/** Read and parse `<directory>/abx-provider.toml`. */
export function loadManifest(directory: string): Manifest {
  const file = path.join(directory, MANIFEST_NAME);
  let data: Buffer;
  try {
    data = fs.readFileSync(file);
  } catch (exc) {
    const e = exc as NodeJS.ErrnoException;
    if (e.code === "ENOENT") throw missingManifestError();
    throw new ProviderManifestError(`Invalid ${MANIFEST_NAME}: cannot read ${MANIFEST_NAME}: ${e.code ?? e.message}.`);
  }
  return parseManifest(data);
}
