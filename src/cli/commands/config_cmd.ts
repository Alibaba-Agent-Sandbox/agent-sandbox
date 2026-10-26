import { ProviderConfigError } from "../../models/provider_errors.js";
import { providerCliExtension, bundledCliConfigurations, isProviderConfigSensitive } from "../provider_extensions.js";
import type { ConfigPrompt } from "../provider_config_contract.js";
import { providerSchema, paths } from "../../transport/config_layers.js";
/**
 * Configuration management CLI commands: init, get, set, list, delete (port of `cli/commands/config_cmd.py`).
 *
 * Credentials live in `~/.abx/.env` (owner-only), everything else in `~/.abx/config.toml` (`[transport]` and
 * other sections). The TOML file is read with a port of CPython's `tomllib` (`../../utils/_tomllib.ts`) and written by the same
 * hand-rolled serialiser as the Python CLI, so files and error texts are interchangeable between the two CLIs.
 *
 * Seams: Python tests monkeypatch module attributes of `config_cmd` (`_CONFIG_FILE`, `_ABX_DIR`, `_ENV_FILE`, `sys`,
 * `_prompt_secret`, `load_config_dict`, `read_env_var`, `write_env_var`, ...). ESM bindings are read-only, so those
 * attributes live on the mutable {@link configSeams} object and every internal call (and every exported wrapper of the
 * seamed functions) reads them at call time.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as tty from "node:tty";
import { StringDecoder } from "node:string_decoder";

import { argument, command, group, option, type Context } from "../kit.js";
import { Abort, EOFError, KeyboardInterrupt, sysExit } from "../errors.js";
import { echo, sys } from "../io.js";
import { prompt, select } from "../prompts.js";
import { cpSlice, len, ljust } from "../../utils/_py.js";
import { TransportConfig, projectDotenvValue } from "../../transport/config.js";
import { _DEFAULT_OPENAI_BASE_URL, _DEFAULT_OPENAI_MODEL } from "../../agent/qwen_code.js";
import { PyFloat, pyFloatParse, pyFloatRepr, pyStr, pyStrRepr, pyStrip, pySorted } from "../../utils/_pyformat.js";
import { isFile, toOSError } from "../../utils/_pyos.js";
import { type OutputFormatter, getFormatter } from "../formatters.js";
import { decodeUtf8Strict, loadBytes, type Table } from "../../utils/_tomllib.js";
import { providersInUse } from "../../providers/in_use.js";
import { _setPaths } from "../../transport/config_layers.js";
import * as extras from "./_config_providers.js";
import * as registry from "../../providers/registry.js";
import { setEnvValue, setTomlValue, resetConfigurationCaches, writeConfigurationFile } from "../../providers/settings.js";
import { dotenvValues, parseStream } from "../../utils/_dotenv.js";
import { assertConfigFilesReadable, assertConfigValuesValid } from "../../utils/config_diagnostics.js";
import { CORE_KEYS, GENERIC_ENDPOINT_KEYS } from "../../utils/config_keys.js";
import { CLI_CORE_KEYS } from "../../utils/cli_config_keys.js";
import { randomBytes } from "node:crypto";
import { configurationFieldHelp } from "../configuration_help.js";
import { collectSources } from "../../transport/config_layers.js";
import { getOperationConfig } from "../../utils/operation_config.js";
import { canPrompt } from "../interaction.js";
import { configurationTargetSummary } from "../config_target.js";
import { getCurrentContext } from "../kit.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Params = Record<string, any>;

/**
 * `main.handleErrors`, resolved when a command runs. `main` is imported lazily so loading this module never loads
 * `main`.
 */
function _handleErrors<A extends unknown[], R>(func: (...args: A) => R | Promise<R>): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    const { handleErrors } = await import("../error_handler.js");
    return handleErrors(func)(...args);
  };
}

/** Python `os.environ.get(name)`. */
const _env = (name: string): string | undefined => process.env[name];

// ---------------------------------------------------------------------------------------------------------------------
// Storage locations & seams
// ---------------------------------------------------------------------------------------------------------------------

const _defaultAbxDir = path.join(os.homedir(), ".abx");

/** The slice of Python's `sys` module this file uses (`sys.stdin`, `sys.stdout`). */
export interface ConfigSys {
  stdin: { isatty(): boolean; fileno?(): number };
  stdout?: { write(text: string): void; flush(): void; isatty(): boolean };
  stderr?: { isatty(): boolean };
}

/**
 * Patch points (Python: module attributes of `config_cmd`). `sys: null` means "the process streams in `io.ts`" (the streams
 * `CliRunner` swaps); tests set `{ stdin: { isatty: () => true } }` to fake a terminal like Python's `_FakeSys`.
 */
export const configSeams: {
  _ABX_DIR: string;
  _CONFIG_FILE: string;
  _ENV_FILE: string;
  sys: ConfigSys | null;
  loadConfigDict: () => Record<string, unknown>;
  readEnvVar: (envVar: string) => string | null;
  writeEnvVar: (envVar: string, value: string) => void;
  _promptSecret: (promptText: string) => Promise<string>;
} = {
  _ABX_DIR: _defaultAbxDir,
  _CONFIG_FILE: path.join(_defaultAbxDir, "config.toml"),
  _ENV_FILE: path.join(_defaultAbxDir, ".env"),
  sys: null,
  loadConfigDict: (): Record<string, unknown> => _loadConfigDictImpl(),
  readEnvVar: (envVar) => _readEnvVarImpl(envVar),
  writeEnvVar: (envVar, value) => _writeEnvVarImpl(envVar, value),
  _promptSecret: (promptText) => _promptSecretImpl(promptText),
};

function _stdin(): ConfigSys["stdin"] {
  return (configSeams.sys ?? sys).stdin;
}

function _stdout(): { write(text: string): void; flush(): void } {
  return sys.stderr;
}

/** Keys that users can configure (key -> help). */
export const _ALLOWED_KEYS: ReadonlyMap<string, string> = new Map([
  ...CLI_CORE_KEYS.map((key) => [key.key, key.description] as const),
  ["sandbox_api_key", "Sandbox service API key (env: ABX_SANDBOX_API_KEY)"],
  ["sandbox_base_url", "Platform API URL of the selected provider"],
  ["http_timeout", "HTTP request timeout in seconds"],
  ["http2", "Enable HTTP/2 for platform connections (true/false)"],
  ["sandbox_domain", "Envd domain"],
  ["llm_api_key", "LLM API key for template generation (stored in ~/.abx/.env)"],
  ["llm_model", "LLM model name (default: qwen3-coder-plus)"],
  ["llm_base_url", "LLM API base URL, OpenAI-compatible (default: DashScope compatible-mode)"],
  ["github_token", "GitHub token for template downloads / rate limits (stored in ~/.abx/.env)"],
  ...bundledCliConfigurations().flatMap((profile) => [...profile.allowed]),
]);

/** Keys stored in `~/.abx/.env` (mapped to their env-var name) rather than `config.toml`. */
export const _ENV_STORED_KEYS: ReadonlyMap<string, string> = new Map([
  ...CLI_CORE_KEYS.filter((key) => key.storage?.file === "env").map((key) => [key.key, key.env] as const),
  ["sandbox_api_key", "ABX_SANDBOX_API_KEY"],
  ["llm_api_key", "ABX_LLM_API_KEY"],
  ["github_token", "GITHUB_TOKEN"],
  ...bundledCliConfigurations().flatMap((profile) => [...profile.envStored]),
]);

/** Keys the long-standing code handles itself for every provider (everything but the built-in provider's own keys). */
const _GENERIC_KEYS: ReadonlySet<string> = new Set([
  ...CLI_CORE_KEYS.map((key) => key.key),
  "sandbox_api_key", "sandbox_base_url", "sandbox_domain", "http_timeout", "http2", "llm_api_key", "llm_model", "llm_base_url", "github_token",
]);

/** Keys removed from the config surface; `config get` / `config set` name the replacement. */
const _REMOVED_KEYS: ReadonlyMap<string, string> = new Map([
  ["qwen_code_api_key", "llm_api_key"],
  ["qwen_code_base_url", "llm_base_url"],
  ["qwen_code_model", "llm_model"],
]);

/** Functional groups for `config list`: stable order, one group per topic. */
const _CONFIG_GROUPS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["Sandbox authentication", ["sandbox_api_key"]],
  ["Application authentication", ["server_token"]],
  ["Connection", ["sandbox_base_url", "region", "sandbox_domain", "http_timeout", "http2"]],
  ["LLM", ["llm_api_key", "llm_model", "llm_base_url"]],
  ["Integrations", ["github_token"]],
];

/** Keys that are sensitive and should be masked in output. */
const _SENSITIVE_KEYS: ReadonlySet<string> = new Set(["sandbox_api_key", "llm_api_key", "github_token", ...CLI_CORE_KEYS.filter((key) => key.secret).map((key) => key.key), ...bundledCliConfigurations().flatMap((profile) => [...profile.sensitive])]);

/** Environment variables that override each key at runtime, in priority order. */
const _ENV_OVERRIDES: ReadonlyMap<string, readonly string[]> = new Map([
  ...CLI_CORE_KEYS.map((key) => [key.key, [key.env]] as const),
  ["sandbox_api_key", ["ABX_SANDBOX_API_KEY"]],
  ["sandbox_base_url", ["ABX_SANDBOX_BASE_URL"]],
  ["sandbox_domain", ["ABX_SANDBOX_DOMAIN"]],
  ["http_timeout", ["ABX_HTTP_TIMEOUT"]],
  ["llm_api_key", ["ABX_LLM_API_KEY", "BAILIAN_CODING_PLAN_API_KEY", "DASHSCOPE_API_KEY", "OPENAI_API_KEY"]],
  ["llm_base_url", ["ABX_LLM_BASE_URL", "OPENAI_BASE_URL"]],
  ["llm_model", ["ABX_LLM_MODEL", "OPENAI_MODEL"]],
  ["github_token", ["GITHUB_TOKEN"]],
  ...bundledCliConfigurations().flatMap((profile) => [...profile.envOverrides]),
]);

/** `agent/qwen_code.ts` constants (duplicated to keep this module, which every CLI start loads, import-light). */

// ---------------------------------------------------------------------------------------------------------------------
// Small Python-compat helpers
// ---------------------------------------------------------------------------------------------------------------------

/** `Path.read_text(encoding="utf-8")`: strict decoding with CPython's error text, universal newlines. */
function _readText(file: string): string {
  let buf: Buffer;
  try {
    buf = fs.readFileSync(file);
  } catch (e) {
    throw toOSError(e, file);
  }
  return decodeUtf8Strict(buf).replace(/\r\n?/g, "\n");
}

function _unlink(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch (e) {
    throw toOSError(e, file);
  }
}

const _isTable = (v: unknown): v is Table => v instanceof Map;

/**
 * `Path.mkdir(parents=True, exist_ok=True)`. Unlike `fs.mkdirSync({recursive})` an error names the directory whose
 * creation failed (the nearest existing-parent problem), exactly as pathlib's recursive implementation does.
 */
function _mkdirParents(dir: string): void {
  try {
    fs.mkdirSync(dir);
    return;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      const parent = path.dirname(dir);
      if (parent === dir) throw toOSError(e, dir);
      _mkdirParents(parent);
      try {
        fs.mkdirSync(dir);
      } catch (e2) {
        if ((e2 as NodeJS.ErrnoException)?.code === "EEXIST" && _isDir(dir)) return;
        throw toOSError(e2, dir);
      }
      return;
    }
    if (code === "EEXIST" && _isDir(dir)) return;
    throw toOSError(e, dir);
  }
}

function _isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

const _UNICODE_DIGIT = /\p{Nd}/u;

/** Map every Unicode decimal digit (`\p{Nd}`) to its ASCII counterpart, as `int()` / `float()` do before parsing. */
function _asciiDigits(text: string): string {
  if (!/[^\x00-\x7f]/.test(text)) return text;
  let out = "";
  for (const ch of text) {
    if (ch.length === 1 && ch < "\x80") {
      out += ch;
    } else if (_UNICODE_DIGIT.test(ch)) {
      // Nd characters come in contiguous runs of ten starting at digit zero.
      const cp = ch.codePointAt(0)!;
      let start = cp;
      while (_UNICODE_DIGIT.test(String.fromCodePoint(start - 1))) start--;
      out += String((cp - start) % 10);
    } else {
      out += ch;
    }
  }
  return out;
}

/** Python `float(text)` for a string; `null` where it raises `ValueError`. */
const _pyFloatParse = (text: string): number | null => pyFloatParse(_asciiDigits(text));

/** Python `int(text)` (decimal digits, optional sign/underscores/whitespace); `null` where it raises `ValueError`. */
function _pyIntParse(text: string): number | bigint | null {
  const t = _asciiDigits(pyStrip(text));
  if (!/^[+-]?[0-9]+(?:_[0-9]+)*$/.test(t)) return null;
  const big = BigInt(t.replace(/_/g, ""));
  return big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big;
}

// ---------------------------------------------------------------------------------------------------------------------
// Full-config read/write
// ---------------------------------------------------------------------------------------------------------------------

/** `[transport]` plus whatever else the file holds; `error` is set when the file exists but cannot be parsed. */
function _loadFullConfigWithError(): [Table, Error | null] {
  if (!isFile(configSeams._CONFIG_FILE)) return [new Map(), null];
  try {
    let buf: Buffer;
    try {
      buf = fs.readFileSync(configSeams._CONFIG_FILE);
    } catch (e) {
      throw toOSError(e, configSeams._CONFIG_FILE);
    }
    return [loadBytes(buf), null];
  } catch (exc) {
    return [new Map(), exc instanceof Error ? exc : new Error(String(exc))];
  }
}

/** Load the whole TOML config file (empty on any error). */
function _loadFullConfig(): Table {
  return _loadFullConfigWithError()[0];
}

/** Serialise `value` as a TOML value (scalars and flat arrays). */
function _tomlValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  if (value instanceof PyFloat) return pyFloatRepr(value.value);
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : pyFloatRepr(value);
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return "[" + value.map(_tomlValue).join(", ") + "]";
  return `"${pyStr(value)}"`;
}

function _writeTable(lines: string[], name: string, table: Table): void {
  lines.push(`[${name}]`);
  for (const [key, value] of table) {
    if (!_isTable(value)) lines.push(`${key} = ${_tomlValue(value)}`);
  }
  for (const [key, sub] of table) {
    if (_isTable(sub)) {
      lines.push("");
      _writeTable(lines, `${name}.${key}`, sub);
    }
  }
}

/** Write the whole config `data` back to the TOML file, section by section. */
function _saveFullConfig(data: Table): void {
  _mkdirParents(configSeams._ABX_DIR);
  const lines: string[] = [];
  for (const [key, value] of data) {
    if (!_isTable(value)) lines.push(`${key} = ${_tomlValue(value)}`);
  }
  for (const [name, table] of data) {
    if (_isTable(table)) {
      if (lines.length) lines.push("");
      _writeTable(lines, name, table);
    }
  }
  const content = lines.length ? lines.join("\n") + "\n" : "";
  writeConfigurationFile(configSeams._CONFIG_FILE, content);
}

/**
 * Original key order of each loaded dict: a plain object lists integer-like keys first, a Python dict keeps insertion
 * order, so the save path restores the file's order (existing keys in place, new keys appended).
 */
const _keyOrder = new WeakMap<object, string[]>();

const _toRecord = (table: Table): Record<string, unknown> => {
  const record = Object.fromEntries(table);
  _keyOrder.set(record, [...table.keys()]);
  return record;
};

/** `load_config_dict()` implementation: the `[transport]` section as a plain object. */
function _loadConfigDictImpl(): Record<string, unknown> {
  const data = _loadFullConfig();
  const transport = data.get("transport");
  if (_isTable(transport)) return _toRecord(transport);
  return {};
}

/** Load the `[transport]` section of the config file as a plain object. */
export function loadConfigDict(): Record<string, unknown> {
  return configSeams.loadConfigDict();
}

/** Save the `[transport]` dict, preserving every other section. */
function _saveConfigDict(data: Record<string, unknown>): void {
  assertConfigFilesReadable(configSeams._CONFIG_FILE, [configSeams._ENV_FILE]);
  let full = _loadFullConfig();
  const rawExisting = full.get("transport");
  const existing = _isTable(rawExisting) ? rawExisting : undefined;
  if (existing || full.size === 0) {
    for (const key of existing?.keys() ?? []) if (!Object.hasOwn(data, key)) setTomlValue("transport", key, null, configSeams._CONFIG_FILE);
    for (const [key, value] of Object.entries(data)) {
      const primitive = value;
      if (primitive instanceof PyFloat || ["string", "number", "boolean"].includes(typeof primitive)) {
        if (existing?.get(key) !== value) setTomlValue("transport", key, primitive as string | number | boolean | PyFloat, configSeams._CONFIG_FILE);
      } else { full.set("transport", new Map(Object.entries(data))); _saveFullConfig(full); return; }
    }
    return;
  }
  const original = _keyOrder.get(data) ?? [];
  const current = Object.keys(data);
  const ordered = [...original.filter((k) => Object.hasOwn(data, k)), ...current.filter((k) => !original.includes(k))];
  full.set("transport", new Map(ordered.map((k) => [k, data[k]] as [string, unknown])));
  _saveFullConfig(full);
}

// ---------------------------------------------------------------------------------------------------------------------
// Credential storage (~/.abx/.env)
// ---------------------------------------------------------------------------------------------------------------------

/** Mask a sensitive value, showing only the first and last 3 characters (<= 8 characters: masked completely). */
export function _maskValue(value: unknown): string {
  const s = pyStr(value);
  if (len(s) <= 8) return s ? "***" : "";
  return cpSlice(s, 0, 3) + "***" + cpSlice(s, len(s) - 3);
}

/** `write_env_var()` implementation (owner-only permissions are enforced after every write). */
function _writeEnvVarImpl(envVar: string, value: string): void {
  assertConfigFilesReadable(configSeams._CONFIG_FILE, [configSeams._ENV_FILE]);
  setEnvValue(envVar, value, configSeams._ENV_FILE);
}

/** Write or update `envVar` in the `~/.abx/.env` file. */
export function writeEnvVar(envVar: string, value: string): void {
  configSeams.writeEnvVar(envVar, value);
}

function _readEnvVarImpl(envVar: string): string | null {
  if (!isFile(configSeams._ENV_FILE)) return null;
  return dotenvValues(configSeams._ENV_FILE).get(envVar) ?? null;
}

/** Read `envVar` from the `~/.abx/.env` file. */
export function readEnvVar(envVar: string): string | null {
  return configSeams.readEnvVar(envVar);
}

/** Remove `envVar` from `~/.abx/.env`; the file is deleted once no entries remain. Returns whether a line was removed. */
export function removeEnvVar(envVar: string): boolean {
  if (!isFile(configSeams._ENV_FILE)) return false;
  assertConfigFilesReadable(configSeams._CONFIG_FILE, [configSeams._ENV_FILE]);
  const original = _readText(configSeams._ENV_FILE);
  if (![...parseStream(original)].some((binding) => binding.key === envVar)) return false;
  setEnvValue(envVar, null, configSeams._ENV_FILE);
  if (!pyStrip(_readText(configSeams._ENV_FILE))) {
    _unlink(configSeams._ENV_FILE);
    resetConfigurationCaches();
  }
  return true;
}

/**
 * Resolve the effective GitHub token for template downloads.
 *
 * Precedence: explicit `--token`; process `GITHUB_TOKEN`; `GITHUB_TOKEN` in the project `.env`; the stored
 * `github_token` (`~/.abx/.env`); none. The token value is never printed, logged, or persisted by this helper.
 */
export function resolveGithubToken(explicit: string | null | undefined = null): string | null {
  if (explicit && pyStrip(explicit)) return pyStrip(explicit);
  const [value, source] = _effectiveValue("github_token");
  if (source === "unset" || !value) return null;
  return pyStrip(pyStr(value));
}

function _canonicalizeKey(key: string): string {
  return key;
}

/** The name echoed in `Set ...` lines: the canonical key as typed. */
function _echoName(typed: string, canonical: string): string {
  return typed;
}

/** `extras` reads `~/.abx` through `config_layers.paths`; follow the seams when tests (or callers) moved them. */
function _syncPaths(): void {
  if (configSeams._CONFIG_FILE !== path.join(_defaultAbxDir, "config.toml") && paths.configFile !== configSeams._CONFIG_FILE) {
    _setPaths({
      abxDir: configSeams._ABX_DIR,
      configFile: configSeams._CONFIG_FILE,
      envFiles: [".env", configSeams._ENV_FILE],
    });
  }
}

/** A provider key the long-standing code does not handle, or `null`. */
function _extraFor(typed: string, canonical: string): extras.ExtraTarget | null {
  _syncPaths();
  if (typed === "provider" || typed.startsWith("providers.")) return extras.resolveExtraKey(typed);
  const active = extras.effectiveProviderId();
  const hasProviderProfile = Boolean(providerCliExtension(active)?.configuration);
  if (!hasProviderProfile && !_GENERIC_KEYS.has(canonical)) {
    const target = extras.resolveExtraKey(typed);
    if (target) return target;
    throw new ProviderConfigError(`Provider '${active}' does not declare '${typed}'.`, {
      suggestion: `Run 'abx provider info ${active}' to see its configuration fields.`,
    });
  }
  if (_ALLOWED_KEYS.has(canonical)) {
    return extras.coreTarget(canonical, _echoName(typed, canonical));
  }
  return extras.resolveExtraKey(typed);
}

/** `true` once the provider system is in play or the user migrated to the canonical names. */
function _surfaceActive(): boolean {
  _syncPaths();
  return true;
}

function _extraText(target: extras.ExtraTarget | undefined, value: unknown): string {
  if (target?.key?.type === "float" && typeof value === "number") return pyStr(new PyFloat(value));
  return pyStr(value);
}

function _extraDisplay(target: extras.ExtraTarget, value: unknown): string {
  const text = _extraText(target, value);
  return isProviderConfigSensitive(target.provider_id, target.key?.key ?? "", target.key?.secret) ? _maskValue(text) : text;
}

function _extraPrompt(fmt: OutputFormatter, target: extras.ExtraTarget): Promise<string | null> {
  return _promptMissingValue(fmt, target.typed, isProviderConfigSensitive(target.provider_id, target.key?.key ?? "", target.key?.secret));
}

/** Exit 2 for a key that is not configurable (removed Qwen Code keys name their `llm_*` replacement). */
function _rejectUnknownKey(fmt: OutputFormatter, key: string): never {
  const replacement = _REMOVED_KEYS.get(key);
  if (replacement !== undefined) {
    fmt.printError(`Config key ${pyStrRepr(key)} was removed.`, {
      suggestion:
        `Use ${pyStrRepr(replacement)}. Template generation uses one ` +
        "LLM profile: llm_api_key, llm_base_url, llm_model.",
    });
    return sysExit(2);
  }
  let available = pySorted(_ALLOWED_KEYS.keys());
  let suggestion: string;
  if (providersInUse()) {
    available = pySorted(new Set([..._ALLOWED_KEYS.keys(), "sandbox_base_url", "sandbox_domain", ...extras.extraKeyNames()]));
    suggestion = `Available keys: ${available.join(", ")}`;
    const owners = extras.providersDeclaring(key);
    if (owners.length) suggestion += `. Did you mean '${owners.map((id) => `providers.${id}.${key}`).join("' or '")}'?`;
  } else {
    suggestion = `Available keys: ${available.join(", ")}`;
  }
  fmt.printError(`Unknown config key: ${pyStrRepr(key)}`, { suggestion });
  return sysExit(2);
}

/** The built-in default actually used for `key` (`null` = none). */
export function _businessDefault(key: string): unknown {
  const schema = providerSchema(extras.effectiveProviderId());
  if (key === "sandbox_base_url" || key === "sandbox_domain") {
    const canonical = key === "sandbox_base_url" ? "sandbox_base_url" : "sandbox_domain";
    const template = schema.derive[canonical];
    if (!template) return schema.endpoint_defaults[canonical] ?? null;
    let missing = false;
    const result = template.replace(/\{([^}]+)\}/g, (_token, field: string) => {
      if (!schema.keys.some((candidate) => candidate.key === field)) { missing = true; return ""; }
      const [value] = _effectiveValue(field);
      if (value === null || value === undefined) missing = true;
      return String(value ?? "");
    });
    return missing ? schema.endpoint_defaults[canonical] ?? null : result;
  }
  const own = schema.keys.find((candidate) => candidate.key === key);
  if (own) return own.default;
  if (key === "llm_base_url") return _DEFAULT_OPENAI_BASE_URL;
  if (key === "llm_model") return _DEFAULT_OPENAI_MODEL;
  const instance = new TransportConfig() as unknown as Record<string, unknown>;
  let dflt: unknown = Object.prototype.hasOwnProperty.call(instance, key) ? instance[key] : undefined;
  if (dflt === undefined || dflt === null || dflt === "") return null;
  if (key === "http_timeout" && typeof dflt === "number") dflt = new PyFloat(dflt);
  return dflt;
}

/** The environment variable currently overriding `key` (blank / whitespace-only values do not count). */
function _envOverrideName(key: string): string | null {
  for (const name of _ENV_OVERRIDES.get(key) ?? []) {
    const value = _env(name);
    if (value && pyStrip(value)) return name;
  }
  return null;
}

/**
 * `(value, source)` for `key`. `source` is `"env"`, `"user"`, `"default"` or `"unset"`; an empty string is never a
 * valid stored value. Order: process environment, `./.env`, the value stored under `~/.abx`, a built-in default.
 */
export function _effectiveValue(key: string): [unknown, string] {
  const operation = getOperationConfig();
  const operationKey = ({ api_url: "sandbox_base_url", domain: "sandbox_domain", api_key: "sandbox_api_key" } as Record<string, string>)[key] ?? key;
  const temporary = operation?.[operationKey] ?? operation?.[key];
  if (temporary !== undefined && temporary !== null && temporary !== "") return [temporary, "override"];
  const envName = _envOverrideName(key);
  if (envName !== null) return [process.env[envName], "env"];
  const projectValue = projectDotenvValue(_ENV_OVERRIDES.get(key) ?? []);
  if (projectValue) return [projectValue, "user"];
  const storedEnvName = _ENV_STORED_KEYS.get(key);
  if (storedEnvName !== undefined) {
    const stored = configSeams.readEnvVar(storedEnvName);
    if (stored) return [stored, "user"];
    return [null, "unset"];
  }
  const config = configSeams.loadConfigDict();
  const storedValue = config[key];
  if (storedValue !== undefined && storedValue !== null && storedValue !== "") return [storedValue, "user"];
  const dflt = _businessDefault(key);
  if (dflt === null) return [null, "unset"];
  return [dflt, "default"];
}

function _displayValue(key: string, value: unknown): string {
  const text = pyStr(value);
  return _SENSITIVE_KEYS.has(key) ? _maskValue(text) : text;
}

/** Remove `key` from the `[transport]` table; return whether it existed (the file is deleted once nothing remains). */
export function _removeTomlKey(key: string): boolean {
  const full = _loadFullConfig();
  const data = configSeams.loadConfigDict();
  if (!Object.prototype.hasOwnProperty.call(data, key)) return false;
  delete data[key];
  let otherSections = false;
  for (const [name, table] of full) {
    if (_isTable(table) && table.size && name !== "transport") otherSections = true;
  }
  if (Object.keys(data).length || otherSections) _saveConfigDict(data);
  else if (isFile(configSeams._CONFIG_FILE)) _unlink(configSeams._CONFIG_FILE);
  return true;
}

/** Remove the persistent value for `key` (`config delete KEY` and `config set KEY ""`). */
function _clearStoredValue(fmt: OutputFormatter, key: string, echoKey: string = key): void {
  let removed: boolean;
  const envVar = _ENV_STORED_KEYS.get(key);
  if (envVar !== undefined) {
    removed = removeEnvVar(envVar);
  } else {
    removed = _removeTomlKey(key);
  }

  const dflt = _businessDefault(key);
  let message: string;
  if (removed) {
    message = `Cleared ${echoKey}`;
    if (dflt !== null) message += ` (falls back to default: ${pyStr(dflt)})`;
    else message += " (now not set)";
  } else {
    message = `No stored value for ${echoKey}`;
    if (dflt !== null) message += ` (already using default: ${pyStr(dflt)})`;
    else message += " (already not set)";
  }

  const envName = _envOverrideName(key);
  if (envName !== null) {
    message += `; environment variable ${envName} still overrides it at runtime (value not shown)`;
  }
  fmt.printSuccess(message + ".");
}

function _clearExtraValue(fmt: OutputFormatter, target: extras.ExtraTarget): void {
  const removed = extras.clearExtra(target);
  const { value, source, name } = extras.readExtra(target);
  const fallback = source === "default" && value !== null && value !== undefined ? ` (falls back to default: ${pyStr(value)})` : " (now not set)";
  const alreadyFallback = source === "default" && value !== null && value !== undefined ? ` (already using default: ${pyStr(value)})` : " (already not set)";
  let message = removed ? `Cleared ${target.typed}${fallback}` : `No stored value for ${target.typed}${alreadyFallback}`;
  if (source === "env") message += `; environment variable ${name} still overrides it at runtime (value not shown)`;
  fmt.printSuccess(message + ".");
}

// Command help texts: the Python docstrings verbatim (`\b` is Click's no-rewrap marker, a literal backspace).
const CONFIG_HELP = () => providerCliExtension()?.configuration?.help["CONFIG_HELP"] ?? "Configure the selected provider. Run abx provider info for its fields.";

const GET_HELP = () => providerCliExtension()?.configuration?.help["GET_HELP"] ?? "Configure the selected provider. Run abx provider info for its fields.";

const SET_HELP = () => providerCliExtension()?.configuration?.help["SET_HELP"] ?? "Configure the selected provider. Run abx provider info for its fields.";

const DELETE_HELP = () => providerCliExtension()?.configuration?.help["DELETE_HELP"] ?? "Configure the selected provider. Run abx provider info for its fields.";

const LIST_HELP = () => providerCliExtension()?.configuration?.help["LIST_HELP"] ?? "Configure the selected provider. Run abx provider info for its fields.";

const INIT_HELP = () => providerCliExtension()?.configuration?.help["INIT_HELP"] ?? "Configure the selected provider. Run abx provider info for its fields.";


// ---------------------------------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------------------------------

export const config = group("config", { help: CONFIG_HELP });

export const get = command("get", {
  help: GET_HELP,
  params: [argument(["key"])],
  callback: _handleErrors(async (ctx: Context, params: Params) => {
    const fmt = getFormatter(ctx);
    const key = _canonicalizeKey(params["key"] as string);

    const extra = _extraFor(params["key"] as string, key);
    if (extra !== null) {
      const { value: extraValue } = extras.readExtra(extra);
      if (extraValue === null || extraValue === undefined) fmt.printData("(not set)");
      else fmt.printData(_extraDisplay(extra, extraValue));
      return;
    }

    if (!_ALLOWED_KEYS.has(key)) return _rejectUnknownKey(fmt, key);

    const [value] = _effectiveValue(key);
    if (value === null || value === undefined) {
      fmt.printData("(not set)");
      return;
    }
    fmt.printData(_displayValue(key, value));
  }),
});

function _savedHint(key: string, value: string, target?: extras.ExtraTarget): void {
  if (!canPrompt(getCurrentContext(true) ?? undefined, false, configSeams.sys ?? undefined)) return;
  const location = target ? extras.storageLocation(target).path : _ENV_STORED_KEYS.has(key) ? configSeams._ENV_FILE : configSeams._CONFIG_FILE;
  echo(`Saved in ${location}. Review values and sources: abx config list. Modify later: abx config set ${target?.typed ?? key} (omit VALUE for hidden secret input).`, { err: true });
  const effective = target ? extras.readExtra(target) : { value: _effectiveValue(key)[0], source: _effectiveValue(key)[1], name: _envOverrideName(key) ?? _ENV_STORED_KEYS.get(key) ?? key };
  const expected = target?.key ? extras.parseExtraValue(target, value) : key === "http2" ? ["true", "1", "yes", "on"].includes(value.trim().toLowerCase()) : key === "http_timeout" ? _pyFloatParse(value) : value;
  const actual = effective.value instanceof PyFloat ? effective.value.value : effective.value;
  if (String(actual) !== String(expected)) echo(`The saved value is overridden by ${effective.source}: ${effective.name || "see abx config list"}. Update that source to change the effective value; its value is not shown.`, { err: true });
}

export const set_value = command("set", {
  help: SET_HELP,
  params: [argument(["key"]), argument(["value"], { required: false })],
  callback: _handleErrors(async (ctx: Context, params: Params) => {
    const fmt = getFormatter(ctx);
    let key = params["key"] as string;
    let value = (params["value"] ?? null) as string | null;

    const typedKey = key;
    key = _canonicalizeKey(key);
    const echoKey = _echoName(typedKey, key);

    const extra = _extraFor(typedKey, key);
    if (extra !== null) {
      if (value === null) {
        value = await _extraPrompt(fmt, extra);
        if (value === null) return;
      }
      if (pyStrip(value) === "") {
        _clearExtraValue(fmt, extra);
        return;
      }
      extras.writeExtra(extra, value);
      fmt.printSuccess(`Set ${extra.typed} = ${_extraDisplay(extra, value)}`);
      _savedHint(key, value, extra);
      return;
    }

    if (!_ALLOWED_KEYS.has(key)) return _rejectUnknownKey(fmt, key);

    if (value === null) {
      value = await _promptMissingValue(fmt, key);
      if (value === null) return;
    }

    // Empty values clear the stored override: they are never written as a credential or an empty-string override.
    if (pyStrip(value) === "") {
      _clearStoredValue(fmt, key, echoKey);
      return;
    }

    const envVar = _ENV_STORED_KEYS.get(key);
    if (envVar !== undefined) {
      configSeams.writeEnvVar(envVar, value);
      fmt.printSuccess(`Set ${echoKey} = ${_SENSITIVE_KEYS.has(key) ? _maskValue(value) : value}`);
      _savedHint(key, value);
      return;
    }

    const data = configSeams.loadConfigDict();

    if (key === "http_timeout") {
      const parsed = _pyFloatParse(value);
      if (parsed === null) {
        fmt.printError(`Invalid numeric value: ${pyStrRepr(value)}`);
        return sysExit(2);
      }
      data[key] = new PyFloat(parsed);
    } else if (key === "http2") {
      const lowered = pyStrip(value).toLowerCase();
      if (["true", "1", "yes", "on"].includes(lowered)) {
        data[key] = true;
      } else if (["false", "0", "no", "off"].includes(lowered)) {
        data[key] = false;
      } else {
        fmt.printError(`Invalid boolean value: ${pyStrRepr(value)} (expected true/false)`);
        return sysExit(2);
      }
    } else {
      data[key] = value;
    }

    _saveConfigDict(data);
    const displayValue = _SENSITIVE_KEYS.has(key) ? _maskValue(value) : value;
    fmt.printSuccess(`Set ${echoKey} = ${displayValue}`);
    _savedHint(key, value);
  }),
});

/** Save one validated setup value without printing it; return the actual persistent destination. */
export function saveGuidedValue(key: string, value: string, providerId?: string): { path: string; key: string; section?: string } {
  _syncPaths();
  assertConfigFilesReadable(configSeams._CONFIG_FILE, [configSeams._ENV_FILE]);
  const canonical = _canonicalizeKey(key);
  const schemaName = ({ api_url: "sandbox_base_url", domain: "sandbox_domain" } as Record<string, string>)[canonical] ?? canonical;
  const providerOwns = providerId ? registry.getProvider(providerId).configKeys().some((field) => field.key === schemaName) || registry.getProvider(providerId).inherit.has(schemaName) : false;
  if (providerId && !providerOwns && (!["llm_api_key", "llm_base_url", "llm_model", "github_token", "http_timeout", "http2"].includes(canonical))) {
    throw new ProviderConfigError(`Provider '${providerId}' does not declare or inherit '${schemaName}'; it cannot be saved for this operation.`);
  }
  const target = providerId && providerOwns ? extras.resolveExtraKey(`providers.${providerId}.${schemaName}`) : _extraFor(key, canonical);
  if (target) {
    extras.writeExtra(target, value);
    return extras.storageLocation(target);
  }
  if (!_ALLOWED_KEYS.has(canonical)) throw new ProviderConfigError(`Unknown config key '${key}'.`);
  const env = _ENV_STORED_KEYS.get(canonical);
  if (env) {
    configSeams.writeEnvVar(env, value);
    resetConfigurationCaches();
    return { path: configSeams._ENV_FILE, key: env };
  }
  const data = configSeams.loadConfigDict();
  if (canonical === "http_timeout") {
    const parsed = _pyFloatParse(value);
    if (parsed === null || !Number.isFinite(parsed) || parsed <= 0) throw new ProviderConfigError("http_timeout must be a positive finite number.");
    data[canonical] = new PyFloat(parsed);
  } else if (canonical === "http2") {
    const boolean = value.trim().toLowerCase();
    if (!["true", "false", "1", "0", "yes", "no", "on", "off"].includes(boolean)) throw new ProviderConfigError("http2 must be true or false.");
    data[canonical] = ["true", "1", "yes", "on"].includes(boolean);
  } else {
    if (["sandbox_base_url", "llm_base_url"].includes(canonical)) {
      try { const url = new URL(value); if (!["http:", "https:"].includes(url.protocol)) throw new Error(); }
      catch { throw new ProviderConfigError(`'${canonical}' must be an HTTP(S) URL.`); }
    }
    data[canonical] = value;
  }
  _saveConfigDict(data);
  return { path: configSeams._CONFIG_FILE, key: canonical, section: "transport" };
}

export const delete_value = command("delete", {
  help: DELETE_HELP,
  params: [argument(["key"])],
  callback: _handleErrors(async (ctx: Context, params: Params) => {
    const fmt = getFormatter(ctx);
    let key = params["key"] as string;

    const typedKey = key;
    key = _canonicalizeKey(key);
    const extra = _extraFor(typedKey, key);
    if (extra !== null) {
      _clearExtraValue(fmt, extra);
      return;
    }
    if (!_ALLOWED_KEYS.has(key)) return _rejectUnknownKey(fmt, key);
    _clearStoredValue(fmt, key, _echoName(typedKey, key));
  }),
});

const _CANONICAL_LIST_NAMES: ReadonlyMap<string, string> = new Map([
  ["sandbox_base_url", "sandbox_base_url"],
  ["sandbox_domain", "sandbox_domain"],
]);

/** Extra listing targets are limited to the selected provider's declared fields. */
function _extraListGroups(showAll: boolean): { groups: Array<[string, string[]]>; targets: Map<string, extras.ExtraTarget>; dropBuiltinCreds: boolean } {
  _syncPaths();
  const groups: Array<[string, string[]]> = [], targets = new Map<string, extras.ExtraTarget>();
  const eff = extras.effectiveProviderId();
  const provider = registry.getProvider(eff);
  const profile = providerCliExtension(eff)?.configuration;
  for (const name of _ALLOWED_KEYS.keys()) {
    const target = extras.coreTarget(name, name);
    if (target !== null) targets.set(name, target);
  }
  if (providersInUse()) {
    targets.set("provider", extras.resolveExtraKey("provider") as extras.ExtraTarget);
    groups.push(["Provider", ["provider"]]);
  }
  if (profile) {
    for (const [title, names] of profile.extraGroups) {
      const keys: string[] = []; let anySet = false;
      for (const name of names) {
        const target = extras.resolveExtraKey(`providers.${eff}.${name}`);
        if (!target) continue;
        targets.set(name, target); keys.push(name);
        if (extras.readExtra(target).source !== "unset") anySet = true;
      }
      if (anySet || showAll) groups.push([title, keys]);
      else for (const name of keys) targets.delete(name);
    }
  } else {
    const keys = provider.configKeys(), name = provider.displayName || eff;
    for (const [title, list] of [[`${name} credentials`, keys.filter((key) => key.credential || key.secret)],
      [`${name} options`, keys.filter((key) => !(key.credential || key.secret))]] as const) {
      if (!list.length) continue;
      for (const key of list) targets.set(key.key, extras.resolveExtraKey(`providers.${eff}.${key.key}`) as extras.ExtraTarget);
      groups.push([title, list.map((key) => key.key)]);
    }
  }
  return { groups, targets, dropBuiltinCreds: !profile };
}

export const list_config = command("list", {
  help: LIST_HELP,
  params: [
    option(["--all", "show_all"], { is_flag: true, hidden: !_surfaceActive(), help: "Also list provider keys that have no value" }),
  ],
  callback: _handleErrors(async (ctx: Context, params: Params) => {
    const fmt = getFormatter(ctx);
    const canonicalNames = true;
    const shown = (key: string): string => (canonicalNames ? (_CANONICAL_LIST_NAMES.get(key) ?? key) : key);
    const extra = _extraListGroups(Boolean(params["show_all"]));

    // Stable order: the functional groups, then any key the groups do not cover yet (so a new key is never invisible).
    const activeGroups = providerCliExtension(extras.effectiveProviderId())?.configuration?.groups ?? [];
    const functionalGroups = [..._CONFIG_GROUPS.slice(0, 1), ...activeGroups, ..._CONFIG_GROUPS.slice(1)];
    const grouped: Array<[string, readonly string[]]> = functionalGroups.filter(([, keys]) => keys.length)
      .filter(([title]) => !(extra.dropBuiltinCreds && bundledCliConfigurations().some((profile) => profile.groups.some(([group]) => group === title))))
      .map(([title, keys]) => [title, extra.dropBuiltinCreds ? keys.filter((key) => _GENERIC_KEYS.has(key)) : keys]);
    const covered = new Set<string>();
    for (const [, keys] of grouped) for (const key of keys) covered.add(key);
    const leftover = [..._ALLOWED_KEYS.keys()].filter((k) => !covered.has(k) && !(extra.dropBuiltinCreds && !_GENERIC_KEYS.has(k)));
    if (leftover.length) grouped.push(["Other", leftover]);
    if (extra.groups.length) {
      const providerGroups = extra.groups.filter(([title]) => title === "Provider");
      const otherGroups = extra.groups.filter(([title]) => title !== "Provider");
      grouped.unshift(...providerGroups);
      const connectionAt = grouped.findIndex(([title]) => title === "Connection");
      grouped.splice(connectionAt < 0 ? grouped.length : connectionAt, 0, ...otherGroups);
    }
    const orderedKeys = grouped.flatMap(([, keys]) => [...keys]);
    const effectiveOf = (key: string): [unknown, string] => {
      const target = extra.targets.get(key);
      if (target !== undefined) {
        const r = extras.readExtra(target);
        return [r.value, r.source];
      }
      return _effectiveValue(key);
    };
    const sensitive = (key: string): boolean => {
      const target = extra.targets.get(key);
      return target ? isProviderConfigSensitive(target.provider_id, target.key?.key ?? "", target.key?.secret) : _SENSITIVE_KEYS.has(key);
    };

    const render = (key: string): string => {
      const [value, source] = effectiveOf(key);
      if (value === null || value === undefined) return "(not set)";
      const text = _extraText(extra.targets.get(key), value);
      return `${sensitive(key) ? _maskValue(text) : text} (${source})`;
    };

    // JSON mode: pure values without source annotations; the grouping is display-only (flat {key: value} map).
    if (fmt.use_json) {
      const resultJson = new Map<string, unknown>();
      for (const key of orderedKeys) {
        const [value] = effectiveOf(key);
        if (value === null || value === undefined) resultJson.set(shown(key), null);
        else if (sensitive(key)) resultJson.set(shown(key), _maskValue(pyStr(value)));
        else resultJson.set(shown(key), extra.targets.get(key)?.key?.type === "float" && typeof value === "number" ? new PyFloat(value) : value);
      }
      fmt.printDict(resultJson);
      return;
    }

    if (fmt.quiet) {
      for (const [, keys] of grouped) for (const key of keys) echo(render(key));
      return;
    }

    const maxKeyLen = orderedKeys.reduce((m, key) => Math.max(m, len(shown(key))), 0);
    grouped.forEach(([title, keys], index) => {
      if (index) echo();
      const header = `── ${title} `;
      echo(header + "─".repeat(Math.max(0, 64 - len(header))));
      for (const key of keys) echo(`${ljust(shown(key), maxKeyLen)}  ${render(key)}`);
    });
  }),
});

/** Print the non-interactive commands equivalent to the guided wizard. */
function _printNoninteractiveSetup(opts: { build: boolean; llm: boolean }, fmt?: OutputFormatter): void {
  const provider = registry.getProvider(extras.effectiveProviderId());
  const profile = providerCliExtension(provider.id)?.configuration;
  const lines = ["Non-interactive setup. Run these commands to configure abx:", "",
    ...(profile?.noninteractiveInit ?? provider.configKeys().map((key) => `  abx provider config ${provider.id} set ${key.key} <${key.env}>`)),
  ];
  if (opts.build) lines.push(...(profile?.noninteractiveBuild ?? ["", `  abx provider info ${provider.id}`]));
  if (opts.llm) {
    lines.push(
      "",
      "  # template generation:",
      "  abx config set llm_api_key <DASHSCOPE_OR_MODELSTUDIO_KEY>",
      "",
      "  # Optional overrides:",
      "  abx config set llm_base_url <OPENAI_COMPATIBLE_BASE_URL>",
      "  abx config set llm_model qwen3-coder-plus",
    );
  }
  const env = [...(profile?.environment ?? provider.configKeys().map((key) => key.env))];
  if (opts.llm) env.push("ABX_LLM_API_KEY");
  if (opts.build) env.push(...(profile?.buildEnvironment ?? []));
  lines.push("", `Environment variables (${env.join(", ")}) override stored values.`);
  if (!opts.build || !opts.llm) {
    const more: string[] = [];
    if (!opts.build) more.push("template build/push: 'abx config init --build'");
    if (!opts.llm) more.push("template generation: 'abx config init --llm'");
    lines.push(`More settings: ${more.join("; ")}.`);
  }
  if (fmt?.use_json) fmt.printData({ status: "setup_required", commands: lines.filter((line) => line.trim().startsWith("abx ")).map((line) => line.trim()), message: "Non-interactive setup; no configuration was changed." });
  else for (const line of lines) echo(line);
}

export const init = command("init", {
  help: INIT_HELP,
  params: [
    option(["--yes", "-y"], { is_flag: true, help: "Non-interactive: print the equivalent commands instead of prompting" }),
    option(["--build"], { is_flag: true, help: "Also ask for the selected provider build settings" }),
    option(["--llm"], { is_flag: true, help: "Also ask for the LLM API key used for template generation" }),
  ],
  callback: _handleErrors(async (ctx: Context, params: Params) => {
    const fmt = getFormatter(ctx);
    const build = Boolean(params["build"]);
    const llm = Boolean(params["llm"]);
    _syncPaths();

    // Never block in CI / piped sessions.
    if (!canPrompt(ctx, Boolean(params["yes"]), configSeams.sys ?? undefined)) {
      _printNoninteractiveSetup({ build, llm }, fmt);
      return;
    }

    const provider = registry.getProvider(extras.effectiveProviderId());
    const profile = providerCliExtension(provider.id)?.configuration;
    assertConfigFilesReadable(configSeams._CONFIG_FILE, [configSeams._ENV_FILE]);
    assertConfigValuesValid([...CORE_KEYS.filter((key) => !GENERIC_ENDPOINT_KEYS.includes(key.key) || provider.inherit.has(key.key)), ...provider.configKeys()], collectSources(), provider.id);
    echo(configurationTargetSummary(provider.id), { err: true });
    const declared: readonly ConfigPrompt[] = profile?.initFields ?? (await extras.initializationKeys(provider.id, async (groups) => {
      const index = await select("Choose an authentication method", {
        choices: [...groups.map((group, index) => ({ name: group.join(" + "), value: index })), { name: "Cancel", value: -1 }],
        default: -1, err: true,
      });
      if (index === -1) throw new Abort();
      return index;
    })).map((key) => ({
      key: key.key, prompt: key.description || key.key, hidden: key.secret, current: !key.secret, result: "stored" as const,
    }));
    const fields = [...declared, ...(build ? profile?.buildFields ?? [] : [])];
    const total = fields.length + (llm ? 1 : 0);
    const pending: Array<{ field: ConfigPrompt; value: string }> = [];
    let step = 0;
    const label = (text: string): string => `${++step}/${total} ${text}`;
    assertConfigFilesReadable(configSeams._CONFIG_FILE, [configSeams._ENV_FILE]);
    echo("abx guided configuration (press Enter to keep the current value; missing required values remain incomplete):", { err: true });
    for (const field of fields) {
      const help = configurationFieldHelp(field.key, provider.id);
      if (help) echo(help, { err: true });
      let current: unknown = field.default ?? "";
      if (field.current) {
        const target = profile ? null : extras.resolveExtraKey(`providers.${provider.id}.${field.key}`);
        current = (target ? extras.readExtra(target).value : _effectiveValue(field.key)[0]) ?? current;
      }
      const question = label(field.prompt);
      for (;;) {
        const answer = field.hidden ? await configSeams._promptSecret(question) : await prompt(question, {
          default: pyStr(current), show_default: Boolean(current), err: true,
        });
        const value = pyStrip(String(answer));
        if (!value) break;
        try {
          const target = extras.resolveExtraKey(`providers.${provider.id}.${field.key}`);
          if (target?.key) extras.parseExtraValue(target, value);
          pending.push({ field, value });
          break;
        } catch (error) {
          if (!(error instanceof ProviderConfigError)) throw error;
          echo(error.message, { err: true });
        }
      }
    }
    if (llm) {
      const value = pyStrip(await configSeams._promptSecret(label("LLM API key (DashScope/ModelStudio, input masked)")));
      if (value) pending.push({ field: { key: "llm_api_key", env: "ABX_LLM_API_KEY", prompt: "LLM API key", hidden: true, result: "stored" }, value });
    }
    const saved: string[] = [];
    try {
      for (const { field, value } of pending) {
        let destination: string;
        if (!profile && field.key !== "llm_api_key") {
          const target = extras.resolveExtraKey(`providers.${provider.id}.${field.key}`);
          if (!target) throw new ProviderConfigError(`Provider '${provider.id}' does not declare '${field.key}'.`);
          extras.writeExtra(target, value);
          destination = extras.storageLocation(target).path;
        } else if (field.env) {
          configSeams.writeEnvVar(field.env, value);
          destination = configSeams._ENV_FILE;
        } else {
          const data = configSeams.loadConfigDict(); data[field.key] = value; _saveConfigDict(data);
          destination = configSeams._CONFIG_FILE;
        }
        saved.push(field.key);
        if (field.result === "set" && !field.hidden) fmt.printSuccess(`Set ${field.key} = ${value}`);
        else fmt.printSuccess(`Stored ${field.key} in ${destination}`);
      }
    } catch (error) {
      if (error instanceof extras.ConfigurationCleanupError) saved.push(error.field);
      throw new ProviderConfigError(`Configuration save failed. Saved fields: ${saved.join(", ") || "none"}; setup is incomplete.${error instanceof extras.ConfigurationCleanupError ? " A previous configuration copy could not be removed." : ""}`, {
        suggestion: `Check permissions on ${configSeams._CONFIG_FILE} and ${configSeams._ENV_FILE}; review 'abx config list' before retrying.`,
      });
    }

    echo();
    resetConfigurationCaches();
    const required = profile ? ["sandbox_api_key", ...(build ? ["acr_namespace", "access_key_id", "access_key_secret"] : []), ...(llm ? ["llm_api_key"] : [])] : fields.filter((field) => provider.configKeys().find((key) => key.key === field.key)?.required).map((field) => field.key);
    const missing = required.filter((key) => {
      const value = profile ? _effectiveValue(key)[0] : extras.readExtra(extras.resolveExtraKey(`providers.${provider.id}.${key}`)!).value;
      return value === null || value === undefined || value === "";
    });
    let authError = "";
    if (!profile) {
      try { provider.validateConfig((await import("../../transport/config_layers.js")).loadLayeredConfig({ provider: provider.id })); }
      catch { authError = ` Required fields or an authentication combination for '${provider.id}' are still missing; see 'abx provider info ${provider.id}'.`; }
    }
    if (missing.length || authError) {
      fmt.printError(`Configuration incomplete.${missing.length ? ` Missing: ${missing.join(", ")}.` : ""}${authError}`, { suggestion: "Run 'abx config init' again, or 'abx config set KEY' to enter a value safely." });
      return sysExit(2);
    }
    const overridden: string[] = [];
    for (const { field, value } of pending) {
      const target = field.key === "llm_api_key" ? null : extras.resolveExtraKey(`providers.${provider.id}.${field.key}`);
      const effective = target ? extras.readExtra(target) : { value: _effectiveValue(field.key)[0], source: _effectiveValue(field.key)[1], name: _envOverrideName(field.key) ?? field.env ?? field.key };
      const expected = target ? extras.parseExtraValue(target, value) : value;
      if (effective.value !== expected) overridden.push(`${field.key} (${effective.source}: ${effective.name || "see abx config list"})`);
    }
    if (overridden.length) echo(`Saved values overridden by another configuration source: ${overridden.join(", ")}. Update or remove that source to use the newly saved values; values are not shown.`, { err: true });
    const destinations = [...new Set(pending.map(({ field }) => field.env ? configSeams._ENV_FILE : configSeams._CONFIG_FILE))];
    if (!_effectiveValue("server_token")[0]) {
      const location = saveGuidedValue("server_token", randomBytes(32).toString("hex"));
      echo(`Generated an application access token and saved it in ${location.path}. Template launch and abx run use it automatically.`, { err: true });
    }
    fmt.printSuccess(`Configuration complete.${destinations.length ? ` Saved to ${destinations.join(" and ")}.` : " Existing values were kept."} Review values and sources with 'abx config list'.`);
    echo("To change a value later: abx config set KEY (omit VALUE for masked secret input).", { err: true });
    if (!build && !llm) {
      const { continueSetup } = await import("../setup.js");
      await continueSetup(ctx);
    } else if (!build || !llm) {
      const more: string[] = [];
      if (!build) more.push("template build/push: 'abx config init --build'");
      if (!llm) more.push("template generation: 'abx config init --llm'");
      echo(`More settings: ${more.join("; ")}.`);
    }
  }),
});

config.addCommand(get);
config.addCommand(set_value);
config.addCommand(delete_value);
config.addCommand(list_config);
config.addCommand(init);

// ---------------------------------------------------------------------------------------------------------------------
// Masked secret input (asterisk feedback; no new dependencies)
// ---------------------------------------------------------------------------------------------------------------------

/** Whether the current stdin can render asterisk-masked input. */
export function _maskSupported(): boolean {
  const stdin = _stdin();
  try {
    if (!stdin.isatty()) return false;
  } catch {
    return false;
  }
  if (process.platform === "win32") {
    return Boolean(process.stdin.isTTY) && typeof process.stdin.setRawMode === "function";
  }
  let fd: number;
  try {
    if (typeof stdin.fileno !== "function") return false;
    fd = stdin.fileno();
  } catch {
    return false;
  }
  try {
    return tty.isatty(fd);
  } catch {
    return false;
  }
}

/**
 * Run `fn` with a reader returning the next characters typed on the TTY (raw mode: no echo, no line buffering; Ctrl-C
 * arrives as `\x03`). The terminal state and any other stdin listeners are always restored afterwards.
 */
async function _withTtyCharReader<T>(fn: (read: () => Promise<string>) => Promise<T>): Promise<T> {
  let fd = 0;
  try {
    const f = _stdin().fileno;
    if (typeof f === "function") fd = f.call(_stdin());
  } catch {
    fd = 0;
  }
  const stream: tty.ReadStream = fd === 0 ? (process.stdin as tty.ReadStream) : new tty.ReadStream(fd);
  const savedData = stream.listeners("data") as Array<(...args: unknown[]) => void>;
  for (const l of savedData) stream.off("data", l);
  const wasRaw = Boolean(stream.isRaw);
  const decoder = new StringDecoder("utf8");
  const queue: string[] = [];
  let ended = false;
  let wake: (() => void) | null = null;
  const notify = (): void => {
    const w = wake;
    wake = null;
    if (w) w();
  };
  const onData = (chunk: Buffer | string): void => {
    const text = typeof chunk === "string" ? chunk : decoder.write(chunk);
    if (text) queue.push(text);
    notify();
  };
  const onEnd = (): void => {
    ended = true;
    notify();
  };
  stream.setRawMode(true);
  stream.on("data", onData);
  stream.on("end", onEnd);
  stream.on("close", onEnd);
  stream.resume();
  const read = async (): Promise<string> => {
    while (!queue.length && !ended) await new Promise<void>((resolve) => (wake = resolve));
    return queue.length ? (queue.shift() as string) : "";
  };
  try {
    return await fn(read);
  } finally {
    stream.off("data", onData);
    stream.off("end", onEnd);
    stream.off("close", onEnd);
    try {
      stream.setRawMode(wasRaw);
    } catch {
      /* terminal already gone */
    }
    for (const l of savedData) stream.on("data", l);
    stream.pause();
  }
}

const _NONPRINTABLE_RE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;

/** Python `str.isprintable()` for one character. */
const _isPrintable = (ch: string): boolean => ch === " " || !_NONPRINTABLE_RE.test(ch);

/**
 * Consume one input `chunk`; return the finished line, else `null`.
 *
 * One `*` is written per printable character; Backspace erases one, Enter finishes the line, Ctrl-C raises
 * `KeyboardInterrupt` and Ctrl-D / Ctrl-Z on an empty line raise `EOFError`. Typed characters are never echoed.
 */
export function _feedMasked(chunk: string, chars: string[], write: (text: string) => void): string | null {
  for (const ch of chunk) {
    if (ch === "\r" || ch === "\n") {
      write("\n");
      return chars.join("");
    }
    if (ch === "\x7f" || ch === "\x08") {
      if (chars.length) {
        chars.pop();
        write("\b \b");
      }
      continue;
    }
    if (ch === "\x03") throw new KeyboardInterrupt();
    if (ch === "\x04" || ch === "\x1a") {
      write("\n");
      if (!chars.length) throw new EOFError("End of masked input");
      return chars.join("");
    }
    if (_isPrintable(ch)) {
      chars.push(ch);
      write("*");
    }
  }
  return null;
}

/**
 * Read one line from the TTY printing one asterisk per character.
 *
 * `reader` / `writer` are injectable for tests (a reader may return a string or a promise of one). Raises `EOFError`
 * on terminal EOF and `KeyboardInterrupt` on Ctrl-C; typed characters are never echoed.
 */
export async function _readMaskedLine(
  promptText: string,
  opts: { reader?: (() => string | Promise<string>) | null; writer?: ((text: string) => void) | null } = {},
): Promise<string> {
  const defaultWrite = (text: string): void => {
    const out = _stdout();
    out.write(text);
    out.flush();
  };
  const write = opts.writer ?? defaultWrite;
  const chars: string[] = [];
  const loop = async (read: () => string | Promise<string>): Promise<string> => {
    write(promptText);
    for (;;) {
      const chunk = await read();
      if (chunk === "") {
        write("\n");
        throw new EOFError("End of masked input");
      }
      const finished = _feedMasked(chunk, chars, write);
      if (finished !== null) return finished;
    }
  };
  if (opts.reader) return loop(opts.reader);
  return _withTtyCharReader((read) => loop(read));
}

/** Prompt for a secret, showing `*` per keystroke when possible; falls back to a no-echo prompt with a notice. */
async function _promptSecretImpl(promptText: string): Promise<string> {
  if (_maskSupported()) {
    try {
      return await _readMaskedLine(`${promptText}: `);
    } catch (e) {
      if (e instanceof EOFError || e instanceof KeyboardInterrupt) throw new Abort();
      throw e;
    }
  }
  echo("Note: asterisk masking is not supported by this terminal; typed input will not be echoed.", { err: true });
  return String(await prompt(promptText, { hide_input: true, default: "", show_default: false, err: true }));
}

/** Prompt for a secret, showing `*` per keystroke when possible. */
export function _promptSecret(promptText: string): Promise<string> {
  return configSeams._promptSecret(promptText);
}

/**
 * Prompt for a VALUE omitted from `abx config set KEY`.
 *
 * Sensitive keys reuse the asterisk-masked input; other keys use a visible prompt. Returns the entered value, or
 * `null` when the user pressed Enter without typing anything (nothing changes: clearing needs an explicit `""`).
 * Without an interactive terminal the command exits with code 2 instead of blocking a CI job.
 */
async function _promptMissingValue(fmt: OutputFormatter, key: string, sensitive = false): Promise<string | null> {
  const interactive = canPrompt(getCurrentContext(true) ?? undefined, false, configSeams.sys ?? undefined);

  if (!interactive) {
    let suggestion = `Pass the value explicitly: 'abx config set ${key} <VALUE>'.`;
    const envVar = _ENV_STORED_KEYS.get(key);
    if (envVar !== undefined) {
      suggestion +=
        ` In CI, inject the ${envVar} environment variable as a secret ` + "instead of storing it locally.";
    }
    fmt.printError(`Missing VALUE for ${pyStrRepr(key)} and stdin is not an interactive terminal.`, { suggestion });
    return sysExit(2);
  }

  echo(configurationTargetSummary(extras.effectiveProviderId()), { err: true });
  for (;;) {
    const entered = sensitive || _SENSITIVE_KEYS.has(key)
      ? await configSeams._promptSecret(`${key} (input masked; press Enter to cancel)`)
      : String(await prompt(key, { default: "", show_default: false, err: true }));
    if (pyStrip(entered) === "") {
      fmt.printSuccess(`No value entered; ${key} was not changed.`);
      return null;
    }
    try {
      const canonical = _canonicalizeKey(key);
      const target = _extraFor(key, canonical);
      if (target?.key) extras.parseExtraValue(target, entered);
      else if (canonical === "http_timeout") {
        const parsed = _pyFloatParse(entered);
        if (parsed === null || !Number.isFinite(parsed) || parsed <= 0) throw new ProviderConfigError("Invalid numeric value: expected a positive finite timeout.");
      } else if (canonical === "http2" && !["true", "false", "1", "0", "yes", "no", "on", "off"].includes(entered.trim().toLowerCase())) {
        throw new ProviderConfigError("Invalid boolean value: expected true/false.");
      } else if (["sandbox_base_url", "llm_base_url"].includes(canonical)) {
        try { const url = new URL(entered); if (!["http:", "https:"].includes(url.protocol)) throw new Error(); }
        catch { throw new ProviderConfigError(`Invalid URL for '${key}': expected an HTTP(S) URL.`); }
      }
      return entered;
    } catch (error) {
      if (!(error instanceof ProviderConfigError)) throw error;
      echo(error.message, { err: true });
    }
  }
}
