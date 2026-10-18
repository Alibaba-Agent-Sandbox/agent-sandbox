/**
 * Code context module — code interpreter for sandboxes (port of `api/code.py`).
 *
 * 通过 CodeInterpreterProtocol 调用 Code Interpreter RPC 服务。支持 runCode、createCodeContext、listCodeContexts、
 * restartCodeContext、removeCodeContext 操作。
 *
 * 当 CodeInterpreter 服务不可用（HTTP 404）时，自动降级为通过 ProcessProtocol 写文件 + shell 执行的模式（与 @sandbox
 * 装饰器同一机制），对调用方透明。
 *
 * The selected adapter owns the interpreter wire protocol.
 */

import { randomUUID } from "node:crypto";

import { CodeResult, ProcessChunkType } from "../models/process.js";
import { DEFAULT_CAPABILITIES } from "../models/template.js";
import type { CodeInterpreterProtocol } from "../protocol/contracts.js";
import type { ProcessProtocol } from "../protocol/contracts.js";
import type { DataPlaneAuth as EnvdTokenManager } from "../transport/auth_contract.js";
import { HTTPStatusError } from "../transport/http.js";
import { getLogger } from "../utils/logging.js";
import { pyStrip } from "../utils/_pyformat.js";
import { NotImplementedError, RuntimeError, dictGet, pyEncodeUtf8 } from "./_pyerrors.js";
import { checkCapability } from "./capability.js";

const logger = getLogger("api.code");

export const _seams = {
  monotonic: (): number => Number(process.hrtime.bigint()) / 1e9,
  uuid4Hex: (): string => randomUUID().replace(/-/g, ""),
};

/** Language → interpreter command for shell fallback (mirrors routes_devtools.py) */
export const _LANGUAGE_COMMANDS: Record<string, string> = {
  python: "python3",
  javascript: "node",
  typescript: "node",
  shell: "bash",
  bash: "bash",
  r: "Rscript",
};

/** Language → temp-file extension */
export const _LANGUAGE_EXTENSIONS: Record<string, string> = {
  python: ".py",
  javascript: ".js",
  typescript: ".ts",
  shell: ".sh",
  bash: ".sh",
  r: ".R",
};

export interface CodeRunOptions {
  language?: string;
  timeout?: number;
  context_id?: string | null;
  envs?: Record<string, string> | null;
  on_stdout?: ((s: string) => void) | null;
  on_stderr?: ((s: string) => void) | null;
  on_result?: ((r: any) => void) | null;
}

interface ShellRunOptions {
  language: string;
  timeout: number;
  envs: Record<string, string> | null;
  on_stdout: ((s: string) => void) | null;
  on_stderr: ((s: string) => void) | null;
  on_result: ((r: any) => void) | null;
}

function lookup(table: Record<string, string>, key: string, dflt: string): string {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key]! : dflt;
}

/**
 * Code interpreter — execute code snippets in the sandbox.
 *
 * Calls CodeInterpreterProtocol for code execution and context management. When the CodeInterpreter service is
 * unavailable (HTTP 404), `run()` falls back transparently to writing the code to a temp file and executing it via the
 * process/shell protocol.
 */
export class CodeContextModule {
  _sandbox_id: string;
  _envd_url: string;
  _envd_token: EnvdTokenManager;
  _code: CodeInterpreterProtocol;
  _process: ProcessProtocol | null;
  _capabilities: Set<string>;
  _ci_available: boolean;

  constructor(
    sandbox_id: string,
    envd_url: string,
    envd_token: EnvdTokenManager,
    code_interpreter_protocol: CodeInterpreterProtocol,
    capabilities: Set<string> | null = null,
    process_protocol: ProcessProtocol | null = null,
  ) {
    this._sandbox_id = sandbox_id;
    this._envd_url = envd_url;
    this._envd_token = envd_token;
    this._code = code_interpreter_protocol;
    this._process = process_protocol;
    this._capabilities = capabilities !== null ? capabilities : new Set(DEFAULT_CAPABILITIES);
    // Assume CodeInterpreter is available until a 404 proves otherwise.
    this._ci_available = true;
  }

  /**
   * Execute code in the sandbox via Code Interpreter RPC.
   *
   * If the CodeInterpreter service returns HTTP 404 (not deployed on this backend), falls back transparently to shell
   * execution — writes the code to a temp file and runs the appropriate interpreter via the process protocol.
   */
  async run(code: string, opts: CodeRunOptions = {}): Promise<CodeResult> {
    const {
      language = "python",
      timeout = 30,
      context_id = null,
      envs = null,
      on_stdout = null,
      on_stderr = null,
      on_result = null,
    } = opts;
    // Capability gate — must run BEFORE any CI availability / 404 shell fallback so that a template without "code"
    // never reaches the code interpreter or the shell fallback (fail-closed).
    checkCapability(this._capabilities, "code");

    // Fast path: CI already known unavailable — skip straight to fallback.
    if (!this._ci_available) {
      return this._runViaShell(code, { language, timeout, envs, on_stdout, on_stderr, on_result });
    }

    let response: Record<string, any>;
    try {
      response = await this._code.runCode(this._sandbox_id, this._envd_url, this._envd_token, {
        code,
        language,
        context_id,
        timeout,
        envs,
        on_stdout,
        on_stderr,
        on_result,
      });
    } catch (exc) {
      if (exc instanceof HTTPStatusError) {
        if (exc.response.status_code === 404) {
          logger.warning("CodeInterpreter service unavailable (HTTP 404), falling back to shell execution");
          this._ci_available = false;
          return this._runViaShell(code, { language, timeout, envs, on_stdout, on_stderr, on_result });
        }
      }
      throw exc;
    }

    // Parse the RPC response into a CodeResult. Response format may vary; handle both direct and nested results
    const result = dictGet(response, "result", response);
    return new CodeResult({
      text: pyStrip(dictGet(result, "text", dictGet(result, "stdout", ""))),
      stdout: dictGet(result, "stdout", ""),
      stderr: dictGet(result, "stderr", ""),
      exit_code: dictGet(result, "exitCode", dictGet(result, "exit_code", 0)),
      execution_time: dictGet(result, "executionTime", dictGet(result, "execution_time", 0.0)),
    });
  }

  // ------------------------------------------------------------------
  // Shell fallback (CodeInterpreter 404)
  // ------------------------------------------------------------------

  /**
   * Execute code via the process protocol (shell fallback).
   *
   * Writes the code to a temp file using base64 (avoids shell-quoting issues), runs the appropriate interpreter,
   * collects stdout/stderr, and cleans up.
   */
  async _runViaShell(code: string, opts: ShellRunOptions): Promise<CodeResult> {
    const { language, timeout, envs, on_stdout, on_stderr, on_result } = opts;
    if (this._process === null) {
      throw new RuntimeError(
        "Shell fallback for code execution requires process_protocol to be injected but it was not provided.",
      );
    }

    const interpreter = lookup(_LANGUAGE_COMMANDS, language, language);
    const ext = lookup(_LANGUAGE_EXTENSIONS, language, "");
    const tmp_path = `/tmp/_abx_code_${_seams.uuid4Hex()}${ext}`;

    try {
      // Step 1 — write code to temp file via base64 (quoting-safe)
      const b64_code = pyEncodeUtf8(code).toString("base64");
      const write_reader = await this._process.start(this._envd_url, this._envd_token, {
        cmd: "python3",
        args: ["-c", `import base64; open('${tmp_path}','wb').write(base64.b64decode('${b64_code}'))`],
        timeout: 30,
      });
      for await (const _ of write_reader) {
        void _; // drain
      }

      // Step 2 — execute the code file with the correct interpreter
      const start_time = _seams.monotonic();
      const exec_reader = await this._process.start(this._envd_url, this._envd_token, {
        cmd: interpreter,
        args: [tmp_path],
        env: envs && Object.keys(envs).length ? envs : null,
        timeout,
      });

      const stdout_parts: string[] = [];
      const stderr_parts: string[] = [];
      let exit_code = 0;

      for await (const chunk of exec_reader) {
        if (chunk.type === ProcessChunkType.STDOUT) {
          stdout_parts.push(chunk.data);
          if (on_stdout && chunk.data) on_stdout(chunk.data);
        } else if (chunk.type === ProcessChunkType.STDERR) {
          stderr_parts.push(chunk.data);
          if (on_stderr && chunk.data) on_stderr(chunk.data);
        } else if (chunk.type === ProcessChunkType.EXIT) {
          exit_code = chunk.exit_code || 0;
        }
      }

      const execution_time = _seams.monotonic() - start_time;
      const stdout = stdout_parts.join("");
      const stderr = stderr_parts.join("");

      if (on_result) {
        on_result({ stdout, stderr, exitCode: exit_code, executionTime: execution_time });
      }

      return new CodeResult({
        text: pyStrip(stdout),
        stdout,
        stderr,
        exit_code,
        output_files: [],
        execution_time,
      });
    } finally {
      // Best-effort cleanup of the temp file — runs even if Step 2 raises
      try {
        const rm_reader = await this._process.start(this._envd_url, this._envd_token, {
          cmd: "rm",
          args: ["-f", tmp_path],
          timeout: 10,
        });
        for await (const _ of rm_reader) {
          void _;
        }
      } catch {
        // best-effort
      }
    }
  }

  // ------------------------------------------------------------------
  // Context management (require live CodeInterpreter service)
  // ------------------------------------------------------------------

  /**
   * Re-enable CodeInterpreter probing after backend recovery. After calling this, the next `run()` call will attempt
   * the native CodeInterpreter RPC again instead of going straight to the shell fallback.
   */
  resetCiAvailability(): void {
    this._ci_available = true;
  }

  /** Raise if CI is known unavailable (set after first 404). */
  _checkCiAvailable(operation: string): void {
    if (!this._ci_available) {
      throw new NotImplementedError(
        `Context operation '${operation}' requires the CodeInterpreter ` +
          "service which is currently unavailable (HTTP 404). Code " +
          "execution works via shell fallback but stateful contexts " +
          "are not supported in fallback mode.",
      );
    }
  }

  /** Create a new execution context. Returns context info dict (includes contextId). */
  async createContext(opts: { language?: string } = {}): Promise<Record<string, any>> {
    const { language = "python" } = opts;
    checkCapability(this._capabilities, "code");
    this._checkCiAvailable("create_context");
    return this._code.createContext(this._sandbox_id, this._envd_url, this._envd_token, { language });
  }

  /** List all execution contexts. */
  async listContexts(): Promise<Record<string, any>[]> {
    checkCapability(this._capabilities, "code");
    this._checkCiAvailable("list_contexts");
    return this._code.listContexts(this._sandbox_id, this._envd_url, this._envd_token);
  }

  /** Restart an execution context. */
  async restartContext(context_id: string): Promise<Record<string, any>> {
    checkCapability(this._capabilities, "code");
    this._checkCiAvailable("restart_context");
    return this._code.restartContext(this._sandbox_id, this._envd_url, this._envd_token, { context_id });
  }

  /** Remove an execution context. */
  async removeContext(context_id: string): Promise<void> {
    checkCapability(this._capabilities, "code");
    this._checkCiAvailable("remove_context");
    await this._code.removeContext(this._sandbox_id, this._envd_url, this._envd_token, { context_id });
  }
}
