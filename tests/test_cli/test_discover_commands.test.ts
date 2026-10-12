/**
 * Tests for `_discoverRegisteredCommands` security hardening.
 *
 * Validates the opt-in gate (env var / .ebx marker) and safe-filename filter.
 *
 * Python executes the matched files, which registers functions on the `declarative.decorator.sandbox` singleton. A
 * Python file cannot be executed from Node, so `sandboxSeams.discoverImport` is replaced by a stand-in "loader" that
 * records every `@sandbox.register`ed function of the file in a fake registry (and throws on a syntax error, like
 * `exec_module`).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { _discoverRegisteredCommands, sandboxSeams } from "../../src/cli/commands/sandbox.js";

const _REGISTER_SCRIPT = `from easy_sandbox.declarative.decorator import sandbox

@sandbox.register
def discovered_cmd(x: int) -> int:
    return x * 2
`;

const registry = new Set<string>();
let projectDir = "";
let savedCwd = "";
let savedImport: typeof sandboxSeams.discoverImport;
let savedEnv: string | undefined;

beforeEach(() => {
  registry.clear();
  savedImport = sandboxSeams.discoverImport;
  sandboxSeams.discoverImport = (_moduleName, file) => {
    const text = fs.readFileSync(file, "utf-8");
    if (/def \w+\(:/.test(text)) throw new Error("SyntaxError: invalid syntax");
    for (const m of text.matchAll(/@sandbox\.register\s*\n\s*def\s+(\w+)/g)) registry.add(m[1]!);
  };
  savedCwd = process.cwd();
  projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ebx-discover-")));
  fs.writeFileSync(path.join(projectDir, "my_commands.py"), _REGISTER_SCRIPT, "utf-8");
  process.chdir(projectDir);
  savedEnv = process.env["EBX_DISCOVER_COMMANDS"];
  delete process.env["EBX_DISCOVER_COMMANDS"];
});

afterEach(() => {
  sandboxSeams.discoverImport = savedImport;
  process.chdir(savedCwd);
  if (savedEnv === undefined) delete process.env["EBX_DISCOVER_COMMANDS"];
  else process.env["EBX_DISCOVER_COMMANDS"] = savedEnv;
  fs.rmSync(projectDir, { recursive: true, force: true });
});

const write = (name: string, text: string): void => fs.writeFileSync(path.join(projectDir, name), text, "utf-8");
const scriptNamed = (cmd: string): string => _REGISTER_SCRIPT.replace("discovered_cmd", cmd);

// ---------------------------------------------------------------------------
// Opt-in gate
// ---------------------------------------------------------------------------

describe("TestOptInGate", () => {
  // Discovery requires explicit opt-in.

  it("test_no_opt_in_does_not_scan", async () => {
    // Without env var or .ebx marker, nothing is imported.
    const before = new Set(registry);
    await _discoverRegisteredCommands();
    expect(new Set(registry)).toEqual(before);
  });

  it("test_env_var_enables_discovery", async () => {
    process.env["EBX_DISCOVER_COMMANDS"] = "1";
    await _discoverRegisteredCommands();
    expect(registry.has("discovered_cmd")).toBe(true);
  });

  it("test_env_var_true_string", async () => {
    process.env["EBX_DISCOVER_COMMANDS"] = "true";
    await _discoverRegisteredCommands();
    expect(registry.has("discovered_cmd")).toBe(true);
  });

  it("test_env_var_yes_string", async () => {
    process.env["EBX_DISCOVER_COMMANDS"] = "yes";
    await _discoverRegisteredCommands();
    expect(registry.has("discovered_cmd")).toBe(true);
  });

  it("test_ebx_marker_file_enables_discovery", async () => {
    write(".ebx", "");
    await _discoverRegisteredCommands();
    expect(registry.has("discovered_cmd")).toBe(true);
  });

  it("test_ebx_marker_dir_enables_discovery", async () => {
    fs.mkdirSync(path.join(projectDir, ".ebx"));
    await _discoverRegisteredCommands();
    expect(registry.has("discovered_cmd")).toBe(true);
  });

  it("test_env_var_zero_does_not_enable", async () => {
    process.env["EBX_DISCOVER_COMMANDS"] = "0";
    const before = new Set(registry);
    await _discoverRegisteredCommands();
    expect(new Set(registry)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Filename safety
// ---------------------------------------------------------------------------

describe("TestFilenameSafety", () => {
  // Only valid Python identifiers are imported.

  it("test_dotted_filename_skipped", async () => {
    // A file like `foo.bar.py` (invalid identifier stem) is skipped.
    process.env["EBX_DISCOVER_COMMANDS"] = "1";
    write("foo.bar.py", scriptNamed("dotted_cmd"));
    await _discoverRegisteredCommands();
    expect(registry.has("dotted_cmd")).toBe(false);
  });

  it("test_hyphenated_filename_skipped", async () => {
    process.env["EBX_DISCOVER_COMMANDS"] = "1";
    write("my-commands.py", scriptNamed("hyph_cmd"));
    await _discoverRegisteredCommands();
    expect(registry.has("hyph_cmd")).toBe(false);
  });

  it("test_numeric_start_filename_skipped", async () => {
    process.env["EBX_DISCOVER_COMMANDS"] = "1";
    write("1evil.py", scriptNamed("num_cmd"));
    await _discoverRegisteredCommands();
    expect(registry.has("num_cmd")).toBe(false);
  });

  it("test_underscore_filename_allowed", async () => {
    process.env["EBX_DISCOVER_COMMANDS"] = "1";
    write("_private_cmds.py", scriptNamed("priv_cmd"));
    await _discoverRegisteredCommands();
    expect(registry.has("priv_cmd")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("TestDiscoverEdgeCases", () => {
  // Misc edge cases.

  it("test_file_without_register_ignored", async () => {
    // Files not containing 'sandbox.register' are not imported.
    process.env["EBX_DISCOVER_COMMANDS"] = "1";
    write("utils.py", "x = 42\n");
    const before = new Set(registry);
    await _discoverRegisteredCommands();
    // Only the register script should be imported
    expect(registry.has("discovered_cmd")).toBe(true);
    // utils.py should NOT have triggered any registration
    const newCmds = new Set([...registry].filter((name) => !before.has(name)));
    expect(newCmds.has("x")).toBe(false);
  });

  it("test_broken_file_silently_skipped", async () => {
    // A file with syntax errors should not crash discovery.
    process.env["EBX_DISCOVER_COMMANDS"] = "1";
    write("broken_cmds.py", "sandbox.register\ndef bad(:\n");

    // Should not raise
    await _discoverRegisteredCommands();
  });
});
