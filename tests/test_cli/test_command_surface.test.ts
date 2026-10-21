/**
 * The CLI command surface is fixed: `abx --help` lists exactly the documented groups and shortcuts, and nothing the
 * redesign removed comes back. `docs/{en,zh}/reference/cli-commands.md` documents the same set.
 */

import "../_support/isolatedHome.js";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { GROUP_COMMANDS, HELP_GROUPS, SHORTCUTS, TOP_LEVEL_COMMANDS } from "../../src/cli/command_surface.js";
import { cli } from "../../src/cli/main.js";
import { CliRunner } from "../helpers/cliRunner.js";

const runner = (): CliRunner => new CliRunner();

const GROUPS = ["sandbox", "template", "config", "mcp", "provider"];
const SHORTCUT_NAMES = ["create", "list", "info", "kill", "exec", "connect", "upload", "download", "run", "deploy"];
const SHORTCUT_TARGETS: Record<string, string> = {
  create: "sandbox create",
  list: "sandbox list",
  info: "sandbox info",
  kill: "sandbox kill",
  exec: "sandbox exec",
  connect: "sandbox connect",
  upload: "sandbox upload",
  download: "sandbox download",
  run: "sandbox command run",
  deploy: "template deploy",
};

/** The command names listed in one `--help` section ("Command groups:", "Sandbox shortcuts:", ...). */
function section(output: string, title: string): string[] {
  const lines = output.split("\n");
  const start = lines.indexOf(`${title}:`);
  if (start < 0) return [];
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) break;
    if (!/^ {2}\S/.test(line)) continue; // wrapped description line
    names.push(line.trim().split(/\s+/)[0]!);
  }
  return names;
}

function docSet(file: string, heading: string): string[] {
  const text = readFileSync(fileURLToPath(new URL(`../../docs/${file}`, import.meta.url)), "utf8");
  const block = text.split(heading)[1]?.split("\n\n")[1] ?? "";
  return [...block.matchAll(/`abx ([a-z]+)`/g)].map((m) => m[1]!);
}

describe("TestFixedCommandSurface", () => {
  it("test_fixed_set_in_code", () => {
    expect(Object.keys(GROUP_COMMANDS)).toEqual(GROUPS);
    expect(Object.keys(SHORTCUTS)).toEqual(SHORTCUT_NAMES);
    expect([...TOP_LEVEL_COMMANDS].sort()).toEqual([...GROUPS, ...SHORTCUT_NAMES].sort());
    for (const g of HELP_GROUPS) expect(GROUPS).toContain(g);
  });

  it("test_root_command_list_is_exactly_the_documented_set", async () => {
    const names = cli.listCommands();
    expect([...names].sort()).toEqual([...GROUPS, ...SHORTCUT_NAMES].sort());
  });

  it("test_root_help_lists_groups_provider_and_shortcuts_under_headings", async () => {
    const result = await runner().invoke(cli, ["--help"]);
    expect(result.exit_code).toBe(0);
    expect(section(result.output, "Command groups")).toEqual(["sandbox", "template", "config", "mcp"]);
    expect(section(result.output, "Providers")).toEqual(["provider"]);
    expect(section(result.output, "Sandbox shortcuts")).toEqual(SHORTCUT_NAMES);
    const help = result.output.replace(/\s+/g, " ");
    for (const [name, target] of Object.entries(SHORTCUT_TARGETS)) {
      expect(help).toMatch(new RegExp(` ${name} [A-Z][^.]+\\. \\(alias: abx ${target}\\)`));
    }
  });

  it("test_root_help_has_no_other_command_section", async () => {
    const result = await runner().invoke(cli, ["--help"]);
    expect(result.output).not.toMatch(/^Commands:$/m);
  });

  it("test_shortcuts_resolve_to_the_canonical_command_objects", async () => {
    const sandbox = (await cli.getCommand("sandbox"))!;
    const template = (await cli.getCommand("template"))!;
    for (const name of ["create", "list", "info", "kill", "exec", "connect", "upload", "download"]) {
      const top = await cli.getCommand(name);
      expect(top, name).not.toBeNull();
      expect(top).toBe(await sandbox.getCommand(name));
    }
    expect(await cli.getCommand("deploy")).not.toBeNull();
    expect(await template.getCommand("deploy")).not.toBeNull();
  });

  it("test_removed_top_level_commands_stay_removed", async () => {
    for (const name of ["init", "install", "shell-stream", "process", "files", "system", "capabilities", "agent", "auth"]) {
      expect(await cli.getCommand(name), name).toBeNull();
    }
  });

  it("test_removed_global_options_stay_removed", async () => {
    const help = (await runner().invoke(cli, ["--help"])).output;
    expect(help).not.toContain("--profile");
    expect(help).not.toMatch(/^\s+-t, --timeout/m);
    expect(help).not.toMatch(/^\s+--timeout/m);
    for (const argv of [["--profile", "x", "list"], ["-p", "x", "list"], ["--timeout", "5", "list"], ["-t", "5", "list"]]) {
      const result = await runner().invoke(cli, argv);
      expect(result.exit_code, argv.join(" ")).toBe(2);
      expect(result.output).toContain("No such option");
    }
  });

  it("test_removed_subcommands_stay_removed", async () => {
    for (const argv of [["sandbox", "shell-stream", "x"], ["sandbox", "process", "start", "x"], ["sandbox", "run", "x", "y"]]) {
      const result = await runner().invoke(cli, argv);
      expect(result.exit_code, argv.join(" ")).toBe(2);
      expect(result.output).toContain("No such command");
    }
  });

  it("test_sandbox_lifetime_timeout_lives_on_create_only", async () => {
    const create = (await runner().invoke(cli, ["create", "--help"])).output;
    expect(create).toContain("--timeout");
    for (const argv of [["list", "--help"], ["info", "--help"], ["kill", "--help"], ["deploy", "--help"]]) {
      const out = (await runner().invoke(cli, argv)).output;
      expect(out, argv.join(" ")).not.toMatch(/--timeout[^\n]*(lifetime|Sandbox lifetime)/i);
    }
  });

  it("test_groups_have_exactly_the_documented_children", async () => {
    const expected: Record<string, string[]> = {
      sandbox: ["capabilities", "command", "connect", "create", "download", "exec", "files", "info", "kill", "list", "process", "system", "upload"],
      "sandbox files": ["list", "mkdir", "mv", "rm", "search", "stat"],
      "sandbox process": ["info", "list", "signal"],
      "sandbox command": ["list", "run"],
      "sandbox system": ["env", "info", "metrics", "packages", "ports"],
      template: ["build", "delete", "deploy", "from-image", "info", "install", "launch", "list", "push", "scaffold", "search"],
      config: ["delete", "get", "init", "list", "set"],
      mcp: ["deploy", "install", "start", "status", "stop"],
    };
    for (const [path, children] of Object.entries(expected)) {
      const result = await runner().invoke(cli, [...path.split(" "), "--help"]);
      expect(result.exit_code, path).toBe(0);
      expect(section(result.output, "Commands").sort(), path).toEqual(children);
    }
  });

  it("test_reference_page_documents_the_same_fixed_set", () => {
    for (const lang of ["en", "zh"]) {
      const file = `${lang}/reference/cli-commands.md`;
      const text = readFileSync(fileURLToPath(new URL(`../../docs/${file}`, import.meta.url)), "utf8");
      for (const name of [...GROUPS, ...SHORTCUT_NAMES]) expect(text, `${file}: ${name}`).toContain(`\`abx ${name}\``);
      expect(docSet(file, "<!-- fixed-set -->").sort(), file).toEqual([...GROUPS, ...SHORTCUT_NAMES].sort());
    }
  });
});
