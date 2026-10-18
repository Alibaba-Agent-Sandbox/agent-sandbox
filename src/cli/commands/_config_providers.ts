/**
 * Provider-aware `abx config` keys: `provider`, `providers.<id>.<key>`, bare keys of the effective provider (the built-in
 * `acr_*` / `team_id` keys, or a plugin's options) and the audit/migration helpers. Grammar and storage rules:
 * `docs/design/providers-and-credentials-cli.md` sections 2 and 3.
 *
 * Everything the long-standing `config` code already handles (`sandbox_api_key`, `api_url`, `region`, ...) stays in
 * `config_cmd.ts`; this module only adds keys, so a user who never installed or selected a provider sees no change.
 */

import { ProviderConfigError } from "../../providers/errors.js";
import * as registry from "../../providers/registry.js";
import { cliProvider } from "../../providers/selection.js";
import { setDefaultProvider, setEnvValue, setTomlValue } from "../../providers/settings.js";
import { collectSources, loadTomlFile, paths, quietly, readDotenv, resetLayeredConfig, selectProviderId } from "../../transport/config_layers.js";
import { coerce, resolveKey } from "../../utils/config_resolver.js";
import { BUILTIN_PROVIDER_ID, getKey, type ConfigKey } from "../../utils/config_keys.js";
import * as fs from "node:fs";
import * as path from "node:path";

export interface ExtraTarget {
  kind: "default_provider" | "key";
  /** Provider the key belongs to (or is scoped for). */
  provider_id: string;
  key: ConfigKey | null;
  /** `providers.<id>.<core key>`: an override stored in `[providers.<id>]`. */
  scoped: boolean;
  /** The key exactly as the user typed it (echoed in messages). */
  typed: string;
}

export function effectiveProviderId(): string {
  return cliProvider() ?? selectProviderId(collectSources());
}

function schemaKeys(providerId: string): readonly ConfigKey[] {
  return registry.getProvider(providerId).configKeys();
}

/** The keys a bare name can address for provider `providerId` (its schema only; core keys are the caller's business). */
function findProviderKey(providerId: string, name: string): ConfigKey | undefined {
  return schemaKeys(providerId).find((k) => k.key === name);
}

/**
 * Resolve a key the legacy `config` code does not know. `null` when `typed` is not a provider key at all (the caller then
 * reports an unknown key). Throws `ProviderNotFoundError` (E8001) / `ProviderConfigError` (E8002) for malformed ones.
 */
export function resolveExtraKey(typed: string): ExtraTarget | null {
  if (typed === "provider") return { kind: "default_provider", provider_id: BUILTIN_PROVIDER_ID, key: null, scoped: false, typed };
  const qualified = /^providers\.([^.]+)\.(.+)$/.exec(typed);
  if (qualified) {
    const id = qualified[1] as string;
    const name = qualified[2] as string;
    const provider = registry.getProvider(id);
    const own = findProviderKey(id, name);
    if (own) return { kind: "key", provider_id: id, key: own, scoped: false, typed };
    const core = getKey(name);
    if (core && provider.inherit.has(name)) return { kind: "key", provider_id: id, key: core, scoped: true, typed };
    const known = [...schemaKeys(id).map((k) => k.key), ...[...provider.inherit].sort()];
    throw new ProviderConfigError(`Unknown config key '${name}' for provider '${id}'.`, {
      suggestion: `Available keys: ${known.join(", ") || "(none)"}`,
    });
  }
  if (typed.startsWith("providers.")) {
    throw new ProviderConfigError(`Malformed key '${typed}'.`, { suggestion: "Use providers.<id>.<key>, for example providers.alicloud-express.region." });
  }
  const id = effectiveProviderId();
  const key = findProviderKey(id, typed);
  return key ? { kind: "key", provider_id: id, key, scoped: false, typed } : null;
}

/** Other installed providers (and the built-in one) that declare `name`: powers the "Did you mean ..." hint. */
export function providersDeclaring(name: string): string[] {
  const out: string[] = [];
  for (const summary of registry.listProviders()) {
    if (summary.id === effectiveProviderId()) continue;
    try {
      if (findProviderKey(summary.id, name)) out.push(summary.id);
    } catch {
      /* a broken install is reported by `provider doctor`, not here */
    }
  }
  return out;
}

const _REGISTRY_NAMES: Readonly<Record<string, string>> = { api_url: "sandbox_base_url", domain: "sandbox_domain" };

/**
 * The registry key behind a long-standing `config` key (`api_url` -> `sandbox_base_url`, ...). Used once
 * `[core] config_format = 2`, where values live under their canonical names and only the resolver knows where.
 */
export function coreTarget(internal: string, typed: string): ExtraTarget | null {
  const name = _REGISTRY_NAMES[internal] ?? internal;
  const providerId = effectiveProviderId();
  const provider = registry.getProvider(providerId);
  const own = findProviderKey(providerId, name);
  if (own) return { kind: "key", provider_id: providerId, key: own, scoped: false, typed };
  const core = getKey(name);
  if (!core || core.scope !== "core") return null;
  if (["sandbox_api_key", "sandbox_base_url", "sandbox_domain"].includes(name) && !provider.inherit.has(name)) return null;
  return { kind: "key", provider_id: providerId, key: core, scoped: false, typed };
}

export function configFormat(): number {
  const core = quietly(() => loadTomlFile(paths.configFile))["core"];
  const raw = core && typeof core === "object" ? (core as Record<string, unknown>)["config_format"] : undefined;
  return raw === 2 || raw === "2" ? 2 : 1;
}

// ---------------------------------------------------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------------------------------------------------

export interface ExtraValue {
  value: unknown;
  /** The concrete variable / file key that supplied the value ("" when unset or defaulted). */
  name: string;
  /** `env`, `user`, `default` or `unset` (the labels `config list` uses). */
  source: string;
}

export function readExtra(target: ExtraTarget): ExtraValue {
  if (target.kind === "default_provider") {
    const resolved = selectProviderId(collectSources());
    const sources = collectSources();
    const env = sources.environ?.["ABX_PROVIDER"];
    const source = env && env.trim() ? "env" : resolved === BUILTIN_PROVIDER_ID ? "default" : "user";
    return { value: resolved, name: source === "env" ? "ABX_PROVIDER" : "", source };
  }
  const key = target.key as ConfigKey;
  const res = resolveKey(key, collectSources(), { scopedFor: target.provider_id });
  if (res === null) return { value: null, name: "", source: "unset" };
  const source = res.layer === "environ" ? "env" : res.layer === "default" || res.layer === "derived" ? "default" : "user";
  return { value: res.value, name: res.name, source };
}

// ---------------------------------------------------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------------------------------------------------

type Where = { file: "env" | "toml"; name: string; section?: string };

function primaryStorage(target: ExtraTarget): Where {
  const key = target.key as ConfigKey;
  if (target.scoped) {
    return { file: "toml", name: key.key, section: `providers.${target.provider_id}` };
  }
  const storage = configFormat() === 2 ? key.storage_phase2 : key.storage_phase1;
  if (storage) return storage as Where;
  return { file: "toml", name: key.key, section: `providers.${target.provider_id}` };
}

/** Every place a value of this key may be stored (canonical and legacy names, both phases). */
function allStorages(target: ExtraTarget): Where[] {
  const key = target.key as ConfigKey;
  const out: Where[] = [primaryStorage(target)];
  if (!target.scoped) {
    for (const s of [key.storage_phase1, key.storage_phase2]) if (s) out.push(s as Where);
    for (const a of key.aliases) {
      if (a.kind !== "legacy") continue;
      if (a.surface === "env") out.push({ file: "env", name: a.name });
      if (a.surface === "config" || a.surface === "kwarg") out.push({ file: "toml", name: a.name, section: "transport" });
    }
  }
  const seen = new Set<string>();
  return out.filter((w) => {
    const token = `${w.file}:${w.section ?? ""}:${w.name}`;
    if (seen.has(token)) return false;
    seen.add(token);
    return true;
  });
}

function envFilePath(): string {
  return path.join(path.dirname(paths.configFile), ".env");
}

function isStored(where: Where): boolean {
  if (where.file === "env") {
    const file = envFilePath();
    if (!fs.existsSync(file)) return false;
    const v = readDotenv(file)[where.name];
    return v !== undefined && v.trim() !== "";
  }
  const toml = loadTomlFile(paths.configFile);
  let node: unknown = toml;
  for (const part of (where.section ?? "").split(".")) {
    if (part === "") continue;
    node = node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined;
  }
  if (!node || typeof node !== "object") return false;
  const v = (node as Record<string, unknown>)[where.name];
  return v !== undefined && v !== null && v !== "";
}

function removeWhere(where: Where): void {
  if (where.file === "env") setEnvValue(where.name, null);
  else setTomlValue(where.section ?? "transport", where.name, null);
}

/** Validate and type `text` for `key` (a bad value is an E8002 / exit 2). */
export function parseExtraValue(target: ExtraTarget, text: string): string | number | boolean {
  const key = target.key as ConfigKey;
  const value = coerce(key, text);
  if (value === null) {
    const reason = key.type === "enum" ? `expected one of ${key.choices.join(", ")}` : `expected ${key.type}`;
    throw new ProviderConfigError(`Invalid value for '${target.typed}': ${reason}.`);
  }
  if (key.type === "url") {
    try {
      new URL(String(value));
    } catch {
      throw new ProviderConfigError(`Invalid value for '${target.typed}': not a URL.`);
    }
  }
  return value as string | number | boolean;
}

/** Store the value; returns the value to echo (masked for secrets by the caller). */
export function writeExtra(target: ExtraTarget, text: string): string | number | boolean {
  if (target.kind === "default_provider") {
    registry.getProvider(text);
    setDefaultProvider(text === BUILTIN_PROVIDER_ID ? null : text);
    resetLayeredConfig();
    return text;
  }
  const typed = parseExtraValue(target, text);
  const where = primaryStorage(target);
  const keep = where;
  if (configFormat() === 2) {
    for (const w of allStorages(target)) if (w !== keep && !(w.file === keep.file && w.name === keep.name && w.section === keep.section)) removeWhere(w);
  }
  if (where.file === "env") setEnvValue(where.name, String(typed));
  else setTomlValue(where.section ?? "transport", where.name, typed);
  resetLayeredConfig();
  return typed;
}

/** Remove every stored name of the key; returns whether something was stored. */
export function clearExtra(target: ExtraTarget): boolean {
  if (target.kind === "default_provider") {
    const had = selectProviderId({ toml: loadTomlFile(paths.configFile), environ: {}, dotenv: [] }) !== BUILTIN_PROVIDER_ID;
    setDefaultProvider(null);
    resetLayeredConfig();
    return had;
  }
  let removed = false;
  for (const w of allStorages(target)) {
    if (isStored(w)) {
      removed = true;
      removeWhere(w);
    }
  }
  resetLayeredConfig();
  return removed;
}

/** `Available keys` additions shown once a provider is installed or selected (spec section 3.8). */
export function extraKeyNames(): string[] {
  const names = new Set<string>(["provider"]);
  const id = effectiveProviderId();
  try {
    for (const k of schemaKeys(id)) names.add(k.key);
  } catch {
    /* unknown provider: reported where it is used */
  }
  if (id !== BUILTIN_PROVIDER_ID) for (const k of schemaKeys(BUILTIN_PROVIDER_ID)) names.add(k.key);
  names.add("providers.<id>.<key>");
  return [...names];
}
