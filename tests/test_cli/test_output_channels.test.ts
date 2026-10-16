/**
 * Channel-separation tests for the CLI output manager (task 167).
 *
 * The contract under test:
 *
 *  - **stdout** carries only what a user or a script consumes as the result (`data` / `table` / `success`),
 *  - **stderr** carries progress state, diagnostics and every stdlib `logging` record,
 *  - a library warning is rendered exactly once (no duplicate handler), and
 *  - output written while a Rich spinner is live pauses/restores that spinner instead of interleaving with it.
 *
 * Everything here runs through `CliRunner` so `result.stdout` / `result.stderr` are inspected separately --
 * `result.output` is the mixed stream and would hide exactly the pollution these tests guard against.
 */

import "../_support/isolatedHome.js";

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { Sandbox } from "../../src/api/sandbox.js";
import * as fcTemplate from "../../src/api/fc_template.js";
import { cli } from "../../src/cli/main.js";
import { OutputManager, getOutput } from "../../src/cli/output.js";
import { type Command, type Context, command, option } from "../../src/cli/kit.js";
import { SandboxInfo } from "../../src/models/sandbox.js";
import * as transportConfig from "../../src/transport/config.js";
import { getLogger } from "../../src/utils/logging.js";
import { logging } from "../../src/utils/logging.js";
import { useIsolatedEnv } from "../_support/env.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { usePristineLogging } from "./conftest.js";

const iso = useIsolatedEnv();
usePristineLogging();

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

/**
 * Build a click command that runs *body* with a context-bound manager.
 *
 * The manager is stored in `ctx.meta["abx.output"]` exactly like the real CLI root group does, so `getOutput(ctx)`
 * returns it.
 */
function makeCtxCmd(body: (out: OutputManager) => void | Promise<void>): Command {
  return command("emit", {
    params: [option("--quiet", { is_flag: true }), option(["--json", "json_flag"], { is_flag: true }), option(["--verbose", "verbose_flag"], { is_flag: true })],
    callback: async (ctx: Context, params) => {
      ctx.meta["abx.output"] = new OutputManager({
        quiet: params["quiet"],
        json_mode: params["json_flag"],
        verbose: params["verbose_flag"],
        no_color: true,
      });
      await body(getOutput(ctx));
    },
  });
}

/** Minimal stand-in for a Rich `Status` object. */
class FakeStatus {
  constructor(private readonly events: string[]) {}
  stop(): void {
    this.events.push("stop");
  }
  start(): void {
    this.events.push("start");
  }
}

function mockSandbox(sandboxId = "sbx-chan-001", template = "base"): Record<string, unknown> {
  const info = SandboxInfo.modelValidate({
    sandboxID: sandboxId,
    templateID: template,
    status: "running",
    region: "cn-hangzhou",
    timeout: 300,
    envdUrl: `https://${sandboxId}.cn-hangzhou.e2b.fc.aliyuncs.com`,
    envdAccessToken: "tok",
  });
  return { id: info.sandbox_id, status: info.status, url: info.envd_url, info, files: {} };
}

/**
 * Invoke `abx create` with a mocked SDK that logs a fallback warning.
 *
 * The warning emulates `api.capability`'s capability-resolver fallback -- the record that used to be printed twice and
 * used to leak into stdout in `--json` mode.
 */
async function invokeCreate(runner: CliRunner, args: string[], template = "base") {
  const mockSb = mockSandbox(undefined, template);
  const create = vi.spyOn(Sandbox, "create").mockImplementation((async () => {
    getLogger("api.capability").warning(
      "Could not resolve capabilities for template %r; no matching template.yaml in ~/.abx/templates. " +
        "Using default capabilities shell, files, code. " +
        "Run 'abx template deploy' to cache it, or copy template.yaml to ~/.abx/templates/<id>/template.yaml.",
      template,
    );
    return mockSb as unknown as Sandbox;
  }) as never);
  try {
    return await runner.invoke(cli, args);
  } finally {
    create.mockRestore();
  }
}

// ---------------------------------------------------------------------------
// OutputManager channel policy
// ---------------------------------------------------------------------------

describe("TestOutputChannels", () => {
  // Results on stdout, status + diagnostics on stderr.

  it("test_result_helpers_write_to_stdout", async () => {
    const result = await new CliRunner().invoke(
      makeCtxCmd((out) => {
        out.data({ ID: "sbx-1" });
        out.success("done");
      }),
      [],
    );

    expect(result.exit_code).toBe(0);
    expect(result.stdout.split("\n").filter((l, i, a) => i < a.length - 1 || l !== "")).toEqual(["ID  sbx-1", "done"]);
    expect(result.stderr).toBe("");
  });

  it("test_diagnostic_helpers_write_to_stderr", async () => {
    const result = await new CliRunner().invoke(
      makeCtxCmd((out) => {
        out.info("starting");
        out.progress("step 1");
        out.warning("careful");
        out.error("boom", { code: "E1001", suggestion: "retry" });
      }),
      [],
    );

    expect(result.exit_code).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr.split("\n").filter((l, i, a) => i < a.length - 1 || l !== "")).toEqual([
      "starting",
      "... step 1",
      "Warning: careful",
      "[E1001] boom",
      "  Suggestion: retry",
    ]);
  });

  it("test_quiet_keeps_only_result_values", async () => {
    const result = await new CliRunner().invoke(
      makeCtxCmd((out) => {
        out.info("hidden");
        out.progress("hidden");
        out.warning("hidden");
        out.data({ ID: "sbx-1", Status: "running" });
      }),
      ["--quiet"],
    );

    expect(result.stdout).toBe("sbx-1\nrunning\n");
    expect(result.stderr).toBe("");
  });

  it("test_json_mode_keeps_stdout_a_single_document", async () => {
    const result = await new CliRunner().invoke(
      makeCtxCmd((out) => {
        out.info("starting");
        out.warning("careful");
        out.data({ ID: "sbx-1" });
      }),
      ["--json"],
    );

    // The whole stdout stream must decode as one JSON document.
    expect(JSON.parse(result.stdout)).toEqual({ ID: "sbx-1" });
    expect(result.stderr).toContain("starting");
    expect(result.stderr).toContain("careful");
    expect(result.stdout).not.toContain("starting");
  });

  it("test_debug_requires_verbose_and_stays_on_stderr", async () => {
    const cmd = makeCtxCmd((out) => {
      out.debug("detail");
    });

    const silent = await new CliRunner().invoke(cmd, []);
    expect(silent.stderr).not.toContain("detail");

    const verbose = await new CliRunner().invoke(cmd, ["--verbose"]);
    expect(verbose.stderr).toContain("DEBUG: detail");
    expect(verbose.stdout).toBe("");
  });
});

// ---------------------------------------------------------------------------
// stdlib logging bridge
// ---------------------------------------------------------------------------

describe("TestLoggingBridge", () => {
  // One handler, one line, always on stderr.

  it("test_manager_owns_a_single_root_handler", async () => {
    await new CliRunner().invoke(
      makeCtxCmd(() => undefined),
      [],
    );

    expect(logging.getLogger().handlers.length).toBe(1);
    expect(logging.getLogger("agent_sandbox").handlers).toEqual([]);
  });

  it("test_library_warning_is_rendered_once_on_stderr", async () => {
    const result = await new CliRunner().invoke(
      makeCtxCmd(() => {
        getLogger("api.capability").warning("fallback %s", "base");
      }),
      [],
    );

    expect(result.exit_code).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("WARNING: fallback base\n");
  });

  it("test_sdk_configured_before_manager_still_renders_once", async () => {
    // A module-scope `getLogger` installs the SDK's standalone handler; the manager must take that handler over
    // instead of stacking on it.
    getLogger("api.capability");

    const result = await new CliRunner().invoke(
      makeCtxCmd(() => {
        getLogger("api.capability").warning("fallback");
      }),
      [],
    );

    expect(result.stderr).toBe("WARNING: fallback\n");
  });

  it("test_quiet_suppresses_library_warnings", async () => {
    const result = await new CliRunner().invoke(
      makeCtxCmd(() => {
        getLogger("api.capability").warning("fallback");
      }),
      ["--quiet"],
    );

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Spinner guard
// ---------------------------------------------------------------------------

describe("TestSpinnerGuard", () => {
  // Writes pause a live spinner and resume it afterwards.

  it("test_writes_pause_and_resume_the_live_spinner", async () => {
    const events: string[] = [];

    const result = await new CliRunner().invoke(
      makeCtxCmd((out) => {
        // White-box: a live Rich status would be registered by `OutputManager.spinner`; a fake keeps the test
        // TTY-independent.
        out._spinnerStack.push(new FakeStatus(events));
        out.warning("careful");
        out.data({ ID: "sbx-1" });
        events.push("end");
      }),
      [],
    );

    expect(events).toEqual(["stop", "start", "stop", "start", "end"]);
    expect(result.stderr).toContain("careful");
    expect(result.stdout).toContain("sbx-1");
  });

  it("test_no_spinner_means_no_lifecycle_calls", async () => {
    const result = await new CliRunner().invoke(
      makeCtxCmd((out) => {
        out.warning("careful");
      }),
      [],
    );

    expect(result.stderr).toBe("Warning: careful\n");
  });
});

// ---------------------------------------------------------------------------
// `abx create` end-to-end
// ---------------------------------------------------------------------------

describe("TestCreateChannelSeparation", () => {
  // `abx create` never mixes diagnostics into the result stream.

  it("test_plain_mode_splits_result_and_warning", async () => {
    const result = await invokeCreate(new CliRunner(), ["create", "--template", "base"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(result.stdout).toContain("sbx-chan-001");
    expect(result.stdout).toContain("created successfully");
    expect(result.stdout).not.toContain("default capabilities shell, files, code");
    // Exactly one rendered warning line -- the duplicate-handler regression.
    expect(
      result.stderr
        .split("\n")
        .filter(
          (l) =>
            l ===
            "WARNING: Could not resolve capabilities for template 'base'; no matching template.yaml in ~/.abx/templates. Using default capabilities shell, files, code. Run 'abx template deploy' to cache it, or copy template.yaml to ~/.abx/templates/<id>/template.yaml.",
        ).length,
    ).toBe(1);
    expect(result.stderr).not.toContain("sbx-chan-001");
  });

  it("test_json_mode_stdout_is_a_single_document", async () => {
    const result = await invokeCreate(new CliRunner(), ["--json", "create", "--template", "base"]);

    expect(result.exit_code, result.output).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload["ID"]).toBe("sbx-chan-001");
    expect(payload["Status"]).toBe("running");
    expect(result.stderr).toContain("~/.abx/templates");
  });

  it("test_quiet_mode_prints_values_only", async () => {
    const result = await invokeCreate(new CliRunner(), ["--quiet", "create", "--template", "base"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(result.stdout.trimEnd().split("\n")).toEqual([
      "sbx-chan-001",
      "running",
      "base",
      "https://sbx-chan-001.cn-hangzhou.e2b.fc.aliyuncs.com",
    ]);
    expect(result.stderr).toBe("");
  });

  it("test_ci_mode_is_json_and_silent", async () => {
    iso.monkeypatch.setenv("CI", "1");

    const result = await invokeCreate(new CliRunner(), ["create", "--template", "base"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(JSON.parse(result.stdout)["ID"]).toBe("sbx-chan-001");
    expect(result.stderr).toBe("");
  });

  it("test_description_template_conflict_reports_on_stderr_only", async () => {
    // Task 160 invariant: rejected before any AI or network call.
    const codegen = await import(/* @vite-ignore */ "../../src/agent/codegen.js" as string);
    const genMock = vi.spyOn(codegen, "generateTemplateFiles" as never).mockImplementation((() => undefined) as never);
    const createMock = vi.spyOn(Sandbox, "create").mockImplementation((() => undefined) as never);

    const result = await new CliRunner().invoke(cli, ["create", "--prompt", "python", "--template", "base"]);

    expect(result.exit_code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("cannot be combined");
    expect(genMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
    genMock.mockRestore();
    createMock.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// deploy diagnostics
// ---------------------------------------------------------------------------

describe("TestDeployDiagnosticsChannel", () => {
  // `_do_deploy` warnings follow the same channel rules.

  const TEMPLATE_MODULE = "../../src/cli/commands/template.js";

  async function deployCmd(tmpPath: string): Promise<Command> {
    const { _doDeploy } = (await import(/* @vite-ignore */ TEMPLATE_MODULE as string)) as {
      _doDeploy: (dir: string, opts: Record<string, unknown>) => Promise<unknown>;
    };
    return command("deploy", {
      params: [option("--quiet", { is_flag: true }), option(["--json", "json_flag"], { is_flag: true })],
      callback: async (ctx: Context, params) => {
        ctx.meta["abx.output"] = new OutputManager({ quiet: params["quiet"], json_mode: params["json_flag"], no_color: true });
        const out = getOutput(ctx);
        const data = await _doDeploy(tmpPath, { acr_namespace: "test-ns", start_cmd: "echo hi", ctx, verbose: false });
        out.data(data);
      },
    });
  }

  async function patchPipeline(): Promise<void> {
    const tpl = (await import(/* @vite-ignore */ TEMPLATE_MODULE as string)) as { templateSeams: object };
    const config = { access_key_id: "ak", access_key_secret: "sk", region: "cn-hangzhou" };
    vi.spyOn(transportConfig, "loadConfig").mockReturnValue(config as never);
    const spyAny = (o: object, k: string) => vi.spyOn(o as Record<string, (...a: unknown[]) => unknown>, k);
    spyAny(tpl.templateSeams, "_buildImage").mockResolvedValue("img:latest");
    spyAny(tpl.templateSeams, "_pushImage").mockResolvedValue(["acr/img:latest", {}]);
    vi.spyOn(fcTemplate, "createOfficialTemplate").mockResolvedValue({ templateID: "tmpl-1" } as never);
    vi.spyOn(fcTemplate, "waitForTemplateReady").mockResolvedValue({ status: { state: "ready" } } as never);
  }

  it("test_start_cmd_warning_is_one_stderr_line", async () => {
    const tmp = fs.mkdtempSync(path.join(iso.tmp_path, "deploy-"));
    fs.writeFileSync(path.join(tmp, "Dockerfile"), "FROM ubuntu:22.04\n");
    await patchPipeline();
    const result = await new CliRunner().invoke(await deployCmd(tmp), []);

    expect(result.exit_code, result.output).toBe(0);
    expect(result.stdout).toContain("TemplateID");
    expect(result.stderr.split("\n").filter((l) => l === "Warning: --start-cmd / --ready-cmd only take effect with --generation 2 (MicroVM).").length).toBe(1);
    expect(result.stdout).not.toContain("only take effect");
    vi.restoreAllMocks();
  });

  it("test_start_cmd_warning_suppressed_in_quiet_mode", async () => {
    const tmp = fs.mkdtempSync(path.join(iso.tmp_path, "deploy-"));
    fs.writeFileSync(path.join(tmp, "Dockerfile"), "FROM ubuntu:22.04\n");
    await patchPipeline();
    const result = await new CliRunner().invoke(await deployCmd(tmp), ["--quiet"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(result.stderr).not.toContain("only take effect");
    expect(result.stderr).toBe("");
    vi.restoreAllMocks();
  });
});
