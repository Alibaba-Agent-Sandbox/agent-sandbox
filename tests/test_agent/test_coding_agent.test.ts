/**
 * Unit tests for the pluggable coding-agent backend boundary.
 *
 * Port of `tests/test_agent/test_coding_agent.py`. These tests pin the seam that `abx create "<description>"` uses
 * (`src/agent/coding_agent.ts`): the resolver, the protocol surface shipped by `QwenCodeBackend`, and — most
 * importantly — the lazy delegation to the verified implementation modules (`qwen_code`, `codegen`, `clarify`), so
 * the existing patch points (`seams.*`) on those modules keep intercepting every adapter call.
 *
 * ECMAScript has no synchronous lazy import, so every `QwenCodeBackend` method returns a Promise (documented in
 * `src/agent/coding_agent.ts` and `parity/KNOWN-GAPS.md`); the assertions `await` them.
 *
 * No test executes a real agent binary or touches the network.
 */

import * as path from "node:path";
import { build } from "esbuild";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as clarify from "../../src/agent/clarify.js";
import { ClarifyAssessment, ResearchOutcome } from "../../src/agent/clarify.js";
import * as codegen from "../../src/agent/codegen.js";
import { CodegenResult } from "../../src/agent/codegen.js";
import {
  type CodingAgentCredentials,
  DEFAULT_CODING_AGENT,
  QwenCodeBackend,
  resolveCodingAgentBackend,
} from "../../src/agent/coding_agent.js";
import * as qwenCode from "../../src/agent/qwen_code.js";
import { QwenCodeCredentials } from "../../src/agent/qwen_code.js";
import { ValueError } from "../../src/models/value_error.js";
import { QwenCodeCredentialError, QwenCodeNotInstalledError, SandboxCreationError } from "../../src/models/errors.js";
import { CLI_ROOT, makeTmp, raises, rmTmp } from "../helpers/agentSupport.js";

const CREDS = new QwenCodeCredentials({
  source: "qwen-stored",
  apiKey: "sk-test",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  model: "qwen3-coder-plus",
});

/** Every class variable the CLI reads off a backend (camelCase of the Python names). */
const REQUIRED_CLASS_VARS = [
  "name",
  "displayName",
  "configKey",
  "envVar",
  "baseUrlConfigKey",
  "modelConfigKey",
  "credentialPrompt",
  "credentialError",
  "notInstalledError",
] as const;

/** Every method the create pipeline drives. */
const REQUIRED_METHODS = [
  "quickSetupLines",
  "findBinary",
  "install",
  "resolveCredentials",
  "prepareWorkdir",
  "research",
  "assess",
  "generate",
  "runInWorkspace",
] as const;

let tmpPath = "";
beforeEach(() => {
  tmpPath = makeTmp();
});
afterEach(() => {
  vi.restoreAllMocks();
  rmTmp(tmpPath);
});

/** `resolve_coding_agent_backend` selection semantics. */
describe("TestResolver", () => {
  it("test_default_backend_is_qwen_code", () => {
    const backend = resolveCodingAgentBackend();
    expect(DEFAULT_CODING_AGENT).toBe("qwen-code");
    expect(backend).toBeInstanceOf(QwenCodeBackend);
    expect(backend.name).toBe("qwen-code");
  });

  it("test_explicit_name_selects_the_same_backend", () => {
    expect(resolveCodingAgentBackend("qwen-code")).toBeInstanceOf(QwenCodeBackend);
  });

  it("test_each_resolution_returns_a_fresh_instance", () => {
    expect(resolveCodingAgentBackend()).not.toBe(resolveCodingAgentBackend());
  });

  it("test_unknown_backend_raises_value_error", async () => {
    await raises(() => resolveCodingAgentBackend("qoder-cli"), ValueError, "Unknown coding agent backend 'qoder-cli'");
  });

  it("test_unknown_backend_lists_the_available_names", async () => {
    await raises(() => resolveCodingAgentBackend("codex"), ValueError, "available: qwen-code");
  });
});

/** The shipped backend must satisfy the full boundary contract. */
describe("TestProtocolSurface", () => {
  it("test_backend_declares_the_full_protocol_surface", () => {
    const backend = new QwenCodeBackend();
    for (const attr of REQUIRED_CLASS_VARS) expect(attr in backend, attr).toBe(true);
    for (const method of REQUIRED_METHODS) expect(typeof (backend as any)[method], method).toBe("function");
  });

  it("test_declared_error_types_are_creation_errors", () => {
    expect(QwenCodeBackend.prototype.constructor).toBe(QwenCodeBackend);
    const backend = new QwenCodeBackend();
    expect(backend.notInstalledError).toBe(QwenCodeNotInstalledError);
    expect(backend.credentialError).toBe(QwenCodeCredentialError);
    expect(QwenCodeNotInstalledError.prototype instanceof SandboxCreationError).toBe(true);
    expect(QwenCodeCredentialError.prototype instanceof SandboxCreationError).toBe(true);
  });

  it("test_qwen_credentials_satisfy_the_credential_contract", () => {
    const env = CREDS.asEnv();
    expect(typeof env).toBe("object");
    expect(Object.entries(env).every(([k, v]) => typeof k === "string" && typeof v === "string")).toBe(true);
    const contract: CodingAgentCredentials = CREDS;
    expect(contract.asEnv()).toEqual(env);
  });
});

/** The Quick Setup lines are user-facing copy — pin them byte for byte. */
describe("TestQuickSetupWording", () => {
  it("test_not_installed_lines", async () => {
    vi.spyOn(qwenCode.seams, "officialInstallCommand").mockReturnValue("curl -fsSL https://example.test/install.sh | bash");
    const lines = await new QwenCodeBackend().quickSetupLines({ reason: "not-installed" });
    expect(lines).toEqual([
      "Quick Setup - template generation (Qwen Code):",
      "  1. Install the Qwen Code CLI (official standalone build):",
      "       curl -fsSL https://example.test/install.sh | bash",
      "     or re-run 'abx create --prompt \"<description>\"' and accept the install prompt",
      "     or bypass template generation with:  abx create base",
      "  2. Docs: https://github.com/QwenLM/qwen-code",
    ]);
  });

  it("test_no_credentials_lines", async () => {
    const lines = await new QwenCodeBackend().quickSetupLines({ reason: "no-credentials" });
    expect(lines).toEqual([
      "Quick Setup - template generation (Qwen Code):",
      "  1. Configure the LLM API key for Qwen Code (DashScope/ModelStudio):",
      "       abx config set llm_api_key <KEY>   (stored in ~/.abx/.env)",
      "       or run the guided wizard:  abx config init --llm",
      "       (exported OPENAI_API_KEY / DASHSCOPE_API_KEY also work)",
      "  2. Docs: https://github.com/QwenLM/qwen-code",
    ]);
  });
});

/**
 * Transitive static-import closure of `entry` (dynamic `import()` edges excluded), as repo-relative paths.
 */
async function staticImportClosure(entry: string): Promise<Set<string>> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    metafile: true,
    platform: "node",
    format: "esm",
    packages: "external",
    logLevel: "silent",
    outdir: path.join(CLI_ROOT, ".esbuild-unused"),
  });
  const inputs = result.metafile.inputs;
  const seen = new Set<string>();
  const queue = [path.relative(CLI_ROOT, entry).split(path.sep).join("/")];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const imp of inputs[current]?.imports ?? []) {
      if (imp.kind === "import-statement" && !imp.external) queue.push(imp.path);
    }
  }
  return seen;
}

/**
 * Every adapter method must reach its source module lazily.
 *
 * The patches target `qwen_code.seams` / `codegen.seams` / `clarify.seams` directly — exactly what the CLI test
 * suites do — so these tests also pin the lazy-import contract that keeps those patch points alive.
 */
describe("TestDelegation", () => {
  it("test_importing_the_adapter_stays_import_light", async () => {
    // Importing the boundary must not pull in any implementation module.
    const closure = await staticImportClosure(path.join(CLI_ROOT, "src", "agent", "coding_agent.ts"));
    for (const name of ["src/agent/qwen_code.ts", "src/agent/codegen.ts", "src/agent/clarify.ts"]) {
      expect(closure.has(name), name).toBe(false);
    }
    expect(closure.has("src/agent/coding_agent.ts")).toBe(true);
  });

  it("test_find_binary_delegates", async () => {
    const binary = path.join(tmpPath, "qwen");
    const mock = vi.spyOn(qwenCode.seams, "findQwenCodeBinary").mockReturnValue(binary);
    expect(await new QwenCodeBackend().findBinary()).toBe(binary);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledWith();
  });

  it("test_find_binary_returns_none_when_missing", async () => {
    vi.spyOn(qwenCode.seams, "findQwenCodeBinary").mockReturnValue(null);
    expect(await new QwenCodeBackend().findBinary()).toBeNull();
  });

  it("test_install_forwards_the_progress_callback", async () => {
    const installed = path.join(tmpPath, "bin", "qwen");
    const mock = vi.spyOn(qwenCode.seams, "downloadAndInstallStandalone").mockResolvedValue(installed);
    const progress = vi.fn();
    expect(await new QwenCodeBackend().install({ onProgress: progress })).toBe(installed);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledWith({ onProgress: progress });
  });

  it("test_install_defaults_progress_to_none", async () => {
    const mock = vi.spyOn(qwenCode.seams, "downloadAndInstallStandalone").mockResolvedValue(path.join(tmpPath, "qwen"));
    await new QwenCodeBackend().install();
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledWith({ onProgress: null });
  });

  it("test_resolve_credentials_forwards_every_source", async () => {
    const mock = vi.spyOn(qwenCode.seams, "resolveQwenCodeCredentials").mockReturnValue(CREDS);
    const result = await new QwenCodeBackend().resolveCredentials({
      storedApiKey: "stored",
      storedBaseUrl: "https://example.test/v1",
      storedModel: "qwen-test",
    });
    expect(result).toBe(CREDS);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledWith({
      storedApiKey: "stored",
      storedBaseUrl: "https://example.test/v1",
      storedModel: "qwen-test",
    });
  });

  it("test_prepare_workdir_delegates", async () => {
    const expected: [string, string] = [path.join(tmpPath, "ws"), "abx-nl-test-abc"];
    const mock = vi.spyOn(codegen.seams, "prepareWorkdir").mockReturnValue(expected);
    expect(await new QwenCodeBackend().prepareWorkdir("a python env")).toEqual(expected);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledWith("a python env");
  });

  it("test_research_delegates_and_returns_the_outcome", async () => {
    // Research delegates lazily and forwards the sanitised outcome as-is.
    const outcome = new ResearchOutcome({ ok: false, reason: "timeout", detail: "no result within 240s" });
    const mock = vi.spyOn(clarify.seams, "runResearch").mockResolvedValue(outcome);
    const env = { OPENAI_API_KEY: "sk-test" };
    const binary = path.join(tmpPath, "qwen");

    const result = await new QwenCodeBackend().research("research me", {
      workdir: tmpPath,
      binary,
      env,
      sessionId: "sess-1",
    });

    expect(result).toBe(outcome);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledWith("research me", { binary, env, cwd: tmpPath, sessionId: "sess-1" });
    expect(Object.keys(mock.mock.calls[0]![1] as object).sort()).toEqual(["binary", "cwd", "env", "sessionId"]);
  });

  it("test_assess_first_round_creates_the_session", async () => {
    const assessment = new ClarifyAssessment({ completeness: 0.3, question: "Which ports?" });
    const mock = vi.spyOn(clarify.seams, "evaluate").mockResolvedValue(assessment);
    const env = { OPENAI_API_KEY: "sk-test" };
    const binary = path.join(tmpPath, "qwen");

    const result = await new QwenCodeBackend().assess("assess me", {
      workdir: tmpPath,
      binary,
      env,
      sessionId: "sess-1",
    });

    expect(result).toBe(assessment);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledWith("assess me", { binary, env, cwd: tmpPath, sessionId: "sess-1", resume: null });
  });

  it("test_assess_followup_resumes_the_session", async () => {
    const mock = vi.spyOn(clarify.seams, "evaluate").mockResolvedValue(null);

    const result = await new QwenCodeBackend().assess("answer", {
      workdir: tmpPath,
      binary: "qwen",
      env: null,
      resume: "sess-1",
    });

    expect(result).toBeNull();
    const kwargs = mock.mock.calls[0]![1] as unknown as Record<string, unknown>;
    expect(kwargs.resume).toBe("sess-1");
    expect(kwargs.sessionId).toBeNull();
  });

  it("test_generate_forwards_every_argument", async () => {
    const gen = new CodegenResult({
      workdir: tmpPath,
      templateName: "abx-nl-test-abc",
      dockerfile: path.join(tmpPath, "Dockerfile"),
      templateYaml: path.join(tmpPath, "template.yaml"),
      description: "a python env",
      rawOutput: "ok",
    });
    const mock = vi.spyOn(codegen.seams, "generateTemplateFiles").mockResolvedValue(gen);
    const progress = vi.fn();
    const env = { OPENAI_API_KEY: "sk-test" };

    const result = await new QwenCodeBackend().generate("a python env", {
      workdir: tmpPath,
      templateName: "abx-nl-test-abc",
      resumeSession: "sess-1",
      binary: path.join(tmpPath, "qwen"),
      env,
      onProgress: progress,
    });

    expect(result).toBe(gen);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledWith("a python env", {
      workdir: tmpPath,
      templateName: "abx-nl-test-abc",
      resumeSession: "sess-1",
      binary: path.join(tmpPath, "qwen"),
      env,
      onProgress: progress,
    });
  });

  it("test_prepare_workdir_forwards_the_base_dir", async () => {
    const expected: [string, string] = [path.join(tmpPath, "ws"), "abx-nl-test-abc"];
    const mock = vi.spyOn(codegen.seams, "prepareWorkdir").mockReturnValue(expected);

    const result = await new QwenCodeBackend().prepareWorkdir("a python env", { baseDir: tmpPath });

    expect(result).toEqual(expected);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledWith("a python env", { baseDir: tmpPath });
  });

  it("test_on_activity_is_forwarded_to_every_agent_call", async () => {
    const research = vi.spyOn(clarify.seams, "runResearch").mockResolvedValue(new ResearchOutcome({ ok: true }));
    const evaluate = vi.spyOn(clarify.seams, "evaluate").mockResolvedValue(null);
    const generate = vi.spyOn(codegen.seams, "generateTemplateFiles").mockResolvedValue(undefined as unknown as CodegenResult);
    const callback = vi.fn();
    const backend = new QwenCodeBackend();

    await backend.research("p", { workdir: tmpPath, binary: "qwen", env: null, sessionId: "s", onActivity: callback });
    await backend.assess("p", { workdir: tmpPath, binary: "qwen", env: null, resume: "s", onActivity: callback });
    await backend.generate("p", {
      workdir: tmpPath,
      templateName: "n",
      resumeSession: null,
      binary: "qwen",
      env: null,
      onActivity: callback,
    });

    expect((research.mock.calls[0]![1] as any).onActivity).toBe(callback);
    expect((evaluate.mock.calls[0]![1] as any).onActivity).toBe(callback);
    expect((generate.mock.calls[0]![1] as any).onActivity).toBe(callback);
  });

  it("test_run_in_workspace_scrubs_the_environment", async () => {
    // Adopt runs the agent with clean_env so cloud credentials are not inherited.
    const captured: Record<string, unknown> = {};
    vi.spyOn(qwenCode.seams, "runQwenCodeHeadless").mockImplementation(async (_prompt, opts) => {
      Object.assign(captured, opts);
      return new qwenCode.QwenCodeRunResult({ text: "ok", isError: false, exitCode: 0 });
    });
    const result = await new QwenCodeBackend().runInWorkspace("adapt", {
      workdir: tmpPath,
      binary: path.join(tmpPath, "qwen"),
      env: { OPENAI_API_KEY: "sk-test" },
      maxSessionTurns: 4,
    });
    expect(result).toBe("ok");
    expect(captured.cleanEnv).toBe(true);
    expect(captured.env).toEqual({ OPENAI_API_KEY: "sk-test" });
    expect(captured.maxSessionTurns).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Extra coverage for the TypeScript port (no Python counterpart)
// ---------------------------------------------------------------------------

describe("TestRunInWorkspaceExtras", () => {
  it("reports progress, forwards the cwd and the default codegen timeout, and returns the agent text", async () => {
    const progress: string[] = [];
    const seen: Record<string, any> = {};
    vi.spyOn(qwenCode.seams, "runQwenCodeHeadless").mockImplementation(async (_prompt, opts) => {
      Object.assign(seen, opts);
      return new qwenCode.QwenCodeRunResult({ text: "summary", exitCode: 0 });
    });
    const text = await new QwenCodeBackend().runInWorkspace("p", {
      workdir: tmpPath,
      binary: "qwen",
      onProgress: (m) => progress.push(m),
    });
    expect(text).toBe("summary");
    expect(progress).toEqual([`Adapting project with Qwen Code in ${tmpPath} ...`]);
    expect(seen.cwd).toBe(tmpPath);
    expect(seen.timeout).toBe(codegen.defaultCodegenTimeout());
    expect(seen.env).toBeNull();
    expect(seen.maxSessionTurns).toBeNull();
    expect("onActivity" in seen).toBe(false);
  });

  it("raises only when the run failed AND no Dockerfile was produced", async () => {
    const failing = new qwenCode.QwenCodeRunResult({ text: "boom", isError: true, exitCode: 7 });
    vi.spyOn(qwenCode.seams, "runQwenCodeHeadless").mockResolvedValue(failing);
    const backend = new QwenCodeBackend();
    const { AICodegenError } = await import("../../src/models/errors.js");
    const exc = await raises(
      () => backend.runInWorkspace("p", { workdir: tmpPath, binary: "qwen" }),
      AICodegenError,
      /Qwen Code did not produce a Dockerfile \(exit 7\)\./,
    );
    expect(exc.suggestion).toBe(`Inspect the staging directory: ${tmpPath}`);
    const fs = await import("node:fs");
    fs.writeFileSync(path.join(tmpPath, "Dockerfile"), "FROM scratch\n");
    expect(await backend.runInWorkspace("p", { workdir: tmpPath, binary: "qwen" })).toBe("boom");
  });
});
