/** Tests for CLI main entry point and LazyGroup. */

import "../_support/isolatedHome.js";

import { describe, expect, it } from "vitest";

import { LazyGroup, cli } from "../../src/cli/main.js";
import { OutputManager, enableVerbose, getOutput } from "../../src/cli/output.js";
import { Context, command, echo } from "../../src/framework/index.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { ALL_COMMANDS, commandModuleExists, useCapsys, useDefaultShortcutsOnly } from "./conftest.js";

// `_default_shortcuts_only` (autouse): pin the root CLI to the built-in default shortcuts. The help/listing assertions
// below depend on the default shortcut aliases (`create`/`list`/`init`/...), which normally come from
// `~/.ebx/config.toml`. Re-merging against the built-in defaults keeps the tests deterministic regardless of the
// developer's local config -- and keeps the fresh-install bootstrap away from the real home directory.
useDefaultShortcutsOnly();
const capsys = useCapsys();

const runner = (): CliRunner => new CliRunner();

describe("TestLazyGroup", () => {
  // Test the LazyGroup lazy-loading mechanism.

  // BLOCKED-ON: cli/commands/* (the root --help listing loads every command module)
  it.skipIf(!ALL_COMMANDS)("test_list_commands_includes_lazy", async () => {
    const result = await runner().invoke(cli, ["--help"]);
    expect(result.exit_code).toBe(0);
    // All lazy commands should appear in help
    for (const cmd of ["create", "list", "info", "kill", "exec", "connect", "config", "template", "mcp", "install"]) {
      expect(result.output).toContain(cmd);
    }
  });

  it("test_lazy_group_loads_on_demand", async () => {
    // LazyGroup should resolve import paths correctly.
    const group = new LazyGroup("test", { lazy_subcommands: { create: "commands/sandbox:create" } });
    const ctx = new Context(group);
    const cmd = await group.getCommand(ctx, "create");
    expect(cmd).not.toBeNull();
    expect(cmd!.name).toBe("create");
  });

  it("test_lazy_group_returns_none_for_unknown", async () => {
    const group = new LazyGroup("test", { lazy_subcommands: {} });
    const ctx = new Context(group);
    expect(await group.getCommand(ctx, "nonexistent")).toBeNull();
  });

  it("test_lazy_group_list_commands_sorted", async () => {
    const group = new LazyGroup("test", {
      lazy_subcommands: {
        beta: "commands/sandbox:create",
        alpha: "commands/sandbox:create",
      },
    });
    const ctx = new Context(group);
    const cmds = await group.listCommands(ctx);
    expect(cmds).toEqual(["alpha", "beta"]);
  });
});

describe("TestCLIRoot", () => {
  // Test the root CLI group.

  // BLOCKED-ON: cli/commands/* (the root --help listing loads every command module)
  it.skipIf(!ALL_COMMANDS)("test_help", async () => {
    const result = await runner().invoke(cli, ["--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("ebx");
    expect(result.output).toContain("Easy Sandbox CLI");
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

    const result = await runner().invoke(cli, ["--json", "--quiet", "--no-color", "--timeout", "60", "_test_ctx"]);
    expect(result.exit_code).toBe(0);
    const data = JSON.parse(result.output);
    expect(data["json"]).toBe(true);
    expect(data["quiet"]).toBe(true);
    expect(data["no_color"]).toBe(true);
    expect(data["timeout"]).toBe(60);
  });

  // BLOCKED-ON: cli/commands/* (the root --help listing loads every command module)
  it.skipIf(!ALL_COMMANDS)("test_no_args_shows_help", async () => {
    const result = await runner().invoke(cli, []);
    expect(result.exit_code).toBe(0);
    // Should show usage/help when no command
    expect(result.output.includes("Usage") || result.output.includes("ebx")).toBe(true);
  });
});

describe("TestTopLevelInitRestored", () => {
  // The top-level `ebx init` scaffold shortcut is back (task 211).
  //
  // It shares the exact same `click.Command` object as `ebx template init` (the scaffold logic is never duplicated),
  // while `ebx config init` (credentials) and `ebx create` (cloud sandbox) keep their single responsibilities.

  // BLOCKED-ON: cli/commands/template (init)
  it.skipIf(!commandModuleExists("template"))("test_top_level_init_is_a_command", async () => {
    const ctx = new Context(cli);
    expect(await cli.getCommand(ctx, "init")).not.toBeNull();
  });

  // BLOCKED-ON: cli/commands/template (init)
  it.skipIf(!commandModuleExists("template"))("test_invoking_init_without_case_requires_explicit_choice", async () => {
    // Non-TTY (CliRunner) never blocks: an explicit case or --from is required.
    const result = await runner().invoke(cli, ["init"]);
    // `handleErrors` re-wraps a callback-raised UsageError into the general error exit (1); the message keeps the
    // usage contract.
    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("No scaffold case specified");
    expect(result.output).toContain("Use -t/--template <case> or --from <ref>");
  });

  // BLOCKED-ON: cli/commands/template (init)
  it.skipIf(!commandModuleExists("template"))("test_init_help_shows_scaffold_help", async () => {
    const result = await runner().invoke(cli, ["init", "--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("Scaffold a new sandbox template project");
  });

  // BLOCKED-ON: cli/commands/* (the root --help listing loads every command module)
  it.skipIf(!ALL_COMMANDS)("test_root_help_lists_init_command", async () => {
    const result = await runner().invoke(cli, ["--help"]);
    expect(result.exit_code).toBe(0);
    const commandsBlock = result.output.split("Commands:")[1]!;
    const listed = commandsBlock
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => line.trim().split(/\s+/)[0]!);
    expect(listed).toContain("init");
    // The real entry points survive.
    for (const name of ["create", "config", "template"]) expect(listed).toContain(name);
  });

  // BLOCKED-ON: cli/commands/* (the root --help listing loads every command module)
  it.skipIf(!ALL_COMMANDS)("test_root_help_names_the_three_entry_points", async () => {
    const result = await runner().invoke(cli, ["--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("Setup, create, or scaffold:");
    expect(result.output).toContain("ebx config init");
    expect(result.output).toContain("ebx create [DESCRIPTION]");
    expect(result.output).toContain("ebx template init [DIR]");
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
    ctx.meta["ebx.output"] = new OutputManager();
    ctx.obj = {};

    expect(getOutput(ctx).verbose).toBe(false);
    enableVerbose(ctx);

    expect(ctx.obj["verbose"]).toBe(true);
    expect(getOutput(ctx).verbose).toBe(true);
  });

  it("test_enable_verbose_creates_obj_when_missing", () => {
    const ctx = new Context(command("x"));
    ctx.meta["ebx.output"] = new OutputManager();
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
