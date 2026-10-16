/**
 * Template management CLI commands (`abx template ...`; `abx deploy` is the top-level shortcut of `template deploy`).
 *
 * Port of `cli/commands/template.py`. Helper functions keep the Python names (snake_case -> `_camelCase`); keyword
 * arguments of the internal helpers keep their Python (snake_case) spelling because they are plain data. Every module
 * attribute the Python tests monkeypatch is reachable through the mutable {@link templateSeams} object: all internal
 * calls read it at call time.
 */

import fs from "node:fs";
import nodePath from "node:path";

import { Argument, Option, argument, getCurrentContext, group, option, type Context } from "../kit.js";
import { Choice, FLOAT, INT, IntRange, Path as ClickPath } from "../types.js";
import { Abort, CliError, UsageError, sysExit } from "../errors.js";
import { echo, sys } from "../io.js";
import { confirm, prompt } from "../prompts.js";
import { isatty } from "../io.js";
import { cleandoc } from "../../utils/_py.js";
import { EXIT_NOT_FOUND, handleErrors } from "../main.js";
import { getFormatter } from "../formatters.js";
import { requireTemplateFeature } from "../template_provider.js";
import { enableVerbose, getOutput, isCiEnv } from "../output.js";
import { regionOption } from "../region.js";
import { availableCases, renderScaffold } from "../scaffold.js";
import { ACRConfig, DockerBuilder, contextHasPinnedServerArchive, dockerBuildxAvailable } from "../../api/docker_builder.js";
import { cacheDeployedTemplate } from "../../api/capability.js";
import * as fcTemplate from "../../api/fc_template.js";
import { ValueError } from "../../api/_pyerrors.js";
import { formatFixed0, homeDir, which } from "../../agent/_pycompat.js";
import {
  ACRLoginError,
  DockerBuildError,
  GitHubRateLimitError,
  NetworkError,
  TemplateBuildError,
  TemplateNotFoundError,
} from "../../models/errors.js";
import { AKSK_ENV_SUGGESTION } from "../../utils/credential_names.js";
import { createAuthProvider } from "../../transport/auth.js";
import { loadConfig } from "../../transport/config.js";
import { HttpClient } from "../../transport/http.js";
import { HTTPStatusError } from "../../transport/_httpx.js";
import { dotenvValues } from "../../utils/_dotenv.js";
import { pyRepr, pyStr, pyTruthy } from "../../utils/_pyformat.js";
import { AttributeError, OSError, isFile, mkdirParents, pathExists, pyCopytree, pyJoin, pyResolve, pyTypeNameOf, readTextPy, scandirNames, writeTextPy } from "../../utils/_pyos.js";
import { loadYaml as yamlSafeLoad } from "../../utils/yaml_io.js";
import { FINE_GRAINED_PAT_URL, GITHUB_TOKEN_ENV_VAR } from "../../utils/github_token.js";
import * as registryMod from "../../utils/registry.js";
import { BUILTIN_TEMPLATES, RegistryClient, loadTemplateFromYaml } from "../../utils/registry.js";
import { fetchIndex } from "../../utils/template_index.js";
import { resolveTemplateProfile, type TemplateProfile } from "../../providers/template_profile.js";
import { BuildModeError, resolveBuildPlan, type BuildPlan } from "../../template/build_plan.js";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Shared help for the three `--token` options (task 206). The persistent `abx config set github_token` flow is
 * recommended; the flag remains a temporary override with an explicit leak warning.
 */
const _GITHUB_TOKEN_HELP =
  "GitHub token for private repos / higher rate limits. Prefer " +
  "'abx config set github_token' (masked input, stored once in ~/.abx/.env); " +
  "--token is a temporary override that may leak into shell history and the " +
  "process list (env: GITHUB_TOKEN).";

/** Python `str.strip()` for the whitespace set used here. */
function pyStrip(text: string): string {
  return text.replace(/^[\s\x1c-\x1f\x85]+|[\s\x1c-\x1f\x85]+$/g, "");
}

function usageError(message: string): UsageError {
  return new UsageError(message, getCurrentContext(true));
}

/** True when this process was started with `--acr-namespace` (an env value does not count). */
export function explicitAcrNamespaceArgv(argv: readonly string[] = process.argv): boolean {
  return argv.some((arg) => arg === "--acr-namespace" || arg.startsWith("--acr-namespace="));
}

/**
 * True when the parsed command passed `--acr-namespace`.
 * An `ACR_NAMESPACE` environment value is not explicit.
 */
export function acrNamespacePassedOnCli(): boolean {
  const ctx = getCurrentContext(true);
  for (const cmd of [ctx?.cmd, ctx?.parent?.cmd]) {
    if (cmd?.getOptionValueSource("acrNamespace") === "cli") return true;
  }
  return explicitAcrNamespaceArgv();
}

const IGNORED_PLATFORM_STEPS =
  "A Dockerfile is selected, so template.yaml build steps were not sent. Pass --build steps to register those steps instead.";

const STEPS_WITH_ACR = "--acr-namespace cannot be used with platform build steps.";
const STEPS_WITH_LEGACY = "--legacy-api cannot be used with platform build steps.";

/** `dict.get(key, default)`: only a missing key falls back (a stored `null` stays `null`). */
function _get(obj: Record<string, Any>, key: string, dflt: Any): Any {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : dflt;
}

function _isDict(value: unknown): value is Record<string, Any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Lazy sibling-module import (the command-module graph must stay acyclic at import time).
 * The specifiers are a fixed set so the standalone binary bundler can include them.
 */
const _LAZY_MODULES: Record<string, () => Promise<Any>> = {
  "./config_cmd.js": () => import("./config_cmd.js"),
  "./_adopt.js": () => import("./_adopt.js"),
  "./sandbox.js": () => import("./sandbox.js"),
};

async function _lazyModule(specifier: string): Promise<Any> {
  const load = _LAZY_MODULES[specifier];
  if (load === undefined) throw new Error(`Unknown lazy module '${specifier}'`);
  return await load();
}

/** Load one of the config helpers lazily (`config_cmd` imports `main`; keep the command-module graph acyclic). */
async function _configCmd(): Promise<Any> {
  return await _lazyModule("./config_cmd.js");
}

/** Extract a human-readable error message from a Platform error response. */
export function _extractPlatformError(resp: Any): string {
  let data: Any;
  try {
    data = resp.json();
  } catch {
    const text = pyStrip(resp.text || "");
    return text || `HTTP ${resp.status_code}`;
  }
  if (_isDict(data)) {
    for (const key of ["error", "message", "Message", "ErrorMessage", "errorMessage", "detail"]) {
      const val = data[key];
      if (typeof val === "string" && pyStrip(val)) return pyStrip(val);
    }
    return pyStr(data);
  }
  if (typeof data === "string" && pyStrip(data)) return pyStrip(data);
  return `HTTP ${resp.status_code}`;
}

/** Map a Platform `httpx.HTTPStatusError` to a friendly `SandboxError`. */
export function _translatePlatformError(exc: Any, opts: { context: string; template_id?: string | null }): Error {
  const { context, template_id = null } = opts;
  const resp = exc.response;
  const status = resp.status_code;
  const detail = _extractPlatformError(resp);
  if (status === 404 && template_id !== null) {
    return new TemplateNotFoundError(`Template '${template_id}' not found on the platform: ${detail}`, {
      suggestion: "Check the TEMPLATE_ID (run 'abx template list' to see available templates).",
    });
  }
  return new NetworkError(`${context} failed (HTTP ${status}): ${detail}`, {
    suggestion: "Check your authentication (abx auth / API key) and the platform status, then retry.",
  });
}

/** Return the template manifest path, or `null` if none is present. */
export function _findTemplateYaml(template_path: string): string | null {
  const base = String(template_path);
  for (const name of ["template.yaml", "sandbox-template.yaml", "sandbox.yaml"]) {
    const candidate = nodePath.join(base, name);
    if (pathExists(candidate)) return candidate;
  }
  return null;
}

/** Read template.yaml and extract default values for cpu, memory, name (and generation). */
export function _readYamlDefaults(template_dir: string): Record<string, Any> {
  const yamlPath = _findTemplateYaml(template_dir);
  if (yamlPath === null) return {};
  try {
    const raw = yamlSafeLoad(readTextPy(yamlPath));
    const yamlData: Any = pyTruthy(raw) ? raw : {};
    if (!_isDict(yamlData)) throw new AttributeError(`'${pyTypeNameOf(yamlData)}' object has no attribute 'get'`);
    let resources: Any = Object.prototype.hasOwnProperty.call(yamlData, "resources") ? yamlData["resources"] : {};
    resources = pyTruthy(resources) ? resources : {};
    if (!_isDict(resources)) throw new AttributeError(`'${pyTypeNameOf(resources)}' object has no attribute 'get'`);
    const get = (obj: Record<string, Any>, key: string): Any => (Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : null);
    return {
      name: get(yamlData, "name"),
      cpu: get(resources, "cpu") !== null ? get(resources, "cpu") : get(yamlData, "cpu_count"),
      memory: get(resources, "memory") !== null ? get(resources, "memory") : get(yamlData, "memory_mb"),
      generation: get(yamlData, "generation"),
      start_cmd: get(yamlData, "start_cmd"),
      ready_cmd: get(yamlData, "ready_cmd"),
    };
  } catch (e) {
    if (e instanceof OSError || _isNodeOsError(e)) return {};
    echo(`Warning: Failed to parse template.yaml: ${e instanceof Error ? pyStr(e) : String(e)}`, { err: true });
    return {};
  }
}

export interface DeployRuntime {
  generation: number;
  start_cmd: string | null;
  ready_cmd: string | null;
}

function _yamlString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
}

/**
 * Generation and platform start/ready commands for a deploy.
 *
 * A flag wins, then `template.yaml`, then the provider profile when that profile starts the server and `commands.py`
 * is in the directory. The profile default is generation 2 plus `start_cmd` / `ready_cmd`. Other templates stay on
 * generation 1 with no start command.
 */
export function resolveDeployRuntime(
  templateDir: string,
  flags: { generation?: number | null; start_cmd?: string | null; ready_cmd?: string | null } = {},
  profile?: TemplateProfile | null,
): DeployRuntime {
  const yaml = _readYamlDefaults(templateDir);
  const resolvedProfile = profile ?? resolveTemplateProfile(null);
  const platform = resolvedProfile.server_start === "platform_start_cmd" && pathExists(nodePath.join(templateDir, "commands.py"));
  const yamlGeneration = yaml["generation"];
  const generation =
    flags.generation !== null && flags.generation !== undefined
      ? flags.generation
      : yamlGeneration !== null && yamlGeneration !== undefined
        ? _coerceInt(yamlGeneration, platform ? 2 : 1)
        : platform
          ? 2
          : 1;
  const useProfile = generation === 2 && platform;
  return {
    generation,
    start_cmd: _yamlString(flags.start_cmd) ?? _yamlString(yaml["start_cmd"]) ?? (useProfile ? resolvedProfile.start_cmd : null),
    ready_cmd: _yamlString(flags.ready_cmd) ?? _yamlString(yaml["ready_cmd"]) ?? (useProfile ? resolvedProfile.ready_cmd : null),
  };
}

function _rememberTemplate(templateDir: string, templateId: unknown, out: Any, also: readonly string[] = []): void {
  const id = pyStr(templateId ?? "").trim();
  if (!id || id === "N/A") return;
  try {
    const yaml = _findTemplateYaml(templateDir);
    if (!yaml) return;
    const names = [...also];
    const yamlName = _readYamlDefaults(templateDir)["name"];
    if (typeof yamlName === "string" && yamlName.trim()) names.push(yamlName.trim());
    cacheDeployedTemplate(yaml, id, names);
  } catch (e) {
    out.warning(
      `Could not cache template.yaml under ~/.abx/templates/${id}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function _isNodeOsError(e: unknown): boolean {
  const err = e as NodeJS.ErrnoException;
  return e instanceof Error && typeof err.code === "string" && /^E[A-Z0-9]+$/.test(err.code) && typeof err.syscall === "string";
}

/**
 * Resolve a bare template name through the remote template index (SSOT).
 *
 * Raises `TemplateNotFoundError` when the name is not in the index; `NetworkError` when the index is unreachable and no
 * cache exists.
 */
export async function _resolveIndexName(name: string, opts: { token: string | null; fmt: Any; out: Any }): Promise<string> {
  const { token, fmt, out } = opts;
  let index = await fetchIndex(null, { token });
  let entry = index.find(name);
  if (entry === null && !index.stale) {
    // The cache may predate a freshly published template - refresh once.
    index = await fetchIndex(null, { token, force: true });
    entry = index.find(name);
  }
  if (index.notice) out.warning(index.notice);
  if (entry === null) {
    throw new TemplateNotFoundError(
      `Template '${name}' is not a built-in template and was not found in the ` + `template index (${index.source_url}).`,
      {
        suggestion:
          "Run 'abx template search <query>' to browse the index, or install " +
          "directly from a repository: 'abx template install owner/repo//subdir[@ref]'.",
      },
    );
  }
  fmt.printSuccess(`Resolved '${name}' via the template index: ${entry.install_ref}`);
  return entry.install_ref;
}

/** Whether the interactive GitHub-token onboarding can run here. */
export function _githubRateLimitSetupAvailable(out: Any): boolean {
  if ((out.use_json ?? out.useJson ?? out.json_mode) || templateSeams.isCiEnv()) return false;
  try {
    return Boolean(templateSeams.stdinIsatty());
  } catch {
    return false;
  }
}

/**
 * Offer a one-shot interactive `github_token` setup after a rate limit.
 *
 * Returns the stored token, or `null` when the user declines / cancels / enters nothing. The token value is never
 * echoed, printed, or logged.
 */
export async function _offerGithubTokenSetup(fmt: Any, out: Any): Promise<string | null> {
  const cfg = await _configCmd();
  const promptSecret = cfg._promptSecret;
  const writeEnvVar = cfg.writeEnvVar;
  let entered: string;
  try {
    out.info("GitHub rate limit reached and no token is configured " + "(anonymous access is limited to 60 requests/hour).");
    out.info(
      "Create a fine-grained token here - public repositories need no " +
        "extra permissions; a 90-day expiry is recommended:\n" +
        `  ${FINE_GRAINED_PAT_URL}`,
    );
    if (!(await confirm("Configure github_token now?", { default: true }))) return null;
    entered = await promptSecret("Paste the GitHub token (input masked)");
  } catch (e) {
    if (e instanceof Abort) return null;
    throw e;
  }
  const token = pyStrip(entered);
  if (!token) {
    out.warning("No token entered; nothing was saved.");
    return null;
  }
  await writeEnvVar(GITHUB_TOKEN_ENV_VAR, token);
  fmt.printSuccess("Stored github_token in ~/.abx/.env (input hidden); retrying once...");
  return token;
}

/**
 * Run `operation` (which takes the active token) with one-shot recovery.
 *
 * When the operation hits GitHub's anonymous rate limit while no token is configured, an interactive session is offered
 * the masked `github_token` setup and the operation is retried exactly once with the freshly stored token.
 */
export async function _withGithubRateLimitRetry<T>(
  operation: (token: string | null) => T | Promise<T>,
  opts: { token: string | null; fmt: Any; out: Any },
): Promise<T> {
  const { token, fmt, out } = opts;
  try {
    return await operation(token);
  } catch (e) {
    if (!(e instanceof GitHubRateLimitError)) throw e;
    if (token || !templateSeams._githubRateLimitSetupAvailable(out)) throw e;
    const newToken = await templateSeams._offerGithubTokenSetup(fmt, out);
    if (newToken === null) throw e;
    return await operation(newToken);
  }
}

/**
 * Resolve ACR namespace from CLI > os.environ > .env file.
 *
 * `.env` is looked up in the current working directory first and then in `~/.abx/.env` (mirroring the SDK config
 * loader). Raises `UsageError` if the namespace is not found in any source.
 */
export function _resolveAcrNamespace(cli_value: string | null | undefined): string {
  if (cli_value && pyStrip(cli_value)) return pyStrip(cli_value);
  const envVal = process.env["ACR_NAMESPACE"];
  if (envVal && pyStrip(envVal)) return pyStrip(envVal);
  // Try .env files: CWD first, then ~/.abx/.env. A blank value does not count.
  for (const dotenvPath of [nodePath.join(process.cwd(), ".env"), nodePath.join(homeDir(), ".abx", ".env")]) {
    if (pathExists(dotenvPath)) {
      const ns = dotenvValues(dotenvPath).get("ACR_NAMESPACE");
      if (ns && pyStrip(ns)) return pyStrip(ns);
    }
  }
  throw usageError(
    "Missing ACR namespace. Provide via:\n" +
      "  1. --acr-namespace flag\n" +
      "  2. export ACR_NAMESPACE=<ns>\n" +
      "  3. ACR_NAMESPACE=<ns> in ./.env\n" +
      "  4. abx config set acr_namespace <ns>   (or run 'abx config init --build')",
  );
}

/**
 * Safely coerce `value` to int, returning `dflt` on failure.
 *
 * Emits a warning on stderr for truly invalid values so users learn why their `template.yaml` value was ignored.
 */
export function _coerceInt(value: unknown, dflt: number): number {
  if (value === null || value === undefined) return dflt;
  if (typeof value === "boolean") return dflt;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return Math.trunc(value);
  } else {
    const text = pyStr(value).trim();
    if (/^[+-]?\d+(?:_\d+)*$/.test(text)) return Number(text.replace(/_/g, ""));
  }
  echo(`Warning: invalid integer in template.yaml: ${pyRepr(value)}; using default ${dflt}`, { err: true });
  return dflt;
}

/** How many build/push lines to remember. The display keeps the last `ABX_ACTIVITY_LINES` of them (default 6). */
const _STEP_LOG_LINES = 10;

/**
 * Progress reporter for the long-running build/push/deploy steps.
 *
 * On an interactive terminal each {@link phase} is the same block as agent generation: a `message... 12s` header, and
 * under it the last few log lines in grey ({@link log} appends docker build / push / poll output). The block is redrawn
 * once a second even when the tool is silent, so the elapsed time does not freeze. `--verbose` prints every line in
 * full instead. Quiet, JSON, CI, and non-TTY sessions get one progress line and no per-line log.
 */
export class _StepReporter {
  private _out: Any;
  private _verbose: boolean;
  private _handle: { update: ((text: string) => void) | null; close(): void } | null = null;
  private _update: ((text: string) => void) | null = null;
  private _lines: string[] = [];
  private _tick: ReturnType<typeof setTimeout> | null = null;
  private _tickStopped = true;

  constructor(out: Any, opts: { verbose?: boolean } = {}) {
    this._out = out;
    this._verbose = opts.verbose ?? false;
  }

  /** Report that a new long-running step has started. */
  phase(message: string): void {
    this._stop();
    this._lines = [];
    const live = this._out.use_activity_line ?? this._out.useActivityLine;
    if (this._verbose || !live) {
      this._out.progress(message);
      return;
    }
    this._handle = this._out.startActivity(message);
    this._update = this._handle?.update ?? null;
    this._startTick();
  }

  /** Append one tool output line to the grey feed (or print it in verbose). */
  log(line: string): void {
    if (this._verbose) {
      const text = line.replace(/\s+$/, "");
      if (text) this._out.info(text);
      return;
    }
    const text = line.split(/\s+/).filter((part) => part !== "").join(" ");
    if (!text) return;
    this._lines.push(text);
    if (this._lines.length > _STEP_LOG_LINES) this._lines.splice(0, this._lines.length - _STEP_LOG_LINES);
    const snapshot = this._lines.join("\n");
    const update = this._update;
    if (update !== null) {
      try {
        update(snapshot);
      } catch {
        /* suppress: a failed redraw never breaks the step */
      }
    }
  }

  /** Stop any live block and print a completion message. */
  done(message: string): void {
    this._stop();
    this._out.progress(message);
  }

  /** Stop the live block. Safe to call more than once. */
  close(): void {
    this._stop();
  }

  private _startTick(): void {
    this._tickStopped = false;
    const schedule = (): void => {
      const timer = setTimeout(() => {
        if (this._tickStopped) return;
        const update = this._update;
        if (update !== null) {
          try {
            update(this._lines.join("\n"));
          } catch {
            /* suppress */
          }
        }
        if (!this._tickStopped) schedule();
      }, templateSeams._STEP_TICK_SECONDS * 1000);
      timer.unref();
      this._tick = timer;
    };
    schedule();
  }

  private _stop(): void {
    this._tickStopped = true;
    if (this._tick !== null) clearTimeout(this._tick);
    this._tick = null;
    this._update = null;
    const handle = this._handle;
    this._handle = null;
    if (handle !== null) {
      try {
        handle.close();
      } catch {
        /* suppress */
      }
    }
  }
}

/** Print a notice only when `--provenance=false` will actually be added to `docker build`. */
export async function _provenanceNotice(out: Any): Promise<void> {
  if (out.json_mode || out.jsonMode || out.quiet) return;
  if (!(await dockerBuildxAvailable())) return;
  out.info("\u2139 Auto-added --provenance=false" + " (prevents FC image optimization failure; set DOCKER_BUILDKIT=0 to skip)");
}

export interface BuildImageOptions {
  tag: string;
  repo: string | null;
  platform: string;
  dockerfile: string | null;
  on_progress: (message: string) => void;
  on_output?: ((line: string) => void) | null;
}

/**
 * Build a Docker image locally from a template directory and return the local image tag (`<name>:<tag>`).
 * Shared by the `build` and `deploy` commands.
 */
export async function _buildImage(template_dir: string, opts: BuildImageOptions): Promise<string> {
  const { tag, repo, platform, dockerfile, on_progress, on_output = null } = opts;
  const tdir = pyResolve(String(template_dir));
  const imageName = repo || nodePath.basename(tdir);
  const localTag = `${imageName}:${tag}`;

  const builder = new templateSeams.DockerBuilder();
  on_progress("[1/3] Checking Docker daemon...");
  if (!(await builder.checkDocker())) {
    throw new DockerBuildError("Docker daemon is not running or not accessible.", {
      suggestion: "Start Docker Desktop or the Docker daemon.",
    });
  }

  let injectedWheels: string[] = [];
  if (!process.env.ABX_SERVER_SDK_SOURCE && contextHasPinnedServerArchive(tdir, dockerfile)) {
    on_progress("[2/3] Using the Dockerfile's pinned agent-sandbox-server archive");
  } else {
    on_progress("[2/3] Injecting SDK wheel into build context...");
    injectedWheels = await templateSeams.DockerBuilder.injectSdkWheel(tdir, null, dockerfile);
  }

  on_progress(`[3/3] Building Docker image locally: ${localTag}`);
  try {
    await builder.build(tdir, localTag, { platform, dockerfile, on_output });
  } finally {
    for (const whl of injectedWheels) {
      try {
        fs.rmSync(whl, { force: true });
      } catch {
        /* contextlib.suppress(OSError) */
      }
    }
  }
  return localTag;
}

export interface PushImageOptions {
  acr: Any;
  tag: string;
  region: string;
  on_progress: (message: string) => void;
  on_output?: ((line: string) => void) | null;
}

/**
 * Login to ACR, tag, and push a local image.
 *
 * Returns `[acr_ref, creds]` where `creds` is the credential dict from the ACR login. Shared by the `push` and `deploy`
 * commands.
 */
export async function _pushImage(local_image: string, opts: PushImageOptions): Promise<[string, Record<string, Any>]> {
  const { acr, tag, region, on_progress, on_output = null } = opts;
  const builder = new templateSeams.DockerBuilder();
  const acrRef = acr.tagged_ref(tag);

  on_progress(`Logging into ACR: ${acr.registry}`);
  const creds = await builder.loginAcrWithAksk(acr.registry, acr.username, acr.password, {
    region,
    instance_id: acr.acree_instance_id || null,
  });
  on_progress(`Tagging: ${local_image} \u2192 ${acrRef}`);
  await builder.tag(local_image, acrRef);
  on_progress(`Pushing to ACR: ${acrRef}`);
  await builder.push(acrRef, { on_output });
  return [acrRef, creds];
}

interface RunReportedDeployOptions {
  out: Any;
  config: Any;
  template_dir: string;
  acr: Any;
  template_name: string;
  region: string;
  tag: string;
  platform: string;
  resolved_cpu: number;
  resolved_memory: number;
  start_cmd: string | null;
  ready_cmd: string | null;
  timeout: number;
  dockerfile: string | null;
  disk_size: number | null;
  internet_access: boolean | null;
  use_official: boolean;
  team_id: string | null;
  envd_inject: boolean;
  resolved_generation: number;
  force: boolean;
  target_image: string | null;
  platform_ak: string;
  platform_sk: string;
}

/** Build, push, and register, streaming tool output through `reporter`. */
async function _runReportedDeploy(reporter: _StepReporter, o: RunReportedDeployOptions): Promise<Record<string, Any>> {
  const { out, config, template_dir, acr, template_name, region, tag, platform, start_cmd, ready_cmd, timeout, dockerfile } = o;

  if ((start_cmd || ready_cmd) && o.resolved_generation !== 2) {
    // Diagnostic channel: rendered once on stderr, suppressed by --quiet/--ci/--json instead of bypassing the output
    // manager.
    out.warning("--start-cmd / --ready-cmd only take effect with --generation 2 (MicroVM).");
  }

  // Provenance notice only when buildx will accept the flag.
  await _provenanceNotice(out);

  let templateId: string;
  let buildId: string;
  let acrRef: string;
  let buildStatus: string;
  let buildLogs: string[];

  if (o.use_official) {
    const localTag = await templateSeams._buildImage(template_dir, {
      tag,
      repo: acr.repo,
      platform,
      dockerfile,
      on_progress: (m) => reporter.phase(m),
      on_output: (l) => reporter.log(l),
    });
    const [ref, creds] = await templateSeams._pushImage(localTag, {
      acr,
      tag,
      region,
      on_progress: (m) => reporter.phase(m),
      on_output: (l) => reporter.log(l),
    });
    acrRef = ref;
    reporter.done(`Image pushed to ACR: ${acrRef}`);

    const registryType = acr.acree_instance_id ? "acree" : "acr";
    reporter.phase(`Creating template via official API: ${template_name}`);
    const apiResult = await fcTemplate.createOfficialTemplate({
      name: template_name,
      image: acrRef,
      access_key_id: o.platform_ak,
      access_key_secret: o.platform_sk,
      region,
      team_id: o.team_id,
      cpu: o.resolved_cpu,
      memory_size: o.resolved_memory,
      disk_size: o.disk_size,
      internet_access: o.internet_access,
      generation: o.resolved_generation,
      start_command: start_cmd,
      ready_command: ready_cmd,
      force: o.force,
      envd_inject: o.envd_inject,
      registry_type: registryType,
      acr_instance_id: acr.acree_instance_id || null,
      registry_username: creds["tempUserName"] ?? null,
      registry_password: creds["authorizationToken"] ?? null,
      registry_vpc_id: acr.vpc_id || null,
      registry_vswitch_id: acr.vswitch_ids || null,
      registry_security_group_id: acr.security_group_id || null,
      target_image: o.target_image,
    });
    templateId = apiResult["templateID"] ?? "";
    if (!templateId) {
      throw new TemplateBuildError("CreateTemplate returned no template ID.", {
        suggestion: "Check the official API response and retry.",
      });
    }
    reporter.phase(`Waiting for template to become READY: ${templateId}`);

    const onPoll = (state: string, elapsed: number): void => {
      reporter.log(`${state}  ${formatFixed0(elapsed)}s`);
    };

    const finalData = await fcTemplate.waitForTemplateReady(templateId, {
      access_key_id: o.platform_ak,
      access_key_secret: o.platform_sk,
      region,
      team_id: o.team_id,
      timeout,
      on_poll: onPoll,
    });
    const finalStatus = pyTruthy(finalData["status"]) ? finalData["status"] : {};
    buildStatus = _isDict(finalStatus) ? pyStr(finalStatus["state"] ?? "unknown").toLowerCase() : pyStr(finalStatus).toLowerCase();
    buildId = "";
    buildLogs = [];
  } else {
    const builder = new templateSeams.DockerBuilder();
    const result = await builder.buildAndRegister(template_dir, acr, {
      name: template_name,
      tag,
      platform,
      dockerfile,
      cpu_count: o.resolved_cpu,
      memory_mb: o.resolved_memory,
      start_cmd,
      ready_cmd,
      on_progress: (m) => reporter.phase(m),
      on_output: (l) => reporter.log(l),
      api_key: config.api_key,
      api_url: config.api_url,
      access_key_id: config.access_key_id,
      access_key_secret: config.access_key_secret,
      timeout,
    });
    reporter.done(`Template registration finished: ${result.template_id || "N/A"}`);
    templateId = result.template_id;
    buildId = result.build_id;
    acrRef = result.acr_ref;
    buildStatus = result.build_status;
    buildLogs = result.logs;
  }

  return {
    TemplateID: templateId || "N/A",
    BuildID: buildId || "N/A",
    "ACR Image": acrRef || "N/A",
    Status: buildStatus,
    _build_logs: !o.use_official ? buildLogs : [],
  };
}

export interface DoDeployOptions {
  acr_namespace: string;
  acr_registry?: string;
  acr_repo?: string | null;
  acr_username?: string | null;
  acr_password?: string | null;
  acree_instance_id?: string;
  vpc_id?: string;
  vswitch_ids?: string;
  security_group_id?: string;
  alias?: string | null;
  tag?: string;
  platform?: string;
  cpu?: number | null;
  memory?: number | null;
  start_cmd?: string | null;
  ready_cmd?: string | null;
  timeout?: number;
  dockerfile?: string | null;
  disk_size?: number | null;
  internet_access?: boolean | null;
  use_official?: boolean;
  team_id?: string | null;
  envd_inject?: boolean;
  generation?: number | null;
  /** Delete a generation-1 template of the same name and create a generation-2 template. */
  force?: boolean;
  target_image?: string | null;
  region?: string | null;
  ctx?: Context | null;
  verbose?: boolean;
  /** `auto` (default), `dockerfile`, or `steps`. A flag of `auto` still honors `build.mode` in template.yaml. */
  build?: string | null;
  /** Set when the user passed `--acr-namespace`. An ambient `ACR_NAMESPACE` must stay false. */
  explicit_acr_namespace?: boolean;
}

/**
 * Shared deploy logic: docker build -> ACR push -> CreateTemplate -> poll.
 *
 * Used by both `template build`/`deploy` and `install` (when not `--download-only`). Returns a summary dict with
 * TemplateID, Status, etc.
 */
export async function _doDeploy(template_dir: string, opts: DoDeployOptions): Promise<Record<string, Any>> {
  const {
    acr_namespace,
    acr_registry = "registry.cn-hangzhou.aliyuncs.com",
    acr_repo = null,
    acr_username = null,
    acr_password = null,
    acree_instance_id = "",
    vpc_id = "",
    vswitch_ids = "",
    security_group_id = "",
    alias = null,
    tag = "latest",
    platform = "linux/amd64",
    cpu = null,
    memory = null,
    start_cmd = null,
    ready_cmd = null,
    timeout = 600,
    dockerfile = null,
    disk_size = null,
    internet_access = null,
    use_official = true,
    team_id = null,
    envd_inject = false,
    generation = null,
    force = false,
    target_image = null,
    region = null,
    ctx = null,
    verbose = false,
    build = null,
    explicit_acr_namespace = false,
  } = opts;

  const config = templateSeams.loadConfig({ region });

  const yamlDefaults = _readYamlDefaults(template_dir);
  const resolvedCpu: number = cpu !== null ? cpu : _coerceInt(yamlDefaults["cpu"], 2);
  const resolvedMemory: number = memory !== null ? memory : _coerceInt(yamlDefaults["memory"], 2048);
  const runtime = resolveDeployRuntime(template_dir, { generation, start_cmd, ready_cmd });
  const resolvedGeneration = runtime.generation;
  const resolvedStart = runtime.start_cmd;
  const resolvedReady = runtime.ready_cmd;
  const resolvedAcrUsername = acr_username || config.access_key_id || "";
  const resolvedAcrPassword = acr_password || config.access_key_secret || "";
  const resolvedRepo = acr_repo || yamlDefaults["name"] || nodePath.basename(pyResolve(String(template_dir)));
  const templateName = alias || resolvedRepo;

  let plan: BuildPlan;
  try {
    plan = resolveBuildPlan(template_dir, { mode: build ?? "auto", dockerfile });
  } catch (e) {
    if (e instanceof BuildModeError) throw usageError(e.message);
    throw e;
  }

  const out = templateSeams.getOutput(ctx);
  if (plan.kind === "steps") {
    if (explicit_acr_namespace) throw usageError(STEPS_WITH_ACR);
    if (!use_official) throw usageError(STEPS_WITH_LEGACY);
    if (!config.access_key_id || !config.access_key_secret) {
      throw new CliError(
        "Alibaba Cloud credentials missing. Run 'abx config init --build', or " +
          "'abx config set access_key_id' / 'abx config set access_key_secret'. " +
          AKSK_ENV_SUGGESTION,
      );
    }
    const reporter = new _StepReporter(out, { verbose });
    try {
      reporter.phase(`Creating template from platform steps: ${templateName}`);
      const apiResult = await fcTemplate.createOfficialTemplate({
        name: templateName,
        image: plan.image,
        steps: plan.steps,
        access_key_id: config.access_key_id,
        access_key_secret: config.access_key_secret,
        region: config.region,
        team_id,
        cpu: resolvedCpu,
        memory_size: resolvedMemory,
        disk_size,
        internet_access,
        generation: resolvedGeneration,
        start_command: resolvedStart,
        ready_command: resolvedReady,
        force,
        envd_inject: false,
      });
      const templateId = pyStr(apiResult["templateID"] ?? "");
      if (!templateId) {
        throw new TemplateBuildError("CreateTemplate returned no template ID.", {
          suggestion: "Check the official API response and retry.",
        });
      }
      reporter.done(`Template registration submitted: ${templateId}`);
      _rememberTemplate(template_dir, templateId, out, [alias ?? "", templateName].filter((n) => Boolean(n)));
      return {
        TemplateID: templateId,
        BuildID: "N/A",
        "ACR Image": "N/A",
        "Build mode": "steps",
        Status: "submitted",
        _build_logs: [],
      };
    } finally {
      reporter.close();
    }
  }

  if (!resolvedAcrUsername || !resolvedAcrPassword) {
    throw new CliError(
      "ACR credentials missing. Run 'abx config init --build', or " +
        "'abx config set access_key_id' / 'abx config set access_key_secret', " +
        "or pass --acr-username/--acr-password. " +
        AKSK_ENV_SUGGESTION,
    );
  }

  const platformAk = config.access_key_id || "";
  const platformSk = config.access_key_secret || "";

  const acr = new ACRConfig({
    registry: acr_registry,
    namespace: acr_namespace,
    repo: resolvedRepo,
    username: resolvedAcrUsername,
    password: resolvedAcrPassword,
    acree_instance_id,
    vpc_id,
    vswitch_ids,
    security_group_id,
  });
  const finalRegion: string = config.region;

  const reporter = new _StepReporter(out, { verbose });
  try {
    if (plan.ignoredSteps) out.warning(IGNORED_PLATFORM_STEPS);
    const reported = await _runReportedDeploy(reporter, {
      out,
      config,
      template_dir,
      acr,
      template_name: templateName,
      region: finalRegion,
      tag,
      platform,
      resolved_cpu: resolvedCpu,
      resolved_memory: resolvedMemory,
      start_cmd: resolvedStart,
      ready_cmd: resolvedReady,
      timeout,
      dockerfile: plan.dockerfile,
      disk_size,
      internet_access,
      use_official,
      team_id,
      envd_inject,
      resolved_generation: resolvedGeneration,
      force,
      target_image,
      platform_ak: platformAk,
      platform_sk: platformSk,
    });
    _rememberTemplate(template_dir, reported["TemplateID"], out, [alias ?? "", templateName].filter((n) => Boolean(n)));
    return reported;
  } finally {
    reporter.close();
  }
}

/**
 * Mutable seams: the TypeScript counterpart of the module attributes the Python tests monkeypatch. Internal calls read
 * them at call time.
 */
export const templateSeams: {
  _STEP_TICK_SECONDS: number;
  _doDeploy: typeof _doDeploy;
  _buildImage: typeof _buildImage;
  _pushImage: typeof _pushImage;
  _githubRateLimitSetupAvailable: typeof _githubRateLimitSetupAvailable;
  _offerGithubTokenSetup: typeof _offerGithubTokenSetup;
  _tryArrowCasePicker: (cases: Array<[string, string]>) => Promise<string | null>;
  _scaffoldPickerAvailable: (fmt: Any) => boolean;
  getOutput: typeof getOutput;
  loadConfig: typeof loadConfig;
  isCiEnv: () => boolean;
  stdinIsatty: () => boolean;
  DockerBuilder: typeof DockerBuilder;
} = {
  _STEP_TICK_SECONDS: 1.0,
  _doDeploy: (...a) => _doDeploy(...a),
  _buildImage: (...a) => _buildImage(...a),
  _pushImage: (...a) => _pushImage(...a),
  _githubRateLimitSetupAvailable: (...a) => _githubRateLimitSetupAvailable(...a),
  _offerGithubTokenSetup: (...a) => _offerGithubTokenSetup(...a),
  _tryArrowCasePicker: (...a) => _tryArrowCasePicker(...a),
  _scaffoldPickerAvailable: (...a) => _scaffoldPickerAvailable(...a),
  getOutput: (...a) => getOutput(...a),
  loadConfig: (...a) => loadConfig(...a),
  isCiEnv: () => isCiEnv(),
  stdinIsatty: () => isatty(sys.stdin),
  DockerBuilder,
};

/** Public alias so other commands (e.g. `abx create` AI path) can reuse the build -> push -> CreateTemplate -> poll pipeline. */
export const do_deploy = (...a: Parameters<typeof _doDeploy>): ReturnType<typeof _doDeploy> => templateSeams._doDeploy(...a);

/** Public alias used by the `abx create` AI path to resolve the ACR namespace. */
export const resolve_acr_namespace = _resolveAcrNamespace;

export const template = group("template", {
  help: cleandoc(`Discover, scaffold, build, publish and install sandbox templates.

    \b
    Examples:
      abx template search python
      abx template scaffold --template python --name my-template
      abx template list

    \b
    Related commands:
      abx create --template TEMPLATE  Launch a sandbox from a template
      abx deploy [PATH]               Same as 'template deploy'
      abx config --help               Configure credentials and region
    `),
});

/** The option set of `template install`. */
function _installParams(opts: { acrNamespaceHelp: string; cpuHelp: string; memoryHelp: string }): Array<Argument | Option> {
  return [
    argument(["template_ref"]),
    option(["--registry-url"], { default: "https://github.com", help: "Registry URL (default: GitHub)" }),
    option(["--registry-type"], {
      type: new Choice(["github", "local"]),
      default: null,
      help: "Registry type (auto-detected if not specified)",
    }),
    option(["--token"], { default: null, envvar: "GITHUB_TOKEN", help: _GITHUB_TOKEN_HELP }),
    option(["--alias", "-a"], { default: null, help: "Template alias" }),
    option(["--download-only"], {
      is_flag: true,
      default: false,
      help: "Only download to local cache (skip build and deploy)",
    }),
    option(["--dir", "dest_dir"], {
      default: null,
      type: new ClickPath(),
      help: "Download template source into this directory instead of the cache",
    }),
    option(["--acr-namespace"], { envvar: "ACR_NAMESPACE", default: null, help: opts.acrNamespaceHelp }),
    option(["--cpu"], { type: INT, default: null, help: opts.cpuHelp }),
    option(["--memory"], { type: INT, default: null, help: opts.memoryHelp }),
    option(["--yes", "-y"], { is_flag: true, default: false, help: "Skip confirmation prompt" }),
    regionOption(),
  ] as Array<Argument | Option>;
}

export const install = template.command("install", {
  help: cleandoc(`Download a template and (by default) build + deploy it.

    By default, install downloads the template, then runs docker build,
    pushes to ACR, and creates a sandbox template via the official API —
    cloud-side operations that can incur Alibaba Cloud costs (ACR
    storage/traffic, template resources). Use --download-only to skip the
    build/deploy step and only download to the local cache
    (~/.abx/templates/).

    Use --dir <path> to download into a specific directory instead of
    the cache.

    TEMPLATE_REF can be a bare template name from the official index
    (alibaba-agent-sandbox/awesome-templates) or a registry reference. Bare names
    are resolved against the remote index; entries may pin a version, in
    which case that pinned ref is honoured.

    A GitHub token (private repos / higher rate limits) is taken from
    --token, then the GITHUB_TOKEN environment variable, then ./.env, then
    the stored github_token; prefer 'abx config set github_token' - --token
    may leak into shell history and process listings.

    \b
    Examples:
      abx template install python-hello --download-only   # install by index name
      abx template install owner/repo --acr-namespace my-ns
      abx template install owner/repo@v1.0 --download-only
      abx template install owner/repo//subdir --dir ./local-copy
      abx template install owner/repo --acr-namespace my-ns --region cn-shanghai

    \b
    Related commands:
      abx template search QUERY  Find a template in the index
      abx template list          List registered templates
      abx create --template ID   Launch the installed template
    `),
  params: _installParams({
    acrNamespaceHelp: "ACR namespace for deploy (env: ACR_NAMESPACE, or set in .env file)",
    cpuHelp: "CPU cores (default: from template.yaml or 2)",
    memoryHelp: "Memory in MB (default: from template.yaml or 2048)",
  }),
  callback: handleErrors(async (ctx: Context, params: Any): Promise<void> => {
    if (!params["download_only"]) requireTemplateFeature("templates.build");
    const {
      registry_url: registryUrl,
      registry_type: registryType,
      token,
      alias,
      download_only: downloadOnly,
      dest_dir: destDir,
      acr_namespace: acrNamespace,
      cpu,
      memory,
      yes,
      region,
    } = params;
    let templateRef: string = params["template_ref"];

    const cfgMod = await _configCmd();
    const resolveGithubToken = cfgMod.resolveGithubToken;

    const fmt = getFormatter(ctx);
    const out = getOutput(ctx);

    // BUG-05: Early validation for local paths to avoid raw traceback.
    const looksLocal =
      registryType === "local" ||
      templateRef.startsWith("./") ||
      templateRef.startsWith("../") ||
      templateRef.startsWith("/") ||
      pathExists(templateRef);
    if (looksLocal && !pathExists(templateRef)) {
      fmt.printError(`Path not found: ${templateRef}`, {
        suggestion: "Verify the path exists, or use owner/repo format for GitHub templates.",
      });
      sysExit(EXIT_NOT_FOUND);
    }

    const activeToken = await resolveGithubToken(token);

    const acquire = async (active: string | null): Promise<[Any, string | null]> => {
      const client = new RegistryClient(registryUrl, active);
      let ref = await client.resolve(templateRef, registryType);

      if (ref.is_builtin) {
        if (BUILTIN_TEMPLATES.has(templateRef)) {
          fmt.printSuccess(`'${templateRef}' is a built-in template. No installation needed.`);
          fmt.printSuccess(`Use it directly: abx create --template ${templateRef}`);
          return [ref, null];
        }
        // Bare name that is not built-in: resolve it through the remote template index (single source of truth),
        // then continue as usual.
        templateRef = await _resolveIndexName(templateRef, { token: active, fmt, out });
        ref = await client.resolve(templateRef, registryType);
        if (ref.is_builtin) {
          throw new CliError(`Template index resolved '${templateRef}' to a built-in template.`);
        }
      }

      // Fetch the template sources.
      if (ref.registry_type === "local") {
        fmt.printSuccess(`Using local template from ${ref.local_path}...`);
        return [ref, await client.fetch(ref)];
      }
      fmt.printSuccess(`Fetching template from ${ref.owner}/${ref.repo}...`);
      return [ref, await out.spinner(`Fetching template ${templateRef}`, () => client.fetch(ref))];
    };

    const [ref, sourcePath] = await _withGithubRateLimitRetry(acquire, { token: activeToken, fmt, out });
    if (sourcePath === null) return; // built-in template: nothing to install

    // Locate template.yaml
    const yamlPath = _findTemplateYaml(sourcePath);
    if (yamlPath === null) {
      fmt.printError(`No template.yaml (or sandbox-template.yaml / sandbox.yaml) found in ${sourcePath}`, {
        suggestion: "Ensure the repository contains a template.yaml at the root.",
      });
      sysExit(1);
    }

    const tmpl = loadTemplateFromYaml(yamlPath);
    const installName: string = alias || tmpl.name || nodePath.basename(sourcePath);

    // --dir: download into a user-specified directory
    let cachedPath: string;
    if (destDir !== null) {
      const destPath = pyResolve(destDir);
      if (pathExists(destPath) && fs.readdirSync(destPath).length > 0) {
        throw new CliError(
          `Directory '${destPath}' already exists and is not empty. ` + "Remove or empty it first, or choose a different --dir path.",
        );
      }
      fs.mkdirSync(destPath, { recursive: true });
      pyCopytree(sourcePath, destPath);
      cachedPath = destPath;
    } else if (ref.registry_type === "local") {
      // Copy to local cache (default)
      const dest = pyJoin(registryMod.TEMPLATE_CACHE_DIR, installName);
      if (pyResolve(sourcePath) !== pyResolve(dest)) {
        mkdirParents(dest);
        pyCopytree(sourcePath, dest);
      }
      cachedPath = dest;
    } else {
      cachedPath = sourcePath;
    }

    const cacheData: Record<string, Any> = {
      Alias: installName || "N/A",
      Source: String(sourcePath),
      Cached: String(cachedPath),
      Status: "installed-locally",
    };

    if (downloadOnly) {
      if (fmt.use_json) {
        fmt.printData(cacheData);
      } else {
        fmt.printDict(cacheData);
        fmt.printSuccess(`Template '${installName}' installed to the local cache. ` + "Build and push the image with 'abx template build'.");
      }
      return;
    }

    // --- Build + deploy precheck ---
    const missing: string[] = [];
    let plan: BuildPlan | null = null;
    try {
      plan = resolveBuildPlan(String(cachedPath));
    } catch (exc) {
      if (!(exc instanceof BuildModeError)) throw exc;
      missing.push(exc.message);
    }

    let resolvedNs: string | null = null;
    if (plan?.kind === "steps") {
      if (acrNamespacePassedOnCli()) throw usageError(STEPS_WITH_ACR);
    } else if (plan?.kind === "dockerfile") {
      const dockerPath = which("docker");
      if (!dockerPath) {
        missing.push("Docker not found in PATH. Install Docker or start Docker Desktop.");
      }
      try {
        resolvedNs = _resolveAcrNamespace(acrNamespace);
      } catch (exc) {
        if (!(exc instanceof UsageError)) throw exc;
        missing.push(exc.message);
        resolvedNs = null;
      }
    }

    // AK/SK credentials?
    const config = templateSeams.loadConfig({ region });
    if (!(config.access_key_id && config.access_key_secret)) {
      missing.push(
        "Alibaba Cloud AK/SK credentials not found. Run 'abx config init --build', or:\n" +
          "  abx config set access_key_id <ALICLOUD_ACCESS_KEY_ID>\n" +
          "  abx config set access_key_secret <ALICLOUD_ACCESS_KEY_SECRET>\n" +
          "  " + AKSK_ENV_SUGGESTION,
      );
    }

    if (missing.length > 0) {
      const msg =
        "Cannot build + deploy. Missing prerequisites:\n" +
        missing.map((m) => `  \u2022 ${m}`).join("\n") +
        "\n\nRun with --download-only to just download the template.";
      throw new CliError(msg);
    }

    // ensured by precheck above
    if (plan?.kind === "dockerfile" && resolvedNs === null) throw new Error("unreachable: ACR namespace resolved by the precheck");

    // Confirmation
    if (!yes) {
      if (!templateSeams.stdinIsatty()) {
        throw usageError("Confirmation required for build + deploy. " + "Use --yes/-y to skip in non-interactive mode.");
      }
      await confirm(`Download complete. Build and deploy template '${installName}'?`, { abort: true });
    }

    // Run deploy via shared helper
    out.info(`Building and deploying template '${installName}' from ${cachedPath}`);
    const deployData = await templateSeams._doDeploy(String(cachedPath), {
      acr_namespace: plan?.kind === "steps" ? "" : (resolvedNs ?? ""),
      cpu,
      memory,
      alias,
      region,
      ctx,
      build: plan?.kind ?? "auto",
    });

    const buildStatus = _get(deployData, "Status", "unknown");
    delete deployData["_build_logs"];
    if (fmt.use_json) {
      fmt.printData({ ...cacheData, ...deployData });
    } else {
      fmt.printDict(deployData);
      if (buildStatus === "ready") {
        fmt.printSuccess("Template installed, built, and ready!");
        fmt.printSuccess(`Use: abx create --template ${pyStr(_get(deployData, "TemplateID", null))}`);
      } else if (_get(deployData, "Build mode", null) === "steps" && buildStatus === "submitted") {
        fmt.printSuccess("Template registration submitted from platform build steps.");
        fmt.printSuccess(`Use: abx create --template ${pyStr(_get(deployData, "TemplateID", null))}`);
      } else if (buildStatus === "pushed" || buildStatus === "submitted") {
        fmt.printSuccess("Template downloaded and image pushed; registration submitted.");
      } else {
        fmt.printError(`Build status: ${buildStatus}`);
      }
    }
  }),
});

export const list_templates = template.command("list", {
  help: cleandoc(`List custom templates registered for the current account.

    By default this queries the configured platform endpoint. Pass
    --official-api to use the Alibaba Cloud FCSandbox API with AK/SK.
    This command does not search the community template index.

    \b
    Examples:
      abx template list
      abx template list --official-api
      abx template list --region cn-shanghai
      abx --json template list

    \b
    Related commands:
      abx template info TEMPLATE_ID
      abx template search QUERY
      abx template install TEMPLATE_REF
    `),
  params: [
    option(["--official-api"], {
      is_flag: true,
      default: false,
      help: "Query templates via the official Alibaba Cloud FCSandbox API (AK/SK).",
    }),
    regionOption(),
  ],
  callback: handleErrors(async (ctx: Context, params: Any): Promise<void> => {
    requireTemplateFeature("templates.read");
    const fmt = getFormatter(ctx);
    const config = templateSeams.loadConfig({ region: params["region"] });

    if (params["official_api"]) {
      if (!(config.access_key_id && config.access_key_secret)) {
        throw new CliError("--official-api requires AccessKey/AccessSecret in the environment.");
      }
      const templates = await fcTemplate.listOfficialTemplates({
        access_key_id: config.access_key_id,
        access_key_secret: config.access_key_secret,
        region: config.region,
      });
      if (!templates || templates.length === 0) {
        fmt.printSuccess("No official templates found for this team.");
        return;
      }
      const headers = ["TemplateID", "Name", "Alias", "Status"];
      const rows = templates.map((t: Any) => [
        pyStr(pyTruthy(t["templateID"]) ? t["templateID"] : pyTruthy(t["template_id"]) ? t["template_id"] : "N/A"),
        pyStr(_get(t, "name", "N/A")),
        pyStr(pyTruthy(t["alias"]) ? t["alias"] : ""),
        pyStr(_isDict(t["status"]) ? _get(t["status"], "state", "N/A") : _get(t, "status", "N/A")),
      ]);
      fmt.printTable(headers, rows);
      return;
    }

    const auth = createAuthProvider({
      api_key: config.api_key,
      access_key_id: config.access_key_id,
      access_key_secret: config.access_key_secret,
    });
    const httpClient = new HttpClient(config, auth);

    let templates: Any;
    try {
      const resp = await httpClient.platformRequest("GET", "/templates");
      templates = resp.json();
    } catch (exc) {
      if (exc instanceof HTTPStatusError) throw _translatePlatformError(exc, { context: "Listing templates" });
      throw exc;
    } finally {
      await httpClient.close();
    }

    if (!pyTruthy(templates)) {
      fmt.printSuccess("No custom templates found. Use 'abx template install <repo>' to install from GitHub.");
      return;
    }

    if (Array.isArray(templates)) {
      const headers = ["TemplateID", "Alias", "Status"];
      const rows = templates.map((t: Any) => [_get(t, "templateID", "N/A"), _get(t, "alias", "N/A"), _get(t, "status", "N/A")]);
      fmt.printTable(headers, rows);
    } else {
      fmt.printData(templates);
    }
  }),
});

export const info = template.command("info", {
  help: cleandoc(`Show details for a template ID.

    Pass --official-api to use the Alibaba Cloud FCSandbox GetTemplate API;
    that mode requires configured AccessKey credentials.

    \b
    Examples:
      abx template info tmpl-abc123
      abx template info tmpl-abc123 --official-api
      abx template info tmpl-abc123 --region cn-shanghai
      abx --json template info tmpl-abc123

    \b
    Related commands:
      abx template list
      abx create --template TEMPLATE_ID
      abx template delete TEMPLATE_ID
    `),
  params: [
    argument(["template_id"]),
    option(["--official-api"], {
      is_flag: true,
      default: false,
      help: "Query the template via the official Alibaba Cloud FCSandbox API (AK/SK).",
    }),
    regionOption(),
  ],
  callback: handleErrors(async (ctx: Context, params: Any): Promise<void> => {
    requireTemplateFeature("templates.read");
    const templateId: string = params["template_id"];
    const fmt = getFormatter(ctx);
    const config = templateSeams.loadConfig({ region: params["region"] });

    if (params["official_api"]) {
      if (!(config.access_key_id && config.access_key_secret)) {
        throw new CliError("--official-api requires AccessKey/AccessSecret in the environment.");
      }
      const data = await fcTemplate.getTemplate(templateId, {
        access_key_id: config.access_key_id,
        access_key_secret: config.access_key_secret,
        region: config.region,
      });
      // BUG-09: Format as readable key-value pairs instead of raw dict.
      if (_isDict(data)) {
        fmt.printDict(_stringifyValues(data));
      } else {
        fmt.printData(data);
      }
      return;
    }

    const auth = createAuthProvider({
      api_key: config.api_key,
      access_key_id: config.access_key_id,
      access_key_secret: config.access_key_secret,
    });
    const httpClient = new HttpClient(config, auth);

    let data: Any;
    try {
      const resp = await httpClient.platformRequest("GET", `/templates/${templateId}`);
      data = resp.json();
    } catch (exc) {
      if (exc instanceof HTTPStatusError) {
        throw _translatePlatformError(exc, { context: "Fetching template info", template_id: templateId });
      }
      throw exc;
    } finally {
      await httpClient.close();
    }

    // BUG-09: Format as readable key-value pairs instead of raw dict.
    if (_isDict(data)) {
      fmt.printDict(_stringifyValues(data));
    } else {
      fmt.printData(data);
    }
  }),
});

/** `{str(k): str(v) for k, v in data.items()}` */
function _stringifyValues(data: Record<string, Any>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) result[k] = pyStr(v);
  return result;
}

export const create_template = template.command("from-image", {
  help: cleandoc(`Create a sandbox template from an existing container image.

    Uses the official Alibaba Cloud FCSandbox CreateTemplate API.
    Requires AK/SK credentials (set with 'abx config init --build').

    \b
    Examples:
      abx template from-image registry.cn-hangzhou.aliyuncs.com/ns/repo:tag \\
        --name my-template
      abx template from-image registry.cn-hangzhou.aliyuncs.com/ns/repo:tag \\
        --name my-template --team-id team-xxx --cpu 4 --memory 4096
      abx template from-image registry.cn-hangzhou.aliyuncs.com/ns/repo:tag \\
        --name my-template --envd-inject --generation 1
      abx template from-image registry.cn-hangzhou.aliyuncs.com/ns/repo:tag \\
        --name my-template --region cn-shanghai

    \b
    Related commands:
      abx template push IMAGE       Push a local image to ACR first
      abx template info TEMPLATE_ID Inspect the created template
      abx create --template ID      Launch a sandbox from the template
    `),
  params: [
    argument(["image"]),
    option(["--name", "-n"], { required: true, help: "Template name" }),
    option(["--team-id"], {
      envvar: ["TEAM_ID", "E2B_TEAM_ID"],
      default: null,
      help: "Team ID (or env TEAM_ID / E2B_TEAM_ID; auto-resolved if omitted)",
    }),
    option(["--cpu"], { type: FLOAT, default: 2, help: "CPU cores (default 2)" }),
    option(["--memory"], { type: INT, default: 2048, help: "Memory in MB (default 2048)" }),
    option(["--disk-size"], { type: INT, default: null, help: "Disk size in MB" }),
    option(["--internet-access/--no-internet-access"], {
      default: null,
      help: "Internet access (default: platform decides)",
    }),
    option(["--start-cmd"], { default: null, help: "Container start command" }),
    option(["--ready-cmd"], { default: null, help: "Container readiness check command" }),
    option(["--generation"], {
      type: INT,
      default: null,
      help: "Sandbox generation (default 1). 1=first-gen (rund), 2=second-gen MicroVM.",
    }),
    option(["--force"], {
      is_flag: true,
      default: false,
      help: "If a generation-1 template with this name already exists, delete it and create it again.",
    }),
    option(["--envd-inject/--no-envd-inject"], { default: false, help: "Enable envd injection in build" }),
    option(["--target-image"], {
      default: null,
      help: "Destination image ref for envd copy (auto-derived with random suffix if omitted)",
    }),
    option(["--registry-type"], {
      type: new Choice(["acr", "acree"]),
      default: null,
      help: "Registry type (auto-detected from --acree-instance-id)",
    }),
    option(["--acree-instance-id"], { envvar: "ACREE_INSTANCE_ID", default: null, help: "ACR EE instance ID (cri-...)" }),
    option(["--registry-username"], { default: null, help: "Registry login username (for pulling image)" }),
    option(["--registry-password"], { default: null, help: "Registry login password (for pulling image)" }),
    regionOption(),
  ],
  callback: handleErrors(async (ctx: Context, params: Any): Promise<void> => {
    requireTemplateFeature("templates.build");
    const { image, name, team_id: teamId, cpu, memory, disk_size: diskSize, internet_access: internetAccess } = params;
    const { start_cmd: startCmd, ready_cmd: readyCmd, generation, envd_inject: envdInject, target_image: targetImage } = params;
    const { registry_type: registryType, acree_instance_id: acreeInstanceId } = params;
    const { registry_username: registryUsername, registry_password: registryPassword, region } = params;

    const fmt = getFormatter(ctx);
    const config = templateSeams.loadConfig({ region });

    const ak = config.access_key_id || "";
    const sk = config.access_key_secret || "";
    if (!ak || !sk) {
      fmt.printError("Alibaba Cloud AK/SK credentials required for official CreateTemplate API.", {
        suggestion:
          "Run 'abx config init --build', or " +
          "'abx config set access_key_id' / 'abx config set access_key_secret'. " +
          AKSK_ENV_SUGGESTION,
      });
      sysExit(1);
    }

    const finalRegion: string = config.region;
    const resolvedGeneration: number = generation !== null ? generation : 1;

    // Warn if start/ready commands used without generation 2
    if ((startCmd || readyCmd) && resolvedGeneration !== 2) {
      echo("Warning: --start-cmd / --ready-cmd only take effect with --generation 2 (MicroVM).", { err: true });
    }

    const result = await templateSeams.getOutput(ctx).spinner(`Creating template ${name}`, () =>
      fcTemplate.createOfficialTemplate({
        name,
        image,
        access_key_id: ak,
        access_key_secret: sk,
        region: finalRegion,
        team_id: teamId,
        cpu,
        memory_size: memory,
        disk_size: diskSize,
        internet_access: internetAccess,
        generation: resolvedGeneration,
        start_command: startCmd,
        ready_command: readyCmd,
        force: Boolean(params["force"]),
        envd_inject: envdInject,
        registry_type: registryType,
        acr_instance_id: acreeInstanceId,
        registry_username: registryUsername,
        registry_password: registryPassword,
        target_image: targetImage,
      }),
    );

    const data = {
      TemplateID: _get(result, "templateID", "N/A"),
      RequestID: _get(result, "requestId", "N/A"),
      StatusCode: _get(result, "statusCode", "N/A"),
      Message: pyTruthy(result["message"]) ? result["message"] : "N/A",
    };
    if (fmt.use_json) {
      fmt.printData(data);
    } else {
      fmt.printDict(data);
      const templateId = result["templateID"];
      if (pyTruthy(templateId)) {
        fmt.printSuccess(`Template created! Use: abx create --template ${templateId}`);
      }
    }
  }),
});

export const push = template.command("push", {
  help: cleandoc(`Push a locally-built image to Alibaba Cloud ACR.

    IMAGE is a local image tag (e.g. \`\`python-hello:latest\`\`) produced by
    a local \`\`docker build\`\`.  The repository name and tag are derived from
    IMAGE.  Prints the full ACR image URL on success.

    \b
    Examples:
      abx template push python-hello:latest --acr-namespace my-ns
      abx template push python-hello:latest --acr-namespace my-ns --region cn-shanghai
      abx template push my-tmpl:v1 --acr-namespace prod \\
        --acree-instance-id cri-xxx

    \b
    Related commands:
      abx template build TEMPLATE_DIR  Build, push, and register a template
      abx template from-image IMAGE        Register an existing image
      abx config set access_key_id KEY
    `),
  params: [
    argument(["image"]),
    option(["--acr-registry"], { envvar: "ACR_REGISTRY", default: "registry.cn-hangzhou.aliyuncs.com", help: "ACR registry host" }),
    option(["--acr-namespace"], {
      envvar: "ACR_NAMESPACE",
      required: false,
      default: null,
      help: "ACR namespace (env: ACR_NAMESPACE, or set in .env file)",
    }),
    option(["--acr-username"], {
      envvar: "ACR_USERNAME",
      default: null,
      help: "ACR login username (default: ALICLOUD_ACCESS_KEY_ID)",
    }),
    option(["--acr-password"], {
      envvar: "ACR_PASSWORD",
      default: null,
      help: "ACR login password (default: ALICLOUD_ACCESS_KEY_SECRET)",
    }),
    option(["--acree-instance-id"], { envvar: "ACREE_INSTANCE_ID", default: "", help: "ACR EE instance ID (cri-...)" }),
    regionOption(),
  ],
  callback: handleErrors(async (ctx: Context, params: Any): Promise<void> => {
    requireTemplateFeature("templates.build");
    const image: string = params["image"];
    const fmt = getFormatter(ctx);
    const config = templateSeams.loadConfig({ region: params["region"] });

    // Parse the local image reference into repo name + tag.
    let repoPart: string;
    let imageTag: string;
    if (image.includes(":")) {
      const i = image.lastIndexOf(":");
      repoPart = image.slice(0, i);
      imageTag = image.slice(i + 1);
    } else {
      repoPart = image;
      imageTag = "latest";
    }
    const repoName = repoPart.slice(repoPart.lastIndexOf("/") + 1);

    // Resolve ACR namespace: CLI > env > .env file (CWD, then ~/.abx/.env)
    const resolvedNamespace = _resolveAcrNamespace(params["acr_namespace"]);

    const resolvedUsername = params["acr_username"] || config.access_key_id || "";
    const resolvedPassword = params["acr_password"] || config.access_key_secret || "";
    if (!resolvedUsername || !resolvedPassword) {
      throw new ACRLoginError("ACR credentials missing.", {
        suggestion:
          "Run 'abx config init --build', or " +
          "'abx config set access_key_id' / 'abx config set access_key_secret', " +
          "or pass --acr-username/--acr-password. " +
          AKSK_ENV_SUGGESTION,
      });
    }

    const acr = new ACRConfig({
      registry: params["acr_registry"],
      namespace: resolvedNamespace,
      repo: repoName,
      username: resolvedUsername,
      password: resolvedPassword,
      acree_instance_id: params["acree_instance_id"],
    });

    // Login/tag/push: header plus the last few push lines in grey (or the full log with --verbose; one progress line
    // when there is no TTY).
    const out = templateSeams.getOutput(ctx);
    const reporter = new _StepReporter(out, { verbose: out.verbose });
    let acrRef: string;
    try {
      [acrRef] = await templateSeams._pushImage(image, {
        acr,
        tag: imageTag,
        region: config.region,
        on_progress: (m) => reporter.phase(m),
        on_output: (l) => reporter.log(l),
      });
      reporter.done(`Image pushed to ACR: ${acrRef}`);
    } finally {
      reporter.close();
    }

    const data = { "ACR Image": acrRef, Status: "pushed" };
    if (fmt.use_json) {
      fmt.printData(data);
    } else {
      fmt.printDict(data);
      fmt.printSuccess(`Image pushed to ACR: ${acrRef}`);
    }
  }),
});

export const build = template.command("build", {
  help: cleandoc(`Build Docker image locally, push to ACR, and create a sandbox template.

    Full pipeline with cloud side effects: the local docker build is
    local-only, but the ACR push and the remote template registration
    can incur Alibaba Cloud costs (ACR storage/traffic, template
    resources).

    Publish path (--build, default auto):

    \b
    auto: a Dockerfile publishes that image. Otherwise template.yaml build
      steps are sent as CreateTemplate sandboxConfig.steps.
    dockerfile: local docker build → ACR push → CreateTemplate. template.yaml
      build steps are not sent.
    steps: no local Docker and no ACR push. sandboxConfig.image is base.image
      and sandboxConfig.steps is the expanded build block. Official API only.

    \b
    Registration API:

    \b
    --official-api (default):
      dockerfile mode: local docker build → ACR push → official CreateTemplate API.
      Requires AK/SK credentials (set with 'abx config init --build').

    \b
    --legacy-api:
      local docker build → ACR push → legacy v3/v2 platform API.
      Use --legacy-api to keep the old behaviour.

    Requires Docker daemon running and ACR credentials. In automation/CI,
    pass --acr-namespace and TEMPLATE_DIR explicitly instead of relying
    on ACR_NAMESPACE / ABX_TEMPLATE_DIR environment variables or .env
    files, so the build cannot drift with the surrounding environment.

    \b
    Examples:
      abx template build ./examples/templates/python-hello \\
        --acr-namespace my-ns --acr-repo python-hello
      abx template build ./my-template \\
        --acr-namespace prod --acree-instance-id cri-xxx
      abx template build ./my-template \\
        --acr-namespace prod --disk-size 10240 --internet-access
      abx template build ./my-template \\
        --acr-namespace prod --legacy-api
      abx template build ./my-template --acr-namespace prod --region cn-shanghai
      abx template build ./my-template --build steps --yes

    \b
    Related commands:
      abx template scaffold DIRECTORY    Scaffold template source files
      abx template push IMAGE        Push an existing local image only
      abx create --template ID       Launch the completed template
    `),
  params: [
    argument(["template_dir"], { type: new ClickPath({ exists: true }), envvar: "ABX_TEMPLATE_DIR" }),
    option(["--acr-registry"], { envvar: "ACR_REGISTRY", default: "registry.cn-hangzhou.aliyuncs.com", help: "ACR registry host" }),
    option(["--acr-namespace"], {
      envvar: "ACR_NAMESPACE",
      required: false,
      default: null,
      help: "ACR namespace (env: ACR_NAMESPACE, or set in .env file)",
    }),
    option(["--acr-repo"], {
      envvar: "ACR_REPO",
      default: null,
      help: "ACR repository name (defaults to template.yaml name or dir name)",
    }),
    option(["--acr-username"], {
      envvar: "ACR_USERNAME",
      default: null,
      help: "ACR login username (default: ALICLOUD_ACCESS_KEY_ID)",
    }),
    option(["--acr-password"], {
      envvar: "ACR_PASSWORD",
      default: null,
      help: "ACR login password (default: ALICLOUD_ACCESS_KEY_SECRET)",
    }),
    option(["--acree-instance-id"], { envvar: "ACREE_INSTANCE_ID", default: "", help: "ACR EE instance ID (cri-...)" }),
    option(["--vpc-id"], { envvar: "ACR_VPC_ID", default: "", help: "VPC ID for ACR EE" }),
    option(["--vswitch-ids"], { envvar: "ACR_VSWITCH_IDS", default: "", help: "Comma-separated VSwitch IDs" }),
    option(["--security-group-id"], { envvar: "ACR_SECURITY_GROUP_ID", default: "", help: "Security group ID" }),
    option(["--alias", "-a"], { default: null, help: "Template alias" }),
    option(["--tag", "-t"], { default: "latest", help: "Docker image tag" }),
    option(["--platform"], { default: "linux/amd64", help: "Target platform" }),
    option(["--cpu"], {
      type: INT,
      default: null,
      help: "CPU cores (default: from template.yaml resources.cpu, fallback 2)",
    }),
    option(["--memory"], {
      type: INT,
      default: null,
      help: "Memory in MB (default: from template.yaml resources.memory, fallback 2048)",
    }),
    option(["--start-cmd"], { default: null, help: "Container start command" }),
    option(["--ready-cmd"], { default: null, help: "Container readiness check command" }),
    option(["--timeout"], { type: INT, default: 600, help: "Build timeout in seconds" }),
    option(["--dockerfile", "-f"], { default: null, type: new ClickPath({ exists: true }), help: "Custom Dockerfile path" }),
    option(["--build"], {
      type: new Choice(["auto", "dockerfile", "steps"]),
      default: "auto",
      show_default: true,
      help: "Publish path: auto (Dockerfile if present, otherwise template.yaml build steps), dockerfile, or steps",
    }),
    option(["--disk-size"], { type: INT, default: null, help: "Disk size in MB (official API only)" }),
    option(["--internet-access/--no-internet-access"], {
      default: null,
      help: "Internet access (default: platform decides; official API only)",
    }),
    option(["--official-api/--legacy-api", "use_official"], {
      default: true,
      help: "Use official CreateTemplate API (default) or legacy v3/v2",
    }),
    option(["--team-id"], {
      envvar: ["TEAM_ID", "E2B_TEAM_ID"],
      default: null,
      help: "Team ID for official API (or env TEAM_ID / E2B_TEAM_ID)",
    }),
    option(["--envd-inject/--no-envd-inject"], { default: false, help: "Enable envd injection (default False)" }),
    option(["--generation"], {
      type: INT,
      default: null,
      help:
        "Sandbox generation (default: template.yaml 'generation'; else 2 when the provider starts the server and commands.py exists; else 1). " +
        "1=first-gen (rund), 2=second-gen MicroVM.",
    }),
    option(["--force"], {
      is_flag: true,
      default: false,
      help:
        "If a generation-1 template with this name already exists, delete it and create it again. " +
        "Without --force, deploy stops and prints 'abx template delete <id> -y'.",
    }),
    option(["--target-image"], {
      default: null,
      help: "Destination image ref for envd copy (auto-derived with random suffix if omitted)",
    }),
    option(["--yes", "-y"], { is_flag: true, default: false, help: "Skip confirmation prompt" }),
    option(["-v", "--verbose", "verbose_flag"], { is_flag: true, help: "Verbose output (DEBUG level)" }),
    regionOption(),
  ],
  callback: handleErrors(async (ctx: Context, params: Any): Promise<void> => {
    requireTemplateFeature("templates.build");
    const templateDir: string = params["template_dir"];
    if (params["verbose_flag"]) enableVerbose(ctx);

    const fmt = getFormatter(ctx);
    const out = templateSeams.getOutput(ctx);

    let plan: BuildPlan;
    try {
      plan = resolveBuildPlan(templateDir, { mode: params["build"] ?? "auto", dockerfile: params["dockerfile"] });
    } catch (e) {
      if (e instanceof BuildModeError) throw usageError(e.message);
      throw e;
    }
    const explicitAcr = acrNamespacePassedOnCli();
    if (plan.kind === "steps") {
      if (explicitAcr) throw usageError(STEPS_WITH_ACR);
      if (!params["use_official"]) throw usageError(STEPS_WITH_LEGACY);
    }

    // Resolve ACR namespace: CLI > env > .env file. Platform steps do not push an image.
    const resolvedNamespace = plan.kind === "dockerfile" ? _resolveAcrNamespace(params["acr_namespace"]) : "";
    const yamlDefaults = _readYamlDefaults(templateDir);
    const resolvedRepo: Any = pyTruthy(params["acr_repo"])
      ? params["acr_repo"]
      : pyTruthy(yamlDefaults["name"])
        ? yamlDefaults["name"]
        : nodePath.basename(pyResolve(templateDir));
    const resolvedCpu: number = params["cpu"] !== null ? params["cpu"] : _coerceInt(yamlDefaults["cpu"], 2);
    const resolvedMemory: number = params["memory"] !== null ? params["memory"] : _coerceInt(yamlDefaults["memory"], 2048);
    const runtime = resolveDeployRuntime(templateDir, {
      generation: params["generation"],
      start_cmd: params["start_cmd"],
      ready_cmd: params["ready_cmd"],
    });
    const templateName: Any = params["alias"] || resolvedRepo;

    // Early credential check (before confirmation prompt)
    const config = templateSeams.loadConfig({ region: params["region"] });
    const resolvedAcrUsername = params["acr_username"] || config.access_key_id || "";
    const resolvedAcrPassword = params["acr_password"] || config.access_key_secret || "";
    if (plan.kind === "steps") {
      if (!config.access_key_id || !config.access_key_secret) {
        fmt.printError("Alibaba Cloud credentials missing.", {
          suggestion:
            "Run 'abx config init --build', or 'abx config set access_key_id' / 'abx config set access_key_secret'. " +
            AKSK_ENV_SUGGESTION,
        });
        sysExit(1);
      }
    } else if (!resolvedAcrUsername || !resolvedAcrPassword) {
      fmt.printError("ACR credentials missing.", {
        suggestion:
          "Run 'abx config init --build', or " +
          "'abx config set access_key_id' / 'abx config set access_key_secret', " +
          "or pass --acr-username/--acr-password. " +
          AKSK_ENV_SUGGESTION,
      });
      sysExit(1);
    }

    // Show the resolved configuration so users can see the effective values.
    // `--json` keeps stdout as one object (`TemplateID` included); the summary stays on stderr via progress.
    if (!fmt.use_json) {
      echo(`Template: ${pyStr(templateName)}`);
      if (plan.kind === "steps") {
        echo(`Build mode: steps`);
        echo(`Base image: ${plan.image}`);
        echo(`Platform steps: ${plan.steps.length}`);
      } else {
        echo(`ACR: ${resolvedNamespace}/${pyStr(resolvedRepo)}:${params["tag"]}`);
        if (plan.ignoredSteps) echo(IGNORED_PLATFORM_STEPS);
      }
      echo(`Resources: cpu=${resolvedCpu}, memory=${resolvedMemory}MB, generation=${runtime.generation}`);
      if (runtime.start_cmd) echo(`Start command: ${runtime.start_cmd}`);
    } else if (plan.kind !== "steps" && plan.ignoredSteps) {
      out.warning(IGNORED_PLATFORM_STEPS);
    }

    // Confirmation before destructive cloud operations.
    if (!params["yes"]) {
      if (!templateSeams.stdinIsatty()) {
        throw usageError("Confirmation required for deploying to cloud. " + "Use --yes/-y to skip in non-interactive mode.");
      }
      const prompt =
        plan.kind === "steps"
          ? `\nRegister template '${pyStr(templateName)}' with ${plan.steps.length} platform build steps?`
          : `\nPush image to ${resolvedNamespace}/${pyStr(resolvedRepo)}:${params["tag"]} ` + `and register template '${pyStr(templateName)}'?`;
      await confirm(prompt, { abort: true });
    }

    const data = await templateSeams._doDeploy(templateDir, {
      acr_namespace: resolvedNamespace,
      acr_registry: params["acr_registry"],
      acr_repo: params["acr_repo"],
      acr_username: params["acr_username"],
      acr_password: params["acr_password"],
      acree_instance_id: params["acree_instance_id"],
      vpc_id: params["vpc_id"],
      vswitch_ids: params["vswitch_ids"],
      security_group_id: params["security_group_id"],
      alias: params["alias"],
      tag: params["tag"],
      platform: params["platform"],
      cpu: params["cpu"],
      memory: params["memory"],
      start_cmd: runtime.start_cmd,
      ready_cmd: runtime.ready_cmd,
      timeout: params["timeout"],
      dockerfile: params["dockerfile"],
      disk_size: params["disk_size"],
      internet_access: params["internet_access"],
      use_official: params["use_official"],
      team_id: params["team_id"],
      envd_inject: params["envd_inject"],
      generation: runtime.generation,
      force: Boolean(params["force"]),
      target_image: params["target_image"],
      region: params["region"],
      ctx,
      verbose: out.verbose,
      build: params["build"],
      explicit_acr_namespace: explicitAcr,
    });

    const buildStatus = _get(data, "Status", "unknown");
    const buildLogs: string[] = _get(data, "_build_logs", []);
    delete data["_build_logs"];
    if (fmt.use_json) {
      fmt.printData(data);
    } else {
      fmt.printDict(data);
      if (buildStatus === "ready") {
        fmt.printSuccess("Template built and ready!");
        fmt.printSuccess(`Use: abx create --template ${pyStr(_get(data, "TemplateID", null))}`);
      } else if (_get(data, "Build mode", null) === "steps" && buildStatus === "submitted") {
        fmt.printSuccess("Template registration submitted from platform build steps.");
        fmt.printSuccess(`Use: abx create --template ${pyStr(_get(data, "TemplateID", null))}`);
      } else if (buildStatus === "pushed" || buildStatus === "submitted") {
        fmt.printSuccess("Image pushed to ACR; template registration submitted.");
      } else {
        fmt.printError(`Build status: ${buildStatus}`);
        if (buildLogs.length > 0) {
          for (const log of buildLogs) {
            out.info(`  ${log}`);
          }
        }
      }
    }
  }),
});

export const deploy = template.command("deploy", {
  params: [...build.params],
  help:
    "Build, push, and create template in one step (alias of 'template build').\n\n" +
    "Builds a Docker image locally, pushes it to ACR, and creates a sandbox " +
    "template. The ACR push and the remote template registration are " +
    "cloud-side operations that can incur Alibaba Cloud costs (ACR " +
    "storage/traffic, template resources).\n\n" +
    "Requires AK/SK credentials from 'abx config init --build' " +
    "(access_key_id / access_key_secret). dockerfile mode also needs a Docker " +
    "daemon and an ACR namespace (--acr-namespace, 'abx config set acr_namespace', " +
    "or ACR_NAMESPACE). --build steps skips Docker and ACR. " +
    "--acr-username/--acr-password override the AccessKey used to push.\n\n" +
    "\b\n" +
    "Examples:\n" +
    "  abx template deploy ./examples/templates/python-hello \\\n" +
    "    --acr-namespace my-ns --acr-repo python-hello\n" +
    "  abx template deploy ./my-template --acr-namespace prod --yes\n" +
    "  abx --json template deploy ./my-template -y\n" +
    "    # one JSON object on stdout; the id is the TemplateID field\n\n" +
    "\b\n" +
    "Related commands:\n" +
    "  abx template scaffold DIRECTORY  Scaffold a template project\n" +
    "  abx template list            Verify the registered template\n" +
    "  abx create --template ID     Launch a sandbox from the template",
  callback: async (ctx: Context, params: Any): Promise<void> => {
    await ctx.invoke(build, { ...params });
  },
});

export const delete_ = template.command("delete", {
  help: cleandoc(`Delete a custom template from the remote platform.

    This irreversible operation does not remove the local template cache.
    Confirmation is required unless --yes is supplied.

    \b
    Examples:
      abx template delete tmpl-abc123
      abx template delete tmpl-abc123 --yes --region cn-shanghai

    \b
    Related commands:
      abx template info TEMPLATE_ID  Verify the target before deletion
      abx template list              Confirm the template was removed
      abx template install REF       Reinstall a template
    `),
  params: [
    argument(["template_id"]),
    option(["--yes", "-y"], { is_flag: true, default: false, help: "Skip confirmation prompt" }),
    regionOption(),
  ],
  callback: handleErrors(async (ctx: Context, params: Any): Promise<void> => {
    requireTemplateFeature("templates.build");
    const templateId: string = params["template_id"];
    if (!params["yes"]) {
      if (!templateSeams.stdinIsatty()) {
        throw usageError("Confirmation required for deleting template. " + "Use --yes/-y to skip in non-interactive mode.");
      }
      await confirm(`Delete template '${templateId}'? This action cannot be undone.`, { abort: true });
    }

    const fmt = getFormatter(ctx);

    const config = templateSeams.loadConfig({ region: params["region"] });
    const auth = createAuthProvider({
      api_key: config.api_key,
      access_key_id: config.access_key_id,
      access_key_secret: config.access_key_secret,
    });
    const httpClient = new HttpClient(config, auth);

    try {
      await httpClient.platformRequest("DELETE", `/templates/${templateId}`);
    } catch (exc) {
      if (exc instanceof HTTPStatusError) {
        throw _translatePlatformError(exc, { context: "Deleting template", template_id: templateId });
      }
      throw exc;
    } finally {
      await httpClient.close();
    }

    fmt.printSuccess(`Template ${templateId} deleted.`);
  }),
});

export const search = template.command("search", {
  help: cleandoc(`Search the template catalog by name, tag, or description.

    Queries the template index published in the alibaba-agent-sandbox/awesome-templates
    repository - the single source of truth for official and community
    templates. The fetched index is cached under ~/.abx/index/ and reused for
    up to an hour; on network failures the cached copy is served with a
    warning.

    For private mirrors / higher rate limits a token is taken from --token,
    then the GITHUB_TOKEN environment variable, then ./.env, then the stored
    github_token (in that order); prefer 'abx config set github_token'.

    \b
    Examples:
      abx template search python
      abx template search ai-agent
      abx template search browser --status official
      abx template search qwen --tag deploy
      abx template search python --refresh    # bypass the local cache

    \b
    Related commands:
      abx template install <name>             Install a template by index name
      abx template install owner/repo//subdir[@ref]
      abx template list
    `),
  params: [
    argument(["query"]),
    option(["--tag", "-t"], { default: null, help: "Filter by exact tag name" }),
    option(["--status", "-s"], {
      type: new Choice(["official", "community", "experimental"]),
      default: null,
      help: "Filter by template status",
    }),
    option(["--index-url"], {
      default: null,
      envvar: "ABX_TEMPLATE_INDEX_URL",
      help:
        "Template index location: HTTP(S) URL or local file path " +
        "(env: ABX_TEMPLATE_INDEX_URL; default: the canonical remote index)",
    }),
    option(["--token"], { default: null, envvar: "GITHUB_TOKEN", help: _GITHUB_TOKEN_HELP }),
    option(["--refresh"], {
      is_flag: true,
      default: false,
      help: "Force a re-fetch of the index, ignoring the local cache",
    }),
  ],
  callback: handleErrors(async (ctx: Context, params: Any): Promise<void> => {
    const { query, tag, status, index_url: indexUrl, token, refresh } = params;
    const cfgMod = await _configCmd();
    const resolveGithubToken = cfgMod.resolveGithubToken;

    const fmt = getFormatter(ctx);
    const out = getOutput(ctx);

    const fetch = (active: string | null): Promise<Any> =>
      out.spinner("Fetching the template index", () => fetchIndex(indexUrl, { token: active, force: refresh }));

    const index = await _withGithubRateLimitRetry(fetch, { token: await resolveGithubToken(token), fmt, out });

    if (index.notice) out.warning(index.notice);

    const results = index.filter(query, { tag, status });

    if (results.length === 0) {
      fmt.printSuccess(`No templates matching '${query}'.`);
      return;
    }

    if (fmt.use_json) {
      fmt.printData(
        results.map((entry: Any) => ({
          name: entry.name,
          description: entry.description,
          repo: entry.repo,
          path: entry.path,
          ref: entry.ref,
          tags: [...entry.tags],
          author: entry.author,
          capabilities: [...entry.capabilities],
          status: entry.status,
        })),
      );
      return;
    }

    const headers = ["Name", "Description", "Tags", "Status"];
    const rows = results.map((entry: Any) => [entry.name, entry.description || "N/A", entry.tags.join(", "), entry.status || "N/A"]);
    fmt.printTable(headers, rows);
    if (!fmt.quiet) {
      echo(`\n${results.length} template(s) found.`);
      echo(`Install one with: abx template install <name> (index: ${index.source_url})`);
    }
  }),
});

// ---------------------------------------------------------------------------
// template init — scaffold a new template project
// ---------------------------------------------------------------------------

/** Whether the interactive scaffold-case picker can run here. */
export function _scaffoldPickerAvailable(fmt: Any): boolean {
  if (fmt.use_json || templateSeams.isCiEnv()) return false;
  try {
    return Boolean(templateSeams.stdinIsatty());
  } catch {
    return false;
  }
}

/**
 * Cross-platform arrow-key picker (`@inquirer/prompts` `select`, the Node counterpart of `questionary`).
 *
 * Returns the chosen case name, or `null` when the picker cannot start, so the caller can fall back to the numbered
 * prompt. Cancelling the picker (Ctrl-C) aborts the command instead of silently re-prompting.
 */
export async function _tryArrowCasePicker(cases: Array<[string, string]>): Promise<string | null> {
  let answer: unknown;
  try {
    const inquirer = await import("@inquirer/prompts");
    const choices = cases.map(([c, desc]) => ({ name: `${c.padEnd(12)} ${desc}`, value: c }));
    answer = await inquirer.select({ message: "Select a case", choices, default: (cases[0] as [string, string])[0] });
  } catch (e) {
    const err = e as { name?: string; code?: string };
    if (err && (err.name === "ExitPromptError" || err.name === "AbortPromptError")) throw new Abort();
    // No usable terminal (or a picker failure): fall back to numbered input.
    return null;
  }
  if (answer === null || answer === undefined) {
    // The picker returns nothing when the user cancels with Ctrl-C.
    throw new Abort();
  }
  return String(answer);
}

/**
 * Return whether `value` is a sentence rather than a directory path.
 *
 * A path token (`my-app`, `./my app`, `.`) stays a directory so existing `abx template scaffold [DIRECTORY]` invocations
 * are unchanged. Whitespace or CJK text is a natural-language description. Prefix a directory that contains spaces
 * with `./`.
 */
export function _isNlDescription(value: string): boolean {
  if (value === "." || value === ".." || value.startsWith(".") || value.includes("/") || value.includes("\\")) return false;
  if (/[\s\x1c-\x1f\x85]/u.test(value)) return true;
  return /[\u4e00-\u9fff]/u.test(value);
}

/**
 * Pick a scaffold case interactively.
 *
 * Prefers the cross-platform arrow-key picker; falls back to the previous numbered prompt whenever the picker is
 * unavailable.
 */
export async function _selectScaffoldCase(cases: Array<[string, string]>): Promise<string> {
  const picked = await templateSeams._tryArrowCasePicker(cases);
  if (picked !== null) return picked;
  echo("Available scaffold cases:");
  cases.forEach(([c, desc], idx) => {
    echo(`  ${idx + 1}. ${c.padEnd(12)} ${desc}`);
  });
  const choice = await prompt("Select a case", { type: new IntRange({ min: 1, max: cases.length }), default: 1 });
  return (cases[Number(choice) - 1] as [string, string])[0];
}

export const init = template.command("scaffold", {
  help: cleandoc(`Scaffold a new sandbox template project.

    Creates a ready-to-build template directory with template.yaml,
    Dockerfile, and (depending on the case) a commands.py file.
    Nothing is built, pushed, deployed, or turned into a sandbox.

    When DIRECTORY is omitted a new ./<name> subdirectory is created
    (derived from --name, the scaffold case, or the fetched template).

    --prompt requests natural-language template generation; DIRECTORY always
    names a directory. Template generation (Qwen Code, needs 'abx config init --llm')
    writes Dockerfile, commands.py (the HTTP server) and template.yaml into
    ./<name>/ and stops. An interactive
    terminal is asked for that directory first (Enter keeps ./<name>/).
    A path token (my-app, ./my app) stays a directory.

    --adopt adapts a project that already has source code and no template
    files. Template generation sees a copy, and only Dockerfile, commands.py,
    template.yaml and a generated .dockerignore are written back, after you
    confirm. Nothing is built or deployed.

    \b
    Examples:
      abx template scaffold --list                     # List built-in cases
      abx template scaffold -t python                  # Creates ./python/
      abx template scaffold -t python --name myapp     # Creates ./myapp/
      abx template scaffold -t python ./my-template    # Explicit directory
      abx template scaffold --from owner/repo          # Creates ./<template-name>/
      abx template scaffold --prompt "a python data science env"  # generate files only, no build
      abx template scaffold -y --prompt "a node.js api server"    # non-interactive generation
      abx template scaffold --adopt . --hint "port 8080" # adapt this project
      abx template scaffold --adopt ./app --dry-run      # show what would be sent

    \b
    Related commands:
      abx template deploy DIRECTORY
      abx template install TEMPLATE_REF
      abx create --template TEMPLATE
      abx create --prompt "DESCRIPTION"   # generate, build, deploy, and create
    `),
  params: [
    argument(["directory"], { default: null, required: false, type: new ClickPath() }),
    option(["--prompt"], { default: null, help: "Generate a template from a natural-language description" }),
    option(["--template", "-t", "case"], { default: null, help: "Built-in scaffold case (python, node, minimal)" }),
    option(["--from", "from_ref"], {
      default: null,
      help: "Fetch template source from a registry ref (owner/repo, local path)",
    }),
    option(["--name"], { default: null, help: "Template name (default: case name, or fetched template name)" }),
    option(["--list", "list_cases"], { is_flag: true, default: false, help: "List available scaffold cases" }),
    option(["--force"], { is_flag: true, default: false, help: "Overwrite existing files" }),
    option(["--adopt"], {
      is_flag: true,
      default: false,
      help:
        "Adapt an existing source project: template generation adds the template files " +
        "(Dockerfile, commands.py, template.yaml). DIRECTORY is the project (default: .).",
    }),
    option(["--hint"], {
      default: null,
      help: "With --adopt: what the code cannot tell the generator (ports, services).",
    }),
    option(["--dry-run"], {
      is_flag: true,
      default: false,
      help: "With --adopt: list what would be sent to the model. Nothing is sent or written.",
    }),
    option(["-v", "--verbose", "verbose_flag"], { is_flag: true, help: "Verbose output (DEBUG level)" }),
    option(["--yes", "-y"], {
      is_flag: true,
      default: false,
      help:
        "Skip confirmation prompts: the template directory, description " +
        "clarification, and (with --adopt) the send and write prompts. Required for " +
        "non-interactive template generation. " +
        "Does not build or deploy. Replacing an existing Dockerfile still needs --force " +
        "when there is no interactive preview.",
    }),
    option(["--model"], {
      default: null,
      help:
        "Model id for natural-language generation. Overrides llm_model for this command. " +
        "An interactive terminal offers coding and chat models with the arrow keys when the chosen id does not exist.",
    }),
  ],
  callback: handleErrors(async (ctx: Context, params: Any): Promise<void> => {
    const directory: string | null = params["directory"];
    const { case: caseName0, from_ref: fromRef, list_cases: listCases, force, adopt, hint, yes } = params;
    const dryRun: boolean = params["dry_run"];
    let caseName: string | null = caseName0;
    let name: string | null = params["name"];

    const fmt = getFormatter(ctx);
    const out = getOutput(ctx);

    if (adopt || hint !== null || dryRun) {
      if (!adopt) throw usageError("--hint and --dry-run require --adopt.");
      if (caseName || fromRef || listCases) {
        throw usageError("--adopt cannot be combined with --template/-t, --from or --list.");
      }
      const adoptMod: Any = await _lazyModule("./_adopt.js");
      await adoptMod.runAdopt(ctx, directory, {
        hint,
        name,
        dry_run: dryRun,
        force,
        yes,
        verbose: params["verbose_flag"],
      });
      return;
    }

    // --list: print available cases and exit
    if (listCases) {
      const cases = availableCases();
      if (fmt.use_json) {
        fmt.printData(cases.map(([c, d]) => ({ case: c, description: d })));
      } else {
        for (const [c, desc] of cases) {
          echo(`  ${c.padEnd(12)} ${desc}`);
        }
      }
      return;
    }

    // --template and --from are mutually exclusive
    if (caseName && fromRef) {
      throw usageError("--template/-t and --from are mutually exclusive. Use one or the other.");
    }

    // A sentence is a description, not a directory name. Generate the template files and stop — no build, push, deploy,
    // or sandbox.
    if (params["prompt"] !== null) {
      if (caseName || fromRef) {
        throw usageError(
          "A natural-language description cannot be combined with " +
            "--template/-t or --from. Drop those flags to generate a " +
            "template from the description, or drop the description to " +
            "scaffold or fetch a template.",
        );
      }
      const sandboxMod: Any = await _lazyModule("./sandbox.js");
      const generate = sandboxMod._generateLocalTemplate;
      await generate(ctx, params["prompt"], { yes, name, force, ask_directory: true, model: params["model"], ...(directory ? { directory } : {}) });
      return;
    }

    // Whether the user explicitly provided a DIRECTORY argument
    const dirProvided = directory !== null;

    // --from: fetch from registry and copy source files into DIR
    if (fromRef) {
      const cfgMod = await _configCmd();
      const resolveGithubToken = cfgMod.resolveGithubToken;

      const fetchFrom = async (active: string | null): Promise<[Any, string]> => {
        const client = new RegistryClient("https://github.com", active);
        const ref = await client.resolve(fromRef);
        if (ref.is_builtin) {
          throw usageError(
            `'${fromRef}' is a built-in template and cannot be used with --from. ` + "Use -t/--template for built-in cases.",
          );
        }
        return [ref, await out.spinner(`Fetching template from ${fromRef}`, () => client.fetch(ref))];
      };

      const [ref, sourcePath] = await _withGithubRateLimitRetry(fetchFrom, { token: await resolveGithubToken(), fmt, out });

      const source = String(sourcePath);

      // A local directory with no manifest is a source project, not a template. Copying it would also copy .env and
      // .git. Remote refs stay tolerant.
      if ((ref.registry_type ?? "") === "local" && _findTemplateYaml(source) === null) {
        throw new CliError(
          `'${fromRef}' has no template.yaml, so it is not a template. ` + `To adapt a source project, run: abx template scaffold --adopt ${fromRef}`,
        );
      }

      // Derive name: --name > template.yaml name > ref basename
      if (name === null) {
        const yamlPath = _findTemplateYaml(source);
        if (yamlPath) {
          const tmpl = loadTemplateFromYaml(yamlPath);
          name = tmpl.name || "";
        }
        if (!name) {
          // Fallback: repo basename or last path component
          if (ref.path) {
            const stripped = (ref.path as string).replace(/\/+$/, "");
            name = stripped.slice(stripped.lastIndexOf("/") + 1);
          } else {
            name = ref.repo || nodePath.basename(fromRef);
          }
        }
      }
      if (!name) throw new Error("");

      // Resolve target directory
      const target = dirProvided ? pyResolve(directory as string) : pyJoin(process.cwd(), name);

      mkdirParents(target);
      // Check for conflicts
      if (!force) {
        const conflicts = scandirNames(source).filter((f) => pathExists(pyJoin(target, f)));
        if (conflicts.length > 0) {
          throw new CliError(`Files already exist in ${target}: ${conflicts.slice(0, 5).join(", ")}. ` + "Use --force to overwrite.");
        }
      }
      pyCopytree(source, target);
      out.info(`Template files copied from ${fromRef} to ${target}`);
      const created = fs
        .readdirSync(target)
        .filter((f) => isFile(nodePath.join(target, f)));
      _printInitSummary(fmt, out, target, created, name);
      return;
    }

    // Interactive selection when no --template/--from given
    if (caseName === null) {
      const cases = availableCases();
      if (templateSeams._scaffoldPickerAvailable(fmt)) {
        caseName = await _selectScaffoldCase(cases);
      } else {
        const caseNames = cases.map(([c]) => c).join(", ");
        throw usageError(`No scaffold case specified. Available cases: ${caseNames}. ` + "Use -t/--template <case> or --from <ref>.");
      }
    }

    // Derive name: --name > case name > "my-template"
    if (name === null) {
      name = caseName || "my-template";
    }

    // Resolve target directory
    const target = dirProvided ? pyResolve(directory as string) : pyJoin(process.cwd(), name);

    // Render scaffold files
    let files: Map<string, string>;
    try {
      files = renderScaffold(caseName as string, name);
    } catch (exc) {
      if (exc instanceof ValueError) throw usageError(exc.message);
      throw exc;
    }

    // Check for conflicts
    mkdirParents(target);
    if (!force) {
      const conflicts = [...files.keys()].filter((fn) => pathExists(pyJoin(target, fn)));
      if (conflicts.length > 0) {
        throw new CliError(`Files already exist in ${target}: ${conflicts.join(", ")}. ` + "Use --force to overwrite.");
      }
    }

    // Write files
    for (const [filename, content] of files) {
      writeTextPy(pyJoin(target, filename), content);
    }

    _printInitSummary(fmt, out, target, [...files.keys()], name);
  }),
});

/** Print a friendly summary after scaffold init. */
export function _printInitSummary(
  fmt: Any,
  out: Any,
  target: string,
  created: string[],
  name: string,
  opts: {
    replaced?: string[] | null;
    backed_up?: string[] | null;
    not_applied?: string[] | null;
    dry_run?: boolean;
    next_steps?: string[] | null;
  } = {},
): void {
  const { replaced = null, backed_up = null, not_applied = null, dry_run = false, next_steps = null } = opts;
  if (fmt.use_json) {
    const payload: Record<string, Any> = { name, directory: String(target), files: created };
    if (replaced !== null) payload["replaced"] = replaced;
    if (backed_up !== null) payload["backed_up"] = backed_up;
    if (not_applied !== null) payload["not_applied"] = not_applied;
    if (dry_run) payload["dry_run"] = true;
    fmt.printData(payload);
    return;
  }
  const title = dry_run ? "previewed" : "created";
  out.info(`\n\u2705 Template '${name}' ${title} in ${target}`);
  out.info("Created files:");
  for (const filename of [...created].sort(_codePointCompare)) {
    out.info(`  ${filename}`);
  }
  if (replaced && replaced.length > 0) {
    out.info("Replaced files:");
    for (const filename of replaced) {
      out.info(`  ${filename}`);
    }
  }
  if (backed_up && backed_up.length > 0) {
    out.info("Backups:");
    for (const filename of backed_up) {
      out.info(`  ${filename}`);
    }
  }
  if (not_applied && not_applied.length > 0) {
    out.info("Generated changes not applied:");
    for (const filename of not_applied) {
      out.info(`  ${filename}`);
    }
  }
  out.info("\nNext steps:");
  if (next_steps !== null) {
    for (const step of next_steps) {
      out.info(`  ${step}`);
    }
    return;
  }
  const dirArg = String(target) !== process.cwd() ? String(target) : ".";
  out.info(`  abx template deploy ${dirArg} -y`);
  out.info("  # ACR namespace: ACR_NAMESPACE, 'abx config set acr_namespace', or --acr-namespace");
}

/** Python `sorted()` order for strings (code point order, not UTF-16 unit order). */
function _codePointCompare(a: string, b: string): number {
  const ca = Array.from(a);
  const cb = Array.from(b);
  const n = Math.min(ca.length, cb.length);
  for (let i = 0; i < n; i++) {
    const x = (ca[i] as string).codePointAt(0) as number;
    const y = (cb[i] as string).codePointAt(0) as number;
    if (x !== y) return x - y;
  }
  return ca.length - cb.length;
}
