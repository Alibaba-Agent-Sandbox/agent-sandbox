/**
 * CLI Evidence Cases: single source of truth for the CLI input -> output evidence harness (port of
 * `scripts/evidence_cases.py`).
 *
 * Defines `EvidenceCase`, the full registry (every case of the Python registry, same order and golden names), the mock
 * builders (the Python `run_sync`-patch pattern becomes spies on `Sandbox.create` / `Sandbox.connect` / the transport
 * stack, because the Node port has no `run_sync` bridge) and `normalize()` / `formatResult()`, which mask the
 * non-deterministic fragments.
 *
 * Used by `test_evidence_snapshots.test.ts` (golden comparison) and by `scripts/capture-cli-evidence.mjs` (Markdown
 * evidence docs, through `tests/test_cli_evidence/capture_cli_evidence.capture.ts`).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { vi } from "vitest";

import * as clarify from "../../src/agent/clarify.js";
import { ClarifyAssessment } from "../../src/agent/clarify.js";
import * as codegen from "../../src/agent/codegen.js";
import { CodegenResult } from "../../src/agent/codegen.js";
import * as qwenCode from "../../src/agent/qwen_code.js";
import { QwenCodeCredentials } from "../../src/agent/qwen_code.js";
import { Sandbox } from "../../src/api/sandbox.js";
import * as mcpMod from "../../src/cli/commands/mcp.js";
import * as template from "../../src/providers/alicloud_express/cli/template.js";
import { cli } from "../../src/cli/main.js";
import { replSeams } from "../../src/cli/repl.js";
import {
  AuthenticationError,
  CommandTimeoutError,
  EnvdRpcError,
  QuotaExceededError,
  TemplateNotFoundError,
} from "../../src/models/errors.js";
import { ProcessResult } from "../../src/models/process.js";
import { SandboxInfo } from "../../src/models/sandbox.js";
import * as protocolSandbox from "../../src/providers/shared/e2b/sandbox.js";
import * as transportAuth from "../../src/providers/alicloud_express/auth.js";
import * as transportConfig from "../../src/transport/config.js";
import { _setProjectEnvFile, resetConfig } from "../../src/transport/config.js";
import * as transportHttp from "../../src/transport/http.js";
import { Request, Response } from "../../src/transport/_httpx.js";
import { DEFAULT_INDEX_URL, _setIndexCacheDir } from "../../src/utils/template_index.js";
import { _setTemplateCacheDir } from "../../src/utils/registry.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { patchConfig, storagePatch } from "../helpers/configSupport.js";
import { patchHttpxAsyncClient, patchedAsyncClient, restoreHttpx } from "../_support/patch.js";

// ═══════════════════════════════════════════════════════════════════════════
// Data types
// ═══════════════════════════════════════════════════════════════════════════

/** The `{"command": [...]}` environment a mock context may yield (replaces the argv of the case). */
export interface MockEnv {
  command?: string[];
}

/** A set-up mock: `restore()` undoes every patch (the Python `with ...:` exit). */
export interface MockHandle {
  env: MockEnv;
  restore: () => void | Promise<void>;
}

export type MockSetup = () => MockHandle | Promise<MockHandle>;

/** A single CLI evidence case. */
export interface EvidenceCase {
  command: string[];
  description: string;
  /** `A` = offline deterministic, `B` = backend-dependent (mocked). */
  category: "A" | "B";
  mock_setup: MockSetup | null;
  /** Golden file base name (no extension). */
  output_file: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Output helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Python `str.splitlines()` (the only separators that occur in CLI output). */
function splitlines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Python `str.strip()` for the whitespace that can occur in CLI output. */
const pyStrip = (text: string): string => text.replace(/^\s+|\s+$/g, "");

/** Mask non-deterministic fragments for golden-file comparison. */
export function normalize(raw: string): string {
  let text = raw;
  // Sandbox IDs
  text = text.replace(/sbx-[a-z0-9-]{6,}/g, "sbx-XXXXX");
  // ISO timestamps
  text = text.replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)?/g, "YYYY-MM-DDTHH:MM:SS");
  // Envd / sandbox URLs
  text = text.replace(/https:\/\/\d+-sbx-[a-z0-9.-]+[^\s"']*/g, "https://ENVD_URL");
  text = text.replace(/https:\/\/sbx-[a-z0-9.-]+[^\s"']*/g, "https://ENVD_URL");
  // execution_time in JSON
  text = text.replace(/"execution_time":\s*[\d.]+/g, '"execution_time": 0.0');
  // Temp paths (macOS /var/folders, Linux /tmp)
  text = text.replace(/\/(?:tmp|var\/folders)\/[^\s"']+/g, "/TMPPATH");
  // Home dirs
  text = text.replace(/\/Users\/[^\s/"']+/g, "/HOME");
  text = text.replace(new RegExp("C:\\\\" + "Users\\\\[^\\s\\\\\"']+", "g"), "/HOME");
  // Strip per-line trailing whitespace
  text = splitlines(text)
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n");
  return pyStrip(text) ? `${pyStrip(text)}\n` : "\n";
}

/** Combine stdout / exit_code / stderr into a single golden-file string. */
export function formatResult(stdout: string, stderr: string, exitCode: number): string {
  const parts: string[] = [];
  if (stdout) parts.push(stdout.replace(/\n+$/, ""));
  parts.push(`[exit_code:${exitCode}]`);
  if (pyStrip(stderr)) parts.push(`[stderr]\n${stderr.replace(/\s+$/, "")}`);
  return `${parts.join("\n")}\n`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Patch plumbing
// ═══════════════════════════════════════════════════════════════════════════

type Fn = ReturnType<typeof vi.fn>;
const spyAny = (o: object, k: string): Fn => vi.spyOn(o as Record<string, (...a: unknown[]) => unknown>, k) as unknown as Fn;

/** Collects undo actions; `restore()` runs them in reverse order. */
class Patches {
  private undo: Array<() => void> = [];
  add(fn: () => void): void {
    this.undo.push(fn);
  }
  handle(env: MockEnv = {}): MockHandle {
    return {
      env,
      restore: () => {
        for (const fn of this.undo.reverse()) fn();
        this.undo = [];
        vi.restoreAllMocks();
        restoreHttpx();
      },
    };
  }
}

function seamPatch<T extends object>(patches: Patches, seams: T, over: Partial<T>): void {
  const saved: Partial<T> = {};
  for (const key of Object.keys(over) as Array<keyof T>) {
    saved[key] = seams[key];
    seams[key] = over[key] as T[keyof T];
  }
  patches.add(() => Object.assign(seams, saved));
}

// ═══════════════════════════════════════════════════════════════════════════
// Sandbox mock builder
// ═══════════════════════════════════════════════════════════════════════════

interface MockSandbox {
  id: string;
  status: string;
  url: string | null;
  info: SandboxInfo;
  files: { write: Fn; readBytes: Fn };
  commands: { run: Fn | ((...a: unknown[]) => Promise<ProcessResult>) };
  kill: Fn;
  [key: string]: unknown;
}

/** Build a realistic mock Sandbox with SandboxInfo. */
function _makeSb(sid = "sbx-ev-001", tmpl = "base", status = "running", region = "cn-hangzhou"): MockSandbox {
  const sbInfo = SandboxInfo.modelValidate({
    sandboxID: sid,
    templateID: tmpl,
    status,
    region,
    timeout: 300,
    envdUrl: `https://${sid}.${region}.e2b.fc.aliyuncs.com`,
    envdAccessToken: "tok-ev",
  });
  return {
    id: sbInfo.sandbox_id,
    status: sbInfo.status,
    url: sbInfo.envd_url,
    info: sbInfo,
    files: { write: vi.fn().mockResolvedValue(undefined), readBytes: vi.fn().mockResolvedValue(Buffer.from("downloaded-content")) },
    commands: { run: vi.fn() },
    kill: vi.fn().mockResolvedValue(undefined),
  };
}

const asSandbox = (sb: unknown): Sandbox => sb as Sandbox;

// ═══════════════════════════════════════════════════════════════════════════
// Generic mock factories
// ═══════════════════════════════════════════════════════════════════════════

/** Process-environment variables that could leak into config reads; every `_cfg()` clears them all. */
const _CFG_ENV_VARS = [
  "ABX_SANDBOX_API_KEY",
  "ABX_SANDBOX_BASE_URL",
  "ABX_SANDBOX_DOMAIN",
  "ABX_HTTP_TIMEOUT",
  "ALIBABA_CLOUD_REGION_ID",
  "E2B_API_KEY",
  "E2B_API_URL",
  "E2B_DOMAIN",
  "SANDBOX_API_KEY",
  "SANDBOX_API_BASE_URL",
  "SANDBOX_REGION",
  "SANDBOX_HTTP_TIMEOUT",
  "ALICLOUD_ACCESS_KEY_ID",
  "ALICLOUD_ACCESS_KEY_SECRET",
  "AccessKey",
  "AccessSecret",
  "GITHUB_TOKEN",
  "ABX_LLM_API_KEY",
  "ABX_LLM_BASE_URL",
  "ABX_LLM_MODEL",
  "BAILIAN_CODING_PLAN_API_KEY",
  "DASHSCOPE_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
] as const;

function mkTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
}

/** Add temp-dir cleanup to `patches`. */
function tmpDir(patches: Patches, prefix = "abx-evidence-"): string {
  const dir = mkTmp(prefix);
  patches.add(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Config command mock: points `_CONFIG_FILE` / `_ABX_DIR` / `_ENV_FILE` (and the project `.env`) at a temp dir.
 * `env` is the content of the `~/.abx/.env` file; `extraEnv` injects process environment variables (the full
 * `_CFG_ENV_VARS` list is cleared first).
 */
function _cfgInto(patches: Patches, toml = "", env = "", extraEnv: Record<string, string> = {}): string {
  const tmp = tmpDir(patches);
  const cf = path.join(tmp, "config.toml");
  const ef = path.join(tmp, ".env");
  if (toml) fs.writeFileSync(cf, toml);
  if (env) fs.writeFileSync(ef, env);
  const saved = new Map<string, string | undefined>();
  for (const k of [..._CFG_ENV_VARS, ...Object.keys(extraEnv)]) {
    saved.set(k, process.env[k]);
    delete process.env[k];
  }
  Object.assign(process.env, extraEnv);
  patches.add(() => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  patches.add(patchConfig({ ...storagePatch(tmp, { env: ef }) }));
  const prevProject = transportConfig._PROJECT_ENV_FILE;
  _setProjectEnvFile(path.join(tmp, "no-project.env"));
  patches.add(() => _setProjectEnvFile(prevProject));
  return tmp;
}

function _cfg(toml = "", env = "", extraEnv: Record<string, string> = {}): MockSetup {
  return () => {
    const patches = new Patches();
    _cfgInto(patches, toml, env, extraEnv);
    return patches.handle();
  };
}

const _makeCfg = (): unknown => ({ api_key: "test-k", access_key_id: null, access_key_secret: null, region: "cn-hangzhou" });

/** `Sandbox.create` -> `sb` (the run_sync value of the create flow). */
function _create(sb: MockSandbox): MockSetup {
  return () => {
    const patches = new Patches();
    vi.spyOn(Sandbox, "create").mockResolvedValue(asSandbox(sb));
    return patches.handle();
  };
}

/** Any `Sandbox.create` call raises `exc`. */
function _createErr(exc: Error): MockSetup {
  return () => {
    const patches = new Patches();
    vi.spyOn(Sandbox, "create").mockRejectedValue(exc);
    return patches.handle();
  };
}

/** `Sandbox.connect` -> `sb`. */
function _connect(sb: MockSandbox): MockSetup {
  return () => {
    const patches = new Patches();
    vi.spyOn(Sandbox, "connect").mockResolvedValue(asSandbox(sb));
    vi.spyOn(Sandbox, "killById").mockResolvedValue(undefined);
    return patches.handle();
  };
}

/** Protocol-chain mock (load_config -> auth -> http -> proto) whose `list` yields `infos`. */
function _protoList(infos: SandboxInfo[]): MockSetup {
  return () => {
    const patches = new Patches();
    vi.spyOn(Sandbox, "list").mockResolvedValue(infos);
    return patches.handle();
  };
}

// ─── specialised mocks ────────────────────────────────────────────────────

function _mcpInstallCursor(): MockSetup {
  return () => {
    // `mcp install` resolves the path through the module-level IDE map built from `os.homedir()`; HOME is pointed at a
    // temp dir (this also isolates `_read_api_key`'s ~/.abx/.env lookup), like Python's `Path.home` patch.
    const patches = new Patches();
    const tmp = tmpDir(patches);
    const saved: Record<string, string | undefined> = { HOME: process.env["HOME"], USERPROFILE: process.env["USERPROFILE"] };
    process.env["HOME"] = tmp;
    process.env["USERPROFILE"] = tmp;
    patches.add(() => {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
    return patches.handle();
  };
}

function _mcpStatus(): MockSetup {
  return () => {
    // `mcp status` iterates the module-level IDE config map: stage valid installed-config files in a temp dir so
    // `installed_*` is deterministically true everywhere. Key order fixes the `installed_*` field order.
    const patches = new Patches();
    const tmp = tmpDir(patches);
    fs.writeFileSync(path.join(tmp, "cursor.json"), JSON.stringify({ mcpServers: { "agent-sandbox": { command: "abx" } } }));
    fs.writeFileSync(path.join(tmp, "claude.json"), JSON.stringify({ mcpServers: { "agent-sandbox": { command: "abx" } } }));
    fs.writeFileSync(path.join(tmp, "vscode.json"), JSON.stringify({ servers: { "agent-sandbox": { type: "stdio", command: "abx" } } }));
    const original = mcpMod._IDE_CONFIG_MAP;
    mcpMod._setIdeConfigMap({
      cursor: () => path.join(tmp, "cursor.json"),
      claude: () => path.join(tmp, "claude.json"),
      vscode: () => path.join(tmp, "vscode.json"),
    });
    patches.add(() => mcpMod._setIdeConfigMap(original));
    vi.spyOn(mcpMod, "_readApiKey").mockReturnValue(null);
    // A developer's own `abx mcp start` must not change this golden.
    vi.spyOn(mcpMod, "_runningServer").mockReturnValue(null);
    return patches.handle();
  };
}

/**
 * Mock the AI codegen pipeline -> deploy -> `Sandbox.create`: the Qwen Code adapter (binary + credentials), the two
 * clarification seams (`run_research`, `evaluate`), the generation workspace, the codegen orchestrator, the build/deploy
 * pipeline and the sandbox creation, so the whole `abx create "<description>"` path runs offline. `assessment` is the
 * assessment the mocked round returns; `null` models a fully complete description.
 */
function _createCodegen(description = "运行 python", templateName = "abx-nl-python-ev001", assessment: ClarifyAssessment | null = null): MockSetup {
  return () => {
    const patches = new Patches();
    _cfgInto(patches);
    const sb = _makeSb("sbx-ev-001", templateName);
    // Stable placeholder workspace so evidence output is platform-neutral (the real path is
    // ~/.abx/generated/<slug>-<stamp>-<token>).
    const workdir = `/home/user/.abx/generated/${templateName}`;
    const gen = new CodegenResult({
      workdir,
      templateName,
      dockerfile: `${workdir}/Dockerfile`,
      templateYaml: `${workdir}/template.yaml`,
      description,
      rawOutput: "generated",
    });
    const creds = new QwenCodeCredentials({
      source: "qwen-stored",
      apiKey: "sk-ev",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen3-coder-plus",
    });
    const resolved = assessment ?? new ClarifyAssessment({ completeness: 1.0, question: null });
    seamPatch(patches, qwenCode.seams, {
      findQwenCodeBinary: vi.fn(() => "/opt/qwen/bin/qwen") as unknown as typeof qwenCode.seams.findQwenCodeBinary,
      resolveQwenCodeCredentials: vi.fn(() => creds) as unknown as typeof qwenCode.seams.resolveQwenCodeCredentials,
    });
    seamPatch(patches, codegen.seams, {
      prepareWorkdir: vi.fn(async () => [workdir, templateName]) as unknown as typeof codegen.seams.prepareWorkdir,
      generateTemplateFiles: vi.fn(async () => gen) as unknown as typeof codegen.seams.generateTemplateFiles,
    });
    seamPatch(patches, clarify.seams, {
      runResearch: vi.fn(async () => true) as unknown as typeof clarify.seams.runResearch,
      evaluate: vi.fn(async () => resolved) as unknown as typeof clarify.seams.evaluate,
    });
    vi.spyOn(template, "do_deploy").mockResolvedValue({ TemplateID: "tmpl-ev-ai-001", Status: "success" });
    vi.spyOn(template, "resolve_acr_namespace").mockReturnValue("acr-ev-ns");
    vi.spyOn(Sandbox, "create").mockResolvedValue(asSandbox(sb));
    return patches.handle();
  };
}

/** Mock: Qwen Code binary missing -> Quick Setup + E2005 (no deploy). */
function _createCodegenNotInstalled(): MockSetup {
  return () => {
    const patches = new Patches();
    seamPatch(patches, qwenCode.seams, {
      findQwenCodeBinary: vi.fn(() => null) as unknown as typeof qwenCode.seams.findQwenCodeBinary,
    });
    return patches.handle();
  };
}

/** Mock `Sandbox.connect` + `commands.run`. */
function _exec(stdout = "hello\n", stderr = "", exit_code = 0): MockSetup {
  return () => {
    const patches = new Patches();
    const sb = _makeSb();
    sb.commands.run = vi.fn().mockResolvedValue(new ProcessResult({ stdout, stderr, exit_code, execution_time: 0.1 }));
    vi.spyOn(Sandbox, "connect").mockResolvedValue(asSandbox(sb));
    return patches.handle();
  };
}

function _uploadFile(): MockSetup {
  return () => {
    const patches = new Patches();
    const sb = _makeSb();
    const tmp = tmpDir(patches);
    const fpath = path.join(tmp, "evidence-upload.py");
    fs.writeFileSync(fpath, "print('hello')\n");
    vi.spyOn(Sandbox, "connect").mockResolvedValue(asSandbox(sb));
    return patches.handle({ command: ["upload", "sbx-ev-001", fpath, "/app/script.py"] });
  };
}

function _uploadDir(): MockSetup {
  return () => {
    const patches = new Patches();
    const sb = _makeSb();
    const tmp = tmpDir(patches);
    fs.writeFileSync(path.join(tmp, "a.py"), "# a\n");
    fs.writeFileSync(path.join(tmp, "b.py"), "# b\n");
    vi.spyOn(Sandbox, "connect").mockResolvedValue(asSandbox(sb));
    return patches.handle({ command: ["upload", "sbx-ev-001", tmp, "/app/data/"] });
  };
}

function _downloadFile(): MockSetup {
  return () => {
    const patches = new Patches();
    const sb = _makeSb();
    const tmp = tmpDir(patches);
    const local = path.join(tmp, "result.csv");
    vi.spyOn(Sandbox, "connect").mockResolvedValue(asSandbox(sb));
    return patches.handle({ command: ["download", "sbx-ev-001", "/app/result.csv", local] });
  };
}

/**
 * Mock for `abx connect`: deterministic three-line REPL session. Line 1 (`ls /app`) succeeds and registers `ls` as a
 * session-verified executable; line 2 (`sl`) hits the structured envd "not found" error (single friendly notice plus
 * the spelling hint); line 3 exits. The REPL input seam is patched so no stdin is needed.
 */
function _connectRepl(): MockSetup {
  return () => {
    const patches = new Patches();
    const sb = _makeSb();
    const lsResult = new ProcessResult({ stdout: "app.py\n", stderr: "", exit_code: 0, execution_time: 0.1 });
    const missing = new EnvdRpcError("envd rejected process.Process/Start with HTTP 500", {
      status_code: 500,
      rpc_path: "/process.Process/Start",
      envd_error: { error: { code: 500, message: 'exec: "sl": executable file not found in $PATH' } },
    });
    sb.commands.run = vi.fn().mockResolvedValueOnce(lsResult).mockRejectedValueOnce(missing);
    vi.spyOn(Sandbox, "connect").mockResolvedValue(asSandbox(sb));
    const lines = ["ls /app", "sl", "exit"];
    seamPatch(patches, replSeams, {
      input: async () => {
        const next = lines.shift();
        if (next === undefined) throw new Error("StopIteration");
        return next;
      },
    });
    return patches.handle();
  };
}

/**
 * Mock for `abx run` / `abx sandbox command list`: exercises the REAL `Sandbox.runCommand` / `listCommands` dispatch. Only
 * the two HTTP helpers are stubbed; they emulate an in-sandbox SandboxServer registering `add(x:int, y:int=1)` and
 * `ping()`, or an unreachable server when `reachable` is false.
 */
function _runCmd(reachable = true): MockSetup {
  return () => {
    const patches = new Patches();
    const sb = _makeSb();
    sb["id"] = "sbx-ev-001";
    sb["_envd_token"] = { getHeaders: () => ({}) };
    const catalogue = [
      { name: "add", description: "Add two integers", args: [{ name: "x", type: "int", required: true, default: null, description: "" }, { name: "y", type: "int", required: false, default: 1, description: "" }] },
      { name: "ping", description: "Health check", args: [] },
    ];
    const proto = Sandbox.prototype as unknown as Record<string, (this: unknown, ...a: unknown[]) => unknown>;
    const unreachable = (): never => {
      throw new transportHttp.RequestError("connection refused");
    };
    sb["_fetchServerCommands"] = async () => (reachable ? catalogue : unreachable());
    sb["_callServerCommand"] = async (name: unknown, _port: unknown, kwargs: unknown) => {
      if (!reachable) return unreachable();
      const k = kwargs as Record<string, unknown>;
      if (name === "add") {
        return [{ is_success: true, status_code: 200 }, { result: Number(k["x"]) + Number(k["y"] ?? 1) }];
      }
      if (name === "ping") return [{ is_success: true, status_code: 200 }, { result: "pong" }];
      return [{ is_success: false, status_code: 404 }, { error: `Command '${String(name)}' not found`, type: "NotFound" }];
    };
    sb["_serverUnreachable"] = (port: unknown, cause: unknown) => proto["_serverUnreachable"]!.call(sb, port, cause);
    sb["runCommand"] = (name: unknown, kwargs: unknown, opts: unknown) => proto["runCommand"]!.call(sb, name, kwargs, opts);
    sb["listCommands"] = (opts: unknown) => proto["listCommands"]!.call(sb, opts);
    vi.spyOn(Sandbox, "connect").mockResolvedValue(asSandbox(sb));
    return patches.handle();
  };
}

function _killAll(): MockSetup {
  return () => {
    const patches = new Patches();
    const infos = [0, 1].map((i) =>
      SandboxInfo.modelValidate({ sandboxID: `sbx-all-${String(i).padStart(3, "0")}`, templateID: "base", status: "running", region: "cn-hangzhou" }),
    );
    const sb = _makeSb();
    vi.spyOn(Sandbox, "list").mockResolvedValue(infos);
    vi.spyOn(Sandbox, "connect").mockResolvedValue(asSandbox(sb));
    vi.spyOn(Sandbox, "killById").mockResolvedValue(undefined);
    return patches.handle();
  };
}

function _tmplBackend(json: unknown): MockSetup {
  return () => {
    const patches = new Patches();
    const http = { platformRequest: vi.fn(async () => ({ json: () => json, status_code: 200 })), close: vi.fn(async () => undefined) };
    spyAny(transportConfig, "loadConfig").mockReturnValue({ api_key: "k", access_key_id: null, access_key_secret: null, region: "cn-hangzhou" });
    spyAny(transportAuth, "createAuthProvider").mockReturnValue({});
    spyAny(transportHttp, "HttpClient").mockImplementation(function () {
      return http;
    });
    return patches.handle();
  };
}

function _tmplListBackend(): MockSetup {
  return _tmplBackend([
    { templateID: "tmpl-001", alias: "python-base", status: "ready" },
    { templateID: "tmpl-002", alias: "node-web", status: "ready" },
  ]);
}

function _tmplInfoBackend(): MockSetup {
  return _tmplBackend({ templateID: "tmpl-001", alias: "python-base", status: "ready", dockerfile: "FROM python:3.11-slim" });
}

// ─── GitHub rate-limit mocks ──────────────────────────────────────────────
// The anonymous rate limit is injected at the httpx boundary so the real production branches run: the template-index
// 403 branch and the tarball 403 branch both translate into the unified GitHubRateLimitError guidance.

/** A real `httpx.Response` shaped like GitHub's anonymous rate limit. */
function _rateLimitedResponse(url: string, status = 403): Response {
  return new Response(status, {
    request: new Request("GET", url),
    headers: { "X-RateLimit-Remaining": "0" },
    text: '{"message": "API rate limit exceeded for anonymous requests."}',
  });
}

function _tmplSearchRateLimited(): MockSetup {
  return () => {
    const patches = new Patches();
    _cfgInto(patches);
    const tmp = tmpDir(patches);
    const prevIndex = _setIndexCacheDir(tmp);
    patches.add(() => void _setIndexCacheDir(prevIndex));
    const savedUrl = process.env["ABX_TEMPLATE_INDEX_URL"];
    delete process.env["ABX_TEMPLATE_INDEX_URL"];
    patches.add(() => {
      if (savedUrl !== undefined) process.env["ABX_TEMPLATE_INDEX_URL"] = savedUrl;
    });
    patchHttpxAsyncClient(patchedAsyncClient(_rateLimitedResponse(DEFAULT_INDEX_URL)));
    return patches.handle();
  };
}

function _tmplInstallRateLimited(): MockSetup {
  return () => {
    const patches = new Patches();
    _cfgInto(patches);
    const url = "https://api.github.com/repos/alibaba-agent-sandbox/awesome-templates/tarball/v1.0";
    const tmp = tmpDir(patches);
    const prev = _setTemplateCacheDir(tmp);
    patches.add(() => void _setTemplateCacheDir(prev));
    patchHttpxAsyncClient(patchedAsyncClient(_rateLimitedResponse(url)));
    return patches.handle();
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Registry builder
// ═══════════════════════════════════════════════════════════════════════════

function _buildRegistry(): EvidenceCase[] {
  const E = (command: string[], description: string, category: "A" | "B", mock_setup: MockSetup | null, output_file: string): EvidenceCase => ({
    command,
    description,
    category,
    mock_setup,
    output_file,
  });
  const cases: EvidenceCase[] = [];

  // ── Help (36) ──────────────────────────────────────────────────────
  const help: Array<[string[], string]> = [
    [[], "abx"],
    [["create"], "create"],
    [["list"], "list"],
    [["info"], "info"],
    [["kill"], "kill"],
    [["exec"], "exec"],
    [["run"], "run"],
    [["connect"], "connect"],
    [["upload"], "upload"],
    [["download"], "download"],
    [["sandbox"], "sandbox"],
    [["sandbox", "command"], "sandbox-command"],
    [["sandbox", "command", "list"], "sandbox-command-list"],
    [["sandbox", "command", "run"], "sandbox-command-run"],
    [["sandbox", "files"], "sandbox-files"],
    [["sandbox", "process"], "sandbox-process"],
    [["provider"], "provider"],
    [["provider", "update"], "provider-update"],
    [["provider", "command"], "provider-command"],
    [["provider", "command", "list"], "provider-command-list"],
    [["provider", "command", "info"], "provider-command-info"],
    [["provider", "command", "run"], "provider-command-run"],
    [["config"], "config"],
    [["config", "get"], "config-get"],
    [["config", "set"], "config-set"],
    [["config", "list"], "config-list"],
    [["config", "init"], "config-init"],
    [["template"], "template"],
    [["template", "list"], "template-list"],
    [["template", "info"], "template-info"],
    [["template", "build"], "template-build"],
    [["template", "init"], "template-init"],
    [["template", "delete"], "template-delete"],
    [["template", "install"], "template-install"],
    [["mcp"], "mcp"],
    [["mcp", "deploy"], "mcp-deploy"],
    [["mcp", "install"], "mcp-install"],
    [["mcp", "start"], "mcp-start"],
    [["mcp", "stop"], "mcp-stop"],
    [["mcp", "status"], "mcp-status"],
    [["deploy"], "deploy"],
  ];
  for (const [cmd, name] of help) cases.push(E([...cmd, "--help"], `${name} --help`, "A", null, `help-${name}`));

  // ── Version (1) ────────────────────────────────────────────────────
  cases.push(E(["--version"], "--version", "A", null, "version"));

  // ── Config (20) ────────────────────────────────────────────────────
  cases.push(
    E(["config", "get", "region"], "config get region（默认值）", "A", _cfg(), "config-get-region"),
    E(["config", "get", "sandbox_api_key"], "config get sandbox_api_key（未设置）", "A", _cfg(), "config-get-apikey-unset"),
    E(
      ["config", "get", "sandbox_api_key"],
      "config get sandbox_api_key（已设置, masked）",
      "A",
      _cfg("", "ABX_SANDBOX_API_KEY=sk-test-abcdef123456\n"),
      "config-get-apikey-set",
    ),
    E(
      ["config", "get", "sandbox_api_key"],
      "config get sandbox_api_key（进程环境变量, masked）",
      "A",
      _cfg("", "", { ABX_SANDBOX_API_KEY: "sk-env-abcdef123456" }),
      "config-get-apikey-env",
    ),
    E(["config", "get", "unknown_key"], "config get unknown_key（错误）", "A", _cfg(), "config-get-unknown"),
    E(["config", "get", "qwen_code_model"], "config get qwen_code_model（已移除）", "A", _cfg(), "config-get-qwen-model"),
    E(["config", "get", "llm_model"], "config get llm_model（业务默认）", "A", _cfg(), "config-get-llm-model-unset"),
    E(["config", "set", "region", "cn-shanghai"], "config set region", "A", _cfg(), "config-set-region"),
    E(["config", "set", "llm_api_key", "sk-mykey12345678"], "config set llm_api_key（masked）", "A", _cfg(), "config-set-llm-apikey"),
    E(
      ["config", "set", "region", ""],
      'config set region ""（清除, 回落默认）',
      "A",
      _cfg('[transport]\nregion = "cn-shanghai"\n'),
      "config-set-empty-default",
    ),
    E(
      ["config", "set", "sandbox_api_key", ""],
      'config set sandbox_api_key ""（清除凭证）',
      "A",
      _cfg("", "ABX_SANDBOX_API_KEY=sk-test-abcdef123456\n"),
      "config-set-empty-credential",
    ),
    E(
      ["config", "set", "region", ""],
      'config set region ""（env 仍生效, 值不显示）',
      "A",
      _cfg('[transport]\nregion = "cn-shanghai"\n', "", { ALIBABA_CLOUD_REGION_ID: "cn-zhangjiakou" }),
      "config-set-empty-env",
    ),
    E(["config", "list"], "config list", "A", _cfg(), "config-list"),
    E(["--json", "config", "list"], "config list --json", "A", _cfg(), "config-list-json"),
    E(["config", "init"], "config init（非 TTY：打印非交互命令）", "A", _cfg(), "config-init"),
    E(["config", "set", "github_token", "ghp_evidence1234567890"], "config set github_token（masked）", "A", _cfg(), "config-set-github-token"),
    E(["config", "get", "github_token"], "config get github_token（未设置）", "A", _cfg(), "config-get-github-token-unset"),
    E(
      ["config", "get", "github_token"],
      "config get github_token（已设置, masked）",
      "A",
      _cfg("", "GITHUB_TOKEN=ghp_evidence1234567890\n"),
      "config-get-github-token-set",
    ),
    E(
      ["config", "set", "github_token", ""],
      'config set github_token ""（清除）',
      "A",
      _cfg("", "GITHUB_TOKEN=ghp_evidence1234567890\n"),
      "config-set-github-token-clear",
    ),
    E(["config", "set", "github_token"], "config set github_token（非 TTY：缺 VALUE）", "A", _cfg(), "config-set-github-token-missing-value"),
  );

  // ── MCP offline (3) ────────────────────────────────────────────────
  cases.push(
    E(["mcp", "install", "--target", "cursor"], "mcp install --target cursor", "A", _mcpInstallCursor(), "mcp-install-cursor"),
    E(["mcp", "status"], "mcp status", "A", _mcpStatus(), "mcp-status"),
    E(["--json", "mcp", "status"], "mcp status --json", "A", _mcpStatus(), "mcp-status-json"),
  );

  // ── Create (11) ─────────────────────────────────────────────────────
  // A description covering all six clarification facets (runtime, dependencies, entry command, ports, resources, data),
  // used by the cases that must reach a gate *after* the clarification step.
  const completeZh = "用 Python 3.12，预装 pandas 和 jupyter，入口命令 jupyter notebook，" + "端口 8888，2 核 4GB 内存，上传 data.csv 数据";
  // Mocked assessment for the "too vague" case: below the 80% gate, with a single question and a ready-to-use example.
  const incompleteAssessment = new ClarifyAssessment({
    completeness: 0.3,
    question: "需要暴露哪个端口？",
    missing: ["dependencies", "entry command", "ports", "resources", "data"],
    example:
      "Python 3.12 runtime with pandas and jupyter installed, entry command " +
      "'jupyter notebook --ip 0.0.0.0', port 8888, 2 CPU 4 GB memory, upload " +
      "a data.csv dataset",
  });
  cases.push(
    E(["create", "--template", "base"], "create --template base", "B", _create(_makeSb()), "create-template-base"),
    E(["--json", "create", "--template", "base"], "--json create --template base", "B", _create(_makeSb()), "create-template-base-json"),
    E(["create", "-y", "运行 python"], 'create NL "运行 python"（AI 生成模板）', "B", _createCodegen("运行 python", "abx-nl-python-ev001"), "create-nl-python"),
    E(
      ["create", "-y", "启动 Node.js 服务"],
      'create NL "启动 Node.js 服务"（AI 生成模板）',
      "B",
      _createCodegen("启动 Node.js 服务", "abx-nl-nodejs-ev001"),
      "create-nl-nodejs",
    ),
    E(["create", completeZh], "create NL 非交互描述完整（需确认）", "A", _createCodegen(completeZh, "abx-nl-python-ev001"), "create-nl-confirm-required"),
    E(
      ["create", "运行 python"],
      "create NL 非交互描述不完整（E2008 + 缺失项 + 示例）",
      "A",
      _createCodegen("运行 python", "abx-nl-python-ev001", incompleteAssessment),
      "create-nl-clarify-required",
    ),
    E(["create", "运行 python"], "create NL 未安装 Qwen Code（Quick Setup）", "A", _createCodegenNotInstalled(), "create-nl-not-installed"),
    E(["create", "-e", "FOO=bar", "--template", "base"], "create -e FOO=bar", "B", _create(_makeSb()), "create-env"),
    E(["create", "-m", "project=demo", "--template", "base"], "create -m project=demo", "B", _create(_makeSb()), "create-metadata"),
    E(["create", "-e", "INVALID", "--template", "base"], "create -e INVALID（格式错误）", "A", null, "create-env-invalid"),
    E(["create", "运行 python", "--template", "base"], "create 同时提供描述与 --template（拒绝）", "A", null, "create-nl-conflict"),
  );

  // ── List (4) ───────────────────────────────────────────────────────
  const sbInfos = [
    SandboxInfo.modelValidate({ sandboxID: "sbx-list-001", templateID: "python-base", status: "running", region: "cn-hangzhou" }),
    SandboxInfo.modelValidate({ sandboxID: "sbx-list-002", templateID: "node-web", status: "stopped", region: "cn-shanghai" }),
  ];
  cases.push(
    E(["list"], "list（有数据）", "B", _protoList(sbInfos), "list"),
    E(["--json", "list"], "--json list", "B", _protoList(sbInfos), "list-json"),
    E(["list", "--status", "running"], "list --status running", "B", _protoList([sbInfos[0]!]), "list-running"),
    E(["list"], "list（空）", "B", _protoList([]), "list-empty"),
  );

  // ── Info (2) ───────────────────────────────────────────────────────
  cases.push(
    E(["info", "sbx-ev-001"], "info sbx-ev-001", "B", _connect(_makeSb()), "info"),
    E(["--json", "info", "sbx-ev-001"], "--json info sbx-ev-001", "B", _connect(_makeSb()), "info-json"),
  );

  // ── Kill (3) ───────────────────────────────────────────────────────
  cases.push(
    E(["kill", "sbx-ev-001", "--yes"], "kill sbx-ev-001 --yes", "B", _connect(_makeSb()), "kill-single"),
    E(["kill", "--all", "--yes"], "kill --all --yes", "B", _killAll(), "kill-all"),
    E(["kill"], "kill（无 ID 错误）", "A", null, "kill-no-id"),
  );

  // ── Exec (4) ───────────────────────────────────────────────────────
  cases.push(
    E(["exec", "sbx-ev-001", "echo hello"], "exec 基本命令", "B", _exec(), "exec-basic"),
    E(["--json", "exec", "sbx-ev-001", "echo hello"], "--json exec", "B", _exec(), "exec-json"),
    E(["exec", "sbx-ev-001", "bad_cmd"], "exec 非零退出码", "B", _exec("", "command not found\n", 127), "exec-nonzero"),
    E(["exec", "--timeout", "10", "--cwd", "/tmp", "sbx-ev-001", "ls"], "exec --timeout --cwd", "B", _exec("file1\nfile2\n"), "exec-timeout-cwd"),
  );

  // ── Connect (1) ────────────────────────────────────────────────────
  cases.push(E(["connect", "sbx-ev-001"], "connect 交互会话（命令不存在 → 单次友好提示 + 拼写建议）", "B", _connectRepl(), "connect-repl"));

  // ── Run / command list (named commands registered on the sandbox server, 8) ──
  cases.push(
    E(["run", "sbx-ev-001", "add", "--arg", "x=2", "--arg", "y=3"], "run add --arg x=2 --arg y=3（服务端命令）", "B", _runCmd(), "run-dispatch"),
    E(["run", "sbx-ev-001", "ping"], "run ping（无参数）", "B", _runCmd(), "run-no-args"),
    E(["--json", "run", "sbx-ev-001", "add", "--json-args", '{"x": 4}'], "--json run add --json-args", "B", _runCmd(), "run-dispatch-json"),
    E(["run", "sbx-ev-001", "deploy"], "run deploy（命令名不存在）", "B", _runCmd(), "run-unknown-command"),
    E(["run", "sbx-ev-001", "add", "--arg", "badformat"], "run add --arg badformat（参数格式错误）", "A", null, "run-invalid-arg"),
    E(["run", "sbx-ev-001", "ping"], "run ping（沙箱内没有 server）", "B", _runCmd(false), "run-no-server"),
    E(["sandbox", "command", "list", "sbx-ev-001"], "sandbox command list", "B", _runCmd(), "command-list"),
    E(["sandbox", "command", "list", "sbx-ev-001"], "sandbox command list（沙箱内没有 server）", "B", _runCmd(false), "command-list-no-server"),
  );

  // ── Upload / Download (3) ──────────────────────────────────────────
  cases.push(
    E(["upload", "sbx-ev-001", "PLACEHOLDER", "/app/script.py"], "upload 文件", "B", _uploadFile(), "upload-file"),
    E(["upload", "sbx-ev-001", "PLACEHOLDER", "/app/data/"], "upload 目录", "B", _uploadDir(), "upload-dir"),
    E(["download", "sbx-ev-001", "/app/result.csv", "PLACEHOLDER"], "download 文件", "B", _downloadFile(), "download-file"),
  );

  // ── Template backend (3) ───────────────────────────────────────────
  cases.push(
    E(["template", "list"], "template list（后端）", "B", _tmplListBackend(), "template-list-backend"),
    E(["template", "info", "tmpl-001"], "template info tmpl-001", "B", _tmplInfoBackend(), "template-info-backend"),
    E(["template", "install", "base"], "template install base（内置）", "B", () => new Patches().handle(), "template-install-builtin"),
  );

  // ── GitHub rate-limit guidance (2) ─────────────────────────────────
  cases.push(
    E(["template", "search", "qwen"], "template search（匿名限流：统一引导）", "A", _tmplSearchRateLimited(), "template-search-rate-limit"),
    E(
      ["template", "install", "alibaba-agent-sandbox/awesome-templates//codex-agent-api@v1.0"],
      "template install owner/repo//subdir@ref（匿名限流）",
      "B",
      _tmplInstallRateLimited(),
      "template-install-rate-limit",
    ),
  );

  // ── Error cases (8) ────────────────────────────────────────────────
  cases.push(
    E(["create"], "create 无参数（显式用法错误，不再默认 base）", "A", null, "error-create-noargs"),
    E(["crate"], "未知顶层命令（拼写建议）", "A", null, "error-unknown-suggestion"),
    E(["frobnicate"], "未知顶层命令（固定命令集合 + abx --help 引导）", "A", null, "error-unknown-custom-hint"),
    E(["template", "init"], "顶层 init 已移除（使用 abx template init）", "A", null, "error-removed-init"),
    E(["create", "--template", "base"], "AuthenticationError", "B", _createErr(new AuthenticationError("Invalid API key")), "error-auth"),
    E(["create", "--template", "bad"], "TemplateNotFoundError", "B", _createErr(new TemplateNotFoundError("Template 'bad' not found")), "error-template-not-found"),
    E(["create", "--template", "base"], "QuotaExceededError", "B", _createErr(new QuotaExceededError("Sandbox quota exceeded")), "error-quota"),
    E(["exec", "sbx-ev-001", "sleep 999"], "CommandTimeoutError", "B", () => {
      const patches = new Patches();
      vi.spyOn(Sandbox, "connect").mockRejectedValue(new CommandTimeoutError("Command timed out after 60s"));
      return patches.handle();
    }, "error-timeout"),
  );

  return cases;
}

/** The registry (same order as the Python `REGISTRY`). */
export const REGISTRY: EvidenceCase[] = _buildRegistry();

/** Cases suitable for golden-file testing (deterministic only): mocked ones plus every category-A case. */
export function eligibleCases(): EvidenceCase[] {
  return REGISTRY.filter((c) => c.mock_setup !== null || c.category === "A");
}

/** Execute a single evidence case; returns `(stdout, stderr, exit_code)` (pure `stdout`, like `result.stdout`). */
export async function runCase(testCase: EvidenceCase): Promise<{ stdout: string; stderr: string; exit_code: number }> {
  resetConfig();
  const runner = new CliRunner();
  let cmd = [...testCase.command];
  let handle: MockHandle | null = null;
  try {
    if (testCase.mock_setup !== null) {
      handle = await testCase.mock_setup();
      if (handle.env.command) cmd = handle.env.command;
    }
    const result = await runner.invoke(cli, cmd, { prog_name: "abx" });
    return { stdout: result.stdout || "", stderr: result.stderr || "", exit_code: result.exit_code };
  } finally {
    if (handle) await handle.restore();
    resetConfig();
  }
}
