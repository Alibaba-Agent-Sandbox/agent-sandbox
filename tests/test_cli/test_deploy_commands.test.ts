/**
 * Tests for the top-level `abx deploy` command.
 *
 * `abx deploy` is the fixed *publish* step of the template lifecycle (docker build -> push -> register) and delegates
 * to `template build`. It takes no description and no LLM: what a template is lives in `template.yaml`, authored
 * earlier by `abx template scaffold`. The pipeline itself is covered by the `template` tests, so here `build` is replaced by
 * a recorder that keeps its real option set.
 */

import "../_support/isolatedHome.js";

import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as codingAgent from "../../src/cli/commands/_coding_agent.js";
import { deploySeams, deploy_shortcut } from "../../src/providers/alicloud_express/cli/deploy.js";
import { build as realBuild } from "../../src/providers/alicloud_express/cli/template.js";
import { cli } from "../../src/cli/main.js";
import { command, getCurrentContext } from "../../src/cli/kit.js";
import { UsageError } from "../../src/cli/errors.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { delenv, useTmpPath, writeText } from "../helpers/templateSupport.js";

const runner = (): CliRunner => new CliRunner();
const tmpPath = useTmpPath();

let buildCalls: Array<Record<string, unknown>> = [];
let saved: { build: typeof deploySeams.build; resolve: typeof deploySeams.resolve_acr_namespace };

/** `build_calls` fixture: replace `template build` by a recorder; the ACR namespace resolves offline. */
beforeEach(() => {
  buildCalls = [];
  saved = { build: deploySeams.build, resolve: deploySeams.resolve_acr_namespace };
  deploySeams.build = command("build", {
    params: [...realBuild.params],
    callback: (_ctx: unknown, params: Record<string, unknown>) => {
      buildCalls.push(params);
    },
  });
  deploySeams.resolve_acr_namespace = vi.fn(() => "test-ns");
});

afterEach(() => {
  deploySeams.build = saved.build;
  deploySeams.resolve_acr_namespace = saved.resolve;
});

/** `project` fixture: a template directory that already has a Dockerfile. */
function project(): string {
  writeText(path.join(tmpPath(), "Dockerfile"), "FROM python:3.11-slim\n");
  return tmpPath();
}

describe("TestFixedPipeline", () => {
  it("test_delegates_to_build_with_project_dir", async () => {
    const p = project();
    const result = await runner().invoke(cli, ["deploy", p, "--acr-namespace", "ns", "-y"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(buildCalls.length).toBe(1);
    expect(buildCalls[0]!["template_dir"]).toBe(fs.realpathSync(p));
    expect(buildCalls[0]!["acr_namespace"]).toBe("ns");
    expect(buildCalls[0]!["yes"]).toBe(true);
  });

  it("test_path_defaults_to_current_directory", async () => {
    const p = project();
    process.chdir(p);

    const result = await runner().invoke(cli, ["deploy"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(buildCalls[0]!["template_dir"]).toBe(fs.realpathSync(p));
  });

  it("test_never_touches_the_coding_agent_or_llm_keys", async () => {
    const p = project();
    const boom = vi.fn(() => {
      throw new Error("agent must not be resolved");
    });
    vi.spyOn(codingAgent, "resolveCodingAgentBackend").mockImplementation(boom);
    vi.spyOn(codingAgent, "ensureCodingAgentBinary").mockImplementation(boom);
    vi.spyOn(codingAgent, "resolveCodingAgentCredentials").mockImplementation(boom);
    for (const v of ["ABX_LLM_API_KEY", "DASHSCOPE_API_KEY", "OPENAI_API_KEY"]) delenv(v);

    const result = await runner().invoke(cli, ["deploy", p]);

    expect(result.exit_code, result.output).toBe(0);
    expect(boom).not.toHaveBeenCalled();
    expect(buildCalls.length).toBe(1);
  });

  it.each(["-v", "--verbose"])("test_verbose_is_accepted [%s]", async (flag) => {
    const p = project();
    const result = await runner().invoke(cli, ["deploy", p, flag]);

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).not.toContain("No such option");
    expect(buildCalls[0]!["verbose_flag"]).toBe(true);
  });

  it("test_shares_every_template_build_option", () => {
    const deployOpts = new Set<string>();
    for (const p of deploy_shortcut.params) for (const o of p.kind === "option" ? p.decls : []) deployOpts.add(o);
    for (const param of realBuild.params) {
      if (param.kind === "option") for (const o of param.decls) expect(deployOpts.has(o), param.name).toBe(true);
    }
  });

  it("test_help_has_no_ai_options_and_points_at_template_init", async () => {
    const result = await runner().invoke(cli, ["deploy", "--help"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("--verbose");
    expect(result.output).toContain("--acr-namespace");
    expect(result.output).toContain("abx template scaffold");
    for (const gone of ["--agent", "--instruction", "--max-wall-time", "--max-session-turns"]) expect(result.output).not.toContain(gone);
    expect(result.output).not.toContain("--traditional");
  });

  it("test_a_description_is_not_accepted", async () => {
    const p = project();
    const result = await runner().invoke(cli, ["deploy", p, "deploy on port 8080"]);

    expect(result.exit_code).toBe(2);
    expect(result.output.toLowerCase()).toContain("unexpected extra argument");
    expect(buildCalls).toEqual([]);
  });

  it.each(["--agent", "--instruction", "-i"])("test_ai_options_are_gone [%s]", async (flag) => {
    const p = project();
    const args = ["deploy", p, flag, ...(flag === "--agent" ? [] : ["x"])];

    const result = await runner().invoke(cli, args);

    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("No such option");
    expect(buildCalls).toEqual([]);
  });

  it("test_nonexistent_path_is_rejected", async () => {
    const result = await runner().invoke(cli, ["deploy", "/nonexistent/path/xyz"]);

    expect(result.exit_code).not.toBe(0);
    expect(result.output).toContain("not an existing directory");
    expect(buildCalls).toEqual([]);
  });

  it("test_steps_template_skips_the_dockerfile_and_acr_checks", async () => {
    writeText(
      path.join(tmpPath(), "template.yaml"),
      "name: steps-only\nbase:\n  image: python:3.12-slim\nbuild:\n  run: ['true']\n",
    );

    const result = await runner().invoke(cli, ["deploy", tmpPath(), "--build", "steps", "-y"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(buildCalls.length).toBe(1);
    expect(buildCalls[0]!["build"]).toBe("steps");
    expect(deploySeams.resolve_acr_namespace).not.toHaveBeenCalled();
  });

  it("test_missing_dockerfile_points_at_template_init", async () => {
    const result = await runner().invoke(cli, ["deploy", tmpPath()]);

    expect(result.exit_code).not.toBe(0);
    expect(result.output).toContain("No Dockerfile and no template.yaml build steps");
    expect(result.output).toContain("abx template scaffold");
    expect(buildCalls).toEqual([]);
  });

  it("test_explicit_dockerfile_option_skips_the_check", async () => {
    const custom = path.join(tmpPath(), "Dockerfile.prod");
    writeText(custom, "FROM python:3.11-slim\n");

    const result = await runner().invoke(cli, ["deploy", tmpPath(), "--dockerfile", custom]);

    expect(result.exit_code, result.output).toBe(0);
    expect(buildCalls.length).toBe(1);
  });

  it("test_acr_namespace_failure_happens_before_the_build", async () => {
    const p = project();
    deploySeams.resolve_acr_namespace = vi.fn(() => {
      throw new UsageError("ACR namespace is required", getCurrentContext(true));
    });

    const result = await runner().invoke(cli, ["deploy", p]);

    expect(result.exit_code).not.toBe(0);
    expect(result.output).toContain("ACR namespace is required");
    expect(buildCalls).toEqual([]);
  });

  it("test_traditional_flag_is_removed", async () => {
    const p = project();
    const result = await runner().invoke(cli, ["deploy", p, "--traditional"]);

    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("No such option");
    expect(buildCalls.length).toBe(0);
  });
});
