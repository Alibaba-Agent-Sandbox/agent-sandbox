/** Tests for the CodeContextModule API. */

import { describe, expect, it, vi } from "vitest";

import { CodeResult } from "../../src/models/process.js";
import { HTTPStatusError, Request, Response } from "../../src/transport/_httpx.js";
import {
  makeCodeModule,
} from "./conftest.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

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

  it("forwards callbacks to an explicitly implemented adapter", async () => {
    const { module, code_interpreter_protocol: protocol } = makeCodeModule();
    const callback = vi.fn(); await module.run("payload", {on_stdout: callback, on_stderr: callback, on_result: callback});
    expect(protocol.runCode.mock.calls[0][3]).toMatchObject({on_stdout: callback, on_stderr: callback, on_result: callback});
  });
});

describe("explicit interpreter operation semantics", () => {
  it("preserves interpreter 404 on every request without executing the shell", async () => {
    const { module, code_interpreter_protocol: ci, process_protocol: process } = makeCodeModule();
    const request = new Request("POST", "https://envd/code.CodeInterpreter/Execute");
    const error = new HTTPStatusError("404 Not Found", { request, response: new Response(404, { request }) });
    ci.runCode.mockRejectedValue(error);
    await expect(module.run("payload")).rejects.toBe(error);
    await expect(module.run("payload")).rejects.toBe(error);
    expect(ci.runCode).toHaveBeenCalledTimes(2);
    expect(ci.removeContext).toHaveBeenCalledTimes(2);
    expect(process.start).not.toHaveBeenCalled();
  });
  it("creates and deletes an isolated temporary context for stateless execution", async () => {
    const { module, code_interpreter_protocol: ci } = makeCodeModule();
    ci.createContext.mockResolvedValueOnce({ contextId: "temporary-1" }).mockResolvedValueOnce({ contextId: "temporary-2" });
    await module.run("x=1"); await module.run("x");
    expect(ci.runCode.mock.calls.map((call: any[]) => call[3].context_id)).toEqual(["temporary-1", "temporary-2"]);
    expect(ci.removeContext.mock.calls.map((call: any[]) => call[3].context_id)).toEqual(["temporary-1", "temporary-2"]);
  });
  it("rejects context inputs before payload when only default-context execution exists", async () => {
    const { module, code_interpreter_protocol: ci } = makeCodeModule();
    ci.operations = new Set(["code.default-context.execute"]);
    await expect(module.run("payload", { context_id: "ctx" })).rejects.toThrow("code.context.execute");
    await expect(module.run("payload")).rejects.toThrow("code.execute");
    expect(ci.runCode).not.toHaveBeenCalled();
    await module.run("payload", { operation: "code.default-context.execute" });
    expect(ci.createContext).not.toHaveBeenCalled();
    expect(ci.runCode.mock.calls[0][3].context_id).toBeNull();
  });
  it("rejects missing context lifecycle operations before creating a temporary context", async () => {
    const { module, code_interpreter_protocol: ci } = makeCodeModule();
    ci.operations = new Set(["code.execute", "code.context.create", "code.context.execute"]);
    await expect(module.run("payload")).rejects.toThrow("code.context.delete");
    expect(ci.createContext).not.toHaveBeenCalled(); expect(ci.runCode).not.toHaveBeenCalled();
  });
  it("does not report success when temporary context cleanup fails", async () => {
    const { module, code_interpreter_protocol: ci } = makeCodeModule();
    ci.removeContext.mockRejectedValue(Error("cleanup failed"));
    await expect(module.run("payload")).rejects.toThrow("cleanup failed");
  });
});

it("preserves execution and cleanup failures together", async () => {
  const {module,code_interpreter_protocol:protocol}=makeCodeModule();
  const executionError=Error("interpreter failed"), cleanupError=Error("cleanup failed");
  protocol.runCode.mockRejectedValue(executionError);protocol.removeContext.mockRejectedValue(cleanupError);
  try {await module.run("payload");throw Error("unexpected success");}
  catch(error){expect(error).toBeInstanceOf(AggregateError);expect((error as AggregateError).errors).toEqual([executionError,cleanupError]);}
});

it("rejects malformed environment and callbacks before creating a context or sending payload", async()=>{
  const {module,code_interpreter_protocol:protocol}=makeCodeModule();
  await expect(module.run("payload",{envs:true} as never)).rejects.toThrow("environment");
  await expect(module.run("payload",{envs:{A:1}} as never)).rejects.toThrow("environment");
  await expect(module.run("payload",{on_stdout:"ignored"} as never)).rejects.toThrow("callbacks");
  expect(protocol.createContext).not.toHaveBeenCalled();expect(protocol.runCode).not.toHaveBeenCalled();
});
