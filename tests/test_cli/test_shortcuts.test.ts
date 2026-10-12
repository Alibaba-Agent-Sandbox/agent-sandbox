/**
 * Tests for CLI shortcuts: LazyGroup merge + `ebx config` shortcut commands (port of `tests/test_cli/test_shortcuts.py`).
 * The `registry:` tests are extras that run without any command module.
 *
 * Covered contracts:
 *
 * - `LazyGroup(merge_shortcuts=true)` treats the `[shortcuts]` section of `~/.ebx/config.toml` as the single source of
 *   truth -- user-defined aliases are registered, remapped defaults point at their new targets, deleted defaults
 *   disappear, reserved names cannot be overridden, invalid targets are skipped with a stderr warning, and a corrupted
 *   config only disables shortcuts (the core command groups keep working).
 * - `ebx config` shortcuts surface: `get shortcuts[.<name>]`, `set shortcuts.<name> VALUE|""`, `list`, `init` and
 *   `init --reset-shortcuts`.
 * - TOML round-trip: writing one section never drops the other (`[transport]` vs `[shortcuts]`).
 */

import "../_support/isolatedHome.js";

import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { _CORE_COMMANDS, _DEFAULT_SHORTCUTS, LazyGroup, cli, mainSeams, type ShortcutConfigApi } from "../../src/cli/main.js";
import { loads as parseToml } from "../../src/utils/_tomllib.js";
import { Context } from "../../src/framework/index.js";
import { useIsolatedEnv } from "../_support/env.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { fakeTtySys, storagePatch, withConfig } from "../helpers/configSupport.js";
import { commandModuleExists, useCapsys } from "./conftest.js";

const iso = useIsolatedEnv();
const capsys = useCapsys();

/** `patch(f"{_CFG}....")`: the config layer lives on `mainSeams.configCmd`; restore it after each test. */
afterEach(() => {
  mainSeams.configCmd = null;
});

describe("TestLazyGroupShortcutMerge", () => {
  // `LazyGroup(merge_shortcuts=True)` honours the config file as-is.

  /** Build a fresh LazyGroup with the config layer patched out. */
  function buildGroup(shortcuts: Record<string, string>): LazyGroup {
    mainSeams.configCmd = {
      _configFileExists: () => true,
      _createDefaultConfig: vi.fn(),
      loadShortcuts: () => ({ ...shortcuts }),
    } satisfies ShortcutConfigApi;
    try {
      // With the seam supplied the merge runs synchronously inside the constructor (the patch scope of the Python test).
      return new LazyGroup("ebx-test", { lazy_subcommands: { ..._CORE_COMMANDS }, merge_shortcuts: true });
    } finally {
      mainSeams.configCmd = null;
    }
  }

  it("test_missing_section_triggers_default_config_creation", async () => {
    // Fresh install / pre-shortcuts file: defaults are materialised first.
    const mockCreate = vi.fn();
    mainSeams.configCmd = {
      _configFileExists: () => false,
      _createDefaultConfig: mockCreate,
      loadShortcuts: () => ({}),
    };
    const group = new LazyGroup("ebx-test", { lazy_subcommands: { ..._CORE_COMMANDS }, merge_shortcuts: true });
    await group.whenReady();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  // BLOCKED-ON: cli/commands/sandbox_process (`process list` is loaded by get_command)
  it.skipIf(!commandModuleExists("sandbox_process"))("test_user_defined_alias_is_registered", async () => {
    // A custom alias like `ps = "sandbox process list"` becomes a command.
    const group = buildGroup({ ps: "sandbox process list" });
    const ctx = new Context(group);
    expect(await group.listCommands(ctx)).toContain("ps");
    expect(await group.getCommand(ctx, "ps")).not.toBeNull();
  });

  it("registry: user-defined alias is listed without loading any module", async () => {
    const group = buildGroup({ ps: "sandbox process list" });
    const ctx = new Context(group);
    expect(await group.listCommands(ctx)).toContain("ps");
    expect(group._lazy_subcommands.get("ps")).toBe("commands/sandbox_process:process_list");
  });

  it("test_remapped_default_alias_targets_new_command", async () => {
    // `create = "sandbox info"` re-points the alias at the info command.
    const group = buildGroup({ create: "sandbox info" });
    const ctx = new Context(group);
    const cmd = await group.getCommand(ctx, "create");
    expect(cmd).not.toBeNull();
    expect(cmd!.name).toBe("info");
  });

  it("test_deleted_default_alias_is_not_registered", async () => {
    // No implicit fallback: deleting `create` from the file removes it.
    const group = buildGroup({ list: "sandbox list" });
    const ctx = new Context(group);
    expect(await group.getCommand(ctx, "create")).toBeNull();
    expect(await group.listCommands(ctx)).not.toContain("create");
  });

  // BLOCKED-ON: cli/commands/config_cmd (`config` group is loaded by get_command)
  it.skipIf(!commandModuleExists("config_cmd"))("test_reserved_name_cannot_be_overridden", async () => {
    // `config` is a built-in command group: shortcut is ignored, warning shown.
    const group = buildGroup({ config: "sandbox create" });
    const captured = capsys.readouterr();
    expect(captured.err).toContain("conflicts with");
    expect(captured.err).toContain("ignored");
    const ctx = new Context(group);
    const cmd = await group.getCommand(ctx, "config");
    expect(cmd).not.toBeNull();
    expect(cmd!.name).toBe("config");
  });

  it("registry: reserved name keeps its core spec and warns, without loading any module", async () => {
    const group = buildGroup({ config: "sandbox create" });
    const captured = capsys.readouterr();
    expect(captured.err).toContain("conflicts with");
    expect(captured.err).toContain("ignored");
    expect(group._lazy_subcommands.get("config")).toBe(_CORE_COMMANDS["config"]);
  });

  it("test_invalid_target_is_skipped_with_warning", async () => {
    // A target outside `_SHORTCUT_TARGET_MAP` is dropped with a warning.
    const group = buildGroup({ xyz: "nonexistent command" });
    const captured = capsys.readouterr();
    expect(captured.err).toContain("Invalid shortcut ignored");
    expect(captured.err).toContain('without the "ebx" prefix');
    expect(captured.err).toContain("Available targets:");
    const ctx = new Context(group);
    expect(await group.listCommands(ctx)).not.toContain("xyz");
    expect(await group.getCommand(ctx, "xyz")).toBeNull();
  });

  // BLOCKED-ON: cli/commands/* (every core command group is loaded by get_command)
  it.skipIf(!["sandbox", "config_cmd", "mcp", "template"].every(commandModuleExists))(
    "test_corrupted_config_keeps_core_commands_working",
    async () => {
      // `loadShortcuts()` returns {} on a corrupted file: core groups survive.
      const group = buildGroup({});
      const ctx = new Context(group);
      for (const name of Object.keys(_CORE_COMMANDS).sort()) {
        const cmd = await group.getCommand(ctx, name);
        expect(cmd, `core command ${JSON.stringify(name)} disappeared`).not.toBeNull();
        expect(cmd!.name).toBe(name);
      }
    },
  );

  it("registry: empty shortcut table leaves exactly the core commands, without loading any module", async () => {
    const group = buildGroup({});
    const ctx = new Context(group);
    expect(await group.listCommands(ctx)).toEqual(Object.keys(_CORE_COMMANDS).sort());
  });
});

/** `_parse_toml`: stdlib `tomllib.loads` as plain objects (integers stay integers, tables become objects). */
function parseTomlText(text: string): Record<string, Record<string, unknown>> {
  const toPlain = (value: unknown): unknown => (value instanceof Map ? Object.fromEntries([...value].map(([k, v]) => [k, toPlain(v)])) : value);
  return toPlain(parseToml(text)) as Record<string, Record<string, unknown>>;
}

const runner = (): CliRunner => new CliRunner();

// ---------------------------------------------------------------------------
// Part 1b - config subcommands: TOML round-trip
// ---------------------------------------------------------------------------

describe("TestConfigSetShortcutsTomlRoundTrip", () => {
  // ``ebx config set`` keeps the untouched TOML sections intact.

  it("test_set_shortcut_preserves_transport_section", async () => {
    // Adding a shortcut never damages the existing ``[transport]`` table.
    const tmp = iso.tmp_path;
    const configFile = path.join(tmp, "config.toml");
    fs.writeFileSync(configFile, '[transport]\nregion = "cn-hangzhou"\nhttp_timeout = 60\n\n[shortcuts]\ncreate = "sandbox create"\n');
    const result = await withConfig(storagePatch(tmp), () => runner().invoke(cli, ["config", "set", "shortcuts.ps", "sandbox process list"]));

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("Set shortcut ps = sandbox process list");
    const data = parseTomlText(fs.readFileSync(configFile, "utf8"));
    expect(data["transport"]).toEqual({ region: "cn-hangzhou", http_timeout: 60 });
    expect(data["shortcuts"]["ps"]).toBe("sandbox process list");
    expect(data["shortcuts"]["create"]).toBe("sandbox create");
  });

  it("test_set_region_preserves_shortcuts_section", async () => {
    // Rewriting ``[transport]`` never drops the configured shortcuts.
    const tmp = iso.tmp_path;
    const configFile = path.join(tmp, "config.toml");
    fs.writeFileSync(
      configFile,
      '[transport]\nregion = "cn-hangzhou"\n\n[shortcuts]\ncreate = "sandbox create"\nps = "sandbox process list"\n',
    );
    const result = await withConfig(storagePatch(tmp), () => runner().invoke(cli, ["config", "set", "region", "cn-shanghai"]));

    expect(result.exit_code, result.output).toBe(0);
    const data = parseTomlText(fs.readFileSync(configFile, "utf8"));
    expect(data["transport"]["region"]).toBe("cn-shanghai");
    expect(data["shortcuts"]).toEqual({ create: "sandbox create", ps: "sandbox process list" });
  });
});

// ---------------------------------------------------------------------------
// Part 1c - config init: section generation and reset
// ---------------------------------------------------------------------------

describe("TestConfigInitShortcuts", () => {
  // ``ebx config init`` writes / resets the ``[shortcuts]`` section.

  it("test_interactive_init_writes_full_shortcuts_section", async () => {
    // Guided setup materialises a config file carrying the default shortcuts.
    const tmp = iso.tmp_path;
    const configFile = path.join(tmp, "config.toml");
    const result = await withConfig({ ...storagePatch(tmp), sys: fakeTtySys() }, () =>
      runner().invoke(cli, ["config", "init"], { input: "\ncn-shanghai\n\n\n\n\n" }),
    );

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("Added default shortcuts");
    const data = parseTomlText(fs.readFileSync(configFile, "utf8"));
    expect(data["transport"]["region"]).toBe("cn-shanghai");
    expect(data["shortcuts"]).toEqual({ ..._DEFAULT_SHORTCUTS });
  });

  it("test_reset_shortcuts_restores_defaults_keeps_transport", async () => {
    // ``--reset-shortcuts`` restores defaults and preserves ``[transport]``.
    const tmp = iso.tmp_path;
    const configFile = path.join(tmp, "config.toml");
    fs.writeFileSync(configFile, '[transport]\nregion = "cn-hangzhou"\n\n[shortcuts]\nps = "sandbox process list"\n');
    const result = await withConfig(storagePatch(tmp), () => runner().invoke(cli, ["config", "init", "--reset-shortcuts"]));

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("Reset [shortcuts]");
    const data = parseTomlText(fs.readFileSync(configFile, "utf8"));
    expect(data["transport"]["region"]).toBe("cn-hangzhou");
    expect(data["shortcuts"]).toEqual({ ..._DEFAULT_SHORTCUTS });
    expect(data["shortcuts"]).not.toHaveProperty("ps");
  });
});

// ---------------------------------------------------------------------------
// Part 1d - config get / list / set surface
// ---------------------------------------------------------------------------

describe("TestConfigShortcutsQueries", () => {
  // ``ebx config get/list/set`` surface the configured shortcuts.

  function writeConfig(tmp: string): string {
    const configFile = path.join(tmp, "config.toml");
    fs.writeFileSync(configFile, '[transport]\n\n[shortcuts]\ncreate = "sandbox create"\nps = "sandbox process list"\n');
    return configFile;
  }

  it("test_config_list_shows_shortcuts_with_sources", async () => {
    // Each alias is listed, annotated as default or user-defined.
    const tmp = iso.tmp_path;
    writeConfig(tmp);
    const result = await withConfig(storagePatch(tmp), () => runner().invoke(cli, ["config", "list"]));

    expect(result.exit_code).toBe(0);
    const lines = result.output.split("\n");
    const createLine = lines.find((ln) => ln.startsWith("shortcuts.create"))!;
    expect(createLine).toContain("sandbox create");
    expect(createLine).toContain("(default)");
    const psLine = lines.find((ln) => ln.startsWith("shortcuts.ps"))!;
    expect(psLine).toContain("sandbox process list");
    expect(psLine).toContain("(user)");
  });

  it("test_config_get_shortcuts_shows_all_aliases", async () => {
    const tmp = iso.tmp_path;
    writeConfig(tmp);
    const result = await withConfig(storagePatch(tmp), () => runner().invoke(cli, ["config", "get", "shortcuts"]));

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("create");
    expect(result.output).toContain("sandbox create");
    expect(result.output).toContain("ps");
    expect(result.output).toContain("sandbox process list");
  });

  it("test_config_get_single_shortcut_shows_target", async () => {
    const tmp = iso.tmp_path;
    writeConfig(tmp);
    const result = await withConfig(storagePatch(tmp), () => runner().invoke(cli, ["config", "get", "shortcuts.create"]));

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("sandbox create");
  });

  it("test_config_set_empty_value_removes_shortcut", async () => {
    // ``config set shortcuts.create ""`` deletes the alias, keeps the rest.
    const tmp = iso.tmp_path;
    const configFile = writeConfig(tmp);
    const result = await withConfig(storagePatch(tmp), () => runner().invoke(cli, ["config", "set", "shortcuts.create", ""]));

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("Removed shortcut 'create'");
    const data = parseTomlText(fs.readFileSync(configFile, "utf8"));
    expect(data["shortcuts"]).not.toHaveProperty("create");
    expect(data["shortcuts"]["ps"]).toBe("sandbox process list");
  });

  it("test_set_shortcut_with_ebx_prefix_names_the_fix", async () => {
    // ``ebx template init`` is rejected with the command to retry. First-time users type the invocation they
    // already know. The error must say to drop ``ebx`` and show the corrected command, instead of a flat list of every
    // target.
    const tmp = iso.tmp_path;
    const configFile = writeConfig(tmp);
    const result = await withConfig(storagePatch(tmp), () =>
      runner().invoke(cli, ["config", "set", "shortcuts.aaaaa", "ebx template init"]),
    );

    const shown = result.output + (result.stderr || "");
    expect(result.exit_code, shown).toBe(2);
    expect(shown).toContain("Invalid shortcut target: 'ebx template init'");
    expect(shown).toContain('Drop the leading "ebx"');
    expect(shown).toContain('for example "template init"');
    expect(shown).toContain('Try: ebx config set shortcuts.aaaaa "template init"');
    expect(shown).not.toContain("Available targets:");
    const data = parseTomlText(fs.readFileSync(configFile, "utf8"));
    expect(data["shortcuts"]).not.toHaveProperty("aaaaa");
  });

  it("test_set_shortcut_unknown_target_explains_the_path_rule", async () => {
    // An unknown path states the rule and groups the legal targets.
    const tmp = iso.tmp_path;
    writeConfig(tmp);
    const result = await withConfig(storagePatch(tmp), () =>
      runner().invoke(cli, ["config", "set", "shortcuts.aaaaa", "not-a-command"]),
    );

    const shown = result.output + (result.stderr || "");
    expect(result.exit_code, shown).toBe(2);
    expect(shown).toContain('without the "ebx" prefix');
    expect(shown).toContain('for example "template init"');
    expect(shown).toContain("Available targets:");
    expect(shown).toContain("template: build, init, install, search");
    expect(shown).toContain("sandbox: connect, create, download, exec, files list");
  });
});
