/** Tests for `ebx run` dispatching to Sandbox.custom (server call). */

import "../_support/isolatedHome.js";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Sandbox } from "../../src/api/sandbox.js";
import { cli } from "../../src/cli/main.js";
import { CommandNotFoundError } from "../../src/models/errors.js";
import { CommandResult } from "../../src/models/process.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { useDefaultShortcutsOnly } from "./conftest.js";

useDefaultShortcutsOnly();

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A connected Sandbox stand-in whose `custom(name, ...)` returns a server-sourced `CommandResult` whose `value` is
 * `run_command_result` (mechanism B).
 */
function _makeMockSandbox(run_command_result: unknown = "ok") {
  return {
    custom: vi.fn().mockResolvedValue(new CommandResult({ value: run_command_result, exit_code: 0, source: "server" })),
  };
}

// The Python tests also patch `declarative.decorator.sandbox._registry` with a fake registry; `ebx run` never reads that
// registry (dispatch goes through `Sandbox.custom`), so there is nothing to patch here.

describe("TestRunCommandServer", () => {
  // `ebx run <id> <cmd> --key value` dispatches via Sandbox.custom.

  it("test_run_command_success", async () => {
    // Happy path: custom() hits the server -> result printed.
    const mockSb = _makeMockSandbox(42);
    vi.spyOn(Sandbox, "connect").mockResolvedValue(mockSb as unknown as Sandbox);

    const result = await new CliRunner().invoke(cli, ["run", "sbx-123", "mytool", "--x", "1", "--y", "hi"]);

    expect(result.exit_code, `exit_code=${result.exit_code}\noutput:\n${result.output}`).toBe(0);
    expect(mockSb.custom).toHaveBeenCalledTimes(1);
    expect(mockSb.custom).toHaveBeenCalledWith("mytool", { server_port: 9000, x: "1", y: "hi" });
    expect(result.output).toContain("42");
  });

  it("test_run_command_json_output", async () => {
    // With `--json`, the result is printed as JSON data.
    const mockSb = _makeMockSandbox({ sum: 3 });
    vi.spyOn(Sandbox, "connect").mockResolvedValue(mockSb as unknown as Sandbox);

    const result = await new CliRunner().invoke(cli, ["--json", "run", "sbx-123", "mytool", "--x", "1"]);

    expect(result.exit_code, `exit_code=${result.exit_code}\noutput:\n${result.output}`).toBe(0);
    expect(result.output).toContain("result");
  });

  it("test_run_command_runtime_error", async () => {
    // CommandNotFoundError from custom() surfaces in CLI output.
    const mockSb = {
      custom: vi.fn().mockRejectedValue(
        new CommandNotFoundError("bad", {
          checked: ["template custom_commands", "sandbox server"],
          server_status: "reachable but command not found (HTTP 404)",
        }),
      ),
    };
    vi.spyOn(Sandbox, "connect").mockResolvedValue(mockSb as unknown as Sandbox);

    const result = await new CliRunner().invoke(cli, ["run", "sbx-123", "bad"]);

    // CommandNotFoundError should surface (non-zero exit or error output)
    expect(result.exit_code !== 0 || result.output.includes("not found")).toBe(true);
  });
});
