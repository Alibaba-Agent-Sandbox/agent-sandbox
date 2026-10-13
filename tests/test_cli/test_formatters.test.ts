/** Tests for CLI output formatters. */

import { describe, expect, it } from "vitest";

import { OutputFormatter, getFormatter } from "../../src/cli/formatters.js";
import { type Command, command } from "../../src/cli/kit.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { useIsolatedEnv } from "../_support/env.js";

const iso = useIsolatedEnv();

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/** Wrap a callable as a Click command for CliRunner. */
function makeCmd(fn: () => void): Command {
  return command("cmd", {
    callback: () => {
      fn();
    },
  });
}

describe("TestOutputFormatterSuccess", () => {
  // Test print_success in all modes.

  it("test_normal_mode", async () => {
    const runner = new CliRunner();
    const fmt = new OutputFormatter({ no_color: true });
    // `runner.isolated_filesystem()`
    iso.monkeypatch.chdir(iso.tmp_path);
    const result = await runner.invoke(makeCmd(() => fmt.printSuccess("All good")));
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("All good");
  });

  it("test_json_mode", async () => {
    const runner = new CliRunner();
    const fmt = new OutputFormatter({ use_json: true });
    const result = await runner.invoke(makeCmd(() => fmt.printSuccess("All good")));
    expect(result.exit_code).toBe(0);
    const data = JSON.parse(result.output);
    expect(data["status"]).toBe("success");
    expect(data["message"]).toBe("All good");
  });

  it("test_quiet_mode", async () => {
    const runner = new CliRunner();
    const fmt = new OutputFormatter({ quiet: true });
    const result = await runner.invoke(makeCmd(() => fmt.printSuccess("All good")));
    expect(result.exit_code).toBe(0);
    expect(result.output.trim()).toBe("");
  });
});

describe("TestOutputFormatterError", () => {
  // Test print_error in all modes.

  it("test_normal_with_code_and_suggestion", async () => {
    const runner = new CliRunner();
    const fmt = new OutputFormatter({ no_color: true });
    const result = await runner.invoke(makeCmd(() => fmt.printError("Oops", { code: "E1001", suggestion: "Try again" })));
    // Click 8.5 separates stderr by default
    const err = result.stderr;
    expect(err).toContain("[E1001]");
    expect(err).toContain("Oops");
    expect(err).toContain("Try again");
  });

  it("test_json_mode_error", async () => {
    const runner = new CliRunner();
    const fmt = new OutputFormatter({ use_json: true });
    const result = await runner.invoke(makeCmd(() => fmt.printError("Bad", { code: "E2002", suggestion: "Fix it" })));
    const data = JSON.parse(result.output);
    expect(data["status"]).toBe("error");
    expect(data["code"]).toBe("E2002");
    expect(data["suggestion"]).toBe("Fix it");
  });

  it("test_error_no_suggestion_when_quiet", async () => {
    const runner = new CliRunner();
    const fmt = new OutputFormatter({ quiet: true, no_color: true });
    const result = await runner.invoke(makeCmd(() => fmt.printError("Error", { suggestion: "Hint" })));
    // Click 8.5 separates stderr by default
    const err = result.stderr;
    expect(err).not.toContain("Suggestion");
  });
});

describe("TestOutputFormatterTable", () => {
  // Test print_table in all modes.

  it("test_json_mode", async () => {
    const runner = new CliRunner();
    const fmt = new OutputFormatter({ use_json: true });
    const result = await runner.invoke(
      makeCmd(() =>
        fmt.printTable(
          ["Name", "Age"],
          [
            ["Alice", "30"],
            ["Bob", "25"],
          ],
        ),
      ),
    );
    const data = JSON.parse(result.output);
    expect(data.length).toBe(2);
    expect(data[0]).toEqual({ Name: "Alice", Age: "30" });
  });

  it("test_quiet_mode_tab_separated", async () => {
    const runner = new CliRunner();
    const fmt = new OutputFormatter({ quiet: true });
    const result = await runner.invoke(
      makeCmd(() =>
        fmt.printTable(
          ["A", "B"],
          [
            ["1", "2"],
            ["3", "4"],
          ],
        ),
      ),
    );
    const lines = result.output.trim().split("\n");
    expect(lines[0]).toBe("1\t2");
    expect(lines[1]).toBe("3\t4");
  });

  it("test_normal_mode_has_content", async () => {
    const runner = new CliRunner();
    const fmt = new OutputFormatter({ no_color: true });
    const result = await runner.invoke(makeCmd(() => fmt.printTable(["ID", "Status"], [["sbx-1", "running"]])));
    expect(result.output).toContain("sbx-1");
    expect(result.output).toContain("running");
  });
});

describe("TestOutputFormatterDict", () => {
  // Test print_dict in all modes.

  it("test_json_mode", async () => {
    const runner = new CliRunner();
    const fmt = new OutputFormatter({ use_json: true });
    const result = await runner.invoke(makeCmd(() => fmt.printDict({ key: "value", num: 42 })));
    const data = JSON.parse(result.output);
    expect(data["key"]).toBe("value");
    expect(data["num"]).toBe(42);
  });

  it("test_quiet_mode_values_only", async () => {
    const runner = new CliRunner();
    const fmt = new OutputFormatter({ quiet: true });
    const result = await runner.invoke(makeCmd(() => fmt.printDict({ key: "value", num: 42 })));
    const lines = result.output.trim().split("\n");
    expect(lines[0]).toContain("value");
    expect(lines[1]).toContain("42");
  });

  it("test_normal_mode", async () => {
    const runner = new CliRunner();
    const fmt = new OutputFormatter({ no_color: true });
    const result = await runner.invoke(makeCmd(() => fmt.printDict({ name: "test" })));
    expect(result.output).toContain("name");
    expect(result.output).toContain("test");
  });
});

describe("TestGetFormatter", () => {
  // Test get_formatter extracts context correctly.

  it("test_from_context", async () => {
    const cmd = command("cmd", {
      callback: (ctx) => {
        ctx.ensureObject(Object);
        ctx.obj!["json"] = true;
        ctx.obj!["quiet"] = false;
        ctx.obj!["no_color"] = true;
        const fmt = getFormatter(ctx);
        expect(fmt.use_json).toBe(true);
        expect(fmt.quiet).toBe(false);
        expect(fmt.no_color).toBe(true);
      },
    });

    const runner = new CliRunner();
    const result = await runner.invoke(cmd);
    expect(result.exit_code).toBe(0);
  });

  it("test_from_empty_context", async () => {
    const cmd = command("cmd", {
      callback: (ctx) => {
        ctx.obj = null;
        const fmt = getFormatter(ctx);
        expect(fmt.use_json).toBe(false);
      },
    });

    const runner = new CliRunner();
    const result = await runner.invoke(cmd);
    expect(result.exit_code).toBe(0);
  });
});

describe("TestPrintData", () => {
  // Test print_data.

  it("test_json_mode", async () => {
    const runner = new CliRunner();
    const fmt = new OutputFormatter({ use_json: true });
    const result = await runner.invoke(makeCmd(() => fmt.printData({ a: 1 })));
    const data = JSON.parse(result.output);
    expect(data).toEqual({ a: 1 });
  });

  it("test_normal_mode", async () => {
    const runner = new CliRunner();
    const fmt = new OutputFormatter();
    const result = await runner.invoke(makeCmd(() => fmt.printData("hello")));
    expect(result.output).toContain("hello");
  });
});
