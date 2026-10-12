/** Tests for sandbox process CLI commands: list, start, info, signal. */

import "../_support/isolatedHome.js";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Sandbox } from "../../src/api/sandbox.js";
import { cli } from "../../src/cli/main.js";
import { CommandTimeoutError, ExecutionError } from "../../src/models/errors.js";
import { ProcessInfo, ProcessResult } from "../../src/models/process.js";
import { CliRunner } from "../helpers/cliRunner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const runner = (): CliRunner => new CliRunner();

/** Build a lightweight mock Sandbox for process-command tests. */
function _makeSandbox() {
  return {
    id: "sbx-test-001",
    capabilities: new Set(["shell", "files", "code"]),
    commands: {
      run: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
      sendSignal: vi.fn().mockResolvedValue(undefined),
    },
    kill: vi.fn().mockResolvedValue(undefined),
  };
}

function _patchConnect(sb: ReturnType<typeof _makeSandbox>) {
  return vi.spyOn(Sandbox, "connect").mockResolvedValue(sb as unknown as Sandbox);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ===================================================================
// sandbox process list
// ===================================================================

describe("TestProcessList", () => {
  it("test_list_non_empty", async () => {
    // Three processes returned -> table output.
    const sb = _makeSandbox();
    sb.commands.list = vi.fn().mockResolvedValue([
      new ProcessInfo({ pid: 1, command: "/sbin/init", status: "running" }),
      new ProcessInfo({ pid: 42, command: "python app.py", status: "running" }),
      new ProcessInfo({ pid: 99, command: "node server.js", status: "sleeping" }),
    ]);
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "process", "list", "sbx-test-001"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("42");
    expect(result.output).toContain("python");
  });

  it("test_list_empty", async () => {
    const sb = _makeSandbox();
    sb.commands.list = vi.fn().mockResolvedValue([]);
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "process", "list", "sbx-test-001"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("No processes");
  });

  it("test_list_json", async () => {
    const sb = _makeSandbox();
    sb.commands.list = vi.fn().mockResolvedValue([new ProcessInfo({ pid: 10, command: "bash", status: "running" })]);
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["--json", "sandbox", "process", "list", "sbx-test-001"]);
    expect(result.exit_code).toBe(0);
    const data = JSON.parse(result.output);
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].pid).toBe(10);
  });

  it("test_list_missing_sandbox_id", async () => {
    const result = await runner().invoke(cli, ["sandbox", "process", "list"]);
    expect(result.exit_code).toBe(2);
  });
});

// ===================================================================
// sandbox process start
// ===================================================================

describe("TestProcessStart", () => {
  it("test_start_happy", async () => {
    // exit_code=0 -> runner exit_code=0.
    const sb = _makeSandbox();
    sb.commands.run = vi
      .fn()
      .mockResolvedValue(new ProcessResult({ stdout: "ok\n", stderr: "", exit_code: 0, execution_time: 0.5 }));
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "process", "start", "sbx-test-001", "-c", "echo ok"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("ok");
  });

  it("test_start_nonzero_exit", async () => {
    // Nonzero exit_code is propagated to the CLI runner.
    const sb = _makeSandbox();
    sb.commands.run = vi
      .fn()
      .mockResolvedValue(new ProcessResult({ stdout: "", stderr: "fail\n", exit_code: 42, execution_time: 0.1 }));
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "process", "start", "sbx-test-001", "-c", "badcmd"]);
    expect(result.exit_code).toBe(42);
  });

  it("test_start_timeout_cwd", async () => {
    // --timeout and --cwd are forwarded to commands.run.
    const sb = _makeSandbox();
    sb.commands.run = vi
      .fn()
      .mockResolvedValue(new ProcessResult({ stdout: "", stderr: "", exit_code: 0, execution_time: 0.01 }));
    _patchConnect(sb);
    await runner().invoke(cli, [
      "sandbox",
      "process",
      "start",
      "sbx-test-001",
      "-c",
      "make build",
      "--timeout",
      "60",
      "--cwd",
      "/app",
    ]);
    expect(sb.commands.run).toHaveBeenCalledTimes(1);
    expect(sb.commands.run).toHaveBeenCalledWith("make build", { timeout: 60, cwd: "/app" });
  });

  it("test_start_json", async () => {
    const sb = _makeSandbox();
    sb.commands.run = vi
      .fn()
      .mockResolvedValue(new ProcessResult({ stdout: "hi\n", stderr: "", exit_code: 0, execution_time: 0.2 }));
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["--json", "sandbox", "process", "start", "sbx-test-001", "-c", "echo hi"]);
    expect(result.exit_code).toBe(0);
    const data = JSON.parse(result.output);
    expect(data.stdout).toBe("hi\n");
    expect(data.exit_code).toBe(0);
  });

  it("test_start_missing_command", async () => {
    // --command is required -> exit 2.
    const result = await runner().invoke(cli, ["sandbox", "process", "start", "sbx-test-001"]);
    expect(result.exit_code).toBe(2);
  });

  it("test_start_timeout_error", async () => {
    const sb = _makeSandbox();
    sb.commands.run = vi.fn().mockRejectedValue(new CommandTimeoutError("timed out"));
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "process", "start", "sbx-test-001", "-c", "sleep 9999"]);
    expect(result.exit_code).toBe(5);
  });
});

// ===================================================================
// sandbox process info
// ===================================================================

describe("TestProcessInfo", () => {
  it("test_info_happy", async () => {
    // ps returns one data line -> info printed.
    const sb = _makeSandbox();
    sb.commands.run = vi.fn().mockResolvedValue(
      new ProcessResult({
        stdout: "  1234   1  root  Ss  4096  00:05:12  python\n",
        stderr: "",
        exit_code: 0,
      }),
    );
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "process", "info", "sbx-test-001", "1234"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("1234");
  });

  it("test_info_not_found", async () => {
    // ps exits 1 with empty stdout -> not found, exit 1.
    const sb = _makeSandbox();
    sb.commands.run = vi.fn().mockResolvedValue(new ProcessResult({ stdout: "", stderr: "", exit_code: 1 }));
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "process", "info", "sbx-test-001", "99999"]);
    expect(result.exit_code).toBe(1);
    expect(result.output.toLowerCase()).toContain("not found");
  });

  it("test_info_pid_non_integer", async () => {
    // PID argument type=int rejects non-integer.
    const result = await runner().invoke(cli, ["sandbox", "process", "info", "sbx-test-001", "abc"]);
    expect(result.exit_code).toBe(2);
  });
});

// ===================================================================
// sandbox process signal
// ===================================================================

describe("TestProcessSignal", () => {
  it("test_signal_default_sigterm", async () => {
    // Default signal is 15 (SIGTERM).
    const sb = _makeSandbox();
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "process", "signal", "sbx-test-001", "1234"]);
    expect(result.exit_code).toBe(0);
    expect(sb.commands.sendSignal).toHaveBeenCalledTimes(1);
    expect(sb.commands.sendSignal).toHaveBeenCalledWith(1234, 15);
  });

  it("test_signal_explicit_9", async () => {
    // --signal 9 sends SIGKILL.
    const sb = _makeSandbox();
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "process", "signal", "sbx-test-001", "1234", "--signal", "9"]);
    expect(result.exit_code).toBe(0);
    expect(sb.commands.sendSignal).toHaveBeenCalledTimes(1);
    expect(sb.commands.sendSignal).toHaveBeenCalledWith(1234, 9);
  });

  it("test_signal_pid_non_integer", async () => {
    const result = await runner().invoke(cli, ["sandbox", "process", "signal", "sbx-test-001", "abc"]);
    expect(result.exit_code).toBe(2);
  });

  it("test_signal_not_found", async () => {
    const sb = _makeSandbox();
    sb.commands.sendSignal = vi.fn().mockRejectedValue(new ExecutionError("process not found"));
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "process", "signal", "sbx-test-001", "9999"]);
    expect(result.exit_code).toBe(1);
  });
});
