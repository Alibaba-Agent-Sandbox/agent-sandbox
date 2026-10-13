/** Tests for `abx run` / `abx sandbox command run|list` (named commands registered on the in-sandbox server). */

import "../_support/isolatedHome.js";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Sandbox } from "../../src/api/sandbox.js";
import { cli } from "../../src/cli/main.js";
import { CommandNotFoundError, ConnectionError_ } from "../../src/models/errors.js";
import { CommandResult } from "../../src/models/process.js";
import { CliRunner } from "../helpers/cliRunner.js";

const runner = (): CliRunner => new CliRunner();

afterEach(() => {
  vi.restoreAllMocks();
});

function _mockSandbox(extra: Record<string, unknown>) {
  const sb = { ...extra };
  vi.spyOn(Sandbox, "connect").mockResolvedValue(sb as unknown as Sandbox);
  return sb;
}

describe("TestRunCommand", () => {
  it("test_run_dispatches_server_command", async () => {
    const runCommand = vi.fn().mockResolvedValue(new CommandResult({ value: "built!", exit_code: 0 }));
    _mockSandbox({ runCommand });

    const result = await runner().invoke(cli, ["run", "sbx-1", "build"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("built!");
    expect(runCommand).toHaveBeenCalledWith("build", {}, { server_port: 9000 });
  });

  it("test_run_with_args_and_alias_are_equivalent", async () => {
    const runCommand = vi.fn().mockResolvedValue(new CommandResult({ value: 42, exit_code: 0 }));
    _mockSandbox({ runCommand });

    for (const argv of [
      ["run", "sbx-1", "deploy", "--arg", "target=staging", "-a", "n=2"],
      ["sandbox", "command", "run", "sbx-1", "deploy", "--arg", "target=staging", "-a", "n=2"],
    ]) {
      const result = await runner().invoke(cli, argv);
      expect(result.exit_code, result.output).toBe(0);
      expect(result.output).toContain("42");
    }
    expect(runCommand).toHaveBeenCalledTimes(2);
    for (const call of runCommand.mock.calls) {
      expect(call).toEqual(["deploy", { target: "staging", n: "2" }, { server_port: 9000 }]);
    }
  });

  it("test_run_json_args_and_custom_port", async () => {
    const runCommand = vi.fn().mockResolvedValue(new CommandResult({ value: { sum: 3 }, exit_code: 0 }));
    _mockSandbox({ runCommand });

    const result = await runner().invoke(cli, ["--json", "run", "sbx-1", "add", "--json-args", '{"x": 1, "y": 2}', "--server-port", "8123"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("sum");
    expect(runCommand).toHaveBeenCalledWith("add", { x: 1, y: 2 }, { server_port: 8123 });
  });

  it("test_run_invalid_arg_format", async () => {
    const result = await runner().invoke(cli, ["run", "sbx-1", "build", "--arg", "badformat"]);
    expect(result.exit_code).toBe(2);
  });

  it("test_run_invalid_json_args", async () => {
    const result = await runner().invoke(cli, ["run", "sbx-1", "build", "--json-args", "[1]"]);
    expect(result.exit_code).toBe(2);
  });

  it("test_run_failed_command_exits_1", async () => {
    const runCommand = vi.fn().mockResolvedValue(new CommandResult({ stderr: "RuntimeError: boom", exit_code: 1 }));
    _mockSandbox({ runCommand });

    const result = await runner().invoke(cli, ["run", "sbx-1", "bad"]);

    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("RuntimeError: boom");
  });

  it("test_run_unknown_command_reports_not_found", async () => {
    _mockSandbox({ runCommand: vi.fn().mockRejectedValue(new CommandNotFoundError("bad", { server_status: "HTTP 404", suggestion: "List the registered commands with 'abx sandbox command list SANDBOX_ID'." })) });

    const result = await runner().invoke(cli, ["run", "sbx-1", "bad"]);

    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("not found");
    expect(result.output).toContain("abx sandbox command list");
  });

  it("test_run_without_server_errors_cleanly", async () => {
    _mockSandbox({ runCommand: vi.fn().mockRejectedValue(new ConnectionError_("No SandboxServer reachable in sandbox sbx-1 on port 9000.")) });

    const result = await runner().invoke(cli, ["run", "sbx-1", "build"]);

    expect(result.exit_code).not.toBe(0);
    expect(result.output).toContain("No SandboxServer reachable");
    expect(result.output).not.toContain("at ");
  });
});

describe("TestCommandList", () => {
  const COMMANDS = [{ name: "add", description: "Add numbers", args: [{ name: "x", type: "int", required: true }, { name: "y", type: "int", required: false }] }];

  it("test_command_list_table", async () => {
    const listCommands = vi.fn().mockResolvedValue(COMMANDS);
    _mockSandbox({ listCommands });

    const result = await runner().invoke(cli, ["sandbox", "command", "list", "sbx-1"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("add");
    expect(result.output).toContain("x:int, y?:int");
    expect(listCommands).toHaveBeenCalledWith({ server_port: 9000 });
  });

  it("test_command_list_json", async () => {
    _mockSandbox({ listCommands: vi.fn().mockResolvedValue(COMMANDS) });

    const result = await runner().invoke(cli, ["--json", "sandbox", "command", "list", "sbx-1"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(JSON.parse(result.output)).toEqual(COMMANDS);
  });

  it("test_command_list_empty", async () => {
    _mockSandbox({ listCommands: vi.fn().mockResolvedValue([]) });

    const result = await runner().invoke(cli, ["sandbox", "command", "list", "sbx-1"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("No commands are registered");
  });

  it("test_command_list_without_server_errors_cleanly", async () => {
    _mockSandbox({ listCommands: vi.fn().mockRejectedValue(new ConnectionError_("No SandboxServer reachable in sandbox sbx-1 on port 9000.")) });

    const result = await runner().invoke(cli, ["sandbox", "command", "list", "sbx-1"]);

    expect(result.exit_code).not.toBe(0);
    expect(result.output).toContain("No SandboxServer reachable");
  });
});
