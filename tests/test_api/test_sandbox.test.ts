/** Tests for the Sandbox core API class. */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { CodeContextModule } from "../../src/api/code.js";
import { CommandsModule } from "../../src/api/commands.js";
import { FilesModule } from "../../src/api/files.js";
import { NetworkModule } from "../../src/api/network.js";
import { NotImplementedError } from "../../src/api/_pyerrors.js";
import { Sandbox } from "../../src/api/sandbox.js";
import { CommandNotFoundError, ConnectionError_ } from "../../src/models/errors.js";
import { CodeResult } from "../../src/models/process.js";
import { SandboxConfig, SandboxInfo, SandboxStatus } from "../../src/models/sandbox.js";
import { TerminalSession } from "../../src/protocol/terminal.js";
import { ConnectError, JSONDecodeError } from "../../src/transport/_httpx.js";
import { EnvdTokenManager } from "../../src/transport/auth.js";
import { TransportConfig } from "../../src/transport/config.js";
import {
  TEST_API_KEY,
  TEST_ENVD_TOKEN,
  TEST_ENVD_URL,
  TEST_SANDBOX_ID,
  makeSandboxFixture,
  makeSandboxInfo as make_sandbox_info,
  type SandboxFixture,
} from "./conftest.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const h = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  createAuthProvider: vi.fn(),
  HttpClient: vi.fn(),
  SandboxProtocol: vi.fn(),
}));

vi.mock("../../src/transport/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/transport/config.js")>()),
  loadConfig: h.loadConfig,
}));
vi.mock("../../src/transport/auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/transport/auth.js")>()),
  createAuthProvider: h.createAuthProvider,
}));
vi.mock("../../src/transport/http.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/transport/http.js")>()),
  HttpClient: h.HttpClient,
}));
vi.mock("../../src/protocol/sandbox.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/protocol/sandbox.js")>()),
  SandboxProtocol: h.SandboxProtocol,
}));

/** Equivalent of the Python `with patch(load_config/create_auth_provider/HttpClient/SandboxProtocol)` block. */
function patchInfra(mock_sandbox_proto: any, mock_http: any = {}, mock_auth: any = {}): void {
  h.loadConfig.mockReset().mockReturnValue(new TransportConfig({ api_key: TEST_API_KEY }));
  h.createAuthProvider.mockReset().mockReturnValue(mock_auth);
  h.HttpClient.mockReset().mockImplementation(function () {
    return mock_http;
  });
  h.SandboxProtocol.mockReset().mockImplementation(function () {
    return mock_sandbox_proto;
  });
}

function protoWith(method: "create" | "connect", info: SandboxInfo): any {
  return { [method]: vi.fn(async () => info) };
}

let fx: SandboxFixture;
beforeEach(() => {
  fx = makeSandboxFixture();
});

describe("TestSandboxProperties", () => {
  // Test Sandbox instance properties.
  it("test_id", () => {
    expect(fx.sandbox.id).toBe(TEST_SANDBOX_ID);
  });

  it("test_status", () => {
    expect(fx.sandbox.status).toBe(SandboxStatus.RUNNING);
  });

  it("test_url", () => {
    expect(fx.sandbox.url).toBe(TEST_ENVD_URL);
  });

  it("test_info", () => {
    expect(fx.sandbox.info.sandbox_id).toBe(TEST_SANDBOX_ID);
    expect(fx.sandbox.info.template).toBe("python-base");
  });

  it("test_repr", () => {
    const r = fx.sandbox.__repr__();
    expect(r).toContain(TEST_SANDBOX_ID);
    expect(r).toContain("running");
  });
});

describe("TestSandboxCreate", () => {
  // Test Sandbox.create() classmethod.
  it("test_create_returns_sandbox", async () => {
    const info = make_sandbox_info();
    const mock_sandbox_proto = protoWith("create", info);
    const mock_http = { close: vi.fn() };
    const mock_auth = { getHeaders: vi.fn(async () => ({ "X-API-KEY": TEST_API_KEY })) };
    patchInfra(mock_sandbox_proto, mock_http, mock_auth);

    const sb = await Sandbox.create({ template: "python-base", api_key: TEST_API_KEY });

    expect(sb.id).toBe(TEST_SANDBOX_ID);
    expect(sb.status).toBe(SandboxStatus.RUNNING);
    expect(sb.url).toBe(TEST_ENVD_URL);
    expect(mock_sandbox_proto.create).toHaveBeenCalledTimes(1);
  });

  it("test_create_passes_config", async () => {
    const mock_sandbox_proto = protoWith("create", make_sandbox_info());
    patchInfra(mock_sandbox_proto);

    await Sandbox.create({ template: "node-base", timeout: 600, envs: { FOO: "bar" }, api_key: TEST_API_KEY });

    const config: SandboxConfig = mock_sandbox_proto.create.mock.calls[0][0];
    expect(config.template).toBe("node-base");
    expect(config.timeout).toBe(600);
    expect(config.env_vars).toEqual({ FOO: "bar" });
  });

  it("test_create_default_request_timeout_is_none", async () => {
    // Without an explicit request_timeout, None is forwarded (default behaviour).
    const mock_sandbox_proto = protoWith("create", make_sandbox_info());
    patchInfra(mock_sandbox_proto);

    await Sandbox.create({ template: "base", api_key: TEST_API_KEY });

    expect(mock_sandbox_proto.create.mock.calls[0][1]["request_timeout"]).toBeNull();
  });

  it("test_create_explicit_request_timeout_forwarded", async () => {
    // An explicit request_timeout reaches SandboxProtocol.create() as a kwarg.
    const mock_sandbox_proto = protoWith("create", make_sandbox_info());
    patchInfra(mock_sandbox_proto);

    await Sandbox.create({ template: "python-hello", request_timeout: 120.0, api_key: TEST_API_KEY });

    expect(mock_sandbox_proto.create.mock.calls[0][1]["request_timeout"]).toBe(120.0);
  });

  for (const bad_value of [0, -1, -0.5]) {
    it(`test_create_rejects_non_positive_request_timeout [${bad_value}]`, async () => {
      // request_timeout must be positive when provided; else ValueError.
      const p = Sandbox.create({ template: "base", request_timeout: bad_value, api_key: TEST_API_KEY });
      await expect(p).rejects.toThrow(/request_timeout must be a positive number/);
      await expect(p).rejects.toHaveProperty("name", "ValueError");
    });
  }
});

describe("TestSandboxConnect", () => {
  // Test Sandbox.connect() classmethod.
  it("test_connect_returns_sandbox", async () => {
    const mock_sandbox_proto = protoWith("connect", make_sandbox_info());
    patchInfra(mock_sandbox_proto);

    const sb = await Sandbox.connect(TEST_SANDBOX_ID, { api_key: TEST_API_KEY });

    expect(sb.id).toBe(TEST_SANDBOX_ID);
    expect(mock_sandbox_proto.connect).toHaveBeenCalledTimes(1);
    expect(mock_sandbox_proto.connect).toHaveBeenCalledWith(TEST_SANDBOX_ID);
  });
});

describe("TestSandboxLifecycle", () => {
  // Test kill, set_timeout, is_running, pause.
  it("test_kill_calls_protocol_and_closes_http", async () => {
    await fx.sandbox.kill();
    expect(fx.sandbox_protocol.kill).toHaveBeenCalledTimes(1);
    expect(fx.sandbox_protocol.kill).toHaveBeenCalledWith(TEST_SANDBOX_ID);
    expect(fx.http_client.close).toHaveBeenCalledTimes(1);
  });

  it("test_second_kill_is_a_noop", async () => {
    await fx.sandbox.kill();
    await fx.sandbox.kill();
    expect(fx.sandbox_protocol.kill).toHaveBeenCalledTimes(1);
    expect(fx.http_client.close).toHaveBeenCalledTimes(1);
  });

  it("test_kill_closes_http_even_on_protocol_error", async () => {
    fx.sandbox_protocol.kill.mockRejectedValue(new Error("kill failed"));
    await expect(fx.sandbox.kill()).rejects.toThrow(/kill failed/);
    // HTTP client should still be closed
    expect(fx.http_client.close).toHaveBeenCalledTimes(1);
  });

  it("test_set_timeout", async () => {
    await fx.sandbox.setTimeout(600);
    expect(fx.sandbox_protocol.setTimeout).toHaveBeenCalledTimes(1);
    expect(fx.sandbox_protocol.setTimeout).toHaveBeenCalledWith(TEST_SANDBOX_ID, 600);
  });

  it("test_is_running", async () => {
    const result = await fx.sandbox.isRunning();
    expect(result).toBe(true);
    expect(fx.sandbox_protocol.isRunning).toHaveBeenCalledTimes(1);
    expect(fx.sandbox_protocol.isRunning).toHaveBeenCalledWith(TEST_SANDBOX_ID);
  });

  it("test_pause", async () => {
    await fx.sandbox.pause();
    expect(fx.sandbox_protocol.pause).toHaveBeenCalledTimes(1);
    expect(fx.sandbox_protocol.pause).toHaveBeenCalledWith(TEST_SANDBOX_ID);
  });
});

/** `async with sandbox as sb: body(sb)`. */
async function asyncWith<T>(sandbox: Sandbox, body: (sb: Sandbox) => T | Promise<T>): Promise<T> {
  const sb = await sandbox.__aenter__();
  try {
    return await body(sb);
  } finally {
    await sandbox.__aexit__();
  }
}

describe("TestSandboxContextManager", () => {
  // Test async context manager behavior.
  it("test_context_manager_calls_kill_on_exit", async () => {
    await asyncWith(fx.sandbox, () => undefined);
    expect(fx.sandbox_protocol.kill).toHaveBeenCalledTimes(1);
    expect(fx.sandbox_protocol.kill).toHaveBeenCalledWith(TEST_SANDBOX_ID);
    expect(fx.http_client.close).toHaveBeenCalledTimes(1);
  });

  it("test_context_manager_suppresses_kill_error", async () => {
    fx.sandbox_protocol.kill.mockRejectedValue(new Error("kill failed"));
    // Should NOT raise
    await asyncWith(fx.sandbox, () => undefined);
  });

  it("test_context_manager_enters_returns_sandbox", async () => {
    await asyncWith(fx.sandbox, (sb) => {
      expect(sb).toBe(fx.sandbox);
    });
  });
});

describe("TestSandboxSubmodules", () => {
  // Test lazy cached property sub-modules.
  it("test_commands_property", () => {
    const cmds = fx.sandbox.commands;
    expect(cmds).toBeInstanceOf(CommandsModule);
    // Cached - same object
    expect(fx.sandbox.commands).toBe(cmds);
  });

  it("test_files_property", () => {
    const files = fx.sandbox.files;
    expect(files).toBeInstanceOf(FilesModule);
    expect(fx.sandbox.files).toBe(files);
  });

  it("test_network_property", () => {
    const net = fx.sandbox.network;
    expect(net).toBeInstanceOf(NetworkModule);
    expect(fx.sandbox.network).toBe(net);
  });

  it("test_code_property", () => {
    const code = fx.sandbox.code;
    expect(code).toBeInstanceOf(CodeContextModule);
    expect(fx.sandbox.code).toBe(code);
  });
});

describe("TestSandboxRunCode", () => {
  // Test the run_code convenience method.
  it("test_run_code_delegates_to_code_module", async () => {
    const result = await fx.sandbox.runCode("print(42)");
    expect(result).toBeInstanceOf(CodeResult);
    // Should have called run_code on the code interpreter protocol
    expect(fx.code_interpreter_protocol.runCode).toHaveBeenCalled();
  });
});

// TestSandboxSyncVariants (create_sync / kill_sync / run_code_sync / resume_sync / get_terminal_sync): not portable —
// there is no `make_sync` seam in Node; see parity/KNOWN-GAPS.md.

describe("TestSandboxResourceParams", () => {
  // Test cpu/memory/disk/gpu payload mapping through create().
  it("test_create_with_cpu_memory", async () => {
    const mock_sandbox_proto = protoWith("create", make_sandbox_info());
    patchInfra(mock_sandbox_proto);

    await Sandbox.create({ template: "python-base", cpu: 4, memory: 8192, api_key: TEST_API_KEY });

    const config: SandboxConfig = mock_sandbox_proto.create.mock.calls[0][0];
    expect(config.cpu).toBe(4);
    expect(config.memory).toBe(8192);
    const payload = config.toCreatePayload();
    expect(payload["cpuCount"]).toBe(4);
    expect(payload["memoryMB"]).toBe(8192);
    expect("diskSizeMB" in payload).toBe(false);
    expect("gpu" in payload).toBe(false);
  });

  it("test_create_with_disk_gpu", async () => {
    const mock_sandbox_proto = protoWith("create", make_sandbox_info());
    patchInfra(mock_sandbox_proto);

    await Sandbox.create({ template: "python-base", disk: 10240, gpu: "A10", api_key: TEST_API_KEY });

    const config: SandboxConfig = mock_sandbox_proto.create.mock.calls[0][0];
    expect(config.disk).toBe(10240);
    expect(config.gpu).toBe("A10");
    const payload = config.toCreatePayload();
    expect(payload["diskSizeMB"]).toBe(10240);
    expect(payload["gpu"]).toBe("A10");
    expect("cpuCount" in payload).toBe(false);
    expect("memoryMB" in payload).toBe(false);
  });

  it("test_create_without_resources_omits_keys", async () => {
    const mock_sandbox_proto = protoWith("create", make_sandbox_info());
    patchInfra(mock_sandbox_proto);

    await Sandbox.create({ template: "base", api_key: TEST_API_KEY });

    const config: SandboxConfig = mock_sandbox_proto.create.mock.calls[0][0];
    const payload = config.toCreatePayload();
    expect("cpuCount" in payload).toBe(false);
    expect("memoryMB" in payload).toBe(false);
    expect("diskSizeMB" in payload).toBe(false);
    expect("gpu" in payload).toBe(false);
  });
});

describe("TestSandboxDescriptionInfer", () => {
  // Test that description with default template logs a hint (infer removed from API layer).
  it("test_description_logs_hint_uses_base", async () => {
    // description + default template logs a hint and uses 'base' template.
    const mock_sandbox_proto = protoWith("create", make_sandbox_info());
    patchInfra(mock_sandbox_proto);

    await Sandbox.create({ description: "分析 CSV 数据并画图", api_key: TEST_API_KEY });

    // Template should remain "base" since infer is no longer called
    const config: SandboxConfig = mock_sandbox_proto.create.mock.calls[0][0];
    expect(config.template).toBe("base");
  });

  it("test_explicit_template_skips_hint", async () => {
    // Explicit template does not trigger description hint.
    const mock_sandbox_proto = protoWith("create", make_sandbox_info());
    patchInfra(mock_sandbox_proto);

    await Sandbox.create({ template: "node-web", description: "分析 CSV 数据", api_key: TEST_API_KEY });

    const config: SandboxConfig = mock_sandbox_proto.create.mock.calls[0][0];
    expect(config.template).toBe("node-web");
  });

  it("test_explicit_cpu_memory_preserved", async () => {
    // Explicit cpu/memory are preserved when description is given.
    const mock_sandbox_proto = protoWith("create", make_sandbox_info());
    patchInfra(mock_sandbox_proto);

    await Sandbox.create({ description: "运行 Python", cpu: 8, memory: 16384, api_key: TEST_API_KEY });

    const config: SandboxConfig = mock_sandbox_proto.create.mock.calls[0][0];
    expect(config.cpu).toBe(8);
    expect(config.memory).toBe(16384);
  });
});

describe("TestSandboxResume", () => {
  // Test resume() method.
  it("test_resume", async () => {
    await fx.sandbox.resume();
    expect(fx.sandbox_protocol.resume).toHaveBeenCalledTimes(1);
    expect(fx.sandbox_protocol.resume).toHaveBeenCalledWith(TEST_SANDBOX_ID);
  });
});

describe("TestSandboxRunCodeEnvs", () => {
  // Test run_code envs pass-through.
  it("test_run_code_passes_envs", async () => {
    await fx.sandbox.runCode("print(1)", { envs: { MY_VAR: "123" } });
    const call_kwargs = fx.code_interpreter_protocol.runCode.mock.calls.at(-1)[3];
    expect(call_kwargs["envs"]).toEqual({ MY_VAR: "123" });
  });

  it("test_run_code_without_envs", async () => {
    await fx.sandbox.runCode("print(1)");
    const call_kwargs = fx.code_interpreter_protocol.runCode.mock.calls.at(-1)[3];
    expect(call_kwargs["envs"]).toBeNull();
  });
});

describe("TestSandboxRunCodeCallbacks", () => {
  // Test run_code streaming callback pass-through.
  it("test_run_code_forwards_callbacks", async () => {
    // run_code() forwards on_stdout/on_stderr/on_result to the protocol.
    const cb = vi.fn();
    await fx.sandbox.runCode("print(1)", { on_stdout: cb, on_stderr: cb, on_result: cb });
    const call_kwargs = fx.code_interpreter_protocol.runCode.mock.calls.at(-1)[3];
    expect(call_kwargs["on_stdout"]).toBe(cb);
    expect(call_kwargs["on_stderr"]).toBe(cb);
    expect(call_kwargs["on_result"]).toBe(cb);
  });

  it("test_run_code_without_callbacks_still_works", async () => {
    // run_code() without callbacks preserves existing behavior.
    const result = await fx.sandbox.runCode("print(42)");
    expect(result).toBeInstanceOf(CodeResult);
    const call_kwargs = fx.code_interpreter_protocol.runCode.mock.calls.at(-1)[3];
    expect(call_kwargs["on_stdout"]).toBeNull();
    expect(call_kwargs["on_stderr"]).toBeNull();
    expect(call_kwargs["on_result"]).toBeNull();
  });
});

describe("TestSandboxE2BUrlStubs", () => {
  // Test get_upload_url / get_download_url raise NotImplementedError.
  it("test_get_upload_url_raises_not_implemented", async () => {
    const p = fx.sandbox.getUploadUrl("/app/data.csv");
    await expect(p).rejects.toBeInstanceOf(NotImplementedError);
    await expect(p).rejects.toThrow(/get_upload_url is not yet implemented/);
  });

  it("test_get_download_url_raises_not_implemented", async () => {
    const p = fx.sandbox.getDownloadUrl("/app/data.csv");
    await expect(p).rejects.toBeInstanceOf(NotImplementedError);
    await expect(p).rejects.toThrow(/get_download_url is not yet implemented/);
  });
});

describe("TestSandboxTerminal", () => {
  // Test terminal wiring.
  it("test_get_terminal_calls_terminal_session_create", async () => {
    const mock_session = {};
    const spy = vi.spyOn(TerminalSession, "create").mockResolvedValue(mock_session as any);
    try {
      const terminal = await fx.sandbox.getTerminal({ cols: 120, rows: 40 });
      expect(terminal).toBe(mock_session);
      expect(spy).toHaveBeenCalledTimes(1);
      const call_kwargs = spy.mock.calls[0]![3] as any;
      expect(call_kwargs["cols"]).toBe(120);
      expect(call_kwargs["rows"]).toBe(40);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("TestSandboxEnvdUrlDerivation", () => {
  // Test envd URL derivation when platform response omits envdUrl (Bug 1).
  it("test_create_derives_envd_url_when_missing", async () => {
    // create() should derive envd_url via build_envd_url when API omits it. Simulate real FC response: no envdUrl field
    const info = SandboxInfo.modelValidate({
      sandboxID: TEST_SANDBOX_ID,
      templateID: "base",
      envdAccessToken: TEST_ENVD_TOKEN,
      envdVersion: "0.5.2",
    });
    expect(info.envd_url).toBeNull(); // precondition

    const mock_sandbox_proto = protoWith("create", info);
    patchInfra(mock_sandbox_proto);

    const sb = await Sandbox.create({ template: "base", api_key: TEST_API_KEY });

    const expected_url = `https://49983-${TEST_SANDBOX_ID}.cn-hangzhou.e2b.fc.aliyuncs.com`;
    expect(sb.url).toBe(expected_url);
    expect(sb.url).not.toBe("");
  });

  it("test_connect_derives_envd_url_when_missing", async () => {
    // connect() should derive envd_url via build_envd_url when API omits it.
    const info = SandboxInfo.modelValidate({
      sandboxID: TEST_SANDBOX_ID,
      templateID: "base",
      envdAccessToken: TEST_ENVD_TOKEN,
      envdVersion: "0.5.2",
    });

    const mock_sandbox_proto = protoWith("connect", info);
    patchInfra(mock_sandbox_proto);

    const sb = await Sandbox.connect(TEST_SANDBOX_ID, { api_key: TEST_API_KEY });

    const expected_url = `https://49983-${TEST_SANDBOX_ID}.cn-hangzhou.e2b.fc.aliyuncs.com`;
    expect(sb.url).toBe(expected_url);
  });

  it("test_refresh_info_derives_envd_url_when_missing", async () => {
    // refresh_info() should re-derive envd_url if platform still omits it.
    const refreshed_info = SandboxInfo.modelValidate({
      sandboxID: TEST_SANDBOX_ID,
      templateID: "python-base",
      envdAccessToken: TEST_ENVD_TOKEN,
    });
    fx.sandbox_protocol.getInfo.mockResolvedValue(refreshed_info);

    const result = await fx.sandbox.refreshInfo();

    const expected_url = `https://49983-${TEST_SANDBOX_ID}.cn-hangzhou.e2b.fc.aliyuncs.com`;
    expect(result.envd_url).toBe(expected_url);
    expect(fx.sandbox.url).toBe(expected_url);
  });

  it("test_existing_envd_url_not_overwritten", () => {
    // If platform provides envdUrl, it should NOT be overwritten.
    const info = make_sandbox_info(); // includes envd_url
    const original_url = info.envd_url;
    expect(original_url).toBeTruthy(); // precondition

    const sb = new Sandbox({
      info,
      config: new TransportConfig({ api_key: TEST_API_KEY }),
      http_client: {} as any,
      auth: {} as any,
      envd_token: new EnvdTokenManager(TEST_ENVD_TOKEN),
    });

    expect(sb.url).toBe(original_url);
  });
});

function serverClient(response: any): any {
  const client = { post: vi.fn(async (..._a: any[]) => response) };
  fx.http_client._createEnvdClient.mockReturnValue(client);
  return client;
}

describe("TestSandboxRunCommand", () => {
  it("test_run_command_success", async () => {
    const mock_client = serverClient({ is_success: true, json: vi.fn(() => ({ result: 42 })) });

    const result = await fx.sandbox.runCommand("add", { x: 1, y: 2 });

    expect(result.value).toBe(42);
    expect(result.exit_code).toBe(0);
    expect(result.success).toBe(true);
    expect(mock_client.post).toHaveBeenCalledTimes(1);
    expect(mock_client.post).toHaveBeenCalledWith("/commands/add", {
      json: { x: 1, y: 2 },
      headers: mock_client.post.mock.calls[0][1].headers,
    });
  });

  it("test_run_command_server_error_returns_exit_code_1", async () => {
    serverClient({ is_success: false, status_code: 500, json: vi.fn(() => ({ error: "boom", type: "RuntimeError" })) });

    const result = await fx.sandbox.runCommand("bad");

    expect(result.exit_code).toBe(1);
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("RuntimeError: boom");
  });

  it("test_run_command_404_raises_command_not_found", async () => {
    serverClient({ is_success: false, status_code: 404, json: vi.fn(() => ({ error: "not found", type: "ValueError" })) });

    await expect(fx.sandbox.runCommand("nonexistent")).rejects.toBeInstanceOf(CommandNotFoundError);
  });

  it("test_run_command_connection_failure_raises_connection_error", async () => {
    const mock_client = { post: vi.fn(async () => Promise.reject(new ConnectError("connection refused"))) };
    fx.http_client._createEnvdClient.mockReturnValue(mock_client);

    const p = fx.sandbox.runCommand("whatever");
    await expect(p).rejects.toBeInstanceOf(ConnectionError_);
    await expect(p).rejects.toThrow(/No SandboxServer reachable/);
  });

  it("test_run_command_name_kwarg_no_conflict", async () => {
    const mock_client = serverClient({ is_success: true, json: vi.fn(() => ({ result: "Hello World" })) });

    const result = await fx.sandbox.runCommand("hello", { name: "World" });

    expect(result.value).toBe("Hello World");
    expect(mock_client.post).toHaveBeenCalledWith("/commands/hello", {
      json: { name: "World" },
      headers: mock_client.post.mock.calls[0][1].headers,
    });
  });

  it("test_run_command_502_non_json_raises_connection_error", async () => {
    serverClient({
      is_success: false,
      status_code: 502,
      text: "<html>502 Bad Gateway</html>",
      json: vi.fn(() => {
        throw new JSONDecodeError("x", "y", 0);
      }),
    });

    await expect(fx.sandbox.runCommand("anything")).rejects.toBeInstanceOf(ConnectionError_);
  });
});

describe("TestSandboxListCommands", () => {
  it("test_list_commands_returns_server_catalogue", async () => {
    const commands = [{ name: "add", description: "Add", args: [{ name: "x", type: "int", required: true }] }];
    const get = vi.fn(async (..._a: any[]) => ({ is_success: true, json: vi.fn(() => ({ commands })) }));
    const mock_client = { get };
    fx.http_client._createEnvdClient.mockReturnValue(mock_client);

    expect(await fx.sandbox.listCommands()).toEqual(commands);
    expect(get.mock.calls[0]![0]).toBe("/commands");
  });

  it("test_list_commands_connection_failure_raises_connection_error", async () => {
    const mock_client = { get: vi.fn(async () => Promise.reject(new ConnectError("connection refused"))) };
    fx.http_client._createEnvdClient.mockReturnValue(mock_client);

    await expect(fx.sandbox.listCommands()).rejects.toBeInstanceOf(ConnectionError_);
  });
});
