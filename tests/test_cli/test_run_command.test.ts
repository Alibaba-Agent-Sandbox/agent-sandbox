/** Tests for `ebx run` CLI command. */

import "../_support/isolatedHome.js";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Sandbox } from "../../src/api/sandbox.js";
import { cli } from "../../src/cli/main.js";
import { CommandResult } from "../../src/models/process.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { ALL_COMMANDS, useDefaultShortcutsOnly } from "./conftest.js";

useDefaultShortcutsOnly();

const runner = (): CliRunner => new CliRunner();

afterEach(() => {
  vi.restoreAllMocks();
});

/** Mock `Sandbox.connect`; `run_cmd` connects and dispatches inside one async function, so nothing else is patched. */
function _makeRunPatches(mockSandbox: unknown) {
  return vi.spyOn(Sandbox, "connect").mockResolvedValue(mockSandbox as Sandbox);
}

describe("TestRunCommand", () => {
  // Test `ebx run <sandbox_id> <command_name> [--arg ...]`.

  it("test_run_dispatches_custom_command", async () => {
    // Basic happy-path: ebx run sbx-1 build.
    const mockResult = new CommandResult({ value: "built!", stdout: "built!\n", stderr: "", exit_code: 0, execution_time: 1.2, source: "template" });
    _makeRunPatches({ custom: vi.fn().mockResolvedValue(mockResult) });

    const result = await runner().invoke(cli, ["run", "sbx-1", "build"]);

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("built!");
  });

  it("test_run_with_args", async () => {
    // ebx run sbx-1 deploy --arg target=staging.
    const mockResult = new CommandResult({ value: "deployed", stdout: "deployed\n", stderr: "", exit_code: 0, execution_time: 2.0, source: "template" });
    const custom = vi.fn().mockResolvedValue(mockResult);
    _makeRunPatches({ custom });

    const result = await runner().invoke(cli, ["run", "sbx-1", "deploy", "--arg", "target=staging"]);

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("deployed");
    expect(custom).toHaveBeenCalledWith("deploy", { server_port: 9000, target: "staging" });
  });

  it("test_run_invalid_arg_format", async () => {
    // --arg without '=' should report error.
    const result = await runner().invoke(cli, ["run", "sbx-1", "build", "--arg", "badformat"]);
    expect(result.exit_code).toBe(2);
  });

  it("test_run_json_output", async () => {
    // ebx --json run sbx-1 test.
    const mockResult = new CommandResult({ value: "pass", stdout: "pass\n", stderr: "", exit_code: 0, execution_time: 0.5, source: "template" });
    _makeRunPatches({ custom: vi.fn().mockResolvedValue(mockResult) });

    const result = await runner().invoke(cli, ["--json", "run", "sbx-1", "test"]);

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("exit_code");
  });

  // BLOCKED-ON: cli/commands/* (the root --help listing loads every command module)
  it.skipIf(!ALL_COMMANDS)("test_run_registered_in_cli", async () => {
    // The 'run' subcommand should appear in --help.
    const result = await runner().invoke(cli, ["--help"]);
    expect(result.output).toContain("run");
  });

  // BLOCKED-ON: cli/commands/* (the root --help listing loads every command module)
  it.skipIf(!ALL_COMMANDS)("test_exec_still_works", async () => {
    // 'exec' should remain in --help (backward compat).
    const result = await runner().invoke(cli, ["--help"]);
    expect(result.output).toContain("exec");
  });
});
