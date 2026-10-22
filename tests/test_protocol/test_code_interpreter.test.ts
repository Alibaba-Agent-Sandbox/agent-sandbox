/** Tests for protocol.code_interpreter module — Code Interpreter RPC. */

import { describe, expect, it, vi } from "vitest";

import { _HTTP_TIMEOUT_BUFFER, CodeInterpreterProtocol } from "../../src/providers/shared/e2b/code_interpreter.js";
import { EnvdTokenManager } from "../../src/providers/alicloud_express/auth.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const envd_token = () => new EnvdTokenManager("test-envd-token");
const envd_url = () => "https://envd-sbx-123.example.com";

function _makeMockHttp(envd_request_return: Record<string, any> | null = null): any {
  return { envdRequest: vi.fn(async () => (envd_request_return !== null ? envd_request_return : {})) };
}

const SANDBOX_ID = "sbx-test-123";

describe("TestRunCode", () => {
  it("test_run_code_basic", async () => {
    const mock_http = _makeMockHttp({ stdout: "42\n", stderr: "", exitCode: 0, executionTime: 0.05 });
    const proto = new CodeInterpreterProtocol(mock_http);
    const result = await proto.runCode(SANDBOX_ID, envd_url(), envd_token(), { code: "print(42)", language: "python" });
    expect(result["stdout"]).toBe("42\n");
    expect(result["exitCode"]).toBe(0);

    expect(mock_http.envdRequest).toHaveBeenCalledTimes(1);
    const payload = mock_http.envdRequest.mock.calls[0][2].payload;
    expect(payload["code"]).toBe("print(42)");
    expect(payload["language"]).toBe("python");
    expect(payload["timeout"]).toBe(30);
  });

  it("test_run_code_with_context_id", async () => {
    const mock_http = _makeMockHttp({ stdout: "ok\n" });
    const proto = new CodeInterpreterProtocol(mock_http);
    await proto.runCode(SANDBOX_ID, envd_url(), envd_token(), { code: "x = 1", context_id: "ctx-123" });
    const payload = mock_http.envdRequest.mock.calls[0][2].payload;
    expect(payload["contextId"]).toBe("ctx-123");
  });

  it("test_run_code_custom_timeout", async () => {
    const mock_http = _makeMockHttp({});
    const proto = new CodeInterpreterProtocol(mock_http);
    await proto.runCode(SANDBOX_ID, envd_url(), envd_token(), { code: "x = 1", timeout: 120 });
    const payload = mock_http.envdRequest.mock.calls[0][2].payload;
    expect(payload["timeout"]).toBe(120);
  });

  it("test_run_code_default_timeout_propagates_to_http", async () => {
    // run_code(timeout=30) should pass request_timeout=35.0 to envd_request.
    const mock_http = _makeMockHttp({});
    const proto = new CodeInterpreterProtocol(mock_http);
    await proto.runCode(SANDBOX_ID, envd_url(), envd_token(), { code: "print(1)" });
    const call_kwargs = mock_http.envdRequest.mock.calls[0][2];
    expect(call_kwargs.request_timeout).toBe(30.0 + _HTTP_TIMEOUT_BUFFER);
  });

  it("test_run_code_custom_timeout_propagates_to_http", async () => {
    // run_code(timeout=300) should pass request_timeout=305.0 to envd_request.
    const mock_http = _makeMockHttp({});
    const proto = new CodeInterpreterProtocol(mock_http);
    await proto.runCode(SANDBOX_ID, envd_url(), envd_token(), { code: "import pandas", timeout: 300 });
    const call_kwargs = mock_http.envdRequest.mock.calls[0][2];
    expect(call_kwargs.request_timeout).toBe(300.0 + _HTTP_TIMEOUT_BUFFER);
  });

  it("test_http_timeout_buffer_is_positive", () => {
    // The buffer constant should be a positive float.
    expect(_HTTP_TIMEOUT_BUFFER).toBeGreaterThan(0);
    expect(typeof _HTTP_TIMEOUT_BUFFER).toBe("number");
  });
});

describe("TestCreateContext", () => {
  it("test_create_context", async () => {
    const mock_http = _makeMockHttp({ contextId: "ctx-new-001", language: "python" });
    const proto = new CodeInterpreterProtocol(mock_http);
    const result = await proto.createContext(SANDBOX_ID, envd_url(), envd_token(), { language: "python" });
    expect(result["contextId"]).toBe("ctx-new-001");

    const payload = mock_http.envdRequest.mock.calls[0][2].payload;
    expect(payload["language"]).toBe("python");
  });
});

describe("TestListContexts", () => {
  it("test_list_contexts", async () => {
    const mock_http = _makeMockHttp({
      contexts: [
        { contextId: "ctx-1", language: "python" },
        { contextId: "ctx-2", language: "javascript" },
      ],
    });
    const proto = new CodeInterpreterProtocol(mock_http);
    const result = await proto.listContexts(SANDBOX_ID, envd_url(), envd_token());
    expect(result.length).toBe(2);
    expect(result[0]!["contextId"]).toBe("ctx-1");
    expect(result[1]!["language"]).toBe("javascript");
  });

  it("test_list_contexts_empty", async () => {
    const mock_http = _makeMockHttp({ contexts: [] });
    const proto = new CodeInterpreterProtocol(mock_http);
    const result = await proto.listContexts(SANDBOX_ID, envd_url(), envd_token());
    expect(result).toEqual([]);
  });

  it("test_list_contexts_result_wrapper", async () => {
    const mock_http = _makeMockHttp({ result: { contexts: [{ contextId: "ctx-wrapped" }] } });
    const proto = new CodeInterpreterProtocol(mock_http);
    const result = await proto.listContexts(SANDBOX_ID, envd_url(), envd_token());
    expect(result.length).toBe(1);
    expect(result[0]!["contextId"]).toBe("ctx-wrapped");
  });
});

describe("TestRestartContext", () => {
  it("test_restart_context", async () => {
    const mock_http = _makeMockHttp({ contextId: "ctx-restarted", status: "active" });
    const proto = new CodeInterpreterProtocol(mock_http);
    const result = await proto.restartContext(SANDBOX_ID, envd_url(), envd_token(), { context_id: "ctx-restarted" });
    expect(result["status"]).toBe("active");

    const payload = mock_http.envdRequest.mock.calls[0][2].payload;
    expect(payload["contextId"]).toBe("ctx-restarted");
  });
});

describe("TestRemoveContext", () => {
  it("test_remove_context", async () => {
    const mock_http = _makeMockHttp();
    const proto = new CodeInterpreterProtocol(mock_http);
    await proto.removeContext(SANDBOX_ID, envd_url(), envd_token(), { context_id: "ctx-to-remove" });

    expect(mock_http.envdRequest).toHaveBeenCalledTimes(1);
    const payload = mock_http.envdRequest.mock.calls[0][2].payload;
    expect(payload["contextId"]).toBe("ctx-to-remove");
  });
});
