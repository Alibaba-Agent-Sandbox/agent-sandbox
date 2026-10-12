/**
 * Workflow end-to-end tests (port of `tests/integration/test_workflow_e2e.py`): CLI command completeness.
 *
 * `TestTemplateDefinition`, `TestCapabilityResolution`, `TestImageChainBuilder` and `TestDeclarativeServerBridge` of the
 * Python module exercise the Python SDK itself (template model, capability resolution, `Image` chain builder, the
 * declarative -> server bridge) and live on in `python-sdk/client-sdk/tests/integration/test_workflow_e2e.py`; they are
 * recorded in `parity/moved-to-python-sdk.txt` and are not part of the CLI port.
 */

import "../_support/isolatedHome.js";

import { describe, expect, it } from "vitest";

import { cli } from "../../src/cli/main.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { useDefaultShortcutsOnly } from "../test_cli/conftest.js";

useDefaultShortcutsOnly();

const runner = (): CliRunner => new CliRunner();

describe("TestCLICompleteness", () => {
  // Verify that all expected commands are registered and accessible.
  it("test_ebx_help_contains_all_commands", async () => {
    // ebx --help should list all expected subcommands.
    const result = await runner().invoke(cli, ["--help"]);
    expect(result.exit_code).toBe(0);
    const output = result.output;

    const expected_commands = [
      "config",
      "connect",
      "create",
      "deploy",
      "download",
      "exec",
      "info",
      "install",
      "kill",
      "list",
      "mcp",
      "run",
      "sandbox",
      "template",
      "upload",
    ];
    for (const cmd of expected_commands) expect(output, `Command '${cmd}' not found in ebx --help output`).toContain(cmd);
  });

  it("test_template_help", async () => {
    // ebx template --help should show subcommands.
    const result = await runner().invoke(cli, ["template", "--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output.toLowerCase()).toContain("template");
  });

  it("test_config_list_runs", async () => {
    // ebx config list should run without errors.
    const result = await runner().invoke(cli, ["config", "list"]);
    expect(result.exit_code).toBe(0);
  });

  it("test_version_option", async () => {
    // ebx --version should print package version.
    const result = await runner().invoke(cli, ["--version"]);
    expect(result.exit_code).toBe(0);
  });
});
