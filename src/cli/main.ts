/**
 * abx CLI entry: the root command, the global options, the error-to-exit-code mapping and `main()`.
 *
 * Command modules are imported lazily (only the one the command line names), so `abx --help` stays fast. The top-level
 * command set is the fixed table in `command_surface.ts`.
 *
 * ## Writing a command module
 *
 * See `src/cli/commands/README.md`. In short: a module under `src/cli/commands/` exports commands/groups built with
 * `command()` / `group()` / `option()` / `argument()` from `../kit.js` under the attribute names `command_surface.ts`
 * lists. Wrap every callback with {@link handleErrors} so exceptions map to the documented exit codes.
 */

import { readFileSync } from "node:fs";

import { CommandTimeoutError, AuthenticationError, FileNotFoundError_, QuotaExceededError, SandboxError, TemplateNotFoundError } from "../models/errors.js";
import { closeOpenInfra, resetActiveProvider } from "../providers/active.js";
import { addCliOptions, extractProviderFlags, resetCliSelection, setCliProvider } from "../providers/selection.js";
import { exitCodeFor } from "../providers/errors.js";
import * as httpx from "../transport/_httpx.js";
import { AsyncioTimeoutError } from "../transport/ws.js";
import { AttributeError, FileNotFoundError, OSError as PyOSError, toOSError } from "../utils/_pyos.js";
import { injectedPackageVersion } from "../utils/package_version.js";
import { pyStr } from "../utils/_pyformat.js";
import { Abort, CliError, Exit, KeyboardInterrupt, SystemExit, sysExit } from "./errors.js";
import { OutputFormatter } from "./formatters.js";
import { type Command, type Context, type LazyEntry, type Params, getCurrentContext, group, option, runCommand } from "./kit.js";
import { OUTPUT_META_KEY, OutputManager, isCiEnv } from "./output.js";
import { Choice } from "./types.js";

import { GROUP_COMMANDS, SHORTCUTS } from "./command_surface.js";

const _hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

// ---------------------------------------------------------------------------------------------------------------------
// Seams
// ---------------------------------------------------------------------------------------------------------------------

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

/** Patch point for tests: the module loader (`modPath` is relative to `src/cli`, e.g. `"commands/sandbox"`). */
export const mainSeams: {
  importModule: (modPath: string) => Promise<Record<string, unknown>>;
} = {
  importModule: (modPath) => loadCommandModule(modPath),
};

// ---------------------------------------------------------------------------------------------------------------------
// Lazy subcommands
// ---------------------------------------------------------------------------------------------------------------------

/** A top-level command described by a `"commands/<module>:<attr>"` spec, imported when the command line names it. */
function lazyEntry(spec: string, help: string, heading: string): LazyEntry {
  return {
    help,
    heading,
    load: async () => {
      const idx = spec.lastIndexOf(":");
      const modPath = spec.slice(0, idx);
      const attrName = spec.slice(idx + 1);
      const mod = await mainSeams.importModule(modPath);
      if (!(attrName in mod)) throw new AttributeError(`module '${modPath}' has no attribute '${attrName}'`);
      return mod[attrName] as Command;
    },
  };
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
 * `SystemExit`, `Exit` / `Abort` and `KeyboardInterrupt` pass through untouched (`EOFError` does not: it ends up as
 * "Unexpected error: " / exit 1); anything else is
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
  if (exc instanceof PyOSError) return exc;
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
        suggestion: "Check your API key or AK/SK credentials (abx config set sandbox_api_key <KEY>).",
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
      suggestion: "Check the platform status and retry. Use 'abx -v <command>' for details.",
    });
    return sysExit(EXIT_GENERAL);
  }

  if (excVal instanceof httpx.TimeoutException) {
    fmt.printError(`Request timed out: ${pyStr(excVal)}`, {
      code: "E3001",
      suggestion:
        "The HTTP request timed out. Try:\n" +
        "  1. Increase HTTP timeout: abx config set http_timeout 120\n" +
        "  2. Or set env: export ABX_HTTP_TIMEOUT=120\n" +
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
        "  1. Increase HTTP timeout: abx config set http_timeout 120\n" +
        "  2. Retry the command\n" +
        "  3. Disable HTTP/2: abx config set http2 false",
    });
    return sysExit(EXIT_GENERAL);
  }

  // asyncio.TimeoutError / TimeoutError (e.g. from create -T timeout; also Node's AbortSignal.timeout DOMException)
  if (excVal instanceof AsyncioTimeoutError || (excVal instanceof Error && excVal.name === "TimeoutError")) {
    fmt.printError("Operation timed out.", {
      code: "E3001",
      suggestion:
        "The operation exceeded its time limit. Try:\n" +
        "  1. Increase HTTP timeout: abx config set http_timeout 120\n" +
        "  2. Or set env: export ABX_HTTP_TIMEOUT=120\n" +
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

  // CliError (pass the message through cleanly); a UsageError keeps click's exit code 2.
  if (excVal instanceof CliError) {
    fmt.printError(excVal.formatMessage());
    return sysExit(excVal.exit_code);
  }

  // Last resort: unknown exception -> friendly message
  fmt.printError(`Unexpected error: ${pyStr(excVal)}`, {
    suggestion: "Use 'abx -v <command>' for more details, or report this issue.",
  });
  return sysExit(EXIT_GENERAL);
}

// ---------------------------------------------------------------------------------------------------------------------
// CLI root
// ---------------------------------------------------------------------------------------------------------------------

/** Package version. The old Python CLI read `agent-sandbox` distribution metadata; the client distribution is now `agent-sandbox-client`. */
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
  "abx — Agent Sandbox CLI",
  "",
  "Create, manage, and interact with cloud sandboxes.",
  "",
  "\b",
  "Get started:",
  "  abx config init               Set credentials and region (run first)",
  "  abx create --template base    Create a sandbox",
  "  abx exec SANDBOX -- CMD...    Run a command in it",
  "",
  "\b",
  "Examples:",
  "  abx list --status running",
  "  abx template search python",
  "  abx template scaffold --template python && abx deploy",
  "",
  "Every action has one canonical path (abx GROUP VERB); the shortcuts below are a",
  "fixed set and cannot be changed in the configuration.",
].join("\n");

/**
 * The root `abx` command.
 *
 * Global options: `--json/-j`, `--quiet/-q`, `--verbose/-v`, `--no-color`, `--log-level`, `--ci`, `--version`,
 * `-h/--help`. The callback publishes an {@link OutputManager} in `ctx.meta["abx.output"]` (`getOutput(ctx)`) and the
 * context keys `json`, `quiet`, `verbose`, `no_color` in `ctx.obj`.
 */
export const cli: Command = group("abx", {
  help: ROOT_HELP,
  version: VERSION,
  lazy: {
    ...Object.fromEntries(Object.entries(GROUP_COMMANDS).map(([name, { spec, help }]) => [name, lazyEntry(spec, help, name === "provider" ? "Providers:" : "Command groups:")])),
    ...Object.fromEntries(Object.entries(SHORTCUTS).map(([name, { spec, target }]) => [name, lazyEntry(spec, `Same as 'abx ${target}'.`, "Sandbox shortcuts:")])),
  },
  params: [
    option(["--json", "-j", "output_json"], { is_flag: true, help: "Output as JSON" }),
    option(["--quiet", "-q"], { is_flag: true, help: "Minimal output" }),
    option(["--verbose", "-v"], { is_flag: true, help: "Verbose output (DEBUG level)" }),
    option(["--no-color"], { is_flag: true, help: "Disable colored output" }),
    option(["--log-level"], {
      type: new Choice(["DEBUG", "INFO", "WARNING", "ERROR"], { case_sensitive: false }),
      default: null,
      metavar: "LEVEL",
      help: "Set log level explicitly (DEBUG, INFO, WARNING, ERROR)",
    }),
    option(["--ci"], { is_flag: true, help: "CI/CD mode (quiet + no-color + json)" }),
  ],
  callback: (ctx: Context, params: Params) => {
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
    // Context keys read by getFormatter / handleErrors
    ctx.obj!["json"] = output.jsonMode;
    ctx.obj!["quiet"] = output.quiet;
    ctx.obj!["verbose"] = output.verbose;
    ctx.obj!["no_color"] = output.noColor;
  },
});

/** Entry point for the CLI: run `cli` and return the process exit code (`bin/abx.ts` passes it to `process.exit`). */
export async function main(opts: { args?: readonly string[]; prog_name?: string } = {}): Promise<number> {
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
    return await runCommand(cli, args ?? process.argv.slice(2), { prog_name: opts.prog_name ?? "abx" });
  } finally {
    await closeOpenInfra();
  }
}
