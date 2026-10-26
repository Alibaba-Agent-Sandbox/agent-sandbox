/**
 * Pure layered resolver for the canonical configuration keys (port of the resolver half of
 * `agent_sandbox/utils/config_keys.py`).
 *
 * Resolution is **layer-first**: layers are tried in order (overrides, process environment, each dotenv file,
 * `config.toml`, default) and inside a layer the names are tried most-specific first. A blank or whitespace-only
 * value is unset in every layer. Nothing here touches the filesystem or `process.env`; sources are injected, so the
 * language-neutral vectors (`tests/fixtures/config-resolution-vectors.json`) run against it unchanged.
 */

import { pyFloatParse, pyStrip } from "./_pyformat.js";
import {
  BUILTIN_PROVIDER_ID,
  CORE_KEYS,
  GENERIC_ENDPOINT_KEYS,
  aliasNames,
  envNames,
  getKey,
  type ConfigKey,
} from "./config_keys.js";

export type Layer = "override" | "environ" | "dotenv" | "toml" | "default" | "derived";

/** Injected configuration sources (plain data). */
export interface Sources {
  overrides?: Readonly<Record<string, unknown>>;
  environ?: Readonly<Record<string, string>>;
  dotenv?: ReadonlyArray<Readonly<Record<string, string>>>;
  toml?: Readonly<Record<string, unknown>>;
}

export interface Resolved {
  key: string;
  value: unknown;
  layer: Layer;
  /** The concrete name that supplied the value ("" for defaults/derived). */
  name: string;
  /** Index of the dotenv file for `layer === "dotenv"`. */
  layer_index: number;
}

const TRUE = new Set(["true", "1", "yes", "on"]);
const FALSE = new Set(["false", "0", "no", "off"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

function has(obj: object, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, name);
}

/** Coerce `raw` to the key's type; `null` means unset/invalid (blank value, bad number, bad bool/enum). */
export function coerce(key: ConfigKey, raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  const t = key.type;
  if (Array.isArray(raw)) {
    return t === "csv" ? raw.map((x) => String(x)).join(",") || null : null;
  }
  if (t === "bool" && typeof raw === "boolean") return raw;
  let text = typeof raw === "string" ? pyStrip(raw) : pyStrip(String(raw));
  if (typeof raw === "boolean") text = text.toLowerCase();
  if (!text) return null;
  if (t === "float") return pyFloatParse(text);
  if (t === "int") {
    if (/^[+-]?\d+\.0*$/.test(text)) return Math.trunc(Number(text));
    if (/^[+-]?\d+(?:_\d+)*$/.test(text)) return Number(text.replace(/_/g, ""));
    return null;
  }
  if (t === "bool") {
    const low = text.toLowerCase();
    if (TRUE.has(low)) return true;
    if (FALSE.has(low)) return false;
    return null;
  }
  if (t === "enum" && key.choices.length > 0) {
    return key.choices.includes(text.toUpperCase()) ? text.toUpperCase() : null;
  }
  return text;
}

/** Parse a configured value with the same URL/numeric checks for prompts, writes and diagnostics. */
export function validateConfigValue(key: ConfigKey, raw: unknown): unknown {
  const value = coerce(key, raw);
  if (value === null) return null;
  if ((key.type === "float" || key.type === "int") && !Number.isFinite(Number(value))) return null;
  if (key.type === "url") {
    try {
      const url = new URL(String(value));
      if (["sandbox_base_url", "llm_base_url"].includes(key.key) && !["http:", "https:"].includes(url.protocol)) return null;
    } catch { return null; }
  }
  return value;
}

/** Resolve declared authentication alternatives without performing terminal I/O. */
export function authenticationChoices(
  groups: readonly (readonly string[])[],
  declared: ReadonlySet<string>,
  have: (key: string) => boolean,
): { complete: readonly string[] | undefined; possible: readonly (readonly string[])[] } {
  const possible = groups.filter(group => group.every(key => declared.has(key)));
  return { complete: possible.find(group => group.every(have)), possible };
}

/** `[display name, raw value]` candidates inside a TOML document, most specific first. */
function tomlLookups(key: ConfigKey, toml: Readonly<Record<string, unknown>>, scopedFor: string | null): Array<[string, unknown]> {
  if (key.secret || key.storage?.file === "env") return [];
  const out: Array<[string, unknown]> = [];
  const providers = toml["providers"];
  const provScope = key.scope !== "core" ? key.scope : scopedFor;
  if (provScope && isRecord(providers)) {
    const table = providers[provScope];
    if (isRecord(table) && has(table, key.key)) out.push([`providers.${provScope}.${key.key}`, table[key.key]]);
  }
  let section: string;
  if (key.scope === "core") section = key.toml_section ?? "transport";
  else if (key.scope === BUILTIN_PROVIDER_ID) section = "transport";
  else return out;
  const names = [...new Set([key.key, ...aliasNames(key, "config"), ...aliasNames(key, "kwarg")])];
  const tableObj = toml[section];
  if (isRecord(tableObj)) {
    for (const n of names) if (has(tableObj, n)) out.push([`${section}.${n}`, tableObj[n]]);
  }
  return out;
}

export function overrideNames(key: ConfigKey): string[] {
  return [...new Set([key.key, ...aliasNames(key, "kwarg")])];
}

export interface ResolveOptions {
  /** Provider whose `[providers.<id>]` table / `ABX_<ID>_<KEY>` variable may override an inherited core key. */
  scopedFor?: string | null;
  useDefault?: boolean;
}

/** Resolve `key`; `null` when nothing is set and no default applies. */
export function resolveKey(key: ConfigKey, sources: Sources, opts: ResolveOptions = {}): Resolved | null {
  const scopedFor = opts.scopedFor ?? null;
  const useDefault = opts.useDefault ?? true;
  const overrides = sources.overrides ?? {};
  for (const name of overrideNames(key)) {
    if (has(overrides, name)) {
      const val = coerce(key, overrides[name]);
      if (val !== null) return { key: key.key, value: val, layer: "override", name, layer_index: 0 };
    }
  }
  const names = envNames(key, { scopedFor });
  const environ = sources.environ ?? {};
  for (const name of names) {
    if (has(environ, name)) {
      const val = coerce(key, environ[name]);
      if (val !== null) return { key: key.key, value: val, layer: "environ", name, layer_index: 0 };
    }
  }
  const dotenv = sources.dotenv ?? [];
  for (let idx = 0; idx < dotenv.length; idx++) {
    const envMap = dotenv[idx] as Record<string, string>;
    for (const name of names) {
      if (has(envMap, name)) {
        const val = coerce(key, envMap[name]);
        if (val !== null) return { key: key.key, value: val, layer: "dotenv", name, layer_index: idx };
      }
    }
  }
  for (const [name, raw] of tomlLookups(key, sources.toml ?? {}, scopedFor)) {
    const val = coerce(key, raw);
    if (val !== null) return { key: key.key, value: val, layer: "toml", name, layer_index: 0 };
  }
  if (useDefault && key.default !== null && key.default !== undefined) {
    return { key: key.key, value: key.default, layer: "default", name: "", layer_index: 0 };
  }
  return null;
}

/** Resolve the `provider` key (explicit > env > dotenv > `[core]` > built-in). */
export function resolveProviderId(sources: Sources): Resolved {
  const key = getKey("provider");
  if (!key) throw new Error("config registry has no 'provider' key");
  const res = resolveKey(key, sources);
  if (!res) throw new Error("provider key has no default");
  return res;
}

/** Provider-owned data required by the pure configuration resolver. */
export interface ConfigurationSchema {
  provider_id: string;
  keys: readonly ConfigKey[];
  inherit: ReadonlySet<string>;
  derive: Readonly<Record<string, string>>;
  endpoint_defaults: Readonly<Record<string, string>>;
}

function pyFormatTemplate(template: string, fields: Record<string, string>): string | null {
  let missing = false;
  const out = template.replace(/\{(\w+)\}/g, (_m, name: string) => {
    if (!(name in fields)) {
      missing = true;
      return "";
    }
    return fields[name] as string;
  });
  return missing ? null : out;
}

function applyDerive(sources: Sources, schema: ConfigurationSchema, out: Map<string, Resolved>): void {
  const baseKey = getKey("sandbox_base_url");
  if (!baseKey) throw new Error("config registry has no 'sandbox_base_url' key");
  if (schema.inherit.has("sandbox_base_url")) {
    const explicit = resolveKey(
      baseKey,
      { overrides: sources.overrides ?? {}, environ: sources.environ ?? {} },
      { scopedFor: schema.provider_id, useDefault: false },
    );
    if (explicit !== null) return;
  }
  for (const [keyName, template] of Object.entries(schema.derive)) {
    const current = out.get(keyName);
    if (current !== undefined && current.layer !== "default") continue;
    const fields: Record<string, string> = {};
    for (const [k, v] of out) if (v.layer !== "default") fields[k] = String(v.value);
    const value = pyFormatTemplate(template, fields);
    if (value === null) continue;
    out.set(keyName, { key: keyName, value, layer: "derived", name: "", layer_index: 0 });
  }
}

/** Resolve all applicable fields without filesystem access or Provider implementation imports. */
export function resolveConfiguration(sources: Sources, schema: ConfigurationSchema): Map<string, Resolved> {
  const out = new Map<string, Resolved>();
  const pid = schema.provider_id;
  for (const key of CORE_KEYS) {
    if (key.key === "provider") continue;
    const generic = GENERIC_ENDPOINT_KEYS.includes(key.key);
    if (generic && !schema.inherit.has(key.key)) continue;
    let res = resolveKey(key, sources, { scopedFor: generic ? pid : null, useDefault: !generic });
    if (res === null && key.key in schema.endpoint_defaults) {
      res = { key: key.key, value: schema.endpoint_defaults[key.key], layer: "default", name: "", layer_index: 0 };
    }
    if (res !== null) out.set(key.key, res);
  }
  for (const key of schema.keys) {
    const res = resolveKey(key, sources);
    if (res !== null) out.set(key.key, res);
    else out.delete(key.key); // An absent Provider-owned field cannot borrow a same-named core default.
  }
  if (Object.keys(schema.derive).length > 0) applyDerive(sources, schema, out);
  return out;
}
