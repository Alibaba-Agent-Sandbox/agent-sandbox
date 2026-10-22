/**
 * Pluggable coding-agent backend boundary for `abx create --prompt "<description>"`.
 *
 * Port of `agent_sandbox/agent/coding_agent.py`. The natural-language create path drives a *coding agent* on the host
 * to turn one free-form description into a Dockerfile + `template.yaml` (and, for interactive sessions, to assess the
 * description's completeness first). Today that agent is Qwen Code; the future may plug in Qoder CLI, Codex, Claude
 * Code, or a user-defined command.
 *
 * This module is the seam that keeps the create pipeline honest about that: the create command orchestrates the flow
 * through the {@link CodingAgentBackend} interface and never imports a concrete agent adapter itself.
 * {@link QwenCodeBackend} is the only shipped backend and delegates to the verified Qwen Code modules
 * (`qwen_code.ts`, `codegen.ts`, `clarify.ts`).
 *
 * Intentionally **not** implemented here (same migration points as the Python original):
 *
 * - no plugin registry / entry-point discovery — the shipped set lives in a plain module-level mapping;
 * - no `--coding-agent` command-line selector — resolution always returns the default backend;
 * - the clarification protocol inside `clarify.ts` and the generation pipeline inside `codegen.ts` speak the Qwen
 *   headless dialect (positional prompt + `--json-schema` / `--session-id` / `--resume`); a second backend implements
 *   {@link CodingAgentBackend.research}, {@link CodingAgentBackend.assess} and {@link CodingAgentBackend.generate}
 *   natively, or those protocols get factored into shared helpers first;
 * - `abx config init` / `abx config set` use the unified `llm_*` keys (`llm_api_key` / `llm_model` /
 *   `llm_base_url`), so the backend fields here and the config wizard agree on the same names.
 *
 * **Lazy delegation (ESM port note).** Adapters import their implementation modules lazily inside each method, so
 * importing this boundary stays import-light and tests keep intercepting the existing patch points on the source
 * modules (`qwen_code.seams.findQwenCodeBinary`, `codegen.seams.generateTemplateFiles`, `clarify.seams.evaluate`,
 * ...). ECMAScript has no synchronous lazy import, so **every `QwenCodeBackend` method returns a `Promise`** — also
 * the ones that are plain synchronous calls in Python (`quickSetupLines`, `findBinary`, `resolveCredentials`,
 * `prepareWorkdir`). Callers `await` them; the {@link CodingAgentBackend} interface types those four as
 * `T | Promise<T>` so synchronous test doubles remain valid.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { ValueError } from "../models/value_error.js";
import {
  AICodegenError,
  QwenCodeCredentialError,
  QwenCodeNotInstalledError,
  type SandboxCreationError,
} from "../models/errors.js";
import { pyRepr } from "./_py.js";
import { pyStrip } from "./_pycompat.js";
import type { ClarifyAssessment, ResearchOutcome } from "./clarify.js";
import type { CodegenResult } from "./codegen.js";

export const __all__ = [
  "DEFAULT_CODING_AGENT",
  "CodingAgentBackend",
  "CodingAgentCredentials",
  "QwenCodeBackend",
  "resolveCodingAgentBackend",
] as const;

/** Backend selected when the caller does not name one explicitly. */
export const DEFAULT_CODING_AGENT = "qwen-code";

type MaybePromise<T> = T | Promise<T>;

/** Minimal credential contract the create flow consumes. */
export interface CodingAgentCredentials {
  /** Return the environment variables to inject into the agent run. */
  asEnv(): Record<string, string>;
}

/** Constructor of a creation-error class (`credential_error` / `not_installed_error`). */
export type CreationErrorClass = new (message: string, options?: { suggestion?: string | null }) => SandboxCreationError;

/**
 * What `abx create --prompt "<description>"` needs from a coding agent.
 *
 * The interface covers the five phases the create pipeline runs before deployment: locating/installing the agent,
 * resolving model credentials, researching the public facts behind the description ({@link research}), completing
 * the description ({@link assess}), and generating the template files ({@link generate}).
 */
export interface CodingAgentBackend {
  /** Stable backend identifier (e.g. `"qwen-code"`). */
  readonly name: string;
  /** Human-readable name used in every user-facing message. */
  readonly displayName: string;
  /** Configuration/credential name (e.g. `llm_api_key`). */
  readonly configKey: string;
  /** Environment variable storing the credential (`ABX_LLM_API_KEY`). */
  readonly envVar: string;
  /** Config key holding the OpenAI-compatible base URL override. */
  readonly baseUrlConfigKey: string;
  /** Config key holding the model override. */
  readonly modelConfigKey: string;
  /** Prompt label shown when the credential must be entered interactively. */
  readonly credentialPrompt: string;
  /** Error type raised when no usable credentials exist. */
  readonly credentialError: CreationErrorClass;
  /** Error type raised when the agent executable cannot be located. */
  readonly notInstalledError: CreationErrorClass;

  /**
   * Wording of the Quick Setup guide for the AI template path. `reason` is `"not-installed"` or `"no-credentials"`;
   * the returned lines are printed verbatim by the CLI.
   */
  quickSetupLines(opts: { reason: string }): MaybePromise<string[]>;

  /** Locate the agent executable; `null` when it is not installed. */
  findBinary(): MaybePromise<string | null>;

  /** Install the agent and return the executable path. Throws a `SandboxCreationError` when installation fails. */
  install(opts?: { onProgress?: ((message: string) => void) | null }): Promise<string>;

  /**
   * Resolve model credentials from stored/configured/environment sources. Throws the backend's `credentialError`
   * when nothing usable is found.
   */
  resolveCredentials(opts?: {
    storedApiKey?: string | null;
    storedBaseUrl?: string | null;
    storedModel?: string | null;
  }): MaybePromise<CodingAgentCredentials>;

  /**
   * Create the generation workspace; return `[workdir, templateName]`.
   *
   * The clarification phase and the generation run share this directory: native agent sessions are keyed by the
   * working directory, so both phases must use the same `cwd` for the session pair (`--session-id` / `--resume`) to
   * line up. `baseDir` is the **parent** directory (`abx create --dir`); a fresh `<slug>-<timestamp>-<token>`
   * subdirectory is created inside it. `null`/omitted selects the backend's default location (`~/.abx/generated`).
   */
  prepareWorkdir(description: string, opts?: { baseDir?: string | null }): MaybePromise<[string, string]>;

  /**
   * Run the plain research round that settles public facts first.
   *
   * Runs on the native session `sessionId` **without** structured output, so the agent's own tool loop (web fetch /
   * shell) is free to run before any verdict ends the session.
   *
   * Returns a structured outcome with `ok` and a stable, sanitized failure reason.
   * A failed round continues to assessment; research is an enhancement.
   */
  research(
    prompt: string,
    opts: {
      workdir: string;
      binary: string;
      env: Readonly<Record<string, string>> | null | undefined;
      sessionId: string;
      onActivity?: ((summary: string) => void) | null;
    },
  ): Promise<ResearchOutcome>;

  /**
   * Run one structured completeness-assessment round.
   *
   * The caller sets exactly one of `sessionId` (the session may not exist yet — it must be a **fresh** id: a session
   * that a previous round already created is rejected by the agent) or `resume` (continue the session created by
   * {@link research} or a previous round). `null` means the assessment is unavailable: the create flow degrades to
   * direct generation instead of blocking.
   */
  assess(
    prompt: string,
    opts: {
      workdir: string;
      binary: string;
      env: Readonly<Record<string, string>> | null | undefined;
      sessionId?: string | null;
      resume?: string | null;
      onActivity?: ((summary: string) => void) | null;
    },
  ): Promise<ClarifyAssessment | null>;

  /**
   * Generate `Dockerfile` + `template.yaml` in `workdir`.
   *
   * `resumeSession` continues the native session created by {@link assess}, so the agent keeps the clarification
   * context in its own memory. Throws a `SandboxCreationError` when generation fails or produces invalid artifacts —
   * never a silent fallback.
   */
  generate(
    description: string,
    opts: {
      workdir: string;
      templateName: string;
      resumeSession?: string | null;
      binary?: string | null;
      env?: Readonly<Record<string, string>> | null;
      onProgress?: ((message: string) => void) | null;
      onActivity?: ((summary: string) => void) | null;
    },
  ): Promise<CodegenResult>;

  /**
   * Run `prompt` in `workdir` and return the agent's final text.
   *
   * Used by `abx template scaffold --adopt`. The backend does not validate or write into the user's project; the caller
   * does. The child environment must not inherit cloud credentials.
   */
  runInWorkspace(
    prompt: string,
    opts: {
      workdir: string;
      binary: string;
      env?: Readonly<Record<string, string>> | null;
      timeout?: number | null;
      maxSessionTurns?: number | null;
      onProgress?: ((message: string) => void) | null;
      onActivity?: ((summary: string) => void) | null;
    },
  ): Promise<string>;
}

/**
 * Qwen Code adapter (the only backend shipped today).
 *
 * Every method delegates to the verified implementation modules and imports them lazily at call time, so existing
 * test patch points on those modules (`qwen_code.seams.*`, `codegen.seams.*`, `clarify.seams.*`) keep working
 * unchanged.
 */
export class QwenCodeBackend implements CodingAgentBackend {
  readonly name = "qwen-code";
  readonly displayName = "Qwen Code";
  readonly configKey = "llm_api_key";
  readonly envVar = "ABX_LLM_API_KEY";
  readonly baseUrlConfigKey = "llm_base_url";
  readonly modelConfigKey = "llm_model";
  readonly credentialPrompt = "LLM API key (DashScope/ModelStudio, hidden; leave empty to cancel)";
  readonly credentialError: CreationErrorClass = QwenCodeCredentialError;
  readonly notInstalledError: CreationErrorClass = QwenCodeNotInstalledError;

  async quickSetupLines(opts: { reason: string }): Promise<string[]> {
    const qwenCode = await import("./qwen_code.js");

    const lines = [`Quick Setup - template generation (${this.displayName}):`];
    if (opts.reason === "not-installed") {
      lines.push(
        `  1. Install the ${this.displayName} CLI (official standalone build):`,
        `       ${qwenCode.seams.officialInstallCommand()}`,
        "     or re-run 'abx create --prompt \"<description>\"' and accept the install prompt",
        "     or bypass template generation with:  abx create base",
      );
    } else {
      lines.push(
        "  1. Configure the LLM API key for Qwen Code (DashScope/ModelStudio):",
        `       abx config set ${this.configKey} <KEY>   (stored in ~/.abx/.env)`,
        "       or run the guided wizard:  abx config init --llm",
        "       (exported OPENAI_API_KEY / DASHSCOPE_API_KEY also work)",
      );
    }
    lines.push("  2. Docs: https://github.com/QwenLM/qwen-code");
    return lines;
  }

  async findBinary(): Promise<string | null> {
    const qwenCode = await import("./qwen_code.js");
    return qwenCode.seams.findQwenCodeBinary();
  }

  async install(opts: { onProgress?: ((message: string) => void) | null } = {}): Promise<string> {
    const qwenCode = await import("./qwen_code.js");
    return qwenCode.seams.downloadAndInstallStandalone({ onProgress: opts.onProgress ?? null });
  }

  async resolveCredentials(
    opts: {
      storedApiKey?: string | null;
      storedBaseUrl?: string | null;
      storedModel?: string | null;
    } = {},
  ): Promise<CodingAgentCredentials> {
    const qwenCode = await import("./qwen_code.js");
    return qwenCode.seams.resolveQwenCodeCredentials({
      storedApiKey: opts.storedApiKey ?? null,
      storedBaseUrl: opts.storedBaseUrl ?? null,
      storedModel: opts.storedModel ?? null,
    });
  }

  async prepareWorkdir(description: string, opts: { baseDir?: string | null } = {}): Promise<[string, string]> {
    const codegen = await import("./codegen.js");
    if (opts.baseDir === undefined || opts.baseDir === null) return codegen.seams.prepareWorkdir(description);
    return codegen.seams.prepareWorkdir(description, { baseDir: opts.baseDir });
  }

  /**
   * Run the plain research round through the native session.
   *
   * Delegates to `clarify.runResearch`; every failure is classified into a sanitised `ResearchOutcome` instead of
   * raising, so research stays fail-open.
   */
  async research(
    prompt: string,
    opts: {
      workdir: string;
      binary: string;
      env: Readonly<Record<string, string>> | null | undefined;
      sessionId: string;
      onActivity?: ((summary: string) => void) | null;
    },
  ): Promise<ResearchOutcome> {
    const clarify = await import("./clarify.js");

    const extra = opts.onActivity == null ? {} : { onActivity: opts.onActivity };
    return clarify.seams.runResearch(prompt, {
      binary: opts.binary,
      env: opts.env,
      cwd: opts.workdir,
      sessionId: opts.sessionId,
      ...extra,
    });
  }

  async assess(
    prompt: string,
    opts: {
      workdir: string;
      binary: string;
      env: Readonly<Record<string, string>> | null | undefined;
      sessionId?: string | null;
      resume?: string | null;
      onActivity?: ((summary: string) => void) | null;
    },
  ): Promise<ClarifyAssessment | null> {
    const clarify = await import("./clarify.js");

    const extra = opts.onActivity == null ? {} : { onActivity: opts.onActivity };
    return clarify.seams.evaluate(prompt, {
      binary: opts.binary,
      env: opts.env,
      cwd: opts.workdir,
      sessionId: opts.sessionId ?? null,
      resume: opts.resume ?? null,
      ...extra,
    });
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
      onActivity?: ((summary: string) => void) | null;
    },
  ): Promise<CodegenResult> {
    const codegen = await import("./codegen.js");

    const extra = opts.onActivity == null ? {} : { onActivity: opts.onActivity };
    return codegen.seams.generateTemplateFiles(description, {
      workdir: opts.workdir,
      templateName: opts.templateName,
      resumeSession: opts.resumeSession ?? null,
      binary: opts.binary ?? null,
      env: opts.env ?? null,
      onProgress: opts.onProgress ?? null,
      ...extra,
    });
  }

  async runInWorkspace(
    prompt: string,
    opts: {
      workdir: string;
      binary: string;
      env?: Readonly<Record<string, string>> | null;
      timeout?: number | null;
      maxSessionTurns?: number | null;
      onProgress?: ((message: string) => void) | null;
      onActivity?: ((summary: string) => void) | null;
    },
  ): Promise<string> {
    const codegen = await import("./codegen.js");
    const qwenCode = await import("./qwen_code.js");

    if (opts.onProgress != null) {
      opts.onProgress(`Adapting project with ${this.displayName} in ${opts.workdir} ...`);
    }
    const extra = opts.onActivity == null ? {} : { onActivity: opts.onActivity };
    const result = await qwenCode.seams.runQwenCodeHeadless(prompt, {
      binary: opts.binary,
      env: opts.env ?? null,
      cwd: opts.workdir,
      timeout: opts.timeout != null ? opts.timeout : codegen.defaultCodegenTimeout(),
      maxSessionTurns: opts.maxSessionTurns ?? null,
      cleanEnv: true,
      ...extra,
    });
    let hasDockerfile = false;
    try {
      hasDockerfile = fs.statSync(path.join(opts.workdir, "Dockerfile")).isFile();
    } catch {
      hasDockerfile = false;
    }
    if (result.isError && !hasDockerfile) {
      throw new AICodegenError(`${this.displayName} did not produce a Dockerfile (exit ${result.exitCode}).`, {
        suggestion: `Inspect the staging directory: ${opts.workdir}`,
      });
    }
    return result.text;
  }
}

/**
 * Shipped backends: stable name -> backend class. Deliberately a plain mapping — entry-point based third-party
 * plugins are a migration point.
 */
export const _BACKENDS: Record<string, new () => CodingAgentBackend> = { [new QwenCodeBackend().name]: QwenCodeBackend };

/**
 * Instantiate the coding-agent backend selected by `name`.
 *
 * `null`/omitted (the default) selects {@link DEFAULT_CODING_AGENT}. Unknown names throw an `Error` (Python
 * `ValueError`) — the flow never silently falls back to a different agent than the caller asked for.
 */
export function resolveCodingAgentBackend(name?: string | null): CodingAgentBackend {
  const key = pyStrip(name || DEFAULT_CODING_AGENT);
  const backendClass = Object.hasOwn(_BACKENDS, key) ? _BACKENDS[key] : undefined;
  if (backendClass === undefined) {
    const available = Object.keys(_BACKENDS).sort().join(", ");
    throw new ValueError(`Unknown coding agent backend ${pyRepr(key)}; available: ${available}.`);
  }
  return new backendClass();
}
