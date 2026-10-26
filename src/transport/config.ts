import { defaultConfig, defaultRegion } from "../utils/bundled_config.js";
import { getOperationConfig } from "../utils/operation_config.js";
/**
 * Layered configuration loading.
 *
 * Priority: code params > process environment (one variable per key)
 * > .env files > ~/.abx/config.toml > defaults. A blank or whitespace-only
 * value does not count and does not hide the next layer.
 *
 * `.env` files are merged per key. `./.env` overrides `~/.abx/.env` when
 * both set the same key; a key missing from the project file still comes from
 * the system file.
 *
 * Python module-level patchables (`_CONFIG_FILE`, `_ENV_FILE_CANDIDATES`, `_PROJECT_ENV_FILE`, `_ABX_DIR`) are
 * exported as live bindings and have `_set*` seams for tests.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { defineModel, lax } from "../models/base.js";
import { PyFloat, pyFloatParse, pyStr, pyStrip } from "../utils/_pyformat.js";
import { toOSError } from "../utils/_pyos.js";
import { loadBytes } from "../utils/_tomllib.js";
import { dotenvValues } from "../utils/_dotenv.js";
import { ValueError } from "../models/value_error.js";
import { getLogger } from "../utils/logging.js";
import { resolveConfiguration } from "../utils/config_resolver.js";

const logger = getLogger("transport.config");

/** One "Failed to load" line per path and mtime. `config list` and startup re-read the same file. */
const _tomlLoadWarned = new Set<string>();

function warnTomlLoadFailure(p: string, message: string): void {
  let token = p;
  try {
    const st = fs.statSync(p, { bigint: true });
    token = `${p}\0${String(st.mtimeNs)}\0${String(st.size)}`;
  } catch {
    token = `${p}\0${message}`;
  }
  if (_tomlLoadWarned.has(token)) return;
  _tomlLoadWarned.add(token);
  logger.warning("Failed to load %s: %s", p, message);
}

// envd 数据平面固定端口（已实测验证）

export let _ABX_DIR: string = path.join(os.homedir(), ".abx"); // SDK extension
export let _CONFIG_FILE: string = path.join(_ABX_DIR, "config.toml"); // SDK extension
// Earlier entries win per key. A missing key falls through to the next file.
export let _ENV_FILE_CANDIDATES: string[] = [".env", path.join(_ABX_DIR, ".env")];
// Project dotenv only. The CLI reads this between the process environment and ~/.abx.
// Tests point it at a missing file so a repo .env cannot leak.
export let _PROJECT_ENV_FILE: string = ".env";

export function _setAbxDir(p: string): void {
  _ABX_DIR = p;
}
export function _setConfigFile(p: string): void {
  _CONFIG_FILE = p;
}
export function _setEnvFileCandidates(p: string[]): void {
  _ENV_FILE_CANDIDATES = p;
}
export function _setProjectEnvFile(p: string): void {
  _PROJECT_ENV_FILE = p;
}

// Module-level cache
let _cached_config: TransportConfig | null = null;

/**
 * Transport-layer configuration.
 *
 * Loaded lazily from multiple sources with priority:
 * code params > env vars (one name per key) > .env files > config.toml > defaults
 */
export class TransportConfig extends defineModel(
  z.object({
    // API endpoints
    api_url: z.string().default(defaultConfig.endpointDefaults.sandbox_base_url),
    domain: z.string().default(defaultConfig.endpointDefaults.sandbox_domain),
    region: z.string().default(defaultRegion()),

    // Authentication
    api_key: z.string().nullable().default(null),
    access_key_id: z.string().nullable().default(null),
    access_key_secret: z.string().nullable().default(null),

    // HTTP settings
    http_timeout: lax.float(1.0).default(30.0),
    max_connections: lax.int(1).default(100),
    max_keepalive_connections: lax.int(1).default(20),
    keepalive_expiry: lax.float(1.0).default(30.0),
    http2: lax.bool().default(true),

    // WebSocket settings
    ws_ping_interval: lax.float(1.0).default(30.0),

    // Retry settings
  }),
) {
  /**
   * 构建 envd 数据平面 URL（已实测验证）。
   *
   * 格式: https://{ENVD_PORT}-{sandbox_id}.{domain}
   */
}

// One environment variable per field. The third flag is unused and stays true so
// callers that still unpack the triple keep working. Vendor-official names are
// not wrapped in ABX_.
export const _ENV_VAR_MAP: [string, string, boolean][] = [...defaultConfig.transportEnvironment];

// Fields that need numeric conversion
export const _NUMERIC_FIELDS: Set<string> = new Set(["http_timeout"]);

/**
 * Convert a raw string value to the appropriate type for `field_name`.
 *
 * A blank or whitespace-only value is unset, so it does not hide the next configuration layer.
 */
export function _coerceValue(field_name: string, raw: string): unknown {
  const text = pyStrip(raw);
  if (!text) return null;
  if (_NUMERIC_FIELDS.has(field_name)) {
    const n = pyFloatParse(text);
    if (n === null) {
      logger.warning("Invalid numeric value for %s: %s", field_name, text);
      return null;
    }
    return n;
  }
  return text;
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function pyTypeName(v: unknown): string {
  if (v === null) return "NoneType";
  if (Array.isArray(v)) return "list";
  if (typeof v === "string") return "str";
  if (typeof v === "boolean") return "bool";
  if (v instanceof PyFloat) return "float";
  if (typeof v === "number" || typeof v === "bigint") return Number.isInteger(v) ? "int" : "float";
  const tp = (v as { __pytype__?: string }).__pytype__;
  if (tp) return tp;
  return "dict";
}

function _tableToObject(v: unknown): unknown {
  if (v instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, item] of v) Object.defineProperty(out, k, { value: _tableToObject(item), enumerable: true, writable: true, configurable: true });
    return out;
  }
  if (Array.isArray(v)) return v.map(_tableToObject);
  return v;
}

interface CachedBytes {
  mtimeNs: bigint;
  size: number;
  bytes: Buffer;
}

const _byteCache = new Map<string, CachedBytes>();

/** Drop cached file bytes. `resetConfig` and `resetLayeredConfig` both call this. */
export function clearCachedConfigBytes(): void {
  _byteCache.clear();
}

/**
 * Read `p` once per mtime. The transport and provider loaders share the buffer so a command that resolves a
 * provider and then calls `loadConfig` hits the disk once. Only `_loadTomlFile` logs `Loaded config`.
 */
export function readCachedConfigBytes(p: string): Buffer | null {
  let st: fs.BigIntStats;
  try {
    st = fs.statSync(p, { bigint: true });
  } catch {
    _byteCache.delete(p);
    return null;
  }
  if (!st.isFile()) {
    _byteCache.delete(p);
    return null;
  }
  const size = Number(st.size);
  const hit = _byteCache.get(p);
  if (hit && hit.mtimeNs === st.mtimeNs && hit.size === size) return Buffer.from(hit.bytes);
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(p);
  } catch (e) {
    throw toOSError(e, p);
  }
  _byteCache.set(p, { mtimeNs: st.mtimeNs, size, bytes });
  return Buffer.from(bytes);
}

/** Load a TOML file, returning empty dict on failure. */
export function _loadTomlFile(p: string): Record<string, any> {
  if (!isFile(p)) return {};
  try {
    const buf = readCachedConfigBytes(p);
    if (buf === null) return {};
    const data = _tableToObject(loadBytes(buf)) as Record<string, any>;
    logger.debug("Loaded config from %s", p);
    return { ...data };
  } catch (exc) {
    warnTomlLoadFailure(p, pyStr(exc instanceof Error ? exc.message : exc));
    return {};
  }
}

/**
 * Merge every existing `.env` candidate into one env-like dict.
 *
 * Candidates are listed highest priority first. A key set in an earlier file wins; a key that file does not set
 * still comes from a later file. Empty values are ignored so they do not hide a real key.
 */
export function _loadDotenvFile(): Record<string, string> {
  const merged: Record<string, string> = Object.create(null);
  for (const candidate of [..._ENV_FILE_CANDIDATES].reverse()) {
    if (!isFile(candidate)) continue;
    const values = dotenvValues(candidate);
    logger.debug("Loaded .env from %s", candidate);
    for (const [key, value] of values) {
      if (value && pyStrip(value)) {
        merged[key] = pyStrip(value);
      }
    }
  }
  return merged;
}

/**
 * Return the first non-empty `names` entry in the project `.env`.
 *
 * This is the layer between the process environment and `~/.abx`. It does not read `~/.abx/.env`; callers add that
 * fallback themselves.
 */
export function projectDotenvValue(names: readonly string[]): string | null {
  if (!isFile(_PROJECT_ENV_FILE)) return null;
  let values: Map<string, string | null>;
  try {
    values = dotenvValues(_PROJECT_ENV_FILE);
  } catch (e) {
    if (e instanceof ValueError || typeof (e as NodeJS.ErrnoException)?.code === "string") return null;
    throw e;
  }
  for (const name of names) {
    const value = values.get(name);
    if (value && pyStrip(value)) {
      return pyStrip(value);
    }
  }
  return null;
}

/**
 * Read recognised environment variables. Each field has one variable.
 */
export function _readEnvVars(): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const set_fields = new Set<string>(); // track fields already set (first-wins)

  for (const [env_var, field_name, is_e2b] of _ENV_VAR_MAP) {
    if (!is_e2b && set_fields.has(field_name)) continue; // already provided by higher-priority var
    const value = process.env[env_var];
    if (value !== undefined) {
      const coerced = _coerceValue(field_name, value);
      if (coerced !== null) {
        result[field_name] = coerced;
        set_fields.add(field_name);
      }
    }
  }
  return result;
}

/**
 * Convert env-style key-values (from .env file) to TransportConfig field names.
 *
 * Each field has one variable.
 */
export function _envDictToFields(env_vals: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const set_fields = new Set<string>();

  for (const [env_var, field_name, is_e2b] of _ENV_VAR_MAP) {
    if (!Object.prototype.hasOwnProperty.call(env_vals, env_var)) continue;
    if (!is_e2b && set_fields.has(field_name)) continue;
    const coerced = _coerceValue(field_name, env_vals[env_var] as string);
    if (coerced !== null) {
      result[field_name] = coerced;
      set_fields.add(field_name);
    }
  }
  return result;
}

/**
 * Load transport configuration with layered priority.
 *
 * Priority (highest to lowest):
 * 1. Code-level `overrides`
 * 2. Environment variables (one name per key)
 * 3. .env files, merged per key (`./.env` overrides `~/.abx/.env`)
 * 4. ~/.abx/config.toml (optional SDK extension)
 * 5. TransportConfig defaults
 *
 * A blank or whitespace-only override or environment value is ignored.
 */
export function loadConfig(overridesIn: Record<string, unknown> = {}): TransportConfig {
  const operation = getOperationConfig();
  const canonical: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(operation ?? {})) {
    const transportKey = ({ sandbox_api_key: "api_key", sandbox_base_url: "api_url", sandbox_domain: "domain" } as Record<string, string>)[key] ?? key;
    if (value !== null && value !== undefined && value !== "") canonical[transportKey] = value;
  }
  const overrides: Record<string, unknown> = { ...canonical, ...overridesIn };
  const hasOverrides = Object.keys(overrides).length > 0;
  if (_cached_config !== null && !hasOverrides) {
    return _cached_config;
  }

  // TransportConfig is the compatibility projection of the common resolver.
  // Keep this loader's injectable paths and public transport option names.
  const names: Record<string, string> = { api_key: "sandbox_api_key", api_url: "sandbox_base_url", domain: "sandbox_domain" };
  const sourceOverrides: Record<string, unknown> = { provider: defaultConfig.id };
  const explicit: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(overrides)) {
    if (raw === null || raw === undefined || typeof raw === "string" && !pyStrip(raw)) continue;
    const value = typeof raw === "string" ? pyStrip(raw) : raw;
    sourceOverrides[names[key] ?? key] = value;
    explicit[key] = value;
  }
  const environ: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) environ[key] = value;
  const resolved = resolveConfiguration({
    overrides: sourceOverrides, environ, dotenv: [_loadDotenvFile()], toml: _loadTomlFile(_CONFIG_FILE),
  }, { provider_id: defaultConfig.id, keys: defaultConfig.keys, inherit: defaultConfig.inherit,
    derive: defaultConfig.derive, endpoint_defaults: defaultConfig.endpointDefaults });
  const merged: Record<string, unknown> = {};
  for (const key of ["sandbox_api_key", "sandbox_base_url", "sandbox_domain", "region", "access_key_id", "access_key_secret", "http_timeout", "http2", "max_connections", "max_keepalive_connections", "keepalive_expiry", "ws_ping_interval"]) {
    const value = resolved.get(key)?.value;
    if (value !== undefined && value !== null) {
      const field = Object.entries(names).find(([, canonical]) => canonical === key)?.[0] ?? key;
      merged[field] = value;
    }
  }
  // Explicit transport options retain model validation rather than falling back on invalid input.
  Object.assign(merged, explicit);

  const config = new TransportConfig(merged);

  if (!hasOverrides) {
    _cached_config = config;
  }
  return config;
}

/** Clear the cached configuration (useful for testing). */
export function resetConfig(): void {
  _cached_config = null;
  clearCachedConfigBytes();
}

/**
 * Return True when the user explicitly configured `http_timeout`.
 *
 * Checks the same sources as `loadConfig` (env vars, .env file, `~/.abx/config.toml`) without applying defaults.
 * The CLI uses this to decide whether a slow operation (e.g. sandbox create) should get a longer built-in HTTP
 * timeout instead of the 30s default.
 */
export function httpTimeoutConfigured(): boolean {
  const timeout = process.env["ABX_HTTP_TIMEOUT"];
  if (timeout && pyStrip(timeout)) return true;
  // .env files use env-var-style keys (see _ENV_VAR_MAP), not field names.
  if ("ABX_HTTP_TIMEOUT" in _loadDotenvFile()) return true;
  const toml_data = _loadTomlFile(_CONFIG_FILE);
  const section = "transport" in toml_data ? toml_data["transport"] : toml_data;
  if (typeof section === "string") return section.includes("http_timeout");
  if (Array.isArray(section)) return section.includes("http_timeout");
  if (section !== null && typeof section === "object" && !(section instanceof PyFloat) && !(section as { __pytype__?: string }).__pytype__) {
    return Object.prototype.hasOwnProperty.call(section, "http_timeout");
  }
  throw new TypeError(`argument of type '${pyTypeName(section) === "date" || pyTypeName(section) === "datetime" || pyTypeName(section) === "time" ? `datetime.${pyTypeName(section)}` : pyTypeName(section)}' is not iterable`);
}

// snake_case aliases mirroring the Python public names
export {
  loadConfig as load_config,
  resetConfig as reset_config,
  httpTimeoutConfigured as http_timeout_configured,
  projectDotenvValue as project_dotenv_value,
  _coerceValue as _coerce_value,
  _loadTomlFile as _load_toml_file,
  _loadDotenvFile as _load_dotenv_file,
  _readEnvVars as _read_env_vars,
  _envDictToFields as _env_dict_to_fields,
};
