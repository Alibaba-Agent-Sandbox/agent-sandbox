import { bundledConfig, bundledConfigs, bundledKeys, defaultConfig } from "../utils/bundled_config.js";
import { getOperationConfig } from "../utils/operation_config.js";
/**
 * Layered configuration with provider selection (port of the layered half of
 * `agent_sandbox/transport/config.py`; design: `docs/en/design/providers-and-credentials.md`).
 *
 * Resolution is layer-first: explicit overrides > process environment > `./.env` > `~/.abx/.env` >
 * `~/.abx/config.toml` > defaults. `toTransportConfig()` constructs the HTTP transport settings
 * from the selected provider's resolved configuration.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ProviderConfigError } from "../models/provider_errors.js";
import {
  BUILTIN_PROVIDER_ID,
  CORE_KEYS,
  envNames,
  getKey,
  type ConfigKey,
} from "../utils/config_keys.js";
import { resolveKey, resolveConfiguration, type Resolved, type Sources } from "../utils/config_resolver.js";
import { dotenvValues } from "../utils/_dotenv.js";
import { PyFloat, pyStrip } from "../utils/_pyformat.js";
import { parseTomlBytes } from "../utils/toml_plain.js";
import { dumpsToml } from "../utils/toml_write.js";
import { TransportConfig, clearCachedConfigBytes, readCachedConfigBytes } from "./config.js";

export const ENVD_PORT = 49983;
export const DEFAULT_BASE_URL = defaultConfig.endpointDefaults.sandbox_base_url;
export const DEFAULT_DOMAIN = defaultConfig.endpointDefaults.sandbox_domain;


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

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && !pyStrip(v));
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

  constructor(init: LayeredConfigInit = {}) {
    const data = { ...init } as LayeredConfigInit;
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
    this.validate();
  }

  private validate(): void {
    const bounds: Array<[string, number, number]> = [
      ["http_timeout", this.http_timeout, 1],
      ["max_connections", this.max_connections, 1],
      ["max_keepalive_connections", this.max_keepalive_connections, 1],
      ["keepalive_expiry", this.keepalive_expiry, 1],
      ["ws_ping_interval", this.ws_ping_interval, 1],
    ];
    for (const [name, value, min] of bounds) {
      if (!(value >= min)) throw new ProviderConfigError(`Invalid ${name}: ${String(value)} (must be >= ${min}).`);
    }
  }


  /** Construct the selected provider HTTP transport settings. */
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
    public readonly transport_fields: ReadonlySet<string> = bundledConfig(provider_id)?.transportFields ?? new Set(),
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
    metadata.endpointDefaults, metadata.transportFields, metadata.omitDefaultOptions);
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
  return rest;
}

/** Resolve provider settings through the common pure source resolver. */
export function resolveAll(sources: Sources, schemaIn?: ProviderSchema): { schema: ProviderSchema; resolved: Map<string, Resolved> } {
  const schema = schemaIn ?? providerSchema(selectProviderId(sources));
  return { schema, resolved: resolveConfiguration(sources, schema) };
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
]);

export interface LoadOptions {
  /** Pre-collected sources (tests); defaults to the live process/files. */
  sources?: Sources;
}

/**
 * Load the configuration of the selected provider. `overrides.provider` selects the provider,
 * `overrides.provider_options` passes provider-scoped values; canonical key names are accepted.
 */
export function loadLayeredConfig(overrides: Record<string, unknown> = {}, opts: LoadOptions = {}): LayeredConfig {
  const operation = getOperationConfig();
  if (operation && !opts.sources && (!overrides["provider"] || overrides["provider"] === operation["provider"])) {
    overrides = { ...operation, ...overrides, provider_options: {
      ...((operation["provider_options"] as Record<string, unknown> | undefined) ?? {}),
      ...((overrides["provider_options"] as Record<string, unknown> | undefined) ?? {}),
    } };
  }
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
  const coreNames = new Set(CORE_KEYS.map((k) => k.key));
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

  const fieldScoped = schema.transport_fields;
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
