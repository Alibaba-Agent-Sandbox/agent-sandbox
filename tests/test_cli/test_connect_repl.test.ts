import { useMockCloudConfiguration } from "../_support/mockCloudConfiguration.js";
/**
 * Focused tests for the `abx connect` REPL (task 185).
 *
 * Two layers are covered:
 *
 * - `cli/repl.ts` -- failure mapping (missing-command extraction from `EnvdRpcError.envd_error`, timeouts, sanitised
 *   remote errors), spelling hints limited to session-verified commands, and the readline gate.
 * - the `abx connect` command itself -- one friendly notice per failure with no sandbox URL / MDN link / duplicate
 *   WARNING, every exit path (`exit`, `quit`, Ctrl+D and Ctrl+C) and the "state does not persist" banner.
 */

import "../_support/isolatedHome.js";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Sandbox } from "../../src/api/sandbox.js";
import { cli } from "../../src/cli/main.js";
import {
  REPL_TIMEOUT,
  _resetLineEditing,
  describeCommandFailure,
  enableLineEditing,
  programName,
  replSeams,
  sanitizeText,
} from "../../src/cli/repl.js";
import { EOFError, KeyboardInterrupt } from "../../src/cli/errors.js";
import { sys } from "../../src/cli/io.js";
import type { TextInput } from "../../src/cli/io.js";
import { CommandTimeoutError, ConnectionError_, EnvdRpcError } from "../../src/models/errors.js";
import { ProcessResult } from "../../src/models/process.js";
import * as httpx from "../../src/transport/_httpx.js";
import { getLogger } from "../../src/utils/logging.js";
import { CliRunner, type Result } from "../helpers/cliRunner.js";
import { usePristineLogging } from "./conftest.js";

const _SANDBOX_ID = "sbx-cli-test-001";
const _ENVD_MESSAGE = "envd rejected process.Process/Start with HTTP 500";
const _STATUS_HINT = "Check the sandbox status with 'abx info <SANDBOX_ID>' and retry.";

// `_pristine_logging` (autouse): isolate global logging state.
usePristineLogging();

const runner = (): CliRunner => new CliRunner();

/** Structured envd 500 for an unknown executable (Go `exec` style body). */
function notFound(name: string): EnvdRpcError {
  return new EnvdRpcError(_ENVD_MESSAGE, {
    status_code: 500,
    rpc_path: "/process.Process/Start",
    envd_error: { error: { code: 500, message: `exec: "${name}": executable file not found in $PATH` } },
  });
}

/** `AsyncMock` stand-in for `sandbox.commands.run`. */
type RunMock = ReturnType<typeof vi.fn>;

function mockSandbox(run: RunMock): Sandbox {
  return { id: _SANDBOX_ID, commands: { run } } as unknown as Sandbox;
}

/** Stdin stub exposing only what `enableLineEditing` inspects. */
class FakeStdin {
  constructor(private readonly tty: boolean) {}
  isatty(): boolean {
    return this.tty;
  }
}

// ---------------------------------------------------------------------------
// Failure mapping
// ---------------------------------------------------------------------------

describe("TestDescribeCommandFailure", () => {
  it("test_missing_command_read_from_structured_envd_error", () => {
    const failure = describeCommandFailure(notFound("sl"), { command: "sl -la", known_commands: new Set(["ls", "cat"]) });

    expect(failure.message).toBe("Command not found: sl");
    expect(failure.code).toBe("E3006");
    expect(failure.suggestion).toContain("Did you mean 'ls'?");
  });

  it("test_missing_command_falls_back_to_typed_program", () => {
    // envd reports "exec not found" without naming the executable.
    const exc = new EnvdRpcError(_ENVD_MESSAGE, {
      status_code: 500,
      rpc_path: "/process.Process/Start",
      envd_error: { error: { message: "exec not found" } },
    });

    const failure = describeCommandFailure(exc, { command: "sl -la" });

    expect(failure.message).toBe("Command not found: sl");
    expect(failure.suggestion).not.toContain("Did you mean");
  });

  it.each([
    "bash: sl: command not found",
    "bash: line 1: git: command not found",
    "sl: executable file not found",
    "not found: jq",
  ])("test_command_name_shapes_are_recognised [%s]", (detail) => {
    const exc = new EnvdRpcError(_ENVD_MESSAGE, {
      status_code: 500,
      rpc_path: "/process.Process/Start",
      envd_error: { error: { message: detail } },
    });

    const failure = describeCommandFailure(exc, { command: "whatever" });

    const expected = {
      "bash: sl: command not found": "sl",
      "bash: line 1: git: command not found": "git",
      "sl: executable file not found": "sl",
      "not found: jq": "jq",
    }[detail];
    expect(failure.message).toBe(`Command not found: ${expected}`);
  });

  it("test_cd_is_explained_as_a_shell_builtin", () => {
    const failure = describeCommandFailure(notFound("cd"), { command: "cd /app" });

    expect(failure.message).toBe("Command not found: cd");
    expect(failure.suggestion).toContain("cd /path && <cmd>");
  });

  it("test_other_shell_builtin_gets_a_state_warning", () => {
    const failure = describeCommandFailure(notFound("export"), { command: "export FOO=1" });

    expect(failure.suggestion).toContain("shell state");
  });

  it("test_spelling_hint_requires_a_close_session_command", () => {
    const failure = describeCommandFailure(notFound("figma"), { command: "figma", known_commands: new Set(["ls", "cat"]) });

    expect(failure.suggestion).not.toContain("Did you mean");
    expect(failure.suggestion).toContain("'figma'");
  });

  it("test_remote_4xx_detail_is_shown_with_status", () => {
    const exc = new EnvdRpcError(_ENVD_MESSAGE, {
      status_code: 400,
      rpc_path: "/process.Process/Start",
      envd_error: { error: { message: "invalid argument: bad pid" } },
    });

    const failure = describeCommandFailure(exc, { command: "kill -9 1" });

    expect(failure.message).toBe("Sandbox envd rejected the command (HTTP 400): invalid argument: bad pid");
    expect(failure.message).not.toContain("https://");
  });

  it("test_remote_5xx_detail_is_clipped_and_sanitised", () => {
    const blob =
      "For more information check: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/500" + " upstream exploded".repeat(40);
    const exc = new EnvdRpcError(_ENVD_MESSAGE, { status_code: 502, rpc_path: "/process.Process/Start", body_text: blob });

    const failure = describeCommandFailure(exc, { command: "ls" });

    expect(failure.message).toContain("(HTTP 502)");
    expect(failure.message).not.toContain("mozilla.org");
    expect(failure.message).not.toContain("https://");
    expect(failure.message.endsWith("...")).toBe(true);
  });

  it("test_envd_error_without_status_has_no_http_fragment", () => {
    const exc = new EnvdRpcError("envd rejected the request", { envd_error: { error: { message: "stream closed" } } });

    const failure = describeCommandFailure(exc, { command: "ls" });

    expect(failure.message).toBe("Sandbox envd rejected the command: stream closed");
  });

  it.each([
    ["sdk-timeout", () => new CommandTimeoutError("boom")],
    ["httpx-timeout", () => new httpx.ReadTimeout("slow")],
  ] as Array<[string, () => Error]>)("test_timeouts_map_to_one_short_message [%s]", (_id, make) => {
    const failure = describeCommandFailure(make(), { command: "sleep 60" });

    expect(failure.message).toBe(`Command timed out after ${REPL_TIMEOUT}s.`);
    expect(failure.code).toBe("E3001");
    expect(failure.suggestion).toContain("abx exec");
  });

  it("test_sandbox_error_url_is_scrubbed", () => {
    const exc = new ConnectionError_("connection to https://sbx-1.cn-hangzhou.e2b.fc.aliyuncs.com refused");

    const failure = describeCommandFailure(exc, { command: "ls" });

    expect(failure.message).not.toContain("https://");
    expect(failure.suggestion).not.toContain("https://");
    expect(failure.code).toBe("E5001");
  });

  it("test_http_status_error_suggests_status_check", () => {
    const request = new httpx.Request("POST", "https://sbx-1.e2b.fc.aliyuncs.com/process.Process/Start");
    const response = new httpx.Response(503, { request });
    const exc = new httpx.HTTPStatusError("Server error", { request, response });

    const failure = describeCommandFailure(exc, { command: "ls" });

    expect(failure.message).toBe("Remote request failed (HTTP 503).");
    expect(failure.suggestion).toBe(_STATUS_HINT);
  });

  it("test_protocol_error_mentions_interruption", () => {
    const failure = describeCommandFailure(new httpx.RemoteProtocolError("peer closed connection"), { command: "ls" });

    expect(failure.message).toContain("interrupted");
    expect(failure.code).toBe("E5003");
  });

  it("test_unknown_exception_falls_back_to_debug_hint", () => {
    const failure = describeCommandFailure(new Error("boom"), { command: "ls" });

    expect(failure.message).toBe("Unexpected error while running this line: boom");
    expect(failure.suggestion).toContain("-v connect");
    expect(failure.code).toBe("");
  });
});

describe("TestReplHelpers", () => {
  it("test_program_name_handles_quotes_and_fallbacks", () => {
    expect(programName('"/usr/bin/ls" -la')).toBe("/usr/bin/ls");
    expect(programName("echo hello")).toBe("echo");
    expect(programName("")).toBe("");
    // Unbalanced quotes fall back to a plain split instead of raising.
    expect(programName('echo "unclosed')).toBe("echo");
  });

  it("test_sanitize_text_removes_urls_and_mdn_links", () => {
    const text =
      "Client error '500' for url 'https://sbx-1.example/envd' " +
      "For more information check: " +
      "https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/500";

    expect(sanitizeText(text)).toBe("Client error '500' for url");
  });

  it("test_sanitize_text_collapses_whitespace", () => {
    expect(sanitizeText("a\n   b\t c")).toBe("a b c");
  });

  it("test_sanitize_text_keeps_plain_prose", () => {
    // Only the httpx "check: https://…" clause is dropped, not general text.
    const text = "For more information check the logs";

    expect(sanitizeText(text)).toBe(text);
  });
});

describe("TestEnableLineEditing", () => {
  // `monkeypatch.setattr("sys.stdin", ...)`: swap the stdin stream and restore it (and the editing state) afterwards.
  let savedStdin: TextInput;
  beforeEach(() => {
    savedStdin = sys.stdin;
    _resetLineEditing();
  });
  afterEach(() => {
    sys.stdin = savedStdin;
    _resetLineEditing();
  });

  it("test_no_tty_keeps_plain_input", () => {
    sys.stdin = new FakeStdin(false) as unknown as TextInput;

    expect(enableLineEditing()).toBe(false);
  });

  it("test_missing_stdin_degrades_gracefully", () => {
    sys.stdin = null as unknown as TextInput;

    expect(enableLineEditing()).toBe(false);
  });

  it("test_interactive_tty_enables_readline", () => {
    // `pytest.importorskip("readline")`: node:readline is always available.
    sys.stdin = new FakeStdin(true) as unknown as TextInput;

    expect(enableLineEditing()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// `abx connect` session
// ---------------------------------------------------------------------------

describe("TestConnectSession", () => {
  // End-to-end session behaviour through `CliRunner` (non-TTY stdin).

  let savedInput: typeof replSeams.input;
  let connectSpy: { mockRestore(): void } | null = null;
  beforeEach(() => {
    savedInput = replSeams.input;
  });
  afterEach(() => {
    replSeams.input = savedInput;
    connectSpy?.mockRestore();
    connectSpy = null;
  });

  /**
   * `patch("agent_sandbox.api.sandbox.Sandbox.connect", ...)` + `patch("builtins.input", side_effect=inputs)`:
   * `inputs` is either a list (strings are returned, exceptions are raised, in order) or a single exception.
   */
  async function invoke(r: CliRunner, inputs: Array<string | Error> | Error, run: RunMock): Promise<Result> {
    const sandbox = mockSandbox(run);
    connectSpy = vi.spyOn(Sandbox, "connect").mockResolvedValue(sandbox);
    const queue = Array.isArray(inputs) ? [...inputs] : null;
    replSeams.input = async () => {
      if (queue === null) throw inputs;
      const item = queue.shift();
      if (item === undefined) throw new Error("StopIteration");
      if (item instanceof Error) throw item;
      return item;
    };
    return r.invoke(cli, ["connect", _SANDBOX_ID]);
  }

  it("test_session_banner_states_no_state_persists", async () => {
    const run = vi.fn();

    const result = await invoke(runner(), ["exit"], run);

    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("Connected to sandbox sbx-cli-test-001");
    expect(result.stderr).toContain("each line runs in an independent process");
    expect(result.stderr).toContain("do not persist");
  });

  it("test_missing_command_is_one_friendly_notice", async () => {
    const run = vi.fn().mockRejectedValue(notFound("sl"));

    const result = await invoke(runner(), ["sl -la", "exit"], run);

    expect(result.exit_code).toBe(0);
    expect(result.stdout).not.toContain("Command not found");
    expect(result.stderr.split("Command not found: sl").length - 1).toBe(1);
    expect(result.stderr.split("[E3006]").length - 1).toBe(1);
    const combined = result.stdout + result.stderr;
    expect(combined).not.toContain("WARNING");
    expect(combined).not.toContain("https://");
    expect(combined).not.toContain("developer.mozilla.org");
  });

  it("test_spelling_hint_uses_commands_that_ran_in_session", async () => {
    const lsResult = new ProcessResult({ stdout: "app.py\n", stderr: "", exit_code: 0, execution_time: 0.1 });
    const run = vi.fn().mockResolvedValueOnce(lsResult).mockRejectedValueOnce(notFound("sl"));

    const result = await invoke(runner(), ["ls /app", "sl", "exit"], run);

    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("app.py");
    expect(result.stderr).toContain("Did you mean 'ls'? It ran earlier in this session.");
  });

  it("test_remote_rejection_shows_status_without_url", async () => {
    const exc = new EnvdRpcError(_ENVD_MESSAGE, {
      status_code: 503,
      rpc_path: "/process.Process/Start",
      envd_error: { error: { message: "sandbox is not running" } },
    });
    const run = vi.fn().mockRejectedValue(exc);

    const result = await invoke(runner(), ["ls", "quit"], run);

    expect(result.exit_code).toBe(0);
    expect(result.stderr).toContain("Sandbox envd rejected the command (HTTP 503): sandbox is not running");
    expect(result.stdout + result.stderr).not.toContain("https://");
  });

  it("test_timeout_keeps_the_session_alive", async () => {
    const run = vi.fn().mockRejectedValue(new httpx.ReadTimeout("read timed out"));

    const result = await invoke(runner(), ["sleep 60", "exit"], run);

    expect(result.exit_code).toBe(0);
    expect(result.stderr).toContain(`Command timed out after ${REPL_TIMEOUT}s.`);
    expect(result.stderr).toContain("Disconnected.");
  });

  it("test_library_warning_renders_once_beside_the_error", async () => {
    // A log record from the failing call must not duplicate the notice.
    const run = vi.fn(async (_cmd: string, _opts?: { timeout: number }) => {
      getLogger("transport.http").warning("envd rejected Process/Start (HTTP 500)");
      throw notFound("sl");
    });

    const result = await invoke(runner(), ["sl", "exit"], run);

    expect(result.stderr.split("WARNING: envd rejected Process/Start (HTTP 500)").length - 1).toBe(1);
    expect(result.stderr.split("Command not found: sl").length - 1).toBe(1);
  });

  it("test_quit_disconnects_without_running_anything", async () => {
    const run = vi.fn();

    const result = await invoke(runner(), ["quit"], run);

    expect(result.exit_code).toBe(0);
    expect(result.stderr).toContain("Disconnected.");
    expect(run).not.toHaveBeenCalled();
  });

  it("test_blank_lines_are_ignored", async () => {
    const run = vi.fn();

    const result = await invoke(runner(), ["", "   ", "exit"], run);

    expect(result.exit_code).toBe(0);
    expect(run).not.toHaveBeenCalled();
  });

  it("test_ctrl_d_at_prompt_disconnects_cleanly", async () => {
    const run = vi.fn();

    const result = await invoke(runner(), new EOFError(), run);

    expect(result.exit_code).toBe(0);
    expect(result.stderr).toContain("Disconnected.");
    expect(run).not.toHaveBeenCalled();
  });

  it("test_ctrl_c_at_prompt_disconnects_cleanly", async () => {
    const run = vi.fn();

    const result = await invoke(runner(), new KeyboardInterrupt(), run);

    expect(result.exit_code).toBe(0);
    expect(result.stderr).toContain("Disconnected.");
    expect(run).not.toHaveBeenCalled();
  });
});

// Remote APIs in this file are mocked; provide configuration without bypassing preflight.
useMockCloudConfiguration();
