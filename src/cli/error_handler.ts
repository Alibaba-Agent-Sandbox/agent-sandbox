/** Command error rendering, independent of the root command and lazy loaders. */
import { CommandTimeoutError, AuthenticationError, FileNotFoundError_, QuotaExceededError, SandboxError, TemplateNotFoundError } from "../models/errors.js";
import { exitCodeFor } from "../models/provider_errors.js";
import * as httpx from "../transport/_httpx.js";
import { AsyncioTimeoutError } from "../transport/ws.js";
import { FileNotFoundError, OSError as PyOSError, toOSError } from "../utils/_pyos.js";
import { pyStr } from "../utils/_pyformat.js";
import { Abort, CliError, Exit, KeyboardInterrupt, SystemExit, sysExit } from "./errors.js";
import { OutputFormatter } from "./formatters.js";
import { getCurrentContext } from "./kit.js";

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
      const invocation = args[0];
      const context = getCurrentContext(true);
      if (context && invocation === context && args[1] && typeof args[1] === "object") {
        const { withSandboxConfiguration } = await import("./sandbox_guidance.js");
        return await withSandboxConfiguration(context, args[1] as Record<string, unknown>, async () => func(...args));
      }
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
