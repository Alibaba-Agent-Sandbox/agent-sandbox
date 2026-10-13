/**
 * CLI end-to-end integration tests (port of `tests/integration/test_cli_e2e.py`).
 *
 * These tests exercise the CLI commands through the in-process `CliRunner`, verifying the full flow from CLI entry
 * through the Sandbox API layer. The sandbox API is stubbed, so no credentials or network are needed.
 *
 * Run with: npm run test:integration -- tests/integration/test_cli_e2e.test.ts
 */

import "../_support/isolatedHome.js";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { Sandbox } from "../../src/api/sandbox.js";
import { cli } from "../../src/cli/main.js";
import { AuthenticationError, QuotaExceededError, TemplateNotFoundError } from "../../src/models/errors.js";
import { ProcessResult } from "../../src/models/process.js";
import { SandboxInfo, SandboxStatus } from "../../src/models/sandbox.js";
import * as protocolSandbox from "../../src/protocol/sandbox.js";
import * as transportAuth from "../../src/transport/auth.js";
import * as transportConfig from "../../src/transport/config.js";
import { resetConfig } from "../../src/transport/config.js";
import * as transportHttp from "../../src/transport/http.js";
import { CliRunner } from "../helpers/cliRunner.js";

const SANDBOX_ID = "sbx-cli-test-001";
const ENVD_TOKEN = "test-envd-token-cli";

type Spy = ReturnType<typeof vi.fn>;
const spyAny = (o: object, k: string) => vi.spyOn(o as Record<string, (...a: unknown[]) => unknown>, k);

interface MockSandbox {
  id: string;
  status: string;
  is_running: boolean;
  url: string;
  info: SandboxInfo;
  commands: { run: Spy };
  kill: Spy;
}

/** Create a mock Sandbox instance with realistic attributes. */
function _make_mock_sandbox(sandbox_id = SANDBOX_ID, status: string = SandboxStatus.RUNNING, template = "python-base", region = "cn-hangzhou"): MockSandbox {
  const url = `https://${sandbox_id}.envd.fc.aliyuncs.com`;
  return {
    id: sandbox_id,
    status,
    is_running: status === SandboxStatus.RUNNING,
    url,
    info: SandboxInfo.modelValidate({
      sandboxID: sandbox_id,
      templateID: template,
      status,
      region,
      envdUrl: url,
      envdAccessToken: ENVD_TOKEN,
    }),
    commands: {
      run: vi.fn().mockResolvedValue(new ProcessResult({ stdout: "hello\n", stderr: "", exit_code: 0, execution_time: 0.1 })),
    },
    kill: vi.fn().mockResolvedValue(undefined),
  };
}

const asSandbox = (sb: unknown): Sandbox => sb as Sandbox;

beforeEach(() => {
  resetConfig();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetConfig();
});

const runner = (): CliRunner => new CliRunner();

/** stdout + stderr (Click 8.5 separates stderr by default). */
const combinedOutput = (result: { output: string; stderr: string }): string => result.output + (result.stderr || "");

// ---------------------------------------------------------------------------
// Test 1: Full CLI flow: create -> exec -> kill
// ---------------------------------------------------------------------------

it("test_cli_create_exec_kill", async () => {
  // Exercise: abx create -> abx exec -> abx kill.
  const mock_sb = _make_mock_sandbox();
  vi.spyOn(Sandbox, "create").mockResolvedValue(asSandbox(mock_sb));
  vi.spyOn(Sandbox, "connect").mockResolvedValue(asSandbox(mock_sb));
  const killById = vi.spyOn(Sandbox, "killById").mockResolvedValue(undefined);

  // --- abx create ---
  let result = await runner().invoke(cli, ["create", "--template", "python-base"]);
  expect(result.exit_code, `create failed: ${result.output}\n${result.stderr}`).toBe(0);
  expect(result.output).toContain(SANDBOX_ID);

  // --- abx exec ---
  result = await runner().invoke(cli, ["exec", SANDBOX_ID, "echo hello"]);
  expect(result.exit_code, `exec failed: ${result.output}\n${result.stderr}`).toBe(0);
  expect(result.output).toContain("hello");

  // --- abx kill ---
  result = await runner().invoke(cli, ["kill", SANDBOX_ID, "--yes"]);
  expect(result.exit_code, `kill failed: ${result.output}\n${result.stderr}`).toBe(0);
  expect(killById).toHaveBeenCalledWith(SANDBOX_ID);
});

// ---------------------------------------------------------------------------
// Test 2: JSON output format
// ---------------------------------------------------------------------------

it("test_cli_json_output", async () => {
  // Verify --json flag produces valid JSON output.
  vi.spyOn(Sandbox, "create").mockResolvedValue(asSandbox(_make_mock_sandbox()));

  const result = await runner().invoke(cli, ["--json", "create", "--template", "python-base"]);
  expect(result.exit_code, `json create failed: ${result.output}\n${result.stderr}`).toBe(0);

  const parsed = JSON.parse(result.output);
  expect(parsed["ID"]).toBe(SANDBOX_ID);
  expect(parsed["Status"]).toBe("running");
  expect(parsed["Template"]).toBe("python-base");
});

it("test_cli_exec_json_output", async () => {
  // Verify exec --json produces structured output.
  vi.spyOn(Sandbox, "connect").mockResolvedValue(asSandbox(_make_mock_sandbox()));

  const result = await runner().invoke(cli, ["--json", "exec", SANDBOX_ID, "echo hello"]);
  expect(result.exit_code, `json exec failed: ${result.output}\n${result.stderr}`).toBe(0);

  const parsed = JSON.parse(result.output);
  expect(parsed["stdout"]).toBe("hello\n");
  expect(parsed["exit_code"]).toBe(0);
});

// ---------------------------------------------------------------------------
// Test 3: Error messages include suggestions
// ---------------------------------------------------------------------------

it("test_cli_error_template_not_found", async () => {
  // TemplateNotFoundError shows error code and suggestion.
  vi.spyOn(Sandbox, "create").mockRejectedValue(new TemplateNotFoundError("Template 'bad' not found"));

  const result = await runner().invoke(cli, ["create", "--template", "bad"]);
  expect(result.exit_code).not.toBe(0);
  expect(combinedOutput(result).toLowerCase()).toContain("not found");
});

it("test_cli_error_quota_exceeded", async () => {
  // QuotaExceededError shows error code and suggestion.
  vi.spyOn(Sandbox, "create").mockRejectedValue(new QuotaExceededError("Sandbox quota exceeded"));

  const result = await runner().invoke(cli, ["create", "--template", "python-base"]);
  expect(result.exit_code).not.toBe(0);
  const combined = combinedOutput(result);
  expect(combined.toLowerCase().includes("quota") || combined.includes("E2002")).toBe(true);
});

it("test_cli_error_auth", async () => {
  // AuthenticationError shows helpful suggestion.
  vi.spyOn(Sandbox, "create").mockRejectedValue(new AuthenticationError("Invalid API key"));

  const result = await runner().invoke(cli, ["create", "--template", "python-base"]);
  expect(result.exit_code).not.toBe(0);
});

// ---------------------------------------------------------------------------
// Test 4: List sandboxes
// ---------------------------------------------------------------------------

it("test_cli_list_sandboxes", async () => {
  // abx list shows sandboxes in table format.
  const sb1_info = SandboxInfo.modelValidate({ sandboxID: "sbx-list-001", templateID: "python-base", status: "running", region: "cn-hangzhou" });
  const sb2_info = SandboxInfo.modelValidate({ sandboxID: "sbx-list-002", templateID: "node-base", status: "stopped", region: "cn-shanghai" });

  spyAny(transportConfig, "loadConfig").mockReturnValue({ api_key: "test-key", access_key_id: null, access_key_secret: null, region: "cn-hangzhou" });
  spyAny(transportAuth, "createAuthProvider").mockReturnValue({});
  spyAny(transportHttp, "HttpClient").mockImplementation(function () {
    return {};
  });
  spyAny(protocolSandbox, "SandboxProtocol").mockImplementation(function () {
    return { list: vi.fn(async () => [sb1_info, sb2_info]) };
  });

  const result = await runner().invoke(cli, ["list"]);
  expect(result.exit_code, `list failed: ${result.output}\n${result.stderr}`).toBe(0);
  expect(result.output).toContain("sbx-list-001");
  expect(result.output).toContain("sbx-list-002");
});

// ---------------------------------------------------------------------------
// Test 5: Info command
// ---------------------------------------------------------------------------

it("test_cli_info_command", async () => {
  // abx info <id> shows sandbox details.
  vi.spyOn(Sandbox, "connect").mockResolvedValue(asSandbox(_make_mock_sandbox()));

  const result = await runner().invoke(cli, ["info", SANDBOX_ID]);
  expect(result.exit_code, `info failed: ${result.output}\n${result.stderr}`).toBe(0);
  expect(result.output).toContain(SANDBOX_ID);
  expect(result.output.toLowerCase()).toContain("running");
});

// ---------------------------------------------------------------------------
// Test 7: Quiet mode
// ---------------------------------------------------------------------------

it("test_cli_quiet_mode", async () => {
  // abx --quiet suppresses non-essential output.
  vi.spyOn(Sandbox, "connect").mockResolvedValue(asSandbox(_make_mock_sandbox()));

  const result = await runner().invoke(cli, ["--quiet", "info", SANDBOX_ID]);
  expect(result.exit_code).toBe(0);
  // Quiet mode still outputs values but without decoration
});

// ---------------------------------------------------------------------------
// Test 8: Exec with non-zero exit code
// ---------------------------------------------------------------------------

it("test_cli_exec_nonzero_exit", async () => {
  // abx exec propagates non-zero exit code.
  const mock_sb = _make_mock_sandbox();
  mock_sb.commands.run = vi.fn().mockResolvedValue(new ProcessResult({ stdout: "", stderr: "command not found\n", exit_code: 127, execution_time: 0.05 }));
  vi.spyOn(Sandbox, "connect").mockResolvedValue(asSandbox(mock_sb));

  const result = await runner().invoke(cli, ["exec", SANDBOX_ID, "nonexistent_cmd"]);
  expect(result.exit_code).toBe(127);
});

