/** Tests for protocol.process module — envd process management. */

import { describe, expect, it, vi } from "vitest";

import { ProcessChunk, ProcessChunkType, ProcessInfo } from "../../src/models/process.js";
import { _HTTP_TIMEOUT_BUFFER, ProcessProtocol, _parseProcessChunk } from "../../src/protocol/process.js";
import { EnvdTokenManager } from "../../src/transport/auth.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const envd_token = () => new EnvdTokenManager("test-envd-token");
const envd_url = () => "https://envd-sbx-123.example.com";

function _makeMockHttp(opts: { envd_request_return?: Record<string, any> | null; stream_frames?: Record<string, any>[] | null } = {}): any {
  const { envd_request_return = null, stream_frames = null } = opts;
  const mock: any = {};
  mock.envdRequest = vi.fn(async () => (envd_request_return !== null ? envd_request_return : {}));

  if (stream_frames !== null) {
    mock.envdStream = async function* (..._args: any[]) {
      for (const frame of stream_frames) yield frame;
    };
  } else {
    mock.envdStream = async function* (..._args: any[]) {
      return;
    };
  }
  return mock;
}

const b64 = (s: string) => Buffer.from(s).toString("base64");

// =============================================================================
// Tests for _parse_process_chunk
// =============================================================================

describe("TestParseProcessChunk", () => {
  it("test_stdout_frame", () => {
    const raw = b64("hello world\n");
    const chunk = _parseProcessChunk({ event: { data: { stdout: raw } } });
    expect(chunk.type).toBe(ProcessChunkType.STDOUT);
    expect(chunk.data).toBe("hello world\n");
  });

  it("test_stderr_frame", () => {
    const raw = b64("error msg\n");
    const chunk = _parseProcessChunk({ event: { data: { stderr: raw } } });
    expect(chunk.type).toBe(ProcessChunkType.STDERR);
    expect(chunk.data).toBe("error msg\n");
  });

  it("test_exit_frame", () => {
    const chunk = _parseProcessChunk({ event: { end: { exitCode: 0 } } });
    expect(chunk.type).toBe(ProcessChunkType.EXIT);
    expect(chunk.exit_code).toBe(0);
  });

  it("test_exit_frame_nonzero", () => {
    const chunk = _parseProcessChunk({ event: { end: { exitCode: 42 } } });
    expect(chunk.type).toBe(ProcessChunkType.EXIT);
    expect(chunk.exit_code).toBe(42);
  });

  it("test_start_event", () => {
    const chunk = _parseProcessChunk({ event: { start: { pid: 123 } } });
    expect(chunk.type).toBe(ProcessChunkType.STDOUT);
    expect(chunk.pid).toBe(123);
  });

  it("test_empty_frame", () => {
    const chunk = _parseProcessChunk({});
    expect(chunk.type).toBe(ProcessChunkType.STDOUT);
    expect(chunk.data).toBe("");
  });
});

// =============================================================================
// Tests for ProcessProtocol
// =============================================================================

describe("TestStart", () => {
  it("test_start_returns_stream_reader", async () => {
    const stdout_b64 = b64("hello");
    const mock_http = _makeMockHttp({
      stream_frames: [
        { event: { start: { pid: 1 } } },
        { event: { data: { stdout: stdout_b64 } } },
        { event: { end: { exitCode: 0 } } },
      ],
    });
    const proto = new ProcessProtocol(mock_http);
    const reader = await proto.start(envd_url(), envd_token(), { cmd: "echo", args: ["hello"] });

    const chunks: ProcessChunk[] = [];
    for await (const chunk of reader) chunks.push(chunk);

    // Filter out empty start event
    const data_chunks = chunks.filter((c) => c.data || c.type === ProcessChunkType.EXIT);
    expect(data_chunks.some((c) => c.type === ProcessChunkType.STDOUT && c.data === "hello")).toBe(true);
    expect(data_chunks.some((c) => c.type === ProcessChunkType.EXIT && c.exit_code === 0)).toBe(true);
  });

  it("test_start_passes_default_timeout_to_http", async () => {
    // start() with default timeout=60 should pass request_timeout=65.0.
    const captured_kwargs: Record<string, any> = {};

    const spy_envd_stream = (_url: any, _path: any, kwargs: Record<string, any>) => {
      Object.assign(captured_kwargs, kwargs);
      return (async function* () {
        return;
      })();
    };

    const mock_http: any = { envdStream: spy_envd_stream };

    const proto = new ProcessProtocol(mock_http);
    await proto.start(envd_url(), envd_token(), { cmd: "echo", args: ["hi"] });

    expect("request_timeout" in captured_kwargs).toBe(true);
    expect(captured_kwargs["request_timeout"]).toBe(60.0 + _HTTP_TIMEOUT_BUFFER);
  });

  it("test_start_passes_custom_timeout_to_http", async () => {
    // start(timeout=300) should pass request_timeout=305.0.
    const captured_kwargs: Record<string, any> = {};

    const spy_envd_stream = (_url: any, _path: any, kwargs: Record<string, any>) => {
      Object.assign(captured_kwargs, kwargs);
      return (async function* () {
        return;
      })();
    };

    const mock_http: any = { envdStream: spy_envd_stream };

    const proto = new ProcessProtocol(mock_http);
    await proto.start(envd_url(), envd_token(), { cmd: "pip", args: ["install", "pandas"], timeout: 300 });

    expect(captured_kwargs["request_timeout"]).toBe(300.0 + _HTTP_TIMEOUT_BUFFER);
  });

  it("test_start_timeout_buffer_constant", () => {
    // The HTTP timeout buffer should be a positive value.
    expect(_HTTP_TIMEOUT_BUFFER).toBeGreaterThan(0);
    expect(typeof _HTTP_TIMEOUT_BUFFER).toBe("number");
  });
});

describe("TestListProcesses", () => {
  it("test_parses_response", async () => {
    const mock_http = _makeMockHttp({
      envd_request_return: {
        processes: [
          { pid: 1, command: "bash", status: "running" },
          { pid: 42, command: "python", status: "running" },
        ],
      },
    });
    const proto = new ProcessProtocol(mock_http);
    const result = await proto.listProcesses(envd_url(), envd_token());

    expect(result.length).toBe(2);
    expect(result.every((p) => p instanceof ProcessInfo)).toBe(true);
    expect(result[0]!.pid).toBe(1);
    expect(result[1]!.pid).toBe(42);
    expect(result[1]!.command).toBe("python");
  });

  it("test_empty_list", async () => {
    const mock_http = _makeMockHttp({ envd_request_return: { processes: [] } });
    const proto = new ProcessProtocol(mock_http);
    const result = await proto.listProcesses(envd_url(), envd_token());
    expect(result).toEqual([]);
  });

  it("test_result_wrapper", async () => {
    const mock_http = _makeMockHttp({
      envd_request_return: { result: { processes: [{ pid: 5, command: "node" }] } },
    });
    const proto = new ProcessProtocol(mock_http);
    const result = await proto.listProcesses(envd_url(), envd_token());
    expect(result.length).toBe(1);
    expect(result[0]!.pid).toBe(5);
  });
});

describe("TestSendStdin", () => {
  // Test ProcessProtocol.send_stdin() (backward compat alias for send_input).
  it("test_sends_payload", async () => {
    const mock_http = _makeMockHttp();
    const proto = new ProcessProtocol(mock_http);
    await proto.sendStdin(envd_url(), envd_token(), { pid: 42, data: "input\n" });

    expect(mock_http.envdRequest).toHaveBeenCalledTimes(1);
    const call_kwargs = mock_http.envdRequest.mock.calls[0][2];
    expect(call_kwargs.payload).toEqual({ process: { pid: 42 }, input: { stdin: Buffer.from("input\n", "utf-8").toString("base64") } });
  });
});

describe("TestKillProcess", () => {
  // Test ProcessProtocol.kill() — now delegates to send_signal(signal=9).
  it("test_sends_payload", async () => {
    const mock_http = _makeMockHttp();
    const proto = new ProcessProtocol(mock_http);
    await proto.kill(envd_url(), envd_token(), { pid: 42 });

    expect(mock_http.envdRequest).toHaveBeenCalledTimes(1);
    const call_kwargs = mock_http.envdRequest.mock.calls[0][2];
    expect(call_kwargs.payload).toEqual({ process: { pid: 42 }, signal: "SIGNAL_SIGKILL" });
  });
});

// =============================================================================
// Boundary test: envd payload isolation from Server os.environ
// =============================================================================

describe("TestEnvdPayloadIsolation", () => {
  // ProcessProtocol.start() must only include per-call env= in the RPC payload.
  const _SERVER_INJECTED_VAR = "_EBX_BOUNDARY_SERVER_ONLY";
  const _SERVER_INJECTED_VALUE = "should_not_appear_in_payload";

  it("test_start_env_param_only_in_payload", async () => {
    const original = process.env[_SERVER_INJECTED_VAR];
    process.env[_SERVER_INJECTED_VAR] = _SERVER_INJECTED_VALUE;
    try {
      const captured_payload: Record<string, any> = {};
      const spy_envd_stream = (_u: any, _p: any, kwargs: Record<string, any>) => {
        Object.assign(captured_payload, kwargs["payload"] ?? {});
        return (async function* () {
          return;
        })();
      };
      const mock_http: any = { envdStream: spy_envd_stream };

      const proto = new ProcessProtocol(mock_http);
      const per_call_env = { MY_CALL_VAR: "hello" };
      await proto.start(envd_url(), envd_token(), { cmd: "echo", args: ["test"], env: per_call_env });

      const process_obj = captured_payload["process"];
      expect(process_obj["envs"]).toEqual({ MY_CALL_VAR: "hello" });
      const payload_str = JSON.stringify(captured_payload);
      expect(payload_str).not.toContain(_SERVER_INJECTED_VAR);
      expect(payload_str).not.toContain(_SERVER_INJECTED_VALUE);
    } finally {
      if (original === undefined) delete process.env[_SERVER_INJECTED_VAR];
      else process.env[_SERVER_INJECTED_VAR] = original;
    }
  });

  it("test_start_no_env_param_means_no_env_vars_key", async () => {
    const original = process.env[_SERVER_INJECTED_VAR];
    process.env[_SERVER_INJECTED_VAR] = _SERVER_INJECTED_VALUE;
    try {
      const captured_payload: Record<string, any> = {};
      const spy_envd_stream = (_u: any, _p: any, kwargs: Record<string, any>) => {
        Object.assign(captured_payload, kwargs["payload"] ?? {});
        return (async function* () {
          return;
        })();
      };
      const mock_http: any = { envdStream: spy_envd_stream };

      const proto = new ProcessProtocol(mock_http);
      await proto.start(envd_url(), envd_token(), { cmd: "ls" });

      const process_obj = captured_payload["process"];
      expect("envVars" in process_obj).toBe(false);
      const payload_str = JSON.stringify(captured_payload);
      expect(payload_str).not.toContain(_SERVER_INJECTED_VAR);
    } finally {
      if (original === undefined) delete process.env[_SERVER_INJECTED_VAR];
      else process.env[_SERVER_INJECTED_VAR] = original;
    }
  });
});
