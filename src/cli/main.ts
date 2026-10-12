/**
 * ebx CLI -- command-line interface for Easy Sandbox (port of `cli/main.py`).
 *
 * Uses lazy loading to keep `ebx --help` fast: command modules are only imported when a command is looked up. The root
 * group, the global options, the shortcut merge, the unknown-command hints and the exit-code mapping live here.
 *
 * ## Writing a command module
 *
 * See `src/cli/commands/README.md`. In short: a module under `src/cli/commands/` exports click commands/groups (built
 * with `command()` / `group()` / `option()` / `argument()` from `../../framework/index.js`) under the *same attribute
 * names the Python module used* (`create`, `list_cmd`, `exec_cmd`, `files_list`, ...). They are registered here as
 * lazy import specs `"commands/<module>:<attr>"` ({@link _CORE_COMMANDS}, {@link _SHORTCUT_TARGET_MAP}). Wrap every
 * callback with {@link handleErrors} so exceptions map to the documented exit codes.
 */

import { readFileSync } from "node:fs";

import { getCloseMatches } from "../framework/difflib.js";
import {
  Abort,
  Choice,
  Command,
  type Context,
  EOFError,
  Exit,
  Group,
  type GroupAttrs,
  INT,
  KeyboardInterrupt,
  type Params,
  SystemExit,
  UsageError,
  ClickException,
  echo,
  getCurrentContext,
  option,
  sys,
  sysExit,
  versionOption,
} from "../framework/index.js";
import { cmpStr } from "../framework/py.js";
import { CommandTimeoutError, AuthenticationError, FileNotFoundError_, QuotaExceededError, SandboxError, TemplateNotFoundError } from "../models/errors.js";
import { closeOpenInfra, resetActiveProvider } from "../providers/active.js";
import { addCliOptions, extractProviderFlags, resetCliSelection, setCliProvider } from "../providers/selection.js";
import { exitCodeFor } from "../providers/errors.js";
import * as httpx from "../transport/_httpx.js";
import { AsyncioTimeoutError } from "../transport/ws.js";
import { AttributeError, FileNotFoundError, OSError as PyOSError, toOSError } from "../utils/_pyos.js";
import { injectedPackageVersion } from "../utils/package_version.js";
import { pyStr } from "../utils/_pyformat.js";
import { OSError as FrameworkOSError } from "../framework/utils.js";
import { OutputFormatter } from "./formatters.js";
import { OUTPUT_META_KEY, OutputManager, isCiEnv } from "./output.js";

// ---------------------------------------------------------------------------------------------------------------------
// Command registry & shortcuts
// ---------------------------------------------------------------------------------------------------------------------

import {
  RESERVED_NAMES,
  _CORE_COMMANDS,
  _DEFAULT_SHORTCUTS,
  _SHORTCUT_TARGET_MAP,
  _describeInvalidShortcutTarget,
  _formatShortcutTargets,
} from "./_shortcut_table.js";

export { RESERVED_NAMES, _CORE_COMMANDS, _DEFAULT_SHORTCUTS, _SHORTCUT_TARGET_MAP, _describeInvalidShortcutTarget, _formatShortcutTargets };

const _hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

// ---------------------------------------------------------------------------------------------------------------------
// Seams
// ---------------------------------------------------------------------------------------------------------------------

/** The slice of `commands/config_cmd` the root group needs to merge `[shortcuts]` from `~/.ebx/config.toml`. */
export interface ShortcutConfigApi {
  /** Alias -> target string map read from the `[shortcuts]` section (`{}` for a corrupted file). */
  loadShortcuts(): Record<string, string> | Map<string, string>;
  /** `true` when `~/.ebx/config.toml` exists. */
  _configFileExists(): boolean;
  /** Materialise the default config file (fresh install). */
  _createDefaultConfig(): void;
}

/** Command modules the root group loads lazily. A fixed map so the binary bundler includes every one. */
const COMMAND_MODULES: Record<string, () => Promise<Record<string, unknown>>> = {
  "commands/sandbox": () => import("./commands/sandbox.js"),
  "commands/config_cmd": () => import("./commands/config_cmd.js"),
  "commands/mcp": () => import("./commands/mcp.js"),
  "commands/provider": () => import("./commands/provider.js"),
  "commands/template": () => import("./commands/template.js"),
  "commands/deploy": () => import("./commands/deploy.js"),
  "commands/sandbox_files": () => import("./commands/sandbox_files.js"),
  "commands/sandbox_process": () => import("./commands/sandbox_process.js"),
  "commands/sandbox_system": () => import("./commands/sandbox_system.js"),
};

function loadCommandModule(modPath: string): Promise<Record<string, unknown>> {
  const load = COMMAND_MODULES[modPath];
  if (load === undefined) return Promise.reject(new Error(`No module named '${modPath}'`));
  return load();
}

/**
 * Patch points. Python tests monkeypatch module attributes (`config_cmd.load_shortcuts`, `importlib.import_module`);
 * ESM bindings are read-only, so the same points live on this mutable object and are read at call time.
 */
export const mainSeams: {
  /**
   * Replacement for the `config_cmd` module as seen by the shortcut merge (`null` -> import
   * `./commands/config_cmd.js` lazily). Tests set `{ loadShortcuts, _configFileExists, _createDefaultConfig }`.
   */
  configCmd: ShortcutConfigApi | null;
  /** `importlib.import_module`: `modPath` is relative to `src/cli` (e.g. `"commands/sandbox"`). */
  importModule: (modPath: string) => Promise<Record<string, unknown>>;
} = {
  configCmd: null,
  importModule: (modPath) => loadCommandModule(modPath),
};

// ---------------------------------------------------------------------------------------------------------------------
// Lazy Group
// ---------------------------------------------------------------------------------------------------------------------

export interface LazyGroupAttrs extends GroupAttrs {
  /** Alias -> `"commands/<module>:<attr>"` spec (a plain object or a Map). */
  lazy_subcommands?: Record<string, string> | Map<string, string> | null;
  /** Root group only: merge the user shortcuts of `~/.ebx/config.toml`. */
  merge_shortcuts?: boolean;
}

const _asEntries = (v: Record<string, string> | Map<string, string>): Array<[string, string]> =>
  v instanceof Map ? [...v.entries()] : Object.entries(v);

/**
 * Click group that lazily loads subcommands.
 *
 * Subcommands are registered as import specs and only loaded when actually looked up, keeping `--help` fast.
 *
 * When `merge_shortcuts` is enabled (root CLI group only), the user shortcuts configured in `~/.ebx/config.toml` are
 * merged in as well. The merge starts in the constructor (like Python's `__init__`) and is awaited by
 * {@link listCommands} / {@link getCommand} / {@link resolveCommand}; {@link whenReady} exposes it. When the config
 * helpers are supplied through {@link mainSeams.configCmd} the merge runs synchronously inside the constructor, so a
 * test's patch scope covers it.
 */
export class LazyGroup extends Group {
  /** alias -> import spec. Replace it wholesale (tests do) and call {@link _mergeUserShortcuts} to re-merge. */
  _lazy_subcommands: Map<string, string>;
  private _ready: Promise<void> = Promise.resolve();

  constructor(name: string | null = null, attrs: LazyGroupAttrs = {}) {
    const { lazy_subcommands, merge_shortcuts, ...rest } = attrs;
    super(name, rest);
    this._lazy_subcommands = new Map(lazy_subcommands ? _asEntries(lazy_subcommands) : []);
    if (merge_shortcuts) this._ready = this._mergeUserShortcuts();
  }

  /** Resolves once the shortcut merge started by the constructor has finished (it never rejects). */
  whenReady(): Promise<void> {
    return this._ready;
  }

  /**
   * Merge the user-configured shortcuts into lazy subcommands.
   *
   * `~/.ebx/config.toml` is the single source of truth: on a fresh install the default config file is created first,
   * then the `[shortcuts]` section is honoured as-is -- remapped or deleted defaults included, there is no implicit
   * fallback to the built-in defaults. A corrupted config only disables shortcuts (with a stderr warning): the core
   * command groups keep working, the CLI never breaks.
   */
  async _mergeUserShortcuts(): Promise<void> {
    try {
      const api: ShortcutConfigApi =
        mainSeams.configCmd ?? ((await mainSeams.importModule("commands/config_cmd")) as unknown as ShortcutConfigApi);

      if (!api._configFileExists()) {
        // Fresh install: materialise the default config file so the shortcut list always has a single, inspectable source.
        api._createDefaultConfig();
      }

      const shortcuts = api.loadShortcuts();

      for (const [alias, target] of _asEntries(shortcuts)) {
        if (RESERVED_NAMES.has(alias)) {
          echo(`⚠ Warning: Shortcut '${alias} = "${target}"' conflicts with built-in command '${alias}', ignored.`, { err: true });
          continue;
        }
        if (_hasOwn(_CORE_COMMANDS, alias)) continue;
        const importPath = _hasOwn(_SHORTCUT_TARGET_MAP, target) ? (_SHORTCUT_TARGET_MAP[target] as string) : undefined;
        if (importPath === undefined) {
          const hint = _describeInvalidShortcutTarget(target, { alias });
          const detail = hint
            .split("\n")
            .map((line) => `  ${line}`)
            .join("\n");
          echo(`⚠ Warning: Invalid shortcut ignored: '${alias} = "${target}"' in ~/.ebx/config.toml\n${detail}`, { err: true });
          continue;
        }
        this._lazy_subcommands.set(alias, importPath);
      }
    } catch (exc) {
      // Corrupted config (or missing config helpers): warn and keep going without shortcuts -- the CLI must never break.
      echo(
        `⚠ Warning: Failed to load shortcuts from config: ${pyStr(exc)}\n` +
          "  Shortcuts are unavailable for this session; the built-in " +
          "commands (sandbox/config/mcp/template) still work.\n" +
          "  Options:\n" +
          "    • Fix manually: edit ~/.ebx/config.toml\n" +
          "    • Reset config: ebx config init (re-run guided setup)\n" +
          "    • Reset shortcuts only: ebx config init --reset-shortcuts",
        { err: true },
      );
    }
  }

  override async listCommands(ctx: Context): Promise<string[]> {
    await this._ready;
    const base = await super.listCommands(ctx);
    const lazy = [...this._lazy_subcommands.keys()].sort(cmpStr);
    return [...base, ...lazy];
  }

  override async getCommand(ctx: Context, cmdName: string): Promise<Command | null> {
    await this._ready;
    if (this._lazy_subcommands.has(cmdName)) return this._loadCommand(cmdName);
    return super.getCommand(ctx, cmdName);
  }

  async _loadCommand(cmdName: string): Promise<Command> {
    const spec = this._lazy_subcommands.get(cmdName) as string;
    // format: "commands/sandbox:create"
    const idx = spec.lastIndexOf(":");
    const modPath = spec.slice(0, idx);
    const attrName = spec.slice(idx + 1);
    const mod = await mainSeams.importModule(modPath);
    if (!_hasOwn(mod, attrName) && !(attrName in mod)) {
      throw new AttributeError(`module '${modPath}' has no attribute '${attrName}'`);
    }
    return mod[attrName] as Command;
  }

  /**
   * Enrich the unknown-top-level-command error with a targeted hint.
   *
   *  - A high-confidence spelling candidate (difflib, cutoff 0.6) gets only a "Did you mean" correction suggestion.
   *  - With no plausible candidate, the user is pointed to template `custom_commands` (declared in template.yaml and
   *    invoked via `ebx run COMMAND`) and to a shortcut example whose target is the command path without the `ebx`
   *    prefix (`ebx config set shortcuts.NAME "template init"`).
   *
   * Contract preserved: Click `UsageError` semantics -- exit code 2, message on stderr. Only the root group is
   * affected.
   */
  override async resolveCommand(ctx: Context, args: string[]): Promise<[string | null, Command | null, string[]]> {
    await this._ready;
    try {
      return await super.resolveCommand(ctx, args);
    } catch (e) {
      if (!(e instanceof UsageError)) throw e;
      // Only the root group gets the hint; nested groups keep the stock Click message.
      if (ctx.parent !== null || !args.length) throw e;
      const cmdName = args[0] as string;
      const candidates = getCloseMatches(cmdName, await this.listCommands(ctx), 3, 0.6);
      let hint: string;
      if (candidates.length) {
        hint = "Did you mean " + candidates.map((c) => `'${c}'`).join(", ") + "?";
      } else {
        hint =
          "No similar command. " +
          'To add a shortcut, use the command path without the "ebx" ' +
          "prefix, for example: " +
          'ebx config set shortcuts.NAME "template init". ' +
          "A custom command inside a sandbox is declared in " +
          "template.yaml (custom_commands) and run with " +
          "'ebx run COMMAND'.";
      }
      throw new UsageError(`No such command '${cmdName}'. ${hint}`, ctx);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------------------------------------------------

export const EXIT_OK = 0;
export const EXIT_GENERAL = 1;
export const EXIT_AUTH = 3;
export const EXIT_NOT_FOUND = 4;
export const EXIT_TIMEOUT = 5;
export const EXIT_QUOTA = 6;

/**
 * Wrap a command callback so that `SandboxError`s and remote exceptions are mapped to exit codes.
 *
 * `SystemExit`, click's `Exit` / `Abort` and `KeyboardInterrupt` pass through untouched (`EOFError` does not: in Python it is
 * an `Exception`, so it ends up as "Unexpected error: " / exit 1); anything else is
 * rendered through an {@link OutputFormatter} built from `ctx.obj` (`json` / `quiet` / `no_color`) and turned into
 * `SystemExit(code)` (1 general, 3 auth, 4 not found, 5 timeout, 6 quota). The wrapper preserves the callback's
 * arguments and return value (`(ctx, params) => ...` for click callbacks) and is async.
 */
export function handleErrors<A extends unknown[], R>(func: (...args: A) => R | Promise<R>): (...args: A) => Promise<R> {
  const wrapper = async (...args: A): Promise<R> => {
    try {
      return await func(...args);
    } catch (excVal) {
      if (excVal instanceof SystemExit || excVal instanceof Exit || excVal instanceof Abort) throw excVal;
      if (excVal instanceof KeyboardInterrupt) throw excVal;

      const ctx = getCurrentContext(true);
      const obj = (ctx ? ctx.obj : null) || {};
      const fmt = new OutputFormatter({
        use_json: Boolean(obj["json"] ?? false),
        quiet: Boolean(obj["quiet"] ?? false),
        no_color: Boolean(obj["no_color"] ?? false),
      });

      if (excVal instanceof AuthenticationError) {
        fmt.printError(excVal.message, { code: excVal.code, suggestion: excVal.suggestion });
        return sysExit(EXIT_AUTH);
      } else if (excVal instanceof TemplateNotFoundError || excVal instanceof FileNotFoundError_) {
        fmt.printError(excVal.message, { code: excVal.code, suggestion: excVal.suggestion });
        return sysExit(EXIT_NOT_FOUND);
      } else if (excVal instanceof CommandTimeoutError) {
        fmt.printError(excVal.message, { code: excVal.code, suggestion: excVal.suggestion });
        return sysExit(EXIT_TIMEOUT);
      } else if (excVal instanceof QuotaExceededError) {
        fmt.printError(excVal.message, { code: excVal.code, suggestion: excVal.suggestion });
        return sysExit(EXIT_QUOTA);
      } else if (excVal instanceof SandboxError) {
        fmt.printError(excVal.message, { code: excVal.code, suggestion: excVal.suggestion });
        return sysExit(exitCodeFor(excVal));
      }
      // --- Remote / network exceptions (BUG-04) ---
      return _handleRemoteException(excVal, fmt);
    }
  };
  Object.defineProperty(wrapper, "name", { value: func.name, configurable: true });
  return wrapper;
}

/** Node `fs`/`net` errors (`ENOENT`, `EACCES`, ...) are the counterparts of Python's `OSError` family. */
function _asOsError(exc: unknown): Error | null {
  if (exc instanceof PyOSError || exc instanceof FrameworkOSError) return exc;
  if (exc instanceof Error) {
    const e = exc as NodeJS.ErrnoException;
    if (typeof e.code === "string" && /^E[A-Z0-9]+$/.test(e.code) && typeof e.syscall === "string") {
      return toOSError(exc, typeof e.path === "string" ? e.path : null);
    }
  }
  return null;
}

/**
 * Map non-SandboxError remote exceptions to friendly CLI messages.
 *
 * Catches httpx HTTP status errors, timeouts, connection errors, built-in FileNotFoundError / OSError (Node
 * `ENOENT`-style errors are translated to the Python text), and asyncio timeouts so the user never sees a raw
 * traceback.
 */
export function _handleRemoteException(excVal: unknown, fmt: OutputFormatter): never {
  if (excVal instanceof httpx.HTTPStatusError) {
    const status = excVal.response.status_code;
    if (status === 401) {
      fmt.printError(`Authentication failed (HTTP ${status}).`, {
        code: "E1000",
        suggestion: "Check your API key or AK/SK credentials (ebx config set sandbox_api_key <KEY>).",
      });
      return sysExit(EXIT_AUTH);
    } else if (status === 404) {
      fmt.printError(`Resource not found (HTTP ${status}).`, {
        code: "E5000",
        suggestion: "Verify the sandbox ID, template ID, or endpoint URL.",
      });
      return sysExit(EXIT_NOT_FOUND);
    } else if (status === 403) {
      fmt.printError(`Access denied (HTTP ${status}).`, {
        code: "E1000",
        suggestion: "Check your credentials and permissions.",
      });
      return sysExit(EXIT_AUTH);
    } else if (status === 429) {
      fmt.printError(`Rate limit exceeded (HTTP ${status}).`, {
        code: "E2002",
        suggestion: "Wait a moment and retry, or request a quota increase.",
      });
      return sysExit(EXIT_QUOTA);
    }
    fmt.printError(`Remote request failed (HTTP ${status}): ${pyStr(excVal)}`, {
      code: "E5000",
      suggestion: "Check the platform status and retry. Use 'ebx -v <command>' for details.",
    });
    return sysExit(EXIT_GENERAL);
  }

  if (excVal instanceof httpx.TimeoutException) {
    fmt.printError(`Request timed out: ${pyStr(excVal)}`, {
      code: "E3001",
      suggestion:
        "The HTTP request timed out. Try:\n" +
        "  1. Increase HTTP timeout: ebx config set http_timeout 120\n" +
        "  2. Or set env: export SANDBOX_HTTP_TIMEOUT=120\n" +
        "  3. Check network connectivity",
    });
    return sysExit(EXIT_TIMEOUT);
  }

  if (excVal instanceof httpx.ConnectError || excVal instanceof httpx.NetworkError) {
    fmt.printError(`Connection error: ${pyStr(excVal)}`, {
      code: "E5001",
      suggestion: "Check network connectivity and firewall rules. Verify the platform URL is correct.",
    });
    return sysExit(EXIT_GENERAL);
  }

  if (excVal instanceof httpx.ProtocolError) {
    // HTTP/2 StreamReset, peer closing the connection mid-response, etc.
    // (httpx.RemoteProtocolError is a subclass of ProtocolError.)
    fmt.printError(`Connection reset by remote: ${pyStr(excVal)}`, {
      code: "E5003",
      suggestion:
        "The platform closed the connection before responding. This usually " +
        "means the operation took too long (e.g., sandbox cold start). Try:\n" +
        "  1. Increase HTTP timeout: ebx config set http_timeout 120\n" +
        "  2. Retry the command\n" +
        "  3. Disable HTTP/2: ebx config set http2 false",
    });
    return sysExit(EXIT_GENERAL);
  }

  // asyncio.TimeoutError / TimeoutError (e.g. from create -T timeout; also Node's AbortSignal.timeout DOMException)
  if (excVal instanceof AsyncioTimeoutError || (excVal instanceof Error && excVal.name === "TimeoutError")) {
    fmt.printError("Operation timed out.", {
      code: "E3001",
      suggestion:
        "The operation exceeded its time limit. Try:\n" +
        "  1. Increase HTTP timeout: ebx config set http_timeout 120\n" +
        "  2. Or set env: export SANDBOX_HTTP_TIMEOUT=120\n" +
        "  3. Check if the service is responding",
    });
    return sysExit(EXIT_TIMEOUT);
  }

  // Built-in FileNotFoundError (e.g. install with bad path)
  const osErr = _asOsError(excVal);
  if (osErr instanceof FileNotFoundError) {
    fmt.printError(`File or directory not found: ${pyStr(osErr)}`, {
      code: "E4001",
      suggestion: "Verify the path exists and is accessible.",
    });
    return sysExit(EXIT_NOT_FOUND);
  }

  // Built-in OSError (e.g. permission issues)
  if (osErr !== null) {
    fmt.printError(`OS error: ${pyStr(osErr)}`, { suggestion: "Check file permissions and disk space." });
    return sysExit(EXIT_GENERAL);
  }

  // click.ClickException (pass through message cleanly)
  if (excVal instanceof ClickException) {
    fmt.printError(excVal.formatMessage());
    return sysExit(EXIT_GENERAL);
  }

  // Last resort: unknown exception -> friendly message
  fmt.printError(`Unexpected error: ${pyStr(excVal)}`, {
    suggestion: "Use 'ebx -v <command>' for more details, or report this issue.",
  });
  return sysExit(EXIT_GENERAL);
}

// ---------------------------------------------------------------------------------------------------------------------
// CLI root
// ---------------------------------------------------------------------------------------------------------------------

/** Package version (`click.version_option(package_name="easy-sandbox")` read the distribution metadata). */
export const VERSION: string = (() => {
  // Standalone binaries set this in the esbuild banner; there is no package.json beside the executable.
  const injected = injectedPackageVersion();
  if (injected !== undefined) return injected;
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: string };
    if (typeof pkg.version === "string") return pkg.version;
  } catch {
    /* fall through */
  }
  return "0.0.0";
})();

const ROOT_HELP = [
  "ebx — Easy Sandbox CLI",
  "",
  "Create, manage, and interact with cloud sandboxes.",
  "",
  "\b",
  "Setup, create, or scaffold:",
  "  ebx config init               Guided credentials setup (run first)",
  "  ebx create [DESCRIPTION]      Create a cloud sandbox (AI or --template)",
  "  ebx template init [DIR]       Scaffold a local template project",
  "",
  "\b",
  "Examples:",
  "  ebx create --template base",
  "  ebx list --status running",
  "  ebx template search python",
  "",
  "\b",
  "Related commands:",
  "  ebx config --help    Configure credentials and endpoints",
  "  ebx sandbox --help   Manage sandbox lifecycle and resources",
  "  ebx template --help  Discover, build, and deploy templates",
].join("\n");

/**
 * The root `ebx` group.
 *
 * Global options: `--json/-j`, `--quiet/-q`, `--verbose/-v`, `--no-color`, `--log-level`, `--ci`, `--timeout/-t`,
 * `--profile/-p`, `--version`, `-h/--help`. The callback publishes an {@link OutputManager} in
 * `ctx.meta["ebx.output"]` (`getOutput(ctx)`) and the backward-compatible `ctx.obj` keys `json`, `quiet`, `verbose`,
 * `no_color`, `timeout`, `profile`.
 */
export const cli = new LazyGroup("cli", {
  invoke_without_command: true,
  // Single source of truth for the `-h` alias: Click inherits `help_option_names` from the parent Context down the
  // whole command tree (lazy groups, nested sub-groups and leaf commands). Commands that define a `-h` parameter of
  // their own are protected by Click's built-in conflict guard.
  context_settings: { help_option_names: ["-h", "--help"] },
  // Core command groups are always registered; the top-level shortcuts are merged dynamically from
  // `~/.ebx/config.toml` by `LazyGroup`.
  lazy_subcommands: { ..._CORE_COMMANDS },
  merge_shortcuts: true,
  help: ROOT_HELP,
  params: [
    option(["--json", "-j", "output_json"], { is_flag: true, help: "Output as JSON" }),
    option(["--quiet", "-q"], { is_flag: true, help: "Minimal output" }),
    option(["--verbose", "-v"], { is_flag: true, help: "Verbose output (DEBUG level)" }),
    option(["--no-color"], { is_flag: true, help: "Disable colored output" }),
    option(["--log-level"], {
      type: new Choice(["DEBUG", "INFO", "WARNING", "ERROR"], { case_sensitive: false }),
      default: null,
      help: "Set log level explicitly",
    }),
    option(["--ci"], { is_flag: true, help: "CI/CD mode (quiet + no-color + json)" }),
    option(["--timeout", "-t"], {
      type: INT,
      default: 300,
      help: "Default sandbox lifetime in seconds (positive integer; default: 300)",
    }),
    option(["--profile", "-p"], { default: null, help: "[Reserved] Configuration profile" }),
    versionOption(null, { package_name: "easy-sandbox", version: VERSION }),
  ],
  callback: async (ctx: Context, params: Params) => {
    // Auto-detect CI environment
    const effectiveCi = Boolean(params["ci"]) || isCiEnv();

    const output = new OutputManager({
      verbose: Boolean(params["verbose"]),
      quiet: Boolean(params["quiet"]),
      jsonMode: Boolean(params["output_json"]) || effectiveCi,
      noColor: Boolean(params["no_color"]) || effectiveCi,
      ci: effectiveCi,
      logLevel: (params["log_level"] as string | null) ?? null,
    });

    ctx.ensureObject(Object);
    // Store OutputManager in ctx.meta (not ctx.obj) so that ctx.obj stays JSON-serializable.
    ctx.meta[OUTPUT_META_KEY] = output;
    // Backward-compatible context keys (used by getFormatter / handleErrors)
    ctx.obj["json"] = output.jsonMode;
    ctx.obj["quiet"] = output.quiet;
    ctx.obj["verbose"] = output.verbose;
    ctx.obj["no_color"] = output.noColor;
    ctx.obj["timeout"] = params["timeout"];
    ctx.obj["profile"] = params["profile"];
    if (ctx.invoked_subcommand === null) echo(await ctx.getHelp());
  },
});

/**
 * Entry point for the CLI (`main()` of the Python module): run `cli` in standalone mode and return the process exit
 * code. `bin/ebx.ts` passes it to `process.exit`.
 */
export async function main(opts: { args?: readonly string[]; prog_name?: string } = {}): Promise<number> {
  await cli.whenReady();
  let args: readonly string[] | undefined = opts.args ?? undefined;
  resetCliSelection();
  resetActiveProvider();
  try {
    // `--provider ID` / `--opt KEY=VALUE` are accepted at any position (root or command level); see providers/selection.ts.
    const extracted = extractProviderFlags(args ?? process.argv.slice(2));
    if (extracted.provider !== null || extracted.options.length > 0) {
      args = extracted.args;
      setCliProvider(extracted.provider);
      try {
        addCliOptions(extracted.options);
      } catch (e) {
        if (!(e instanceof SandboxError)) throw e;
        new OutputFormatter({ use_json: false, quiet: false, no_color: false }).printError(e.message, { code: e.code, suggestion: e.suggestion });
        return exitCodeFor(e);
      }
    }
    await cli.main({ args, prog_name: opts.prog_name ?? "ebx" });
    return 0;
  } catch (e) {
    if (e instanceof SystemExit) {
      if (e.code === null) return 0;
      if (typeof e.code === "number") return e.code;
      sys.stderr.write(`${e.code}\n`);
      return 1;
    }
    throw e;
  } finally {
    await closeOpenInfra();
  }
}
