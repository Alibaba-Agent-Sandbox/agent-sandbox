# Writing `abx` command modules

This directory holds the command modules of the CLI (`sandbox.ts`, `sandbox_files.ts`, `sandbox_process.ts`,
`sandbox_system.ts`, `template.ts`, `config_cmd.ts`, `mcp.ts`, `deploy.ts`, ...). The framework they build on is a
byte-for-byte port of **Click 8.5.0** (`src/framework/`); the output layer is a port of `cli/output.py`
(`src/cli/output.ts`). Everything below is the contract between those layers and a command module.

## 1. Export convention (how `main.ts` finds your commands)

`src/cli/main.ts` registers command modules **lazily**. A registry entry is a *spec string*
`"commands/<module>:<attr>"` (module path relative to `src/cli`, no extension). When the root group needs the command
(help listing, resolution, invocation) it runs `import("./commands/<module>.js")` and reads the export called `<attr>`.

The registry is static code in `src/cli/command_surface.ts`: `GROUP_COMMANDS` (the command groups) and `SHORTCUTS` (the
fixed top-level shortcuts). It is not configurable; `tests/test_cli/test_command_surface.test.ts` checks it against
`abx --help` and against `docs/en/reference/cli-commands.md`. A module exports each click command/group under the
attribute name used in its spec (these are data keys, do not rename them to camelCase):

| spec                                             | the module must export                                            |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| `commands/sandbox:sandbox`                       | `export const sandbox = group("sandbox", ...)`                    |
| `commands/config_cmd:config`                     | `export const config = group("config", ...)`                      |
| `commands/mcp:mcp`                               | `export const mcp = group("mcp", ...)`                            |
| `commands/template:template`                     | `export const template = group("template", ...)`                  |
| `commands/provider:provider`                     | `export const provider = group("provider", ...)`                  |
| `commands/sandbox:create` / `list_cmd` / `info` / `kill` / `exec_cmd` / `connect` / `upload` / `download` / `run_cmd` | the shortcut targets (`abx create`, `abx list`, ...) |
| `commands/deploy:deploy_shortcut`                | idem                                                              |

Rules:

* The same `Command` object may be exported under several names / attached to several groups: a top-level shortcut is
  the very command object of its canonical path (`abx exec` is `abx sandbox exec`).
* Sub-groups (`sandbox files`, `sandbox process`, `sandbox command`, ...) are ordinary `Group`s registered with
  `parent.addCommand(cmd)`. `sandbox.ts` imports `sandbox_files.js` & co. itself because it attaches them eagerly.
* Adding a top-level command means editing `command_surface.ts` **and** `docs/{en,zh}/reference/cli-commands.md`; the
  surface test fails until both agree.
* Do not import `main.ts` for anything except `handleErrors` and the `EXIT_*` constants (a static import is fine:
  `main.ts` only imports command modules dynamically, there is no top-level await, so the cycle is harmless).
* Tests that need to substitute a command module use the seam `mainSeams.importModule(modPath)` in `main.ts`.

## 2. Framework API cheat-sheet (`src/framework/index.ts`)

There are no decorators; every factory returns the object.

```ts
import {
  command, group, option, argument, versionOption, helpOption,   // factories
  Context, Command, Group, Choice, IntRange, FloatRange, Path, Tuple, INT, FLOAT, BOOL, STRING, UUID, UNPROCESSED,
  UsageError, BadParameter, MissingParameter, ClickException, Abort, Exit,
  echo, secho, style, prompt, confirm, getCurrentContext, sys, sysExit, SystemExit,
} from "../../framework/index.js";
import { getOutput, enableVerbose } from "../output.js";
import { getFormatter } from "../formatters.js";
import { regionOption, resolveRegion } from "../region.js";
import { handleErrors, EXIT_AUTH } from "../main.js";

export const create = command("create", {
  help: "Create a new sandbox.\n\n\b\nExamples:\n  abx create --template base",   // Python docstring, cleandoc'd, \b kept
  params: [
    argument(["description"], { required: false }),
    option(["--template", "-t"], { default: null, help: "Template name" }),
    option(["--timeout"], { type: INT, default: null }),
    option(["--verbose", "-v"], { is_flag: true }),
    regionOption(),                                                // shared --region/-r
  ],
  callback: handleErrors(async (ctx, params) => {                   // params: { description, template, timeout, verbose, region }
    const out = getOutput(ctx);
    if (params.verbose) enableVerbose(ctx);
    out.info("Creating sandbox...");
    out.data({ ID: "sbx-1", Status: "running" });
  }),
});
```

* **Callback**: `(ctx: Context, params: Record<string, any>) => unknown | Promise<unknown>`. `params` is keyed by
  the Python parameter name (`--no-color` -> `no_color`, `["--json", "-j", "output_json"]` -> `output_json`). It
  replaces Python's `@click.pass_context` + keyword arguments. Callbacks may be `async`; always `await` inside them.
* **Options**: `option(decls, attrs)`; `attrs` mirror Click's keyword names verbatim (`is_flag`, `flag_value`,
  `multiple`, `count`, `type`, `default`, `required`, `help`, `metavar`, `envvar`, `show_default`, `hidden`,
  `callback`, `is_eager`, `expose_value`, `prompt`, `hide_input`, `nargs`, `show_choices`, ...). `type` takes a
  `ParamType` (`INT`, `new Choice([...], { case_sensitive: false })`, `new IntRange({ min: 1 })`, `new Path({...})`).
  Default `"--flag/--no-flag"` boolean pairs work as in Click.
* **Arguments**: `argument(decls, attrs)` (`required`, `nargs`, `type`, `default`, `metavar`).
* **Commands/groups**: `command(name, { help, short_help, epilog, params, callback, hidden, deprecated,
  context_settings, no_args_is_help, add_help_option, options_metavar })`; `group(name, { ..., invoke_without_command,
  chain, commands, subcommand_metavar, result_callback })`; `parent.addCommand(cmd, name?)`,
  `parent.command(name, attrs)`, `parent.group(name, attrs)`, `parent.resultCallback(fn)`.
  `cls: SubClass` selects a subclass (`CommandAttrs & { cls }`).
* **Context**: `ctx.obj` (the root stores a plain object with `json`, `quiet`, `verbose`, `no_color`, `timeout`,
  `profile`), `ctx.meta` (plain object shared down the tree), `ctx.parent`, `ctx.params`, `ctx.invoked_subcommand`,
  `ctx.invoke(otherCommand, kwargs)`, `ctx.forward(...)`, `ctx.exit(code)`, `ctx.fail(msg)`, `ctx.abort()`,
  `ctx.ensureObject(Object)`, `ctx.findRoot()`, `ctx.getParameterSource(name)`, `ctx.callOnClose(fn)`.
  `getCurrentContext(silent?)` returns the active context (AsyncLocalStorage based).
* **Errors**: `throw new UsageError(msg, ctx)` (exit 2, usage + "Try ..." hint on stderr), `BadParameter`,
  `ClickException` (exit 1, `Error: msg`), `Abort` ("Aborted!", exit 1), `Exit(code)` / `ctx.exit(code)`,
  `sysExit(code)` (throws `SystemExit`). `handleErrors(fn)` maps `SandboxError` & remote errors to exit codes (1 general,
  3 auth, 4 not found, 5 timeout, 6 quota) and rethrows `SystemExit`/`Exit`/`Abort`/`KeyboardInterrupt`/`EOFError`.
  Note (as in Python) it also catches `UsageError` raised *inside* the wrapped callback and turns it into exit 1.
* **Help**: byte-identical to Click 8.5.0 at width 80 (`-h` / `--help` are available everywhere through the root's
  `help_option_names`). `ctx.getHelp()` is async.
* **Echo/prompt**: `echo(msg, { err, nl, color })`, `secho`, `style(msg, { fg, bold, ... })`, `await prompt(...)`,
  `await confirm(...)`. They write through `sys.stdout` / `sys.stderr` from the framework (what `CliRunner`
  captures) - **never use `process.stdout.write` / `console.log` in command code**.
* Python's synchronous APIs that touch commands (`get_command`, `list_commands`, `resolve_command`, `invoke`,
  `get_help`, `make_context`, `main`) are `async` here and use camelCase: `getCommand`, `listCommands`,
  `resolveCommand`, `ctx.invoke`, `ctx.getHelp`, `cmd.makeContext`, `cmd.main`.

## 3. Output (`src/cli/output.ts`)

`getOutput(ctx?)` returns the `OutputManager` the root group stored in `ctx.meta["abx.output"]` (falls back to a default
manager when called outside a context). Channel policy: **stdout** = results (`data`, `table`, `success`),
**stderr** = everything else (`info`, `progress`, `warning`, `error`, `debug`, and every `logging` record).

```ts
out.info("..."); out.progress("..."); out.warning("..."); out.debug("...");
out.error("boom", { code: "E1001", suggestion: "retry" });
out.success("done");
out.data(new Map([["ID", "sbx-1"], ["Status", "running"]]));   // object or Map (Map keeps key order for integer-like keys)
out.table(["ID", "Status"], [["sbx-1", "running"]]);
await out.spinner("Creating sandbox", () => doIt());            // context-manager -> callback
await out.activity("Researching", async (update) => { update?.("line1\nline2"); }, { tick: true });
const act = out.startActivity("Building", { tick: true });     // imperative form: { update | null, close() }
try { act.update?.("..."); } finally { act.close(); }
```

`jsonMode` / `quiet` / `noColor` / `verbose` / `ci` are plain fields (`json_mode` / `no_color` getters exist as
Python-spelling aliases). Constructor options accept both spellings (`new OutputManager({ jsonMode: true })` /
`{ json_mode: true }`).

`getFormatter(ctx)` (`formatters.ts`) gives the legacy `OutputFormatter` (`printSuccess`, `printError(msg, { code,
suggestion })`, `printTable`, `printDict`, `printData`). `handleErrors` uses it with `ctx.obj`.

Test seams (Python module-attribute monkeypatches) are on the mutable `outputSeams` object (`sys`, `isTty`, `echo`,
`Console`, `activityMinInterval`, `activityTickSeconds`, `monotonic`).

## 4. Testing a command

```ts
import { CliRunner } from "../helpers/cliRunner.js";
import { cli } from "../../src/cli/main.js";
const runner = new CliRunner();
const result = await runner.invoke(cli, ["create", "--template", "base"]);
expect(result.exit_code).toBe(0);
expect(result.stdout).toContain("created successfully");   // stdout / stderr / output (interleaved) like Click 8.5
```

`CliRunner.invoke(cmd, args, { input, env, catch_exceptions, color, prog_name })` - isolated env, buffered in-memory
non-tty streams, forced terminal width 80, ANSI stripped unless `color: true`. `tests/test_cli/conftest.ts` provides the
shared fixtures (`runner`, `pristineLogging`, `defaultShortcutsOnly`, `capsys`).
