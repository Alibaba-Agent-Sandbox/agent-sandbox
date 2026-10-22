import { useMockCloudConfiguration } from "../_support/mockCloudConfiguration.js";
/** Tests for `abx exec` / `abx sandbox exec`: wait (default), `--stream`, `--background`, `--env`, argv handling. */

import "../_support/isolatedHome.js";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Sandbox } from "../../src/api/sandbox.js";
import { _execCommandLine } from "../../src/cli/commands/sandbox.js";
import { cli } from "../../src/cli/main.js";
import { CommandTimeoutError } from "../../src/models/errors.js";
import { ProcessChunk, ProcessChunkType, ProcessResult } from "../../src/models/process.js";
import { CliRunner } from "../helpers/cliRunner.js";

const runner = (): CliRunner => new CliRunner();

afterEach(() => {
  vi.restoreAllMocks();
});

async function* gen(chunks: ProcessChunk[]) {
  for (const c of chunks) yield c;
}

function _sandbox() {
  const sb = {
    id: "sbx-1",
    commands: {
      run: vi.fn(),
      stream: vi.fn(),
      start: vi.fn(),
    },
  };
  vi.spyOn(Sandbox, "connect").mockResolvedValue(sb as unknown as Sandbox);
  return sb;
}

describe("TestExecCommandLine", () => {
  it("test_single_argument_is_the_command_line", () => {
    expect(_execCommandLine(["ls /app | wc -l"])).toBe("ls /app | wc -l");
  });

  it("test_several_arguments_are_quoted_exactly", () => {
    expect(_execCommandLine(["python", "-c", "print('hi there')"])).toBe(`python -c 'print('"'"'hi there'"'"')'`);
    expect(_execCommandLine(["echo", "a b", "c"])).toBe("echo 'a b' c");
  });
});

describe("TestExecWait", () => {
  it("test_exec_propagates_exit_code_and_output", async () => {
    const sb = _sandbox();
    sb.commands.run.mockResolvedValue(new ProcessResult({ stdout: "out\n", stderr: "err\n", exit_code: 3, execution_time: 0.1 }));

    const result = await runner().invoke(cli, ["exec", "sbx-1", "--", "false"]);

    expect(result.exit_code).toBe(3);
    expect(result.stdout).toBe("out\n");
    expect(result.stderr).toBe("err\n");
  });

  it("test_exec_forwards_cwd_env_timeout", async () => {
    const sb = _sandbox();
    sb.commands.run.mockResolvedValue(new ProcessResult({ stdout: "", stderr: "", exit_code: 0, execution_time: 0 }));

    const result = await runner().invoke(cli, [
      "exec", "sbx-1", "--cwd", "/app", "-e", "A=1", "--env", "B=two=2", "--timeout", "7", "--", "pytest", "-q",
    ]);

    expect(result.exit_code, result.output).toBe(0);
    expect(sb.commands.run).toHaveBeenCalledWith("pytest -q", { timeout: 7, cwd: "/app", env: { A: "1", B: "two=2" } });
  });

  it("test_sandbox_exec_is_the_same_command", async () => {
    const sb = _sandbox();
    sb.commands.run.mockResolvedValue(new ProcessResult({ stdout: "ok\n", stderr: "", exit_code: 0, execution_time: 0 }));

    const a = await runner().invoke(cli, ["exec", "sbx-1", "--", "echo", "ok"]);
    const b = await runner().invoke(cli, ["sandbox", "exec", "sbx-1", "--", "echo", "ok"]);

    expect([a.exit_code, a.output]).toEqual([b.exit_code, b.output]);
    expect(sb.commands.run).toHaveBeenCalledTimes(2);
  });

  it("test_exec_json", async () => {
    const sb = _sandbox();
    sb.commands.run.mockResolvedValue(new ProcessResult({ stdout: "hi\n", stderr: "", exit_code: 0, execution_time: 0.2 }));

    const result = await runner().invoke(cli, ["--json", "exec", "sbx-1", "--", "echo", "hi"]);

    expect(result.exit_code).toBe(0);
    expect(JSON.parse(result.output)).toMatchObject({ stdout: "hi\n", exit_code: 0 });
  });

  it("test_exec_invalid_env_is_a_usage_error", async () => {
    _sandbox();
    const result = await runner().invoke(cli, ["exec", "sbx-1", "--env", "NOPE", "--", "true"]);
    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("KEY=VALUE");
  });

  it("test_exec_requires_a_command", async () => {
    const result = await runner().invoke(cli, ["exec", "sbx-1"]);
    expect(result.exit_code).toBe(2);
  });

  it("test_exec_timeout_error_exit_code", async () => {
    const sb = _sandbox();
    sb.commands.run.mockRejectedValue(new CommandTimeoutError("timed out"));
    const result = await runner().invoke(cli, ["exec", "sbx-1", "--", "sleep", "9999"]);
    expect(result.exit_code).toBe(5);
  });
});

describe("TestExecStream", () => {
  const chunk = (type: ProcessChunkType, data = "", exit_code: number | null = null) => new ProcessChunk({ type, data, exit_code });

  it("test_stream_routes_channels_and_exit_code", async () => {
    const sb = _sandbox();
    sb.commands.stream.mockReturnValue(
      gen([chunk(ProcessChunkType.STDOUT, "o1"), chunk(ProcessChunkType.STDERR, "e1"), chunk(ProcessChunkType.STDOUT, ""), chunk(ProcessChunkType.EXIT, "", 4)]),
    );

    const result = await runner().invoke(cli, ["exec", "--stream", "sbx-1", "--", "make"]);

    expect(result.exit_code).toBe(4);
    expect(result.stdout).toBe("o1");
    expect(result.stderr).toBe("e1");
    expect(sb.commands.stream).toHaveBeenCalledWith("make", { timeout: 60, cwd: "", env: null });
    expect(sb.commands.run).not.toHaveBeenCalled();
  });

  it("test_stream_json_reports_exit_code", async () => {
    const sb = _sandbox();
    sb.commands.stream.mockReturnValue(gen([chunk(ProcessChunkType.EXIT, "", 0)]));
    const result = await runner().invoke(cli, ["--json", "exec", "--stream", "sbx-1", "--", "true"]);
    expect(result.exit_code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ exit_code: 0 });
  });
});

describe("TestExecBackground", () => {
  const started = (...chunks: ProcessChunk[]) => ({ [Symbol.asyncIterator]: () => gen(chunks) });

  it("test_background_prints_pid_and_returns_immediately", async () => {
    const sb = _sandbox();
    sb.commands.start.mockResolvedValue(started(new ProcessChunk({ type: ProcessChunkType.STDOUT, data: "", pid: 4242 })));

    const result = await runner().invoke(cli, ["exec", "--background", "sbx-1", "--", "python", "-m", "http.server"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(result.stdout).toBe("4242\n");
    expect(sb.commands.start).toHaveBeenCalledWith("python -m http.server", { timeout: 60, cwd: "", env: null });
    expect(sb.commands.run).not.toHaveBeenCalled();
  });

  it("test_background_json", async () => {
    const sb = _sandbox();
    sb.commands.start.mockResolvedValue(started(new ProcessChunk({ type: ProcessChunkType.STDOUT, data: "", pid: 7 })));
    const result = await runner().invoke(cli, ["--json", "exec", "--background", "sbx-1", "--", "sleep", "100"]);
    expect(JSON.parse(result.stdout)).toEqual({ pid: 7 });
  });

  it("test_background_without_pid_fails", async () => {
    const sb = _sandbox();
    sb.commands.start.mockResolvedValue(started(new ProcessChunk({ type: ProcessChunkType.EXIT, exit_code: 127 })));
    const result = await runner().invoke(cli, ["exec", "--background", "sbx-1", "--", "nope"]);
    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("process id");
  });

  it("test_background_and_stream_are_exclusive", async () => {
    _sandbox();
    const result = await runner().invoke(cli, ["exec", "--background", "--stream", "sbx-1", "--", "true"]);
    expect(result.exit_code).not.toBe(0);
    expect(result.output).toContain("cannot be combined");
  });
});

// Remote APIs in this file are mocked; provide configuration without bypassing preflight.
useMockCloudConfiguration();
