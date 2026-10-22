/**
 * End-to-end decoupling proof for the pluggable coding-agent backend.
 *
 * `abx create "<description>"` must run entirely through the backend returned by `resolveCodingAgentBackend`: these
 * tests replace the backend with a dummy (no Qwen Code anywhere) and assert that no function of the Qwen Code / codegen
 * / clarify modules is ever touched, while the rest of the create pipeline (deploy, `Sandbox.create`) still runs
 * unchanged.
 *
 * The dummy also pins the message templating contract: every user-facing sentence must name the backend's
 * `displayName` / `configKey` / `envVar` instead of hard-coded "Qwen Code" strings.
 *
 * Nothing here touches the network or the real Qwen Code CLI.
 */

import "../_support/isolatedHome.js";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClarifyAssessment, RESEARCH_REASON_AGENT_UNAVAILABLE, ResearchOutcome } from "../../src/agent/clarify.js";
import * as clarify from "../../src/agent/clarify.js";
import { CodegenResult } from "../../src/agent/codegen.js";
import * as codegen from "../../src/agent/codegen.js";
import type { CodingAgentBackend, CodingAgentCredentials } from "../../src/agent/coding_agent.js";
import * as qwenCode from "../../src/agent/qwen_code.js";
import { Sandbox } from "../../src/api/sandbox.js";
import { codingAgentSeams } from "../../src/cli/commands/_coding_agent.js";
import * as template from "../../src/providers/alicloud_express/cli/template.js";
import { cli } from "../../src/cli/main.js";
import { SandboxCreationError } from "../../src/models/errors.js";
import { SandboxInfo } from "../../src/models/sandbox.js";
import { CliRunner } from "../helpers/cliRunner.js";

// Keep the configuration sources hermetic (Python patches `config_cmd.load_config_dict` / `read_env_var`).
vi.mock("../../src/cli/commands/config_cmd.js", () => ({
  _effectiveValue: () => [null, "default"],
  _ALLOWED_KEYS: new Set(["llm_api_key", "llm_base_url", "llm_model", "sandbox_api_key", "access_key_id", "access_key_secret"]),
  writeEnvVar: async () => undefined,
  _removeTomlKey: async () => undefined,
}));

const runner = (): CliRunner => new CliRunner();

class _DummyNotInstalledError extends SandboxCreationError {
  static override code = "E2905";
}

class _DummyCredentialError extends SandboxCreationError {
  static override code = "E2906";
}

/** Credential object carrying a marker env for assertions. */
class _DummyCredentials implements CodingAgentCredentials {
  asEnv(): Record<string, string> {
    return { DUMMY_AGENT_KEY: "dummy-secret" };
  }
}

/** A complete `CodingAgentBackend` implementation with zero Qwen code. */
class _DummyBackend implements CodingAgentBackend {
  name = "dummy";
  displayName = "Dummy Agent";
  configKey = "dummy_api_key";
  envVar = "ABX_DUMMY_API_KEY";
  baseUrlConfigKey = "dummy_base_url";
  modelConfigKey = "dummy_model";
  credentialPrompt = "Dummy API key (hidden; leave empty to cancel)";
  credentialError = _DummyCredentialError;
  notInstalledError = _DummyNotInstalledError;

  binary: string | null;
  workdir: string;
  template_name: string;
  assessment: ClarifyAssessment | null;
  research_ok: boolean;
  /** Optional classified failure; `null` keeps the bool contract. */
  research_outcome: ResearchOutcome | null = null;
  research_calls: Array<Record<string, unknown>> = [];
  assess_calls: Array<Record<string, unknown>> = [];
  generate_calls: Array<Record<string, unknown>> = [];

  constructor(opts: { binary: string | null; workdir: string; template_name: string; assessment?: ClarifyAssessment | null; research_ok?: boolean }) {
    this.binary = opts.binary;
    this.workdir = opts.workdir;
    this.template_name = opts.template_name;
    this.assessment = opts.assessment ?? null;
    this.research_ok = opts.research_ok ?? true;
  }

  quickSetupLines(opts: { reason: string }): string[] {
    return [`Dummy setup (${opts.reason}); docs: https://example.test/dummy`];
  }

  findBinary(): string | null {
    return this.binary;
  }

  async install(): Promise<string> {
    throw new Error("dummy backend must never install");
  }

  resolveCredentials(): CodingAgentCredentials {
    return new _DummyCredentials();
  }

  prepareWorkdir(): [string, string] {
    return [this.workdir, this.template_name];
  }

  async research(
    prompt: string,
    opts: { workdir: string; binary: string; env: Readonly<Record<string, string>> | null | undefined; sessionId: string },
  ): Promise<boolean | ResearchOutcome> {
    this.research_calls.push({ prompt, workdir: opts.workdir, binary: opts.binary, env: opts.env, session_id: opts.sessionId });
    if (this.research_outcome !== null) return this.research_outcome;
    return this.research_ok;
  }

  async assess(
    prompt: string,
    opts: {
      workdir: string;
      binary: string;
      env: Readonly<Record<string, string>> | null | undefined;
      sessionId?: string | null;
      resume?: string | null;
    },
  ): Promise<ClarifyAssessment | null> {
    this.assess_calls.push({
      prompt,
      workdir: opts.workdir,
      binary: opts.binary,
      env: opts.env,
      session_id: opts.sessionId ?? null,
      resume: opts.resume ?? null,
    });
    return this.assessment;
  }

  async generate(
    description: string,
    opts: {
      workdir: string;
      templateName: string;
      resumeSession?: string | null;
      binary?: string | null;
      env?: Readonly<Record<string, string>> | null;
      onProgress?: ((message: string) => void) | null;
    },
  ): Promise<CodegenResult> {
    this.generate_calls.push({
      description,
      workdir: opts.workdir,
      template_name: opts.templateName,
      resume_session: opts.resumeSession ?? null,
      binary: opts.binary ?? null,
      env: opts.env ?? null,
      on_progress: opts.onProgress ?? null,
    });
    const dockerfile = path.join(opts.workdir, "Dockerfile");
    fs.writeFileSync(dockerfile, "FROM scratch\n", "utf-8");
    const templateYaml = path.join(opts.workdir, "template.yaml");
    fs.writeFileSync(templateYaml, `name: ${opts.templateName}\n`, "utf-8");
    return new CodegenResult({
      workdir: opts.workdir,
      templateName: opts.templateName,
      dockerfile,
      templateYaml,
      description,
      rawOutput: "dummy",
    });
  }

  async runInWorkspace(): Promise<string> {
    throw new Error("dummy backend has no free-form prompt");
  }
}

/** Build a mock Sandbox object (pattern shared with test_create_nl). */
function _makeSandbox(sandbox_id = "sbx-dummy-001", template_ = "x") {
  const sbInfo = SandboxInfo.modelValidate({
    sandboxID: sandbox_id,
    templateID: template_,
    status: "running",
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
  } as unknown as Sandbox;
}

/** Route `resolveCodingAgentBackend()` to the dummy instance. */
function _patchBackend(backend: _DummyBackend) {
  const resolver = vi.fn(() => backend as CodingAgentBackend);
  codingAgentSeams.resolveBackend = resolver;
  return resolver;
}

let tmp = "";
let dummyBackend: _DummyBackend;
let noRealAgent: Record<string, ReturnType<typeof vi.fn>>;
const savedResolver = codingAgentSeams.resolveBackend;
const savedSeams = {
  qwen: { ...qwenCode.seams },
  codegen: { ...codegen.seams },
  clarify: { ...clarify.seams },
};

beforeEach(() => {
  vi.stubEnv("ABX_SANDBOX_API_KEY", "placeholder-sandbox-key");
  vi.stubEnv("ALICLOUD_ACCESS_KEY_ID", "placeholder-ak");
  vi.stubEnv("ALICLOUD_ACCESS_KEY_SECRET", "placeholder-sk");
  tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "abx-backend-"));
  const binary = path.join(tmp, "dummy-agent");
  fs.writeFileSync(binary, "#!/bin/sh\n", "utf-8");
  const workdir = path.join(tmp, "dummy-workspace");
  fs.mkdirSync(workdir);
  dummyBackend = new _DummyBackend({ binary, workdir, template_name: "abx-nl-dummy-xyz" });

  // Patch every Qwen Code / codegen / clarify entry point (recording mocks).
  noRealAgent = {
    qwen_find_binary: vi.fn(() => null),
    qwen_install: vi.fn(),
    qwen_install_command: vi.fn(() => "curl dummy"),
    qwen_resolve_credentials: vi.fn(),
    codegen_prepare_workdir: vi.fn(),
    codegen_generate: vi.fn(),
    clarify_run_research: vi.fn(() => true),
    clarify_evaluate: vi.fn(),
  };
  const m = noRealAgent as Record<string, never>;
  qwenCode.seams.findQwenCodeBinary = m["qwen_find_binary"];
  qwenCode.seams.downloadAndInstallStandalone = m["qwen_install"];
  qwenCode.seams.officialInstallCommand = m["qwen_install_command"];
  qwenCode.seams.resolveQwenCodeCredentials = m["qwen_resolve_credentials"];
  codegen.seams.prepareWorkdir = m["codegen_prepare_workdir"];
  codegen.seams.generateTemplateFiles = m["codegen_generate"];
  clarify.seams.runResearch = m["clarify_run_research"];
  clarify.seams.evaluate = m["clarify_evaluate"];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  codingAgentSeams.resolveBackend = savedResolver;
  Object.assign(qwenCode.seams, savedSeams.qwen);
  Object.assign(codegen.seams, savedSeams.codegen);
  Object.assign(clarify.seams, savedSeams.clarify);
  fs.rmSync(tmp, { recursive: true, force: true });
});

function _assertNoRealAgentCalls(): void {
  for (const [name, mock] of Object.entries(noRealAgent)) {
    expect(mock, name).not.toHaveBeenCalled();
  }
}

describe("TestBackendDecoupling", () => {
  it("test_yes_path_runs_entirely_on_the_dummy_backend", async () => {
    const resolver = _patchBackend(dummyBackend);
    const deployMock = vi.spyOn(template, "do_deploy").mockResolvedValue({ TemplateID: "tmpl-dummy-1", Status: "success" });
    vi.spyOn(template, "resolve_acr_namespace").mockReturnValue("acr-ns");
    const mockSb = _makeSandbox();
    const mockCreate = vi.spyOn(Sandbox, "create").mockResolvedValue(mockSb);

    const result = await runner().invoke(cli, ["create", "-y", "--prompt", "dummy description"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("Generated template: abx-nl-dummy-xyz");
    expect(result.output).toContain("sbx-dummy-001");

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledWith();
    // --yes skips clarification entirely: neither research nor assess must be called.
    expect(dummyBackend.research_calls).toEqual([]);
    expect(dummyBackend.assess_calls).toEqual([]);
    expect(dummyBackend.generate_calls).toHaveLength(1);
    const genCall = dummyBackend.generate_calls[0]!;
    expect(genCall["description"]).toBe("dummy description");
    expect(genCall["template_name"]).toBe("abx-nl-dummy-xyz");
    expect(genCall["resume_session"]).toBeNull();
    expect(genCall["env"]).toEqual({ DUMMY_AGENT_KEY: "dummy-secret" });

    expect(deployMock).toHaveBeenCalledTimes(1);
    expect(deployMock).toHaveBeenCalledWith(dummyBackend.workdir, expect.objectContaining({ acr_namespace: null, ctx: expect.anything(), verbose: false, yes: true }));
    expect((mockCreate.mock.calls[0]![0] as Record<string, unknown>)["template"]).toBe("tmpl-dummy-1");
    _assertNoRealAgentCalls();
  });

  it("test_complete_assessment_reaches_the_confirmation_gate", async () => {
    dummyBackend.assessment = new ClarifyAssessment({ completeness: 0.95, question: null });
    clarify.seams.newSessionId = () => "dummy-session-1";
    _patchBackend(dummyBackend);
    const deployMock = vi.spyOn(template, "do_deploy").mockResolvedValue({});
    const mockCreate = vi.spyOn(Sandbox, "create").mockResolvedValue(_makeSandbox());

    const result = await runner().invoke(cli, ["create", "--prompt", "a complete dummy description"]);

    // Non-interactive without --yes: generation ran, then the gate refused.
    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("Confirmation required to build and deploy");

    // Round 1 runs the research phase first, on the fresh session.
    expect(dummyBackend.research_calls).toHaveLength(1);
    const researchCall = dummyBackend.research_calls[0]!;
    expect(researchCall["session_id"]).toBe("dummy-session-1");
    expect(researchCall["env"]).toEqual({ DUMMY_AGENT_KEY: "dummy-secret" });

    // Research succeeded, so the assessment resumes that same session.
    expect(dummyBackend.assess_calls).toHaveLength(1);
    const firstRound = dummyBackend.assess_calls[0]!;
    expect(firstRound["session_id"]).toBeNull();
    expect(firstRound["resume"]).toBe("dummy-session-1");
    expect(firstRound["env"]).toEqual({ DUMMY_AGENT_KEY: "dummy-secret" });

    // Generation resumed the very session the research created.
    expect(dummyBackend.generate_calls).toHaveLength(1);
    expect(dummyBackend.generate_calls[0]!["resume_session"]).toBe("dummy-session-1");

    expect(deployMock).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    _assertNoRealAgentCalls();
  });

  it("test_failed_research_pins_the_session_for_assessment", async () => {
    // Research fails: the assessment must still run, but pinned to the session itself (session_id=) instead of resuming
    // it (resume=).
    dummyBackend.research_ok = false;
    dummyBackend.assessment = new ClarifyAssessment({ completeness: 0.95, question: null });
    clarify.seams.newSessionId = () => "dummy-session-1";
    _patchBackend(dummyBackend);
    vi.spyOn(template, "do_deploy").mockResolvedValue({});
    const mockCreate = vi.spyOn(Sandbox, "create").mockResolvedValue(_makeSandbox());

    const result = await runner().invoke(cli, ["create", "--prompt", "a complete dummy description"]);

    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("Confirmation required to build and deploy");
    // The research failure is a warning, never a gate.
    expect(result.output).toContain("could not research the public facts");

    expect(dummyBackend.research_calls).toHaveLength(1);
    expect(dummyBackend.research_calls[0]!["session_id"]).toBe("dummy-session-1");
    expect(dummyBackend.assess_calls).toHaveLength(1);
    expect(dummyBackend.assess_calls[0]!["session_id"]).toBe("dummy-session-1");
    expect(dummyBackend.assess_calls[0]!["resume"]).toBeNull();

    expect(mockCreate).not.toHaveBeenCalled();
    _assertNoRealAgentCalls();
  });

  it("test_research_outcome_reason_adds_a_backend_agnostic_hint", async () => {
    // A classified `ResearchOutcome` becomes a hint on any backend.
    dummyBackend.research_outcome = new ResearchOutcome({ ok: false, reason: RESEARCH_REASON_AGENT_UNAVAILABLE, detail: "sanitised detail" });
    dummyBackend.assessment = new ClarifyAssessment({ completeness: 0.95, question: null });
    clarify.seams.newSessionId = () => "dummy-session-1";
    _patchBackend(dummyBackend);
    vi.spyOn(template, "do_deploy").mockResolvedValue({});
    const mockCreate = vi.spyOn(Sandbox, "create").mockResolvedValue(_makeSandbox());

    const result = await runner().invoke(cli, ["create", "--prompt", "a complete dummy description"]);

    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("could not research the public facts");
    expect(result.output).toContain("could not be started"); // reason-specific hint
    expect(result.output).not.toContain("sanitised detail"); // detail is never rendered
    // The failed round hands the session to the assessment (pinned).
    expect(dummyBackend.assess_calls).toHaveLength(1);
    expect(dummyBackend.assess_calls[0]!["session_id"]).toBe("dummy-session-1");
    expect(dummyBackend.assess_calls[0]!["resume"]).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
    _assertNoRealAgentCalls();
  });

  it("test_unavailable_assessment_degrades_and_names_the_backend", async () => {
    dummyBackend.assessment = null; // backend cannot assess at all
    _patchBackend(dummyBackend);
    vi.spyOn(template, "do_deploy").mockResolvedValue({});
    const mockCreate = vi.spyOn(Sandbox, "create").mockResolvedValue(_makeSandbox());

    const result = await runner().invoke(cli, ["create", "--prompt", "a vague dummy description"]);

    expect(result.exit_code).toBe(2);
    expect(result.output).toContain(
      "Could not assess the description completeness with Dummy Agent " + "(assessment unavailable); continuing straight to generation.",
    );
    // Research ran (round 1 always does); the assessment was unavailable.
    expect(dummyBackend.research_calls).toHaveLength(1);
    expect(dummyBackend.assess_calls).toHaveLength(1);
    // Degraded outcome carries no session: generation starts fresh.
    expect(dummyBackend.generate_calls).toHaveLength(1);
    expect(dummyBackend.generate_calls[0]!["resume_session"]).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
    _assertNoRealAgentCalls();
  });

  it("test_missing_binary_uses_the_backend_error_and_wording", async () => {
    const backend = new _DummyBackend({ binary: null, workdir: path.join(tmp, "ws"), template_name: "abx-nl-dummy-xyz" });
    _patchBackend(backend);

    const result = await runner().invoke(cli, ["create", "--prompt", "dummy description"]);

    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("Dummy Agent CLI was not found on PATH or in ~/.abx/bin.");
    expect(result.output).toContain("Dummy setup (not-installed); docs: https://example.test/dummy");
    expect(result.output).toContain("[E2905]");
    expect(result.output).toContain("Dummy Agent CLI is required for template generation");
    _assertNoRealAgentCalls();
  });

  it("test_missing_credentials_use_the_backend_error_and_wording", async () => {
    class _RejectingBackend extends _DummyBackend {
      override resolveCredentials(): CodingAgentCredentials {
        throw new _DummyCredentialError("no key");
      }
    }

    const backend = new _RejectingBackend({ binary: dummyBackend.binary, workdir: dummyBackend.workdir, template_name: dummyBackend.template_name });
    _patchBackend(backend);

    const result = await runner().invoke(cli, ["create", "-y", "--prompt", "dummy description"]);

    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("Dummy Agent is installed but no model credentials were found.");
    expect(result.output).toContain("[E2906]");
    expect(result.output).toContain("abx config set dummy_api_key");
    _assertNoRealAgentCalls();
  });
});
