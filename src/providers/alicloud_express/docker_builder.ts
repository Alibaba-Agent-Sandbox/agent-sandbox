/**
 * Local Docker build and ACR push utilities (port of `agent_sandbox/api/docker_builder.py`, client-sdk version).
 *
 * Provides a high-level {@link DockerBuilder} that orchestrates:
 *
 * 1. Building a Docker image locally (`docker build`)
 * 2. Logging into Alibaba Cloud ACR
 * 3. Tagging and pushing the image to ACR
 * 4. Creating a sandbox template via the v3/v2 Platform API (or the official FCSandbox CreateTemplate API)
 *
 * Differences from Python that are inherent to Node: every Docker operation returns a Promise (child processes cannot
 * block the event loop while streaming lines to `on_output`), and the SDK-wheel helper follows the split SDK:
 * the container-side runtime is the `agent-sandbox-server` distribution.
 */

import { spawn } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, copyFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

import { materializeBaseImage } from "../../utils/base_image.js";
import { SERVER_SDK_RELEASE_SPEC, SERVER_SDK_RELEASE_VERSION } from "../../utils/server_sdk_pin.js";

import { ACRLoginError, ACRPushError, DockerBuildError } from "../../models/errors.js";
import { AsyncClient, HTTPError, asyncWith } from "../../transport/_httpx.js";
import { getLogger } from "../../utils/logging.js";
import { createOfficialTemplate } from "./fc_template.js";
import { OSError } from "../../utils/_pyos.js";
import { pyStr } from "../../utils/_pyformat.js";
import { ValueError, dictGet, pyExcStr } from "../../utils/_pyerrors.js";

const logger = getLogger("api.docker_builder");

const _WHEEL_NAME = /^[A-Za-z0-9._+-]+\.whl$/;

function resolvedDockerfile(context: string, dockerfile: string | null | undefined): string {
  if (!dockerfile) return join(context, "Dockerfile");
  return isAbsolute(dockerfile) ? dockerfile : join(context, dockerfile);
}

/** Preserve supported explicit server requirements unless a local source override is requested. */
export function contextHasPinnedServerRequirement(context: string, dockerfile: string | null = null): boolean {
  const source = resolvedDockerfile(context, dockerfile);
  if (!existsSync(source)) return false;
  try {
    const text = readFileSync(source, "utf8");
    return text.split(/[\s"']+/).includes(SERVER_SDK_RELEASE_SPEC);
  } catch {
    return false;
  }
}

async function _injectOrKeepPin(
  context: string,
  dockerfile: string | null,
  progress: (msg: string) => void,
  step: string,
): Promise<string[]> {
  if (!process.env[SERVER_SDK_SOURCE_ENV] && contextHasPinnedServerRequirement(context, dockerfile)) {
    progress(`${step} Using the Dockerfile's pinned agent-sandbox-server requirement`);
    return [];
  }
  progress(`${step} Injecting SDK wheel into build context...`);
  const injected = await DockerBuilder.injectSdkWheel(context, null, dockerfile);
  if (injected.length) progress(`  Injected ${injected.length} wheel(s)`);
  else progress("  No SDK wheel injected (may install from PyPI)");
  return injected;
}

function contextWheelNames(context: string): string[] {
  try {
    return readdirSync(context).filter((name) => _WHEEL_NAME.test(name)).sort();
  } catch {
    return [];
  }
}

interface ShellWord {
  value: string;
  start: number;
  end: number;
  operator?: boolean;
}

/** Token offsets let requirement edits retain original quoting, commands and continuations. */
function shellWords(source: string, escape: string): ShellWord[] {
  const words: ShellWord[] = [];
  let i = 0;
  while (i < source.length) {
    if (/\s/.test(source[i]!)) { i++; continue; }
    if (source[i] === "#") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (source[i] === escape && /\r?\n/.test(source.slice(i + 1, i + 3))) {
      i += source[i + 1] === "\r" ? 3 : 2;
      continue;
    }
    const start = i;
    if (";&|()".includes(source[i]!)) {
      words.push({ value: source[i++]!, start, end: i, operator: true });
      continue;
    }
    let value = "";
    let quote = "";
    while (i < source.length) {
      const ch = source[i]!;
      if (!quote && (/\s/.test(ch) || ";&|()".includes(ch))) break;
      if (ch === quote) { quote = ""; i++; continue; }
      if (!quote && (ch === "'" || ch === '"')) { quote = ch; i++; continue; }
      if (quote !== "'" && (ch === "\\" || ch === escape) && source[i + 1] === "\n") { i += 2; continue; }
      if (quote !== "'" && (ch === "\\" || ch === escape) && source.slice(i + 1, i + 3) === "\r\n") { i += 3; continue; }
      if (quote !== "'" && ch === "\\" && i + 1 < source.length) { value += source[i + 1]; i += 2; continue; }
      value += ch;
      i++;
    }
    if (quote) return []; // Leave unsupported/malformed shell quoting alone.
    words.push({ value, start, end: i });
  }
  return words;
}

/** Rewrite real direct pip invocations, never echoed/commented requirements or other packages. */
function rewriteServerRequirements(source: string, wheels: readonly string[], escape: string): string {
  const words = shellWords(source, escape);
  const edits: Array<{ start: number; end: number; value: string }> = [];
  let commandStart = true;
  let pipInstall = false;
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const keyword = commandStart && !/["'\\]/.test(source[word.start]!) &&
      ["if", "then", "else", "elif", "do", "!"].includes(word.value);
    if (word.operator || keyword) {
      commandStart = true;
      pipInstall = false;
      continue;
    }
    if (commandStart) {
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word.value) || word.value.startsWith("--")) continue;
      let pip = i;
      if (/^python(?:\d+(?:\.\d+)*)?$/.test(word.value) && words[i + 1]?.value === "-m") pip += 2;
      pipInstall = /^(?:pip|pip3)$/.test(words[pip]?.value ?? "") && words[pip + 1]?.value === "install";
      commandStart = false;
      if (pipInstall) i = pip + 1;
      continue;
    }
    if (!pipInstall) continue;
    if (wheels.length && word.value === SERVER_SDK_RELEASE_SPEC) {
      edits.push({ start: word.start, end: word.end, value: wheels.map((name) => `/tmp/${name}`).join(" ") });
    } else if (!wheels.length && word.value === "agent-sandbox-server") {
      edits.push({ start: word.start, end: word.end, value: `"${SERVER_SDK_RELEASE_SPEC}"` });
    }
  }
  for (const edit of edits.reverse()) source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
  return source;
}

/**
 * Materialize SDK installation without inserting Docker instructions inside shell RUN bodies.
 * Exact wheel COPY instructions precede the complete RUN; only its server requirement changes.
 * No-wheel builds drop a top-level empty wheel glob and pin only a bare server package operand.
 * Heredocs and exec-form instructions are retained verbatim rather than guessed at.
 */
export function rewriteDockerfileForServerInstall(text: string, wheelNames: readonly string[]): string {
  const wheels = wheelNames.filter((name) => _WHEEL_NAME.test(name));
  const lines = text.split("\n");
  let escape = "\\";
  for (const line of lines) {
    const directive = /^\s*#\s*(syntax|escape|check)\s*=\s*(.*?)\s*$/i.exec(line);
    if (!directive) break;
    if (directive[1]!.toLowerCase() === "escape") escape = directive[2]!;
  }
  const output: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const first = lines[i]!;
    const instruction = /^\s*([A-Za-z]+)\s+(.*)/.exec(first);
    if (!instruction) { output.push(first); continue; }
    const block = [first];
    let continued = first.trimEnd().endsWith(escape);
    while (continued && i + 1 < lines.length) {
      const next = lines[++i]!;
      block.push(next);
      if (!next.trim() || /^\s*#/.test(next)) continue;
      continued = next.trimEnd().endsWith(escape);
    }
    const original = block.join("\n");
    const kind = instruction[1]!.toUpperCase();
    const heredocs = ["RUN", "COPY", "ADD"].includes(kind) ? shellWords(original, escape).flatMap((word) => {
      const match = /^<<(-?)\s*(["']?)([A-Za-z_][A-Za-z0-9_]*)\2(?=\s|$)/.exec(original.slice(word.start));
      return match ? [match] : [];
    }) : [];
    if (heredocs.length) {
      output.push(original);
      for (const match of heredocs) {
        while (i + 1 < lines.length) {
          const next = lines[++i]!;
          output.push(next);
          const delimiter = match[1] ? next.replace(/^\t+/, "") : next;
          if (delimiter.replace(/\r$/, "") === match[3]) break;
        }
      }
      continue;
    }
    if (!wheels.length && kind === "COPY" && /^\s*COPY\s+\*\.whl(?:\s|$)/i.test(original)) continue;
    if (kind !== "RUN" || instruction[2]!.trimStart().startsWith("[")) { output.push(original); continue; }
    const prefix = /^\s*RUN\s+/i.exec(original)![0];
    const rewritten = prefix + rewriteServerRequirements(original.slice(prefix.length), wheels, escape);
    if (rewritten !== original && wheels.length) {
      for (const wheel of wheels) output.push(`COPY ${wheel} /tmp/${wheel}${first.endsWith("\r") ? "\r" : ""}`);
    }
    output.push(rewritten);
  }
  return output.join("\n");
}

/** Fill `<region>` / `<tag>` and the server install so `docker build` does not need BuildKit. */
function materializedDockerfile(context: string, dockerfile: string | null): string | null {
  const source = resolvedDockerfile(context, dockerfile);
  if (!existsSync(source)) return dockerfile;
  let text = readFileSync(source, "utf8");
  const original = text;
  text = materializeBaseImage(text);
  text = rewriteDockerfileForServerInstall(text, contextWheelNames(context));
  if (text === original) return dockerfile;
  const out = join(context, "Dockerfile.abx-build");
  writeFileSync(out, text);
  return out;
}

const _SDK_DIST_NAME = "agent-sandbox-server";
const _PYPI_RELEASE_URL = "https://pypi.org/pypi/{name}/{version}/json";

/** Environment variable naming an explicit `server-sdk` source tree to build the injected wheel from. */
export const SERVER_SDK_SOURCE_ENV = "ABX_SERVER_SDK_SOURCE";
/** Environment variable overriding the `agent-sandbox-server` version downloaded from PyPI. */
export const SERVER_SDK_VERSION_ENV = "ABX_SERVER_SDK_VERSION";

export interface ACRConfigInit {
  registry?: string;
  namespace?: string;
  repo?: string;
  username?: string;
  password?: string;
  acree_instance_id?: string;
  vpc_id?: string;
  vswitch_ids?: string;
  security_group_id?: string;
}

/**
 * Alibaba Cloud ACR configuration.
 *
 * Attributes: registry (ACR registry host), namespace, repo, username (typically the AccessKey ID), password
 * (typically the AccessKey Secret), acree_instance_id (ACR EE instance ID, `cri-...`), vpc_id, vswitch_ids
 * (comma-separated), security_group_id.
 */
export class ACRConfig {
  registry: string;
  namespace: string;
  repo: string;
  username: string;
  password: string;
  acree_instance_id: string;
  vpc_id: string;
  vswitch_ids: string;
  security_group_id: string;

  constructor(init: ACRConfigInit = {}) {
    this.registry = init.registry ?? "registry.cn-hangzhou.aliyuncs.com";
    this.namespace = init.namespace ?? "";
    this.repo = init.repo ?? "";
    this.username = init.username ?? "";
    this.password = init.password ?? "";
    this.acree_instance_id = init.acree_instance_id ?? "";
    this.vpc_id = init.vpc_id ?? "";
    this.vswitch_ids = init.vswitch_ids ?? "";
    this.security_group_id = init.security_group_id ?? "";
  }

  /** Full image reference without tag (e.g. `registry/ns/repo`). */
  get full_image_ref(): string {
    return `${this.registry}/${this.namespace}/${this.repo}`;
  }

  /** Full image reference with tag. */
  tagged_ref(tag = "latest"): string {
    return `${this.full_image_ref}:${tag}`;
  }

  /**
   * VPC-internal registry address for ACR EE.
   *
   * Replaces `registry.` with `-vpc.` in the registry host and switches to `.cr.aliyuncs.com` suffix for ACR EE format.
   */
  vpc_registry(): string {
    return this.registry.replaceAll("registry.", "").replaceAll(".aliyuncs.com", ".cr.aliyuncs.com");
  }

  /**
   * Generate platform API headers for ACR integration.
   *
   * These headers are required by `POST /v2/templates/{tpl}/builds/{build}` to tell the FC backend where the source
   * image lives. `build_mode`: `"builder"` (injects envd) or `"direct"` (uses image as-is). `image_tag` is the tag for
   * Dest-Image-Ref (FC requires a tag).
   */
  to_platform_headers(build_mode = "direct", image_tag = "latest"): Record<string, string> {
    const registry_type = this.acree_instance_id ? "acree" : "acr";
    const headers: Record<string, string> = {
      "X-E2B-Template-Build-Mode": build_mode,
      "X-E2B-Template-Source-Registry-Type": registry_type,
    };
    if (this.full_image_ref) {
      headers["X-E2B-Template-Dest-Image-Ref"] = this.tagged_ref(image_tag);
    }
    if (this.username) headers["X-E2B-Template-Source-Username"] = this.username;
    if (this.password) headers["X-E2B-Template-Source-Password"] = this.password;
    if (this.acree_instance_id) headers["X-E2B-Template-Source-ACREE-Instance-ID"] = this.acree_instance_id;
    if (this.vpc_id) headers["X-E2B-Template-Source-VPC-ID"] = this.vpc_id;
    if (this.vswitch_ids) headers["X-E2B-Template-Source-VSwitch-IDs"] = this.vswitch_ids;
    if (this.security_group_id) headers["X-E2B-Template-Source-Security-Group-ID"] = this.security_group_id;
    return headers;
  }
}

export interface BuildResultInit {
  local_tag?: string;
  acr_ref?: string;
  template_id?: string;
  build_id?: string;
  build_status?: string;
  logs?: string[];
}

/** Result of a local Docker build + ACR push + template creation. */
export class BuildResult {
  local_tag: string;
  acr_ref: string;
  template_id: string;
  build_id: string;
  build_status: string;
  logs: string[];

  constructor(init: BuildResultInit = {}) {
    this.local_tag = init.local_tag ?? "";
    this.acr_ref = init.acr_ref ?? "";
    this.template_id = init.template_id ?? "";
    this.build_id = init.build_id ?? "";
    this.build_status = init.build_status ?? "unknown";
    this.logs = init.logs ?? [];
  }

  get success(): boolean {
    return ["ready", "building", "pushed"].includes(this.build_status);
  }
}

/**
 * Join `cmd` for a log line, hiding `--build-arg` values.
 *
 * The subprocess still receives the real arguments. Only the info log is rewritten, so a verbose CLI cannot print
 * registry passwords or other build secrets.
 */
export function _redactedArgv(cmd: string[]): string {
  const redacted: string[] = [];
  let hide_next = false;
  for (const part of cmd) {
    if (hide_next) {
      const key = part.split("=", 1)[0] as string;
      redacted.push(`${key}=***`);
      hide_next = false;
      continue;
    }
    if (part === "--build-arg") {
      redacted.push(part);
      hide_next = true;
      continue;
    }
    if (part.startsWith("--build-arg=")) {
      const payload = part.slice(part.indexOf("=") + 1);
      const key = payload.split("=", 1)[0] as string;
      redacted.push(`--build-arg=${key}=***`);
      continue;
    }
    redacted.push(part);
  }
  return redacted.join(" ");
}

// ---------------------------------------------------------------------------
// subprocess helpers (Python `subprocess.run` / `Popen` equivalents)
// ---------------------------------------------------------------------------

/** Raised when a spawned command exceeds its timeout (Python `subprocess.TimeoutExpired`). */
export class TimeoutExpired extends Error {
  constructor(
    public readonly cmd: string[],
    public readonly timeout: number,
  ) {
    super(`Command '${cmd.join(" ")}' timed out after ${timeout} seconds`);
    this.name = "TimeoutExpired";
  }
}

export function isFileNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT";
}

interface RunResult {
  returncode: number;
  stdout: string;
  stderr: string;
}

/**
 * `true` when `docker build` can take buildx-only flags (`--provenance`, `--progress=plain`).
 * `DOCKER_BUILDKIT=0` forces the legacy builder. A missing `buildx` plugin is also the legacy builder.
 */
export async function dockerBuildxAvailable(docker = "docker"): Promise<boolean> {
  if ((process.env["DOCKER_BUILDKIT"] ?? "1") === "0") return false;
  try {
    const result = await runCaptured([docker, "buildx", "version"], { timeout: 10 });
    return result.returncode === 0;
  } catch (err) {
    if (isFileNotFound(err) || err instanceof TimeoutExpired) return false;
    throw err;
  }
}

/** `subprocess.run(cmd, input=..., capture_output=True, text=True, timeout=...)`. Rejects with ENOENT / TimeoutExpired. */
export function runCaptured(cmd: string[], opts: { input?: string; timeout: number }): Promise<RunResult> {
  return new Promise<RunResult>((resolvePromise, reject) => {
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const child = spawn(cmd[0] as string, cmd.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new TimeoutExpired(cmd, opts.timeout)));
    }, opts.timeout * 1000);
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));
    child.on("error", (e) => finish(() => reject(e)));
    child.on("close", (code) => {
      finish(() =>
        resolvePromise({
          returncode: code ?? -1,
          stdout: Buffer.concat(out).toString("utf8"),
          stderr: Buffer.concat(err).toString("utf8"),
        }),
      );
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(opts.input ?? "");
  });
}

/** Splits a text stream into lines the way Python's universal-newline text mode does (`\n`, `\r\n`, `\r`). */
class LineSplitter {
  private buf = "";
  private heldCr = false;

  feed(text: string): string[] {
    let s = this.buf + text;
    this.buf = "";
    const lines: string[] = [];
    let start = 0;
    let i = 0;
    if (this.heldCr) {
      // previous chunk ended with "\r"; swallow a following "\n"
      this.heldCr = false;
      if (s.startsWith("\n")) {
        start = 1;
        i = 1;
      }
    }
    for (; i < s.length; i++) {
      const c = s[i];
      if (c === "\n") {
        lines.push(s.slice(start, i));
        start = i + 1;
      } else if (c === "\r") {
        if (i + 1 < s.length) {
          lines.push(s.slice(start, i));
          start = s[i + 1] === "\n" ? i + 2 : i + 1;
          if (s[i + 1] === "\n") i++;
        } else {
          lines.push(s.slice(start, i));
          start = i + 1;
          this.heldCr = true;
        }
      }
    }
    this.buf = s.slice(start);
    s = "";
    return lines;
  }

  flush(): string[] {
    const rest = this.buf;
    this.buf = "";
    return rest ? [rest] : [];
  }
}

/**
 * `Popen(cmd, stdout=PIPE, stderr=STDOUT, text=True)` + iterating lines.
 *
 * Calls `onLine` with every output line (right-stripped, as `line.rstrip()`), resolves with the exit code. Rejects with
 * the spawn error (e.g. ENOENT).
 */
function streamLines(cmd: string[], onLine: (line: string) => void): Promise<number> {
  return new Promise<number>((resolvePromise, reject) => {
    const child = spawn(cmd[0] as string, cmd.slice(1), { stdio: ["inherit", "pipe", "pipe"] });
    const splitters = [new LineSplitter(), new LineSplitter()];
    const decoders = [new TextDecoder(), new TextDecoder()];
    const emit = (lines: string[]): void => {
      for (const l of lines) onLine(l.trimEnd());
    };
    child.stdout.on("data", (d: Buffer) => emit((splitters[0] as LineSplitter).feed((decoders[0] as InstanceType<typeof TextDecoder>).decode(d, { stream: true }))));
    child.stderr.on("data", (d: Buffer) => emit((splitters[1] as LineSplitter).feed((decoders[1] as InstanceType<typeof TextDecoder>).decode(d, { stream: true }))));
    child.on("error", reject);
    child.on("close", (code) => {
      emit((splitters[0] as LineSplitter).flush());
      emit((splitters[1] as LineSplitter).flush());
      resolvePromise(code ?? -1);
    });
  });
}

// ---------------------------------------------------------------------------
// Server-SDK version
// ---------------------------------------------------------------------------

/** Python runtime version is independent of the CLI package version. */
export function serverSdkVersion(): string {
  return process.env[SERVER_SDK_VERSION_ENV] || SERVER_SDK_RELEASE_VERSION;
}

function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

// ---------------------------------------------------------------------------
// Internal seams (mirrors of module-level functions the Python tests patch)
// ---------------------------------------------------------------------------

export const _seams = {
  getAcrAuthTokenPersonal: (...a: Parameters<typeof _getAcrAuthTokenPersonal>) => _getAcrAuthTokenPersonal(...a),
  getAcrAuthTokenEe: (...a: Parameters<typeof _getAcrAuthTokenEe>) => _getAcrAuthTokenEe(...a),
};

export interface BuildOptions {
  dockerfile?: string | null;
  platform?: string;
  build_args?: Record<string, string> | null;
  on_output?: ((line: string) => void) | null;
}

export interface LoginAkSkOptions {
  region?: string;
  instance_id?: string | null;
}

export interface BuildAndRegisterOfficialOptions {
  name?: string | null;
  tag?: string;
  platform?: string;
  dockerfile?: string | null;
  cpu_count?: number;
  memory_mb?: number;
  disk_size?: number | null;
  internet_access?: boolean | null;
  start_cmd?: string | null;
  ready_cmd?: string | null;
  envd_inject?: boolean;
  generation?: number;
  team_id?: string | null;
  region?: string;
  on_progress?: ((msg: string) => void) | null;
  acr_access_key_id?: string | null;
  acr_access_key_secret?: string | null;
  api_access_key_id?: string | null;
  api_access_key_secret?: string | null;
  timeout?: number;
}

/**
 * Orchestrates local Docker build -> ACR push -> template registration.
 *
 * Docker operations spawn the `docker` CLI; they are Promise-returning here (the Python version blocked on subprocess).
 */
export class DockerBuilder {
  private _docker: string;

  constructor(docker_cmd = "docker") {
    this._docker = docker_cmd;
  }

  // ------------------------------------------------------------------ //
  // Docker operations (subprocess)
  // ------------------------------------------------------------------ //

  /** `true` when this daemon accepts buildx-only `docker build` flags. */
  private async _buildxFlags(): Promise<boolean> {
    return dockerBuildxAvailable(this._docker);
  }

  /** Verify Docker daemon is reachable: `true` if `docker info` exits successfully. */
  async checkDocker(): Promise<boolean> {
    try {
      const result = await runCaptured([this._docker, "info"], { timeout: 15 });
      return result.returncode === 0;
    } catch (err) {
      if (isFileNotFound(err) || err instanceof TimeoutExpired) return false;
      throw err;
    }
  }

  /**
   * Build a Docker image locally.
   *
   * @param context_dir Build context directory.
   * @param tag Image tag (e.g. `my-image:latest`).
   * @param opts dockerfile (defaults to `context_dir/Dockerfile`), platform (default `linux/amd64`), build_args,
   *   on_output (callback for build output lines).
   * @returns The image tag.
   * @throws DockerBuildError if the build fails.
   */
  async build(context_dir: string, tag: string, opts: BuildOptions = {}): Promise<string> {
    const { dockerfile = null, platform = "linux/amd64", build_args = null, on_output = null } = opts;
    const context = resolve(String(context_dir));
    const resolvedDockerfile = materializedDockerfile(context, dockerfile);
    const ephemeralDockerfile =
      resolvedDockerfile !== null &&
      basename(resolvedDockerfile) === "Dockerfile.abx-build" &&
      resolvedDockerfile !== (dockerfile ? resolve(dockerfile) : null);
    const cmd: string[] = [this._docker, "build", "--platform", platform, "-t", tag];
    // --provenance and --progress=plain are buildx flags. The legacy builder rejects them.
    // DOCKER_BUILDKIT=0 forces the legacy builder; otherwise probe `docker buildx version`.
    if (await this._buildxFlags()) {
      cmd.splice(4, 0, "--provenance=false");
      cmd.splice(5, 0, "--progress=plain");
    }
    if (resolvedDockerfile) cmd.push("-f", String(resolvedDockerfile));
    if (build_args) {
      for (const [k, v] of Object.entries(build_args)) cmd.push("--build-arg", `${k}=${v}`);
    }
    cmd.push(context);

    logger.info("Building Docker image: %s", _redactedArgv(cmd));
    try {
      const output_lines: string[] = [];
      const returncode = await streamLines(cmd, (line) => {
        output_lines.push(line);
        if (on_output) on_output(line);
        logger.debug("docker build: %s", line);
      });
      if (returncode !== 0) {
        throw new DockerBuildError(
          `Docker build failed (exit ${returncode}):\n` + output_lines.slice(-20).join("\n"),
        );
      }
      logger.info("Docker build succeeded: %s", tag);
      return tag;
    } catch (err) {
      if (isFileNotFound(err)) {
        throw new DockerBuildError(`Docker command not found: ${this._docker}`, {
          suggestion: "Install Docker or ensure it is in PATH.",
        });
      }
      throw err;
    } finally {
      if (ephemeralDockerfile && resolvedDockerfile) rmSync(resolvedDockerfile, { force: true });
    }
  }

  /**
   * Login to Alibaba Cloud ACR.
   *
   * @throws ACRLoginError if login fails.
   */
  async loginAcr(registry: string, username: string, password: string): Promise<void> {
    const cmd = [this._docker, "login", "--username", username, "--password-stdin", registry];
    logger.info("Logging into ACR: %s", registry);
    try {
      const proc = await runCaptured(cmd, { input: password, timeout: 30 });
      if (proc.returncode !== 0) {
        throw new ACRLoginError(`ACR login failed: ${proc.stderr.trim()}`);
      }
      logger.info("ACR login succeeded: %s", registry);
    } catch (err) {
      if (isFileNotFound(err)) {
        throw new ACRLoginError(`Docker command not found: ${this._docker}`, {
          suggestion: "Install Docker or ensure it is in PATH.",
        });
      }
      if (err instanceof TimeoutExpired) {
        throw new ACRLoginError("ACR login timed out after 30s.");
      }
      throw err;
    }
  }

  /**
   * Login to ACR using AK/SK -> temporary credentials via GetAuthorizationToken API.
   *
   * Attempts the GetAuthorizationToken API first. If the API call fails (e.g. no CR permission), falls back to using
   * AK/SK directly as docker login credentials.
   *
   * @returns Dict with `tempUserName` and `authorizationToken` (or the AK/SK fallback values).
   * @throws ACRLoginError if all login attempts fail.
   */
  async loginAcrWithAksk(
    registry: string,
    access_key_id: string,
    access_key_secret: string,
    opts: LoginAkSkOptions = {},
  ): Promise<Record<string, string>> {
    const { region = "cn-hangzhou", instance_id = null } = opts;
    logger.info("Attempting ACR login via GetAuthorizationToken for %s", registry);
    try {
      const token_data = await getAcrAuthToken(access_key_id, access_key_secret, region, { instance_id });
      const temp_username = String(token_data["tempUserName"] ?? "");
      const auth_token = String(token_data["authorizationToken"] ?? "");
      if (!temp_username || !auth_token) {
        throw new ACRLoginError(`ACR API returned incomplete credentials: ${pyKeyList(Object.keys(token_data))}`);
      }
      logger.info("ACR temp credentials obtained (user=%s, expires=%s)", temp_username, token_data["expireTime"] ?? "?");
      await this.loginAcr(registry, temp_username, auth_token);
      return { tempUserName: temp_username, authorizationToken: auth_token };
    } catch (exc) {
      if (exc instanceof ACRLoginError) {
        logger.warning("GetAuthorizationToken failed: %s — falling back to direct AK/SK login", pyExcStr(exc));
      } else {
        logger.warning("GetAuthorizationToken error: %s — falling back to direct AK/SK login", pyExcStr(exc));
      }
    }

    // Fallback: use AK as username, SK as password directly
    logger.info("Attempting direct AK/SK docker login for %s", registry);
    await this.loginAcr(registry, access_key_id, access_key_secret);
    return { tempUserName: access_key_id, authorizationToken: access_key_secret };
  }

  /** Tag a local image for a remote registry. */
  async tag(source: string, target: string): Promise<void> {
    logger.info("Tagging: %s → %s", source, target);
    const result = await runCaptured([this._docker, "tag", source, target], { timeout: 15 });
    if (result.returncode !== 0) {
      throw new DockerBuildError(`Docker tag failed: ${result.stderr.trim()}`);
    }
  }

  /**
   * Push an image to a remote registry.
   *
   * @throws ACRPushError if the push fails.
   */
  async push(image_ref: string, opts: { on_output?: ((line: string) => void) | null } = {}): Promise<void> {
    const on_output = opts.on_output ?? null;
    logger.info("Pushing image: %s", image_ref);
    try {
      const output_lines: string[] = [];
      const returncode = await streamLines([this._docker, "push", image_ref], (line) => {
        output_lines.push(line);
        if (on_output) on_output(line);
        logger.debug("docker push: %s", line);
      });
      if (returncode !== 0) {
        throw new ACRPushError(`Docker push failed (exit ${returncode}):\n` + output_lines.slice(-10).join("\n"));
      }
      logger.info("Docker push succeeded: %s", image_ref);
    } catch (err) {
      if (isFileNotFound(err)) {
        throw new ACRPushError(`Docker command not found: ${this._docker}`, {
          suggestion: "Install Docker or ensure it is in PATH.",
        });
      }
      throw err;
    }
  }

  // ------------------------------------------------------------------ //
  // SDK wheel helper
  // ------------------------------------------------------------------ //

  /** Return true if `root` is the agent-sandbox-server source tree (not some other project). */
  static _isSdkSourceTree(root: string): boolean {
    let text: string;
    try {
      text = readFileSync(join(root, "pyproject.toml"), "utf8");
    } catch {
      return false;
    }
    return /^name\s*=\s*"agent-sandbox-server"\s*$/m.test(text);
  }

  /**
   * Fetch the published server-sdk wheel matching this SDK version from PyPI.
   *
   * Pinning the exact version keeps the server SDK inside the image consistent with the client that generated the
   * template (the two distributions are released in lockstep); the plain `pip install agent-sandbox-server` Dockerfile
   * fallback would otherwise pick whatever is newest. Verifies the SHA-256 digest published by PyPI.
   *
   * @returns The wheel copied into `context_dir`, or `[]` when this version is not published or PyPI is unreachable.
   *   Callers fall back to the Dockerfile's PyPI install.
   */
  static async _downloadReleaseWheel(context_dir: string): Promise<string[]> {
    const version = serverSdkVersion();
    const url = _PYPI_RELEASE_URL.replace("{name}", _SDK_DIST_NAME).replace("{version}", version);
    let dest: string;
    try {
      const data = await asyncWith(new AsyncClient({ timeout: 30.0, follow_redirects: true }), async (client) => {
        const resp = await client.get(url);
        resp.raiseForStatus();
        const urls = pyGetItem(resp.json(), "urls") as unknown[];
        const wheels = urls.filter((u) => dictGet(u, "packagetype") === "bdist_wheel") as Array<Record<string, unknown>>;
        if (!wheels.length) {
          logger.warning("No wheel published for %s %s", _SDK_DIST_NAME, version);
          return null;
        }
        // Prefer the universal wheel; the SDK is pure Python. (stable sort)
        const sorted = wheels
          .map((w, idx) => ({ w, idx }))
          .sort((a, b) => {
            const ka = String(pyGetItem(a.w, "filename")).endsWith("-none-any.whl") ? 0 : 1;
            const kb = String(pyGetItem(b.w, "filename")).endsWith("-none-any.whl") ? 0 : 1;
            return ka - kb || a.idx - b.idx;
          })
          .map((x) => x.w);
        const info = sorted[0] as Record<string, unknown>;
        const filename = basename(String(pyGetItem(info, "filename")));
        const dl = await client.get(String(pyGetItem(info, "url")));
        dl.raiseForStatus();
        return { filename, content: new Uint8Array(dl.content), info };
      });
      if (data === null) return [];
      const { filename, content, info } = data;
      const digests = dictGet(info, "digests", {}) as Record<string, unknown>;
      const expected = String(dictGet(digests, "sha256", ""));
      if (expected && sha256Hex(content) !== expected) {
        logger.warning("SHA-256 mismatch for downloaded %s; not injecting", filename);
        return [];
      }
      dest = join(context_dir, filename);
      writeFileSync(dest, content);
    } catch (exc) {
      if (!isWheelFetchError(exc)) throw exc;
      logger.warning(
        "Could not fetch %s %s from PyPI (%s); the image will use the Dockerfile's pinned install",
        _SDK_DIST_NAME,
        version,
        pyExcStr(exc),
      );
      return [];
    }
    logger.info("Injected released SDK wheel: %s", basename(dest));
    return [dest];
  }

  /**
   * Put a server-sdk wheel into the Docker build context.
   *
   * This allows a template to install the server SDK that matches a local tree:
   *
   * - when a server-sdk source tree is given explicitly (`project_root`, or the `ABX_SERVER_SDK_SOURCE` environment
   *   variable): build a wheel from it with `pip wheel`, so unreleased changes reach the image;
   * - otherwise, when the Dockerfile pins the current runtime release: inject nothing and do not query PyPI;
   * - otherwise: download the configured runtime wheel from PyPI.
   *
   * When no wheel is available, the Dockerfile installs the explicit published runtime requirement.
   *
   * @returns List of wheel file paths copied into the context.
   */
  static async injectSdkWheel(
    context_dir: string,
    project_root: string | null = null,
    dockerfile: string | null = null,
  ): Promise<string[]> {
    if (project_root === null || project_root === undefined) {
      const fromEnv = process.env[SERVER_SDK_SOURCE_ENV];
      if (!fromEnv) {
        if (contextHasPinnedServerRequirement(context_dir, dockerfile)) return [];
        return DockerBuilder._downloadReleaseWheel(context_dir);
      }
      project_root = fromEnv;
    }

    const pyproject = join(project_root, "pyproject.toml");
    if (!existsSync(pyproject)) {
      logger.warning("pyproject.toml not found at %s; skipping wheel injection", project_root);
      return [];
    }

    const tmp = mkdtempSync(join(tmpdir(), "abx-wheel-"));
    try {
      logger.info("Building SDK wheel from %s", project_root);
      const pythons = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
      let result: RunResult | null = null;
      let lastErr: unknown = null;
      for (const py of pythons) {
        try {
          result = await runCaptured([py, "-m", "pip", "wheel", String(project_root), "--no-deps", "-w", tmp], {
            timeout: 120,
          });
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (!isFileNotFound(err)) break;
        }
      }
      if (result === null) {
        logger.warning("Failed to build SDK wheel: %s", String(lastErr instanceof Error ? lastErr.message : lastErr).slice(0, 300));
        return [];
      }
      if (result.returncode !== 0) {
        logger.warning("Failed to build SDK wheel: %s", result.stderr.slice(0, 300));
        return [];
      }

      const wheels: string[] = [];
      for (const name of readdirSync(tmp).sort()) {
        if (!name.endsWith(".whl")) continue;
        const dest = join(context_dir, name);
        copyFileSync(join(tmp, name), dest);
        wheels.push(dest);
        logger.info("Injected SDK wheel: %s", name);
      }
      return wheels;
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  /** Build, push and register through the official FCSandbox API. */
  async buildAndRegisterOfficial(
    template_dir: string,
    acr: ACRConfig,
    opts: BuildAndRegisterOfficialOptions = {},
  ): Promise<BuildResult> {
    const {
      name = null,
      tag = "latest",
      platform = "linux/amd64",
      dockerfile = null,
      cpu_count = 2,
      memory_mb = 2048,
      disk_size = null,
      internet_access = null,
      start_cmd = null,
      ready_cmd = null,
      envd_inject = false,
      generation = 1,
      team_id = null,
      region = "cn-hangzhou",
      on_progress = null,
      acr_access_key_id = null,
      acr_access_key_secret = null,
      api_access_key_id = null,
      api_access_key_secret = null,
    } = opts;
    const result = new BuildResult();
    const tdir = resolve(String(template_dir));
    const template_name = name || acr.repo || basename(tdir);

    // ACR credentials: dedicated parameters, then ACRConfig.
    const acr_ak = acr_access_key_id || acr.username || "";
    const acr_sk = acr_access_key_secret || acr.password || "";
    // Platform API credentials use dedicated parameters.
    const api_ak = api_access_key_id || "";
    const api_sk = api_access_key_secret || "";

    const _progress = (msg: string): void => {
      if (on_progress) on_progress(msg);
      logger.info("%s", msg);
    };

    // Step 1: Check Docker
    _progress("[1/5] Checking Docker daemon...");
    if (!(await this.checkDocker())) {
      throw new DockerBuildError("Docker daemon is not running or not accessible.", {
        suggestion: "Start Docker Desktop or the Docker daemon.",
      });
    }

    // Step 1.5: Inject SDK wheel into docker context, unless the Dockerfile already pins an archive.
    const injected_wheels = await _injectOrKeepPin(tdir, dockerfile, _progress, "[1.5/5]");

    // Step 2: Build locally
    const local_tag = `${template_name}:${tag}`;
    result.local_tag = local_tag;
    _progress(`[2/5] Building Docker image locally: ${local_tag}`);
    try {
      await this.build(tdir, local_tag, {
        platform,
        dockerfile,
        on_output: (line) => logger.debug("  %s", line),
      });
    } finally {
      for (const whl of injected_wheels) rmSync(whl, { force: true });
    }

    // Step 3: Login + tag + push to ACR
    const acr_ref = acr.tagged_ref(tag);
    result.acr_ref = acr_ref;
    _progress(`[3/5] Pushing to ACR: ${acr_ref}`);
    const creds = await this.loginAcrWithAksk(acr.registry, acr_ak, acr_sk, {
      region,
      instance_id: acr.acree_instance_id || null,
    });
    await this.tag(local_tag, acr_ref);
    await this.push(acr_ref, { on_output: (line) => logger.debug("  %s", line) });
    result.build_status = "pushed";

    // Step 4: Create template via official CreateTemplate API
    _progress(`[4/5] Creating template via official API: ${template_name}`);

    // Determine registry_type
    const registry_type = acr.acree_instance_id ? "acree" : "acr";

    const api_result = await createOfficialTemplate({
      name: template_name,
      image: acr_ref,
      access_key_id: api_ak,
      access_key_secret: api_sk,
      region,
      team_id,
      cpu: cpu_count,
      memory_size: memory_mb,
      disk_size,
      internet_access,
      generation,
      start_command: start_cmd,
      ready_command: ready_cmd,
      envd_inject,
      registry_type,
      acr_instance_id: acr.acree_instance_id || null,
      registry_username: creds["tempUserName"],
      registry_password: creds["authorizationToken"],
      registry_vpc_id: acr.vpc_id || null,
      registry_vswitch_id: acr.vswitch_ids || null,
      registry_security_group_id: acr.security_group_id || null,
    });

    result.template_id = (api_result["templateID"] as string | undefined) ?? "";
    result.build_status = api_result["statusCode"] === 200 ? "ready" : "submitted";
    _progress(`[5/5] Template created: ${result.template_id} (status=${result.build_status})`);

    return result;
  }
}

/** Python `list(d.keys())` rendering used in messages: `['a', 'b']`. */
function pyKeyList(keys: string[]): string {
  return "[" + keys.map((k) => (k.includes("'") && !k.includes('"') ? `"${k}"` : `'${k.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`)).join(", ") + "]";
}

// ── Alibaba Cloud API signature helpers ──

/** RFC 3986 percent-encoding (Alibaba Cloud signature convention). */
export function _percentEncode(s: string): string {
  return encodeURIComponent(s)
    .replaceAll("!", "%21")
    .replaceAll("'", "%27")
    .replaceAll("(", "%28")
    .replaceAll(")", "%29")
    .replaceAll("*", "%2A");
}

/** Compute Alibaba Cloud RPC (POP) V1 HMAC-SHA1 signature. */
export function _signRpc(params: Record<string, string>, secret: string, method = "GET"): string {
  const sorted = Object.entries(params).sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  const canonical = sorted.map(([k, v]) => `${_percentEncode(k)}=${_percentEncode(v)}`).join("&");
  const sts = `${method}&${_percentEncode("/")}&${_percentEncode(canonical)}`;
  const key = Buffer.from(secret + "&", "utf8");
  return createHmac("sha1", key).update(sts, "utf8").digest("base64");
}

/**
 * Compute Alibaba Cloud ROA-style HMAC-SHA1 signature.
 *
 * StringToSign = VERB + '\n' + Accept + '\n' + Content-MD5 + '\n' + Content-Type + '\n' + Date + '\n'
 *              + CanonicalizedHeaders + CanonicalizedResource
 */
export function _signRoa(
  method: string,
  path: string,
  headers: Record<string, string>,
  secret: string,
  accept = "application/json",
  content_type = "application/json",
): string {
  const acs_headers = Object.entries(headers)
    .filter(([k]) => k.toLowerCase().startsWith("x-acs-"))
    .map(([k, v]) => [k.toLowerCase(), v.trim()] as [string, string])
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  const canonical_headers = acs_headers.map(([k, v]) => `${k}:${v}\n`).join("");
  const date_str = headers["Date"] ?? "";
  const content_md5 = headers["Content-MD5"] ?? "";

  const sts = `${method}\n${accept}\n${content_md5}\n${content_type}\n${date_str}\n${canonical_headers}${path}`;
  return createHmac("sha1", Buffer.from(secret, "utf8")).update(sts, "utf8").digest("base64");
}

/** Python `d[key]`: `KeyError` for a missing key, `TypeError` when the value is not a dict. */
function pyGetItem(d: unknown, key: string): unknown {
  if (d === null || typeof d !== "object" || Array.isArray(d)) {
    throw new TypeError(
      Array.isArray(d) ? "list indices must be integers or slices, not str" : `'${d === null ? "NoneType" : typeof d}' object is not subscriptable`,
    );
  }
  if (!Object.prototype.hasOwnProperty.call(d, key)) {
    const err = new Error(`'${key}'`);
    err.name = "KeyError";
    throw err;
  }
  return (d as Record<string, unknown>)[key];
}

/** `except (httpx.HTTPError, KeyError, ValueError, OSError)`. */
function isWheelFetchError(e: unknown): boolean {
  return e instanceof HTTPError || e instanceof ValueError || e instanceof OSError || (e instanceof Error && e.name === "KeyError");
}

/** Call ACR personal-edition `GET /tokens` (ROA-style, Version 2016-06-07). */
export async function _getAcrAuthTokenPersonal(
  access_key_id: string,
  access_key_secret: string,
  region = "cn-hangzhou",
): Promise<Record<string, unknown>> {
  const endpoint = `https://cr.${region}.aliyuncs.com`;
  const path = "/tokens";
  const nonce = randomUUID();
  const date_str = new Date().toUTCString();

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Date: date_str,
    "x-acs-signature-method": "HMAC-SHA1",
    "x-acs-signature-nonce": nonce,
    "x-acs-signature-version": "1.0",
    "x-acs-version": "2016-06-07",
  };

  const sig = _signRoa("GET", path, headers, access_key_secret, "application/json", "application/json");
  headers["Authorization"] = `acs ${access_key_id}:${sig}`;

  logger.info("Calling ACR GetAuthorizationToken (ROA, personal, region=%s)", region);
  const [resp, data] = await asyncWith(new AsyncClient({ timeout: 15 }), async (client) => {
    const r = await client.get(`${endpoint}${path}`, { headers });
    return [r, r.json()] as const;
  });
  logger.debug("ACR personal GetAuthorizationToken response: status=%s", resp.status_code);

  if (resp.status_code !== 200) {
    const msg = dictGet(data, "message", dictGet(data, "Message", pyStr(data)));
    throw new ACRLoginError(`ACR personal GetAuthorizationToken failed (HTTP ${resp.status_code}): ${pyStr(msg)}`, {
      suggestion: "Check AK/SK and region. Ensure CR API is accessible.",
    });
  }

  // Response: {"data": {"tempUserName": ..., "authorizationToken": ..., "expireTime": ...}}
  return dictGet(data, "data", data);
}

/** Call ACR EE `GetAuthorizationToken` (RPC/POP-style, Version 2018-12-01). */
export async function _getAcrAuthTokenEe(
  access_key_id: string,
  access_key_secret: string,
  region = "cn-hangzhou",
  instance_id = "",
): Promise<Record<string, unknown>> {
  const endpoint = `https://cr.${region}.aliyuncs.com`;
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const params: Record<string, string> = {
    Action: "GetAuthorizationToken",
    Format: "JSON",
    Version: "2018-12-01",
    AccessKeyId: access_key_id,
    SignatureMethod: "HMAC-SHA1",
    Timestamp: ts,
    SignatureVersion: "1.0",
    SignatureNonce: randomUUID(),
    InstanceId: instance_id,
  };
  params["Signature"] = _signRpc(params, access_key_secret);

  logger.info("Calling ACR GetAuthorizationToken (RPC, EE, region=%s, instance=%s)", region, instance_id);
  const [resp, data] = await asyncWith(new AsyncClient({ timeout: 15 }), async (client) => {
    const r = await client.get(endpoint, { params });
    return [r, r.json()] as const;
  });
  logger.debug("ACR EE GetAuthorizationToken response: status=%s", resp.status_code);

  if (resp.status_code !== 200) {
    const msg = dictGet(data, "Message", dictGet(data, "message", pyStr(data)));
    throw new ACRLoginError(`ACR EE GetAuthorizationToken failed (HTTP ${resp.status_code}): ${pyStr(msg)}`, {
      suggestion: "Check AK/SK, region, and InstanceId.",
    });
  }

  return dictGet(data, "data", data);
}

/**
 * Get ACR temporary credentials by trying available API editions.
 *
 * - Personal edition (ROA, `GET /tokens`, Version 2016-06-07)
 * - Enterprise edition (RPC/POP, `GetAuthorizationToken`, Version 2018-12-01) — only attempted when `instance_id` is
 *   provided.
 *
 * @returns dict with `tempUserName` and `authorizationToken`.
 */
export async function getAcrAuthToken(
  access_key_id: string,
  access_key_secret: string,
  region = "cn-hangzhou",
  opts: { instance_id?: string | null } = {},
): Promise<Record<string, unknown>> {
  const instance_id = opts.instance_id ?? null;
  const errors: string[] = [];

  // 1. Try personal edition (ROA)
  try {
    const auth = await _seams.getAcrAuthTokenPersonal(access_key_id, access_key_secret, region);
    const token = auth["authorizationToken"] ?? "";
    const user = auth["tempUserName"] ?? "";
    if (token && user) return auth;
    errors.push(`personal: incomplete credentials ${pyKeyList(Object.keys(auth))}`);
  } catch (exc) {
    errors.push(`personal: ${pyExcStr(exc)}`);
    logger.debug("ACR personal-edition token failed: %s", pyExcStr(exc));
  }

  // 2. Try EE edition (RPC) if instance_id provided
  if (instance_id) {
    try {
      const auth = await _seams.getAcrAuthTokenEe(access_key_id, access_key_secret, region, instance_id);
      const token = auth["authorizationToken"] ?? "";
      const user = auth["tempUserName"] ?? "";
      if (token && user) return auth;
      errors.push(`EE: incomplete credentials ${pyKeyList(Object.keys(auth))}`);
    } catch (exc) {
      errors.push(`EE: ${pyExcStr(exc)}`);
      logger.debug("ACR EE-edition token failed: %s", pyExcStr(exc));
    }
  }

  throw new ACRLoginError(`All ACR GetAuthorizationToken attempts failed: ${errors.join("; ")}`, {
    suggestion: "Check AK/SK and region. For personal ACR ensure CR API is enabled.",
  });
}
