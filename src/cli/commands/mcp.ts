import { MCP_CLIENT_PIP_SPEC, MCP_SERVER_PIP_SPEC } from "../../utils/mcp_sdk_pin.js";
/**
 * MCP Server CLI commands: install, start, stop, status, deploy (port of `cli/commands/mcp.py`).
 *
 * Module-level functions that the Python tests monkeypatch (`_read_api_key`, `_pid_alive`, `_running_server`, ...) are
 * called through this module's own namespace (`self.<fn>`) so `vi.spyOn(mcpModule, "_readApiKey")` reaches the
 * internal call sites. The OS-level pieces (`os.kill`, `subprocess.Popen`, `time.sleep`, `time.monotonic`,
 * `platform.system`) live on the mutable {@link mcpSeams} object; the IDE path table can be replaced with
 * {@link _setIdeConfigMap} (Python: `patch("...mcp._IDE_CONFIG_MAP", {...})`).
 */

import { spawn } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import type * as net from "node:net";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";

import { type Context, command, group, option } from "../kit.js";
import { Choice, INT, Path } from "../types.js";
import { CliError, sysExit } from "../errors.js";
import { echo } from "../io.js";
import { TOOL_SCHEMAS } from "../../agent/tools.js";
import { JSONDecodeError, pyJsonLoads } from "../../agent/_py.js";
import { dumpYaml } from "../../utils/yaml_io.js";
import { pyPathStr, which } from "../../agent/_pycompat.js";
import { loadConfig, resetConfig } from "../../transport/config.js";
import { loadLayeredConfig } from "../../transport/config_layers.js";
import { getOperationConfig } from "../../utils/operation_config.js";
import { withGuidedConfiguration, canGuideConfiguration } from "../config_guidance.js";
import { confirm } from "../prompts.js";
import { getOutput } from "../output.js";
import {
  OSError as PyOSError,
  UnicodeDecodeError,
  _utf8DecodeError,
  isFile,
  mkdirParents,
  toOSError,
  writeTextPy,
} from "../../utils/_pyos.js";
import { PyFloat, pyJsonDumps, pySorted, pyStr, pyStrRepr, pyStrip } from "../../utils/_pyformat.js";
import { getFormatter } from "../formatters.js";
import { handleErrors } from "../error_handler.js";
import { regionOption } from "../region.js";
import { cliProvider } from "../../providers/selection.js";
import { getProvider, resolveProviderId } from "../../providers/registry.js";
import { BUILTIN_PROVIDER_ID } from "../../utils/config_keys.js";
import * as self from "./mcp.js";

// ---------------------------------------------------------------------------
// Seams
// ---------------------------------------------------------------------------

/** What `subprocess.Popen` returns, reduced to what the background launcher needs. */
export interface PopenLike {
  pid: number;
  /** `Popen.poll()`: `null` while running, otherwise the exit status. */
  poll(): number | null;
}

export interface PopenOptions {
  env: Record<string, string>;
  /** File descriptor of the (already opened) log file; used for stdout and stderr. */
  logFd: number;
}

/** Mutable OS-level seams (Python: `os.kill`, `subprocess.Popen`, `time.*`, `platform.system`). */
export const mcpSeams = {
  kill(pid: number, signal: NodeJS.Signals | number): void {
    process.kill(pid, signal);
  },
  async popen(command_: string[], opts: PopenOptions): Promise<PopenLike> {
    const [file, ...args] = command_ as [string, ...string[]];
    const child = spawn(file, args, {
      env: opts.env,
      stdio: ["ignore", opts.logFd, opts.logFd],
      detached: true,
      windowsHide: true,
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    }).catch((e: unknown) => {
      throw toOSError(e, file);
    });
    child.unref();
    return {
      pid: child.pid as number,
      poll: () => (child.exitCode !== null ? child.exitCode : child.signalCode !== null ? -1 : null),
    };
  },
  sleep(seconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  },
  monotonic(): number {
    return performance.now() / 1000;
  },
  /** `platform.system()`. */
  system(): "Darwin" | "Windows" | "Linux" {
    return process.platform === "darwin" ? "Darwin" : process.platform === "win32" ? "Windows" : "Linux";
  },
};

// ---------------------------------------------------------------------------
// IDE config paths
// ---------------------------------------------------------------------------

/** `Path.home()`. */
function _home(): string {
  return os.homedir();
}

/** Get the Cursor MCP config file path. */
export function _getCursorConfigPath(): string {
  return path.join(_home(), ".cursor", "mcp.json");
}

/** Get the Claude Desktop config file path. */
export function _getClaudeConfigPath(): string {
  const system = mcpSeams.system();
  if (system === "Darwin") {
    return path.join(_home(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  } else if (system === "Windows") {
    return path.join(process.env["APPDATA"] ?? "", "Claude", "claude_desktop_config.json");
  }
  return path.join(_home(), ".config", "claude", "claude_desktop_config.json");
}

/**
 * Get the VS Code workspace MCP config path.
 *
 * VS Code reads `.vscode/mcp.json` with a top-level `servers` object. This file is workspace-scoped, so the installer
 * does not copy the API key into it.
 */
export function _getVscodeConfigPath(): string {
  return path.join(process.cwd(), ".vscode", "mcp.json");
}

export type IdeConfigMap = Record<string, () => string>;

export let _IDE_CONFIG_MAP: IdeConfigMap = {
  cursor: _getCursorConfigPath,
  claude: _getClaudeConfigPath,
  vscode: _getVscodeConfigPath,
};

/** Test seam: replace the whole IDE table (Python: `patch("...mcp._IDE_CONFIG_MAP", map)`). */
export function _setIdeConfigMap(map: IdeConfigMap): void {
  _IDE_CONFIG_MAP = map;
}

/**
 * Read the sandbox API key with the same order the SDK uses.
 *
 * Process environment, then `./.env`, then `~/.abx/.env`, then `sandbox_api_key` in `~/.abx/config.toml`.
 * The sandbox key is `ABX_SANDBOX_API_KEY`.
 */
export function _readApiKey(): string | null {
  resetConfig();
  return _mcpConfig().sandbox_api_key;
}

function _mcpConfig() {
  return loadLayeredConfig({ provider: resolveProviderId(cliProvider()) });
}

/** Setup is optional for offline registration/artifacts; protocol start never reads terminal answers. */
async function _withOptionalMcpSetup<T>(ctx: Context, operation: string, action: () => Promise<T>): Promise<T> {
  const provider = getProvider(resolveProviderId(cliProvider()));
  let configured = provider.id === BUILTIN_PROVIDER_ID ? Boolean(self._readApiKey()) : true;
  if (provider.id !== BUILTIN_PROVIDER_ID) {
    try { provider.validateConfig(loadLayeredConfig({ provider: provider.id })); } catch { configured = false; }
  }
  if (!configured) {
    if (canGuideConfiguration(ctx) && await confirm(`Configure Sandbox access for ${operation} now? You can also configure it later.`, { default: true, err: true })) {
      return withGuidedConfiguration(ctx, { operation, provider: provider.id,
        requirements: provider.id === BUILTIN_PROVIDER_ID ? ["sandbox_api_key"] : undefined,
        validateProvider: provider.id !== BUILTIN_PROVIDER_ID,
      }, action);
    }
    getOutput(ctx).info(`Sandbox access is not configured. Registration/artifact generation can continue offline; configure it later with '${provider.id === BUILTIN_PROVIDER_ID ? "abx config set sandbox_api_key" : `abx provider config ${provider.id} init`}'. This does not verify that the service is ready.`);
  }
  return action();
}

/** `[command, ...args]` that re-runs this very CLI (what Python spells `sys.executable -m agent_sandbox.cli.main`). */
function _selfCommand(options: { execArgv: boolean }): string[] {
  if (_isSea()) return [process.execPath];
  const entry = process.argv[1];
  if (entry === undefined || entry === "") return [];
  let resolved = entry;
  try {
    resolved = fs.realpathSync(entry);
  } catch {
    resolved = path.resolve(entry);
  }
  const execArgv = options.execArgv || /\.[cm]?tsx?$/.test(resolved) ? process.execArgv : [];
  return [process.execPath, ...execArgv, resolved];
}

function _isSea(): boolean {
  try {
    const sea = createRequire(import.meta.url)("node:sea") as { isSea?: () => boolean };
    return Boolean(sea.isSea?.());
  } catch {
    return false;
  }
}

/**
 * Return a command the IDE can execute without relying on a login PATH.
 *
 * The Python CLI prefers the `abx` script next to its interpreter (an absolute shebang), then `abx` on PATH, then
 * `python -m agent_sandbox.cli.main`. A Node install has no equivalent absolute launcher (`abx` is a
 * `#!/usr/bin/env node` script that needs `node` on PATH, and Windows only has `.cmd` shims), so the first choice is the
 * running runtime itself: the single-file binary, or `node <this entry script>`. `abx` on PATH is the fallback.
 */
export function _resolveMcpLaunch(): [string, string[]] {
  const self_ = _selfCommand({ execArgv: false });
  if (self_.length > 0) return [self_[0] as string, [...self_.slice(1), "mcp", "start"]];
  const found = which("abx");
  if (found) return [found, ["mcp", "start"]];
  return ["abx", ["mcp", "start"]];
}

/** The non-built-in provider chosen by `--provider` or `ABX_PROVIDER` for this invocation, if any (the config default is read by the server itself). */
export function _selectedPlugin(): string | null {
  const id = resolveProviderId(cliProvider());
  return id && id !== BUILTIN_PROVIDER_ID ? id : null;
}

/** Build the MCP server configuration block. */
export function _buildMcpServerConfig(): PyDict {
  const plugin = _selectedPlugin();
  if (plugin !== null) {
    // The server reads the plugin's options from ~/.abx itself; no credential is written into the client's config file.
    const [pluginCommand, pluginArgs] = _resolveMcpLaunch();
    return _dictOf([
      ["command", pluginCommand],
      ["args", pluginArgs],
      ["env", new Map([["ABX_PROVIDER", plugin]]) as PyDict],
    ]);
  }
  const envBlock: PyDict = new Map();
  // All IDEs read credentials through the CLI's configured sources instead of copying secrets into IDE files.
  const effective = _mcpConfig();
  const apiUrl = effective.sandbox_base_url;
  if (apiUrl) envBlock.set("ABX_SANDBOX_BASE_URL", apiUrl);
  if (effective.sandbox_domain) envBlock.set("ABX_SANDBOX_DOMAIN", effective.sandbox_domain);
  const region = effective.region;
  if (region) envBlock.set("ALIBABA_CLOUD_REGION_ID", region);

  const [command_, args] = _resolveMcpLaunch();
  const config: PyDict = _dictOf([
    ["command", command_],
    ["args", args],
  ]);
  if (envBlock.size > 0) config.set("env", envBlock);
  return config;
}

/** `Path.read_text()` (strict UTF-8 with CPython's `UnicodeDecodeError` text, universal newlines). */
function readTextPy(file: string): string {
  let buf: Buffer;
  try {
    buf = fs.readFileSync(file);
  } catch (e) {
    throw toOSError(e, file);
  }
  const problem = _utf8DecodeError(buf);
  if (problem !== null) throw new UnicodeDecodeError(problem);
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf).replace(/\r\n?/g, "\n");
}

/** A parsed JSON document with Python's types: objects are `Map`s (insertion order), floats are {@link PyFloat}. */
export type PyJson = null | boolean | number | bigint | string | PyFloat | PyJson[] | Map<string, PyJson>;
export type PyDict = Map<string, PyJson>;

const _NUMBER_RE = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?/y;

/** Builds the value of a document `pyJsonLoads` already accepted (so no error handling is needed here). */
function _buildJson(text: string): PyJson {
  let i = 0;
  const ws = (): void => {
    while (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r") i++;
  };
  const string = (): string => {
    const start = i;
    i++;
    while (text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const value = (): PyJson => {
    ws();
    const ch = text[i];
    if (ch === "{") {
      i++;
      const obj: PyDict = new Map();
      ws();
      if (text[i] === "}") {
        i++;
        return obj;
      }
      for (;;) {
        ws();
        const key = string();
        ws();
        i++; // ':'
        obj.set(key, value());
        ws();
        if (text[i++] === "}") return obj;
      }
    }
    if (ch === "[") {
      i++;
      const arr: PyJson[] = [];
      ws();
      if (text[i] === "]") {
        i++;
        return arr;
      }
      for (;;) {
        arr.push(value());
        ws();
        if (text[i++] === "]") return arr;
      }
    }
    if (ch === '"') return string();
    if (text.startsWith("true", i)) return (i += 4), true;
    if (text.startsWith("false", i)) return (i += 5), false;
    if (text.startsWith("null", i)) return (i += 4), null;
    if (text.startsWith("NaN", i)) return (i += 3), new PyFloat(Number.NaN);
    if (text.startsWith("Infinity", i)) return (i += 8), new PyFloat(Infinity);
    if (text.startsWith("-Infinity", i)) return (i += 9), new PyFloat(-Infinity);
    _NUMBER_RE.lastIndex = i;
    const m = _NUMBER_RE.exec(text) as RegExpExecArray;
    i += m[0].length;
    if (m[1] !== undefined || m[2] !== undefined) return new PyFloat(Number(m[0]));
    const n = Number(m[0]);
    return Number.isSafeInteger(n) ? n : BigInt(m[0]);
  };
  return value();
}

/** `json.loads(text)`: CPython's errors, then a value tree that keeps key order and the int/float distinction. */
export function _jsonLoads(text: string): PyJson {
  pyJsonLoads(text);
  return _buildJson(text);
}

const _isDict = (v: unknown): v is PyDict => v instanceof Map;

function _dictOf(entries: Array<[string, PyJson]>): PyDict {
  return new Map(entries);
}

function _isOsError(exc: unknown): boolean {
  if (exc instanceof PyOSError) return true;
  const code = (exc as NodeJS.ErrnoException | null)?.code;
  return exc instanceof Error && typeof code === "string" && /^E[A-Z0-9]+$/.test(code);
}

function _errText(exc: unknown): string {
  return exc instanceof Error ? exc.message : String(exc);
}

/** Load a JSON object, refusing to continue when the file is not strict JSON. */
export function _readJsonObject(configPath: string): PyDict {
  if (!isFile(configPath)) return new Map();
  let loaded: PyJson;
  try {
    loaded = _jsonLoads(readTextPy(configPath));
  } catch (exc) {
    if (exc instanceof JSONDecodeError) {
      echo(
        `Error: ${pyPathStr(configPath)} is not strict JSON (${exc.message}). ` +
          "Refusing to overwrite it. Remove comments or trailing commas, " +
          "or add the agent-sandbox entry by hand.",
        { err: true },
      );
      return sysExit(1);
    }
    if (_isOsError(exc)) {
      echo(`Error: could not read ${pyPathStr(configPath)}: ${_errText(exc)}`, { err: true });
      return sysExit(1);
    }
    throw exc;
  }
  if (!_isDict(loaded)) {
    echo(`Error: ${pyPathStr(configPath)} must contain a JSON object.`, { err: true });
    return sysExit(1);
  }
  return loaded;
}

// ---------------------------------------------------------------------------
// MCP command group
// ---------------------------------------------------------------------------

export const mcp = group("mcp", {
  help:
    "Configure and run Agent Sandbox as an MCP server.\n" +
    "\n" +
    "Use local STDIO transport for IDE integrations, or generate a Streamable\n" +
    "HTTP deployment artifact for manual deployment to Alibaba Cloud FC.\n" +
    "\n" +
    "\b\n" +
    "Examples:\n" +
    "  abx mcp install --target cursor\n" +
    "  abx mcp start\n" +
    "  abx mcp start --http --background\n" +
    "  abx mcp stop\n" +
    "  abx mcp deploy --generate-token --output-dir ./mcp-artifact\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  abx config set sandbox_api_key VALUE  Configure sandbox authentication\n" +
    "  abx mcp status                Inspect local MCP configuration\n" +
    "  abx mcp stop                  Stop the local MCP server",
});

const _INSTALL_TOOL_NAMES: [string, string][] = [
  ["create_sandbox", "Create a cloud sandbox"],
  ["list_sandboxes", "List visible sandboxes"],
  ["get_sandbox", "Refresh sandbox metadata"],
  ["set_sandbox_timeout", "Set sandbox lifetime"],
  ["run_code", "Execute code"],
  ["run_command", "Execute a command"],
  ["read_file", "Read a file"],
  ["write_file", "Write a file"],
  ["list_files", "List files"],
  ["kill_sandbox", "Destroy a sandbox"],
];

export const install = command("install", {
  help:
    "Install MCP Server configuration to a target IDE.\n" +
    "\n" +
    "Generates the correct MCP config and merges it into the selected IDE's\n" +
    "configuration file. Supported targets are cursor, claude, and vscode.\n" +
    "\n" +
    "\b\n" +
    "Examples:\n" +
    "  abx mcp install --target cursor\n" +
    "  abx mcp install --target claude\n" +
    "  abx mcp install --target vscode\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  abx mcp status  Verify installed IDE configurations\n" +
    "  abx mcp start   Run the configured STDIO server\n" +
    "  abx config get sandbox_api_key",
  params: [
    option(["--target"], {
      type: new Choice(["cursor", "claude", "vscode"]),
      required: true,
      help: "Target IDE for MCP installation.",
    }),
  ],
  callback: handleErrors(async (ctx: Context, params: Record<string, any>) => {
    return _withOptionalMcpSetup(ctx, "MCP registration (IDE files contain no credentials)", async () => {
    const target = params["target"] as string;
    const fmt = getFormatter(ctx);

    const pathFn = _IDE_CONFIG_MAP[target] as () => string;
    const configPath = pathFn();

    const existing = _readJsonObject(configPath);

    const serverConfig = _buildMcpServerConfig();

    if (target === "vscode") {
      // Workspace file: do not copy the API key into a path that is often committed.
      const workspaceConfig: PyDict = new Map(serverConfig);
      workspaceConfig.set("type", "stdio");
      const envBlock: PyDict = new Map((workspaceConfig.get("env") as PyDict | undefined) ?? []);
      envBlock.delete("ABX_SANDBOX_API_KEY");
      if (envBlock.size > 0) workspaceConfig.set("env", envBlock);
      else workspaceConfig.delete("env");
      let mcpServers = existing.get("servers");
      if (!_isDict(mcpServers)) mcpServers = new Map();
      mcpServers.set("agent-sandbox", workspaceConfig);
      existing.set("servers", mcpServers);
    } else {
      // Cursor and Claude use mcpServers
      let mcpServers = existing.get("mcpServers");
      if (!_isDict(mcpServers)) mcpServers = new Map();
      mcpServers.set("agent-sandbox", serverConfig);
      existing.set("mcpServers", mcpServers);
    }

    mkdirParents(path.dirname(configPath));
    writeTextPy(configPath, pyJsonDumps(existing, { indent: 2, ensure_ascii: false }) + "\n");

    if (fmt.use_json) {
      fmt.printData({ status: "registered", config_path: configPath, credentials_embedded: false, service_verified: false });
      return;
    }
    fmt.printSuccess(`MCP Server config written to ${pyPathStr(configPath)}`);
    if (!(ctx.obj ?? {})["quiet"]) {
      echo();
      echo("Registered tools:");
      for (const [name, desc] of _INSTALL_TOOL_NAMES) {
        echo(`  • ${name.padEnd(19)} — ${desc}`);
      }
      echo();
      if (target === "cursor") {
        echo("Please restart Cursor to apply changes.");
      } else if (target === "claude") {
        echo("Please restart Claude Desktop to apply changes.");
      } else if (target === "vscode") {
        echo("Please reload the VS Code window to apply changes.");
        echo(
          "The workspace MCP file does not contain the API key. " +
            "abx mcp start reads it from the environment or ~/.abx.",
        );
      }
    }
    getOutput(ctx).info("IDE registration is complete; service readiness has not been verified. Only-this-command credentials do not survive the server's later launch. Configure persistent credentials before launch and inspect setup with 'abx mcp status'.");
    });
  }),
});
mcp.addCommand(install);

// ---------------------------------------------------------------------------
// Local server state (pid file)
// ---------------------------------------------------------------------------

/**
 * Directory for the local MCP server pid and log.
 *
 * `ABX_MCP_RUNTIME_DIR` overrides the default `~/.abx/run` so tests do not touch a developer's running server.
 */
export function _runtimeDir(): string {
  const override = process.env["ABX_MCP_RUNTIME_DIR"];
  if (override) return override;
  return path.join(_home(), ".abx", "run");
}

/** JSON file recording the local MCP server process. */
export function _serverStatePath(): string {
  return path.join(_runtimeDir(), "mcp-server.json");
}

/** Log file for a background HTTP MCP server. */
export function _serverLogPath(): string {
  return path.join(_runtimeDir(), "mcp-server.log");
}

/** Return the recorded server state, or `null` when the file is absent. */
export function _readServerState(): PyDict | null {
  const statePath = _serverStatePath();
  if (!isFile(statePath)) return null;
  let loaded: PyJson;
  try {
    loaded = _jsonLoads(readTextPy(statePath));
  } catch (exc) {
    if (_isOsError(exc) || exc instanceof JSONDecodeError) return null;
    throw exc;
  }
  if (!_isDict(loaded)) return null;
  return loaded;
}

/** Return whether `pid` is a running process. */
export function _pidAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  return true;
}

/** Return the state file when its pid is still alive. */
export function _runningServer(): PyDict | null {
  const state = self._readServerState();
  if (!state) return null;
  const pid = state.get("pid");
  if (typeof pid !== "number" || !Number.isInteger(pid) || !self._pidAlive(pid)) return null;
  return state;
}

/** Persist the local server record. */
export function _writeServerState(state: PyDict): void {
  const statePath = _serverStatePath();
  mkdirParents(path.dirname(statePath));
  writeTextPy(statePath, pyJsonDumps(state, { indent: 2 }) + "\n");
}

function _unlinkQuiet(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch {
    // Python: contextlib.suppress(OSError)
  }
}

/** Remove the state file when it still belongs to this process. */
export function _releaseServerSlot(): void {
  const state = self._readServerState();
  if (state && state.get("pid") === process.pid) _unlinkQuiet(_serverStatePath());
}

/** Record this process, or exit when another local server is alive. */
export function _claimServerSlot(state: PyDict): void {
  const existing = self._runningServer();
  if (existing !== null && existing.get("pid") !== process.pid) {
    const mode = existing.has("mode") ? existing.get("mode") : "stdio";
    echo(
      `Error: an MCP server is already running (pid ${pyStr(existing.get("pid") ?? null)}, ${pyStr(mode)}).\n` +
        "Stop it with: abx mcp stop",
      { err: true },
    );
    return sysExit(1);
  }
  state.set("pid", process.pid);
  _writeServerState(state);
}

/** Whether the root CLI asked for quiet output. */
function _quiet(ctx: Context): boolean {
  const obj = ctx.obj || {};
  return Boolean(obj["quiet"]);
}

/** Write a startup note to stderr. Stdout stays reserved for JSON-RPC. */
function _note(ctx: Context, text: string): void {
  if (_quiet(ctx)) return;
  echo(text, { err: true });
}

/** Describe a secret without printing it. */
function _configuredLabel(value: string | null | undefined): string {
  return value ? "configured" : "not configured";
}

/** Tell a human operator what this waiting process is. */
async function _printStdioBanner(
  ctx: Context,
  o: { template: string; api_key: string | null; api_url: string | null; domain: string | null },
): Promise<void> {
  const { MCP_PROTOCOL_VERSION } = await import("../../agent/mcp.js");
  const tools = TOOL_SCHEMAS.map((tool) => tool.name).join(", ");
  _note(
    ctx,
    [
      "Agent Sandbox MCP server",
      "  transport:  STDIO (newline-delimited JSON-RPC)",
      `  protocol:   ${MCP_PROTOCOL_VERSION}`,
      `  template:   ${o.template}`,
      `  api key:    ${_configuredLabel(o.api_key)}`,
      `  api url:    ${o.api_url || "region default"}`,
      `  domain:     ${o.domain || "region default"}`,
      `  tools:      ${tools}`,
      "Auth: STDIO has no Bearer token. Sandbox calls use the API key above.",
      "Waiting for JSON-RPC on stdin. Responses are written to stdout.",
      "Stop with Ctrl-C, or from another terminal: abx mcp stop",
      "Background HTTP server: abx mcp start --http --background",
    ].join("\n"),
  );
}

/** Describe the HTTP listener before the server takes over. */
async function _printHttpBanner(
  ctx: Context,
  o: { host: string; port: number; template: string; api_key: string | null; auth_token: string | null },
): Promise<void> {
  const { MCP_PROTOCOL_VERSION } = await import("../../agent/mcp_http.js");
  _note(
    ctx,
    [
      "Agent Sandbox MCP server",
      "  transport:  Streamable HTTP",
      `  protocol:   ${MCP_PROTOCOL_VERSION}`,
      `  endpoint:   http://${o.host}:${o.port}/mcp`,
      `  health:     http://${o.host}:${o.port}/health`,
      `  template:   ${o.template}`,
      `  api key:    ${_configuredLabel(o.api_key)}`,
      `  auth:       ${_configuredLabel(o.auth_token)}`,
      "Stop with Ctrl-C, or from another terminal: abx mcp stop",
    ].join("\n"),
  );
}

/** True for hosts that are not reachable from another machine. */
export function _isLoopback(host: string): boolean {
  return ["127.0.0.1", "localhost", "::1"].includes(pyStrip(host).toLowerCase());
}

/** Start a detached MCP HTTP process and return when it has claimed a pid. */
export async function _spawnBackground(command_: string[], env: Record<string, string>): Promise<number> {
  const runtime = self._runtimeDir();
  mkdirParents(runtime);
  const logPath = self._serverLogPath();
  let logFd: number;
  try {
    logFd = fs.openSync(logPath, "a");
  } catch (e) {
    throw toOSError(e, logPath);
  }
  let proc: PopenLike;
  try {
    proc = await mcpSeams.popen(command_, { env, logFd });
  } finally {
    fs.closeSync(logFd);
  }

  const deadline = mcpSeams.monotonic() + 5;
  while (mcpSeams.monotonic() < deadline) {
    if (proc.poll() !== null) {
      let tail = "";
      try {
        const text = readTextPy(logPath);
        const cps = Array.from(text);
        tail = cps.slice(-2000).join("");
      } catch (exc) {
        if (!_isOsError(exc)) throw exc;
        tail = "";
      }
      echo("Error: the background MCP server exited before it was ready.\n" + tail, { err: true });
      return sysExit(1);
    }
    const state = self._readServerState();
    if (state && state.get("pid") === proc.pid) return proc.pid;
    await mcpSeams.sleep(0.1);
  }
  echo(`Error: timed out waiting for the background MCP server (pid ${proc.pid}).\nLog: ${logPath}`, { err: true });
  return sysExit(1);
}

/**
 * Run `fn` with the process-level SIGINT/SIGTERM listeners of the host program removed. The servers install their
 * own graceful-shutdown handlers (asyncio `add_signal_handler` / uvicorn in Python), which must not race with the
 * `Aborted!` handler of the executable.
 */
async function _ownSignals<T>(fn: () => Promise<T>): Promise<T> {
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  const saved = signals.map((sig) => [sig, process.listeners(sig)] as const);
  for (const sig of signals) process.removeAllListeners(sig);
  try {
    return await fn();
  } finally {
    for (const sig of signals) process.removeAllListeners(sig);
    for (const [sig, listeners] of saved) for (const l of listeners) process.on(sig, l as NodeJS.SignalsListener);
  }
}

export const start = command("start", {
  help:
    "Start the MCP server and print its configuration to stderr.\n" +
    "\n" +
    "The default transport is STDIO: an IDE writes JSON-RPC to stdin and reads\n" +
    "responses from stdout. Run it in a terminal to see the configuration and\n" +
    "stop it with Ctrl-C or 'abx mcp stop'.\n" +
    "\n" +
    "--http listens for Streamable HTTP. --background detaches that HTTP\n" +
    "server; STDIO cannot keep a client attached after detach, so --background\n" +
    "starts HTTP.\n" +
    "\n" +
    "\b\n" +
    "Examples:\n" +
    "  abx mcp start\n" +
    "  abx mcp start --template python-hello\n" +
    "  abx mcp start --http --port 9000\n" +
    "  abx mcp start --http --background\n" +
    "  abx mcp stop\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  abx mcp install --target cursor  Register the STDIO command in an IDE\n" +
    "  abx mcp stop                     Stop the local MCP server\n" +
    "  abx mcp status                   Check authentication and IDE setup",
  params: [
    option(["--template"], {
      default: "code-interpreter-v1",
      help: "Default sandbox template ID or alias (default: code-interpreter-v1).",
    }),
    option(["--api-key"], { default: null, envvar: "ABX_SANDBOX_API_KEY", help: "API key override." }),
    option(["--api-url"], { default: null, envvar: "ABX_SANDBOX_BASE_URL", help: "API URL override." }),
    option(["--domain"], { default: null, envvar: "E2B_DOMAIN", help: "Domain override." }),
    option(["--http", "use_http"], {
      is_flag: true,
      default: false,
      help: "Serve Streamable HTTP instead of STDIO.",
    }),
    option(["--host"], { default: "127.0.0.1", show_default: true, help: "HTTP bind address." }),
    option(["--port"], { default: 9000, show_default: true, type: INT, help: "HTTP bind port." }),
    option(["--auth-token"], {
      default: null,
      envvar: "ABX_MCP_AUTH_TOKEN",
      help: "Bearer token for the HTTP server. Required when --host is not loopback.",
    }),
    option(["--background"], {
      is_flag: true,
      default: false,
      help: "Detach an HTTP server. Stop it later with 'abx mcp stop'.",
    }),
  ],
  callback: handleErrors(async (ctx: Context, params: Record<string, any>) => {
    let apiKey: string | null = params["api_key"];
    const template: string = params["template"];
    const effective = _mcpConfig();
    const apiUrl: string | null = params["api_url"] || effective.sandbox_base_url;
    const domain: string | null = params["domain"] || effective.sandbox_domain;
    let useHttp: boolean = params["use_http"];
    const background: boolean = params["background"];

    if (!apiKey) apiKey = self._readApiKey();
    if (background) useHttp = true;

    if (useHttp) {
      await _withOptionalMcpSetup(ctx, "MCP HTTP server", async () => _startHttp(ctx, {
        template,
        api_key: apiKey || self._readApiKey(),
        api_url: apiUrl,
        domain,
        host: params["host"],
        port: params["port"],
        auth_token: pyStrip((params["auth_token"] as string | null) || "") || null,
        background,
      }));
      return;
    }

    await _startStdio(ctx, { template, api_key: apiKey, api_url: apiUrl, domain });
  }),
});
mcp.addCommand(start);

/** Run the STDIO server in the foreground. */
async function _startStdio(
  ctx: Context,
  o: { template: string; api_key: string | null; api_url: string | null; domain: string | null },
): Promise<void> {
  const { SandboxMCPServer } = await import("../../agent/mcp.js");

  _claimServerSlot(
    _dictOf([
      ["mode", "stdio"],
      ["template", o.template],
    ]),
  );
  await _printStdioBanner(ctx, o);
  const server = new SandboxMCPServer({
    api_key: o.api_key,
    api_url: o.api_url,
    domain: o.domain,
    template: o.template,
  });
  try {
    await _ownSignals(() => server.run());
  } finally {
    _releaseServerSlot();
  }
}

/** Run or detach the Streamable HTTP server. */
async function _startHttp(
  ctx: Context,
  o: {
    template: string;
    api_key: string | null;
    api_url: string | null;
    domain: string | null;
    host: string;
    port: number;
    auth_token: string | null;
    background: boolean;
  },
): Promise<void> {
  if (!_isLoopback(o.host) && !o.auth_token) {
    if (canGuideConfiguration(ctx)) {
      return withGuidedConfiguration(ctx, { operation: "non-loopback MCP HTTP authentication", validateProvider: false,
        requirements: [{ key: "mcp_auth_token", label: "MCP Bearer token for clients", secret: true, persist: false, env: "ABX_MCP_AUTH_TOKEN", flag: "--auth-token" }],
      }, async () => _startHttp(ctx, { ...o, auth_token: String(getOperationConfig()?.["mcp_auth_token"] ?? "") }));
    }
    echo("Error: --host is not loopback, so a non-empty --auth-token (or ABX_MCP_AUTH_TOKEN) is required.", {
      err: true,
    });
    return sysExit(1);
  }

  if (o.background) {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    delete env["ABX_MCP_AUTH_TOKEN"];
    if (o.auth_token) env["ABX_MCP_AUTH_TOKEN"] = o.auth_token;
    // The key stays in the environment. Putting it on the child argv would show it in the process list.
    if (o.api_key) env["ABX_SANDBOX_API_KEY"] = o.api_key;
    const plugin = _selectedPlugin();
    if (plugin !== null) env["ABX_PROVIDER"] = plugin;
    const command_ = [
      ..._selfCommand({ execArgv: true }),
      "mcp",
      "start",
      "--http",
      "--template",
      o.template,
      "--host",
      o.host,
      "--port",
      String(o.port),
    ];
    if (o.api_url) command_.push("--api-url", o.api_url);
    if (o.domain) command_.push("--domain", o.domain);
    const pid = await _spawnBackground(command_, env);
    _note(
      ctx,
      [
        "MCP HTTP server is running in the background.",
        `  pid:      ${pid}`,
        `  endpoint: http://${o.host}:${o.port}/mcp`,
        `  log:      ${self._serverLogPath()}`,
        "Stop it with: abx mcp stop",
      ].join("\n"),
    );
    return;
  }

  const { createMcpApp } = await import("../../agent/mcp_http.js");

  _claimServerSlot(
    _dictOf([
      ["mode", "http"],
      ["template", o.template],
      ["host", o.host],
      ["port", o.port],
      ["log", self._serverLogPath()],
    ]),
  );
  let killedBy: NodeJS.Signals | null = null;
  try {
    if (!o.auth_token) {
      _note(ctx, "Warning: HTTP authentication is disabled. Bind stays on the loopback host.");
    }
    await _printHttpBanner(ctx, o);
    const app = createMcpApp({
      auth_token: o.auth_token,
      api_key: o.api_key,
      api_url: o.api_url,
      domain: o.domain,
      template: o.template,
    });
    const outcome = await _ownSignals(() => _serveUvicorn(app, o.host, o.port));
    if (outcome.startupFailed) return sysExit(3);
    killedBy = outcome.signal === "SIGTERM" ? "SIGTERM" : null;
  } finally {
    // uvicorn re-raises SIGTERM with the default disposition once it has shut down, so the process dies right
    // there and the Python `finally` never runs: the pid file of a SIGTERMed server stays behind.
    if (killedBy === null) _releaseServerSlot();
  }
  if (killedBy !== null) {
    process.removeAllListeners(killedBy);
    process.kill(process.pid, killedBy);
  }
}

/** `str(OSError)` of the failure uvicorn logs when the listening socket cannot be created. */
function _uvicornBindError(exc: unknown, host: string, port: number): string {
  const err = exc as NodeJS.ErrnoException;
  const addr = host.includes(":") ? `(${pyStrRepr(host)}, ${port}, 0, 0)` : `(${pyStrRepr(host)}, ${port})`;
  const bind = (errno: number, text: string): string =>
    `[Errno ${errno}] error while attempting to bind on address ${addr}: ${text}`;
  switch (err?.code) {
    case "EADDRINUSE":
      return bind(98, "address already in use");
    case "EACCES":
      return bind(13, "permission denied");
    case "EADDRNOTAVAIL":
      return bind(99, "cannot assign requested address");
    case "ENOTFOUND":
      return "[Errno -2] Name or service not known";
    case "EAI_AGAIN":
      return "[Errno -3] Temporary failure in name resolution";
    default:
      return _errText(toOSError(exc, null));
  }
}

/**
 * What `uvicorn.run(app, host=..., port=..., log_level="info")` does: banner and lifecycle lines on stderr,
 * access lines on stdout, graceful shutdown on the first SIGINT/SIGTERM, exit status 3 when the socket cannot be
 * created.
 */
async function _serveUvicorn(
  app: { handler: http.RequestListener; shutdown(): Promise<void> },
  host: string,
  port: number,
): Promise<{ startupFailed: boolean; signal: NodeJS.Signals | null }> {
  const paint = (stream: NodeJS.WriteStream, level: "INFO" | "ERROR"): string => {
    const tag = stream.isTTY ? `\u001b[${level === "INFO" ? "32" : "31"}m${level}\u001b[0m:` : `${level}:`;
    return `${tag}${" ".repeat(10 - level.length - 1)}`;
  };
  const log = (message: string, level: "INFO" | "ERROR" = "INFO"): void => {
    process.stderr.write(`${paint(process.stderr, level)}${message}\n`);
  };

  const { createUvicornLikeServer } = await import("../../agent/mcp_http.js");
  const server = createUvicornLikeServer((req, res) => {
    // uvicorn writes the access line when the response starts, before the body reaches the client.
    const writeHead = res.writeHead.bind(res) as (...args: unknown[]) => http.ServerResponse;
    let logged = false;
    (res as { writeHead: unknown }).writeHead = (...args: unknown[]): http.ServerResponse => {
      const result = writeHead(...args);
      if (!logged) {
        logged = true;
        const client = `${req.socket.remoteAddress ?? "-"}:${req.socket.remotePort ?? 0}`;
        const status = res.statusCode;
        process.stdout.write(
          `${paint(process.stdout, "INFO")}${client} - "${req.method} ${req.url} HTTP/${req.httpVersion}" ${status} ${http.STATUS_CODES[status] ?? ""}\n`,
        );
      }
      return result;
    };
    app.handler(req, res);
  });

  log(`Started server process [${process.pid}]`);
  log("Waiting for application startup.");
  log("Application startup complete.");

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (exc) {
    log(_uvicornBindError(exc, host, port), "ERROR");
    log("Waiting for application shutdown.");
    await app.shutdown();
    log("Application shutdown complete.");
    return { startupFailed: true, signal: null };
  }
  const address = server.address() as net.AddressInfo;
  const shownHost = address.family === "IPv6" ? `[${address.address}]` : address.address;
  log(`Uvicorn running on http://${shownHost}:${address.port} (Press CTRL+C to quit)`);

  let captured: NodeJS.Signals | null = null;
  let closing = false;
  const closed = new Promise<void>((resolve) => {
    const onSignal = (signal: NodeJS.Signals): void => {
      if (closing) {
        process.exit(1);
      }
      closing = true;
      captured ??= signal;
      void (async () => {
        log("Shutting down");
        await new Promise<void>((done) => {
          server.close(() => done());
          server.closeIdleConnections();
        });
        log("Waiting for application shutdown.");
        await app.shutdown();
        log("Application shutdown complete.");
        log(`Finished server process [${process.pid}]`);
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
        resolve();
      })();
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  });
  await closed;
  return { startupFailed: false, signal: captured };
}

// ---------------------------------------------------------------------------
// stop / status
// ---------------------------------------------------------------------------

/** `OSError` text of a failed `os.kill` (`[Errno N] strerror`). */
function _killErrorText(exc: unknown): string {
  const code = (exc as NodeJS.ErrnoException | null)?.code;
  if (code === "ESRCH") return "[Errno 3] No such process";
  if (code === "EPERM") return "[Errno 1] Operation not permitted";
  const converted = toOSError(exc, null);
  return _errText(converted);
}

export const stop = command("stop", {
  help:
    "Stop the local MCP server started by 'abx mcp start'.\n" +
    "\n" +
    "Sends SIGTERM to the recorded pid (STDIO foreground or HTTP background)\n" +
    "and waits for it to exit. Sandboxes owned by that server are destroyed\n" +
    "during its shutdown.\n" +
    "\n" +
    "\b\n" +
    "Examples:\n" +
    "  abx mcp stop\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  abx mcp start            Start STDIO in the foreground\n" +
    "  abx mcp start --http --background\n" +
    "  abx mcp status           Inspect configuration and whether a server is running",
  callback: handleErrors(async (ctx: Context) => {
    const state = self._runningServer();
    if (state === null) {
      const stale = self._readServerState();
      if (stale !== null) _unlinkQuiet(self._serverStatePath());
      _note(ctx, "MCP server is not running.");
      return;
    }

    const pid = Number(state.get("pid"));
    const mode = state.has("mode") ? state.get("mode") : "stdio";
    _note(ctx, `Stopping MCP server (pid ${pid}, ${pyStr(mode)}).`);
    try {
      mcpSeams.kill(pid, "SIGTERM");
    } catch (exc) {
      echo(`Error: could not stop pid ${pid}: ${_killErrorText(exc)}`, { err: true });
      return sysExit(1);
    }

    const deadline = mcpSeams.monotonic() + 5;
    while (mcpSeams.monotonic() < deadline) {
      if (!self._pidAlive(pid)) {
        const recorded = self._readServerState();
        if (recorded && recorded.get("pid") === pid) _unlinkQuiet(self._serverStatePath());
        _note(ctx, "MCP server stopped.");
        return;
      }
      await mcpSeams.sleep(0.1);
    }

    echo(`Error: pid ${pid} did not exit after SIGTERM.`, { err: true });
    return sysExit(1);
  }),
});
mcp.addCommand(stop);

/** Python `needle in container` for the JSON value types a config file can hold (`TypeError` -> throws). */
function _pyIn(needle: string, container: unknown): boolean {
  if (_isDict(container)) return container.has(needle);
  if (Array.isArray(container)) return container.some((item) => item === needle);
  if (typeof container === "string") return container.includes(needle);
  throw new TypeError("argument of type is not iterable");
}

export const status = command("status", {
  help:
    "Show MCP tools, authentication state, and IDE installation status.\n" +
    "\n" +
    "\b\n" +
    "Examples:\n" +
    "  abx mcp status\n" +
    "  abx --json mcp status\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  abx mcp install --target cursor\n" +
    "  abx mcp start\n" +
    "  abx config get sandbox_api_key",
  callback: handleErrors(async (ctx: Context) => {
    const fmt = getFormatter(ctx);

    const apiKey = self._readApiKey();

    const data: Record<string, unknown> = {
      server: "agent-sandbox",
      transport: "stdio",
      tools_count: TOOL_SCHEMAS.length,
      tools: TOOL_SCHEMAS.map((t) => t.name),
      auth_configured: Boolean(apiKey),
      mcp_running: self._runningServer() !== null,
    };

    // Check if installed in various IDEs
    for (const [ideName, pathFn] of Object.entries(_IDE_CONFIG_MAP)) {
      try {
        const configPath = pathFn();
        if (isFile(configPath)) {
          const config = _jsonLoads(readTextPy(configPath));
          const key = ideName === "vscode" ? "servers" : "mcpServers";
          if (!_isDict(config)) throw new TypeError("config is not a dict");
          const installed = _pyIn("agent-sandbox", config.has(key) ? config.get(key) : new Map());
          data[`installed_${ideName}`] = installed;
        } else {
          data[`installed_${ideName}`] = false;
        }
      } catch {
        data[`installed_${ideName}`] = false;
      }
    }

    fmt.printDict(data);
  }),
});
mcp.addCommand(status);

// ---------------------------------------------------------------------------
// deploy command
// ---------------------------------------------------------------------------

export const _DEPLOY_REQUIREMENTS = `${MCP_SERVER_PIP_SPEC}
${MCP_CLIENT_PIP_SPEC}
uvicorn>=0.54.0
`;

export const _DEPLOY_APP_PY =
  '"""ASGI entry point for the FC MCP server."""\n' +
  "import os\n" +
  "\n" +
  "from agent_sandbox.agent.mcp_http import create_mcp_app, require_auth_token\n" +
  "\n" +
  "# Remote clients can reach this process. Do not boot with auth disabled.\n" +
  "app = create_mcp_app(\n" +
  '    auth_token=require_auth_token(os.environ.get("ABX_MCP_AUTH_TOKEN")),\n' +
  '    api_key=os.environ.get("ABX_SANDBOX_API_KEY"),\n' +
  '    api_url=os.environ.get("ABX_SANDBOX_BASE_URL"),\n' +
  '    domain=os.environ.get("E2B_DOMAIN"),\n' +
  '    template=os.environ.get("ABX_DEFAULT_TEMPLATE", "base"),\n' +
  ")\n";

/** Generate a cryptographically secure random Bearer token (`secrets.token_urlsafe(32)`). */
export function _generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Read a Bearer token from a file. */
export function _readTokenFile(file: string): string {
  return pyStrip(readTextPy(file));
}

const _MKDTEMP_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789_";

/** `tempfile.mkdtemp(prefix=...)`: `<prefix><8 random chars of [a-z0-9_]>`, mode 0700. */
function _mkdtemp(prefix: string): string {
  const base = os.tmpdir();
  for (let attempt = 0; attempt < 100; attempt++) {
    let suffix = "";
    for (let i = 0; i < 8; i++) suffix += _MKDTEMP_CHARS[randomInt(_MKDTEMP_CHARS.length)];
    const candidate = path.join(base, prefix + suffix);
    try {
      fs.mkdirSync(candidate, { mode: 0o700 });
      return candidate;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw toOSError(e, candidate);
    }
  }
  throw new Error("No usable temporary directory name found");
}

export const deploy = command("deploy", {
  help:
    "Generate an Alibaba Cloud FC deployment artifact.\n" +
    "\n" +
    "Creates a Streamable HTTP ASGI application artifact and prints manual\n" +
    "FC deployment steps. Automatic FC API deployment is not implemented.\n" +
    "\n" +
    "The artifact contains ``requirements.txt``, ``app.py`` (ASGI entry\n" +
    "point), and ``config.yaml`` (a YAML deployment manifest with FC function\n" +
    "settings and environment variables).\n" +
    "\n" +
    "``--region`` overrides the FC region for this invocation; without it the\n" +
    "region comes from ``abx config set region`` / ``ALIBABA_CLOUD_REGION_ID``\n" +
    "environment variable and defaults to ``cn-hangzhou``.\n" +
    "\n" +
    "A non-empty Bearer token is required (--generate-token or\n" +
    "--auth-token-file). POST and DELETE /mcp are implemented. GET /mcp\n" +
    "returns 405 until SSE server notifications exist. The function\n" +
    "environment sets ALIBABA_CLOUD_REGION_ID to the selected region.\n" +
    "\n" +
    "\b\n" +
    "Examples:\n" +
    "  abx mcp deploy --generate-token --api-key $ABX_SANDBOX_API_KEY\n" +
    "  abx mcp deploy --auth-token-file ./token.txt --region cn-shanghai\n" +
    "  abx mcp deploy --generate-token --output-dir ./deploy-artifact\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  abx mcp start                 Run the local STDIO server\n" +
    "  abx mcp status                Inspect MCP authentication state\n" +
    "  abx config set sandbox_api_key VALUE  Configure sandbox authentication",
  params: [
    option(["--name"], { default: "agent-sandbox-mcp", help: "FC function name for the artifact." }),
    regionOption(),
    option(["--template"], { default: "base", help: "Default sandbox template for MCP sessions." }),
    option(["--memory"], { type: INT, default: 512, help: "FC function memory (MB)." }),
    option(["--timeout", "fc_timeout"], { type: INT, default: 600, help: "FC function timeout (s)." }),
    option(["--auth-token-file"], {
      default: null,
      type: new Path({ exists: true }),
      help: "Path to a non-empty Bearer token file.",
    }),
    option(["--generate-token"], {
      is_flag: true,
      default: false,
      help: "Auto-generate a random Bearer token.",
    }),
    option(["--enable-session-affinity/--no-session-affinity"], {
      default: true,
      help: "Enable Mcp-Session-Id affinity (requires FC MCP support).",
    }),
    option(["--api-key"], {
      default: null,
      envvar: "ABX_SANDBOX_API_KEY",
      help: "ABX_SANDBOX_API_KEY to inject into the FC function env.",
    }),
    option(["--custom-domain"], { default: null, help: "Custom domain for the MCP endpoint." }),
    option(["--output-dir"], {
      default: null,
      type: new Path(),
      help: "Write the FC deployment artifact to this directory.",
    }),
  ],
  callback: handleErrors(async (ctx: Context, params: Record<string, any>) => {
    if (resolveProviderId(cliProvider()) !== BUILTIN_PROVIDER_ID) throw new CliError("FC deployment artifacts require --provider alicloud-express. Other Providers keep their own deployment workflows.");
    const fmt = getFormatter(ctx);
    const name: string = params["name"];
    const template: string = params["template"];
    const memory: number = params["memory"];
    const fcTimeout: number = params["fc_timeout"];
    const authTokenFile: string | null = params["auth_token_file"];
    const generateToken: boolean = params["generate_token"];
    const enableSessionAffinity: boolean = params["enable_session_affinity"];
    let apiKey: string | null = params["api_key"];
    const customDomain: string | null = params["custom_domain"];
    const outputDir: string | null = params["output_dir"];

    const region = params["region"] || _mcpConfig().region;

    // --- Resolve auth token ---
    let authToken = "";
    if (authTokenFile) {
      authToken = _readTokenFile(authTokenFile);
    } else if (generateToken) {
      authToken = _generateToken();
    } else if (pyStrip(process.env["ABX_MCP_AUTH_TOKEN"] ?? "")) {
      authToken = pyStrip(process.env["ABX_MCP_AUTH_TOKEN"] as string);
    }

    if (!authToken) {
      if (canGuideConfiguration(ctx) && await confirm("Generate a Bearer token and write it into this MCP deployment artifact? Keep config.yaml private.", { default: true, err: true })) {
        authToken = _generateToken();
      }
    }
    if (!authToken) {
      echo(
        "Error: a non-empty MCP Bearer token is required. " +
          "Pass --generate-token or --auth-token-file. " +
          "Refusing to write an artifact that would disable client authentication.",
        { err: true },
      );
      return sysExit(1);
    }

    // --- Resolve API key ---
    if (!apiKey) apiKey = self._readApiKey();

    const writeArtifact = async (): Promise<void> => {
    if (!apiKey) apiKey = self._readApiKey();
    if (!apiKey) {
      echo(
        "Warning: No ABX_SANDBOX_API_KEY provided. The generated MCP Server artifact " +
          "cannot create sandboxes until --api-key or ABX_SANDBOX_API_KEY is configured.",
        { err: true },
      );
    }

    // --- Build deploy artifact ---
    let artifactDir: string;
    if (outputDir) {
      artifactDir = pyPathStr(outputDir);
      mkdirParents(artifactDir);
    } else {
      artifactDir = _mkdtemp("abx-mcp-deploy-");
    }

    writeTextPy(path.join(artifactDir, "requirements.txt"), _DEPLOY_REQUIREMENTS);
    writeTextPy(path.join(artifactDir, "app.py"), _DEPLOY_APP_PY);

    // config.yaml: provider-neutral YAML deployment manifest, not an FC API payload
    const envVars: Record<string, string> = {
      ABX_MCP_AUTH_TOKEN: authToken,
      ABX_DEFAULT_TEMPLATE: template,
      ALIBABA_CLOUD_REGION_ID: region,
    };
    if (apiKey) envVars["ABX_SANDBOX_API_KEY"] = apiKey;

    const effective = _mcpConfig();
    const apiUrl = effective.sandbox_base_url;
    if (apiUrl) envVars["ABX_SANDBOX_BASE_URL"] = apiUrl;
    if (effective.sandbox_domain) envVars["ABX_SANDBOX_DOMAIN"] = effective.sandbox_domain;

    const fcConfig: Record<string, unknown> = {
      function_name: name,
      region,
      runtime: "python3.10",
      handler: "app.app",
      memory,
      timeout: fcTimeout,
      environment_variables: envVars,
      http_trigger: {
        methods: ["POST", "GET", "DELETE"],
        enable_session_affinity: enableSessionAffinity,
      },
    };
    if (customDomain) fcConfig["custom_domain"] = customDomain;

    writeTextPy(path.join(artifactDir, "config.yaml"), dumpYaml(fcConfig));
    fs.chmodSync(path.join(artifactDir, "config.yaml"), 0o600);

    if (fmt.use_json) {
      fmt.printData({ status: "artifact-created", artifact_dir: artifactDir, deployed: false, service_verified: false, sandbox_access_configured: Boolean(apiKey), bearer_token_configured: Boolean(authToken) });
      return;
    }
    fmt.printSuccess(`FC deployment artifact written to ${artifactDir}`);
    _printArtifactSummary(artifactDir, fcConfig, authToken);
    _printManualDeploySteps(artifactDir, enableSessionAffinity);
    _printIdeConfig(authToken, customDomain);
    };
    if (!apiKey && canGuideConfiguration(ctx)) {
      return _withOptionalMcpSetup(ctx, "MCP deployment artifact (credentials are written to config.yaml)", writeArtifact);
    }
    return writeArtifact();
  }),
});
mcp.addCommand(deploy);

/** Print a summary of the deploy artifact. */
function _printArtifactSummary(artifactDir: string, fcConfig: Record<string, unknown>, authToken: string | null): void {
  echo();
  echo("Artifact contents:");
  let names: string[];
  try {
    names = fs.readdirSync(artifactDir);
  } catch (e) {
    throw toOSError(e, artifactDir);
  }
  for (const f of pySorted(names)) echo(`  ${f}`);
  echo();
  echo(`  Function: ${pyStr(fcConfig["function_name"])}`);
  echo(`  Region:   ${pyStr(fcConfig["region"])}`);
  echo(`  Memory:   ${pyStr(fcConfig["memory"])} MB`);
  echo(`  Timeout:  ${pyStr(fcConfig["timeout"])} s`);
  if (authToken) {
    echo("  Token:    configured (stored in config.yaml; not displayed)");
  }
}

/** Print provider-neutral manual FC deployment guidance. */
function _printManualDeploySteps(artifactDir: string, enableSessionAffinity: boolean): void {
  echo();
  echo("Automatic FC API deployment is not implemented. Manual steps:");
  echo(`  1. Review and package the files in ${artifactDir}.`);
  echo("  2. Use the official Alibaba Cloud FC console or SDK to create the function.");
  echo(
    "  3. Translate config.yaml settings through the official console/SDK, " +
      "then create an HTTP trigger for POST/GET/DELETE.",
  );
  if (enableSessionAffinity) {
    echo("  4. Enable Mcp-Session-Id affinity if the selected FC runtime supports it.");
  } else {
    echo("  4. Session affinity is disabled in this artifact.");
  }
  echo("  5. Replace <FC_HTTP_TRIGGER_URL> below with the resulting trigger URL.");
  echo("  6. Clients should call DELETE /mcp when a session ends.");
  echo("  Note: GET /mcp returns 405 until SSE server notifications exist.");
  echo("  Security: config.yaml contains secrets; do not commit it to version control.");
}

/** Print an IDE config template without exposing a plaintext token. */
function _printIdeConfig(authToken: string | null, customDomain: string | null): void {
  const endpoint = customDomain ? `https://${customDomain}/mcp` : "<FC_HTTP_TRIGGER_URL>/mcp";

  const remote: Record<string, unknown> = { url: endpoint };
  const ideConfig = { mcpServers: { "agent-sandbox-remote": remote } };
  if (authToken !== null) remote["headers"] = { Authorization: "Bearer <BEARER_TOKEN>" };

  echo();
  echo("IDE config template (replace placeholders; do not commit secrets):");
  echo(pyJsonDumps(ideConfig, { indent: 2, ensure_ascii: false }));
}
