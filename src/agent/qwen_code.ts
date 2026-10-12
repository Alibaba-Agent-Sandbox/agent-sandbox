/**
 * Host-side Qwen Code (https://github.com/QwenLM/qwen-code) adapter.
 *
 * Port of `easy_sandbox/agent/qwen_code.py`. It locates — or installs — the official Qwen Code CLI on the host and
 * runs it in headless JSON mode so that `ebx create "<description>"` can generate a Dockerfile and a `template.yaml`
 * locally.
 *
 * Verified release facts (see the Python module for the full provenance):
 *
 * - Standalone assets are named `qwen-code-<target>.<ext>`: `darwin-x64` / `darwin-arm64` / `linux-x64` /
 *   `linux-arm64` ship `.tar.gz` (containing `qwen-code/bin/qwen` and `qwen-code/node/bin/node`), `win-x64` ships
 *   `.zip` (`qwen-code\bin\qwen.cmd` and `qwen-code\node\node.exe`). There is no `win-arm64` asset.
 * - Mirrors (both publish `SHA256SUMS` next to the asset): Aliyun first, GitHub fallback.
 * - Headless interface: `qwen "<prompt>" --output-format json --yolo` (the prompt is a positional argument; the
 *   deprecated `-p` flag is never used). `--max-session-turns` bounds the turn budget (exit code 53 when exceeded),
 *   `--session-id <uuid>` / `--resume <uuid>` pin / continue a native session and `--json-schema` registers the
 *   synthetic `structured_output` tool whose validated payload arrives as `structured_result`.
 * - Auth: `OPENAI_API_KEY` + `OPENAI_BASE_URL` + `OPENAI_MODEL`, `DASHSCOPE_API_KEY` /
 *   `BAILIAN_CODING_PLAN_API_KEY`, or a preset `~/.qwen/settings.json`.
 *
 * Differences from Python that are inherent to Node (all other behaviour is 1:1):
 *
 * - everything that spawns a process or touches the network is `async` (returns a `Promise`);
 * - Python's `KeyboardInterrupt` is modelled by {@link KeyboardInterrupt}: while a headless run is active a SIGINT
 *   handler reaps the whole process tree and the run rejects with it;
 * - test seams (Python `monkeypatch.setattr(qwen_code, "x", ...)`) live on the exported {@link seams} object.
 */

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Readable } from "node:stream";

import {
  AICodegenError,
  QwenCodeCredentialError,
  QwenCodeNotInstalledError,
  QwenCodeStartupError,
  QwenCodeTimeoutError,
} from "../models/errors.js";
import { PyOverflowError } from "../utils/coerce.js";
import { getLogger } from "../utils/logging.js";
import { httpDownloadToFile, httpGetText } from "./_http.js";
import { extractTarMembers, extractZip, isWithin, readTarMembers, zipNames } from "./_archive.js";
import {
  AsyncQueue,
  KeyboardInterrupt,
  QUEUE_EMPTY,
  TextPipeDecoder,
  TimeoutExpired,
  cpLength,
  cpSlice,
  decodeUtf8Strict,
  expandUser,
  formatFixed0,
  homeDir,
  isDir,
  isFile,
  pathExists,
  pySplitLines,
  pySplitWhitespace,
  pyStrip,
  which as whichImpl,
} from "./_pycompat.js";
import { isDict, pyJsonDumps, pyJsonLoads, pyRepr, pyTruthy } from "./_py.js";

export { KeyboardInterrupt, TimeoutExpired };

const logger = getLogger("agent.qwen_code");

// ---------------------------------------------------------------------------
// Verified constants
// ---------------------------------------------------------------------------

const SUPPORTED_TARGETS: readonly string[] = ["darwin-x64", "darwin-arm64", "linux-x64", "linux-arm64", "win-x64"];

const ALIYUN_RELEASE_BASE = "https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/releases/qwen-code/latest";
const GITHUB_RELEASE_BASE = "https://github.com/QwenLM/qwen-code/releases/latest/download";

/** `(label, base_url)` pairs, tried in order (Aliyun first, GitHub fallback). */
const STANDALONE_MIRRORS: ReadonlyArray<readonly [string, string]> = [
  ["aliyun", ALIYUN_RELEASE_BASE],
  ["github", GITHUB_RELEASE_BASE],
];

const CHECKSUM_NAME = "SHA256SUMS";
export const _DEFAULT_OPENAI_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
export const _DEFAULT_OPENAI_MODEL = "qwen3-coder-plus";
const USER_AGENT = "easy-sandbox-qwen-code/1.0";

/** Environment variables that mean "the user already configured auth". */
const EXISTING_AUTH_ENV_VARS: readonly string[] = ["OPENAI_API_KEY", "DASHSCOPE_API_KEY", "BAILIAN_CODING_PLAN_API_KEY"];

class ChecksumMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "_ChecksumMismatchError";
  }
}

/** `str(exc)`: honours a `toString()` override (SandboxError), else the plain message. */
export function excStr(exc: unknown): string {
  if (exc instanceof Error) {
    return exc.toString !== Error.prototype.toString ? exc.toString() : exc.message;
  }
  return String(exc);
}

// ---------------------------------------------------------------------------
// Public data structures
// ---------------------------------------------------------------------------

export interface QwenCodeCredentialsInit {
  source: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

/**
 * Resolved Qwen Code model credentials.
 *
 * `source` is one of: `qwen-stored` (the unified `llm_api_key` persisted as `EBX_LLM_API_KEY`), `llm-stored` (legacy
 * `llm_api_key` in config.toml), `environment` (a valid variable already exists in the process environment, so the
 * child inherits it) or `qwen-settings` (`~/.qwen/settings.json` is already configured).
 */
export class QwenCodeCredentials {
  readonly source: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;

  constructor(init: QwenCodeCredentialsInit) {
    this.source = init.source;
    this.apiKey = init.apiKey ?? "";
    this.baseUrl = init.baseUrl ?? "";
    this.model = init.model ?? "";
    Object.freeze(this);
  }

  /** Whether ebx must inject `OPENAI_*` variables for the child. */
  get needsEnvInjection(): boolean {
    return this.source === "qwen-stored" || this.source === "llm-stored";
  }

  /** Environment variables to inject (empty when nothing is needed). */
  asEnv(): Record<string, string> {
    const envs: Record<string, string> = {};
    if (this.needsEnvInjection) {
      envs.OPENAI_API_KEY = this.apiKey;
      if (this.baseUrl) envs.OPENAI_BASE_URL = this.baseUrl;
      if (this.model) envs.OPENAI_MODEL = this.model;
    } else if (this.model) {
      // An explicit model still has to reach Qwen when the key itself comes from the process environment.
      envs.OPENAI_MODEL = this.model;
    }
    return envs;
  }
}

/** Raw outcome of one headless `qwen` invocation. */
export class QwenCodeRunResult {
  /** Final assistant text (the `result` message payload). */
  text = "";
  /** `true` when the CLI reported `is_error` or emitted no result. */
  isError = false;
  exitCode = -1;
  rawStdout = "";
  rawStderr = "";
  /** `structured_result` payload of a `--json-schema` run, else `null`. */
  structured: unknown = null;
  /** Session ID reported by the CLI (`--session-id` / `--resume` runs). */
  sessionId = "";

  constructor(init: Partial<QwenCodeRunResult> = {}) {
    Object.assign(this, init);
  }
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

/** `platform.system()`. */
export function platformSystem(): string {
  switch (process.platform) {
    case "win32":
      return "Windows";
    case "darwin":
      return "Darwin";
    case "linux":
      return "Linux";
    default:
      return os.type();
  }
}

/** `platform.machine()`. */
export function platformMachine(): string {
  if (process.platform === "win32") {
    const arch = process.env.PROCESSOR_ARCHITEW6432 ?? process.env.PROCESSOR_ARCHITECTURE;
    if (arch) return arch;
  }
  return os.machine();
}

/**
 * Return the official standalone target for this platform, or `null` when the platform has no official standalone
 * build (e.g. Windows on ARM64, or any non darwin/linux/win OS). `system` and `machine` default to
 * {@link platformSystem} / {@link platformMachine}.
 */
export function detectStandaloneTarget(opts: { system?: string | null; machine?: string | null } = {}): string | null {
  const sysName = pyStrip(opts.system ?? platformSystem()).toLowerCase();
  const archName = pyStrip(opts.machine ?? platformMachine()).toLowerCase();

  let osId: string;
  if (sysName === "darwin") osId = "darwin";
  else if (sysName === "linux") osId = "linux";
  else if (["windows", "win32", "cygwin", "msys"].includes(sysName)) osId = "win";
  else return null;

  let archId: string;
  if (["x86_64", "amd64", "x64"].includes(archName)) archId = "x64";
  else if (["arm64", "aarch64"].includes(archName)) archId = "arm64";
  else return null;

  if (osId === "win" && archId !== "x64") {
    // Verified: the official release matrix has no win-arm64 asset.
    return null;
  }

  const target = `${osId}-${archId}`;
  return SUPPORTED_TARGETS.includes(target) ? target : null;
}

/** Return the official asset file name for `target` (throws `Error` for unsupported targets, like Python's `ValueError`). */
export function standaloneAssetName(target: string): string {
  if (!SUPPORTED_TARGETS.includes(target)) {
    throw new Error(`Unsupported Qwen Code standalone target: ${pyRepr(target)}`);
  }
  const ext = target.startsWith("win-") ? "zip" : "tar.gz";
  return `qwen-code-${target}.${ext}`;
}

/** Return `(mirror_label, archive_url)` pairs for `target`, in order. */
export function standaloneDownloadUrls(target: string): Array<[string, string]> {
  const asset = standaloneAssetName(target);
  return STANDALONE_MIRRORS.map(([label, base]): [string, string] => [label, `${base}/${asset}`]);
}

/** Return the verified official one-line installer command. */
export function officialInstallCommand(opts: { windows?: boolean | null } = {}): string {
  const isWin = opts.windows == null ? process.platform === "win32" : opts.windows;
  if (isWin) {
    return (
      'powershell -NoProfile -Command "irm ' +
      "https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/" +
      'install-qwen-standalone.ps1 | iex"'
    );
  }
  return (
    "curl -fsSL " +
    "https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/" +
    "install-qwen-standalone.sh | bash"
  );
}

/** Managed install directory: `~/.ebx/bin`. */
export function defaultBinDir(): string {
  return path.join(homeDir(), ".ebx", "bin");
}

function binaryNames(windows?: boolean | null): string[] {
  const isWin = windows == null ? process.platform === "win32" : windows;
  if (isWin) return ["qwen.cmd", "qwen.exe", "qwen.bat"];
  return ["qwen"];
}

/**
 * Locate the Qwen Code executable.
 *
 * Lookup order: (1) `EBX_QWEN_CODE_BIN` override (absolute path to an executable), (2) the managed directory
 * `~/.ebx/bin` (installed by ebx itself), (3) `PATH` (honours `PATHEXT` on Windows). Returns `null` when nothing
 * usable is found.
 */
export function findQwenCodeBinary(opts: { binDir?: string | null; windows?: boolean | null } = {}): string | null {
  const override = process.env.EBX_QWEN_CODE_BIN;
  if (override) {
    const candidate = expandUser(override);
    return isFile(candidate) ? candidate : null;
  }

  const isWin = opts.windows == null ? process.platform === "win32" : opts.windows;
  const managed = opts.binDir != null ? opts.binDir : defaultBinDir();
  for (const name of binaryNames(isWin)) {
    const candidate = path.join(managed, name);
    if (isFile(candidate) && (isWin || canExecute(candidate))) return candidate;
  }

  const found = seams.which("qwen");
  if (found) return found;
  return null;
}

function canExecute(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Installation (download + checksum + atomic swap)
// ---------------------------------------------------------------------------

/** Download `url` into `dest` (no third-party deps). */
export async function _downloadToFile(url: string, dest: string, opts: { timeout: number }): Promise<void> {
  await httpDownloadToFile(url, dest, USER_AGENT, opts.timeout);
}

/** Fetch a small text resource (`SHA256SUMS`). */
export async function _httpGetText(url: string, opts: { timeout: number }): Promise<string> {
  return await httpGetText(url, USER_AGENT, opts.timeout);
}

/** Parse `SHA256SUMS` content into `{file_name: hex_digest}`. */
export function _parseSha256sums(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of pySplitLines(text)) {
    const parts = pySplitWhitespace(line);
    if (parts.length < 2) continue;
    const digest = pyStrip(parts[0] as string).toLowerCase();
    const name = (parts[parts.length - 1] as string).replace(/^\*+/, "");
    if (digest.length === 64 && /^[0-9a-f]+$/.test(digest)) result[name] = digest;
  }
  return result;
}

function sha256Of(file: string): string {
  const digest = createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      digest.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return digest.digest("hex");
}

function validateTarMembers(dest: string, members: ReturnType<typeof readTarMembers>): void {
  const root = path.resolve(dest);
  for (const member of members) {
    const target = path.resolve(dest, member.name);
    if (!isWithin(target, root)) {
      throw new QwenCodeNotInstalledError(
        `Refusing to extract archive entry outside destination: ${pyRepr(member.name)}`,
      );
    }
    if (member.kind === "symlink" || member.kind === "hardlink") {
      const link = member.linkname;
      if (link.startsWith("/") || !isWithin(path.resolve(dest, link), root)) {
        throw new QwenCodeNotInstalledError(`Refusing to extract unsafe link in archive: ${pyRepr(member.name)}`);
      }
    }
  }
}

/** Safely extract a `.tar.gz` archive into `dest`. */
export function _extractTar(archive: string, dest: string): void {
  const members = readTarMembers(archive);
  validateTarMembers(dest, members);
  extractTarMembers(members, dest);
}

/** Safely extract a `.zip` archive into `dest`. */
export function _extractZip(archive: string, dest: string): void {
  const root = path.resolve(dest);
  for (const name of zipNames(archive)) {
    if (!isWithin(path.resolve(dest, name), root)) {
      throw new QwenCodeNotInstalledError(`Refusing to extract archive entry outside destination: ${pyRepr(name)}`);
    }
  }
  extractZip(archive, dest);
}

function extractArchive(archive: string, dest: string, target: string): void {
  fs.mkdirSync(dest, { recursive: true });
  if (target.startsWith("win-")) _extractZip(archive, dest);
  else _extractTar(archive, dest);
}

/** Archive-relative entry point (verified layout). */
export function _entryRelativePath(target: string): string {
  const name = target.startsWith("win-") ? "qwen.cmd" : "qwen";
  return path.join("qwen-code", "bin", name);
}

export function _nodeRelativePath(target: string): string {
  if (target.startsWith("win-")) return path.join("qwen-code", "node", "node.exe");
  return path.join("qwen-code", "node", "bin", "node");
}

/** Ensure the extracted archive matches the official layout. */
function validateArchiveLayout(extractDir: string, target: string): void {
  const entry = path.join(extractDir, _entryRelativePath(target));
  const node = path.join(extractDir, _nodeRelativePath(target));
  const missing: string[] = [];
  if (!isFile(entry)) missing.push(_entryRelativePath(target));
  if (!isFile(node)) missing.push(_nodeRelativePath(target));
  if (missing.length > 0) {
    throw new QwenCodeNotInstalledError(
      `Downloaded Qwen Code archive has an unexpected layout; missing: ${missing.join(", ")}.`,
    );
  }
  if (!target.startsWith("win-")) {
    for (const file of [entry, node]) fs.chmodSync(file, 0o755);
  }
}

/** Atomically write the `qwen` wrapper script pointing at `entry`. */
function writeWrapper(wrapper: string, entry: string, windows: boolean): void {
  let content: string;
  if (windows) {
    content = `@echo off\r\ncall "${entry}" %*\r\n`;
  } else {
    // Single-quote shell escaping so paths with spaces still work.
    const quoted = `'${entry.replaceAll("'", `'"'"'`)}'`;
    content = `#!/usr/bin/env sh\nexec ${quoted} "$@"\n`;
  }
  const tmp = path.join(path.dirname(wrapper), `${path.basename(wrapper)}.new`);
  fs.writeFileSync(tmp, content, { encoding: "utf8" });
  if (!windows) fs.chmodSync(tmp, 0o755);
  fs.renameSync(tmp, wrapper);
}

function rmtree(target: string): void {
  fs.rmSync(target, { recursive: true, force: true });
}

/**
 * Download, verify, and install the official Qwen Code standalone build.
 *
 * The archive is downloaded from the Aliyun mirror first with a GitHub fallback, its SHA256 is verified against the
 * mirror's `SHA256SUMS` (a mismatch aborts immediately — no silent retry with an unverified binary), and the install
 * directory is swapped atomically. Returns the path of the installed `qwen` wrapper (`~/.ebx/bin/qwen` or
 * `qwen.cmd`).
 *
 * @throws QwenCodeNotInstalledError On unsupported platforms, when every mirror fails, or when integrity
 *   verification fails.
 */
export async function downloadAndInstallStandalone(
  opts: {
    target?: string | null;
    binDir?: string | null;
    timeout?: number;
    onProgress?: ((message: string) => void) | null;
  } = {},
): Promise<string> {
  const timeout = opts.timeout ?? 180.0;
  const progress = (message: string): void => {
    if (opts.onProgress != null) opts.onProgress(message);
  };

  const resolvedTarget = opts.target != null ? opts.target : seams.detectStandaloneTarget();
  if (resolvedTarget == null) {
    throw new QwenCodeNotInstalledError(
      `No official Qwen Code standalone build for ${platformSystem()} ${platformMachine()}.`,
      {
        suggestion: `Install Qwen Code manually with the official installer: ${seams.officialInstallCommand()}`,
      },
    );
  }

  const isWin = resolvedTarget.startsWith("win-");
  const asset = standaloneAssetName(resolvedTarget);
  const destBin = opts.binDir != null ? opts.binDir : defaultBinDir();
  fs.mkdirSync(destBin, { recursive: true });

  const staging = path.join(destBin, ".qwen-code-staging");
  rmtree(staging);
  fs.mkdirSync(staging, { recursive: true });
  const archivePath = path.join(staging, asset);
  const extractDir = path.join(staging, "extract");

  const failures: string[] = [];
  let installed = false;
  for (const [label, url] of standaloneDownloadUrls(resolvedTarget)) {
    try {
      progress(`Downloading ${asset} from ${label} mirror...`);
      await seams.downloadToFile(url, archivePath, { timeout });

      progress("Verifying SHA256 checksum...");
      const base = url.slice(0, url.lastIndexOf("/"));
      const sums = _parseSha256sums(await seams.httpGetText(`${base}/${CHECKSUM_NAME}`, { timeout }));
      const expected = sums[asset];
      if (!expected) {
        throw new QwenCodeNotInstalledError(
          `${CHECKSUM_NAME} from ${label} has no entry for ${asset}; refusing to install an unverified binary.`,
        );
      }
      const actual = sha256Of(archivePath);
      if (actual !== expected) {
        throw new ChecksumMismatchError(`SHA256 mismatch for ${asset}: expected ${expected}, got ${actual}.`);
      }

      progress("Extracting archive...");
      extractArchive(archivePath, extractDir, resolvedTarget);
      validateArchiveLayout(extractDir, resolvedTarget);
      installed = true;
      break;
    } catch (exc) {
      if (exc instanceof ChecksumMismatchError) {
        rmtree(staging);
        throw new QwenCodeNotInstalledError(`Qwen Code archive failed integrity verification: ${exc.message}`, {
          suggestion:
            "Do not retry blindly; the download may be corrupted or " +
            "tampered with. Retry once, and if it persists install " +
            `manually: ${seams.officialInstallCommand()}`,
        });
      }
      // mirror-specific failure: try the next one
      logger.debug("Mirror %s failed: %s", label, excStr(exc));
      failures.push(`${label}: ${excStr(exc)}`);
      fs.rmSync(archivePath, { force: true });
      rmtree(extractDir);
    }
  }

  if (!installed) {
    rmtree(staging);
    throw new QwenCodeNotInstalledError(
      "Failed to download a verified Qwen Code standalone archive from all official mirrors. " + failures.join(" | "),
      {
        suggestion:
          "Check network access to qwen-code-assets.oss-cn-hangzhou.aliyuncs.com " +
          `and github.com, or install manually: ${seams.officialInstallCommand()}`,
      },
    );
  }

  // Atomic swap: staged extraction -> lib dir, then write the wrapper.
  const installLib = path.join(destBin, "qwen-code");
  const newLib = path.join(destBin, ".qwen-code.new");
  const oldLib = path.join(destBin, ".qwen-code.old");
  rmtree(newLib);
  rmtree(oldLib);
  fs.renameSync(path.join(extractDir, "qwen-code"), newLib);

  if (pathExists(installLib)) fs.renameSync(installLib, oldLib);
  try {
    fs.renameSync(newLib, installLib);
  } catch (exc) {
    if (!pathExists(installLib) && pathExists(oldLib)) fs.renameSync(oldLib, installLib);
    throw exc;
  }
  rmtree(oldLib);

  const wrapper = path.join(destBin, binaryNames(isWin)[0] as string);
  progress(`Installing Qwen Code into ${destBin}...`);
  const entryName = isWin ? "qwen.cmd" : "qwen";
  writeWrapper(wrapper, path.join(installLib, "bin", entryName), isWin);

  rmtree(staging);
  return wrapper;
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/** Whether `~/.qwen/settings.json` already carries model auth config. */
export function _qwenSettingsConfigured(settingsPath?: string | null): boolean {
  const file = settingsPath != null ? settingsPath : path.join(homeDir(), ".qwen", "settings.json");
  if (!isFile(file)) return false;
  let data: unknown;
  try {
    data = pyJsonLoads(decodeUtf8Strict(fs.readFileSync(file)));
  } catch {
    return false;
  }
  if (!isDict(data)) return false;
  return Boolean(pyTruthy(data.modelProviders) || pyTruthy(data.env));
}

/** True when a provider rejected the model id (`404 Model not exist` and the same wording). */
export function modelRejectedByEndpoint(text: string): boolean {
  return /model not exist/i.test(text) || /model[_ -]?not[_ -]?found/i.test(text);
}

/** Ids from an OpenAI-compatible `GET {base}/models`. An unreachable endpoint yields an empty list. */
export async function listCompatibleModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const root = baseUrl.replace(/\/+$/, "");
  const url = root.endsWith("/models") ? root : `${root}/models`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  } catch {
    return [];
  }
  if (!response.ok) return [];
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return [];
  }
  const data = body !== null && typeof body === "object" ? (body as { data?: unknown }).data : undefined;
  if (!Array.isArray(data)) return [];
  const ids: string[] = [];
  for (const item of data) {
    if (item !== null && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
      const id = (item as { id: string }).id;
      if (id) ids.push(id);
    }
  }
  return ids;
}

const _UNSUITABLE_MODEL = /image|audio|realtime|omni|embed|rerank|translate|livetranslate|mt-uni|\bvl\b|-vl|ocr|\btts\b|\basr\b|\bwan\b|speech|vision/i;

/**
 * Models worth offering for template generation.
 *
 * Drops image, audio, embedding, translation and vendor-prefixed aliases. Coding models come first, then
 * Qwen max / plus / turbo / flash, then DeepSeek chat models. At most 12 ids.
 */
export function rankCodegenModels(ids: readonly string[]): string[] {
  const suitable = ids.filter((id) => {
    if (id.includes("/")) return false;
    if (_UNSUITABLE_MODEL.test(id)) return false;
    return /coder|qwen|deepseek/i.test(id);
  });
  const score = (id: string): number => {
    const name = id.toLowerCase();
    if (name.includes("coder")) return 0;
    if (name.includes("max")) return 1;
    if (name.includes("plus")) return 2;
    if (name.includes("turbo")) return 3;
    if (name.includes("flash")) return 4;
    if (name.includes("deepseek") && name.includes("pro")) return 5;
    if (name.includes("deepseek")) return 6;
    return 7;
  };
  const unique = [...new Set(suitable)];
  unique.sort((a, b) => score(a) - score(b) || a.length - b.length || a.localeCompare(b));
  return unique.slice(0, 12);
}

/**
 * Resolve credentials for the Qwen Code headless run. First hit wins:
 *
 * 1. The ebx `llm_api_key` persisted as `EBX_LLM_API_KEY` (`source="qwen-stored"`).
 * 2. A legacy `llm_api_key` still stored in config.toml (`source="llm-stored"`).
 * 3. A valid variable already present in the process environment (`source="environment"`). An explicit
 *    `storedModel` is still injected as `OPENAI_MODEL`; otherwise the child keeps the environment it already has.
 * 4. A configured `~/.qwen/settings.json` (`source="qwen-settings"`).
 *
 * @throws QwenCodeCredentialError When none of the sources is available.
 */
export function resolveQwenCodeCredentials(
  opts: {
    storedApiKey?: string | null;
    llmApiKey?: string | null;
    storedBaseUrl?: string | null;
    storedModel?: string | null;
    environ?: Readonly<Record<string, string | undefined>> | null;
    settingsPath?: string | null;
  } = {},
): QwenCodeCredentials {
  const env = opts.environ == null ? process.env : opts.environ;
  const baseUrl = opts.storedBaseUrl || _DEFAULT_OPENAI_BASE_URL;
  const model = opts.storedModel || _DEFAULT_OPENAI_MODEL;

  if (opts.storedApiKey) {
    return new QwenCodeCredentials({ source: "qwen-stored", apiKey: opts.storedApiKey, baseUrl, model });
  }
  if (opts.llmApiKey) {
    return new QwenCodeCredentials({ source: "llm-stored", apiKey: opts.llmApiKey, baseUrl, model });
  }
  for (const name of EXISTING_AUTH_ENV_VARS) {
    const value = env[name];
    if (value) {
      return new QwenCodeCredentials({
        source: "environment",
        apiKey: value,
        baseUrl: opts.storedBaseUrl || "",
        model: opts.storedModel || "",
      });
    }
  }
  if (_qwenSettingsConfigured(opts.settingsPath)) {
    return new QwenCodeCredentials({ source: "qwen-settings" });
  }

  throw new QwenCodeCredentialError("Qwen Code is installed but no model credentials were found.", {
    suggestion:
      "Store a DashScope/ModelStudio API key with " +
      "'ebx config set llm_api_key <KEY>' (or run " +
      "'ebx config init'), export OPENAI_API_KEY / DASHSCOPE_API_KEY, " +
      "or configure Qwen Code interactively once via 'qwen'.",
  });
}

// ---------------------------------------------------------------------------
// Headless execution
// ---------------------------------------------------------------------------

/**
 * Build the argv for `qwen` headless JSON mode.
 *
 * The prompt travels as a single positional argv element (never through a shell, never via the deprecated `-p`
 * flag). `maxSessionTurns` -> `--max-session-turns`, `sessionId` -> `--session-id`, `resume` -> `--resume` (wins when
 * both are set), `jsonSchema` -> `--json-schema` (an object is dumped to a JSON literal; a string is passed through).
 * On Windows a `.cmd` / `.bat` wrapper is run through `cmd.exe /c`. `stream` requests `--output-format stream-json`
 * with `--include-partial-messages`.
 */
export function _buildHeadlessCommand(
  binary: string,
  prompt: string,
  opts: {
    maxSessionTurns?: number | null;
    sessionId?: string | null;
    resume?: string | null;
    jsonSchema?: Readonly<Record<string, unknown>> | string | null;
    windows?: boolean | null;
    stream?: boolean;
  } = {},
): string[] {
  const argv = [String(binary), prompt, "--output-format", "json", "--yolo"];
  if (opts.stream) {
    argv[3] = "stream-json";
    argv.splice(4, 0, "--include-partial-messages");
  }
  if (opts.jsonSchema != null) {
    const schemaText =
      typeof opts.jsonSchema === "string" ? opts.jsonSchema : pyJsonDumps(opts.jsonSchema, { ensureAscii: false });
    argv.push("--json-schema", schemaText);
  }
  if (opts.resume != null) {
    argv.push("--resume", String(opts.resume));
  } else if (opts.sessionId != null) {
    argv.push("--session-id", String(opts.sessionId));
  }
  if (opts.maxSessionTurns != null) {
    argv.push("--max-session-turns", String(opts.maxSessionTurns));
  }
  const isWin = opts.windows == null ? process.platform === "win32" : opts.windows;
  const suffix = path.extname(String(binary)).toLowerCase();
  if (isWin && (suffix === ".cmd" || suffix === ".bat")) {
    return [process.env.COMSPEC ?? "cmd.exe", "/c", ...argv];
  }
  return argv;
}

/** Parse `text` when it is a JSON object/array document, else `null`. */
function maybeJsonObject(text: string): unknown {
  const stripped = pyStrip(text);
  if (!stripped || !"[{".includes(stripped[0] as string)) return null;
  try {
    return loadJson(stripped);
  } catch {
    return null;
  }
}

/** `json.loads` (fast path via the built-in parser, CPython-compatible fallback for NaN/Infinity). */
function loadJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return pyJsonLoads(text);
  }
}

/**
 * Extract `[result_text, is_error, structured, session_id]`.
 *
 * The CLI emits a JSON array of session messages; the last message with `type == "result"` carries the answer. For
 * `--json-schema` runs the message also carries `structured_result` and `session_id`; when `structured_result` is
 * absent the `result` string is parsed instead if it is a JSON object. Individual lines are also tried so that stray
 * log lines do not break parsing. Returns `["", true, null, ""]` when no result message can be found.
 */
export function _parseHeadlessOutput(stdout: string): [string, boolean, unknown, string] {
  const candidates = [pyStrip(stdout)];
  candidates.push(...pySplitLines(stdout).map((line) => pyStrip(line)));
  for (const candidate of candidates) {
    if (!candidate || !"[{".includes(candidate[0] as string)) continue;
    let data: unknown;
    try {
      data = loadJson(candidate);
    } catch {
      continue;
    }
    const messages = Array.isArray(data) ? data : [data];
    for (const message of [...messages].reverse()) {
      if (!isDict(message) || message.type !== "result") continue;
      let result: unknown = "result" in message ? message.result : "";
      if (typeof result !== "string") result = pyJsonDumps(result, { ensureAscii: false });
      let structured: unknown = message.structured_result;
      if (structured === undefined || structured === null) structured = maybeJsonObject(result as string);
      const sessionId = message.session_id;
      return [
        result as string,
        pyTruthy(message.is_error ?? false),
        structured,
        typeof sessionId === "string" ? sessionId : "",
      ];
    }
  }
  return ["", true, null, ""];
}

/** Seconds between liveness callbacks while a streaming run is silent. */
export const _ACTIVITY_HEARTBEAT = 1.0;

/** Cap for one activity line handed to `on_activity`. */
export const _ACTIVITY_SUMMARY_MAX = 160;

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;
const CONTROL_RE = /[\x00-\x1f\x7f]+/g;
const STREAM_FALLBACK_RE = /output-format|include-partial|stream-json/i;

/** Collapse `text` to a single sanitised line of at most `limit` chars. */
export function _oneLine(text: string, limit: number = _ACTIVITY_SUMMARY_MAX): string {
  let out = text.replace(ANSI_RE, "").replace(CONTROL_RE, " ");
  out = pySplitWhitespace(out).join(" ");
  return cpLength(out) <= limit ? out : `…${cpSlice(out, -(limit - 1))}`;
}

/** Lines the feed remembers (the UI shows the last few of them). */
export const _ACTIVITY_FEED_LINES = 10;

/**
 * Rolling, line-oriented log of what the agent is doing.
 *
 * The assistant's text is split into lines as it streams (a newline ends a line; a very long unbroken run is cut at
 * {@link _ACTIVITY_SUMMARY_MAX} characters), and every tool use adds a `tool: <name>` line. Only the assistant's own
 * text and the *name* of a tool are recorded — never tool input (shell commands can carry secrets) and never
 * thinking.
 */
export class _ActivityFeed {
  _lines: string[] = [];
  _partial = "";

  private commit(raw: string): void {
    const line = _oneLine(raw);
    if (line) {
      this._lines.push(line);
      while (this._lines.length > _ACTIVITY_FEED_LINES) this._lines.shift();
    }
  }

  /** Flush the unfinished text line, then add `line` on its own row. */
  note(line: string): void {
    this.commit(this._partial);
    this._partial = "";
    this.commit(line);
  }

  /** Append streamed assistant text, committing every finished line. */
  text(delta: string): void {
    const pieces = (this._partial + delta).split("\n");
    this._partial = pieces.pop() as string;
    for (const raw of pieces) this.commit(raw);
    while (cpLength(this._partial) > _ACTIVITY_SUMMARY_MAX) {
      this.commit(cpSlice(this._partial, 0, _ACTIVITY_SUMMARY_MAX));
      this._partial = cpSlice(this._partial, _ACTIVITY_SUMMARY_MAX);
    }
  }

  /** The feed as newline-separated lines, oldest first. */
  render(): string {
    const lines = [...this._lines];
    const tail = _oneLine(this._partial);
    if (tail) lines.push(tail);
    return lines.slice(-_ACTIVITY_FEED_LINES).join("\n");
  }
}

/** Record `tool: <name>` once. Never records tool input. */
function noteTool(feed: _ActivityFeed, name: unknown): boolean {
  if (typeof name !== "string" || !name) return false;
  const label = `tool: ${_oneLine(name, 60)}`;
  if (feed._lines.length > 0 && feed._lines[feed._lines.length - 1] === label && !feed._partial) return false;
  feed.note(label);
  return true;
}

/**
 * Record one stream-json event into `feed`; return whether it changed. Unknown event shapes change nothing and merely
 * act as a heartbeat.
 */
export function _feedStreamEvent(message: unknown, feed: _ActivityFeed): boolean {
  if (!isDict(message)) return false;
  const kind = message.type;
  if (kind === "stream_event") {
    const event = message.event;
    if (!isDict(event)) return false;
    const delta = event.delta;
    if (isDict(delta) && delta.type === "text_delta" && typeof delta.text === "string") {
      feed.text(delta.text);
      return true;
    }
    // The tool name arrives when the call starts. Recording it here means a long write is not a blank header until
    // the tool finally returns. The input itself is never recorded.
    const block = event.content_block;
    if (event.type === "content_block_start" && isDict(block) && block.type === "tool_use") {
      return noteTool(feed, block.name);
    }
    return false;
  }
  if (kind === "assistant") {
    const body = message.message;
    const content = isDict(body) ? body.content : null;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (isDict(block) && block.type === "tool_use" && noteTool(feed, block.name)) return true;
      }
    }
    return false;
  }
  if (kind === "system") {
    feed.note("starting");
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Process handling
// ---------------------------------------------------------------------------

/** Python `OSError` text for a failed `execve` (`[Errno 2] No such file or directory: 'qwen'`). */
function osErrorText(error: NodeJS.ErrnoException, file: string): string {
  const errno = error.errno !== undefined ? Math.abs(error.errno) : undefined;
  const table: Record<string, string> = {
    ENOENT: "No such file or directory",
    EACCES: "Permission denied",
    ENOEXEC: "Exec format error",
    ENOTDIR: "Not a directory",
    E2BIG: "Argument list too long",
    EAGAIN: "Resource temporarily unavailable",
    ENOMEM: "Cannot allocate memory",
    EPERM: "Operation not permitted",
    ENAMETOOLONG: "File name too long",
    ELOOP: "Too many levels of symbolic links",
    EISDIR: "Is a directory",
  };
  const reason = error.code ? table[error.code] : undefined;
  const number = error.code ? (os.constants.errno as Record<string, number>)[error.code] : errno;
  if (reason !== undefined && number !== undefined) return `[Errno ${number}] ${reason}: ${pyRepr(file)}`;
  return error.message;
}

function signalNumber(signal: NodeJS.Signals | null): number {
  if (!signal) return -1;
  const value = (os.constants.signals as Record<string, number>)[signal];
  return value === undefined ? -1 : -value;
}

/** Minimal `subprocess.Popen` stand-in for a headless `qwen` run. */
export class HeadlessProcess {
  readonly pid: number;
  readonly argv: string[];
  returncode: number | null = null;
  readonly stdout: Readable;
  readonly stderr: Readable;
  private readonly exited: Promise<void>;
  private readonly closed: Promise<void>;
  private collected: Promise<[string, string]> | null = null;

  constructor(child: ChildProcess, argv: string[]) {
    this.argv = argv;
    this.pid = child.pid as number;
    this.stdout = child.stdout as Readable;
    this.stderr = child.stderr as Readable;
    this.exited = new Promise((resolve) => {
      child.once("exit", (code, signal) => {
        this.returncode = code !== null ? code : signalNumber(signal);
        resolve();
      });
    });
    this.closed = new Promise((resolve) => {
      child.once("close", () => resolve());
    });
    child.on("error", () => {});
  }

  /** `Popen(...)`: resolves once the child is running; rejects with the `execve` failure. */
  static spawn(argv: string[], opts: { cwd?: string | null; env?: Record<string, string> | null }): Promise<HeadlessProcess> {
    return new Promise((resolve, reject) => {
      const [file, ...args] = argv as [string, ...string[]];
      let child: ChildProcess;
      try {
        child = spawn(file, args, {
          cwd: opts.cwd != null ? String(opts.cwd) : undefined,
          env: opts.env ?? undefined,
          stdio: ["ignore", "pipe", "pipe"],
          detached: process.platform !== "win32",
        });
      } catch (exc) {
        reject(Object.assign(new Error(osErrorText(exc as NodeJS.ErrnoException, file)), { cause: exc }));
        return;
      }
      child.once("error", (error) => {
        reject(Object.assign(new Error(osErrorText(error as NodeJS.ErrnoException, file)), { cause: error }));
      });
      child.once("spawn", () => {
        resolve(new HeadlessProcess(child, argv));
      });
    });
  }

  /** `Popen.communicate(timeout)`: collect both streams until EOF; `TimeoutExpired` leaves collection running. */
  async communicate(timeout?: number | null): Promise<[string, string]> {
    if (this.collected === null) this.collected = this.collect();
    if (timeout == null) return await this.collected;
    return await withTimeout(this.collected, timeout, this.argv[0] as string);
  }

  /** `Popen.wait(timeout)`. */
  async wait(timeout?: number | null): Promise<number> {
    if (timeout == null) await this.exited;
    else await withTimeout(this.exited, timeout, this.argv[0] as string);
    return this.returncode as number;
  }

  private collect(): Promise<[string, string]> {
    const gather = (stream: Readable): { text: () => string } => {
      const decoder = new TextPipeDecoder();
      const parts: string[] = [];
      stream.on("data", (chunk: Buffer) => parts.push(decoder.write(chunk)));
      stream.on("end", () => parts.push(decoder.end()));
      stream.on("error", () => {});
      return { text: () => parts.join("") };
    };
    const out = gather(this.stdout);
    const err = gather(this.stderr);
    return this.closed.then(() => [out.text(), err.text()] as [string, string]);
  }
}

/**
 * CPython hands a wait timeout to `epoll.poll`, which takes whole milliseconds as a C `int`: an infinite timeout fails in
 * `math.ceil`, anything above `INT_MAX` ms raises `OverflowError: timeout is too large`. Node's own timer would instead
 * clamp to 1 ms with a `TimeoutOverflowWarning` and kill the child immediately.
 */
function checkPollTimeout(timeoutSeconds: number): void {
  if (timeoutSeconds === Infinity || timeoutSeconds === -Infinity) {
    throw new PyOverflowError("cannot convert float infinity to integer");
  }
  if (Math.ceil(timeoutSeconds * 1000) > 2147483647) throw new PyOverflowError("timeout is too large");
}

function withTimeout<T>(promise: Promise<T>, timeoutSeconds: number, cmd: string): Promise<T> {
  checkPollTimeout(timeoutSeconds);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutExpired(cmd, timeoutSeconds)), Math.max(timeoutSeconds, 0) * 1000);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Start `qwen` in its own process group / session.
 *
 * Qwen Code re-launches itself as a child `node` process that shares the pipes, and the agent's shell tools spawn
 * further descendants. Killing only the parent on a timeout leaves those running (verified: a "killed" research
 * round kept fetching for 13 more minutes), so the run gets its own group and {@link _killProcessTree} reaps all of
 * it.
 */
export async function _spawnHeadless(
  argv: string[],
  opts: { cwd?: string | null; env?: Record<string, string> | null },
): Promise<HeadlessProcess> {
  return await HeadlessProcess.spawn(argv, opts);
}

/** Terminate `proc` and every descendant; never throws. */
export async function _killProcessTree(proc: HeadlessProcess): Promise<void> {
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/T", "/F", "/PID", String(proc.pid)], { stdio: "ignore", timeout: 10_000 });
    } catch {
      /* never raises */
    }
    try {
      process.kill(proc.pid);
    } catch {
      /* never raises */
    }
    return;
  }
  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    /* group already gone */
  }
  try {
    await proc.wait(2.0);
  } catch {
    /* still running: escalate below */
  }
  let groupAlive = true;
  try {
    process.kill(-proc.pid, 0);
  } catch {
    groupAlive = false;
  }
  if (groupAlive) {
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      /* never raises */
    }
  }
}

function timeoutError(timeout: number): QwenCodeTimeoutError {
  return new QwenCodeTimeoutError(`Qwen Code did not finish within ${formatFixed0(timeout)}s and was terminated.`, {
    suggestion:
      "Retry with a shorter description or raise the limit with " + "EBX_QWEN_CODEGEN_TIMEOUT (seconds).",
  });
}

interface InterruptGuard {
  promise: Promise<never>;
  dispose(): void;
}

/** Rejects with {@link KeyboardInterrupt} when SIGINT arrives (Python raises it in the waiting thread). */
function interruptGuard(): InterruptGuard {
  let reject!: (reason: unknown) => void;
  const promise = new Promise<never>((_, rej) => {
    reject = rej;
  });
  promise.catch(() => {});
  const handler = (): void => reject(new KeyboardInterrupt());
  process.on("SIGINT", handler);
  return { promise, dispose: () => process.off("SIGINT", handler) };
}

/** Wait for `proc` (json mode); reap the whole tree on timeout / Ctrl-C. */
async function runBlocking(proc: HeadlessProcess, timeout: number): Promise<[string, string]> {
  const guard = interruptGuard();
  try {
    let result: [string, string];
    try {
      result = await Promise.race([proc.communicate(timeout), guard.promise]);
    } catch (exc) {
      if (exc instanceof TimeoutExpired) {
        await seams.killProcessTree(proc);
        try {
          await proc.communicate(5);
        } catch {
          /* best effort drain */
        }
        throw timeoutError(timeout);
      }
      await seams.killProcessTree(proc);
      throw exc;
    }
    return [result[0] || "", result[1] || ""];
  } finally {
    guard.dispose();
  }
}

type PumpEvent = ["out" | "err", string | null];

/**
 * Read stream-json events live, reporting activity; reap the tree on exit.
 *
 * Both pipes are drained into one queue (so a full stderr pipe can never deadlock the child), while the loop below
 * enforces the deadline and invokes `onActivity` — on every event and as a heartbeat once per second while the agent
 * is silent. Callback exceptions other than {@link KeyboardInterrupt} are ignored: a broken renderer must never fail
 * the run. `stream_event` lines (one per token) are not retained, keeping `raw_stdout` bounded.
 */
async function runStreaming(
  proc: HeadlessProcess,
  timeout: number,
  onActivity: (summary: string) => void,
): Promise<[string, string]> {
  const events = new AsyncQueue<PumpEvent>();

  const pump = (stream: Readable, tag: "out" | "err"): void => {
    const decoder = new TextPipeDecoder();
    let pending = "";
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      if (tag === "out") {
        pending += decoder.end();
        if (pending) events.put([tag, pending]);
      } else {
        const rest = decoder.end();
        if (rest) events.put([tag, rest]);
      }
      events.put([tag, null]);
    };
    stream.on("data", (chunk: Buffer) => {
      const text = decoder.write(chunk);
      if (tag === "err") {
        if (text) events.put([tag, text]);
        return;
      }
      pending += text;
      let newline = pending.indexOf("\n");
      while (newline !== -1) {
        events.put([tag, pending.slice(0, newline + 1)]);
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
      }
    });
    stream.on("end", finish);
    stream.on("close", finish);
    stream.on("error", finish);
  };
  pump(proc.stdout, "out");
  pump(proc.stderr, "err");

  const outLines: string[] = [];
  const errLines: string[] = [];
  let openStreams = 2;
  const feed = new _ActivityFeed();
  const deadline = performance.now() / 1000 + timeout;

  const notify = (): void => {
    try {
      onActivity(feed.render());
    } catch (exc) {
      if (exc instanceof KeyboardInterrupt) throw exc;
    }
  };

  const guard = interruptGuard();
  try {
    while (openStreams) {
      const remaining = deadline - performance.now() / 1000;
      if (remaining <= 0) {
        await seams.killProcessTree(proc);
        throw timeoutError(timeout);
      }
      const item = await Promise.race([
        events.get(Math.min(remaining, _ACTIVITY_HEARTBEAT) * 1000),
        guard.promise,
      ]);
      if (item === QUEUE_EMPTY) {
        notify();
        continue;
      }
      const [tag, line] = item;
      if (line === null) {
        openStreams -= 1;
        continue;
      }
      if (tag === "err") {
        errLines.push(line);
        continue;
      }
      const stripped = pyStrip(line);
      let parsed: unknown = null;
      if (stripped.startsWith("{")) {
        try {
          parsed = loadJson(stripped);
        } catch {
          parsed = null;
        }
      }
      if (!(isDict(parsed) && parsed.type === "stream_event")) outLines.push(line);
      _feedStreamEvent(parsed, feed);
      notify();
    }
    try {
      await Promise.race([proc.wait(Math.max(deadline - performance.now() / 1000, 1.0)), guard.promise]);
    } catch (exc) {
      if (exc instanceof TimeoutExpired) {
        await seams.killProcessTree(proc);
        throw timeoutError(timeout);
      }
      throw exc;
    }
  } catch (exc) {
    await seams.killProcessTree(proc);
    throw exc;
  } finally {
    guard.dispose();
  }
  return [outLines.join(""), errLines.join("")];
}

/**
 * Environment variables a scrubbed agent process may inherit: what a CLI needs to run, reach the network through the
 * user's proxy/CA setup, and — because `credentials.source == "environment"` relies on inheritance — the
 * model-provider variables Qwen Code itself reads.
 */
export const _CLEAN_ENV_EXACT: ReadonlySet<string> = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LANGUAGE", "TERM", "TMPDIR",
  "TEMP", "TMP", "TZ", "COLORTERM", "NO_COLOR", "CI",
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
  "http_proxy", "https_proxy", "all_proxy", "no_proxy",
  "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "NODE_EXTRA_CA_CERTS",
  "SYSTEMROOT", "COMSPEC", "PATHEXT", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
  "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL",
  "DASHSCOPE_API_KEY", "BAILIAN_CODING_PLAN_API_KEY",
]); // prettier-ignore
const CLEAN_ENV_PREFIXES: readonly string[] = ["LC_", "XDG_"];

/**
 * Return `environ` (default: the process environment) reduced to an allow-list.
 *
 * Cloud, registry and VCS credentials (`ALICLOUD_*`, `E2B_*`, `ACR_*`, `AWS_*`, `GITHUB_TOKEN` ...) are dropped: an
 * agent that reads untrusted repository text must not hold them.
 */
export function scrubbedEnviron(environ?: Readonly<Record<string, string | undefined>> | null): Record<string, string> {
  const source = environ == null ? process.env : environ;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (_CLEAN_ENV_EXACT.has(key) || CLEAN_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      result[key] = value;
    }
  }
  return result;
}

export interface RunHeadlessOptions {
  binary?: string | null;
  env?: Readonly<Record<string, string>> | null;
  cwd?: string | null;
  timeout?: number;
  maxSessionTurns?: number | null;
  sessionId?: string | null;
  resume?: string | null;
  jsonSchema?: Readonly<Record<string, unknown>> | string | null;
  onActivity?: ((summary: string) => void) | null;
  cleanEnv?: boolean;
}

/**
 * Run `qwen` in headless JSON mode and return its raw result.
 *
 * The subprocess is spawned with an argv list (no shell), a bounded cwd, an explicit timeout, and — when credentials
 * were stored by ebx — the `OPENAI_*` variables merged into a copy of the current environment. `cleanEnv` starts the
 * child from {@link scrubbedEnviron} instead of the full process environment (`env` is still merged on top).
 * `onActivity` receives a newline-separated, sanitised feed of what the agent is doing on every event and once per
 * second while it is silent; passing it switches the run to `stream-json`. Either way the whole process tree is
 * terminated on a timeout or SIGINT ({@link KeyboardInterrupt}).
 *
 * @throws QwenCodeNotInstalledError When no executable can be located.
 * @throws QwenCodeTimeoutError When the run exceeds `timeout` (E2007 subclass).
 * @throws QwenCodeStartupError When the process cannot be spawned (E2007 subclass).
 * @throws AICodegenError On a missing cwd or any other run failure.
 */
export async function runQwenCodeHeadless(prompt: string, opts: RunHeadlessOptions = {}): Promise<QwenCodeRunResult> {
  const timeout = opts.timeout ?? 600.0;
  const binaryPath = opts.binary != null ? String(opts.binary) : seams.findQwenCodeBinary();
  if (binaryPath == null) {
    throw new QwenCodeNotInstalledError("Qwen Code executable was not found on PATH or in ~/.ebx/bin.", {
      suggestion:
        "Re-run the command in a terminal to install it, or install " +
        `manually: ${seams.officialInstallCommand()}`,
    });
  }
  const cwd = opts.cwd;
  if (cwd != null && !isDir(String(cwd))) {
    throw new AICodegenError(`Working directory does not exist: ${cwd}`);
  }

  let runEnv: Record<string, string> | null;
  if (opts.cleanEnv) {
    runEnv = { ...scrubbedEnviron(), ...(opts.env ?? {}) };
  } else {
    runEnv = opts.env && Object.keys(opts.env).length > 0 ? ({ ...process.env, ...opts.env } as Record<string, string>) : null;
  }
  const onActivity = opts.onActivity;

  const attempt = async (stream: boolean): Promise<[number | null, string, string]> => {
    const argv = _buildHeadlessCommand(binaryPath, prompt, {
      maxSessionTurns: opts.maxSessionTurns,
      sessionId: opts.sessionId,
      resume: opts.resume,
      jsonSchema: opts.jsonSchema,
      stream,
    });
    logger.debug("Running Qwen Code headless via %s (stream=%s)", argv[0], stream ? "True" : "False");
    let proc: HeadlessProcess;
    try {
      proc = await seams.spawnHeadless(argv, { cwd, env: runEnv });
    } catch (exc) {
      throw new QwenCodeStartupError(`Failed to start Qwen Code: ${excStr(exc)}`);
    }
    let stdout: string;
    let stderr: string;
    if (stream && onActivity != null) {
      [stdout, stderr] = await runStreaming(proc, timeout, onActivity);
    } else {
      [stdout, stderr] = await runBlocking(proc, timeout);
    }
    return [proc.returncode, stdout, stderr];
  };

  const streaming = onActivity != null;
  let [exitCode, stdout, stderr] = await attempt(streaming);
  let parsed = _parseHeadlessOutput(stdout);
  if (streaming && exitCode !== 0 && parsed[1] && STREAM_FALLBACK_RE.test(stderr)) {
    // An older qwen that rejects the stream flags: run once more in plain json mode (the caller only loses the live
    // text).
    logger.debug("qwen rejected stream-json; retrying with --output-format json");
    [exitCode, stdout, stderr] = await attempt(false);
    parsed = _parseHeadlessOutput(stdout);
  }

  const [text, isError, structured, reportedSessionId] = parsed;
  return new QwenCodeRunResult({
    text,
    isError,
    exitCode: exitCode as number,
    rawStdout: stdout,
    rawStderr: stderr,
    structured,
    sessionId: reportedSessionId,
  });
}

/**
 * Patch points mirroring the module-level names Python tests monkeypatch (`monkeypatch.setattr(qwen_code, "x", ...)`).
 * Every internal call and every cross-module call goes through this object, so replacing an entry intercepts all
 * callers.
 */
export const seams = {
  which: whichImpl as (cmd: string) => string | null,
  findQwenCodeBinary: findQwenCodeBinary as (opts?: { binDir?: string | null; windows?: boolean | null }) => string | null,
  detectStandaloneTarget: detectStandaloneTarget as (opts?: { system?: string | null; machine?: string | null }) => string | null,
  officialInstallCommand: officialInstallCommand as (opts?: { windows?: boolean | null }) => string,
  downloadToFile: _downloadToFile as (url: string, dest: string, opts: { timeout: number }) => Promise<void>,
  httpGetText: _httpGetText as (url: string, opts: { timeout: number }) => Promise<string>,
  downloadAndInstallStandalone: downloadAndInstallStandalone as (opts?: {
    target?: string | null;
    binDir?: string | null;
    timeout?: number;
    onProgress?: ((message: string) => void) | null;
  }) => Promise<string>,
  resolveQwenCodeCredentials: resolveQwenCodeCredentials as (opts?: Parameters<typeof resolveQwenCodeCredentials>[0]) => QwenCodeCredentials,
  spawnHeadless: _spawnHeadless as (
    argv: string[],
    opts: { cwd?: string | null; env?: Record<string, string> | null },
  ) => Promise<HeadlessProcess>,
  killProcessTree: _killProcessTree as (proc: HeadlessProcess) => Promise<void>,
  runQwenCodeHeadless: runQwenCodeHeadless as (prompt: string, opts?: RunHeadlessOptions) => Promise<QwenCodeRunResult>,
};

