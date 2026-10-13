/** Tests for sandbox capabilities CLI command. */

import "../_support/isolatedHome.js";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Sandbox } from "../../src/api/sandbox.js";
import { cli } from "../../src/cli/main.js";
import { ProcessChunk, ProcessResult } from "../../src/models/process.js";
import * as httpx from "../../src/transport/_httpx.js";
import { CliRunner } from "../helpers/cliRunner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const runner = (): CliRunner => new CliRunner();

/** Build a lightweight mock Sandbox for system/extra-command tests. */
function _makeSandbox() {
  return {
    id: "sbx-test-001",
    capabilities: new Set<string>(["shell", "files", "code"]),
    commands: { run: vi.fn(), stream: vi.fn() },
    kill: vi.fn().mockResolvedValue(undefined),
  };
}

function _patchConnect(sb: ReturnType<typeof _makeSandbox>) {
  return vi.spyOn(Sandbox, "connect").mockResolvedValue(sb as unknown as Sandbox);
}

/** Wrap a list of chunks into an async iterator for a streaming-exec mock. */
class _AsyncIter implements AsyncIterableIterator<ProcessChunk> {
  private readonly _chunks: ProcessChunk[];

  constructor(chunks: ProcessChunk[]) {
    this._chunks = [...chunks];
  }

  [Symbol.asyncIterator](): this {
    return this;
  }

  async next(): Promise<IteratorResult<ProcessChunk>> {
    if (!this._chunks.length) return { done: true, value: undefined };
    return { done: false, value: this._chunks.shift() as ProcessChunk };
  }
}

/** Python `str.splitlines()` for `\n`-terminated text. */
function _splitlines(text: string): string[] {
  return text === "" ? [] : text.replace(/\n$/, "").split("\n");
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ===================================================================
// sandbox system env
// ===================================================================

describe("TestSystemEnv", () => {
  // CLI coverage for the current read-only ``sandbox system env`` command.

  it("test_command_is_registered_and_help_describes_current_interface", async () => {
    const system_help = await runner().invoke(cli, ["sandbox", "system", "--help"]);
    const env_help = await runner().invoke(cli, ["sandbox", "system", "env", "--help"]);

    expect(system_help.exit_code).toBe(0);
    expect(system_help.output).toContain("env");
    expect(env_help.exit_code).toBe(0);
    expect(env_help.output).toContain("SANDBOX_ID");
    expect(env_help.output).toContain("--filter");
    expect(env_help.output).toContain("Show environment variables");
  });

  it("test_requires_sandbox_id", async () => {
    const result = await runner().invoke(cli, ["sandbox", "system", "env"]);

    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("Missing argument 'SANDBOX_ID'");
  });

  it("test_reads_sorts_and_sanitizes_environment", async () => {
    const sb = _makeSandbox();
    sb.commands.run.mockResolvedValue(
      new ProcessResult({
        stdout:
          "ZED=last\n" +
          "PATH=/usr/local/bin\n" +
          "API_TOKEN=hidden\n" +
          "CREDENTIAL_FILE=hidden\n" +
          "WITH_EQUALS=one=two\n" +
          "malformed\n" +
          "ALPHA=first\n",
      }),
    );

    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "system", "env", "sbx-test-001"]);

    expect(result.exit_code).toBe(0);
    expect(_splitlines(result.output)).toEqual([
      "ALPHA=first",
      "PATH=/usr/local/bin",
      "WITH_EQUALS=one=two",
      "ZED=last",
    ]);
    expect(sb.commands.run).toHaveBeenCalledTimes(1);
    expect(sb.commands.run).toHaveBeenCalledWith("env", { timeout: 10 });
  });

  it("test_filter_limits_returned_variables", async () => {
    const sb = _makeSandbox();
    sb.commands.run.mockResolvedValue(new ProcessResult({ stdout: "HOME=/home/sandbox\nLANG=C.UTF-8\nPATH=/usr/bin\n" }));

    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "system", "env", "sbx-test-001", "--filter", " PATH, LANG "]);

    expect(result.exit_code).toBe(0);
    expect(_splitlines(result.output)).toEqual(["LANG=C.UTF-8", "PATH=/usr/bin"]);
    expect(result.output).not.toContain("HOME");
  });

  it("test_no_matching_variables_has_friendly_output", async () => {
    const sb = _makeSandbox();
    sb.commands.run.mockResolvedValue(new ProcessResult({ stdout: "API_KEY=hidden\n" }));

    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "system", "env", "sbx-test-001"]);

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("No matching environment variables found.");
    expect(result.output).not.toContain("hidden");
  });

  it("test_remote_command_failure_is_friendly", async () => {
    const sb = _makeSandbox();
    sb.commands.run.mockResolvedValue(new ProcessResult({ stderr: "env failed", exit_code: 1 }));

    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "system", "env", "sbx-test-001"]);

    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("Failed to retrieve environment variables.");
    expect(result.output).not.toContain("Traceback");
  });

  it("test_json_output", async () => {
    const sb = _makeSandbox();
    sb.commands.run.mockResolvedValue(
      new ProcessResult({ stdout: "PATH=/usr/bin\nHOME=/home/sandbox\nAPI_SECRET=hidden\n" }),
    );

    _patchConnect(sb);
    const result = await runner().invoke(cli, ["--json", "sandbox", "system", "env", "sbx-test-001"]);

    expect(result.exit_code).toBe(0);
    expect(JSON.parse(result.output)).toEqual({ variables: { HOME: "/home/sandbox", PATH: "/usr/bin" } });
  });

  it("test_quiet_output_keeps_final_values", async () => {
    const sb = _makeSandbox();
    sb.commands.run.mockResolvedValue(new ProcessResult({ stdout: "PATH=/usr/bin\nHOME=/home/sandbox\n" }));

    _patchConnect(sb);
    const result = await runner().invoke(cli, ["--quiet", "sandbox", "system", "env", "sbx-test-001"]);

    expect(result.exit_code).toBe(0);
    expect(_splitlines(result.output)).toEqual(["HOME=/home/sandbox", "PATH=/usr/bin"]);
  });

  function _http_error(status: number): httpx.HTTPStatusError {
    const request = new httpx.Request("GET", "https://sandbox.example/env");
    const response = new httpx.Response(status, { request });
    return new httpx.HTTPStatusError(String(status), { request, response });
  }

  it("test_http_404_is_friendly", async () => {
    vi.spyOn(Sandbox, "connect").mockRejectedValue(_http_error(404));
    const result = await runner().invoke(cli, ["sandbox", "system", "env", "missing-sandbox"]);

    expect(result.exit_code).toBe(4);
    expect(result.output).toContain("Resource not found (HTTP 404).");
    expect(result.output).toContain("Verify the sandbox ID");
    expect(result.output).not.toContain("Traceback");
  });

  it("test_http_401_is_friendly", async () => {
    vi.spyOn(Sandbox, "connect").mockRejectedValue(_http_error(401));
    const result = await runner().invoke(cli, ["sandbox", "system", "env", "sbx-test-001"]);

    expect(result.exit_code).toBe(3);
    expect(result.output).toContain("Authentication failed (HTTP 401).");
    expect(result.output).toContain("Check your API key");
    expect(result.output).not.toContain("Traceback");
  });

  it("test_http_timeout_is_friendly", async () => {
    const request = new httpx.Request("GET", "https://sandbox.example/env");
    vi.spyOn(Sandbox, "connect").mockRejectedValue(new httpx.ReadTimeout("read timed out", { request }));
    const result = await runner().invoke(cli, ["sandbox", "system", "env", "sbx-test-001"]);

    expect(result.exit_code).toBe(5);
    expect(result.output).toContain("Request timed out: read timed out");
    expect(result.output).toContain("Increase HTTP timeout");
    expect(result.output).not.toContain("Traceback");
  });

  it("test_protocol_error_is_friendly", async () => {
    // httpx.RemoteProtocolError (HTTP/2 StreamReset) maps to E5003.
    const request = new httpx.Request("GET", "https://sandbox.example/env");
    vi.spyOn(Sandbox, "connect").mockRejectedValue(
      new httpx.RemoteProtocolError("peer closed connection without sending complete message body", { request }),
    );
    const result = await runner().invoke(cli, ["sandbox", "system", "env", "sbx-test-001"]);

    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("Connection reset by remote");
    expect(result.output).toContain("E5003");
    expect(result.output).toContain("Disable HTTP/2");
    expect(result.output).not.toContain("Traceback");
  });
});

// ===================================================================
// sandbox capabilities
// ===================================================================

describe("TestCapabilities", () => {
  it("test_capabilities_happy", async () => {
    // Capabilities listed in sorted order.
    const sb = _makeSandbox();
    sb.capabilities = new Set(["shell", "files", "code"]);
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "capabilities", "sbx-test-001"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("code");
    expect(result.output).toContain("files");
    expect(result.output).toContain("shell");
  });

  it("test_capabilities_empty", async () => {
    const sb = _makeSandbox();
    sb.capabilities = new Set();
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "capabilities", "sbx-test-001"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("No capabilities");
  });

  it("test_capabilities_json", async () => {
    const sb = _makeSandbox();
    sb.capabilities = new Set(["shell", "files"]);
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["--json", "sandbox", "capabilities", "sbx-test-001"]);
    expect(result.exit_code).toBe(0);
    const data = JSON.parse(result.output);
    expect("capabilities" in data).toBe(true);
    expect([...data.capabilities].sort()).toEqual(["files", "shell"]);
  });
});
