/** Canonical deploy route validation and unknown-command hints. */

import "../_support/isolatedHome.js";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Sandbox } from "../../src/api/sandbox.js";
import { cli } from "../../src/cli/main.js";
import { CliRunner } from "../helpers/cliRunner.js";

// `runner` fixture
const runner = (): CliRunner => new CliRunner();
beforeEach(() => vi.stubEnv("ABX_SANDBOX_API_KEY", "placeholder-sandbox-key"));
afterEach(() => vi.unstubAllEnvs());

// ---------------------------------------------------------------------------
// 1. deploy route validation and removed entry
// ---------------------------------------------------------------------------

describe("TestDeployRequiresExplicitRoute", () => {
  it("rejects a missing route before native creation", async () => {
    const spy = vi.spyOn(Sandbox, "create");
    const result = await runner().invoke(cli, ["deploy", "--name", "missing-route", "--yes"]);
    expect(result.exit_code).toBe(2);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it("does not retain the retired create entry", async () => {
    const result = await runner().invoke(cli, ["create", "--template", "base"]);
    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("No such command 'create'");
  });
});

// ---------------------------------------------------------------------------
// 2. unknown top-level command hints
// ---------------------------------------------------------------------------

describe("TestUnknownCommandHints", () => {
  it("test_close_candidate_gets_correction_only", async () => {
    const result = await runner().invoke(cli, ["deplo"]);
    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("No such command 'deplo'");
    expect(result.output).toContain("Did you mean");
    expect(result.output).toContain("'deploy'");
    // High-confidence candidates must NOT show the custom-command hint.
    expect(result.output).not.toContain("custom_commands");
  });

  it("test_plausible_candidate_gets_correction_only", async () => {
    const result = await runner().invoke(cli, ["lis"]);
    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("Did you mean");
    expect(result.output).not.toContain("custom_commands");
  });

  it("test_no_candidate_points_at_help_and_named_commands", async () => {
    const result = await runner().invoke(cli, ["frobnicate"]);
    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("No such command 'frobnicate'");
    expect(result.output).toContain("abx --help");
    expect(result.output).toContain("abx sandbox command run SANDBOX NAME");
    expect(result.output).not.toContain("custom_commands");
  });

  it("test_init_and_install_are_not_top_level_commands", async () => {
    // Authoring lives under template; removed root commands receive the current hints.
    for (const name of ["init", "install"]) {
      const result = await runner().invoke(cli, [name]);
      expect(result.exit_code).toBe(2);
      expect(result.output).toContain(`No such command '${name}'`);
      expect(result.output).toContain("abx template init|build|publish");
    }
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
