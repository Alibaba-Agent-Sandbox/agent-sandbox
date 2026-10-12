/**
 * Pure layered resolver for the canonical configuration keys (port of the resolver half of
 * `easy_sandbox/utils/config_keys.py`).
 *
 * Resolution is **layer-first**: layers are tried in order (overrides, process environment, each dotenv file,
 * `config.toml`, default) and inside a layer the names are tried most-specific first. A blank or whitespace-only
 * value is unset in every layer. Nothing here touches the filesystem or `process.env`; sources are injected, so the
 * language-neutral vectors (`tests/fixtures/config-resolution-vectors.json`) run against it unchanged.
 */

import { pyFloatParse, pyStrip } from "./_pyformat.js";
import {
  BUILTIN_PROVIDER_ID,
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

/** `[display name, raw value]` candidates inside a TOML document, most specific first. */
function tomlLookups(key: ConfigKey, toml: Readonly<Record<string, unknown>>, scopedFor: string | null): Array<[string, unknown]> {
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
  } else if (section === "transport" && !has(toml, "transport")) {
    for (const n of names) if (has(toml, n) && !isRecord(toml[n])) out.push([n, toml[n]]);
  }
  return out;
}

export function overrideNames(key: ConfigKey): string[] {
  return [...new Set([key.key, ...aliasNames(key, "kwarg")])];
}

export interface ResolveOptions {
  /** Provider whose `[providers.<id>]` table / `EBX_<ID>_<KEY>` variable may override an inherited core key. */
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
