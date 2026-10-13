/** Tests for the CLI main entry point and its lazily loaded top-level commands. */

import "../_support/isolatedHome.js";

import { describe, expect, it } from "vitest";

import { cli, handleErrors } from "../../src/cli/main.js";
import { OutputManager, enableVerbose, getOutput } from "../../src/cli/output.js";
import { TOP_LEVEL_COMMANDS } from "../../src/cli/command_surface.js";
import { Context, command } from "../../src/cli/kit.js";
import { UsageError } from "../../src/cli/errors.js";
import { echo } from "../../src/cli/io.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { ALL_COMMANDS, commandModuleExists, useCapsys } from "./conftest.js";

const capsys = useCapsys();

const runner = (): CliRunner => new CliRunner();

describe("TestLazyGroup", () => {
  // Test the LazyGroup lazy-loading mechanism.

  // BLOCKED-ON: cli/commands/* (the root --help listing loads every command module)
  it.skipIf(!ALL_COMMANDS)("test_list_commands_includes_lazy", async () => {
    const result = await runner().invoke(cli, ["--help"]);
    expect(result.exit_code).toBe(0);
    // All lazy commands should appear in help
    for (const cmd of ["create", "list", "info", "kill", "exec", "connect", "config", "template", "mcp", "provider", "run", "deploy"]) {
      expect(result.output).toContain(cmd);
    }
  });

  it("test_lazy_subcommand_loads_on_demand", async () => {
    const cmd = await cli.getCommand("create");
    expect(cmd).not.toBeNull();
    expect(cmd!.name).toBe("create");
  });

  it("test_lazy_lookup_returns_null_for_unknown", async () => {
    expect(await cli.getCommand("nonexistent")).toBeNull();
  });

  it("test_root_lists_exactly_the_fixed_surface", () => {
    expect(cli.listCommands()).toEqual(TOP_LEVEL_COMMANDS);
  });
});

describe("TestCLIRoot", () => {
  // Test the root CLI group.

  // BLOCKED-ON: cli/commands/* (the root --help listing loads every command module)
  it.skipIf(!ALL_COMMANDS)("test_help", async () => {
    const result = await runner().invoke(cli, ["--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("abx");
    expect(result.output).toContain("Agent Sandbox CLI");
  });

  it("test_version", async () => {
    const result = await runner().invoke(cli, ["--version"]);
    expect(result.exit_code).toBe(0);
    // Should contain version number
    expect(result.output.toLowerCase().includes("version") || result.output.includes("0.")).toBe(true);
  });

  it("test_context_options_stored", async () => {
    // Global options should be passed through context.
    cli.command("_test_ctx", {
      callback: (ctx) => {
        echo(JSON.stringify(ctx.obj));
      },
    });

    const result = await runner().invoke(cli, ["--json", "--quiet", "--no-color", "_test_ctx"]);
    expect(result.exit_code).toBe(0);
    const data = JSON.parse(result.output);
    expect(data["json"]).toBe(true);
    expect(data["quiet"]).toBe(true);
    expect(data["no_color"]).toBe(true);
  });

  // BLOCKED-ON: cli/commands/* (the root --help listing loads every command module)
  it.skipIf(!ALL_COMMANDS)("test_no_args_shows_help", async () => {
    const result = await runner().invoke(cli, []);
    expect(result.exit_code).toBe(0);
    // Should show usage/help when no command
    expect(result.output.includes("Usage") || result.output.includes("abx")).toBe(true);
  });
});

describe("TestTopLevelInitRemoved", () => {
  // `init` is not a top-level shortcut: scaffolding is `abx template init`, credentials are `abx config init`.

  it("test_top_level_init_is_not_a_command", async () => {
    expect(await cli.getCommand("init")).toBeNull();
    expect(await cli.getCommand("install")).toBeNull();
  });

  it("test_invoking_init_without_case_requires_explicit_choice", async () => {
    // Non-TTY (CliRunner) never blocks: an explicit case or --from is required.
    const result = await runner().invoke(cli, ["template", "init"]);
    // A UsageError raised inside a callback keeps click's usage exit code (2), like a parse error.
    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("No scaffold case specified");
    expect(result.output).toContain("Use -t/--template <case> or --from <ref>");
  });

  it("test_init_help_shows_scaffold_help", async () => {
    const result = await runner().invoke(cli, ["template", "init", "--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("Scaffold a new sandbox template project");
  });

  // BLOCKED-ON: cli/commands/* (the root --help listing loads every command module)
  it.skipIf(!ALL_COMMANDS)("test_root_help_names_the_entry_points", async () => {
    const result = await runner().invoke(cli, ["--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("abx config init");
    expect(result.output).toContain("abx create --template base");
    expect(result.output).toContain("abx template init --template python");
  });

  // BLOCKED-ON: cli/commands/config_cmd (init)
  it.skipIf(!commandModuleExists("config_cmd"))("test_config_init_still_exists_with_guided_help", async () => {
    const result = await runner().invoke(cli, ["config", "init", "--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("Guided setup");
  });

  // BLOCKED-ON: cli/commands/template (init)
  it.skipIf(!commandModuleExists("template"))("test_template_init_still_exists_with_scaffold_help", async () => {
    const result = await runner().invoke(cli, ["template", "init", "--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("Scaffold a new sandbox template project");
  });
});

describe("TestVerboseSubcommandFlag", () => {
  // The local `-v/--verbose` flag on subcommands flips the shared manager.

  it("test_enable_verbose_sets_context_and_manager", () => {
    const ctx = new Context(command("x"));
    ctx.meta["abx.output"] = new OutputManager();
    ctx.obj = {};

    expect(getOutput(ctx).verbose).toBe(false);
    enableVerbose(ctx);

    expect(ctx.obj!["verbose"]).toBe(true);
    expect(getOutput(ctx).verbose).toBe(true);
  });

  it("test_enable_verbose_creates_obj_when_missing", () => {
    const ctx = new Context(command("x"));
    ctx.meta["abx.output"] = new OutputManager();
    ctx.obj = null;

    enableVerbose(ctx);
    expect(ctx.obj).toEqual({ verbose: true });
  });

  it("test_set_verbose_enables_debug_output", () => {
    const out = new OutputManager({ no_color: true });
    out.debug("hidden");
    expect(capsys.readouterr().err).not.toContain("hidden");

    out.setVerbose(true);
    out.debug("shown");
    expect(capsys.readouterr().err).toContain("shown");
  });
});

describe("TestCallbackUsageErrorExitCode", () => {
  it("test_usage_error_in_a_callback_exits_2", async () => {
    const usage = command("usage", {
      callback: handleErrors(async () => {
        throw new UsageError("bad combination");
      }),
    });
    const result = await runner().invoke(usage, []);
    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("bad combination");
  });
});
