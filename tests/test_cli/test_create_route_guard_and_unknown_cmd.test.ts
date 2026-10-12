/**
 * Task 210 targeted tests: explicit-route guard on `ebx create` and the root LazyGroup unknown-command hint.
 *
 * Contracts asserted here:
 * - `ebx create` with neither DESCRIPTION nor --template -> Click UsageError, exit code 2, message on stderr listing all
 *   three explicit routes.
 * - Unknown top-level command with a close spelling candidate -> exit 2 and a "Did you mean" suggestion only (no
 *   custom-command hint).
 * - Unknown top-level command with no plausible candidate -> exit 2 and the template.yaml `custom_commands` /
 *   `ebx run COMMAND` hint.
 * - JSON / quiet / CI flags do not change exit code 2 semantics.
 */

import "../_support/isolatedHome.js";

import { describe, expect, it, vi } from "vitest";

import { Sandbox } from "../../src/api/sandbox.js";
import { cli } from "../../src/cli/main.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { useDefaultShortcutsOnly } from "./conftest.js";

const THREE_ROUTES = ["ebx create --template base", "--template <NAME>", "DESCRIPTION"];

// `runner` fixture
const runner = (): CliRunner => new CliRunner();

// `_default_shortcuts_only` (autouse): pin the root CLI to the built-in default shortcuts (the real config never leaks
// in; the previous merge result is restored afterwards).
useDefaultShortcutsOnly();

// ---------------------------------------------------------------------------
// 1. ebx create without description / template
// ---------------------------------------------------------------------------

describe("TestCreateRequiresExplicitRoute", () => {
  it("test_bare_create_is_a_usage_error", async () => {
    const result = await runner().invoke(cli, ["create"]);
    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("No DESCRIPTION or --template given");
  });

  it("test_error_lists_all_three_routes", async () => {
    const result = await runner().invoke(cli, ["create"]);
    for (const fragment of THREE_ROUTES) {
      expect(result.output).toContain(fragment);
    }
  });

  // Python patches `Sandbox.create` and `run_sync`; here `Sandbox.create` is spied on (no `run_sync` bridge in the Node port).
  it("test_explicit_base_still_routes_to_base", async () => {
    // The explicit base route keeps working (no AI, no clarification).
    // A `MagicMock` answers every attribute `create` reads; spell the few that matter out.
    const mockSb = { commands: {}, id: "sbx-mock", status: "running", url: "https://sbx-mock.example", info: { template: "base", envd_version: null } };
    const spy = vi.spyOn(Sandbox, "create").mockResolvedValue(mockSb as unknown as Sandbox);
    try {
      const result = await runner().invoke(cli, ["create", "--template", "base"]);
      expect(result.exit_code, result.output).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. unknown top-level command hints
// ---------------------------------------------------------------------------

describe("TestUnknownCommandHints", () => {
  it("test_close_candidate_gets_correction_only", async () => {
    const result = await runner().invoke(cli, ["creat"]);
    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("No such command 'creat'");
    expect(result.output).toContain("Did you mean");
    expect(result.output).toContain("'create'");
    // High-confidence candidates must NOT show the custom-command hint.
    expect(result.output).not.toContain("custom_commands");
  });

  it("test_plausible_candidate_gets_correction_only", async () => {
    const result = await runner().invoke(cli, ["lis"]);
    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("Did you mean");
    expect(result.output).not.toContain("custom_commands");
  });

  it("test_no_candidate_gets_custom_command_hint", async () => {
    const result = await runner().invoke(cli, ["frobnicate"]);
    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("No such command 'frobnicate'");
    expect(result.output).toContain("template.yaml");
    expect(result.output).toContain("custom_commands");
    expect(result.output).toContain("ebx run COMMAND");
  });

  it("test_init_typo_gets_init_correction", async () => {
    // 'ebx ini' now suggests the restored top-level `init` shortcut.
    //
    // difflib at cutoff 0.6 matches 'ini' against 'init' (restored by task 211), so only the correction shows -- no
    // custom_commands hint.
    const result = await runner().invoke(cli, ["ini"]);
    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("No such command 'ini'");
    expect(result.output).toContain("Did you mean");
    expect(result.output).toContain("'init'");
    expect(result.output).not.toContain("custom_commands");
  });

  it.each([
    ["flags0", ["--json"]],
    ["flags1", ["--quiet"]],
    ["flags2", ["--ci"]],
  ] as Array<[string, string[]]>)("test_exit_code_2_regardless_of_output_mode [%s]", async (_id, flags) => {
    const result = await runner().invoke(cli, [...flags, "frobnicate"]);
    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("No such command 'frobnicate'");
  });
});
