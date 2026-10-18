import { bundledConfig, bundledConfigs, bundledKeys, defaultConfig, legacyDataPlanePort, legacyDataPlaneUrl } from "../utils/bundled_config.js";
/**
 * Layered configuration with provider selection (port of the layered half of
 * `agent_sandbox/transport/config.py`; design: `docs/en/design/providers-and-credentials.md`).
 *
 * Resolution is layer-first: explicit overrides > process environment > `./.env` > `~/.abx/.env` >
 * `~/.abx/config.toml` > defaults. This module is additive: the legacy `transport/config.ts` loader is untouched and
 * `toTransportConfig()` bridges a resolved config to it until the commands are rewired (see
 * `docs/design/provider-wiring-plan.md`).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ProviderConfigError } from "../models/provider_errors.js";
import {
  BUILTIN_PROVIDER_ID,
  CORE_KEYS,
  GENERIC_ENDPOINT_KEYS,
  envNames,
  getKey,
  type ConfigKey,
} from "../utils/config_keys.js";
import { resolveKey, type Resolved, type Sources } from "../utils/config_resolver.js";
import { dotenvValues } from "../utils/_dotenv.js";
import { PyFloat, pyStrip } from "../utils/_pyformat.js";
import { parseTomlBytes } from "../utils/toml_plain.js";
import { dumpsToml } from "../utils/toml_write.js";
import { TransportConfig, _setLegacyNameHook, clearCachedConfigBytes, readCachedConfigBytes } from "./config.js";

export const ENVD_PORT = 49983;
export const DEFAULT_BASE_URL = defaultConfig.endpointDefaults.sandbox_base_url;
export const DEFAULT_DOMAIN = defaultConfig.endpointDefaults.sandbox_domain;

const LEGACY_FIELD_NAMES: Readonly<Record<string, string>> = {};

/** Live file locations; tests redirect them with the `_set*` seams (Python parity: module-level patchables). */
export const paths = {
  abxDir: path.join(os.homedir(), ".abx"),
  configFile: path.join(os.homedir(), ".abx", "config.toml"),
  envFiles: [".env", path.join(os.homedir(), ".abx", ".env")] as string[],
};

export function _setPaths(p: Partial<typeof paths>): void {
  Object.assign(paths, p);
}

/** Restore the default locations (derived from the current `HOME`). */
export function _resetPaths(): void {
  const dir = path.join(os.homedir(), ".abx");
  paths.abxDir = dir;
  paths.configFile = path.join(dir, "config.toml");
  paths.envFiles = [".env", path.join(dir, ".env")];
}

// ---------------------------------------------------------------------------
// Deprecation warnings (opt-in via ABX_WARN_DEPRECATED)
// ---------------------------------------------------------------------------

const warnedLegacy = new Set<string>();

export function _resetDeprecationWarnings(): void {
  warnedLegacy.clear();
}

/** Emit one DeprecationWarning per legacy name; silent unless `ABX_WARN_DEPRECATED` is truthy. */
export function warnLegacyOnce(name: string, canonical: string, where: string, environ: NodeJS.ProcessEnv = process.env): void {
  const flag = pyStrip(environ["ABX_WARN_DEPRECATED"] ?? "").toLowerCase();
  if (!["1", "true", "yes", "on"].includes(flag)) return;
  const token = `${where}:${name}`;
  if (warnedLegacy.has(token)) return;
  warnedLegacy.add(token);
  process.emitWarning(`${where} name '${name}' is deprecated; use '${canonical}'.`, "DeprecationWarning");
}

_setLegacyNameHook((name, where) => {
  for (const key of [...CORE_KEYS, ...bundledKeys]) {
    if (key.aliases.some((a) => a.surface === "env" && a.kind === "legacy" && a.name === name)) {
      warnLegacyOnce(name, key.env, where);
      return;
    }
  }
});

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && !pyStrip(v));
}

/** Map legacy kwarg names to canonical ones; different values for both names is a caller bug. */
export function mergeLegacyKwargs(data: Record<string, unknown>, source: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const [legacy, canonical] of Object.entries(LEGACY_FIELD_NAMES)) {
    if (!(legacy in out)) continue;
    const legacyVal = out[legacy];
    delete out[legacy];
    if (isBlank(legacyVal)) continue;
    warnLegacyOnce(legacy, canonical, source);
    if (canonical in out && !isBlank(out[canonical])) {
      if (out[canonical] !== legacyVal) {
        throw new ProviderConfigError(
          `Conflicting values for '${canonical}' and its legacy name '${legacy}'; pass only one.`,
        );
      }
      continue;
    }
    out[canonical] = legacyVal;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The resolved configuration object
// ---------------------------------------------------------------------------

export interface LayeredConfigInit {
  provider?: string;
  sandbox_base_url?: string;
  sandbox_domain?: string;
  region?: string;
  sandbox_api_key?: string | null;
  access_key_id?: string | null;
  access_key_secret?: string | null;
  provider_options?: Record<string, unknown>;
  http_timeout?: number;
  max_connections?: number;
  max_keepalive_connections?: number;
  keepalive_expiry?: number;
  http2?: boolean;
  ws_ping_interval?: number;
  max_retries?: number;
  retry_base_delay?: number;
}

/** Transport configuration of the selected provider (port of the Python `TransportConfig`). */
export class LayeredConfig {
  provider: string;
  sandbox_base_url: string;
  sandbox_domain: string;
  region: string;
  sandbox_api_key: string | null;
  access_key_id: string | null;
  access_key_secret: string | null;
  provider_options: Record<string, unknown>;
  http_timeout: number;
  max_connections: number;
  max_keepalive_connections: number;
  keepalive_expiry: number;
  http2: boolean;
  ws_ping_interval: number;
  max_retries: number;
  retry_base_delay: number;

  constructor(init: LayeredConfigInit = {}) {
    const data = mergeLegacyKwargs({ ...init } as Record<string, unknown>, "LayeredConfig") as LayeredConfigInit;
    this.provider = data.provider ?? BUILTIN_PROVIDER_ID;
    this.sandbox_base_url = data.sandbox_base_url ?? bundledConfig(this.provider)?.endpointDefaults["sandbox_base_url"] ?? "";
    this.sandbox_domain = data.sandbox_domain ?? bundledConfig(this.provider)?.endpointDefaults["sandbox_domain"] ?? "";
    this.region = data.region ?? (bundledConfig(this.provider)?.keys.find((key) => key.key === "region")?.default as string | undefined) ?? "";
    this.sandbox_api_key = data.sandbox_api_key ?? null;
    this.access_key_id = data.access_key_id ?? null;
    this.access_key_secret = data.access_key_secret ?? null;
    this.provider_options = data.provider_options ?? {};
    this.http_timeout = data.http_timeout ?? 30;
    this.max_connections = data.max_connections ?? 100;
    this.max_keepalive_connections = data.max_keepalive_connections ?? 20;
    this.keepalive_expiry = data.keepalive_expiry ?? 30;
    this.http2 = data.http2 ?? true;
    this.ws_ping_interval = data.ws_ping_interval ?? 30;
    this.max_retries = data.max_retries ?? 3;
    this.retry_base_delay = data.retry_base_delay ?? 1;
    this.validate();
  }

  private validate(): void {
    const bounds: Array<[string, number, number]> = [
      ["http_timeout", this.http_timeout, 1],
      ["max_connections", this.max_connections, 1],
      ["max_keepalive_connections", this.max_keepalive_connections, 1],
      ["keepalive_expiry", this.keepalive_expiry, 1],
      ["ws_ping_interval", this.ws_ping_interval, 1],
      ["max_retries", this.max_retries, 0],
      ["retry_base_delay", this.retry_base_delay, 0.1],
    ];
    for (const [name, value, min] of bounds) {
      if (!(value >= min)) throw new ProviderConfigError(`Invalid ${name}: ${String(value)} (must be >= ${min}).`);
    }
  }

  get api_key(): string | null {
    return this.sandbox_api_key;
  }
  set api_key(v: string | null) {
    this.sandbox_api_key = v;
  }
  get api_url(): string {
    return this.sandbox_base_url;
  }
  set api_url(v: string) {
    this.sandbox_base_url = v;
  }
  get api_base_url(): string {
    return this.sandbox_base_url;
  }
  set api_base_url(v: string) {
    this.sandbox_base_url = v;
  }
  get domain(): string {
    return this.sandbox_domain;
  }
  set domain(v: string) {
    this.sandbox_domain = v;
  }

  buildEnvdUrl(sandboxId: string): string {
    return legacyDataPlaneUrl(sandboxId, this.sandbox_domain);
  }
  build_envd_url(sandboxId: string): string {
    return this.buildEnvdUrl(sandboxId);
  }

  /** Bridge to the legacy transport config the existing `api/` layer consumes. */
  toTransportConfig(): TransportConfig {
    return new TransportConfig({
      api_url: this.sandbox_base_url,
      domain: this.sandbox_domain,
      region: this.region,
      api_key: this.sandbox_api_key,
      access_key_id: this.access_key_id,
      access_key_secret: this.access_key_secret,
      http_timeout: new PyFloat(this.http_timeout),
      max_connections: this.max_connections,
      max_keepalive_connections: this.max_keepalive_connections,
      keepalive_expiry: new PyFloat(this.keepalive_expiry),
      http2: this.http2,
      ws_ping_interval: new PyFloat(this.ws_ping_interval),
      max_retries: this.max_retries,
      retry_base_delay: new PyFloat(this.retry_base_delay),
    });
  }
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Run `fn` for probes that must not add output.
 *
 * The layered TOML loader no longer emits `Failed to load` (that line belongs to `_loadTomlFile`, once).
 * The wrapper stays so existing callers keep a single place to mark a silent read.
 */
export function quietly<T>(fn: () => T): T {
  return fn();
}

/**
 * Load a TOML file as plain data; an unreadable or invalid file is an empty document (with a warning).
 *
 * Does not log `Loaded config` or `Failed to load`. Those lines belong to `transport/config.ts` `_loadTomlFile`
 * (the Python CLI's single loader), and only once per file. This loader is called once per key while `config list`
 * probes ACR and provider values; warning here repeated the friendly corruption message many times.
 */
export function loadTomlFile(p: string): Record<string, unknown> {
  if (!isFile(p)) return {};
  try {
    const buf = readCachedConfigBytes(p);
    if (buf === null) return {};
    const data = parseTomlBytes(buf);
    return { ...data };
  } catch {
    return {};
  }
}

/** Non-empty, stripped values of a dotenv file; an unreadable file yields nothing. */
export function readDotenv(p: string): Record<string, string> {
  let values: Map<string, string | null>;
  try {
    values = dotenvValues(p);
  } catch {
    return {};
  }
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [k, v] of values) {
    if (v && pyStrip(v)) out[k] = pyStrip(v);
  }
  return out;
}

export function dotenvLayers(): Array<Record<string, string>> {
  const layers: Array<Record<string, string>> = [];
  for (const candidate of paths.envFiles) {
    if (isFile(candidate)) layers.push(readDotenv(candidate));
  }
  return layers;
}

/** Snapshot the live sources (process env, `.env` files, `config.toml`). */
export function collectSources(overrides: Record<string, unknown> = {}): Sources {
  const environ: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) environ[k] = v;
  return { overrides, environ, dotenv: dotenvLayers(), toml: loadTomlFile(paths.configFile) };
}

// ---------------------------------------------------------------------------
// Provider schema + resolution
// ---------------------------------------------------------------------------

/** What the resolver needs to know about the selected provider. */
export class ProviderSchema {
  constructor(
    public readonly provider_id: string,
    public readonly keys: readonly ConfigKey[],
    public readonly inherit: ReadonlySet<string>,
    public readonly derive: Readonly<Record<string, string>> = {},
    public readonly endpoint_defaults: Readonly<Record<string, string>> = {},
    public readonly legacy_fields: ReadonlySet<string> = bundledConfig(provider_id)?.legacyFields ?? new Set(),
    public readonly omit_default_options: boolean = bundledConfig(provider_id)?.omitDefaultOptions ?? false,
  ) {}

  get builtin(): boolean {
    return bundledConfig(this.provider_id) !== undefined;
  }
}

export function builtinSchema(): ProviderSchema {
  return metadataSchema(defaultConfig);
}

function metadataSchema(metadata: import("../utils/bundled_config.js").BundledConfig): ProviderSchema {
  return new ProviderSchema(metadata.id, metadata.keys, metadata.inherit, metadata.derive,
    metadata.endpointDefaults, metadata.legacyFields, metadata.omitDefaultOptions);
}

type SchemaLookup = (providerId: string) => ProviderSchema;
let schemaLookup: SchemaLookup | null = null;

/** The provider registry installs its lookup here (avoids an import cycle with `providers/registry.ts`). */
export function setSchemaLookup(fn: SchemaLookup | null): void {
  schemaLookup = fn;
}

export function providerSchema(providerId: string): ProviderSchema {
  const metadata = bundledConfig(providerId);
  if (metadata) return metadataSchema(metadata);
  if (!schemaLookup) {
    throw new ProviderConfigError(`Provider '${providerId}' is not available (no provider registry is loaded).`);
  }
  return schemaLookup(providerId);
}

/** Provider selection: explicit > ABX_PROVIDER > ./.env > ~/.abx/.env > `[core]` > built-in. */
export function selectProviderId(sources: Sources): string {
  const key = getKey("provider");
  if (!key) throw new Error("config registry has no 'provider' key");
  const res = resolveKey(key, sources);
  if (!res) throw new Error("provider key has no default");
  return String(res.value);
}

function normaliseOverrides(overrides: Record<string, unknown>): Record<string, unknown> {
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(overrides)) if (k !== "provider" && k !== "provider_options") rest[k] = v;
  return mergeLegacyKwargs(rest, "load_config");
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

function applyDerive(sources: Sources, schema: ProviderSchema, out: Map<string, Resolved>): void {
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

/**
 * Resolve every key applicable to the selected provider. Keys that have neither a value nor a default are absent.
 */
export function resolveAll(sources: Sources, schemaIn?: ProviderSchema): { schema: ProviderSchema; resolved: Map<string, Resolved> } {
  const schema = schemaIn ?? providerSchema(selectProviderId(sources));
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
  }
  if (Object.keys(schema.derive).length > 0) applyDerive(sources, schema, out);
  return { schema, resolved: out };
}

const CONFIG_FIELD_NAMES = new Set([
  "sandbox_base_url",
  "sandbox_domain",
  "region",
  "sandbox_api_key",
  "access_key_id",
  "access_key_secret",
  "http_timeout",
  "max_connections",
  "max_keepalive_connections",
  "keepalive_expiry",
  "http2",
  "ws_ping_interval",
  "max_retries",
  "retry_base_delay",
]);

export interface LoadOptions {
  /** Pre-collected sources (tests); defaults to the live process/files. */
  sources?: Sources;
}

/**
 * Load the configuration of the selected provider. `overrides.provider` selects the provider,
 * `overrides.provider_options` passes provider-scoped values; canonical or legacy kwarg names are accepted.
 */
export function loadLayeredConfig(overrides: Record<string, unknown> = {}, opts: LoadOptions = {}): LayeredConfig {
  const cacheable = Object.keys(overrides).length === 0 && !opts.sources;
  if (cacheable && cached !== null) return cached;
  const config = loadUncached(overrides, opts);
  if (cacheable) cached = config;
  return config;
}

/** Clear the cached configuration (tests, `abx config set`). */
export function resetLayeredConfig(): void {
  cached = null;
  clearCachedConfigBytes();
}

let cached: LayeredConfig | null = null;

function loadUncached(overrides: Record<string, unknown>, opts: LoadOptions): LayeredConfig {
  const providerOverride = overrides["provider"];
  const options = { ...((overrides["provider_options"] as Record<string, unknown> | undefined) ?? {}) };
  const ov = normaliseOverrides(overrides);
  if (typeof providerOverride === "string" && pyStrip(providerOverride)) ov["provider"] = pyStrip(providerOverride);
  const coreNames = new Set([...CORE_KEYS.map((k) => k.key), ...Object.keys(LEGACY_FIELD_NAMES)]);
  for (const [k, v] of Object.entries(options)) if (!coreNames.has(k) && !(k in ov)) ov[k] = v;

  const sources = opts.sources ? { ...opts.sources, overrides: ov } : collectSources(ov);
  const { schema, resolved } = resolveAll(sources);

  const scoped = new Set(schema.keys.map((k) => k.key));
  const unknown = Object.keys(options).filter((k) => !scoped.has(k)).sort();
  if (unknown.length > 0) {
    throw new ProviderConfigError(`Unknown option(s) for provider '${schema.provider_id}': ${unknown.join(", ")}.`, {
      suggestion: `Run 'abx provider info ${schema.provider_id}' to list its options.`,
    });
  }

  const fieldScoped = schema.legacy_fields;
  const values: Record<string, unknown> = { provider: schema.provider_id };
  const opt: Record<string, unknown> = {};
  for (const [name, res] of resolved) {
    if (scoped.has(name)) {
      if (fieldScoped.has(name)) values[name] = res.value;
      else if (!schema.omit_default_options || res.layer !== "default") opt[name] = res.value;
    } else if (CONFIG_FIELD_NAMES.has(name)) {
      values[name] = res.value;
    }
  }
  const explicit: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(options)) if (scoped.has(k)) explicit[k] = v;
  values["provider_options"] = { ...opt, ...explicit };
  return new LayeredConfig(values as LayeredConfigInit);
}

// ---------------------------------------------------------------------------
// Explain / mask
// ---------------------------------------------------------------------------

/** Mask a secret for display (keeps the last 4 characters of long values). */
export function maskSecret(value: string): string {
  return value.length <= 8 ? "****" : `****${value.slice(-4)}`;
}

export interface ExplainEntry {
  value: unknown;
  source: string;
  name: string;
  secret: boolean;
}

/** Where every setting of the selected provider comes from; secret values are masked. Never exposes secrets. */
export function explainConfig(overrides: Record<string, unknown> = {}, opts: LoadOptions = {}): Record<string, ExplainEntry> {
  const providerOverride = overrides["provider"];
  const ov = normaliseOverrides(overrides);
  if (typeof providerOverride === "string" && pyStrip(providerOverride)) ov["provider"] = pyStrip(providerOverride);
  const sources = opts.sources ? { ...opts.sources, overrides: ov } : collectSources(ov);
  const { schema, resolved } = resolveAll(sources);
  const allKeys = new Map<string, ConfigKey>([...CORE_KEYS, ...schema.keys].map((k) => [k.key, k]));
  const info: Record<string, ExplainEntry> = {
    provider: { value: schema.provider_id, source: "n/a", name: "", secret: false },
  };
  for (const [name, res] of resolved) {
    const secret = Boolean(allKeys.get(name)?.secret);
    info[name] = { value: secret ? maskSecret(String(res.value)) : res.value, source: res.layer, name: res.name, secret };
  }
  return info;
}

/** True when the user explicitly configured `http_timeout` (no defaults applied). */
export function httpTimeoutConfigured(sources: Sources = collectSources()): boolean {
  const key = getKey("http_timeout");
  return key !== undefined && resolveKey(key, sources, { useDefault: false }) !== null;
}

// ---------------------------------------------------------------------------
// Audit and migration
// ---------------------------------------------------------------------------

export interface AuditFinding {
  where: "env" | "dotenv" | "config";
  name: string;
  canonical_key: string;
  canonical_name: string;
  kind: string;
  path?: string;
}

function legacyEnvIndex(): Map<string, { key: ConfigKey; kind: string }> {
  const idx = new Map<string, { key: ConfigKey; kind: string }>();
  for (const key of [...CORE_KEYS, ...bundledKeys]) {
    for (const a of key.aliases) if (a.surface === "env" && a.kind === "legacy") idx.set(a.name, { key, kind: a.kind });
  }
  return idx;
}

function tomlLegacyIndex(): Map<string, ConfigKey> {
  const idx = new Map<string, ConfigKey>();
  for (const key of [...CORE_KEYS, ...bundledKeys]) {
    for (const a of key.aliases) {
      if ((a.surface === "config" || a.surface === "kwarg") && a.kind === "legacy" && !idx.has(a.name)) idx.set(a.name, key);
    }
  }
  return idx;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sortedKeys(o: object): string[] {
  return Object.keys(o).sort();
}

/** Every *legacy* name in use (names only, never values). `compat` (E2B_*) and `native` names are never reported. */
export function auditData(
  environ: Readonly<Record<string, string>>,
  dotenv: ReadonlyArray<readonly [string, Readonly<Record<string, string>>]>,
  toml: Readonly<Record<string, unknown>>,
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const envIdx = legacyEnvIndex();
  const entry = (where: "env" | "dotenv", name: string, file = ""): void => {
    const { key, kind } = envIdx.get(name) as { key: ConfigKey; kind: string };
    const item: AuditFinding = { where, name, canonical_key: key.key, canonical_name: key.env, kind };
    if (file) item.path = file;
    findings.push(item);
  };
  for (const name of sortedKeys(environ)) if (envIdx.has(name) && pyStrip(environ[name] as string)) entry("env", name);
  for (const [file, values] of dotenv) {
    for (const name of sortedKeys(values)) if (envIdx.has(name) && pyStrip(values[name] as string)) entry("dotenv", name, file);
  }
  const tomlIdx = tomlLegacyIndex();
  const transport = toml["transport"];
  if (isRecord(transport)) {
    for (const name of sortedKeys(transport)) {
      const key = tomlIdx.get(name);
      if (key !== undefined && name !== key.key) {
        findings.push({
          where: "config",
          name: `transport.${name}`,
          canonical_key: key.key,
          canonical_name: `transport.${key.key}`,
          kind: "legacy",
        });
      }
    }
  }
  return findings;
}

/** Legacy names currently in use in the live sources. */
export function auditConfig(): AuditFinding[] {
  const dotenv = paths.envFiles.filter(isFile).map((c) => [c, readDotenv(c)] as const);
  const environ: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) environ[k] = v;
  return auditData(environ, dotenv, loadTomlFile(paths.configFile));
}

export interface MigrationItem {
  file: "toml" | "env";
  action: "rename" | "drop" | "set";
  from: string | null;
  to: string;
  value?: unknown;
}

/** Pure migration plan from stored legacy names to canonical ones (`config_format = 2`); deterministic. */
export function planMigrationData(toml: Readonly<Record<string, unknown>>, env: Readonly<Record<string, string>>): MigrationItem[] {
  const plan: MigrationItem[] = [];
  const transport = toml["transport"];
  const plannedTargets = new Set<string>();
  if (isRecord(transport)) {
    for (const key of CORE_KEYS) {
      if (key.toml_section !== "transport" && key.key !== "sandbox_api_key") continue;
      const target = `transport.${key.key}`;
      const names = [...new Set([...aliasList(key, "config"), ...aliasList(key, "kwarg")])];
      for (const name of names) {
        if (name === key.key || !(name in transport)) continue;
        const dup = key.key in transport || plannedTargets.has(target);
        plannedTargets.add(target);
        plan.push({ file: "toml", action: dup ? "drop" : "rename", from: `transport.${name}`, to: target });
      }
    }
    const providers = toml["providers"];
    for (const metadata of bundledConfigs) {
    const provTable = isRecord(providers) ? providers[metadata.id] : undefined;
    for (const key of metadata.keys) {
      const p2 = key.storage_phase2;
      if (key.key in transport && p2 !== null && p2.file === "toml") {
        const exists = isRecord(provTable) && key.key in provTable;
        plan.push({
          file: "toml",
          action: exists ? "drop" : "rename",
          from: `transport.${key.key}`,
          to: `providers.${metadata.id}.${key.key}`,
        });
      }
    }
    }
  }
  for (const key of [...CORE_KEYS, ...bundledKeys]) {
    const p2 = key.storage_phase2;
    const targetEnv = p2 && p2.file === "env" ? p2.name : key.env;
    const movable = new Set(key.aliases.filter((a) => a.surface === "env" && a.kind === "legacy").map((a) => a.name));
    if (key.storage_phase1 !== null && key.storage_phase1.file === "env") movable.add(key.storage_phase1.name);
    const present = (n: string): boolean => pyStrip(env[n] ?? "") !== "";
    const ordered = envNames(key).filter((n) => movable.has(n) && n !== targetEnv && present(n));
    const targetPresent = present(targetEnv);
    ordered.forEach((name, i) => {
      plan.push({ file: "env", action: i === 0 && !targetPresent ? "rename" : "drop", from: name, to: targetEnv });
    });
  }
  plan.push({ file: "toml", action: "set", from: null, to: "core.config_format", value: 2 });
  return plan;
}

function aliasList(key: ConfigKey, surface: "config" | "kwarg"): string[] {
  return key.aliases.filter((a) => a.surface === surface).map((a) => a.name);
}

export function planMigration(configPath?: string, envPath?: string): MigrationItem[] {
  const cfg = configPath ?? paths.configFile;
  const envFile = envPath ?? path.join(path.dirname(cfg), ".env");
  const env = isFile(envFile) ? readDotenv(envFile) : {};
  return planMigrationData(loadTomlFile(cfg), env);
}

function secureWrite(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC, 0o600);
  try {
    fs.writeSync(fd, text);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* best effort (non-POSIX filesystems) */
  }
}

function popPath(doc: Record<string, unknown>, dotted: string): unknown {
  const parts = dotted.split(".");
  let node: unknown = doc;
  for (const p of parts.slice(0, -1)) {
    node = isRecord(node) ? node[p] : undefined;
    if (!isRecord(node)) return null;
  }
  const last = parts[parts.length - 1] as string;
  const rec = node as Record<string, unknown>;
  const value = rec[last];
  delete rec[last];
  return value ?? null;
}

function setPath(doc: Record<string, unknown>, dotted: string, value: unknown): void {
  const parts = dotted.split(".");
  let node = doc;
  for (const p of parts.slice(0, -1)) {
    let next = node[p];
    if (!isRecord(next)) {
      next = {};
      node[p] = next;
    }
    node = next as Record<string, unknown>;
  }
  node[parts[parts.length - 1] as string] = value;
}

/** Execute `planMigration`; keeps `config.toml.bak` / `.env.bak` (0600) unless `backup` is false. */
export function applyMigration(configPath?: string, envPath?: string, opts: { backup?: boolean } = {}): MigrationItem[] {
  const backup = opts.backup ?? true;
  const cfg = configPath ?? paths.configFile;
  const envFile = envPath ?? path.join(path.dirname(cfg), ".env");
  const plan = planMigration(cfg, envFile);
  const toml = loadTomlFile(cfg);
  let envLines = isFile(envFile) ? fs.readFileSync(envFile, "utf-8").split(/\r?\n/) : [];
  if (envLines.length > 0 && envLines[envLines.length - 1] === "") envLines.pop();

  if (backup) {
    if (isFile(cfg)) secureWrite(`${cfg}.bak`, fs.readFileSync(cfg, "utf-8"));
    if (isFile(envFile)) secureWrite(`${envFile}.bak`, fs.readFileSync(envFile, "utf-8"));
  }

  for (const item of plan) {
    if (item.file !== "toml") continue;
    if (item.action === "set") {
      setPath(toml, item.to, item.value);
    } else {
      const value = popPath(toml, item.from as string);
      if (item.action === "rename" && value !== null) setPath(toml, item.to, value);
    }
  }
  const movedFromTransport = plan.some((i) => i.file === "toml" && String(i.from ?? "").startsWith("transport."));
  const tr = toml["transport"];
  if (movedFromTransport && isRecord(tr) && Object.keys(tr).length === 0) delete toml["transport"];

  const envPlan = new Map(plan.filter((i) => i.file === "env").map((i) => [i.from as string, i]));
  if (envPlan.size > 0) {
    const next: string[] = [];
    for (const line of envLines) {
      const stripped = line.trim();
      const body = stripped.startsWith("export ") ? stripped.slice("export ".length) : stripped;
      const name = body.includes("=") && !stripped.startsWith("#") ? (body.split("=", 1)[0] as string).trim() : "";
      const item = envPlan.get(name);
      if (item === undefined) next.push(line);
      else if (item.action === "rename") next.push(line.replace(name, item.to));
    }
    envLines = next;
    secureWrite(envFile, envLines.length > 0 ? `${envLines.join("\n")}\n` : "");
  }
  secureWrite(cfg, dumpsToml(toml));
  return plan;
}
