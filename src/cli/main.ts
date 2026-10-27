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

import { SandboxError } from "../models/errors.js";
import { exitCodeFor } from "../models/provider_errors.js";
import { closeOpenInfra, resetActiveProvider } from "../providers/active.js";
import { addCliOptions, extractProviderFlags, resetCliSelection, setCliProvider } from "../providers/selection.js";
import { AttributeError } from "../utils/_pyos.js";
import { injectedPackageVersion } from "../utils/package_version.js";
import { Abort, Exit, KeyboardInterrupt, SystemExit } from "./errors.js";
import { OutputFormatter } from "./formatters.js";
import { type Command, type Context, type LazyEntry, type Params, group, option, runCommand } from "./kit.js";
import { OUTPUT_META_KEY, OutputManager, isCiEnv } from "./output.js";
import { Choice } from "./types.js";

import { GROUP_COMMANDS, SHORTCUTS } from "./command_surface.js";
import { discoverProviderOperations, providerOperationsSummary } from "./provider_operations.js";

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
      const value = mod[attrName];
      return typeof value === "function" ? (value as () => Command)() : value as Command;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------------------------------------------------

export { EXIT_OK, EXIT_GENERAL, EXIT_AUTH, EXIT_NOT_FOUND, EXIT_TIMEOUT, EXIT_QUOTA, handleErrors, _handleRemoteException } from "./error_handler.js";

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
  "  abx create base               Create a sandbox",
  "  abx exec SANDBOX -- CMD...    Run a command in it",
  "",
  "\b",
  "Examples:",
  "  abx list --status running",
  "  abx template search python",
  "  abx template scaffold --template python ./my-template",
  "  abx deploy ./my-template",
  '  abx create --prompt "DESCRIPTION" --help   Generation options',
  "",
  "Output flags: --json/--ci apply to native extensions, including --prompt.",
  "Standard sandbox commands keep their own options; use abx list --format json",
  "or abx info SANDBOX --format json. Check each command's --help.",
  "",
  "More templates: https://registry.agent-sandbox.cn/templates/",
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
  helpFooter: () => providerOperationsSummary(discoverProviderOperations()),
  version: VERSION,
  lazy: {
    ...Object.fromEntries(Object.entries(GROUP_COMMANDS).map(([name, { spec, help }]) => [name, lazyEntry(spec, help, "Command groups:")])),
    ...Object.fromEntries(Object.entries(SHORTCUTS).map(([name, { spec, target, help }]) => [name, lazyEntry(spec, `${help} (alias: abx ${target})`, "Sandbox shortcuts:")])),
  },
  params: [
    option(["--json", "-j", "output_json"], { is_flag: true, help: "JSON for native extensions (standard commands use their own --format option)" }),
    option(["--quiet", "-q"], { is_flag: true, help: "Minimal output" }),
    option(["--verbose", "-v"], { is_flag: true, help: "Verbose output (DEBUG level)" }),
    option(["--no-color"], { is_flag: true, help: "Disable colored output" }),
    option(["--log-level"], {
      type: new Choice(["DEBUG", "INFO", "WARNING", "ERROR"], { case_sensitive: false }),
      default: null,
      metavar: "LEVEL",
      help: "Set log level explicitly (DEBUG, INFO, WARNING, ERROR)",
    }),
    option(["--ci"], { is_flag: true, help: "CI/CD output; explicitly authorize Express managed API-key creation/renewal" }),
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
    // Ambient CI changes presentation only; credential mutations require the flag.
    ctx.obj!["ci_explicit"] = Boolean(params["ci"]);
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
