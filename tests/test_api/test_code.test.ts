/** Tests for the CodeContextModule API. */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { resolveCapabilities } from "../../src/api/capability.js";
import { CodeContextModule } from "../../src/api/code.js";
import { NotImplementedError, RuntimeError } from "../../src/api/_pyerrors.js";
import { CapabilityNotSupportedError, TemplateParseError } from "../../src/models/errors.js";
import { CodeResult, ProcessChunk, ProcessChunkType } from "../../src/models/process.js";
import { CodeInterpreterProtocol } from "../../src/protocol/code_interpreter.js";
import { HTTPStatusError, Request, Response } from "../../src/transport/_httpx.js";
import { EnvdTokenManager } from "../../src/transport/auth.js";
import {
  MockStreamReader as _MockStreamReader,
  captureLogs,
  makeCodeModule,
  mockCodeInterpreterProtocol,
  mockProcessProtocol,
} from "./conftest.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const dedent = (s: string): string => {
  const lines = s.split("\n");
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length));
  return lines.map((l) => l.slice(indent)).join("\n");
};

describe("TestCodeRun", () => {
  // Test CodeContextModule.run().
  it("test_run_returns_code_result", async () => {
    const { module: code_module } = makeCodeModule();
    const result = await code_module.run("print(42)");
    expect(result).toBeInstanceOf(CodeResult);
    expect(result.text).toBe("42");
    expect(result.stdout).toBe("42\n");
    expect(result.exit_code).toBe(0);
  });

  it("test_run_calls_run_code", async () => {
    const { module: code_module, code_interpreter_protocol } = makeCodeModule();
    await code_module.run("print('ok')", { language: "python", timeout: 60 });

    expect(code_interpreter_protocol.runCode).toHaveBeenCalledTimes(1);
    const call_kwargs = code_interpreter_protocol.runCode.mock.calls[0][3];
    expect(call_kwargs["code"]).toBe("print('ok')");
    expect(call_kwargs["language"]).toBe("python");
    expect(call_kwargs["timeout"]).toBe(60);
  });

  it("test_run_javascript", async () => {
    const { module: code_module, code_interpreter_protocol } = makeCodeModule();
    code_interpreter_protocol.runCode.mockResolvedValue({ stdout: "hello\n", stderr: "", exitCode: 0, executionTime: 0.01 });

    const result = await code_module.run("console.log('hello')", { language: "javascript" });
    expect(result.text).toBe("hello");

    const call_kwargs = code_interpreter_protocol.runCode.mock.calls[0][3];
    expect(call_kwargs["language"]).toBe("javascript");
  });

  it("test_run_with_timeout", async () => {
    const { module: code_module, code_interpreter_protocol } = makeCodeModule();
    await code_module.run("x = 1", { timeout: 120 });

    const call_kwargs = code_interpreter_protocol.runCode.mock.calls[0][3];
    expect(call_kwargs["timeout"]).toBe(120);
  });

  it("test_run_with_context_id", async () => {
    const { module: code_module, code_interpreter_protocol } = makeCodeModule();
    await code_module.run("x = 1", { context_id: "ctx-test-123" });

    const call_kwargs = code_interpreter_protocol.runCode.mock.calls[0][3];
    expect(call_kwargs["context_id"]).toBe("ctx-test-123");
  });

  it("test_run_captures_stderr", async () => {
    const { module: code_module, code_interpreter_protocol } = makeCodeModule();
    code_interpreter_protocol.runCode.mockResolvedValue({
      stdout: "",
      stderr: "NameError: name 'foo' is not defined\n",
      exitCode: 1,
      executionTime: 0.02,
    });

    const result = await code_module.run("foo");
    expect(result.exit_code).toBe(1);
    expect(result.stderr).toContain("NameError");
    expect(result.success).toBe(false);
  });

  it("test_run_result_wrapper", async () => {
    // Test handling of response with 'result' wrapper.
    const { module: code_module, code_interpreter_protocol } = makeCodeModule();
    code_interpreter_protocol.runCode.mockResolvedValue({
      result: { stdout: "wrapped\n", stderr: "", exitCode: 0, executionTime: 0.01 },
    });

    const result = await code_module.run("print('wrapped')");
    expect(result.text).toBe("wrapped");
    expect(result.stdout).toBe("wrapped\n");
  });
});

describe("TestCodeCreateContext", () => {
  // Test CodeContextModule.create_context().
  it("test_create_context", async () => {
    const { module: code_module, code_interpreter_protocol } = makeCodeModule();
    const result = await code_module.createContext({ language: "python" });
    expect(result["contextId"]).toBe("ctx-001");

    expect(code_interpreter_protocol.createContext).toHaveBeenCalledTimes(1);
    const call_kwargs = code_interpreter_protocol.createContext.mock.calls[0][3];
    expect(call_kwargs["language"]).toBe("python");
  });
});

describe("TestCodeListContexts", () => {
  // Test CodeContextModule.list_contexts().
  it("test_list_contexts", async () => {
    const { module: code_module, code_interpreter_protocol } = makeCodeModule();
    const result = await code_module.listContexts();
    expect(result.length).toBe(1);
    expect(result[0]["contextId"]).toBe("ctx-001");
    expect(code_interpreter_protocol.listContexts).toHaveBeenCalledTimes(1);
  });
});

describe("TestCodeRestartContext", () => {
  // Test CodeContextModule.restart_context().
  it("test_restart_context", async () => {
    const { module: code_module, code_interpreter_protocol } = makeCodeModule();
    const result = await code_module.restartContext("ctx-001");
    expect(result["status"]).toBe("active");

    expect(code_interpreter_protocol.restartContext).toHaveBeenCalledTimes(1);
    const call_kwargs = code_interpreter_protocol.restartContext.mock.calls[0][3];
    expect(call_kwargs["context_id"]).toBe("ctx-001");
  });
});

describe("TestCodeRemoveContext", () => {
  // Test CodeContextModule.remove_context().
  it("test_remove_context", async () => {
    const { module: code_module, code_interpreter_protocol } = makeCodeModule();
    await code_module.removeContext("ctx-001");
    expect(code_interpreter_protocol.removeContext).toHaveBeenCalledTimes(1);
    const call_kwargs = code_interpreter_protocol.removeContext.mock.calls[0][3];
    expect(call_kwargs["context_id"]).toBe("ctx-001");
  });
});

// TestCodeSyncVariants (run_sync / create_context_sync / list_contexts_sync): not portable, see parity/KNOWN-GAPS.md.

describe("TestCodeRunEnvs", () => {
  // Test envs pass-through on run().
  it("test_run_passes_envs", async () => {
    const { module: code_module, code_interpreter_protocol } = makeCodeModule();
    await code_module.run("print(1)", { envs: { FOO: "bar", X: "1" } });

    const call_kwargs = code_interpreter_protocol.runCode.mock.calls[0][3];
    expect(call_kwargs["envs"]).toEqual({ FOO: "bar", X: "1" });
  });

  it("test_run_without_envs", async () => {
    const { module: code_module, code_interpreter_protocol } = makeCodeModule();
    await code_module.run("print(1)");

    const call_kwargs = code_interpreter_protocol.runCode.mock.calls[0][3];
    expect(call_kwargs["envs"]).toBeNull();
  });

  it("test_envs_reach_protocol_payload", async () => {
    // Verify envs end up as envVars in the protocol payload.
    const mock_http: any = { envdRequest: vi.fn(async () => ({ stdout: "ok\n", stderr: "", exitCode: 0, executionTime: 0.01 })) };
    const proto = new CodeInterpreterProtocol(mock_http);
    const envd_token = new EnvdTokenManager("tok");

    await proto.runCode("sbx-1", "https://envd", envd_token, { code: "print(1)", envs: { K: "V" } });

    const payload = mock_http.envdRequest.mock.calls[0][2]["payload"];
    expect(payload["envVars"]).toEqual({ K: "V" });
  });

  it("test_no_envs_omits_env_vars_key", async () => {
    // Verify envVars is NOT in payload when envs is None.
    const mock_http: any = { envdRequest: vi.fn(async () => ({ stdout: "ok\n", stderr: "", exitCode: 0, executionTime: 0.01 })) };
    const proto = new CodeInterpreterProtocol(mock_http);
    const envd_token = new EnvdTokenManager("tok");

    await proto.runCode("sbx-1", "https://envd", envd_token, { code: "print(1)" });

    const payload = mock_http.envdRequest.mock.calls[0][2]["payload"];
    expect("envVars" in payload).toBe(false);
  });
});

function ciProto(response: Record<string, unknown>): { proto: CodeInterpreterProtocol; envd_token: EnvdTokenManager } {
  const mock_http: any = { envdRequest: vi.fn(async () => response) };
  return { proto: new CodeInterpreterProtocol(mock_http), envd_token: new EnvdTokenManager("tok") };
}

describe("TestCodeRunStreamingCallbacks", () => {
  // Test E2B-style streaming callbacks (buffered fallback).
  it("test_on_stdout_fires_at_protocol_level", async () => {
    // on_stdout callback is invoked with stdout content at protocol layer.
    const { proto, envd_token } = ciProto({ stdout: "42\n", stderr: "", exitCode: 0, executionTime: 0.05 });
    const collected: string[] = [];
    await proto.runCode("sbx-1", "https://envd", envd_token, { code: "print(42)", on_stdout: (s) => collected.push(s) });
    expect(collected).toEqual(["42\n"]);
  });

  it("test_on_stderr_fires_at_protocol_level", async () => {
    // on_stderr callback is invoked with stderr content at protocol layer.
    const { proto, envd_token } = ciProto({ stdout: "", stderr: "error msg\n", exitCode: 1, executionTime: 0.01 });
    const collected: string[] = [];
    await proto.runCode("sbx-1", "https://envd", envd_token, { code: "bad()", on_stderr: (s) => collected.push(s) });
    expect(collected).toEqual(["error msg\n"]);
  });

  it("test_on_result_fires_with_result_dict", async () => {
    // on_result callback receives the full result dict.
    const { proto, envd_token } = ciProto({ stdout: "42\n", stderr: "", exitCode: 0, executionTime: 0.05 });
    const results: any[] = [];
    await proto.runCode("sbx-1", "https://envd", envd_token, { code: "print(42)", on_result: (r) => results.push(r) });
    expect(results.length).toBe(1);
    expect(results[0]["stdout"]).toBe("42\n");
  });

  it("test_all_callbacks_fire_together", async () => {
    // All three callbacks fire when all are provided.
    const { proto, envd_token } = ciProto({ stdout: "out\n", stderr: "err\n", exitCode: 0, executionTime: 0.05 });
    const out: string[] = [];
    const err: string[] = [];
    const res: any[] = [];

    const response = await proto.runCode("sbx-1", "https://envd", envd_token, {
      code: "x=1",
      on_stdout: (s) => out.push(s),
      on_stderr: (s) => err.push(s),
      on_result: (r) => res.push(r),
    });
    expect(out).toEqual(["out\n"]);
    expect(err).toEqual(["err\n"]);
    expect(res.length).toBe(1);
    // Response dict is still returned
    expect(response["stdout"]).toBe("out\n");
  });

  it("test_no_callbacks_preserves_behavior", async () => {
    // Omitting callbacks returns CodeResult as before.
    const { module: code_module } = makeCodeModule();
    const result = await code_module.run("print(42)");
    expect(result).toBeInstanceOf(CodeResult);
    expect(result.text).toBe("42");
  });

  it("test_on_stdout_not_called_when_empty", async () => {
    // on_stdout is NOT called when stdout is empty.
    const { proto, envd_token } = ciProto({ stdout: "", stderr: "", exitCode: 0, executionTime: 0.01 });
    const collected: string[] = [];
    await proto.runCode("sbx-1", "https://envd", envd_token, { code: "pass", on_stdout: (s) => collected.push(s) });
    expect(collected).toEqual([]);
  });

  it("test_callbacks_forwarded_through_api_layer", async () => {
    // Verify callbacks pass from CodeContextModule.run() to protocol.
    const { proto, envd_token } = ciProto({ stdout: "hello\n", stderr: "warn\n", exitCode: 0, executionTime: 0.01 });
    const module = new CodeContextModule("sbx-1", "https://envd", envd_token, proto);

    const out: string[] = [];
    const err: string[] = [];
    const res: any[] = [];

    const result = await module.run("print('hello')", {
      on_stdout: (s) => out.push(s),
      on_stderr: (s) => err.push(s),
      on_result: (r) => res.push(r),
    });

    expect(out).toEqual(["hello\n"]);
    expect(err).toEqual(["warn\n"]);
    expect(res.length).toBe(1);
    expect(result).toBeInstanceOf(CodeResult);
    expect(result.text).toBe("hello");
  });

  it("test_callbacks_with_wrapped_result", async () => {
    // Callbacks work with response that wraps data in 'result' key.
    const { proto, envd_token } = ciProto({
      result: { stdout: "wrapped\n", stderr: "", exitCode: 0, executionTime: 0.02 },
    });
    const out: string[] = [];
    const res: any[] = [];

    await proto.runCode("sbx-1", "https://envd", envd_token, {
      code: "print('wrapped')",
      on_stdout: (s) => out.push(s),
      on_result: (r) => res.push(r),
    });

    expect(out).toEqual(["wrapped\n"]);
    expect(res[0]["stdout"]).toBe("wrapped\n");
  });

  it("test_callbacks_params_accepted_by_run", async () => {
    // run() accepts callback kwargs and forwards them to protocol.
    const { module: code_module, code_interpreter_protocol } = makeCodeModule();
    const cb = vi.fn();
    await code_module.run("print(1)", { on_stdout: cb, on_stderr: cb, on_result: cb });
    const call_kwargs = code_interpreter_protocol.runCode.mock.calls[0][3];
    expect(call_kwargs["on_stdout"]).toBe(cb);
    expect(call_kwargs["on_stderr"]).toBe(cb);
    expect(call_kwargs["on_result"]).toBe(cb);
  });
});

// ======================================================================
// Fallback tests — CodeInterpreter 404 → shell execution
// ======================================================================

function _make_404_exc(): HTTPStatusError {
  // Create a realistic HTTPStatusError with status 404.
  const request = new Request("POST", "https://envd/code.CodeInterpreter/Execute");
  const response = new Response(404, { request });
  return new HTTPStatusError("404 Not Found", { request, response });
}

function _make_500_exc(): HTTPStatusError {
  // Create a realistic HTTPStatusError with status 500.
  const request = new Request("POST", "https://envd/code.CodeInterpreter/Execute");
  const response = new Response(500, { request });
  return new HTTPStatusError("500 Internal Server Error", { request, response });
}

function _mock_process_stream(opts: { stdout?: string; stderr?: string; exit_code?: number } = {}): _MockStreamReader {
  // Return a _MockStreamReader that yields typical process chunks.
  const { stdout = "", stderr = "", exit_code = 0 } = opts;
  const chunks: ProcessChunk[] = [];
  if (stdout) chunks.push(new ProcessChunk({ type: ProcessChunkType.STDOUT, data: stdout }));
  if (stderr) chunks.push(new ProcessChunk({ type: ProcessChunkType.STDERR, data: stderr }));
  chunks.push(new ProcessChunk({ type: ProcessChunkType.EXIT, exit_code }));
  return new _MockStreamReader(chunks);
}

function queueStreams(process_protocol: any, streams: _MockStreamReader[]): void {
  process_protocol.start.mockReset();
  for (const s of streams) process_protocol.start.mockResolvedValueOnce(s);
}

describe("TestCodeRunFallback", () => {
  // CodeInterpreter 404 → transparent shell fallback.
  it("test_fallback_on_404_produces_code_result", async () => {
    // 404 from CI → fallback via process protocol → valid CodeResult.
    const { module: code_module, code_interpreter_protocol, process_protocol } = makeCodeModule();
    code_interpreter_protocol.runCode.mockRejectedValue(_make_404_exc());

    // write-file call, exec call, rm call
    queueStreams(process_protocol, [
      _mock_process_stream(), // write
      _mock_process_stream({ stdout: "42\n", exit_code: 0 }), // exec
      _mock_process_stream(), // rm
    ]);

    const result = await code_module.run("print(42)");
    expect(result).toBeInstanceOf(CodeResult);
    expect(result.text).toBe("42");
    expect(result.stdout).toBe("42\n");
    expect(result.exit_code).toBe(0);
    expect(result.output_files).toEqual([]);
    expect(result.execution_time).toBeGreaterThan(0);
    // process.start called 3 times (write, exec, rm)
    expect(process_protocol.start).toHaveBeenCalledTimes(3);
  });

  it("test_fallback_stderr_and_nonzero_exit", async () => {
    // Fallback captures stderr and non-zero exit code.
    const { module: code_module, code_interpreter_protocol, process_protocol } = makeCodeModule();
    code_interpreter_protocol.runCode.mockRejectedValue(_make_404_exc());

    queueStreams(process_protocol, [
      _mock_process_stream(),
      _mock_process_stream({ stderr: "NameError: foo\n", exit_code: 1 }),
      _mock_process_stream(),
    ]);

    const result = await code_module.run("foo");
    expect(result.exit_code).toBe(1);
    expect(result.stderr).toContain("NameError");
    expect(result.success).toBe(false);
  });

  it("test_normal_path_no_fallback", async () => {
    // When CI works, process protocol is never called.
    const { module: code_module, process_protocol } = makeCodeModule();
    const result = await code_module.run("print(42)");
    expect(result.text).toBe("42");
    expect(process_protocol.start).not.toHaveBeenCalled();
  });

  it("test_non_404_error_propagates", async () => {
    // Non-404 HTTPStatusError (e.g. 500) is NOT swallowed.
    const { module: code_module, code_interpreter_protocol } = makeCodeModule();
    code_interpreter_protocol.runCode.mockRejectedValue(_make_500_exc());

    let caught: any = null;
    try {
      await code_module.run("print(1)");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HTTPStatusError);
    expect(caught.response.status_code).toBe(500);
  });

  it("test_second_run_skips_ci_directly", async () => {
    // After first 404, subsequent runs skip CI entirely.
    const { module: code_module, code_interpreter_protocol, process_protocol } = makeCodeModule();
    code_interpreter_protocol.runCode.mockRejectedValue(_make_404_exc());

    queueStreams(process_protocol, [
      _mock_process_stream(),
      _mock_process_stream({ stdout: "first\n" }),
      _mock_process_stream(),
      // second run:
      _mock_process_stream(),
      _mock_process_stream({ stdout: "second\n" }),
      _mock_process_stream(),
    ]);

    const r1 = await code_module.run("print('first')");
    const r2 = await code_module.run("print('second')");

    expect(r1.text).toBe("first");
    expect(r2.text).toBe("second");
    // CI was only called once (the first time, which 404'd)
    expect(code_interpreter_protocol.runCode).toHaveBeenCalledTimes(1);
  });

  it("test_fallback_callbacks_fire", async () => {
    // on_stdout / on_stderr / on_result fire during fallback.
    const { module: code_module, code_interpreter_protocol, process_protocol } = makeCodeModule();
    code_interpreter_protocol.runCode.mockRejectedValue(_make_404_exc());

    queueStreams(process_protocol, [
      _mock_process_stream(),
      _mock_process_stream({ stdout: "out\n", stderr: "err\n" }),
      _mock_process_stream(),
    ]);

    const out: string[] = [];
    const err: string[] = [];
    const res: any[] = [];

    await code_module.run("x=1", {
      on_stdout: (s) => out.push(s),
      on_stderr: (s) => err.push(s),
      on_result: (r) => res.push(r),
    });

    expect(out).toEqual(["out\n"]);
    expect(err).toEqual(["err\n"]);
    expect(res.length).toBe(1);
    expect(res[0]["stdout"]).toBe("out\n");
  });

  it("test_create_context_blocked_after_404", async () => {
    // Context operations raise NotImplementedError after CI 404.
    const { module: code_module, code_interpreter_protocol, process_protocol } = makeCodeModule();
    code_interpreter_protocol.runCode.mockRejectedValue(_make_404_exc());

    queueStreams(process_protocol, [_mock_process_stream(), _mock_process_stream({ stdout: "ok\n" }), _mock_process_stream()]);
    await code_module.run("print('ok')"); // triggers 404 → flag set

    for (const invoke of [
      () => code_module.createContext(),
      () => code_module.listContexts(),
      () => code_module.restartContext("ctx-1"),
      () => code_module.removeContext("ctx-1"),
    ]) {
      const p = invoke();
      await expect(p).rejects.toBeInstanceOf(NotImplementedError);
      await expect(invoke()).rejects.toThrow(/CodeInterpreter/);
    }
  });

  it("test_fallback_no_process_protocol_raises", async () => {
    // If process_protocol was not injected, fallback raises RuntimeError.
    const mock_ci = mockCodeInterpreterProtocol();
    mock_ci.runCode.mockRejectedValue(_make_404_exc());

    const module = new CodeContextModule("sbx-1", "https://envd", new EnvdTokenManager("tok"), mock_ci);

    const p = module.run("print(1)");
    await expect(p).rejects.toBeInstanceOf(RuntimeError);
    await expect(p).rejects.toThrow(/process_protocol/);
  });

  it("test_fallback_multiline_code", async () => {
    // Multi-line code (import + prints) aggregates stdout correctly.
    const { module: code_module, code_interpreter_protocol, process_protocol } = makeCodeModule();
    code_interpreter_protocol.runCode.mockRejectedValue(_make_404_exc());

    queueStreams(process_protocol, [
      _mock_process_stream(),
      _mock_process_stream({ stdout: "3\nhello\n", exit_code: 0 }),
      _mock_process_stream(),
    ]);

    const code = "import math\nprint(1+2)\nprint('hello')";
    const result = await code_module.run(code);
    expect(result.text).toBe("3\nhello");
    expect(result.stdout).toBe("3\nhello\n");
    expect(result.exit_code).toBe(0);
  });

  it("test_normal_path_multiline_code", async () => {
    // Multi-line code via CI path aggregates correctly.
    const { module: code_module, code_interpreter_protocol } = makeCodeModule();
    code_interpreter_protocol.runCode.mockResolvedValue({ stdout: "3\nhello\n", stderr: "", exitCode: 0, executionTime: 0.02 });

    const code = "import math\nprint(1+2)\nprint('hello')";
    const result = await code_module.run(code);
    expect(result.text).toBe("3\nhello");
    expect(result.stdout).toBe("3\nhello\n");
  });

  it("test_fallback_javascript_uses_node", async () => {
    // language='javascript' → cmd='node', extension='.js'.
    const { module: code_module, code_interpreter_protocol, process_protocol } = makeCodeModule();
    code_interpreter_protocol.runCode.mockRejectedValue(_make_404_exc());

    queueStreams(process_protocol, [_mock_process_stream(), _mock_process_stream({ stdout: "hi\n" }), _mock_process_stream()]);

    const result = await code_module.run("console.log('hi')", { language: "javascript" });
    expect(result.text).toBe("hi");
    // Second start call is the exec call
    const exec_call = process_protocol.start.mock.calls[1];
    expect(exec_call[2]["cmd"]).toBe("node");
    expect(exec_call[2]["args"][0].endsWith(".js")).toBe(true);
  });

  it("test_fallback_bash_uses_bash", async () => {
    // language='bash' → cmd='bash', extension='.sh'.
    const { module: code_module, code_interpreter_protocol, process_protocol } = makeCodeModule();
    code_interpreter_protocol.runCode.mockRejectedValue(_make_404_exc());

    queueStreams(process_protocol, [_mock_process_stream(), _mock_process_stream({ stdout: "ok\n" }), _mock_process_stream()]);

    const result = await code_module.run("echo ok", { language: "bash" });
    expect(result.text).toBe("ok");
    const exec_call = process_protocol.start.mock.calls[1];
    expect(exec_call[2]["cmd"]).toBe("bash");
    expect(exec_call[2]["args"][0].endsWith(".sh")).toBe(true);
  });

  it("test_fallback_empty_stdout", async () => {
    // Empty stdout + exit_code=0 produces empty text.
    const { module: code_module, code_interpreter_protocol, process_protocol } = makeCodeModule();
    code_interpreter_protocol.runCode.mockRejectedValue(_make_404_exc());

    queueStreams(process_protocol, [_mock_process_stream(), _mock_process_stream({ stdout: "", exit_code: 0 }), _mock_process_stream()]);

    const result = await code_module.run("pass");
    expect(result.text).toBe("");
    expect(result.stdout).toBe("");
    expect(result.exit_code).toBe(0);
  });

  it("test_fallback_warning_logged", async () => {
    // First 404 triggers a WARNING log with expected message.
    const { module: code_module, code_interpreter_protocol, process_protocol } = makeCodeModule();
    code_interpreter_protocol.runCode.mockRejectedValue(_make_404_exc());

    queueStreams(process_protocol, [_mock_process_stream(), _mock_process_stream({ stdout: "x\n" }), _mock_process_stream()]);

    const cap = captureLogs("easy_sandbox.api.code", 30);
    try {
      await code_module.run("print('x')");
    } finally {
      cap.restore();
    }

    expect(cap.messages().some((m) => m.includes("CodeInterpreter service unavailable (HTTP 404)"))).toBe(true);
  });

  it("test_reset_ci_availability", async () => {
    // reset_ci_availability() re-enables CI probing.
    const { module: code_module, code_interpreter_protocol, process_protocol } = makeCodeModule();
    // First call: 404 → fallback
    code_interpreter_protocol.runCode.mockRejectedValue(_make_404_exc());
    queueStreams(process_protocol, [_mock_process_stream(), _mock_process_stream({ stdout: "fb\n" }), _mock_process_stream()]);
    const r1 = await code_module.run("print('fb')");
    expect(r1.text).toBe("fb");
    expect(code_interpreter_protocol.runCode).toHaveBeenCalledTimes(1);

    // Reset + CI now works
    code_module.resetCiAvailability();
    code_interpreter_protocol.runCode.mockResolvedValue({ stdout: "native\n", stderr: "", exitCode: 0, executionTime: 0.01 });
    const r2 = await code_module.run("print('native')");
    expect(r2.text).toBe("native");
    // CI was called again (count goes to 2)
    expect(code_interpreter_protocol.runCode).toHaveBeenCalledTimes(2);
    // process protocol was NOT called for the second run (still 3 from first)
    expect(process_protocol.start).toHaveBeenCalledTimes(3);
  });
});

// ======================================================================
// Capability gating — the "code" capability is required on every code
// interpreter entrypoint (fail-closed).  The gate MUST run before any CI
// availability check or 404 shell fallback, so a template that does not
// declare "code" never reaches the interpreter nor the shell fallback.
// ======================================================================

function _code_module(ci: any, proc: any, capabilities: Iterable<string>): CodeContextModule {
  // Build a CodeContextModule with an explicit capability set.
  return new CodeContextModule("sbx-1", "https://envd", new EnvdTokenManager("tok"), ci, new Set(capabilities), proc);
}

describe("TestCodeCapabilityGating", () => {
  // `code` capability gate on run() and every context method.
  it("test_run_without_code_capability_raises", async () => {
    // No 'code' capability → run() raises and touches neither CI nor shell.
    const ci = mockCodeInterpreterProtocol();
    const proc = mockProcessProtocol();
    const module = _code_module(ci, proc, ["shell", "files"]);
    let caught: any = null;
    try {
      await module.run("print(1)");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CapabilityNotSupportedError);
    expect(caught.capability).toBe("code");
    expect(ci.runCode).not.toHaveBeenCalled();
    expect(proc.start).not.toHaveBeenCalled();
  });

  it("test_run_gate_precedes_404_fallback", async () => {
    // Even when CI would 404 into shell fallback, a missing 'code' capability blocks entry — the gate runs first.
    const ci = mockCodeInterpreterProtocol();
    const proc = mockProcessProtocol();
    ci.runCode.mockRejectedValue(_make_404_exc());
    const module = _code_module(ci, proc, ["shell", "files"]);
    await expect(module.run("print(1)")).rejects.toBeInstanceOf(CapabilityNotSupportedError);
    // Fallback shell path must never be reached.
    expect(proc.start).not.toHaveBeenCalled();
  });

  it("test_run_gate_precedes_cached_fallback", async () => {
    // Gate also precedes the fast-path (CI already known unavailable) shell fallback branch.
    const ci = mockCodeInterpreterProtocol();
    const proc = mockProcessProtocol();
    const module = _code_module(ci, proc, ["shell", "files"]);
    module._ci_available = false; // simulate a prior 404
    await expect(module.run("print(1)")).rejects.toBeInstanceOf(CapabilityNotSupportedError);
    expect(proc.start).not.toHaveBeenCalled();
  });

  it("test_run_with_code_capability_works", async () => {
    // With 'code' declared, run() proceeds normally.
    const ci = mockCodeInterpreterProtocol();
    const proc = mockProcessProtocol();
    const module = _code_module(ci, proc, ["code"]);
    const result = await module.run("print(42)");
    expect(result).toBeInstanceOf(CodeResult);
    expect(result.text).toBe("42");
    expect(ci.runCode).toHaveBeenCalledTimes(1);
  });

  it("test_ci_404_fallback_still_works_with_code", async () => {
    // With 'code' declared, the gate passes and the 404→shell fallback stays intact.
    const ci = mockCodeInterpreterProtocol();
    const proc = mockProcessProtocol();
    ci.runCode.mockRejectedValue(_make_404_exc());
    queueStreams(proc, [_mock_process_stream(), _mock_process_stream({ stdout: "42\n", exit_code: 0 }), _mock_process_stream()]);
    const module = _code_module(ci, proc, ["code"]);
    const result = await module.run("print(42)");
    expect(result.text).toBe("42");
    expect(proc.start).toHaveBeenCalledTimes(3);
  });

  const invokes: [string, (m: CodeContextModule) => Promise<unknown>][] = [
    ["create_context", (m) => m.createContext()],
    ["list_contexts", (m) => m.listContexts()],
    ["restart_context", (m) => m.restartContext("ctx-1")],
    ["remove_context", (m) => m.removeContext("ctx-1")],
  ];
  for (const [id, invoke] of invokes) {
    it(`test_context_methods_gated_without_code [${id}]`, async () => {
      // Every context method is gated on 'code' before hitting the protocol.
      const ci = mockCodeInterpreterProtocol();
      const proc = mockProcessProtocol();
      const module = _code_module(ci, proc, ["shell", "files"]);
      let caught: any = null;
      try {
        await invoke(module);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CapabilityNotSupportedError);
      expect(caught.capability).toBe("code");
      expect(ci.createContext).not.toHaveBeenCalled();
      expect(ci.listContexts).not.toHaveBeenCalled();
      expect(ci.restartContext).not.toHaveBeenCalled();
      expect(ci.removeContext).not.toHaveBeenCalled();
    });
  }

  it("test_context_methods_work_with_code", async () => {
    // With 'code' declared, context methods reach the protocol.
    const ci = mockCodeInterpreterProtocol();
    const proc = mockProcessProtocol();
    const module = _code_module(ci, proc, ["code"]);
    expect((await module.createContext())["contextId"]).toBe("ctx-001");
    expect((await module.listContexts()).length).toBe(1);
    expect((await module.restartContext("ctx-001"))["status"]).toBe("active");
    await module.removeContext("ctx-001");
    expect(ci.createContext).toHaveBeenCalledTimes(1);
    expect(ci.listContexts).toHaveBeenCalledTimes(1);
    expect(ci.restartContext).toHaveBeenCalledTimes(1);
    expect(ci.removeContext).toHaveBeenCalledTimes(1);
  });

  it("test_resolved_capabilities_without_code_gates_run", async () => {
    // A template that resolves WITHOUT 'code' blocks run() end-to-end.
    const tmp_path = mkdtempSync(join(tmpdir(), "ebx-code-"));
    const yaml_file = join(tmp_path, "template.yaml");
    writeFileSync(
      yaml_file,
      dedent(`\
        name: web-only
        capabilities:
          - shell
          - files
      `),
    );
    const ci = mockCodeInterpreterProtocol();
    const proc = mockProcessProtocol();
    const resolved = await resolveCapabilities("web-only", { local_yaml_path: yaml_file });
    expect(resolved.capabilities.has("code")).toBe(false);
    const module = _code_module(ci, proc, resolved.capabilities);
    await expect(module.run("print(1)")).rejects.toBeInstanceOf(CapabilityNotSupportedError);
    expect(ci.runCode).not.toHaveBeenCalled();
  });

  it("test_malformed_template_never_grants_code", async () => {
    // Capability resolution failure is fail-closed: a matched-but-malformed template raises rather than silently
    // granting DEFAULT_CAPABILITIES (which would include 'code').
    const tmp_path = mkdtempSync(join(tmpdir(), "ebx-code-"));
    const yaml_file = join(tmp_path, "template.yaml");
    writeFileSync(
      yaml_file,
      dedent(`\
        name: broken
        capabilities:
          - not_a_real_capability
      `),
    );
    await expect(resolveCapabilities("broken", { local_yaml_path: yaml_file })).rejects.toBeInstanceOf(TemplateParseError);
  });
});
