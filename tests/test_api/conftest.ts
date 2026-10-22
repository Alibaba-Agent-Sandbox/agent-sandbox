import { providerNetwork } from "../helpers/networkSupport.js";
/**
 * Shared fixtures for API layer tests (port of `tests/test_api/conftest.py`).
 *
 * Mocks at the protocol level so we test the API layer in isolation.
 */

import { vi } from "vitest";

import { ResolvedCapabilities } from "../../src/api/capability.js";
import { CodeContextModule } from "../../src/api/code.js";
import { CommandsModule } from "../../src/api/commands.js";
import { FilesModule } from "../../src/api/files.js";
import { NetworkModule } from "../../src/api/network.js";
import { Sandbox } from "../../src/api/sandbox.js";
import { FileInfo, FileType } from "../../src/models/filesystem.js";
import { ProcessChunk, ProcessChunkType, ProcessInfo } from "../../src/models/process.js";
import { SandboxInfo, SandboxStatus } from "../../src/models/sandbox.js";
import { STANDARD_CAPABILITIES } from "../../src/models/template.js";
import { EnvdTokenManager } from "../../src/providers/alicloud_express/auth.js";
import { TransportConfig } from "../../src/transport/config.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---- Constants ----

export const TEST_SANDBOX_ID = "sbx-test-api-123456";
export const TEST_ENVD_URL = "https://sbx-test-api-123456.cn-hangzhou.e2b.fc.aliyuncs.com";
export const TEST_ENVD_TOKEN = "test-envd-access-token-abc";
export const TEST_API_KEY = "test-api-key-xyz";

// ---- Model Factories ----

export function makeSandboxInfo(
  opts: { sandbox_id?: string; status?: string; envd_url?: string; envd_access_token?: string; template?: string } = {},
): SandboxInfo {
  const {
    sandbox_id = TEST_SANDBOX_ID,
    status = SandboxStatus.RUNNING,
    envd_url = TEST_ENVD_URL,
    envd_access_token = TEST_ENVD_TOKEN,
    template = "python-base",
  } = opts;
  return SandboxInfo.modelValidate({
    sandboxID: sandbox_id,
    status,
    envdUrl: envd_url,
    envdAccessToken: envd_access_token,
    templateID: template,
    timeout: 300,
    region: "cn-hangzhou",
  });
}

// ---- Async iterable helper for process mocking ----

/** A minimal async iterable that mimics StreamReader for testing. */
export class MockStreamReader<T = any> {
  _chunks: T[];

  constructor(chunks: Iterable<T>) {
    this._chunks = [...chunks];
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        if (!this._chunks.length) return { done: true, value: undefined };
        return { done: false, value: this._chunks.shift() as T };
      },
    };
  }

  async collect(): Promise<T[]> {
    const result: T[] = [];
    for await (const item of this) result.push(item);
    return result;
  }
}

// ---- Protocol Mocks ----

export function mockSandboxProtocol(): any {
  return {
    create: vi.fn(async () => makeSandboxInfo()),
    getInfo: vi.fn(async () => makeSandboxInfo()),
    connect: vi.fn(async () => makeSandboxInfo()),
    kill: vi.fn(async () => null),
    setTimeout: vi.fn(async () => null),
    isRunning: vi.fn(async () => true),
    pause: vi.fn(async () => null),
    resume: vi.fn(async () => null),
    list: vi.fn(async () => [makeSandboxInfo()]),
    listV2: vi.fn(async () => []),
  };
}

export function mockProcessProtocol(): any {
  const default_chunks = [
    new ProcessChunk({ type: ProcessChunkType.STDOUT, data: "hello\n" }),
    new ProcessChunk({ type: ProcessChunkType.EXIT, exit_code: 0 }),
  ];
  const reader = new MockStreamReader(default_chunks);
  return {
    start: vi.fn(async () => reader),
    listProcesses: vi.fn(async () => [new ProcessInfo({ pid: 1234, command: "python3 app.py", status: "running" })]),
    kill: vi.fn(async () => null),
    sendInput: vi.fn(async () => null),
    sendSignal: vi.fn(async () => null),
    sendStdin: vi.fn(async () => null),
    connectToProcess: vi.fn(),
    update: vi.fn(),
  };
}

export function mockFilesystemProtocol(): any {
  return {
    transferUrl: vi.fn(async (url: string, _token: unknown, opts: { path: string }) => `${url}/files?path=${opts.path}&username=user`),
    readText: vi.fn(async () => "file content"),
    read: vi.fn(async () => new TextEncoder().encode("file bytes")),
    write: vi.fn(async () => null),
    listDir: vi.fn(async () => [
      new FileInfo({ name: "app.py", path: "/app/app.py", type: FileType.FILE, size: 1024 }),
      new FileInfo({ name: "data", path: "/app/data", type: FileType.DIRECTORY, size: 0 }),
    ]),
    exists: vi.fn(async () => true),
    remove: vi.fn(async () => null),
    makeDir: vi.fn(async () => null),
    move: vi.fn(async () => null),
    getInfo: vi.fn(async () => new FileInfo({ name: "app.py", path: "/app/app.py", type: FileType.FILE, size: 1024 })),
    stat: vi.fn(),
    watchDir: vi.fn(),
    uploadFile: vi.fn(),
    downloadFile: vi.fn(),
    rename: vi.fn(),
  };
}

export function mockCodeInterpreterProtocol(): any {
  return {
    runCode: vi.fn(async () => ({ stdout: "42\n", stderr: "", exitCode: 0, executionTime: 0.05 })),
    createContext: vi.fn(async () => ({ contextId: "ctx-001", language: "python" })),
    listContexts: vi.fn(async () => [{ contextId: "ctx-001", language: "python" }]),
    restartContext: vi.fn(async () => ({ contextId: "ctx-001", status: "active" })),
    removeContext: vi.fn(async () => null),
  };
}

export function mockHttpClient(): any {
  return {
    close: vi.fn(async () => null),
    platformRequest: vi.fn(),
    envdRequest: vi.fn(),
    envdStream: vi.fn(),
    envdHttpRequest: vi.fn(),
    _createEnvdClient: vi.fn(),
  };
}

export function mockAuth(): any {
  return { getHeaders: vi.fn(async () => ({ "X-API-KEY": TEST_API_KEY })) };
}

export function envdTokenManager(): EnvdTokenManager {
  return new EnvdTokenManager(TEST_ENVD_TOKEN);
}

export function transportConfig(): TransportConfig {
  return new TransportConfig({ api_key: TEST_API_KEY });
}

// ---- All capabilities for backward-compat test fixtures ----

/** All standard capabilities — used by default in test fixtures so existing tests that call any API method aren't blocked by gating. */
export const ALL_CAPABILITIES: Set<string> = new Set(STANDARD_CAPABILITIES);

// ---- Assembled Sandbox Fixture ----

export interface SandboxFixture {
  sandbox: Sandbox;
  http_client: any;
  auth: any;
  sandbox_protocol: any;
  process_protocol: any;
  filesystem_protocol: any;
  code_interpreter_protocol: any;
}

/** Create a fully-mocked Sandbox instance for testing. Grants ALL capabilities so existing tests aren't blocked by gating. */
export function makeSandboxFixture(): SandboxFixture {
  const http_client = mockHttpClient();
  const auth = mockAuth();
  const sandbox_protocol = mockSandboxProtocol();
  const process_protocol = mockProcessProtocol();
  const filesystem_protocol = mockFilesystemProtocol();
  const code_interpreter_protocol = mockCodeInterpreterProtocol();
  const info = makeSandboxInfo();
  const resolved = new ResolvedCapabilities({ capabilities: ALL_CAPABILITIES });
  const sandbox = new Sandbox({
    info,
    config: transportConfig(),
    http_client,
    auth,
    envd_token: envdTokenManager(),
    sandbox_protocol,
    process_protocol,
    filesystem_protocol,
    code_interpreter_protocol,
    resolved_capabilities: resolved,
  });
  return { sandbox, http_client, auth, sandbox_protocol, process_protocol, filesystem_protocol, code_interpreter_protocol };
}

// ---- Sub-module Fixtures ----

export function makeCommandsModule(process_protocol: any = mockProcessProtocol()): { module: CommandsModule; process_protocol: any } {
  return {
    module: new CommandsModule(TEST_ENVD_URL, envdTokenManager(), process_protocol, ALL_CAPABILITIES),
    process_protocol,
  };
}

export function makeFilesModule(
  filesystem_protocol: any = mockFilesystemProtocol(),
  sandbox_protocol: any = mockSandboxProtocol(),
): { module: FilesModule; filesystem_protocol: any; sandbox_protocol: any } {
  return {
    module: new FilesModule(TEST_ENVD_URL, envdTokenManager(), filesystem_protocol, sandbox_protocol, TEST_SANDBOX_ID, ALL_CAPABILITIES),
    filesystem_protocol,
    sandbox_protocol,
  };
}

export function makeNetworkModule(): NetworkModule {
  return providerNetwork({
    sandbox_id: TEST_SANDBOX_ID,
    domain: "cn-hangzhou.e2b.fc.aliyuncs.com",
    secure: true,
    access_token: TEST_ENVD_TOKEN,
    capabilities: ALL_CAPABILITIES,
  });
}

export function makeCodeModule(
  code_interpreter_protocol: any = mockCodeInterpreterProtocol(),
  process_protocol: any = mockProcessProtocol(),
): { module: CodeContextModule; code_interpreter_protocol: any; process_protocol: any } {
  return {
    module: new CodeContextModule(
      TEST_SANDBOX_ID,
      TEST_ENVD_URL,
      envdTokenManager(),
      code_interpreter_protocol,
      ALL_CAPABILITIES,
      process_protocol,
    ),
    code_interpreter_protocol,
    process_protocol,
  };
}

// ---- Logging capture (pytest `caplog` equivalent) ----

import { Handler, type LogRecord, stdGetLogger } from "../../src/utils/logging.js";

class CaptureHandler extends Handler {
  records: LogRecord[] = [];
  override emit(record: LogRecord): void {
    this.records.push(record);
  }
}

/** `caplog.at_level(level, logger=name)`: capture records emitted by `name` at or above `level`. */
export function captureLogs(logger_name: string, level: number): { records: LogRecord[]; messages: () => string[]; restore: () => void } {
  const logger = stdGetLogger(logger_name);
  const handler = new CaptureHandler();
  const prev_level = logger.level;
  logger.addHandler(handler);
  logger.setLevel(level);
  return {
    records: handler.records,
    messages: () => handler.records.map((r) => r.getMessage()),
    restore: () => {
      logger.removeHandler(handler);
      logger.setLevel(prev_level);
    },
  };
}
