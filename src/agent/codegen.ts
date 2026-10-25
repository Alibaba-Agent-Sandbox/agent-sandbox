/**
 * AI code generation for `abx create --prompt "<description>"`.
 *
 * Port of `agent_sandbox/agent/codegen.py`. Orchestrates a Qwen Code headless run that produces a *usable* template
 * inside a dedicated workspace: a `Dockerfile`, a `commands.py` that starts the container-side `agent_sandbox.server`
 * HTTP server (without it a deployed sandbox has nothing to answer requests), and a `template.yaml`. The prompt
 * carries the server SDK reference from {@link ./template_guide.ts}. All artifacts are validated (the manifest with
 * the very same schema used by `parseTemplateData`) and the workspace is handed over to the existing build/deploy
 * pipeline.
 *
 * Python `ast.parse` has no Node equivalent. `commands.py` is validated by handing the source to a real interpreter
 * (`python3 -c "import ast, sys; ..."`, see {@link pythonSyntaxCheck}); only when *no* Python interpreter can be run
 * does {@link lexicalSyntaxCheck} (a conservative lexical check, documented there and in `parity/KNOWN-GAPS.md`)
 * take over.
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { parseTemplateData } from "../api/capability.js";
import { AICodegenError } from "../models/errors.js";
import { getLogger } from "../utils/logging.js";
import {
  cmpCodePoint,
  cpSlice,
  homeDir,
  isFile,
  osWalk,
  parsePyFloat,
  PY_WHITESPACE,
  pySplitLines,
  pyStrip,
  readTextReplace,
  readTextStrict,
  stripChars,
  timestampNow,
  which,
  writeTextUtf8,
} from "./_pycompat.js";
import { pyRepr as pyReprStr } from "./_py.js";
import { YAMLError, dumpYaml, isMapping, loadYaml } from "../utils/yaml_io.js";
import { type QwenCodeRunResult, type RunHeadlessOptions, excStr, runQwenCodeHeadless } from "./qwen_code.js";
import { resolveBuildPlan, type BuildMode, type PlatformStep } from "../template/build_plan.js";
import { SERVER_SDK_RELEASE_SPEC } from "../utils/server_sdk_pin.js";
import { buildTemplateGuide, REQUIRED_TEMPLATE_FILES, SERVER_ENTRYPOINT, SERVER_PORT } from "./template_guide.js";
import {
  dockerfileCmdLine,
  dockerfileSetsCmdOrEntrypoint,
  resolveTemplateProfile,
  serveCallIsImportTime,
  type TemplateProfile,
} from "../providers/template_profile.js";

const logger = getLogger("agent.codegen");

/** Wall-clock budget for one code-generation run (seconds). */
export const DEFAULT_CODEGEN_TIMEOUT = 600.0;

/** Prefix for AI-generated template names (marks provenance, avoids clashes). */
export const TEMPLATE_NAME_PREFIX = "abx-nl";

const FROM_INSTRUCTION_RE = new RegExp(`(?:^|\\n)[${PY_WHITESPACE}]*FROM[${PY_WHITESPACE}]+[^${PY_WHITESPACE}]`, "i");
const SLUG_RE = /[^a-z0-9]+/g;
const SERVE_CALL_RE = /\.serve\s*\(|\bstart\s*\(/;

function dockerfilePromptLines(profile: TemplateProfile, serverPort: number): string {
  const common = `- 必须以 FROM ${profile.base_image} 开始
   - 安装满足上述需求所需的系统包与依赖，并安装 agent-sandbox-server（写法见下方规范）
   - \`WORKDIR ${profile.workdir}\`，\`COPY commands.py\`，\`EXPOSE ${serverPort}\``;
  if (profile.server_start === "platform_start_cmd") {
    return `${common}
   - 不要写 CMD 或 ENTRYPOINT；平台 start_cmd 为 \`${profile.start_cmd}\``;
  }
  return `${common}，\`${dockerfileCmdLine(profile)}\``;
}

const codegenPromptTemplate = (fields: {
  description: string;
  template_name: string;
  server_port: number;
  guide: string;
  profile: TemplateProfile;
}): string => {
  const f = fields;
  const notice = f.profile.missing_profile ? `${f.profile.notice}\n\n` : "";
  return `你是 Agent Sandbox 的模板生成器。请根据下面的自然语言需求，在当前工作目录中生成一个
**部署后可以通过 HTTP(S) 直接使用**的沙箱模板（不是只有 Dockerfile 的镜像）。

用户需求：${f.description}

${notice}必须创建的文件：
1. \`Dockerfile\`：
   ${dockerfilePromptLines(f.profile, f.server_port)}
   - 保持精简、可直接执行 docker build
2. \`commands.py\`：基于 \`agent_sandbox.server\` 的 HTTP 服务入口，监听 ${f.server_port} 端口，
   \`serve()\` 放在 \`if __name__ == "__main__"\` 下，
   注册与需求相关的命令 / 路由（至少一个有意义的命令，不要只留 hello）
3. \`template.yaml\`：
   name: ${f.template_name}
   version: "1.0.0"
   description: <一句话中文描述，不超过 50 字>
   spec_version: 5
   provides:
     app: { protocol: agent-sandbox-server, version: 2, port: ${f.server_port}, operations: [commands.list, commands.run] }
   start_cmd: <启动模板内全部服务的命令>
   ready_cmd: <检查服务全部就绪的命令>
   # 不写 capabilities、tested_on 或 providers 旧字段
   ports: <至少包含 ${f.server_port}>
   resources:
     cpu: <1-8 的整数>
     memory: <512-16384 的整数，单位 MB>
4. \`README.md\`：模板用途、环境变量、调用示例

${f.guide}
限制：
- 只创建上述文件，以及需求确实需要的业务代码 / 依赖清单；不要创建其他无关文件或目录
- 不要运行 docker，不要安装任何东西，不要读取或输出密钥文件
- 完成后只需用一句话总结你生成了什么
`;
};

/** Outcome of one AI code-generation run. */
export class CodegenResult {
  /** Workspace containing the generated `Dockerfile` / `template.yaml`. */
  workdir: string;
  /** Deterministic template name (`abx-nl-<slug>-<token>`). */
  templateName: string;
  dockerfile: string;
  templateYaml: string;
  description: string;
  /** Final assistant text from Qwen Code (for diagnostics). */
  rawOutput: string;
  /** The generated `commands.py` server entry point. */
  commandsPy: string | null;
  /** Workspace-relative paths of every deliverable file (see {@link listTemplateFiles}). */
  files: readonly string[];

  constructor(init: {
    workdir: string;
    templateName: string;
    dockerfile: string;
    templateYaml: string;
    description?: string;
    rawOutput?: string;
    commandsPy?: string | null;
    files?: readonly string[];
  }) {
    this.workdir = init.workdir;
    this.templateName = init.templateName;
    this.dockerfile = init.dockerfile;
    this.templateYaml = init.templateYaml;
    this.description = init.description ?? "";
    this.rawOutput = init.rawOutput ?? "";
    this.commandsPy = init.commandsPy ?? null;
    this.files = init.files ?? [];
  }
}

/** Root directory for generated workspaces: `~/.abx/generated`. */
export function defaultGeneratedDir(): string {
  return seams.defaultGeneratedDir();
}

/** Timeout used for code generation, overridable via `ABX_QWEN_CODEGEN_TIMEOUT` (positive seconds). */
export function defaultCodegenTimeout(): number {
  const raw = process.env.ABX_QWEN_CODEGEN_TIMEOUT;
  if (raw) {
    const value = parsePyFloat(raw);
    if (value === null) return DEFAULT_CODEGEN_TIMEOUT;
    if (value > 0) return value;
  }
  return DEFAULT_CODEGEN_TIMEOUT;
}

/** Reduce `text` to a short `[a-z0-9-]` slug (ASCII only). */
export function _slugify(text: string, fallback = "sandbox"): string {
  let slug = stripChars(text.toLowerCase().replace(SLUG_RE, "-"), "-");
  slug = stripChars(cpSlice(slug, 0, 16), "-");
  return slug || fallback;
}

/** Build a deterministic, collision-resistant template name. */
export function makeTemplateName(description: string, opts: { token?: string | null } = {}): string {
  const suffix = opts.token !== undefined && opts.token !== null ? opts.token : randomBytes(3).toString("hex");
  return `${TEMPLATE_NAME_PREFIX}-${_slugify(description)}-${suffix}`;
}

/**
 * Build the Qwen Code prompt used for template generation.
 *
 * When the clarification loop ran, the generation run resumes the *same* native Qwen Code session (`--resume`), so
 * the agent already holds the description and every question/answer in its own conversation memory — the prompt
 * deliberately does not replay the transcript.
 */
export function buildCodegenPrompt(description: string, templateName: string, providerId?: string | null, buildMode: BuildMode = "auto", baseImage?: string): string {
  const selected = resolveTemplateProfile(providerId);
  const profile = baseImage ? { ...selected, base_image: baseImage } : selected;
  return codegenPromptTemplate({
    description: pyStrip(description),
    template_name: templateName,
    server_port: SERVER_PORT,
    guide: buildTemplateGuide("create", profile, buildMode),
    profile,
  });
}

function hasFromInstruction(dockerfile: string): boolean {
  let text: string;
  try {
    text = readTextReplace(dockerfile);
  } catch {
    return false;
  }
  return FROM_INSTRUCTION_RE.test(text);
}

function defaultRetryHint(workdir: string): string {
  return `Inspect the generated workspace: ${workdir}. ${AICodegenError.suggestion}`;
}

function loadTemplateYaml(templateYaml: string, retry?: string | null): Record<string, unknown> {
  const hint = retry !== undefined && retry !== null ? retry : defaultRetryHint(path.dirname(templateYaml));
  let data: unknown;
  try {
    data = loadYaml(readTextStrict(templateYaml));
  } catch (exc) {
    if (exc instanceof YAMLError || (exc instanceof Error && "code" in exc)) {
      throw new AICodegenError(`Generated template.yaml could not be parsed: ${excStr(exc)}`, { suggestion: hint });
    }
    throw exc;
  }
  if (!isMapping(data)) {
    throw new AICodegenError("Generated template.yaml is not a YAML mapping.", { suggestion: hint });
  }
  return data;
}

/** Names never treated as template deliverables (agent scratch / build junk). */
const SKIP_DIR_NAMES: ReadonlySet<string> = new Set(["__pycache__", "node_modules"]);
const SKIP_SUFFIXES: readonly string[] = [".pyc", ".whl", ".abx-bak"];
const LIST_MAX_FILES = 200;

/**
 * Workspace-relative paths of the generated template's deliverables.
 *
 * Dot-files and dot-directories (agent state such as `.qwen`) are left out, except `.dockerignore`; so are
 * `__pycache__`, `*.pyc` and injected `*.whl` files. The result is sorted and bounded.
 */
export function listTemplateFiles(workdir: string): readonly string[] {
  const found: string[] = [];
  for (const [current, dirs, names] of osWalk(workdir)) {
    const kept = dirs.filter((d) => !d.startsWith(".") && !SKIP_DIR_NAMES.has(d)).sort(cmpCodePoint);
    dirs.length = 0;
    dirs.push(...kept);
    for (const name of [...names].sort(cmpCodePoint)) {
      if (SKIP_SUFFIXES.some((suffix) => name.endsWith(suffix))) continue;
      if (name.startsWith(".") && name !== ".dockerignore") continue;
      found.push(path.relative(workdir, path.join(current, name)));
      if (found.length >= LIST_MAX_FILES) return [...found].sort(cmpCodePoint);
    }
  }
  return [...found].sort(cmpCodePoint);
}

// ---------------------------------------------------------------------------
// Python source validation (replaces `ast.parse(source, filename="commands.py")`)
// ---------------------------------------------------------------------------

/** Verdict of a Python syntax check: `message` is Python's `str(SyntaxError)` (or the lexical fallback's text). */
export interface SyntaxVerdict {
  valid: boolean;
  message: string;
}

/**
 * The checker handed to `python -c`. It reads the *bytes* of the file from stdin and decodes them like the original
 * `read_text(encoding="utf-8", errors="replace")`, then runs the real `ast.parse(source, filename=...)`.
 * Exit code 0 = parses, 3 = `SyntaxError`/`ValueError` (message on stdout).
 */
const PYTHON_AST_CHECK = [
  "import ast, sys",
  "name = sys.argv[1]",
  "source = sys.stdin.buffer.read().decode('utf-8', 'replace').replace('\\r\\n', '\\n').replace('\\r', '\\n')",
  "try:",
  "    ast.parse(source, filename=name)",
  "except (SyntaxError, ValueError) as exc:",
  "    sys.stdout.buffer.write(str(exc).encode('utf-8', 'replace'))",
  "    sys.exit(3)",
].join("\n");

/** Interpreter candidates, most specific first (`py -3` is the Windows launcher). */
function pythonCandidates(): string[][] {
  const candidates: string[][] = [];
  for (const name of ["python3", "python"]) {
    const found = which(name);
    if (found) candidates.push([found]);
  }
  if (process.platform === "win32") {
    const launcher = which("py");
    if (launcher) candidates.push([launcher, "-3"]);
  }
  return candidates;
}

/**
 * Check `source` with a real Python interpreter.
 *
 * Returns `null` when no interpreter could be run (none on PATH, spawn failure, or an exit status that is neither
 * "parses" nor "syntax error" — e.g. the Windows app-execution-alias stub), so the caller can fall back to
 * {@link lexicalSyntaxCheck}.
 */
export function pythonSyntaxCheck(source: Uint8Array, filename: string): SyntaxVerdict | null {
  for (const [exe, ...prefix] of pythonCandidates()) {
    const completed = spawnSync(exe as string, [...prefix, "-c", PYTHON_AST_CHECK, filename], {
      input: Buffer.from(source),
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    if (completed.error || completed.status === null) continue;
    if (completed.status === 0) return { valid: true, message: "" };
    if (completed.status === 3) {
      return { valid: false, message: Buffer.from(completed.stdout ?? "").toString("utf-8") };
    }
  }
  return null;
}

function leadingIndent(line: string): number {
  let col = 0;
  for (const ch of line) {
    if (ch === " ") col += 1;
    else if (ch === "\t") col = (Math.floor(col / 8) + 1) * 8;
    else if (ch === "\f") col = 0;
    else break;
  }
  return col;
}

const OPENERS: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };
const BRACKET_NAMES: Readonly<Record<string, string>> = { ")": "parenthesis", "]": "bracket", "}": "brace" };

/**
 * Conservative lexical check used **only** when no Python interpreter is available (see {@link pythonSyntaxCheck}).
 *
 * It never accepts what a lexical error proves invalid and never rejects valid Python; the full grammar is NOT
 * checked, so a file that is lexically sound but grammatically broken (e.g. `def broken(:` inside balanced
 * brackets is caught, `x = = 1` is not) passes. Detected, with CPython 3.11's wording and `(commands.py, line N)`
 * suffix:
 *
 * - a NUL byte (`source code string cannot contain null bytes`);
 * - an unterminated single-line string literal (non-f-strings only, so PEP 701 nesting never misfires);
 * - an unterminated triple-quoted string;
 * - an unclosed, unmatched or mismatched `(` `[` `{`;
 * - a trailing line-continuation backslash at EOF;
 * - an indented first statement / an indent after a line that does not end in `:` (`unexpected indent`);
 * - a dedent to a column that matches no enclosing indentation level (`unindent does not match ...`).
 */
export function lexicalSyntaxCheck(source: string, filename: string): SyntaxVerdict {
  const fail = (message: string, line: number): SyntaxVerdict => ({
    valid: false,
    message: `${message} (${filename}, line ${line})`,
  });
  if (source.includes("\0")) return { valid: false, message: "source code string cannot contain null bytes" };

  const text = source.replace(/\r\n?/g, "\n");
  const n = text.length;
  const brackets: Array<{ ch: string; line: number }> = [];
  const indents: number[] = [0];
  let line = 1;
  let i = 0;
  let atLineStart = true;
  let lastSignificant = "";
  let continuation = false;

  while (i < n) {
    if (atLineStart && brackets.length === 0 && !continuation) {
      let j = i;
      while (j < n && (text[j] === " " || text[j] === "\t" || text[j] === "\f")) j += 1;
      const rest = text[j];
      if (j >= n || rest === "\n" || rest === "#") {
        // Blank or comment-only line: never affects indentation.
        while (j < n && text[j] !== "\n") j += 1;
        i = j;
        if (i < n) {
          i += 1;
          line += 1;
        }
        continue;
      }
      const indent = leadingIndent(text.slice(i, j));
      const top = indents[indents.length - 1] as number;
      if (indent > top) {
        if (lastSignificant !== ":") return fail("unexpected indent", line);
        indents.push(indent);
      } else if (indent < top) {
        while (indents.length > 1 && (indents[indents.length - 1] as number) > indent) indents.pop();
        if ((indents[indents.length - 1] as number) !== indent) {
          return fail("unindent does not match any outer indentation level", line);
        }
      }
      i = j;
      atLineStart = false;
      continue;
    }
    atLineStart = false;
    continuation = false;
    const ch = text[i] as string;
    if (ch === "\n") {
      line += 1;
      i += 1;
      if (brackets.length === 0) atLineStart = true;
      continue;
    }
    if (ch === "#") {
      while (i < n && text[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "\\") {
      if (i + 1 >= n) return fail("unexpected EOF while parsing", line);
      if (text[i + 1] === "\n") {
        line += 1;
        i += 2;
        continuation = true;
        continue;
      }
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let prefixStart = i;
      while (prefixStart > 0 && /[A-Za-z]/.test(text[prefixStart - 1] as string)) prefixStart -= 1;
      const prefix = text.slice(prefixStart, i).toLowerCase();
      const isRaw = prefix.includes("r");
      const isFString = prefix.includes("f");
      const triple = text.startsWith(ch.repeat(3), i);
      const startLine = line;
      if (triple) {
        i += 3;
        let closed = false;
        while (i < n) {
          const c = text[i] as string;
          if (c === "\\" && !isRaw) {
            if (text[i + 1] === "\n") line += 1;
            i += 2;
            continue;
          }
          if (c === "\\" && isRaw) {
            if (text[i + 1] === "\n") line += 1;
            i += 2;
            continue;
          }
          if (c === "\n") line += 1;
          if (text.startsWith(ch.repeat(3), i)) {
            i += 3;
            closed = true;
            break;
          }
          i += 1;
        }
        if (!closed) {
          return {
            valid: false,
            message: `unterminated triple-quoted string literal (detected at line ${line}) (${filename}, line ${startLine})`,
          };
        }
      } else {
        i += 1;
        let closed = false;
        while (i < n) {
          const c = text[i] as string;
          if (c === "\\") {
            if (text[i + 1] === "\n") line += 1;
            i += 2;
            continue;
          }
          if (c === "\n") break;
          if (c === ch) {
            i += 1;
            closed = true;
            break;
          }
          i += 1;
        }
        if (!closed && !isFString) {
          return {
            valid: false,
            message: `unterminated string literal (detected at line ${line}) (${filename}, line ${startLine})`,
          };
        }
      }
      lastSignificant = ch;
      continue;
    }
    if (ch in OPENERS) {
      brackets.push({ ch, line });
    } else if (ch === ")" || ch === "]" || ch === "}") {
      const open = brackets.pop();
      if (!open) return fail(`unmatched '${ch}'`, line);
      if (OPENERS[open.ch] !== ch) {
        const message =
          open.line === line
            ? `closing parenthesis '${ch}' does not match opening parenthesis '${open.ch}'`
            : `closing parenthesis '${ch}' does not match opening parenthesis '${open.ch}' on line ${open.line}`;
        void BRACKET_NAMES;
        return fail(message, line);
      }
    }
    if (ch !== " " && ch !== "\t" && ch !== "\f") lastSignificant = ch;
    i += 1;
  }
  const dangling = brackets[brackets.length - 1];
  if (dangling) return fail(`'${dangling.ch}' was never closed`, dangling.line);
  return { valid: true, message: "" };
}

/** Patch points mirroring the module-level names Python tests monkeypatch. */
export const seams = {
  runQwenCodeHeadless: runQwenCodeHeadless as (prompt: string, opts?: RunHeadlessOptions) => Promise<QwenCodeRunResult>,
  pythonSyntaxCheck: pythonSyntaxCheck as (source: Uint8Array, filename: string) => SyntaxVerdict | null,
  defaultGeneratedDir: (() => path.join(homeDir(), ".abx", "generated")) as () => string,
  prepareWorkdir: undefined as unknown as typeof prepareWorkdir,
  generateTemplateFiles: undefined as unknown as typeof generateTemplateFiles,
};

function checkPythonSyntax(commandsPy: string, retry: string): string {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(commandsPy);
  } catch (exc) {
    throw new AICodegenError(`Generated ${SERVER_ENTRYPOINT} could not be read: ${excStr(exc)}`, { suggestion: retry });
  }
  const verdict = seams.pythonSyntaxCheck(bytes, SERVER_ENTRYPOINT) ?? lexicalSyntaxCheck(readTextReplace(commandsPy), SERVER_ENTRYPOINT);
  if (!verdict.valid) {
    throw new AICodegenError(`Generated ${SERVER_ENTRYPOINT} is not valid Python: ${verdict.message}`, { suggestion: retry });
  }
  return readTextReplace(commandsPy);
}

function validateServerEntrypoint(
  workdir: string,
  dockerfile: string,
  commandsPy: string,
  profile: TemplateProfile,
  retry?: string | null,
): void {
  const hint = retry !== undefined && retry !== null ? retry : defaultRetryHint(workdir);
  const source = checkPythonSyntax(commandsPy, hint);
  if (!source.includes("agent_sandbox.server") || !SERVE_CALL_RE.test(source)) {
    throw new AICodegenError(
      `Generated ${SERVER_ENTRYPOINT} does not start an agent_sandbox.server ` +
        "SandboxServer (expected an import from agent_sandbox.server and a " +
        `serve()/start() call on port ${SERVER_PORT}).`,
      { suggestion: hint },
    );
  }
  let dockerText: string;
  try {
    dockerText = readTextReplace(dockerfile);
  } catch {
    dockerText = "";
  }
  if (!dockerText.includes(SERVER_ENTRYPOINT)) {
    throw new AICodegenError(
      `Generated Dockerfile never references ${SERVER_ENTRYPOINT}, so the sandbox server would not start.`,
      { suggestion: hint },
    );
  }
  if (profile.server_start === "platform_start_cmd") {
    if (serveCallIsImportTime(source)) {
      throw new AICodegenError(
        `Generated ${SERVER_ENTRYPOINT} calls serve()/start() at import time. ` +
          `For provider '${profile.provider_id}' (platform_start_cmd) put it under if __name__ == "__main__".`,
        { suggestion: hint },
      );
    }
    if (dockerfileSetsCmdOrEntrypoint(dockerText)) {
      throw new AICodegenError(
        `Generated Dockerfile sets CMD or ENTRYPOINT, which provider '${profile.provider_id}' ` +
          "(platform_start_cmd) does not use; the platform runs start_cmd.",
        { suggestion: hint },
      );
    }
  }
}

/**
 * Validate a generated template workspace and return its manifest data.
 *
 * Shared by `abx create --prompt "<description>"` and `abx template scaffold --adopt`. Checks, fail-closed: the Dockerfile has a
 * `FROM`; `commands.py` parses and starts `agent_sandbox.server`; the Dockerfile references it; `template.yaml` is a
 * mapping that passes the capability schema. Nothing is written; the returned manifest carries `templateName` as
 * its `name`.
 *
 * The manifest is returned as plain data (key order kept) so it can be dumped back with `dumpYaml`.
 *
 * `retry` replaces the default "inspect the workspace / fall back to `abx create <name> --detach`" suggestion on every
 * error.
 *
 * Throws `AICodegenError` when any check fails.
 */
export function validateTemplateWorkspace(
  workdir: string,
  templateName: string,
  opts: { retry?: string | null; providerId?: string | null; buildMode?: BuildMode; baseImage?: string } = {},
): Record<string, unknown> {
  const dockerfile = path.join(workdir, "Dockerfile");
  const templateYaml = path.join(workdir, "template.yaml");
  const commandsPy = path.join(workdir, SERVER_ENTRYPOINT);
  const hint = opts.retry !== undefined && opts.retry !== null ? opts.retry : defaultRetryHint(workdir);
  const profile = resolveTemplateProfile(opts.providerId);
  for (const file of [dockerfile, templateYaml, commandsPy]) {
    if (!isFile(file)) {
      throw new AICodegenError(`Expected file is missing: ${path.basename(file)}.`, { suggestion: hint });
    }
  }

  if (!hasFromInstruction(dockerfile)) {
    throw new AICodegenError(`Generated Dockerfile at ${dockerfile} has no FROM instruction.`, { suggestion: hint });
  }

  validateServerEntrypoint(workdir, dockerfile, commandsPy, profile, hint);

  const data = loadTemplateYaml(templateYaml, hint);
  data["name"] = templateName;
  try {
    parseTemplateData({ ...data });
  } catch (exc) {
    throw new AICodegenError(`Generated template.yaml failed schema validation: ${excStr(exc)}`, { suggestion: hint });
  }
  if (opts.buildMode && opts.buildMode !== "auto") {
    try {
      const plan = resolveBuildPlan(workdir, { mode: opts.buildMode });
      if (plan.kind === "steps" && opts.baseImage && plan.image !== opts.baseImage) {
        throw new Error(`base.image must preserve the selected provider image ${opts.baseImage}; received ${plan.image}`);
      }
    }
    catch (error) { throw new AICodegenError(`Generated template cannot use ${opts.buildMode}: ${excStr(error)}`, { suggestion: hint }); }
  }
  return data;
}

/** Assemble native preparation from final generated files, never model-encoded bytes. */
function prepareGeneratedSteps(workdir: string, selectedImage?: string): void {
  const hint = defaultRetryHint(workdir);
  const manifestPath = path.join(workdir, "template.yaml");
  const data = loadTemplateYaml(manifestPath, hint);
  const profile = resolveTemplateProfile();
  const dockerImage = /^\s*FROM\s+(\S+)/im.exec(readTextReplace(path.join(workdir, "Dockerfile")))?.[1];
  const image = selectedImage ?? profile.base_image;
  if (!image || /[<>]/.test(image)) throw new AICodegenError("Generated steps need the provider-resolved base image.", { suggestion: hint });
  if (selectedImage && dockerImage !== selectedImage) {
    throw new AICodegenError("Generated Dockerfile must preserve the selected provider base image.", { suggestion: hint });
  }
  const build = data["build"];
  if (build !== undefined && !isMapping(build)) throw new AICodegenError("Generated build must be a mapping.", { suggestion: hint });
  const recipe = (build ?? {}) as Record<string, unknown>;
  if (Object.keys(recipe).some((key) => !["mode", "run"].includes(key))) {
    throw new AICodegenError("Generated steps accept dependency commands in build.run only; the CLI assembles source-file delivery.", { suggestion: hint });
  }
  const dependencies = recipe["run"] ?? [];
  if (!Array.isArray(dependencies) || dependencies.some((value) => typeof value !== "string" || !value.trim())) {
    throw new AICodegenError("Generated build.run must be an array of dependency commands.", { suggestion: hint });
  }
  const quote = (value: string): string => "'" + value.replaceAll("'", "'\\''") + "'";
  const user = profile.user || "root";
  const destination = profile.workdir;
  const steps: PlatformStep[] = [
    { type: "USER", args: ["root"] },
    { type: "RUN", args: [`python3 -m pip install --index-url https://pypi.org/simple --no-cache-dir ${quote(SERVER_SDK_RELEASE_SPEC)}`] },
  ];
  const root = fs.realpathSync(workdir) + path.sep;
  for (const file of listTemplateFiles(workdir)) {
    if (["Dockerfile", "template.yaml", "README.md", ".dockerignore"].includes(file)) continue;
    const local = path.join(workdir, file);
    if (!fs.realpathSync(local).startsWith(root) || !fs.lstatSync(local).isFile()) {
      throw new AICodegenError("Generated source delivery requires regular files inside its workspace.", { suggestion: hint });
    }
    const remote = path.posix.join(destination, file.split(path.sep).join("/"));
    const payload = fs.readFileSync(local).toString("base64");
    steps.push({ type: "RUN", args: [`mkdir -p ${quote(path.posix.dirname(remote))} && printf '%s' ${quote(payload)} | base64 -d > ${quote(remote)}`] });
  }
  steps.push(
    { type: "WORKDIR", args: [destination] },
    ...dependencies.map((command): PlatformStep => ({ type: "RUN", args: [command] })),
    { type: "RUN", args: [`python3 -m py_compile ${quote(path.posix.join(destination, SERVER_ENTRYPOINT))} && chown -R ${quote(`${user}:${user}`)} ${quote(destination)}`] },
    { type: "USER", args: [user] },
  );
  data["base"] = { image };
  data["build"] = { mode: "steps", steps };
  writeTextUtf8(manifestPath, dumpYaml(data));
}

/**
 * Create the generation workspace and its deterministic template name.
 *
 * Returns `[workdir, templateName]`. The clarification loop and the generation run share this workspace — Qwen Code
 * stores sessions per working directory, so both phases must use the same `cwd` for the native `--session-id` /
 * `--resume` pair to line up.
 */
export function prepareWorkdir(description: string, opts: { baseDir?: string | null } = {}): [string, string] {
  return seams.prepareWorkdir(description, opts);
}

function prepareWorkdirImpl(description: string, opts: { baseDir?: string | null } = {}): [string, string] {
  const templateName = makeTemplateName(description);
  const root = opts.baseDir !== undefined && opts.baseDir !== null ? opts.baseDir : seams.defaultGeneratedDir();
  const stamp = timestampNow();
  const workdir = path.join(root, `${_slugify(description)}-${stamp}-${cpSlice(templateName, -6)}`);
  fs.mkdirSync(workdir, { recursive: true });
  return [workdir, templateName];
}

export interface GenerateTemplateFilesOptions {
  buildMode?: BuildMode;
  baseImage?: string;
  workdir?: string | null;
  templateName?: string | null;
  resumeSession?: string | null;
  binary?: string | null;
  env?: Readonly<Record<string, string>> | null;
  timeout?: number | null;
  baseDir?: string | null;
  onProgress?: ((message: string) => void) | null;
  onActivity?: ((summary: string) => void) | null;
}

/**
 * Generate `Dockerfile` + `template.yaml` with Qwen Code.
 *
 * The files are written into a workspace: `workdir` when the caller already prepared one (the create command does,
 * so the clarification loop and this run share one native session), otherwise a fresh
 * `~/.abx/generated/<slug>-<timestamp>/` directory under `baseDir`. The workspace is kept on failure so users can
 * inspect what the agent produced.
 *
 * `resumeSession` continues the native Qwen Code session created by the clarification loop, so the model keeps the
 * full description and Q/A transcript in its own memory instead of re-reading a replay.
 *
 * Throws `AICodegenError` when the run fails, times out, or the produced files are missing / invalid. Never silently
 * falls back.
 */
export function generateTemplateFiles(
  description: string,
  opts: GenerateTemplateFilesOptions = {},
): Promise<CodegenResult> {
  return seams.generateTemplateFiles(description, opts);
}

async function generateTemplateFilesImpl(
  description: string,
  opts: GenerateTemplateFilesOptions = {},
): Promise<CodegenResult> {
  if (!description || !pyStrip(description)) {
    throw new AICodegenError("Cannot generate a template from an empty description.");
  }

  const progress = (message: string): void => {
    if (opts.onProgress != null) opts.onProgress(message);
  };

  let workdir = opts.workdir ?? null;
  let templateName = opts.templateName ?? null;
  if (workdir === null) {
    [workdir, templateName] = seams.prepareWorkdir(description, { baseDir: opts.baseDir });
  } else if (templateName === null) {
    templateName = makeTemplateName(description);
  }
  const tmplName = templateName as string;
  const work = workdir;

  const prompt = buildCodegenPrompt(description, tmplName, undefined, opts.buildMode, opts.baseImage);
  progress(`Generating template with Qwen Code in ${work} ...`);
  const extra: Partial<RunHeadlessOptions> = opts.onActivity == null ? {} : { onActivity: opts.onActivity };
  const result = await seams.runQwenCodeHeadless(prompt, {
    binary: opts.binary ?? null,
    env: opts.env ?? null,
    cwd: work,
    timeout: opts.timeout != null ? opts.timeout : defaultCodegenTimeout(),
    resume: opts.resumeSession ?? null,
    ...extra,
  });

  const dockerfile = path.join(work, "Dockerfile");
  const templateYaml = path.join(work, "template.yaml");
  const commandsPy = path.join(work, SERVER_ENTRYPOINT);
  const missing = [...REQUIRED_TEMPLATE_FILES, "README.md"].filter((name) => !isFile(path.join(work, name)));
  if (missing.length > 0) {
    const stderrTail = pySplitLines(pyStrip(result.rawStderr || "")).slice(-3);
    let detail = ` exit_code=${result.exitCode}`;
    if (result.text) detail += ` output=${pyRepr200(result.text)}`;
    if (stderrTail.length > 0) detail += ` stderr=${stderrTail.join(" | ")}`;
    throw new AICodegenError(
      `Qwen Code did not create the expected file(s): ${missing.join(", ")}.${detail}`,
      {
        suggestion:
          `Inspect the generated workspace: ${work}. ${AICodegenError.suggestion}`,
      },
    );
  }

  if (opts.buildMode === "steps") prepareGeneratedSteps(work, opts.baseImage);
  const data = validateTemplateWorkspace(work, tmplName, { buildMode: opts.buildMode, baseImage: opts.baseImage });

  if (opts.buildMode && opts.buildMode !== "auto") data["build"] = { ...(isMapping(data["build"]) ? data["build"] : {}), mode: opts.buildMode };
  data["env"] = { ...(isMapping(data["env"]) ? data["env"] : {}), ABX_SERVER_TOKEN: "" };
  writeTextUtf8(templateYaml, dumpYaml(data));
  logger.debug("Generated template workspace ready: %s", work);

  return new CodegenResult({
    workdir: work,
    templateName: tmplName,
    dockerfile,
    templateYaml,
    description,
    rawOutput: result.text,
    commandsPy,
    files: listTemplateFiles(work),
  });
}

seams.prepareWorkdir = prepareWorkdirImpl;
seams.generateTemplateFiles = generateTemplateFilesImpl;

/** `repr(result.text.strip()[:200])`. */
function pyRepr200(text: string): string {
  return pyReprStr(cpSlice(pyStrip(text), 0, 200));
}
