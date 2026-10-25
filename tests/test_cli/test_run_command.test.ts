import { useMockCloudConfiguration } from "../_support/mockCloudConfiguration.js";
/** Tests for `abx run` / `abx sandbox command run|list` (named commands registered on the in-sandbox server). */

import "../_support/isolatedHome.js";

import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

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

  it.each([
    { name: "execution failure JSON", status: 500, body: { error: "fixture failure", type: "RuntimeError" }, json: true, alias: false, exit: 1, message: "RuntimeError: fixture failure", code: "E3000" },
    { name: "validation failure alias JSON", status: 400, body: { error: "fixture validation", type: "ValidationError" }, json: true, alias: true, exit: 1, message: "ValidationError: fixture validation", code: "E3000" },
    { name: "execution failure text", status: 500, body: { error: "fixture failure", type: "RuntimeError" }, json: false, alias: false, exit: 1, message: "RuntimeError: fixture failure" },
    { name: "nullable success JSON", status: 200, body: { result: null }, json: true, alias: false, exit: 0 },
    { name: "unknown command JSON", status: 404, body: { error: "not found", type: "CommandNotFoundError" }, json: true, alias: false, exit: 2, code: "E3005" },
  ])("preserves $name through the dispatcher and HTTP error mapping", async testCase => {
    let requests = 0;
    const server = createServer((request, response) => {
      requests++;
      expect(request.method).toBe("POST");
      expect(request.url).toBe("/commands/fixture");
      response.writeHead(testCase.status, { "content-type": "application/json" });
      response.end(JSON.stringify(testCase.body));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const sandbox = Object.create(Sandbox.prototype) as Sandbox;
    // Replace cloud connection/transport only: keep the actual HTTP-to-CommandResult mapping.
    Object.assign(sandbox, { _callServerCommand: async (name: string, _port: number, args: Record<string, unknown>) => {
      const response = await fetch(`${endpoint}/commands/${name}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args),
      });
      return [{ is_success: response.ok, status_code: response.status }, await response.json()];
    } });
    vi.spyOn(Sandbox, "connect").mockResolvedValue(sandbox);
    try {
      const argv = [...(testCase.json ? ["--json"] : []), ...(testCase.alias ? ["sandbox", "command", "run"] : ["run"]), "fixture-sandbox", "fixture"];
      const result = await runner().invoke(cli, argv);
      expect(requests).toBe(1);
      expect(result.exit_code, result.output).toBe(testCase.exit);
      if (!testCase.json) {
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(`${testCase.message}\n`);
      } else {
        const output = JSON.parse(result.stdout);
        expect(result.stderr).toBe("");
        if (testCase.exit === 0) expect(output).toEqual({ result: null });
        else {
          expect(output).toMatchObject({ status: "error", code: testCase.code });
          if (testCase.message) expect(output.message).toBe(testCase.message);
          expect(output).not.toHaveProperty("result");
        }
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
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

// Remote APIs in this file are mocked; provide configuration without bypassing preflight.
useMockCloudConfiguration();
