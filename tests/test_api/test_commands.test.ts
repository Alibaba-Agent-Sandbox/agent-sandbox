/** Tests for the CommandsModule API. */

import { describe, expect, it } from "vitest";

import { CommandsModule } from "../../src/api/commands.js";
import { ProcessChunk, ProcessChunkType, ProcessInfo, ProcessResult } from "../../src/models/process.js";
import { MockStreamReader as _MockStreamReader, TEST_ENVD_URL, makeCommandsModule } from "./conftest.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const chunk = (type: ProcessChunkType, rest: Record<string, unknown> = {}) => new ProcessChunk({ type, ...rest });

describe("TestCommandsParsing", () => {
  // Test command string parsing.
  it("test_parse_simple_command", () => {
    const [cmd, args] = CommandsModule._parseCmd("echo hello");
    expect(cmd).toBe("echo");
    expect(args).toEqual(["hello"]);
  });

  it("test_parse_command_no_args", () => {
    const [cmd, args] = CommandsModule._parseCmd("ls");
    expect(cmd).toBe("ls");
    expect(args).toEqual([]);
  });

  it("test_parse_command_with_quotes", () => {
    const [cmd, args] = CommandsModule._parseCmd('echo "hello world"');
    expect(cmd).toBe("echo");
    expect(args).toEqual(["hello world"]);
  });

  it("test_parse_complex_command", () => {
    const [cmd, args] = CommandsModule._parseCmd("python3 -c 'print(1)'");
    expect(cmd).toBe("python3");
    expect(args).toEqual(["-c", "print(1)"]);
  });

  const cases: [string, string][] = [
    ["ls /tmp | grep log", "sh"],
    ["echo a && echo b", "sh"],
    ["echo hi 2>&1", "sh"],
    ["echo a; echo b", "sh"],
    ["cat < file.txt", "sh"],
    ["echo $(date)", "sh"],
    ["python3 -c 'print(1|2)'", "python3"], // inside quotes, no wrap
    ['grep -r "a|b" .', "grep"], // inside quotes, no wrap
    ["echo hello", "echo"], // simple, no wrap
    ["ls -la /tmp", "ls"], // simple with args, no wrap
  ];
  for (const [cmd, expected_exe] of cases) {
    it(`test_parse_cmd_shell_wrap [${cmd}-${expected_exe}]`, () => {
      // Commands with unquoted shell operators are wrapped in sh -c.
      const [exe, args] = CommandsModule._parseCmd(cmd);
      expect(exe).toBe(expected_exe);
      if (expected_exe === "sh") {
        expect(args[0]).toBe("-c");
        expect(args[1]).toBe(cmd);
      }
    });
  }
});

describe("TestCommandsRun", () => {
  // Test CommandsModule.run().
  it("test_run_returns_process_result", async () => {
    const { module: commands_module } = makeCommandsModule();
    const result = (await commands_module.run("echo hello")) as ProcessResult;
    expect(result).toBeInstanceOf(ProcessResult);
    expect(result.stdout).toBe("hello\n");
    expect(result.exit_code).toBe(0);
  });

  it("test_run_passes_parsed_command", async () => {
    const { module: commands_module, process_protocol } = makeCommandsModule();
    process_protocol.start.mockResolvedValue(
      new _MockStreamReader([chunk(ProcessChunkType.STDOUT, { data: "output\n" }), chunk(ProcessChunkType.EXIT, { exit_code: 0 })]),
    );
    await commands_module.run("ls -la /app");
    const call_kwargs = process_protocol.start.mock.calls.at(-1)[2];
    expect(call_kwargs["cmd"]).toBe("ls");
    expect(call_kwargs["args"]).toEqual(["-la", "/app"]);
  });

  it("test_run_shell_always_uses_sh", async () => {
    const { module: commands_module, process_protocol } = makeCommandsModule();
    process_protocol.start.mockResolvedValue(
      new _MockStreamReader([chunk(ProcessChunkType.STDOUT, { data: "/tmp\n" }), chunk(ProcessChunkType.EXIT, { exit_code: 0 })]),
    );
    await commands_module.run("cd /tmp && echo $HOME", { shell: true });
    const call_kwargs = process_protocol.start.mock.calls.at(-1)[2];
    expect(call_kwargs["cmd"]).toBe("sh");
    expect(call_kwargs["args"]).toEqual(["-c", "cd /tmp && echo $HOME"]);
  });

  it("test_run_passes_env_and_cwd", async () => {
    const { module: commands_module, process_protocol } = makeCommandsModule();
    process_protocol.start.mockResolvedValue(new _MockStreamReader([chunk(ProcessChunkType.EXIT, { exit_code: 0 })]));
    await commands_module.run("echo test", { env: { FOO: "bar" }, cwd: "/tmp", timeout: 120 });
    const call_kwargs = process_protocol.start.mock.calls.at(-1)[2];
    expect(call_kwargs["env"]).toEqual({ FOO: "bar" });
    expect(call_kwargs["cwd"]).toBe("/tmp");
    expect(call_kwargs["timeout"]).toBe(120);
  });

  it("test_run_uses_envd_url_and_token", async () => {
    const { module: commands_module, process_protocol } = makeCommandsModule();
    process_protocol.start.mockResolvedValue(new _MockStreamReader([chunk(ProcessChunkType.EXIT, { exit_code: 0 })]));
    await commands_module.run("echo hello");
    const call_args = process_protocol.start.mock.calls.at(-1);
    expect(call_args[0]).toBe(TEST_ENVD_URL); // envd_url positional arg
  });
});

describe("TestCommandsStream", () => {
  // Test CommandsModule.stream().
  it("test_stream_yields_chunks", async () => {
    const { module: commands_module, process_protocol } = makeCommandsModule();
    const chunks = [
      chunk(ProcessChunkType.STDOUT, { data: "line1\n" }),
      chunk(ProcessChunkType.STDOUT, { data: "line2\n" }),
      chunk(ProcessChunkType.EXIT, { exit_code: 0 }),
    ];

    // Create a proper async-iterable mock
    class _MockReader {
      _items: ProcessChunk[];
      constructor(items: ProcessChunk[]) {
        this._items = items;
      }
      [Symbol.asyncIterator]() {
        return this;
      }
      async next(): Promise<IteratorResult<ProcessChunk>> {
        if (!this._items.length) return { done: true, value: undefined };
        return { done: false, value: this._items.shift() as ProcessChunk };
      }
    }

    process_protocol.start.mockResolvedValue(new _MockReader([...chunks]));

    const collected: ProcessChunk[] = [];
    for await (const c of commands_module.stream("echo test")) collected.push(c);

    expect(collected.length).toBe(3);
    expect(collected[0]!.type).toBe(ProcessChunkType.STDOUT);
    expect(collected[0]!.data).toBe("line1\n");
    expect(collected[2]!.type).toBe(ProcessChunkType.EXIT);
  });
});

describe("TestCommandsList", () => {
  // Test CommandsModule.list().
  it("test_list_returns_processes", async () => {
    const { module: commands_module } = makeCommandsModule();
    const result = await commands_module.list();
    expect(result.length).toBe(1);
    expect(result[0]).toBeInstanceOf(ProcessInfo);
    expect(result[0]!.pid).toBe(1234);
  });
});

describe("TestCommandsKill", () => {
  // Test CommandsModule.kill().
  it("test_kill_calls_protocol", async () => {
    const { module: commands_module, process_protocol } = makeCommandsModule();
    await commands_module.kill(1234);
    expect(process_protocol.kill).toHaveBeenCalledTimes(1);
    const call_kwargs = process_protocol.kill.mock.calls[0][2];
    expect(call_kwargs["pid"]).toBe(1234);
  });
});

describe("TestCommandsSendStdin", () => {
  // Test CommandsModule.send_stdin().
  it("test_send_stdin_forwards_data", async () => {
    const { module: commands_module, process_protocol } = makeCommandsModule();
    await commands_module.sendStdin(1234, "input data\n");
    expect(process_protocol.sendInput).toHaveBeenCalledTimes(1);
    const call_kwargs = process_protocol.sendInput.mock.calls[0][2];
    expect(call_kwargs["pid"]).toBe(1234);
    expect(call_kwargs["data"]).toBe("input data\n");
  });
});

describe("TestCommandsUserParam", () => {
  // Test that the `user` parameter propagates into the protocol payload.
  it("test_run_passes_user_to_protocol", async () => {
    const { module: commands_module, process_protocol } = makeCommandsModule();
    process_protocol.start.mockResolvedValue(new _MockStreamReader([chunk(ProcessChunkType.EXIT, { exit_code: 0 })]));
    await commands_module.run("echo hi", { user: "root" });
    const call_kwargs = process_protocol.start.mock.calls.at(-1)[2];
    expect(call_kwargs["user"]).toBe("root");
  });

  it("test_run_default_user", async () => {
    const { module: commands_module, process_protocol } = makeCommandsModule();
    process_protocol.start.mockResolvedValue(new _MockStreamReader([chunk(ProcessChunkType.EXIT, { exit_code: 0 })]));
    await commands_module.run("echo hi");
    const call_kwargs = process_protocol.start.mock.calls.at(-1)[2];
    expect(call_kwargs["user"]).toBe("");
  });

  it("test_stream_passes_user_to_protocol", async () => {
    const { module: commands_module, process_protocol } = makeCommandsModule();
    process_protocol.start.mockResolvedValue(new _MockStreamReader([chunk(ProcessChunkType.EXIT, { exit_code: 0 })]));
    for await (const _ of commands_module.stream("echo hi", { user: "admin" })) void _;
    const call_kwargs = process_protocol.start.mock.calls.at(-1)[2];
    expect(call_kwargs["user"]).toBe("admin");
  });

  it("test_start_passes_user_to_protocol", async () => {
    const { module: commands_module, process_protocol } = makeCommandsModule();
    process_protocol.start.mockResolvedValue(new _MockStreamReader([chunk(ProcessChunkType.EXIT, { exit_code: 0 })]));
    await commands_module.start("echo hi", { user: "deploy" });
    const call_kwargs = process_protocol.start.mock.calls.at(-1)[2];
    expect(call_kwargs["user"]).toBe("deploy");
  });
});

describe("TestCommandsBackground", () => {
  // Test that background=True delegates to start() and returns a handle.
  it("test_background_returns_stream_reader", async () => {
    // background=True should return a StreamReader-like handle, not ProcessResult.
    const { module: commands_module, process_protocol } = makeCommandsModule();
    const mock_reader = new _MockStreamReader([
      chunk(ProcessChunkType.STDOUT, { data: "bg\n" }),
      chunk(ProcessChunkType.EXIT, { exit_code: 0 }),
    ]);
    process_protocol.start.mockResolvedValue(mock_reader);
    const result = await commands_module.run("sleep 10", { background: true });
    // Should NOT be a ProcessResult — it should be the reader handle
    expect(result).not.toBeInstanceOf(ProcessResult);
    // Should be async-iterable (the handle from start())
    expect(Symbol.asyncIterator in (result as object)).toBe(true);
  });

  it("test_background_false_returns_process_result", async () => {
    const { module: commands_module, process_protocol } = makeCommandsModule();
    process_protocol.start.mockResolvedValue(
      new _MockStreamReader([chunk(ProcessChunkType.STDOUT, { data: "done\n" }), chunk(ProcessChunkType.EXIT, { exit_code: 0 })]),
    );
    const result = (await commands_module.run("echo done", { background: false })) as ProcessResult;
    expect(result).toBeInstanceOf(ProcessResult);
    expect(result.stdout).toBe("done\n");
  });

  it("test_background_propagates_all_params", async () => {
    // background=True should forward timeout, env, cwd, user to start().
    const { module: commands_module, process_protocol } = makeCommandsModule();
    process_protocol.start.mockResolvedValue(new _MockStreamReader([chunk(ProcessChunkType.EXIT, { exit_code: 0 })]));
    await commands_module.run("ls", { timeout: 30, env: { A: "1" }, cwd: "/tmp", user: "root", background: true });
    const call_kwargs = process_protocol.start.mock.calls.at(-1)[2];
    expect(call_kwargs["timeout"]).toBe(30);
    expect(call_kwargs["env"]).toEqual({ A: "1" });
    expect(call_kwargs["cwd"]).toBe("/tmp");
    expect(call_kwargs["user"]).toBe("root");
  });
});
