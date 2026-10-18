import { shlexQuote } from "../../api/_shlex.js";
/** Sandbox system and capabilities CLI commands (port of `cli/commands/sandbox_system.py`). */

import type { Sandbox } from "../../api/sandbox.js";
import { JSONDecodeError, pyJsonLoads } from "../../agent/_py.js";
import type { ProcessResult } from "../../models/process.js";
import { cmpStr } from "../../utils/_py.js";
import { argument, command, group, option } from "../kit.js";
import { Choice } from "../types.js";
import { sysExit } from "../errors.js";
import { echo } from "../io.js";
import { PyFloat } from "../../utils/_pyformat.js";
import { pyRstrip, pySplitlines, pyStr, pyStrip } from "../../utils/_pyformat.js";
import { type OutputFormatter, getFormatter } from "../formatters.js";
import { handleErrors } from "../error_handler.js";

/** Connect to a sandbox by ID. */
export async function _connectSandbox(sandbox_id: string): Promise<Sandbox> {
  // Imported lazily like the Python helper: the SDK loggers must be created after the CLI's logging bridge is
  // installed by the root group callback, otherwise `--verbose` cannot lower the package logger level.
  const { Sandbox } = await import("../../api/sandbox.js");
  return Sandbox.connect(sandbox_id);
}

// ---------------------------------------------------------------------------
// Python `json.loads` value model for the commands below: objects -> `Map` (insertion order, no integer-key
// reordering), floats -> `PyFloat` (so `0.0` stays `0.0`), ints beyond 2**53 -> `bigint`.
// ---------------------------------------------------------------------------

type PyJson = null | boolean | number | bigint | PyFloat | string | PyJson[] | Map<string, PyJson>;

const _JSON_WS = new Set([" ", "\t", "\n", "\r"]);
const _JSON_NUMBER_RE = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?/y;

/** Parse `text` like `json.loads` (CPython accepts/rejects exactly what {@link pyJsonLoads} does). */
function _jsonLoads(text: string): PyJson {
  pyJsonLoads(text); // validation: throws JSONDecodeError with the CPython message
  let i = 0;
  const skip = (): void => {
    while (i < text.length && _JSON_WS.has(text[i] as string)) i++;
  };
  const parseString = (): string => {
    const start = i;
    i++;
    while (text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const value = (): PyJson => {
    skip();
    const ch = text[i] as string;
    if (ch === '"') return parseString();
    if (ch === "{") {
      const obj = new Map<string, PyJson>();
      i++;
      skip();
      if (text[i] === "}") {
        i++;
        return obj;
      }
      for (;;) {
        skip();
        const key = parseString();
        skip();
        i++; // ':'
        obj.set(key, value());
        skip();
        if (text[i++] === "}") return obj;
      }
    }
    if (ch === "[") {
      const arr: PyJson[] = [];
      i++;
      skip();
      if (text[i] === "]") {
        i++;
        return arr;
      }
      for (;;) {
        arr.push(value());
        skip();
        if (text[i++] === "]") return arr;
      }
    }
    if (text.startsWith("null", i)) {
      i += 4;
      return null;
    }
    if (text.startsWith("true", i)) {
      i += 4;
      return true;
    }
    if (text.startsWith("false", i)) {
      i += 5;
      return false;
    }
    if (text.startsWith("NaN", i)) {
      i += 3;
      return new PyFloat(Number.NaN);
    }
    if (text.startsWith("Infinity", i)) {
      i += 8;
      return new PyFloat(Infinity);
    }
    if (text.startsWith("-Infinity", i)) {
      i += 9;
      return new PyFloat(-Infinity);
    }
    _JSON_NUMBER_RE.lastIndex = i;
    const m = _JSON_NUMBER_RE.exec(text) as RegExpExecArray;
    i += m[0].length;
    if (m[1] || m[2]) return new PyFloat(Number.parseFloat(m[0]));
    const n = Number(m[0]);
    return Number.isSafeInteger(n) ? n : BigInt(m[0]);
  };
  return value();
}

function _pyTypeName(v: PyJson): string {
  if (v === null) return "NoneType";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number" || typeof v === "bigint") return "int";
  if (v instanceof PyFloat) return "float";
  if (typeof v === "string") return "str";
  if (Array.isArray(v)) return "list";
  return "dict";
}

/** Python truthiness of a parsed JSON value. */
function _truthy(v: PyJson): boolean {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "bigint") return v !== 0n;
  if (v instanceof PyFloat) return v.value !== 0;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return v.size > 0;
}

/** Python `for p in value`. */
function _iterate(v: PyJson): PyJson[] {
  if (Array.isArray(v)) return v;
  if (v instanceof Map) return [...v.keys()];
  if (typeof v === "string") return Array.from(v);
  throw new TypeError(`'${_pyTypeName(v)}' object is not iterable`);
}

/** Python `obj.get(key, default)` on a parsed JSON value. */
function _get(obj: PyJson, key: string, dflt: PyJson): PyJson {
  if (!(obj instanceof Map)) throw new TypeError(`'${_pyTypeName(obj)}' object has no attribute 'get'`);
  return obj.has(key) ? (obj.get(key) as PyJson) : dflt;
}

/**
 * Hand `[[name, version], ...]` rows to `print_table`. The table renderer rejects non-`str` cells before printing anything;
 * quiet mode (`"\t".join(row)`) fails on the first bad row after the preceding rows were already echoed.
 */
function _printPackageRows(fmt: OutputFormatter, headers: string[], rows: PyJson[][]): void {
  if (fmt.use_json) {
    fmt.printTable(headers, rows.map((r) => r as unknown as string[]));
    return;
  }
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] as PyJson[];
    const bad = row.findIndex((c) => typeof c !== "string");
    if (bad === -1) continue;
    if (!fmt.quiet) {
      throw new TypeError(
        `unable to render ${_pyTypeName(row[bad] as PyJson)}; a string or other renderable object is required`,
      );
    }
    fmt.printTable(headers, rows.slice(0, r) as string[][]);
    throw new TypeError(`sequence item ${bad}: expected str instance, ${_pyTypeName(row[bad] as PyJson)} found`);
  }
  fmt.printTable(headers, rows as string[][]);
}

// ---------------------------------------------------------------------------
// system info
// ---------------------------------------------------------------------------

export const system_info = command("info", {
  help:
    "Show system information of a sandbox.\n" +
    "\n" +
    "Displays OS, architecture, CPU, memory, disk, and Python version.\n" +
    "\n" +
    "Examples:\n" +
    "\n" +
    "    abx sandbox system info abc123\n" +
    "\n" +
    "    abx --json sandbox system info abc123\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  abx info SANDBOX_ID\n" +
    "  abx sandbox system metrics SANDBOX_ID\n" +
    "  abx sandbox system packages SANDBOX_ID",
  params: [argument(["sandbox_id"])],
  callback: handleErrors(async (ctx, params) => {
    const sandbox_id = params["sandbox_id"] as string;

    const fmt = getFormatter(ctx);
    const sandbox = await _connectSandbox(sandbox_id);

    const script =
      'python3 -c "' +
      "import platform, os, sys, shutil;" +
      "u=platform.uname();" +
      "d=shutil.disk_usage('/');" +
      "print(f'OS: {u.system}');" +
      "print(f'Arch: {u.machine}');" +
      "print(f'Hostname: {u.node}');" +
      "print(f'CPU_Count: {os.cpu_count()}');" +
      "print(f'Python: {sys.version.split()[0]}');" +
      "print(f'Disk_Total_GB: {round(d.total/(1024**3),2)}');" +
      "print(f'Disk_Free_GB: {round(d.free/(1024**3),2)}')" +
      '"';
    let result = (await sandbox.commands.run(script, { timeout: 15 })) as ProcessResult;

    if (result.exit_code !== 0) {
      // Fallback to simpler command
      result = (await sandbox.commands.run("uname -a", { timeout: 10 })) as ProcessResult;
      if (fmt.use_json) {
        fmt.printData(new Map<string, unknown>([["raw", pyStrip(result.stdout)]]));
      } else {
        echo(pyRstrip(result.stdout));
      }
      return;
    }

    const data = new Map<string, string>();
    for (const line of pySplitlines(pyStrip(result.stdout))) {
      const at = line.indexOf(": ");
      if (at !== -1) data.set(line.slice(0, at), line.slice(at + 2));
    }

    if (fmt.use_json) fmt.printData(data);
    else fmt.printDict(data);
  }),
});

// ---------------------------------------------------------------------------
// system env
// ---------------------------------------------------------------------------

export const system_env = command("env", {
  help:
    "Show environment variables from a sandbox.\n" +
    "\n" +
    "Sensitive variables (containing TOKEN, SECRET, KEY, PASSWORD) are excluded.\n" +
    "\n" +
    "Examples:\n" +
    "\n" +
    "    abx sandbox system env abc123\n" +
    "\n" +
    "    abx sandbox system env abc123 --filter PATH,HOME,LANG\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  abx sandbox system info SANDBOX_ID\n" +
    "  abx exec SANDBOX_ID \"env | sort\"\n" +
    "  abx create --env KEY=VALUE",
  params: [
    argument(["sandbox_id"]),
    option(["--filter", "-f", "env_filter"], {
      default: "",
      help: "Comma-separated variable names to show",
    }),
  ],
  callback: handleErrors(async (ctx, params) => {
    const sandbox_id = params["sandbox_id"] as string;
    const env_filter = params["env_filter"] as string;

    const fmt = getFormatter(ctx);
    const sandbox = await _connectSandbox(sandbox_id);

    const result = (await sandbox.commands.run("env", { timeout: 10 })) as ProcessResult;

    if (result.exit_code !== 0) {
      fmt.printError("Failed to retrieve environment variables.");
      sysExit(1);
    }

    // Parse env output
    const sensitive_tokens = ["TOKEN", "SECRET", "KEY", "PASSWORD", "CREDENTIAL"];
    let whitelist: Set<string> | null = null;
    if (env_filter) {
      whitelist = new Set(
        env_filter
          .split(",")
          .map((v) => pyStrip(v))
          .filter((v) => v),
      );
    }

    const variables = new Map<string, string>();
    for (const line of pySplitlines(result.stdout)) {
      const at = line.indexOf("=");
      if (at === -1) continue;
      const name = line.slice(0, at);
      const value = line.slice(at + 1);
      // Skip sensitive variables
      const upper_name = name.toUpperCase();
      if (sensitive_tokens.some((tok) => upper_name.includes(tok))) continue;
      if (whitelist !== null && !whitelist.has(name)) continue;
      variables.set(name, value);
    }

    if (fmt.use_json) {
      fmt.printData(new Map<string, unknown>([["variables", variables]]));
    } else if (!variables.size) {
      fmt.printSuccess("No matching environment variables found.");
    } else {
      for (const [name, value] of [...variables.entries()].sort((a, b) => cmpStr(a[0], b[0]))) {
        echo(`${name}=${value}`);
      }
    }
  }),
});

// ---------------------------------------------------------------------------
// system ports
// ---------------------------------------------------------------------------

export const system_ports = command("ports", {
  help:
    "Show listening TCP ports in a sandbox.\n" +
    "\n" +
    "Examples:\n" +
    "\n" +
    "    abx sandbox system ports abc123\n" +
    "\n" +
    "    abx --json sandbox system ports abc123\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  abx sandbox system info SANDBOX_ID\n" +
    "  abx sandbox process list SANDBOX_ID\n" +
    "  abx exec SANDBOX_ID \"ss -tlnp\"",
  params: [argument(["sandbox_id"])],
  callback: handleErrors(async (ctx, params) => {
    const sandbox_id = params["sandbox_id"] as string;

    const fmt = getFormatter(ctx);
    const sandbox = await _connectSandbox(sandbox_id);

    const result = (await sandbox.commands.run("ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo 'NO_TOOL'", {
      timeout: 10,
    })) as ProcessResult;

    if (result.exit_code !== 0 || result.stdout.includes("NO_TOOL")) {
      fmt.printError("Cannot determine listening ports (ss/netstat not available).");
      sysExit(1);
    }

    if (fmt.use_json) {
      const lines = pySplitlines(pyStrip(result.stdout));
      fmt.printData(new Map<string, unknown>([["raw_output", lines]]));
    } else {
      echo(pyRstrip(result.stdout));
    }
  }),
});

// ---------------------------------------------------------------------------
// system packages
// ---------------------------------------------------------------------------

export const system_packages = command("packages", {
  help:
    "List installed packages in a sandbox.\n" +
    "\n" +
    "Examples:\n" +
    "\n" +
    "    abx sandbox system packages abc123\n" +
    "\n" +
    "    abx sandbox system packages abc123 --manager npm\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  abx sandbox system info SANDBOX_ID\n" +
    "  abx exec SANDBOX_ID \"python3 -m pip show PACKAGE\"\n" +
    "  abx sandbox process list SANDBOX_ID",
  params: [
    argument(["sandbox_id"]),
    option(["--manager", "-m"], {
      default: "pip",
      type: new Choice(["pip", "npm"]),
      help: "Package manager (default: pip)",
    }),
  ],
  callback: handleErrors(async (ctx, params) => {
    const sandbox_id = params["sandbox_id"] as string;
    const manager = params["manager"] as string;

    const fmt = getFormatter(ctx);
    const sandbox = await _connectSandbox(sandbox_id);

    const cmd =
      manager === "pip" ? "python3 -m pip list --format json 2>/dev/null" : "npm list --json --depth=0 2>/dev/null";

    const result = (await sandbox.commands.run(cmd, { timeout: 30 })) as ProcessResult;

    if (manager === "pip") {
      let packages: PyJson;
      try {
        packages = _jsonLoads(result.stdout);
      } catch (e) {
        if (!(e instanceof JSONDecodeError)) throw e;
        packages = [];
      }

      if (fmt.use_json) {
        fmt.printData(
          new Map<string, unknown>([
            ["manager", manager],
            ["packages", packages],
          ]),
        );
      } else if (!_truthy(packages)) {
        fmt.printSuccess("No packages found.");
      } else {
        const headers = ["Name", "Version"];
        const rows = _iterate(packages).map((p) => [_get(p, "name", ""), _get(p, "version", "")]);
        _printPackageRows(fmt, headers, rows);
      }
    } else {
      let packages_list: Array<Map<string, PyJson>>;
      try {
        const raw = _jsonLoads(result.stdout);
        if (!(raw instanceof Map)) throw new _AttributeError();
        const deps = _get(raw, "dependencies", new Map());
        if (!(deps instanceof Map)) throw new _AttributeError();
        packages_list = [...deps.entries()].map(([name, info]) =>
          new Map<string, PyJson>([
            ["name", name],
            ["version", info instanceof Map ? _get(info, "version", "") : pyStr(info)],
          ]),
        );
      } catch (e) {
        if (!(e instanceof JSONDecodeError || e instanceof _AttributeError)) throw e;
        packages_list = [];
      }

      if (fmt.use_json) {
        fmt.printData(
          new Map<string, unknown>([
            ["manager", manager],
            ["packages", packages_list],
          ]),
        );
      } else if (!packages_list.length) {
        fmt.printSuccess("No packages found.");
      } else {
        const headers = ["Name", "Version"];
        const rows = packages_list.map((p) => [p.get("name") as PyJson, p.get("version") as PyJson]);
        _printPackageRows(fmt, headers, rows);
      }
    }
  }),
});

/** Stands in for the `AttributeError` the Python code swallows while reading `npm list --json`. */
class _AttributeError extends Error {}

// ---------------------------------------------------------------------------
// system metrics
// ---------------------------------------------------------------------------

export const system_metrics = command("metrics", {
  help:
    "Show resource usage metrics of a sandbox.\n" +
    "\n" +
    "Displays CPU load, memory usage, and disk usage.\n" +
    "\n" +
    "Examples:\n" +
    "\n" +
    "    abx sandbox system metrics abc123\n" +
    "\n" +
    "    abx --json sandbox system metrics abc123\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  abx sandbox system info SANDBOX_ID\n" +
    "  abx sandbox process list SANDBOX_ID\n" +
    "  abx info SANDBOX_ID",
  params: [argument(["sandbox_id"])],
  callback: handleErrors(async (ctx, params) => {
    const sandbox_id = params["sandbox_id"] as string;

    const fmt = getFormatter(ctx);
    const sandbox = await _connectSandbox(sandbox_id);

    const source = [
      "import os, shutil, json",
      "try:",
      "    load1, load5, load15 = os.getloadavg()",
      "except (AttributeError, OSError):",
      "    load1 = load5 = load15 = None",
      "d = shutil.disk_usage('/')",
      "print(json.dumps({",
      "    'cpu_load_1m': round(load1, 2) if load1 is not None else None,",
      "    'cpu_load_5m': round(load5, 2) if load5 is not None else None,",
      "    'cpu_load_15m': round(load15, 2) if load15 is not None else None,",
      "    'disk_total_gb': round(d.total / (1024 ** 3), 2),",
      "    'disk_used_gb': round(d.used / (1024 ** 3), 2),",
      "    'disk_free_gb': round(d.free / (1024 ** 3), 2)",
      "}))",
    ].join("\n");
    const script = `python3 -c ${shlexQuote(source)}`;
    let result = (await sandbox.commands.run(script, { timeout: 15 })) as ProcessResult;

    if (result.exit_code !== 0) {
      // Fallback: raw uptime + df
      result = (await sandbox.commands.run("uptime 2>/dev/null; echo '---'; df -h / 2>/dev/null", {
        timeout: 10,
      })) as ProcessResult;
      if (fmt.use_json) {
        fmt.printData(new Map<string, unknown>([["raw", pyStrip(result.stdout)]]));
      } else {
        echo(pyRstrip(result.stdout));
      }
      return;
    }

    let data: PyJson;
    try {
      data = _jsonLoads(pyStrip(result.stdout));
    } catch (e) {
      if (!(e instanceof JSONDecodeError)) throw e;
      echo(pyRstrip(result.stdout));
      return;
    }

    if (fmt.use_json) {
      fmt.printData(data);
    } else {
      if (!(data instanceof Map)) throw new TypeError(`'${_pyTypeName(data)}' object has no attribute 'items'`);
      fmt.printDict(new Map([...data.entries()].map(([k, v]) => [k, pyStr(v)] as [string, string])));
    }
  }),
});

// ---------------------------------------------------------------------------
// capabilities (top-level sandbox subcommand, not under system)
// ---------------------------------------------------------------------------

export const capabilities = command("capabilities", {
  help:
    "Show the capability groups available in a sandbox.\n" +
    "\n" +
    "Capability groups include shell, files, code, terminal, and ports. The built-in\n" +
    "provider reads them from the sandbox template; a plugin provider derives them\n" +
    "from the features it declares (see abx provider info ID).\n" +
    "\n" +
    "Examples:\n" +
    "\n" +
    "    abx sandbox capabilities abc123\n" +
    "\n" +
    "    abx --json sandbox capabilities abc123\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  abx info SANDBOX_ID\n" +
    "  abx template info TEMPLATE_ID\n" +
    "  abx sandbox system info SANDBOX_ID",
  params: [argument(["sandbox_id"])],
  callback: handleErrors(async (ctx, params) => {
    const sandbox_id = params["sandbox_id"] as string;

    const fmt = getFormatter(ctx);
    const sandbox = await _connectSandbox(sandbox_id);

    const caps = [...sandbox.capabilities].sort(cmpStr);

    if (fmt.use_json) {
      fmt.printData(new Map<string, unknown>([["capabilities", caps]]));
    } else if (!caps.length) {
      fmt.printSuccess("No capabilities declared.");
    } else {
      echo("Capabilities:");
      for (const cap of caps) echo(`  - ${cap}`);
    }
  }),
});

// ---------------------------------------------------------------------------
// system group
// ---------------------------------------------------------------------------

export const system = group("system", {
  help:
    "Inspect runtime environment, ports, packages, and resource usage.\n" +
    "\n" +
    "\b\n" +
    "Examples:\n" +
    "  abx sandbox system info abc123\n" +
    "  abx sandbox system env abc123 --filter PATH,HOME\n" +
    "  abx sandbox system metrics abc123\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  abx info SANDBOX_ID\n" +
    "  abx sandbox process --help\n" +
    "  abx sandbox capabilities SANDBOX_ID",
  callback: (ctx) => {
    ctx.ensureObject(Object);
  },
});

system.addCommand(system_info, "info");
system.addCommand(system_env, "env");
system.addCommand(system_ports, "ports");
system.addCommand(system_packages, "packages");
system.addCommand(system_metrics, "metrics");
