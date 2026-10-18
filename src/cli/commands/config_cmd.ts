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
import { prompt } from "../prompts.js";
import { cpSlice, len, ljust } from "../../utils/_py.js";
import { TransportConfig, projectDotenvValue } from "../../transport/config.js";
import { _DEFAULT_OPENAI_BASE_URL, _DEFAULT_OPENAI_MODEL } from "../../agent/qwen_code.js";
import { PyFloat, pyFloatParse, pyFloatRepr, pyStr, pyStrRepr, pyStrip, pySorted, pySplitlines } from "../../utils/_pyformat.js";
import { isFile, toOSError, writeTextPy } from "../../utils/_pyos.js";
import { type OutputFormatter, getFormatter } from "../formatters.js";
import { decodeUtf8Strict, loadBytes, type Table } from "../../utils/_tomllib.js";
import { providersInUse } from "../../providers/in_use.js";
import { cliProvider } from "../../providers/selection.js";
import { _setPaths, applyMigration, auditConfig, planMigration } from "../../transport/config_layers.js";
import { BUILTIN_PROVIDER_ID } from "../../utils/config_keys.js";
import * as extras from "./_config_providers.js";
import * as registry from "../../providers/registry.js";

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
  stdout?: { write(text: string): void; flush(): void };
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
  return configSeams.sys?.stdout ?? sys.stdout;
}

/** Keys that users can configure (key -> help). */
export const _ALLOWED_KEYS: ReadonlyMap<string, string> = new Map([
  ["sandbox_api_key", "Sandbox service API key (env: ABX_SANDBOX_API_KEY)"],
  ["access_key_id", "Alibaba Cloud AccessKey ID for template deploy / ACR push"],
  ["access_key_secret", "Alibaba Cloud AccessKey Secret for template deploy / ACR push"],
  ["acr_namespace", "ACR namespace for template build, push, and install (env: ACR_NAMESPACE)"],
  ["api_url", "Platform API URL (e.g. https://api.cn-hangzhou.e2b.fc.aliyuncs.com)"],
  ["region", "Default region (e.g. cn-hangzhou, cn-shanghai)"],
  ["http_timeout", "HTTP request timeout in seconds"],
  ["http2", "Enable HTTP/2 for platform connections (true/false)"],
  ["max_retries", "Maximum retry attempts"],
  ["domain", "Envd domain"],
  ["llm_api_key", "LLM API key for template generation (stored in ~/.abx/.env)"],
  ["llm_model", "LLM model name (default: qwen3-coder-plus)"],
  ["llm_base_url", "LLM API base URL, OpenAI-compatible (default: DashScope compatible-mode)"],
  ["github_token", "GitHub token for template downloads / rate limits (stored in ~/.abx/.env)"],
]);

/** Keys stored in `~/.abx/.env` (mapped to their env-var name) rather than `config.toml`. */
export const _ENV_STORED_KEYS: ReadonlyMap<string, string> = new Map([
  ["sandbox_api_key", "ABX_SANDBOX_API_KEY"],
  ["access_key_id", "ALICLOUD_ACCESS_KEY_ID"],
  ["access_key_secret", "ALICLOUD_ACCESS_KEY_SECRET"],
  ["acr_namespace", "ACR_NAMESPACE"],
  ["llm_api_key", "ABX_LLM_API_KEY"],
  ["github_token", "GITHUB_TOKEN"],
]);

/** Older CLI names that still work for `config get` / `config set` but are not shown by `config list`. */
const _KEY_ALIASES: ReadonlyMap<string, string> = new Map([
  ["api_key", "sandbox_api_key"],
  ["api_base_url", "api_url"],
  ["sandbox_base_url", "api_url"],
  ["sandbox_domain", "domain"],
]);

/** Old names that the canonical key renamed; typing one prints the interactive hint (spec section 3.4). */
const _RENAMED_LEGACY: ReadonlyMap<string, string> = new Map([
  ["api_key", "sandbox_api_key"],
  ["api_url", "sandbox_base_url"],
  ["api_base_url", "sandbox_base_url"],
  ["domain", "sandbox_domain"],
]);

/** Keys the long-standing code handles itself for every provider (everything but the built-in provider's own keys). */
const _GENERIC_KEYS: ReadonlySet<string> = new Set([
  "sandbox_api_key", "api_url", "domain", "http_timeout", "http2", "max_retries", "llm_api_key", "llm_model", "llm_base_url", "github_token",
]);

/** Keys removed from the config surface; `config get` / `config set` name the replacement. */
const _REMOVED_KEYS: ReadonlyMap<string, string> = new Map([
  ["qwen_code_api_key", "llm_api_key"],
  ["qwen_code_base_url", "llm_base_url"],
  ["qwen_code_model", "llm_model"],
]);

/** Storage written by older releases, read only when the unified key is unset. */
const _LEGACY_TOML_FALLBACKS: ReadonlyMap<string, string> = new Map([
  ["llm_base_url", "qwen_code_base_url"],
  ["llm_model", "qwen_code_model"],
]);

/** Env-stored keys whose value may still live in an old `[transport]` section of config.toml. */
const _LEGACY_TOML_ENV_KEYS: ReadonlySet<string> = new Set(["llm_api_key"]);

/** Functional groups for `config list`: stable order, one group per topic. */
const _CONFIG_GROUPS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["Sandbox authentication", ["sandbox_api_key"]],
  ["Alibaba Cloud credentials", ["access_key_id", "access_key_secret", "acr_namespace"]],
  ["Connection", ["api_url", "region", "domain", "http_timeout", "http2", "max_retries"]],
  ["LLM", ["llm_api_key", "llm_model", "llm_base_url"]],
  ["Integrations", ["github_token"]],
];

/** Keys that are sensitive and should be masked in output. */
const _SENSITIVE_KEYS: ReadonlySet<string> = new Set(["sandbox_api_key", "llm_api_key", "access_key_secret", "github_token"]);

/** Environment variables that override each key at runtime, in priority order. */
const _ENV_OVERRIDES: ReadonlyMap<string, readonly string[]> = new Map([
  ["sandbox_api_key", ["ABX_SANDBOX_API_KEY"]],
  ["access_key_id", ["ALICLOUD_ACCESS_KEY_ID"]],
  ["access_key_secret", ["ALICLOUD_ACCESS_KEY_SECRET"]],
  ["acr_namespace", ["ACR_NAMESPACE"]],
  ["api_url", ["ABX_SANDBOX_BASE_URL"]],
  ["domain", ["ABX_SANDBOX_DOMAIN"]],
  ["region", ["ALIBABA_CLOUD_REGION_ID"]],
  ["http_timeout", ["ABX_HTTP_TIMEOUT"]],
  ["llm_api_key", ["ABX_LLM_API_KEY", "BAILIAN_CODING_PLAN_API_KEY", "DASHSCOPE_API_KEY", "OPENAI_API_KEY"]],
  ["llm_base_url", ["ABX_LLM_BASE_URL", "OPENAI_BASE_URL"]],
  ["llm_model", ["ABX_LLM_MODEL", "OPENAI_MODEL"]],
  ["github_token", ["GITHUB_TOKEN"]],
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
  writeTextPy(configSeams._CONFIG_FILE, content);
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

/** `load_config_dict()` implementation: the `[transport]` section (or legacy flat keys) as a plain object. */
function _loadConfigDictImpl(): Record<string, unknown> {
  const data = _loadFullConfig();
  const transport = data.get("transport");
  if (_isTable(transport)) return _toRecord(transport);
  const flat = new Map<string, unknown>();
  for (const [key, value] of data) if (!_isTable(value)) flat.set(key, value);
  return _toRecord(flat);
}

/** Load the `[transport]` section of the config file as a plain object. */
export function loadConfigDict(): Record<string, unknown> {
  return configSeams.loadConfigDict();
}

/** Save the `[transport]` dict, preserving every other section. */
function _saveConfigDict(data: Record<string, unknown>): void {
  let full = _loadFullConfig();
  if (!full.has("transport")) {
    // Legacy flat file: keep real sections only; the root scalars are rewritten as the [transport] table.
    const sections: Table = new Map();
    for (const [key, value] of full) if (_isTable(value)) sections.set(key, value);
    full = sections;
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
  _mkdirParents(configSeams._ABX_DIR);
  const prefix = `${envVar}=`;
  const lines: string[] = [];
  let found = false;
  if (isFile(configSeams._ENV_FILE)) {
    for (const line of pySplitlines(_readText(configSeams._ENV_FILE))) {
      if (line.startsWith(prefix)) {
        lines.push(`${prefix}${value}`);
        found = true;
      } else {
        lines.push(line);
      }
    }
  }
  if (!found) lines.push(`${prefix}${value}`);
  writeTextPy(configSeams._ENV_FILE, lines.join("\n") + "\n");
  try {
    fs.chmodSync(configSeams._ENV_FILE, 0o600);
  } catch {
    /* A failing chmod (exotic filesystems) is ignored on purpose: storing a key must never fail for a permission-only reason. */
  }
}

/** Write or update `envVar` in the `~/.abx/.env` file. */
export function writeEnvVar(envVar: string, value: string): void {
  configSeams.writeEnvVar(envVar, value);
}

function _readEnvVarImpl(envVar: string): string | null {
  if (!isFile(configSeams._ENV_FILE)) return null;
  const prefix = `${envVar}=`;
  for (const line of pySplitlines(_readText(configSeams._ENV_FILE))) {
    if (line.startsWith(prefix)) return pyStrip(line.slice(line.indexOf("=") + 1));
  }
  return null;
}

/** Read `envVar` from the `~/.abx/.env` file. */
export function readEnvVar(envVar: string): string | null {
  return configSeams.readEnvVar(envVar);
}

/** Remove `envVar` from `~/.abx/.env`; the file is deleted once no entries remain. Returns whether a line was removed. */
export function removeEnvVar(envVar: string): boolean {
  if (!isFile(configSeams._ENV_FILE)) return false;
  const prefix = `${envVar}=`;
  const original = pySplitlines(_readText(configSeams._ENV_FILE));
  const kept = original.filter((line) => !line.startsWith(prefix));
  if (kept.length === original.length) return false;
  if (kept.some((line) => pyStrip(line))) writeTextPy(configSeams._ENV_FILE, kept.join("\n") + "\n");
  else _unlink(configSeams._ENV_FILE);
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
  return _KEY_ALIASES.get(key) ?? key;
}

/** The name echoed in `Set ...` lines: the key as typed, except the long-standing `api_key` alias (byte-compat). */
function _echoName(typed: string, canonical: string): string {
  return typed === "api_key" ? canonical : typed;
}

/** `extras` reads `~/.abx` through `config_layers.paths`; follow the seams when tests (or callers) moved them. */
function _syncPaths(): void {
  if (configSeams._CONFIG_FILE !== path.join(_defaultAbxDir, "config.toml")) {
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
  const cli = cliProvider();
  const pluginActive = (cli !== null && cli !== BUILTIN_PROVIDER_ID) || (providersInUse() && extras.effectiveProviderId() !== BUILTIN_PROVIDER_ID);
  if (pluginActive && !_GENERIC_KEYS.has(canonical)) {
    const target = extras.resolveExtraKey(typed);
    if (target) return target;
  }
  if (_ALLOWED_KEYS.has(canonical)) {
    return extras.configFormat() === 2 ? extras.coreTarget(canonical, _echoName(typed, canonical)) : null;
  }
  return extras.resolveExtraKey(typed);
}

/** `true` once the provider system is in play or the user migrated to the canonical names. */
function _surfaceActive(): boolean {
  _syncPaths();
  return providersInUse() || extras.configFormat() === 2;
}

/** stderr hint after a successful `set` / `delete` of a renamed legacy key (interactive terminals only). */
function _legacyKeyNote(fmt: OutputFormatter, typed: string): void {
  const canonical = _RENAMED_LEGACY.get(typed);
  if (canonical === undefined || fmt.use_json || fmt.quiet) return;
  if (!(configSeams.sys?.stderr ?? sys.stderr).isatty()) return;
  const ci = pyStrip(_env("CI") ?? "").toLowerCase();
  if (ci && !["0", "false", "no", "off"].includes(ci)) return;
  echo(`note: '${typed}' is now '${canonical}' (the old name keeps working).`, { err: true });
}

function _extraText(target: extras.ExtraTarget | undefined, value: unknown): string {
  if (target?.key?.type === "float" && typeof value === "number") return pyStr(new PyFloat(value));
  return pyStr(value);
}

function _extraDisplay(target: extras.ExtraTarget, value: unknown): string {
  const text = _extraText(target, value);
  return target.key?.secret ? _maskValue(text) : text;
}

function _extraPrompt(fmt: OutputFormatter, target: extras.ExtraTarget): Promise<string | null> {
  return _promptMissingValue(fmt, target.typed, target.key?.secret ?? false);
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
  if (key === "api_url" || key === "domain") {
    const [region] = _effectiveValue("region");
    if (key === "api_url") return `https://api.${pyStr(region)}.e2b.fc.aliyuncs.com`;
    return `${pyStr(region)}.e2b.fc.aliyuncs.com`;
  }
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
  const envName = _envOverrideName(key);
  if (envName !== null) return [process.env[envName], "env"];
  const projectValue = projectDotenvValue(_ENV_OVERRIDES.get(key) ?? []);
  if (projectValue) return [projectValue, "user"];
  const storedEnvName = _ENV_STORED_KEYS.get(key);
  if (storedEnvName !== undefined) {
    const stored = configSeams.readEnvVar(storedEnvName);
    if (stored) return [stored, "user"];
    if (_LEGACY_TOML_ENV_KEYS.has(key)) {
      const legacy = configSeams.loadConfigDict()[key];
      if (legacy !== undefined && legacy !== null && legacy !== "") return [legacy, "user"];
    }
    return [null, "unset"];
  }
  const config = configSeams.loadConfigDict();
  const storedValue = config[key];
  if (storedValue !== undefined && storedValue !== null && storedValue !== "") return [storedValue, "user"];
  const legacyToml = _LEGACY_TOML_FALLBACKS.get(key);
  if (legacyToml !== undefined) {
    const legacyValue = config[legacyToml];
    if (legacyValue !== undefined && legacyValue !== null && legacyValue !== "") return [legacyValue, "user"];
  }
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
    if (_LEGACY_TOML_ENV_KEYS.has(key)) removed = _removeTomlKey(key) || removed;
  } else {
    removed = _removeTomlKey(key);
    const legacyToml = _LEGACY_TOML_FALLBACKS.get(key);
    if (legacyToml !== undefined) removed = _removeTomlKey(legacyToml) || removed;
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
const CONFIG_HELP = [
  "Manage persistent credentials and CLI defaults.",
  "",
  "    Values are read from ~/.abx/config.toml and ~/.abx/.env. Environment",
  "    variables can still override the stored configuration at runtime.",
  "",
  "    \b",
  "    Examples:",
  "      abx config init",
  "      abx config list",
  "      abx config get region",
  "      abx config set http_timeout 120",
  "      abx config set github_token     Prompt for the token (masked input)",
  "      abx config delete region   Remove one stored value",
  "",
  "    \b",
  "    Related commands:",
  "      abx config init           Guided setup (credentials, region, ACR, LLM)",
  "      abx config get            Read one effective value",
  "      abx config set            Store or update one value",
  "      abx config delete KEY     Remove one stored value",
  "    ",
].join("\n");

const GET_HELP = [
  "Get a configuration value by KEY.",
  "",
  "    Prints the effective value: the process environment wins, then the",
  "    value stored by ``abx config set``, then the built-in default. Keys",
  "    without any of these print ``(not set)``. Sensitive keys are masked.",
  "",
  "    \b",
  "    Available keys:",
  "      sandbox_api_key    Sandbox service API key (env var ABX_SANDBOX_API_KEY;",
  "                         stored in ~/.abx/.env,",
  "                         shown masked). ``api_key`` is accepted as an alias.",
  "      access_key_id      Alibaba Cloud AccessKey ID for AK/SK auth",
  "                         (template deploy, ACR push; stored in ~/.abx/.env)",
  "      access_key_secret  Alibaba Cloud AccessKey Secret for AK/SK auth",
  "                         (template deploy, ACR push; stored in ~/.abx/.env,",
  "                         shown masked)",
  "      acr_namespace      ACR namespace for template build, push, and install",
  "                         (stored in ~/.abx/.env as ACR_NAMESPACE)",
  "      api_url            Platform API URL",
  "      domain             Envd data-plane domain",
  "      region             Default region (e.g. cn-hangzhou)",
  "      http_timeout       HTTP request timeout in seconds",
  "      http2              Enable HTTP/2 (true/false)",
  "      max_retries        Maximum retry attempts",
  "      llm_api_key        LLM API key for template generation",
  "                         (stored in ~/.abx/.env as ABX_LLM_API_KEY, shown",
  "                         masked; a legacy config.toml value is still readable)",
  "      llm_model          LLM model name (default: qwen3-coder-plus)",
  "      llm_base_url       LLM API base URL, OpenAI-compatible",
  "                         (default: DashScope compatible-mode)",
  "      github_token       GitHub token for template downloads (stored in",
  "                         ~/.abx/.env, shown masked)",
  "",
  "    \b",
  "    Examples:",
  "      abx config get sandbox_api_key",
  "      abx config get region",
  "      abx config list          # show all values at once",
  "",
  "    \b",
  "    Related commands:",
  "      abx config list          Show every effective value and its source",
  "      abx config set KEY VALUE",
  "      abx config set KEY \"\"    Clear one stored value",
  "    ",
].join("\n");

const SET_HELP = [
  "Set a configuration value: KEY [VALUE].",
  "",
  "    Settings are stored in ~/.abx/config.toml, except credentials",
  "    (sandbox_api_key, access_key_id, access_key_secret, acr_namespace,",
  "    llm_api_key, github_token) which are",
  "    written to ~/.abx/.env using their environment-variable names. Setting",
  "    llm_api_key also removes any legacy config.toml copy of it (the secret",
  "    migrates to the 0600-protected ~/.abx/.env storage).",
  "",
  "    Passing an empty VALUE clears the stored value for KEY instead: the key",
  "    falls back to its built-in default or becomes not set. An empty string",
  "    is never stored as a credential or override. Environment variables that",
  "    are still exported keep overriding the key at runtime; their values are",
  "    never printed. Clearing llm_api_key removes both the ~/.abx/.env entry",
  "    and any legacy config.toml copy.",
  "",
  "    In an interactive terminal VALUE may be omitted: sensitive keys",
  "    (github_token, sandbox_api_key, access_key_secret, llm_api_key) are then",
  "    read through the masked (asterisk) input and the typed value is never",
  "    echoed; other keys use a visible prompt. Pressing Enter at the prompt",
  "    cancels without changing anything. In CI / non-interactive sessions",
  "    VALUE is required.",
  "",
  "    \b",
  "    Available keys (expected value):",
  "      sandbox_api_key    Sandbox service API key (string; env var",
  "                         ABX_SANDBOX_API_KEY).",
  "                         ``api_key`` is accepted as an alias.",
  "      access_key_id      Alibaba Cloud AccessKey ID for AK/SK auth, used by",
  "                         template deploy and ACR push (string)",
  "      access_key_secret  Alibaba Cloud AccessKey Secret for AK/SK auth, used by",
  "                         template deploy and ACR push (string)",
  "      acr_namespace      ACR namespace for template build, push, and install",
  "                         (string; stored in ~/.abx/.env as ACR_NAMESPACE)",
  "      api_url            Platform API URL (e.g. https://api.cn-hangzhou.e2b.fc.aliyuncs.com)",
  "      domain             Envd data-plane domain (e.g. cn-hangzhou.e2b.fc.aliyuncs.com)",
  "      region             Default region (e.g. cn-hangzhou, cn-shanghai)",
  "      http_timeout       HTTP request timeout in seconds (number, e.g. 120)",
  "      http2              Enable HTTP/2 (true/false)",
  "      max_retries        Maximum retry attempts (integer, e.g. 3)",
  "      llm_api_key        LLM API key for template generation,",
  "                         e.g. a DashScope/ModelStudio key (string; stored in",
  "                         ~/.abx/.env as ABX_LLM_API_KEY)",
  "      llm_model          LLM model name (default: qwen3-coder-plus)",
  "      llm_base_url       LLM API base URL, OpenAI-compatible (string;",
  "                         default: DashScope compatible-mode)",
  "      github_token       GitHub token for template downloads, used by",
  "                         'abx template install' / 'abx template search'",
  "                         (string; stored in ~/.abx/.env)",
  "",
  "    \b",
  "    Examples:",
  "      abx config set sandbox_api_key YOUR_API_KEY",
  "      abx config set access_key_id YOUR_ACCESS_KEY_ID",
  "      abx config set access_key_secret YOUR_ACCESS_KEY_SECRET",
  "      abx config set acr_namespace YOUR_ACR_NAMESPACE",
  "      abx config set region cn-hangzhou",
  "      abx config set http_timeout 120",
  "      abx config set http2 false",
  "      abx config set llm_api_key YOUR_DASHSCOPE_OR_LLM_KEY",
  "      abx config set region \"\"          # clear the stored region",
  "      abx config set sandbox_api_key \"\"  # remove the stored sandbox API key",
  "      abx config set github_token      # masked prompt (VALUE omitted)",
  "      abx config set github_token YOUR_GITHUB_TOKEN",
  "      abx config set github_token \"\"    # remove the stored token",
  "",
  "    \b",
  "    Related commands:",
  "      abx config get KEY       Verify the effective value",
  "      abx config list          Review effective values and sources",
  "      abx config delete KEY    Remove one stored value",
  "    ",
].join("\n");

const DELETE_HELP = [
  "Remove one stored configuration value.",
  "",
  "    Deletes the value written by ``abx config set``. The key then falls",
  "    back to its built-in default or becomes not set. An environment",
  "    variable that still overrides the key is left in place and named in",
  "    the result, without printing its value. ``~/.abx`` itself is not",
  "    removed. ``abx config set KEY \"\"`` does the same thing.",
  "",
  "    \b",
  "    Examples:",
  "      abx config delete acr_namespace",
  "      abx config delete access_key_secret",
  "",
  "    \b",
  "    Related commands:",
  "      abx config list          See what is still stored",
  "      abx config set KEY VALUE Store a value again",
  "      abx config set KEY \"\"    The same removal, via set",
  "    ",
].join("\n");

const LIST_HELP = [
  "List all effective configuration values and their sources.",
  "",
  "    Values are grouped by function — Sandbox authentication, Alibaba",
  "    Cloud credentials, connection, LLM and integrations —",
  "    in a stable order. Group titles are",
  "    display-only: ``config get`` and ``config set`` keep taking the bare",
  "    key names, and ``--json`` output stays a flat ``{key: value}`` map.",
  "",
  "    Sources: ``(env)`` a process environment variable, ``(user)`` a value",
  "    in ``./.env`` or stored with ``abx config set``, ``(default)`` a",
  "    built-in default, and ``(not set)`` when no value exists anywhere.",
  "    A set environment variable wins over either file. ``./.env`` wins",
  "    over ``~/.abx`` for a key it sets; a key it omits still comes from",
  "    ``~/.abx``. Sensitive values are always masked.",
  "",
  "    \b",
  "    Examples:",
  "      abx config list",
  "      abx --json config list",
  "      abx config get http_timeout",
  "",
  "    \b",
  "    Related commands:",
  "      abx config get KEY        Inspect one effective value",
  "      abx config set KEY VALUE",
  "      abx config delete KEY     Remove one stored value",
  "    ",
].join("\n");

const INIT_HELP = [
  "Guided setup: credentials and region (add --build / --llm for the rest).",
  "",
  "    The default flow asks only what every command needs: the platform API",
  "    key and the default region. Press Enter to skip a prompt. Secrets are",
  "    typed with asterisk feedback (never echoed) when the terminal supports",
  "    it and stored in ~/.abx/.env; the region goes to ~/.abx/config.toml.",
  "",
  "    ``--build`` adds the template build & push settings: the ACR namespace",
  "    and the Alibaba Cloud AccessKey pair (needed by ``abx template",
  "    install``, ``build``, ``push`` and ``deploy``).",
  "",
  "    ``--llm`` adds the LLM API key used for template generation",
  "    (``abx create \"<description>\"``, ``abx template init \"<description>\"``).",
  "",
  "    Features that need those settings print a pointer to ``abx config init",
  "    --build`` / ``--llm`` when they are missing; nothing asks for them up",
  "    front.",
  "",
  "    In non-TTY environments (CI, piped input) the wizard never blocks: it",
  "    prints the equivalent non-interactive ``abx config set ...`` commands",
  "    and exits successfully. ``--yes`` behaves the same way.",
  "",
  "    \b",
  "    Examples:",
  "      abx config init                 # credentials + region",
  "      abx config init --build         # ... plus ACR namespace and AccessKey",
  "      abx config init --llm           # ... plus the LLM API key",
  "      abx config init --yes           # print non-interactive commands",
  "",
  "    \b",
  "    Related commands:",
  "      abx config list           Review effective values and sources",
  "      abx config set KEY VALUE  Set one value directly",
  "      abx config set KEY \"\"     Clear one stored value",
  "    ",
].join("\n");


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
        _legacyKeyNote(fmt, typedKey);
        return;
      }
      extras.writeExtra(extra, value);
      fmt.printSuccess(`Set ${extra.typed} = ${extra.key?.secret ? _maskValue(value) : value}`);
      _legacyKeyNote(fmt, typedKey);
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
      _legacyKeyNote(fmt, typedKey);
      return;
    }

    const envVar = _ENV_STORED_KEYS.get(key);
    if (envVar !== undefined) {
      configSeams.writeEnvVar(envVar, value);
      if (_LEGACY_TOML_ENV_KEYS.has(key)) {
        // After this write the secret lives only in the 0600-protected ~/.abx/.env storage, never in two places.
        _removeTomlKey(key);
      }
      const displayValue = _SENSITIVE_KEYS.has(key) ? _maskValue(value) : value;
      fmt.printSuccess(`Set ${echoKey} = ${displayValue}`);
      _legacyKeyNote(fmt, typedKey);
      return;
    }

    const data = configSeams.loadConfigDict();
    const legacyToml = _LEGACY_TOML_FALLBACKS.get(key);
    if (legacyToml !== undefined) delete data[legacyToml];

    if (key === "http_timeout") {
      const parsed = _pyFloatParse(value);
      if (parsed === null) {
        fmt.printError(`Invalid numeric value: ${pyStrRepr(value)}`);
        return sysExit(2);
      }
      data[key] = new PyFloat(parsed);
    } else if (key === "max_retries") {
      const parsed = _pyIntParse(value);
      if (parsed === null) {
        fmt.printError(`Invalid integer value: ${pyStrRepr(value)}`);
        return sysExit(2);
      }
      data[key] = parsed;
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
    _legacyKeyNote(fmt, typedKey);
  }),
});

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
      _legacyKeyNote(fmt, typedKey);
      return;
    }
    if (!_ALLOWED_KEYS.has(key)) return _rejectUnknownKey(fmt, key);
    _clearStoredValue(fmt, key, _echoName(typedKey, key));
    _legacyKeyNote(fmt, typedKey);
  }),
});

const _CANONICAL_LIST_NAMES: ReadonlyMap<string, string> = new Map([
  ["api_url", "sandbox_base_url"],
  ["domain", "sandbox_domain"],
]);

const _ACR_GROUP_KEYS = [
  "acr_registry", "acr_repo", "acr_username", "acr_password", "acr_instance_id", "acr_vpc_id", "acr_vswitch_ids",
  "acr_security_group_id", "team_id",
];

/** Extra groups (and the targets behind their keys) for the provider-aware listing. */
function _extraListGroups(showAll: boolean): { groups: Array<[string, string[]]>; targets: Map<string, extras.ExtraTarget>; dropBuiltinCreds: boolean } {
  _syncPaths();
  const groups: Array<[string, string[]]> = [];
  const targets = new Map<string, extras.ExtraTarget>();
  const eff = extras.effectiveProviderId();
  const plugin = eff !== BUILTIN_PROVIDER_ID;
  if (extras.configFormat() === 2) {
    for (const name of _ALLOWED_KEYS.keys()) {
      const target = extras.coreTarget(name, name);
      if (target !== null) targets.set(name, target);
    }
  }
  if (providersInUse()) {
    targets.set("provider", extras.resolveExtraKey("provider") as extras.ExtraTarget);
    groups.push(["Provider", ["provider"]]);
  }
  if (!plugin) {
    const acr: string[] = [];
    let anySet = false;
    for (const name of _ACR_GROUP_KEYS) {
      const target = extras.resolveExtraKey(`providers.${BUILTIN_PROVIDER_ID}.${name}`) as extras.ExtraTarget;
      targets.set(name, target);
      acr.push(name);
      if (extras.readExtra(target).source !== "unset") anySet = true;
    }
    if (anySet || showAll) groups.push(["Alibaba Cloud registry (ACR)", acr]);
    else for (const name of acr) targets.delete(name);
  } else {
    const provider = registry.getProvider(eff);
    const keys = provider.configKeys();
    const name = provider.displayName || eff;
    const creds = keys.filter((k) => k.credential || k.secret);
    const rest = keys.filter((k) => !(k.credential || k.secret));
    for (const [title, list] of [[`${name} credentials`, creds], [`${name} options`, rest]] as const) {
      if (!list.length) continue;
      for (const k of list) targets.set(k.key, extras.resolveExtraKey(`providers.${eff}.${k.key}`) as extras.ExtraTarget);
      groups.push([title, list.map((k) => k.key)]);
    }
  }
  return { groups, targets, dropBuiltinCreds: plugin };
}

export const list_config = command("list", {
  help: LIST_HELP,
  params: [
    option(["--legacy-names"], { is_flag: true, hidden: !_surfaceActive(), help: "Print the old key names (api_url, domain) instead of the canonical ones" }),
    option(["--all", "show_all"], { is_flag: true, hidden: !_surfaceActive(), help: "Also list provider keys that have no value" }),
  ],
  callback: _handleErrors(async (ctx: Context, params: Params) => {
    const fmt = getFormatter(ctx);
    const legacyFlag = ["1", "true", "yes", "on"].includes(pyStrip(_env("ABX_CONFIG_LEGACY_NAMES") ?? "").toLowerCase());
    const canonicalNames = _surfaceActive() && extras.configFormat() === 2 && !params["legacy_names"] && !legacyFlag;
    const shown = (key: string): string => (canonicalNames ? (_CANONICAL_LIST_NAMES.get(key) ?? key) : key);
    const extra = _extraListGroups(Boolean(params["show_all"]));

    // Stable order: the functional groups, then any key the groups do not cover yet (so a new key is never invisible).
    const grouped: Array<[string, readonly string[]]> = _CONFIG_GROUPS.filter(([, keys]) => keys.length)
      .filter(([title]) => !(extra.dropBuiltinCreds && title === "Alibaba Cloud credentials"))
      .map(([title, keys]) => [title, keys]);
    const covered = new Set<string>();
    for (const [, keys] of grouped) for (const key of keys) covered.add(key);
    const leftover = [..._ALLOWED_KEYS.keys()].filter((k) => !covered.has(k) && !(extra.dropBuiltinCreds && ["region"].includes(k)));
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
    const sensitive = (key: string): boolean => extra.targets.has(key) ? Boolean(extra.targets.get(key)?.key?.secret) : _SENSITIVE_KEYS.has(key);

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
function _printNoninteractiveSetup(opts: { build: boolean; llm: boolean }): void {
  const lines = [
    "Non-interactive setup. Run these commands to configure abx:",
    "",
    "  abx config set sandbox_api_key <ABX_SANDBOX_API_KEY>",
    "  abx config set region cn-hangzhou",
  ];
  if (opts.build) {
    lines.push(
      "",
      "  # Template build, push and install:",
      "  abx config set acr_namespace <ACR_NAMESPACE>",
      "  abx config set access_key_id <ALICLOUD_ACCESS_KEY_ID>",
      "  abx config set access_key_secret <ALICLOUD_ACCESS_KEY_SECRET>",
    );
  }
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
  const env = ["ABX_SANDBOX_API_KEY"];
  if (opts.llm) env.push("ABX_LLM_API_KEY");
  if (opts.build) env.push("ACR_NAMESPACE", "ALICLOUD_ACCESS_KEY_ID", "ALICLOUD_ACCESS_KEY_SECRET");
  lines.push("", `Environment variables (${env.join(", ")}) override stored values.`);
  if (!opts.build || !opts.llm) {
    const more: string[] = [];
    if (!opts.build) more.push("template build/push: 'abx config init --build'");
    if (!opts.llm) more.push("template generation: 'abx config init --llm'");
    lines.push(`More settings: ${more.join("; ")}.`);
  }
  for (const line of lines) echo(line);
}

export const init = command("init", {
  help: INIT_HELP,
  params: [
    option(["--yes", "-y"], { is_flag: true, help: "Non-interactive: print the equivalent commands instead of prompting" }),
    option(["--build"], { is_flag: true, help: "Also ask for the template build & push settings (ACR namespace, AccessKey)" }),
    option(["--llm"], { is_flag: true, help: "Also ask for the LLM API key used for template generation" }),
  ],
  callback: _handleErrors(async (ctx: Context, params: Params) => {
    const fmt = getFormatter(ctx);
    const build = Boolean(params["build"]);
    const llm = Boolean(params["llm"]);

    // Never block in CI / piped sessions.
    if (params["yes"] || !_stdin().isatty()) {
      _printNoninteractiveSetup({ build, llm });
      return;
    }

    const total = 2 + (build ? 3 : 0) + (llm ? 1 : 0);
    let step = 0;
    const label = (text: string): string => `${++step}/${total} ${text}`;

    echo("abx guided configuration (press Enter to keep the current value or skip):");
    echo();

    const apiKey = await configSeams._promptSecret(label("Sandbox API key (sandbox_api_key / ABX_SANDBOX_API_KEY, input masked)"));
    if (pyStrip(apiKey)) {
      configSeams.writeEnvVar("ABX_SANDBOX_API_KEY", pyStrip(apiKey));
      fmt.printSuccess("Stored sandbox_api_key in ~/.abx/.env");
    }

    const data = configSeams.loadConfigDict();
    const currentRegion = pyStr(data["region"] || "cn-hangzhou");
    const region = (await prompt(label("Region"), { default: currentRegion, show_default: true })) as string;
    if (pyStrip(region)) {
      data["region"] = pyStrip(region);
      _saveConfigDict(data);
      fmt.printSuccess(`Set region = ${pyStrip(region)}`);
    }

    if (build) {
      const [currentNs] = _effectiveValue("acr_namespace");
      const namespace = (await prompt(label("ACR namespace (needed by abx template install / build / deploy)"), {
        default: currentNs ? pyStr(currentNs) : "",
        show_default: Boolean(currentNs),
      })) as string;
      if (pyStrip(namespace)) {
        configSeams.writeEnvVar("ACR_NAMESPACE", pyStrip(namespace));
        fmt.printSuccess(`Set acr_namespace = ${pyStrip(namespace)}`);
      }

      const accessKeyId = (await prompt(label("Alibaba Cloud AccessKey ID (template deploy / ACR push)"), {
        default: "",
        show_default: false,
      })) as string;
      if (pyStrip(accessKeyId)) {
        configSeams.writeEnvVar("ALICLOUD_ACCESS_KEY_ID", pyStrip(accessKeyId));
        fmt.printSuccess("Stored access_key_id in ~/.abx/.env");
      }

      const accessKeySecret = await configSeams._promptSecret(label("Alibaba Cloud AccessKey Secret (input masked)"));
      if (pyStrip(accessKeySecret)) {
        configSeams.writeEnvVar("ALICLOUD_ACCESS_KEY_SECRET", pyStrip(accessKeySecret));
        fmt.printSuccess("Stored access_key_secret in ~/.abx/.env");
      }
    }

    if (llm) {
      const llmKey = await configSeams._promptSecret(label("LLM API key (DashScope/ModelStudio, input masked)"));
      if (pyStrip(llmKey)) {
        configSeams.writeEnvVar("ABX_LLM_API_KEY", pyStrip(llmKey));
        // Same migration as `abx config set llm_api_key`: drop any legacy plaintext copy in config.toml.
        _removeTomlKey("llm_api_key");
        fmt.printSuccess("Stored llm_api_key in ~/.abx/.env");
      }
    }

    echo();
    fmt.printSuccess("Configuration complete. Review it with 'abx config list'.");
    if (!build || !llm) {
      const more: string[] = [];
      if (!build) more.push("template build/push: 'abx config init --build'");
      if (!llm) more.push("template generation: 'abx config init --llm'");
      echo(`More settings: ${more.join("; ")}.`);
    }
  }),
});

const CHECK_HELP = [
  "Report legacy names in use and their canonical replacements.",
  "",
  "    Looks at the process environment, ./.env, ~/.abx/.env and",
  "    ~/.abx/config.toml. Only names are shown, never values. E2B_* and",
  "    provider-native names (ALICLOUD_ACCESS_KEY_ID, ...) are not reported.",
  "    With --strict the exit code is 1 when anything is found.",
  "",
  "    \b",
  "    Examples:",
  "      abx config check",
  "      abx --json config check --strict",
  "",
  "    \b",
  "    Related commands:",
  "      abx config migrate       Rewrite stored names to the canonical ones",
  "    ",
].join("\n");

const MIGRATE_HELP = [
  "Rewrite stored names to the canonical names (config_format = 2).",
  "",
  "    Renames entries in ~/.abx/config.toml and ~/.abx/.env, keeps",
  "    config.toml.bak and .env.bak (mode 0600) and sets [core] config_format = 2.",
  "    Older abx / agent-sandbox versions no longer read the migrated values.",
  "    Without --yes a confirmation is required (not possible without a",
  "    terminal: exit code 2). --dry-run prints the plan and changes nothing.",
  "",
  "    \b",
  "    Examples:",
  "      abx config migrate --dry-run",
  "      abx config migrate --yes",
  "    ",
].join("\n");

function _whereLabel(where: string): string {
  return where === "dotenv" ? "dotenv" : where;
}

export const check_config = command("check", {
  help: CHECK_HELP,
  hidden: !_surfaceActive(),
  params: [option(["--strict"], { is_flag: true, help: "Exit with 1 when a legacy name is in use" })],
  callback: _handleErrors(async (ctx: Context, params: Params) => {
    _syncPaths();
    const fmt = getFormatter(ctx);
    const findings = auditConfig().map(({ path: _path, ...rest }) => rest);
    if (fmt.use_json) {
      fmt.printData(findings.map((f) => new Map<string, unknown>(Object.entries(f))));
    } else if (!fmt.quiet) {
      if (!findings.length) {
        fmt.printSuccess("No legacy names in use.");
      } else {
        const width = Math.max(27, ...findings.map((f) => (f.where === "config" ? `[transport] ${f.name.replace(/^transport\./, "")}` : f.name).length));
        for (const f of findings) {
          const label = f.where === "config" ? `[transport] ${f.name.replace(/^transport\./, "")}` : f.name;
          const target = f.where === "config" ? f.canonical_key : `${f.canonical_name} (${f.canonical_key})`;
          echo(`${ljust(_whereLabel(f.where), 8)} ${ljust(label, width)} -> ${target}`);
        }
      }
    }
    if (params["strict"] && findings.length) return sysExit(1);
  }),
});

export const migrate_config = command("migrate", {
  help: MIGRATE_HELP,
  hidden: !_surfaceActive(),
  params: [
    option(["--yes", "-y"], { is_flag: true, help: "Do not ask for confirmation" }),
    option(["--dry-run"], { is_flag: true, help: "Print the plan, change nothing" }),
  ],
  callback: _handleErrors(async (ctx: Context, params: Params) => {
    _syncPaths();
    const fmt = getFormatter(ctx);
    const plan = planMigration();
    const onlyFormat = plan.length === 1 && plan[0]?.action === "set" && extras.configFormat() === 2;
    const describe = (item: (typeof plan)[number]): string => {
      if (item.action === "set") return `set ${item.to} = ${pyStr(item.value)}`;
      if (item.action === "drop") return `drop ${item.from} (${item.to} is already set)`;
      return `rename ${item.from} -> ${item.to}`;
    };
    if (onlyFormat) {
      fmt.printSuccess("Nothing to migrate: already using the canonical names.");
      return;
    }
    if (params["dry_run"]) {
      if (fmt.use_json) fmt.printData(plan.map((i) => new Map<string, unknown>(Object.entries(i))));
      else for (const item of plan) echo(`would ${describe(item)}`);
      return;
    }
    if (!params["yes"]) {
      let interactive = false;
      try {
        interactive = _stdin().isatty();
      } catch {
        interactive = false;
      }
      if (!interactive || fmt.use_json || fmt.quiet) {
        fmt.printError("Refusing to rewrite the configuration without confirmation.", {
          suggestion: "Review it with 'abx config migrate --dry-run', then re-run with --yes.",
        });
        return sysExit(2);
      }
      for (const item of plan) echo(`will ${describe(item)}`);
      const { confirm } = await import("../prompts.js");
      if (!(await confirm("Rewrite ~/.abx/config.toml and ~/.abx/.env now? Older versions will not read the migrated values", { default: false }))) {
        fmt.printSuccess("Cancelled; nothing was changed.");
        return;
      }
    }
    const done = applyMigration();
    if (fmt.use_json) fmt.printData(done.map((i) => new Map<string, unknown>(Object.entries(i))));
    else fmt.printSuccess(`Migrated ${done.length - 1} stored name(s); config_format = 2. Backups: config.toml.bak, .env.bak.`);
  }),
});

config.addCommand(get);
config.addCommand(set_value);
config.addCommand(delete_value);
config.addCommand(list_config);
config.addCommand(init);
config.addCommand(check_config);
config.addCommand(migrate_config);

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
  write(promptText);
  const chars: string[] = [];
  const loop = async (read: () => string | Promise<string>): Promise<string> => {
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
  return String(await prompt(promptText, { hide_input: true, default: "", show_default: false }));
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
  let interactive: boolean;
  try {
    interactive = _stdin().isatty();
  } catch {
    interactive = false;
  }

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

  let entered: string;
  if (sensitive || _SENSITIVE_KEYS.has(key)) {
    entered = await configSeams._promptSecret(`${key} (input masked; press Enter to cancel)`);
  } else {
    entered = (await prompt(key, { default: "", show_default: false })) as string;
  }
  if (pyStrip(entered) === "") {
    fmt.printSuccess(`No value entered; ${key} was not changed.`);
    return null;
  }
  return entered;
}
