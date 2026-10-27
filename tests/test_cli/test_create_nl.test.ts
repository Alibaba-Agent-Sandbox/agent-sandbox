/**
 * Tests for the `abx create "<description>"` AI generation routing.
 *
 * The natural-language path now drives Qwen Code codegen behind a research-first clarification loop (plain research
 * round on a native session, then the structured assessment, then one question per round); `--template` keeps the
 * direct template path. Nothing here touches the network or the real CLI.
 */

import "../_support/isolatedHome.js";
import * as guidance from "../../src/cli/config_guidance.js";
import { getOperationConfig } from "../../src/utils/operation_config.js";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as clarify from "../../src/agent/clarify.js";
import { ClarifyAssessment } from "../../src/agent/clarify.js";
import * as codegen from "../../src/agent/codegen.js";
import { CodegenResult } from "../../src/agent/codegen.js";
import * as qwenCode from "../../src/agent/qwen_code.js";
import { QwenCodeCredentials } from "../../src/agent/qwen_code.js";
import { Sandbox } from "../../src/api/sandbox.js";
import { codingAgentSeams } from "../../src/cli/commands/_coding_agent.js";
import * as sandboxCmd from "../../src/cli/commands/sandbox.js";
import { CLI_EXTENSION } from "../../src/providers/alicloud_express/cli/extension.js";
import { sandboxSeams } from "../../src/cli/commands/sandbox.js";
import * as template from "../../src/providers/alicloud_express/cli/template.js";
import { cli } from "../../src/cli/main.js";
import { AICodegenError, DockerBuildError, QwenCodeCredentialError } from "../../src/models/errors.js";
import { SandboxInfo } from "../../src/models/sandbox.js";
import { CliRunner, type Result } from "../helpers/cliRunner.js";

const cfg = vi.hoisted(() => ({ writeEnvVar: vi.fn() }));

// Keep the configuration sources hermetic (Python patches `config_cmd.load_config_dict` / `read_env_var`).
vi.mock("../../src/cli/commands/config_cmd.js", () => ({
  _effectiveValue: () => [null, "default"],
  _ALLOWED_KEYS: new Set(["llm_api_key", "llm_base_url", "llm_model", "sandbox_api_key", "access_key_id", "access_key_secret"]),
  writeEnvVar: (...a: unknown[]) => cfg.writeEnvVar(...a),
  _removeTomlKey: async () => undefined,
}));

const runner = (): CliRunner => new CliRunner();

const _CREDS = new QwenCodeCredentials({
  source: "qwen-stored",
  apiKey: "sk-test",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  model: "qwen3-coder-plus",
});

/**
 * A description that already covers all six clarification facets (100%). Tests that must reach a gate *after* the
 * clarification step pair it with a stubbed "complete" assessment so the single-question loop asks nothing.
 */
const _COMPLETE_DESCRIPTION =
  "Python 3.12 runtime with pandas and jupyter installed, " +
  "entry command 'jupyter notebook --ip 0.0.0.0', " +
  "port 8888, 2 CPU 4 GB memory, upload a data.csv dataset";

/** Fixed native session id (`clarify.seams.newSessionId` is patched in `qwenEnv`). */
const _SESSION = "6f0f8e9a-1b2c-4d5e-8f90-123456789abc";

type Mock = ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock Sandbox object. */
function _makeSandbox(sandbox_id = "sbx-nl-001", template_ = "abx-nl-sandbox-abc123", status = "running"): Sandbox {
  const sbInfo = SandboxInfo.modelValidate({
    sandboxID: sandbox_id,
    templateID: template_,
    status,
    region: "cn-hangzhou",
    timeout: 300,
    envdUrl: `https://${sandbox_id}.cn-hangzhou.e2b.fc.aliyuncs.com`,
    envdAccessToken: "tok",
  });
  return {
    id: sbInfo.sandbox_id,
    status: sbInfo.status,
    url: sbInfo.envd_url,
    info: sbInfo,
    files: { write: vi.fn().mockResolvedValue(undefined) },
    commands: { run: vi.fn().mockResolvedValue({ exit_code: 0 }) },
    verifyApplicationOperation: vi.fn().mockResolvedValue(undefined),
    listCommands: vi.fn().mockResolvedValue([]),
    network: { resolveEndpoint: vi.fn().mockResolvedValue({ url: "https://application.example" }) },
    close: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn().mockResolvedValue(false),
  } as unknown as Sandbox;
}

/** Build a `CodegenResult` whose files exist on disk. */
function _makeCodegenResult(tmpPath: string, name = "abx-nl-sandbox-abc123"): CodegenResult {
  const workdir = path.join(tmpPath, "generated");
  fs.mkdirSync(workdir, { recursive: true });
  const dockerfile = path.join(workdir, "Dockerfile");
  fs.writeFileSync(dockerfile, "FROM python:3.12-slim\n", "utf-8");
  const templateYaml = path.join(workdir, "template.yaml");
  fs.writeFileSync(templateYaml, `name: ${name}\nspec_version: 5\nprovides:\n  app: {protocol: agent-sandbox-server, version: 2, port: 9000, operations: [commands.list, commands.run]}\nstart_cmd: python3 commands.py\nready_cmd: 'true'\nenv: {ABX_SERVER_TOKEN: ""}\n`, "utf-8");
  return new CodegenResult({
    workdir,
    templateName: name,
    dockerfile,
    templateYaml,
    description: "a python env",
    rawOutput: "generated",
  });
}

let tmp = "";
let savedCwd = "";
let qwen: { binary: string; workdir: string; research: Mock; prepareWorkdir: Mock };
let deployMock: Mock | null = null;

const savedSeams = {
  qwen: { ...qwenCode.seams },
  codegen: { ...codegen.seams },
  clarify: { ...clarify.seams },
  sandbox: { ...sandboxSeams },
  codingAgent: { ...codingAgentSeams },
};

/** `_isolated_cwd` + `qwen_env`: hermetic defaults for every AI-path test (individual tests override as needed). */
beforeEach(() => {
  vi.stubEnv("ABX_SANDBOX_API_KEY", "placeholder-sandbox-key");
  vi.stubEnv("ABX_SERVER_TOKEN", "test-application-token");
  vi.stubEnv("ALICLOUD_ACCESS_KEY_ID", "placeholder-ak");
  vi.stubEnv("ALICLOUD_ACCESS_KEY_SECRET", "placeholder-sk");
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "abx-create-nl-")));
  savedCwd = process.cwd();
  process.chdir(tmp);
  cfg.writeEnvVar.mockReset();
  deployMock = null;

  const binary = path.join(tmp, "qwen");
  fs.writeFileSync(binary, "#!/bin/sh\n", "utf-8");
  qwenCode.seams.findQwenCodeBinary = vi.fn(() => binary);
  qwenCode.seams.resolveQwenCodeCredentials = vi.fn(() => _CREDS);
  vi.spyOn(template, "resolve_acr_namespace").mockReturnValue("test-acr-ns");
  // The generation workspace is prepared before clarification so both phases share one cwd (Qwen sessions are stored per
  // working directory); fake it so tests never create directories under the real ~/.abx.
  const generated = path.join(tmp, "generated-workspace");
  const prepareWorkdir = vi.fn(async () => [generated, "abx-nl-sandbox-abc123"] as [string, string]);
  codegen.seams.prepareWorkdir = prepareWorkdir as unknown as typeof codegen.seams.prepareWorkdir;
  // Deterministic native session id for the resume assertions.
  clarify.seams.newSessionId = () => _SESSION;
  // The research round (phase R) runs before the first assessment; mock it hermetically so no test ever shells out to the
  // stub binary above. A successful structured outcome means the public facts were researched on the
  // native session; tests that need a classified failure swap in a `ResearchOutcome`.
  const research = vi.fn(async () => new clarify.ResearchOutcome({ ok: true }));
  clarify.seams.runResearch = research as unknown as typeof clarify.seams.runResearch;
  qwen = { binary, workdir: generated, research, prepareWorkdir };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  Object.assign(qwenCode.seams, savedSeams.qwen);
  Object.assign(codegen.seams, savedSeams.codegen);
  Object.assign(clarify.seams, savedSeams.clarify);
  Object.assign(sandboxSeams, savedSeams.sandbox);
  Object.assign(codingAgentSeams, savedSeams.codingAgent);
  process.chdir(savedCwd);
  fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * `_FakeSys`: TTY detection is faked at the seam level (the CLI runner's stdin is never a terminal). Install it on every
 * command module whose prompts the test drives (`sandbox` for clarification/confirmation, `_coding_agent` for the
 * install/credential prompts).
 */
function fakeTty(opts: { sandbox?: boolean; codingAgent?: boolean }): void {
  vi.spyOn(guidance, "canGuideConfiguration").mockImplementation((ctx, yes) => !yes && !ctx?.obj?.["json"] && !ctx?.obj?.["quiet"] && !ctx?.obj?.["ci"]);
  vi.spyOn(guidance.guidanceSeams, "interactive").mockReturnValue(true);
  if (opts.sandbox) sandboxSeams.stdinIsatty = () => true;
  if (opts.codingAgent) codingAgentSeams.stdinIsatty = () => true;
}

/** Patch codegen + deploy to succeed; return `[result, gen_mock, deploy_mock]`. */
function _patchSuccessPipeline(tmpPath: string, opts: { template_id?: string } = {}): [CodegenResult, Mock, Mock] {
  const templateId = opts.template_id ?? "tmpl-ai-123";
  const gen = _makeCodegenResult(tmpPath);
  const genMock = vi.fn(async (_description: string, options: { buildMode?: string }) => {
    if (options.buildMode === "steps") fs.appendFileSync(gen.templateYaml, "base: python:3.12-slim\nbuild: {mode: steps, run: ['echo dependency-ready']}\n");
    return gen;
  });
  const deploy = vi.spyOn(template, "do_deploy").mockResolvedValue({ TemplateID: templateId, Status: "ready" });
  vi.spyOn(template, "withDeployConfiguration").mockImplementation(async (_directory, _options, action) => action());
  vi.spyOn(CLI_EXTENSION, "stageProject").mockImplementation(async (directory) => ({ directory, digest: "sha256:test-generated-source", verify: async () => undefined, close: async () => undefined }));
  codegen.seams.generateTemplateFiles = genMock as unknown as typeof codegen.seams.generateTemplateFiles;
  deployMock = deploy as unknown as Mock;
  return [gen, genMock, deploy as unknown as Mock];
}

/** Build the structured assessment `clarify.evaluate` would return. */
function _clarifyAssessment(completeness: number, opts: { question?: string | null; missing?: string[]; example?: string | null } = {}): ClarifyAssessment {
  return new ClarifyAssessment({
    completeness,
    question: opts.question ?? null,
    missing: opts.missing ?? [],
    example: opts.example ?? null,
  });
}

/** Fake the structured assessment rounds (one outcome per evaluate call). */
function _patchClarifyEvaluate(outcomes: Array<ClarifyAssessment | null>): Mock {
  const queue = [...outcomes];
  const mock = vi.fn(async () => {
    if (queue.length === 0) throw new Error("StopIteration");
    return queue.shift() as ClarifyAssessment | null;
  });
  clarify.seams.evaluate = mock as unknown as typeof clarify.seams.evaluate;
  return mock;
}

/** `Sandbox.create` -> a mock sandbox (`patch("agent_sandbox.api.sandbox.Sandbox.create", AsyncMock(return_value=sb))`). */
function patchCreate(sb: Sandbox = _makeSandbox()) {
  return vi.spyOn(Sandbox, "create").mockResolvedValue(sb);
}

const callArg = (mock: Mock, call: number, index: number): any => mock.mock.calls.at(call)![index];
const opts = (mock: Mock, call = -1): Record<string, any> => (callArg(mock, call, 1) ?? {}) as Record<string, any>;

/** Recording stand-in for OutputManager in `_phaseStatus` unit tests. */
class _FakePhaseOut {
  progress_messages: string[] = [];
  spinner_messages: string[] = [];
  constructor(
    readonly useLiveStatus: boolean,
    readonly quiet = false,
  ) {}

  progress(message: string): void {
    this.progress_messages.push(message);
  }

  async activity<T>(message: string, body: (update: null) => T | Promise<T>): Promise<T> {
    this.spinner_messages.push(message);
    return body(null);
  }
}

// ---------------------------------------------------------------------------
// Routing: AI path vs direct template path
// ---------------------------------------------------------------------------

describe("TestCreateRouting", () => {
  it("accepts detached prompt creation and carries explicit platform steps through the real pipeline", async () => {
    const [, generated, deploy] = _patchSuccessPipeline(tmp);
    const create = patchCreate();
    const result = await runner().invoke(cli, ["create", "--prompt", "a Python data API", "--yes", "--detach", "--build", "steps"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(generated).toHaveBeenCalledWith("a Python data API", expect.objectContaining({ buildMode: "steps", baseImage: "fc-e2b-registry.cn-hangzhou.cr.aliyuncs.com/runtime/base:v0.0.49" }));
    expect(deploy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ build: "steps", yes: true }));
    expect(create).toHaveBeenCalledOnce();
  });

  it("stops before cloud deployment and creation when generated services require a missing token", async () => {
    vi.stubEnv("ABX_SERVER_TOKEN", "");
    const [, generate, deploy] = _patchSuccessPipeline(tmp);
    const create = patchCreate();
    const result = await runner().invoke(cli, ["create", "--prompt", "an integer add API", "--yes", "--detach", "--build", "steps"]);
    expect(result.exit_code).not.toBe(0);
    expect(generate).not.toHaveBeenCalled();
    expect(result.output).toContain("ABX_SERVER_TOKEN");
    expect(deploy).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("injects explicit generated runtime credentials into creation without passing them to the builder", async () => {
    vi.stubEnv("ABX_SERVER_TOKEN", "host-token");
    vi.stubEnv("UNDECLARED_SECRET", "do-not-inherit");
    const [generated, , deploy] = _patchSuccessPipeline(tmp);
    fs.writeFileSync(generated.templateYaml, fs.readFileSync(generated.templateYaml, "utf8").replace('env: {ABX_SERVER_TOKEN: ""}', 'env: {ABX_SERVER_TOKEN: "", LANG: C.UTF-8}'));
    const create = patchCreate();
    const result = await runner().invoke(cli, ["create", "--prompt", "an integer add API", "--yes", "--detach", "--build", "steps", "-e", "ABX_SERVER_TOKEN=explicit-token"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ envs: { ABX_SERVER_TOKEN: "explicit-token", LANG: "C.UTF-8" } }));
    const { ctx: _context, ...builderOptions } = opts(deploy);
    expect(JSON.stringify(builderOptions)).not.toContain("explicit-token");
    expect(JSON.stringify(builderOptions)).not.toContain("host-token");
    expect(result.output).not.toContain("explicit-token");
  });

  it("keeps an explicit ACR namespace on the shared provider preparation path", async () => {
    const [, , deploy] = _patchSuccessPipeline(tmp);
    patchCreate();
    const result = await runner().invoke(cli, ["create", "--prompt", "a Python API", "--yes", "--detach", "--acr-namespace", "explicit-namespace"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(deploy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ acr_namespace: "explicit-namespace", explicit_acr_namespace: true, template_launch: true }));
  });

  it("does not create a sandbox when generated template readiness fails", async () => {
    const [, , deploy] = _patchSuccessPipeline(tmp);
    deploy.mockRejectedValue(new Error("generated template did not become ready"));
    const create = patchCreate();
    const result = await runner().invoke(cli, ["create", "--prompt", "a Python API", "--yes", "--detach", "--build", "steps"]);
    expect(result.exit_code).not.toBe(0);
    expect(create).not.toHaveBeenCalled();
    expect(result.output).toContain("recovery journal");
  });
  it("retains command-only cloud configuration through generation, deployment and final creation", async () => {
    vi.stubEnv("ABX_SANDBOX_API_KEY", "");
    vi.stubEnv("ALICLOUD_ACCESS_KEY_ID", "");
    vi.stubEnv("ALICLOUD_ACCESS_KEY_SECRET", "");
    fakeTty({ codingAgent: true, sandbox: true });
    const answers = ["1", "temporary-sandbox-key", "temporary-access-id", "temporary-access-secret"];
    vi.spyOn(guidance.guidanceSeams, "ask").mockImplementation(async (label) => label === "Choose an authentication method" ? "1" : answers.shift() ?? "");
    _patchSuccessPipeline(tmp);
    _patchClarifyEvaluate([_clarifyAssessment(1.0)]);
    const create = patchCreate();
    create.mockImplementation(async () => {
      expect(getOperationConfig()).toMatchObject({ sandbox_api_key: "temporary-sandbox-key", access_key_id: "temporary-access-id", access_key_secret: "temporary-access-secret" });
      return _makeSandbox();
    });
    const result = await runner().invoke(cli, ["create", "--prompt", _COMPLETE_DESCRIPTION], { input: "n\n\ny\n" });
    expect(result.exit_code, result.output).toBe(0);
    expect(create).toHaveBeenCalledOnce();
    expect(answers).toHaveLength(0);
    expect(getOperationConfig()).toBeUndefined();
    expect(cfg.writeEnvVar).not.toHaveBeenCalled();
    expect(process.env["ABX_SANDBOX_API_KEY"]).toBe("");
    expect(result.output).not.toContain("temporary-sandbox-key");
    expect(result.output).not.toContain("temporary-access-secret");
  });

  it("test_ai_flow_with_yes_creates_from_deployed_template", async () => {
    const [gen, genMock, deploy] = _patchSuccessPipeline(tmp);
    const mockCreate = patchCreate();

    const result = await runner().invoke(cli, ["create", "-y", "--prompt", "a python data science env"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("Generated template");
    expect(result.output).toContain("sbx-nl-001");

    expect(genMock).toHaveBeenCalledTimes(1);
    expect(callArg(genMock, -1, 0)).toBe("a python data science env");
    expect(deploy).toHaveBeenCalledTimes(1);
    expect(deploy).toHaveBeenCalledWith(String(gen.workdir), expect.objectContaining({ ctx: expect.anything(), yes: true, template_launch: true }));
    expect((callArg(mockCreate as unknown as Mock, -1, 0) as Record<string, unknown>)["template"]).toBe("tmpl-ai-123");
  });

  // Historical parity name retained; missing IDs now fail safely instead of guessing.
  it("test_create_falls_back_to_template_name_when_no_id", async () => {
    _patchSuccessPipeline(tmp, { template_id: "N/A" });
    const mockCreate = patchCreate();

    const result = await runner().invoke(cli, ["create", "-y", "--prompt", "node service"]);

    expect(result.exit_code).not.toBe(0);
    expect(result.output).toContain("recovery journal");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("test_explicit_template_bypasses_codegen", async () => {
    const genMock = vi.fn();
    codegen.seams.generateTemplateFiles = genMock as never;
    patchCreate(_makeSandbox("sbx-nl-001", "base"));

    const result = await runner().invoke(cli, ["create", "--template", "base"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(genMock).not.toHaveBeenCalled();
    expect(result.output).not.toContain("Generated template");
  });

  it.each(["--template", "-T"])("test_description_with_explicit_template_is_rejected [%s]", async (templateFlag) => {
    // DESCRIPTION + --template is a usage error, never a silent drop.
    const genMock = vi.fn();
    codegen.seams.generateTemplateFiles = genMock as never;
    const deploy = vi.spyOn(template, "do_deploy");
    const createMock = vi.spyOn(Sandbox, "create");

    const result = await runner().invoke(cli, ["create", "--prompt", "python", templateFlag, "custom"]);

    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("cannot be combined");
    expect(result.output).toContain("--template");
    expect(genMock).not.toHaveBeenCalled();
    expect(deploy).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("test_description_with_template_and_missing_template_value_still_errors", async () => {
    // Order of arguments does not matter: the conflict is detected either way.
    const genMock = vi.fn();
    codegen.seams.generateTemplateFiles = genMock as never;

    const result = await runner().invoke(cli, ["create", "--template", "base", "--prompt", "python"]);

    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("cannot be combined");
    expect(genMock).not.toHaveBeenCalled();
  });

  it("test_no_description_no_template_uses_base", async () => {
    // The standard default is the base template.
    const genMock = vi.fn();
    codegen.seams.generateTemplateFiles = genMock as never;

    const create = patchCreate();
    const result = await runner().invoke(cli, ["create"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(create).toHaveBeenCalled();
    expect(genMock).not.toHaveBeenCalled();
  });

  it("test_json_mode_suppresses_generated_summary", async () => {
    _patchSuccessPipeline(tmp);
    patchCreate();

    const result = await runner().invoke(cli, ["--json", "create", "-y", "--prompt", "python env"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).not.toContain("Generated template");
  });
});

// ---------------------------------------------------------------------------
// Qwen Code availability
// ---------------------------------------------------------------------------

describe("TestQwenCodeInstallGate", () => {
  it("keeps the final JSON result parseable after a first managed installation", async () => {
    qwenCode.seams.findQwenCodeBinary = vi.fn(() => null);
    const installed = path.join(tmp, "qwen");
    const install = vi.fn(async () => installed);
    qwenCode.seams.downloadAndInstallStandalone = install as never;
    _patchSuccessPipeline(tmp);
    patchCreate();

    const result = await runner().invoke(cli, ["--json", "create", "--prompt", "an integer add API", "--yes", "--build", "steps"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(install).toHaveBeenCalledOnce();
    expect(JSON.parse(result.stdout)).toMatchObject({ ID: "sbx-nl-001", TemplateID: "tmpl-ai-123" });
    expect(result.stdout).not.toContain("Installed Qwen Code");
    expect(result.stderr).toContain(`Installed Qwen Code: ${installed}`);
  });

  it("test_not_installed_non_tty_shows_quick_setup_and_fails", async () => {
    qwenCode.seams.findQwenCodeBinary = vi.fn(() => null);
    const genMock = vi.fn();
    codegen.seams.generateTemplateFiles = genMock as never;

    const result = await runner().invoke(cli, ["create", "--prompt", "python env"]);

    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("Quick Setup");
    expect(result.output).toContain("install-qwen-standalone.sh");
    expect(result.output).toContain("E2005");
    expect(genMock).not.toHaveBeenCalled();
  });

  it("test_tty_declining_install_raises", async () => {
    qwenCode.seams.findQwenCodeBinary = vi.fn(() => null);
    const installMock = vi.fn();
    qwenCode.seams.downloadAndInstallStandalone = installMock as never;
    fakeTty({ codingAgent: true });

    const result = await runner().invoke(cli, ["create", "--prompt", "python env"], { input: "n\n" });

    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("Declined to install");
    expect(installMock).not.toHaveBeenCalled();
  });

  it("test_tty_accepting_install_runs_pipeline", async () => {
    qwenCode.seams.findQwenCodeBinary = vi.fn(() => null);
    const installed = path.join(tmp, "qwen");
    const installMock = vi.fn(async () => installed);
    qwenCode.seams.downloadAndInstallStandalone = installMock as never;
    // The install prompt lives in the shared coding-agent module; the build/deploy confirmation still lives in the sandbox
    // command.
    fakeTty({ codingAgent: true, sandbox: true });
    _patchSuccessPipeline(tmp);
    _patchClarifyEvaluate([_clarifyAssessment(1.0)]);
    patchCreate();

    const result = await runner().invoke(cli, ["create", "--prompt", _COMPLETE_DESCRIPTION], { input: "n\ny\n\ny\n" });

    expect(result.exit_code, result.output).toBe(0);
    expect(installMock).toHaveBeenCalledTimes(1);
    expect(result.output).toContain("Installed Qwen Code");
  });
});

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

describe("TestQwenCodeCredentialGate", () => {
  it("test_missing_credentials_non_tty_fails", async () => {
    qwenCode.seams.resolveQwenCodeCredentials = vi.fn(() => {
      throw new QwenCodeCredentialError("no model credentials found");
    });

    const result = await runner().invoke(cli, ["create", "--prompt", "python env"]);

    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("E2006");
    expect(result.output).toContain("llm_api_key");
  });

  it("test_missing_credentials_with_yes_fails_fast", async () => {
    qwenCode.seams.resolveQwenCodeCredentials = vi.fn(() => {
      throw new QwenCodeCredentialError("no model credentials found");
    });

    const result = await runner().invoke(cli, ["create", "-y", "--prompt", "python env"]);

    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("E2006");
  });

  it("test_tty_prompts_for_key_for_current_command", async () => {
    const resolveMock = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new QwenCodeCredentialError("no model credentials found");
      })
      .mockImplementationOnce(() => _CREDS);
    qwenCode.seams.resolveQwenCodeCredentials = resolveMock as never;
    // The credential prompt lives in the shared coding-agent module; the build/deploy confirmation still lives in the
    // sandbox command.
    fakeTty({ codingAgent: true, sandbox: true });
    _patchSuccessPipeline(tmp);
    _patchClarifyEvaluate([_clarifyAssessment(1.0)]);
    patchCreate();

    const result = await runner().invoke(cli, ["create", "--prompt", _COMPLETE_DESCRIPTION], { input: "n\n1\nsk-user-key\n\ny\n" });

    expect(result.exit_code, result.output).toBe(0);
    expect(cfg.writeEnvVar).not.toHaveBeenCalled();
    expect(result.output).toContain("only to this command");
    expect(resolveMock).toHaveBeenCalledTimes(2);
    // The second resolve must reuse the freshly entered key.
    expect(callArg(resolveMock, -1, 0)["storedApiKey"]).toBe("sk-user-key");
  });

  it("test_empty_key_input_aborts", async () => {
    qwenCode.seams.resolveQwenCodeCredentials = vi.fn(() => {
      throw new QwenCodeCredentialError("no model credentials found");
    });
    fakeTty({ codingAgent: true });

    const result = await runner().invoke(cli, ["create", "--prompt", "python env"], { input: "\n" });

    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("Aborted!");
    expect(cfg.writeEnvVar).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Confirmation + generation failures
// ---------------------------------------------------------------------------

describe("TestConfirmationAndFailures", () => {
  it("test_non_tty_without_yes_requires_confirmation", async () => {
    _patchSuccessPipeline(tmp);
    _patchClarifyEvaluate([_clarifyAssessment(1.0)]);
    const deploy = vi.spyOn(template, "do_deploy");

    // The assessment clears the threshold, so the clarification loop asks nothing and the flow reaches the non-interactive
    // confirmation gate.
    const result = await runner().invoke(cli, ["create", "--prompt", _COMPLETE_DESCRIPTION]);

    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("Confirmation required");
    expect(result.output + (result.stderr || "")).toContain('abx template scaffold --prompt "');
    expect(deploy).not.toHaveBeenCalled();
  });

  it("test_codegen_failure_surfaces_e2007", async () => {
    codegen.seams.generateTemplateFiles = vi.fn(async () => {
      throw new AICodegenError("Qwen Code did not create the expected file(s)");
    }) as never;
    const deploy = vi.spyOn(template, "do_deploy");

    const result = await runner().invoke(cli, ["create", "-y", "--prompt", "python env"]);

    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("E2007");
    expect(deploy).not.toHaveBeenCalled();
  });

  it("test_build_failure_propagates", async () => {
    _patchSuccessPipeline(tmp);
    vi.spyOn(template, "do_deploy").mockRejectedValue(new DockerBuildError("build failed"));
    patchCreate();

    const result = await runner().invoke(cli, ["create", "-y", "--prompt", "python env"]);

    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("E7020");
    expect(result.output).toContain("recovery journal");
  });
});

// ---------------------------------------------------------------------------
// Description clarification loop
// ---------------------------------------------------------------------------

describe("TestDescriptionClarification", () => {
  // The research-first loop that guards Qwen Code generation.
  //
  // Research, evaluation, and questions all come from Qwen Code itself; these tests fake the thin adapters
  // (`clarify.runResearch` and `clarify.evaluate`) and verify the Agent Sandbox surface only: the research round before the
  // first assessment, one question per round, the 80% threshold gate, one native session for every round, non-interactive
  // fail-fast, cancel/EOF handling, and graceful degradation.

  it("test_complete_description_skips_questions_and_reaches_confirm_gate", async () => {
    const [, genMock] = _patchSuccessPipeline(tmp);
    const evaluateMock = _patchClarifyEvaluate([_clarifyAssessment(1.0)]);

    const result = await runner().invoke(cli, ["create", "--prompt", _COMPLETE_DESCRIPTION]);

    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("Confirmation required");
    expect(result.output).not.toContain("/5"); // the internal round cap is never shown
    expect(result.output).not.toContain("Question 1");
    expect(evaluateMock).toHaveBeenCalledTimes(1);
    // Research settled the public facts before the single assessment, and the assessment resumed that very session.
    expect(qwen.research).toHaveBeenCalledTimes(1);
    expect(opts(evaluateMock)["resume"]).toBe(_SESSION);
    expect(genMock).toHaveBeenCalledTimes(1);
    // Clarification and generation share one workspace and native session.
    expect(opts(genMock)["workdir"]).toBe(qwen.workdir);
    expect(opts(genMock)["resumeSession"]).toBe(_SESSION);
  });

  it("test_incomplete_non_tty_raises_e2008_with_missing_details_and_example", async () => {
    const [, genMock, deploy] = _patchSuccessPipeline(tmp);
    _patchClarifyEvaluate([
      _clarifyAssessment(0.3, {
        question: "Which dependencies must be preinstalled?",
        missing: ["dependencies", "ports"],
        example: "Python 3.12 with pandas, expose port 8888",
      }),
    ]);

    const result = await runner().invoke(cli, ["create", "--prompt", "运行 python"]);

    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("E2008");
    expect(result.output).toContain("30%");
    expect(result.output).toContain("cannot ask clarifying questions");
    expect(result.output).not.toContain("Question 1");
    expect(result.output).toContain("Missing details: dependencies, ports.");
    expect(result.output).toContain("Example description:");
    expect(result.output).toContain("Python 3.12 with pandas, expose port 8888");
    expect(result.output).toContain("--yes/-y");
    expect(result.output).toContain("abx create <name>");
    expect(genMock).not.toHaveBeenCalled();
    expect(deploy).not.toHaveBeenCalled();
  });

  it("test_json_mode_never_prompts_and_raises_e2008", async () => {
    // --json never blocks on questions: it fails fast with E2008.
    const [, genMock] = _patchSuccessPipeline(tmp);
    _patchClarifyEvaluate([_clarifyAssessment(0.5, { question: "Q?", missing: ["ports"] })]);

    const result = await runner().invoke(cli, ["--json", "create", "--prompt", "运行 python"]);

    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("E2008");
    expect(result.output).not.toContain("Question 1");
    expect(genMock).not.toHaveBeenCalled();
  });

  it("test_yes_skips_research_and_assessment_entirely", async () => {
    // --yes is the fast non-interactive path: no research, no assessment.
    const [, genMock] = _patchSuccessPipeline(tmp);
    const evaluateMock = _patchClarifyEvaluate([]);
    patchCreate();

    const result = await runner().invoke(cli, ["create", "-y", "--prompt", "运行 python"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(evaluateMock).not.toHaveBeenCalled();
    expect(qwen.research).not.toHaveBeenCalled();
    expect(result.output).not.toContain("Question 1");
    // No assessment session exists, so generation starts fresh.
    expect(opts(genMock)["resumeSession"]).toBeNull();
  });

  it("test_tty_asks_one_question_per_round_until_threshold", async () => {
    const [, genMock] = _patchSuccessPipeline(tmp);
    fakeTty({ sandbox: true });
    const evaluateMock = _patchClarifyEvaluate([
      _clarifyAssessment(0.4, { question: "Which dependencies must be preinstalled?", missing: ["dependencies"] }),
      _clarifyAssessment(0.6, { question: "Which command starts the service?", missing: ["entry command"] }),
      _clarifyAssessment(0.9),
    ]);
    patchCreate();

    const result = await runner().invoke(cli, ["create", "--prompt", "运行 python"], { input: "n\n\npandas\njupyter notebook\ny\n" });

    expect(result.exit_code, result.output).toBe(0);
    // One question per round, numbered with no total shown: Question 1 and Question 2 were asked, Question 3 was never
    // reached because the second answer lifted the description to the threshold.
    expect(result.output).toContain("Question 1: Which dependencies must be preinstalled?");
    expect(result.output).toContain("Question 2: Which command starts the service?");
    expect(result.output).not.toContain("Question 3:");
    expect(result.output).not.toContain("/5");
    expect(result.output).toContain("Description is now about 90%; generating.");

    // Research settled the public facts first, on the native session.
    expect(qwen.research).toHaveBeenCalledTimes(1);
    expect(callArg(qwen.research, -1, 0)).toBe(clarify.researchPrompt("运行 python"));
    expect(opts(qwen.research)["sessionId"]).toBe(_SESSION);

    expect(evaluateMock.mock.calls).toHaveLength(3);
    const [first, second, third] = evaluateMock.mock.calls as unknown as Array<[string, Record<string, any>]>;
    // Research created the native session; round 1 resumes it, and every later round keeps resuming the same session.
    expect(first![1]["sessionId"]).toBeNull();
    expect(first![1]["resume"]).toBe(_SESSION);
    expect(second![1]["resume"]).toBe(_SESSION);
    expect(third![1]["resume"]).toBe(_SESSION);
    // Each answer travels through the same session, never a rebuilt prompt.
    expect(second![0]).toContain("pandas");
    expect(third![0]).toContain("jupyter notebook");
    // The follow-up prompt carries the already-asked question so the model cannot repeat the topic.
    expect(second![0]).toContain("已问过的问题");
    // Generation continues that very session.
    expect(opts(genMock)["resumeSession"]).toBe(_SESSION);
    expect(callArg(genMock, -1, 0)).toBe("运行 python");
  });

  it("test_tty_empty_answer_cancels_generation", async () => {
    const [, genMock] = _patchSuccessPipeline(tmp);
    fakeTty({ sandbox: true });
    _patchClarifyEvaluate([_clarifyAssessment(0.4, { question: "Q?", missing: ["dependencies"] })]);

    const result = await runner().invoke(cli, ["create", "--prompt", "运行 python"], { input: "n\n\n\n" });

    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("E2008");
    expect(result.output).toContain("Clarification was cancelled");
    expect(genMock).not.toHaveBeenCalled();
  });

  it("test_tty_eof_aborts_with_e2008", async () => {
    const [, genMock] = _patchSuccessPipeline(tmp);
    fakeTty({ sandbox: true });
    _patchClarifyEvaluate([_clarifyAssessment(0.4, { question: "Q?", missing: ["dependencies"] })]);

    const result = await runner().invoke(cli, ["create", "--prompt", "运行 python"], { input: "n\n\n" });

    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("E2008");
    expect(result.output).toContain("interrupted (EOF)");
    expect(genMock).not.toHaveBeenCalled();
  });

  it("test_tty_exhausted_rounds_warn_and_generate", async () => {
    const [, genMock] = _patchSuccessPipeline(tmp);
    fakeTty({ sandbox: true });
    // The model never reaches the threshold: the loop stops at the round cap instead of asking questions forever.
    const evaluateMock = _patchClarifyEvaluate(
      [1, 2, 3, 4, 5, 6].map((n) => _clarifyAssessment(0.2, { question: `Missing detail ${n}?`, missing: ["ports"] })),
    );
    patchCreate();

    const result = await runner().invoke(cli, ["create", "--prompt", "运行 python"], { input: "n\n\n" + "unknown\n".repeat(5) + "y\n" });

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("Question 5: Missing detail 5?");
    expect(result.output).not.toContain("Question 6:");
    expect(result.output).not.toContain("/5");
    expect(result.output).toContain("Reached the 5-question safety limit");
    expect(result.output).toContain("Description is about 20% complete");
    expect(result.output).toContain("Generating anyway.");
    expect(evaluateMock).toHaveBeenCalledTimes(6); // 1 initial + 5 capped rounds
    expect(opts(genMock)["resumeSession"]).toBe(_SESSION);
  });

  it("test_assessment_unavailable_degrades_to_direct_generation", async () => {
    // A broken model must never block: warn, then generate directly.
    const [, genMock] = _patchSuccessPipeline(tmp);
    fakeTty({ sandbox: true });
    const evaluateMock = _patchClarifyEvaluate([null]);
    patchCreate();

    const result = await runner().invoke(cli, ["create", "--prompt", "运行 python"], { input: "n\n\ny\n" });

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("Could not assess the description completeness");
    expect(result.output).not.toContain("Question 1");
    expect(evaluateMock).toHaveBeenCalledTimes(1);
    expect(qwen.research).toHaveBeenCalledTimes(1); // research ran, assessment failed
    expect(genMock).toHaveBeenCalledTimes(1);
    // The session never came up, so generation starts fresh.
    expect(opts(genMock)["resumeSession"]).toBeNull();
  });

  it("test_mid_loop_assessment_loss_keeps_the_session_for_generation", async () => {
    const [, genMock] = _patchSuccessPipeline(tmp);
    fakeTty({ sandbox: true });
    _patchClarifyEvaluate([_clarifyAssessment(0.5, { question: "Which dependencies?", missing: ["dependencies"] }), null]);
    patchCreate();

    const result = await runner().invoke(cli, ["create", "--prompt", "运行 python"], { input: "n\n\npandas\ny\n" });

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("became unavailable");
    expect(genMock).toHaveBeenCalledTimes(1);
    // Round 1 did create the session; generation still resumes it.
    expect(opts(genMock)["resumeSession"]).toBe(_SESSION);
  });
});

// ---------------------------------------------------------------------------
// Research-first two-phase contract (phase R -> phase A, one session)
// ---------------------------------------------------------------------------

describe("TestResearchFirstFlow", () => {
  // Round 1 = plain research run, then the structured assessment.
  //
  // Both phases come from Qwen Code itself on ONE native session; Agent Sandbox only wires them together and never echoes
  // the research output.

  it("test_round1_research_then_assessment_on_one_session", async () => {
    _patchSuccessPipeline(tmp);
    const evaluateMock = _patchClarifyEvaluate([_clarifyAssessment(1.0)]);

    const result = await runner().invoke(cli, ["create", "--prompt", _COMPLETE_DESCRIPTION]);

    expect(result.exit_code, result.output).toBe(2); // stopped at the confirm gate
    const research = qwen.research;
    expect(research).toHaveBeenCalledTimes(1);
    // Phase R: the research prompt embeds the description.
    expect(callArg(research, -1, 0)).toBe(clarify.researchPrompt(_COMPLETE_DESCRIPTION));
    expect(opts(research)["sessionId"]).toBe(_SESSION);
    expect(opts(research)["cwd"]).toBe(qwen.workdir);
    // Phase A: the assessment resumes the very session research created.
    expect(callArg(evaluateMock, -1, 0)).toBe(clarify.assessmentPrompt(_COMPLETE_DESCRIPTION));
    expect(opts(evaluateMock)["resume"]).toBe(_SESSION);
    expect(opts(evaluateMock)["sessionId"]).toBeNull();
  });

  it("test_research_failure_warns_and_assessment_pins_the_session", async () => {
    // A failed research round never blocks: warn, then assess from scratch.
    qwen.research.mockResolvedValue({ ok: false, reason: "", detail: "" });
    _patchSuccessPipeline(tmp);
    const evaluateMock = _patchClarifyEvaluate([_clarifyAssessment(1.0)]);

    const result = await runner().invoke(cli, ["create", "--prompt", _COMPLETE_DESCRIPTION]);

    expect(result.exit_code, result.output).toBe(2);
    expect(result.output).toContain("could not research the public facts");
    // No session came out of research, so the assessment pins it itself.
    expect(opts(evaluateMock)["sessionId"]).toBe(_SESSION);
    expect(opts(evaluateMock)["resume"]).toBeNull();
    // Generation still continues the session the assessment created.
  });

  it("test_failed_research_never_reuses_its_session_id", async () => {
    // Regression: qwen rejects `--session-id` of an existing session.
    //
    // The failed research round may already have created its session, and re-pinning that id made every assessment exit 1
    // ("Session Id ... is already in use"), which surfaced as the bogus "assessment unavailable" warning. The assessment
    // must start a FRESH session and generation must continue that one.
    const second = "22222222-2222-4222-8222-222222222222";
    const ids = [_SESSION, second];
    clarify.seams.newSessionId = () => {
      const next = ids.shift();
      if (next === undefined) throw new Error("StopIteration");
      return next;
    };
    qwen.research.mockResolvedValue(new clarify.ResearchOutcome({ ok: false, reason: clarify.RESEARCH_REASON_TIMEOUT }));
    const [, genMock] = _patchSuccessPipeline(tmp);
    const evaluateMock = _patchClarifyEvaluate([_clarifyAssessment(1.0)]);

    const result = await runner().invoke(cli, ["create", "--prompt", _COMPLETE_DESCRIPTION]);

    expect(result.exit_code, result.output).toBe(2);
    expect(opts(qwen.research)["sessionId"]).toBe(_SESSION);
    expect(opts(evaluateMock)["sessionId"]).toBe(second);
    expect(opts(evaluateMock)["sessionId"]).not.toBe(_SESSION);
    expect(opts(genMock)["resumeSession"]).toBe(second);
    expect(result.output).not.toContain("assessment unavailable");
  });

  it.each([
    [clarify.RESEARCH_REASON_TIMEOUT, "timed out"],
    [clarify.RESEARCH_REASON_AGENT_UNAVAILABLE, "could not be started"],
    [clarify.RESEARCH_REASON_COMMAND_FAILED, "--verbose"],
    [clarify.RESEARCH_REASON_TURN_LIMIT, "step budget"],
  ])("test_research_failure_reason_adds_a_safe_hint [%s-%s]", async (reason, hintFragment) => {
    // A classified failure adds a reason hint; the detail never leaks.
    qwen.research.mockResolvedValue(new clarify.ResearchOutcome({ ok: false, reason, detail: "raw internal detail" }));
    _patchSuccessPipeline(tmp);
    const evaluateMock = _patchClarifyEvaluate([_clarifyAssessment(1.0)]);

    const result = await runner().invoke(cli, ["create", "--prompt", _COMPLETE_DESCRIPTION]);

    expect(result.exit_code, result.output).toBe(2); // stopped at the confirm gate
    expect(result.output).toContain("could not research the public facts");
    expect(result.output).toContain(hintFragment);
    expect(result.output).not.toContain("raw internal detail");
    // The failed round did not create the session: the assessment pins it.
    expect(opts(evaluateMock)["sessionId"]).toBe(_SESSION);
    expect(opts(evaluateMock)["resume"]).toBeNull();
  });

  it("test_serverless_devs_public_facts_are_researched_not_asked", async () => {
    // Acceptance case: Serverless Devs facts are settled by research.
    //
    // Whether it is a Node.js tool, its official install method, and its common dependencies are publicly verifiable
    // facts: the research prompt must carry them, and the assessment may never turn them into a question.
    const description = "一个 sandbox 里面运行 Serverless Devs CLI";
    _patchSuccessPipeline(tmp);
    const evaluateMock = _patchClarifyEvaluate([_clarifyAssessment(1.0)]);

    const result = await runner().invoke(cli, ["create", "--prompt", description]);

    expect(result.exit_code, result.output).toBe(2); // reached the confirm gate
    const research = qwen.research;
    expect(research).toHaveBeenCalledTimes(1);
    expect(callArg(research, -1, 0)).toContain("Serverless Devs CLI");
    // The research-first assessment ran once and asked nothing -- the public facts counted as complete.
    expect(evaluateMock).toHaveBeenCalledTimes(1);
    expect(result.output).not.toContain("Question 1");
    expect(result.output).not.toContain("Node.js");
    expect(result.output).not.toContain("安装方式");
  });
});

// ---------------------------------------------------------------------------
// Delegation answers
// ---------------------------------------------------------------------------

describe("TestDelegationAnswers", () => {
  // Answers like "你自己决定"/"you decide" delegate the choice to the agent.

  it("test_delegation_answer_teaches_the_agent_to_decide", async () => {
    _patchSuccessPipeline(tmp);
    fakeTty({ sandbox: true });
    const evaluateMock = _patchClarifyEvaluate([
      _clarifyAssessment(0.4, { question: "Which resource size?", missing: ["resource size"] }),
      _clarifyAssessment(0.9),
    ]);
    patchCreate();

    const result = await runner().invoke(cli, ["create", "--prompt", "运行 python"], { input: "n\n\n你自己决定吧\ny\n" });

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("Description is now about 90%; generating.");
    // The follow-up prompt embeds the delegation instruction...
    const followup = callArg(evaluateMock, 1, 0) as string;
    expect(followup).toContain("委托你自行决定");
    // ...plus the user's words verbatim and the already-asked question.
    expect(followup).toContain("你自己决定吧");
    expect(followup).toContain("已问过的问题");
    // The delegation settled the topic: no second question was asked.
    expect(result.output).not.toContain("Question 2");
  });

  it("test_concrete_answer_needs_no_delegation_clause", async () => {
    // A concrete answer carries no delegation pressure.
    _patchSuccessPipeline(tmp);
    fakeTty({ sandbox: true });
    const evaluateMock = _patchClarifyEvaluate([
      _clarifyAssessment(0.4, { question: "Which resource size?", missing: ["resource size"] }),
      _clarifyAssessment(0.9),
    ]);
    patchCreate();

    const result = await runner().invoke(cli, ["create", "--prompt", "运行 python"], { input: "n\n\n2 CPU 4 GB\ny\n" });

    expect(result.exit_code, result.output).toBe(0);
    const followup = callArg(evaluateMock, 1, 0) as string;
    expect(followup).not.toContain("委托你自行决定");
    expect(followup).toContain("2 CPU 4 GB");
  });
});

// ---------------------------------------------------------------------------
// Anti-repetition
// ---------------------------------------------------------------------------

describe("TestAntiRepetition", () => {
  // Asked topics never repeat; a repeated question breaks the loop.

  it("test_exact_repeat_breaks_the_loop", async () => {
    const [, genMock] = _patchSuccessPipeline(tmp);
    fakeTty({ sandbox: true });
    const question = "Which port should the service expose?";
    const evaluateMock = _patchClarifyEvaluate([
      _clarifyAssessment(0.4, { question, missing: ["ports"] }),
      _clarifyAssessment(0.6, { question, missing: ["ports"] }),
    ]);
    patchCreate();

    const result = await runner().invoke(cli, ["create", "--prompt", "运行 python"], { input: "n\n\n8888\ny\n" });

    expect(result.exit_code, result.output).toBe(0);
    // The question was shown exactly once -- the repeat was caught before a second prompt, even though the model kept
    // returning it.
    expect(result.output).toContain("Question 1: Which port should the service expose?");
    expect(result.output).not.toContain("Question 2:");
    expect(result.output).toContain("The generator repeated an already-answered question");
    expect(result.output).toContain("Generating anyway.");
    expect(evaluateMock).toHaveBeenCalledTimes(2);
    // Generation still continues the session with the collected answers.
    expect(opts(genMock)["resumeSession"]).toBe(_SESSION);
  });

  it("test_asked_questions_travel_with_every_followup", async () => {
    // Every follow-up prompt embeds the already-asked questions.
    _patchSuccessPipeline(tmp);
    fakeTty({ sandbox: true });
    const evaluateMock = _patchClarifyEvaluate([
      _clarifyAssessment(0.4, { question: "Which port should the service expose?", missing: ["ports"] }),
      _clarifyAssessment(0.9),
    ]);
    patchCreate();

    const result = await runner().invoke(cli, ["create", "--prompt", "运行 python"], { input: "n\n\n8888\ny\n" });

    expect(result.exit_code, result.output).toBe(0);
    const followup = callArg(evaluateMock, 1, 0) as string;
    expect(followup).toContain("已问过的问题");
    expect(followup).toContain("Which port should the service expose?");
  });
});

// ---------------------------------------------------------------------------
// Phase-status channels (spinner / progress: stderr only, stdout untouched)
// ---------------------------------------------------------------------------

describe("TestPhaseStatusChannels", () => {
  // Assess / re-assess / generate status never leaks to stdout.

  it("test_spinner_mode_skips_the_progress_line", async () => {
    // TTY spinner mode: only the spinner runs, no plain progress line.
    const out = new _FakePhaseOut(true);
    await sandboxCmd._phaseStatus(out, "Assessing description", () => undefined);
    expect(out.spinner_messages).toEqual(["Assessing description"]);
    expect(out.progress_messages).toEqual([]);
  });

  it("test_plain_mode_prints_one_progress_line", async () => {
    // Non-TTY: one machine-readable progress line replaces the spinner.
    const out = new _FakePhaseOut(false);
    await sandboxCmd._phaseStatus(out, "Generating template", () => undefined);
    expect(out.progress_messages).toEqual(["Generating template"]);
    expect(out.spinner_messages).toEqual(["Generating template"]); // spinner ctx still entered
  });

  it("test_quiet_mode_prints_no_progress_line", async () => {
    // Quiet/CI: the phase status is fully silent.
    const out = new _FakePhaseOut(false, true);
    await sandboxCmd._phaseStatus(out, "Assessing description", () => undefined);
    expect(out.progress_messages).toEqual([]);
  });

  it("test_phase_lines_stay_on_stderr", async () => {
    // Non-TTY end-to-end: phase lines on stderr, stdout stays clean.
    _patchSuccessPipeline(tmp);
    _patchClarifyEvaluate([_clarifyAssessment(1.0)]);

    const result = await runner().invoke(cli, ["create", "--prompt", _COMPLETE_DESCRIPTION]);

    expect(result.exit_code, result.output).toBe(2);
    expect(result.stderr).toContain("Assessing description");
    expect(result.stderr).toContain("Generating template");
    expect(result.stdout).not.toContain("Assessing description");
    expect(result.stdout).not.toContain("Generating template");
  });

  it("test_json_mode_progress_on_stderr_stdout_machine_readable", async () => {
    // --json: diagnostics stay on stderr; stdout is a JSON document.
    _patchSuccessPipeline(tmp);
    _patchClarifyEvaluate([_clarifyAssessment(1.0)]);
    patchCreate();

    const result = await runner().invoke(cli, ["--json", "create", "-y", "--prompt", "python env"]);

    expect(result.exit_code, result.output).toBe(0);
    // stdout: machine readable JSON only -- no phase prose, no questions. (`--yes` skips clarification, so the generation
    // phase is the only one that runs here.)
    expect(result.stdout).not.toContain("Generating template");
    expect(result.stdout).not.toContain("Question 1");
    // stderr carries the progress diagnostics as JSON.
    expect(result.stderr).toContain("Generating template");
    expect(result.stderr).toContain('"level": "progress"');
  });

  it("test_quiet_mode_silent_progress", async () => {
    // --quiet: phase lines are suppressed entirely (stdout bare values).
    _patchSuccessPipeline(tmp);
    _patchClarifyEvaluate([_clarifyAssessment(1.0)]);
    patchCreate();

    const result = await runner().invoke(cli, ["--quiet", "create", "-y", "--prompt", "python env"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(result.stderr).not.toContain("Assessing description");
    expect(result.stderr).not.toContain("Generating template");
    expect(result.stdout).not.toContain("Assessing description");
  });
});

// ---------------------------------------------------------------------------
// Template-only switch and natural-language init
// ---------------------------------------------------------------------------

describe("TestTemplateOnlySwitch", () => {
  // Interactive create can stop after the local template.

  it("test_tty_yes_writes_template_and_skips_build", async () => {
    fakeTty({ sandbox: true });
    const [gen, genMock, deploy] = _patchSuccessPipeline(tmp);
    _patchClarifyEvaluate([_clarifyAssessment(1.0)]);
    const mockCreate = vi.spyOn(Sandbox, "create");

    const result = await runner().invoke(cli, ["create", "--prompt", _COMPLETE_DESCRIPTION], { input: "y\n" });

    expect(result.exit_code, result.output).toBe(0);
    const shown = result.output + (result.stderr || "");
    expect(shown).toContain("Switch to template init");
    expect(deploy).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(genMock).toHaveBeenCalledTimes(1);
    const target = path.join(tmp, gen.templateName);
    expect(fs.statSync(path.join(target, "Dockerfile")).isFile()).toBe(true);
    expect(fs.statSync(path.join(target, "template.yaml")).isFile()).toBe(true);
    expect(shown).toContain(`Template '${gen.templateName}' created`);
  });

  it("test_yes_flag_skips_the_switch_and_deploys", async () => {
    // --yes is the full pipeline: no template-only question.
    fakeTty({ sandbox: true });
    const [gen, , deploy] = _patchSuccessPipeline(tmp);
    patchCreate();

    const result = await runner().invoke(cli, ["create", "-y", "--prompt", _COMPLETE_DESCRIPTION], { input: "y\n" });

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).not.toContain("Switch to template init");
    expect(deploy).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(tmp, gen.templateName))).toBe(false);
  });
});

describe("TestTemplateInitNaturalLanguage", () => {
  // `abx template scaffold --prompt "DESCRIPTION"` generates files and stops.

  it("test_description_writes_local_files_without_deploy", async () => {
    const [gen, genMock, deploy] = _patchSuccessPipeline(tmp);

    const result = await runner().invoke(cli, ["template", "scaffold", "-y", "--prompt", "a python data science env"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(deploy).not.toHaveBeenCalled();
    expect(genMock).toHaveBeenCalledTimes(1);
    expect(callArg(genMock, -1, 0)).toBe("a python data science env");
    expect(result.output).not.toContain("Directory for the template project");
    const target = path.join(tmp, gen.templateName);
    expect(fs.readFileSync(path.join(target, "Dockerfile"), "utf-8").startsWith("FROM")).toBe(true);
    expect(result.output).toContain("template deploy");
    expect(result.output).not.toContain("created successfully");
  });

  it("test_name_overrides_directory_and_yaml", async () => {
    _patchSuccessPipeline(tmp);

    const result = await runner().invoke(cli, ["template", "scaffold", "-y", "--name", "myapp", "--prompt", "a python data science env"]);

    expect(result.exit_code, result.output).toBe(0);
    const yamlText = fs.readFileSync(path.join(tmp, "myapp", "template.yaml"), "utf-8");
    expect(yamlText).toContain("name: myapp");
    expect(fs.existsSync(path.join(tmp, "abx-nl-sandbox-abc123"))).toBe(false);
  });

  it("test_existing_files_need_force", async () => {
    const [gen, , deploy] = _patchSuccessPipeline(tmp);
    const target = path.join(tmp, gen.templateName);
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "Dockerfile"), "kept\n", "utf-8");

    const blocked = await runner().invoke(cli, ["template", "scaffold", "-y", "--prompt", "a python data science env"]);
    expect(blocked.exit_code).toBe(1);
    expect(blocked.output).toContain("already exist");
    expect(fs.readFileSync(path.join(target, "Dockerfile"), "utf-8")).toBe("kept\n");
    expect(deploy).not.toHaveBeenCalled();

    const forced = await runner().invoke(cli, ["template", "scaffold", "-y", "--force", "--prompt", "a python data science env"]);
    expect(forced.exit_code, forced.output).toBe(0);
    expect(fs.readFileSync(path.join(target, "Dockerfile"), "utf-8").startsWith("FROM")).toBe(true);
  });

  it("test_description_rejects_scaffold_flags", async () => {
    for (const args of [
      ["template", "scaffold", "--prompt", "a python env", "-t", "python"],
      ["template", "scaffold", "--prompt", "a python env", "--from", "owner/repo"],
    ]) {
      const result = await runner().invoke(cli, args);
      expect(result.exit_code).not.toBe(0);
      expect(result.output).toContain("cannot be combined");
    }
  });

  it("test_top_level_init_shortcut_accepts_a_description", async () => {
    const [gen, , deploy] = _patchSuccessPipeline(tmp);

    const result = await runner().invoke(cli, ["template", "scaffold", "-y", "--prompt", "一个数据分析环境"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(deploy).not.toHaveBeenCalled();
    expect(fs.statSync(path.join(tmp, gen.templateName, "template.yaml")).isFile()).toBe(true);
  });

  it("test_tty_asks_for_a_directory_and_enter_keeps_the_default", async () => {
    fakeTty({ sandbox: true });
    const [gen, , deploy] = _patchSuccessPipeline(tmp);
    _patchClarifyEvaluate([_clarifyAssessment(1.0)]);

    const result = await runner().invoke(cli, ["template", "scaffold", "--prompt", "a python data science env"], { input: "\n" });

    expect(result.exit_code, result.output).toBe(0);
    const shown = result.output + (result.stderr || "");
    expect(shown).toContain("Directory for the template project");
    expect(shown).toContain("./<name>");
    expect(deploy).not.toHaveBeenCalled();
    expect(fs.statSync(path.join(tmp, gen.templateName, "Dockerfile")).isFile()).toBe(true);
  });

  it("test_tty_directory_answer_is_the_project_directory", async () => {
    fakeTty({ sandbox: true });
    const [gen] = _patchSuccessPipeline(tmp);
    _patchClarifyEvaluate([_clarifyAssessment(1.0)]);
    const chosen = path.join(tmp, "serverless-devs");

    const result = await runner().invoke(cli, ["template", "scaffold", "--prompt", "a python data science env"], { input: `${chosen}\n` });

    expect(result.exit_code, result.output).toBe(0);
    expect(fs.readFileSync(path.join(chosen, "Dockerfile"), "utf-8").startsWith("FROM")).toBe(true);
    expect(fs.statSync(path.join(chosen, "template.yaml")).isFile()).toBe(true);
    expect(fs.existsSync(path.join(tmp, gen.templateName))).toBe(false);
    expect(fs.existsSync(path.join(chosen, "serverless-devs"))).toBe(false);
  });

  it("test_tty_rejects_a_file_before_generation", async () => {
    fakeTty({ sandbox: true });
    const [, genMock] = _patchSuccessPipeline(tmp);
    const blocked = path.join(tmp, "not-a-dir");
    fs.writeFileSync(blocked, "x", "utf-8");

    const result = await runner().invoke(cli, ["template", "scaffold", "--prompt", "a python data science env"], { input: `${blocked}\n` });

    expect(result.exit_code).not.toBe(0);
    expect(result.output).toContain("not a directory");
    expect(genMock).not.toHaveBeenCalled();
    expect(fs.readFileSync(blocked, "utf-8")).toBe("x");
  });

  it("test_tty_existing_files_fail_before_generation", async () => {
    fakeTty({ sandbox: true });
    const [, genMock] = _patchSuccessPipeline(tmp);
    const chosen = path.join(tmp, "app");
    fs.mkdirSync(chosen);
    fs.writeFileSync(path.join(chosen, "Dockerfile"), "kept\n", "utf-8");

    const result = await runner().invoke(cli, ["template", "scaffold", "--prompt", "a python data science env"], { input: `${chosen}\n` });

    expect(result.exit_code).not.toBe(0);
    expect(result.output).toContain("already exist");
    expect(genMock).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(chosen, "Dockerfile"), "utf-8")).toBe("kept\n");
  });
});

describe("TestOutputDir", () => {
  // `--dir` / interactive prompt: where the AI template workspace lives.

  async function _invoke(args: string[], input?: string): Promise<Result> {
    patchCreate();
    return runner().invoke(cli, args, input === undefined ? {} : { input });
  }

  it("test_explicit_dir_is_used_as_parent_and_not_created_by_validation", async () => {
    _patchSuccessPipeline(tmp);
    const target = path.join(tmp, "my", "templates");

    const result = await _invoke(["create", "-y", "--dir", target, "--prompt", "python env"]);

    expect(result.exit_code, result.output).toBe(0);
    // Generation (mocked here) creates the workspace; validation alone must not.
    expect(fs.existsSync(target)).toBe(false);
    expect(opts(qwen.prepareWorkdir)["baseDir"]).toBe(path.resolve(target));
  });

  it("test_default_location_when_dir_omitted_and_not_interactive", async () => {
    // No --dir and no TTY: never prompt, keep the standard location.
    _patchSuccessPipeline(tmp);

    const result = await _invoke(["create", "-y", "--prompt", "python env"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).not.toContain("which directory");
    expect(opts(qwen.prepareWorkdir)).not.toHaveProperty("baseDir");
  });

  it("test_tty_prompts_and_enter_accepts_the_default", async () => {
    fakeTty({ sandbox: true });
    _patchSuccessPipeline(tmp);
    _patchClarifyEvaluate([_clarifyAssessment(1.0)]);

    // switch=n, directory=<Enter>, confirm=y
    const result = await _invoke(["create", "--prompt", _COMPLETE_DESCRIPTION], "n\n\ny\n");

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("Save the generated template under which directory?");
    expect(result.output).toContain("generated"); // the default is shown
    expect(opts(qwen.prepareWorkdir)).not.toHaveProperty("baseDir");
  });

  it("test_tty_prompt_answer_is_used", async () => {
    fakeTty({ sandbox: true });
    _patchSuccessPipeline(tmp);
    _patchClarifyEvaluate([_clarifyAssessment(1.0)]);
    const chosen = path.join(tmp, "chosen");

    const result = await _invoke(["create", "--prompt", _COMPLETE_DESCRIPTION], `n\n${chosen}\ny\n`);

    expect(result.exit_code, result.output).toBe(0);
    expect(fs.existsSync(chosen)).toBe(false);
    expect(opts(qwen.prepareWorkdir)["baseDir"]).toBe(path.resolve(chosen));
  });

  it("test_answer_at_the_directory_prompt_creates_no_directory", async () => {
    // A clarification answer typed at the directory prompt must not leave `./pandas`.
    fakeTty({ sandbox: true });
    _patchSuccessPipeline(tmp);
    _patchClarifyEvaluate([_clarifyAssessment(1.0)]);
    const before = new Set(fs.readdirSync(tmp));

    // switch=n, directory="pandas" (meant as a clarification answer), confirm=y
    const result = await _invoke(["create", "--prompt", _COMPLETE_DESCRIPTION], "n\npandas\ny\n");

    expect(result.exit_code, result.output).toBe(0);
    expect(fs.existsSync(path.join(tmp, "pandas"))).toBe(false);
    const added = fs.readdirSync(tmp).filter((name) => !before.has(name));
    expect(added.every((name) => name === "generated-workspace")).toBe(true);
  });

  it("test_unwritable_parent_is_rejected_without_creating_anything", async () => {
    _patchSuccessPipeline(tmp);
    const locked = path.join(tmp, "locked");
    fs.mkdirSync(locked);
    sandboxSeams.access = (p) => String(p) !== fs.realpathSync(locked);

    const result = await runner().invoke(cli, ["create", "-y", "--dir", path.join(locked, "sub"), "--prompt", "python env"]);

    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("not writable");
    expect(fs.existsSync(path.join(locked, "sub"))).toBe(false);
  });

  it("test_dir_without_description_is_a_usage_error", async () => {
    const result = await runner().invoke(cli, ["create", "--template", "base", "--dir", tmp]);

    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("--dir only applies");
  });

  it("test_dir_pointing_at_a_file_is_rejected", async () => {
    _patchSuccessPipeline(tmp);
    const aFile = path.join(tmp, "file.txt");
    fs.writeFileSync(aFile, "x", "utf-8");

    const result = await runner().invoke(cli, ["create", "-y", "--dir", aFile, "--prompt", "python env"]);

    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("not a directory");
  });
});
