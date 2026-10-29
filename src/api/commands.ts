/** Commands module — run commands in sandboxes (port of `api/commands.py`). */

import { ProcessChunk, ProcessChunkType, ProcessInfo, ProcessResult } from "../models/process.js";
import type { ProcessProtocol } from "../protocol/contracts.js";
import type { DataPlaneAuth as EnvdTokenManager } from "../transport/auth_contract.js";
import type { StreamReader } from "../transport/streaming.js";
import { getLogger } from "../utils/logging.js";
import { shlexSplit } from "./_shlex.js";

const logger = getLogger("api.commands");
void logger;

/**
 * Shell punctuation characters that indicate the command requires `sh -c` wrapping because the envd process API
 * executes `cmd` directly (not via a shell). Only *unquoted* occurrences trigger wrapping.
 */
export const _SHELL_PUNCT: ReadonlySet<string> = new Set(Array.from("();<>|&"));

export const _seams = {
  monotonic: (): number => Number(process.hrtime.bigint()) / 1e9,
};

/** Detect shell operators before tokenization discards quoting and escapes. */
export function _needsShellWrap(cmd: string): boolean {
  let quote: string | null = null;
  let escaped = false;
  for (const char of cmd) {
    if (escaped) escaped = false;
    else if (char === "\\" && quote !== "'") escaped = true;
    else if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === "'" || char === '"') quote = char;
    else if (_SHELL_PUNCT.has(char)) return true;
  }
  return false;
}

export interface RunOptions {
  timeout?: number;
  env?: Record<string, string> | null;
  cwd?: string;
  user?: string;
  background?: boolean;
  shell?: boolean;
}

export interface StartOptions {
  timeout?: number;
  env?: Record<string, string> | null;
  cwd?: string;
  user?: string;
}

/**
 * High-level interface for running commands in a sandbox.
 *
 * Wraps ProcessProtocol and provides convenient methods for executing shell commands, streaming output, and managing
 * processes.
 *
 * Note: Commands containing unquoted shell operators (|, ;, &&, ||, >, <, ()) are automatically wrapped in `sh -c`.
 * Variable expansion ($VAR), backticks, and glob patterns still require explicit `sh -c '...'` wrapping.
 */
export class CommandsModule {
  _envd_url: string;
  _envd_token: EnvdTokenManager;
  _process: ProcessProtocol;
  _capabilities: Set<string>;

  constructor(
    envd_url: string,
    envd_token: EnvdTokenManager,
    process_protocol: ProcessProtocol,
    capabilities: Set<string> | null = null,
  ) {
    this._envd_url = envd_url;
    this._envd_token = envd_token;
    this._process = process_protocol;
    this._capabilities = capabilities !== null ? capabilities : new Set<string>();
  }

  /**
   * Parse a command string into command and args.
   *
   * When the command contains unquoted shell operators (pipes, redirects, semicolons, etc.) it is wrapped in `sh -c` so
   * the remote shell interprets the full pipeline. Simple commands are split via `shlex.split` as before.
   */
  static _parseCmd(cmd: string): [string, string[]] {
    if (_needsShellWrap(cmd)) {
      return ["sh", ["-c", cmd]];
    }
    const parts = shlexSplit(cmd);
    if (!parts.length) {
      return [cmd, []];
    }
    return [parts[0]!, parts.slice(1)];
  }

  /**
   * Run a command and wait for completion.
   *
   * `cmd`: Shell command string. `timeout`: Max execution time in seconds. `env`: Additional environment variables.
   * `cwd`: Working directory. `user`: OS user to run the command as. `background`: If true, start the process and
   * return a StreamReader handle immediately without blocking. `shell`: When true, always run `cmd` via `sh -c`.
   *
   * Returns ProcessResult (stdout, stderr, exit_code) when `background` is false, otherwise a StreamReader of
   * ProcessChunk items.
   */
  async run(cmd: string, opts: RunOptions = {}): Promise<ProcessResult | StreamReader<ProcessChunk>> {
    const { timeout = 60, env = null, cwd = "", user = "", background = false, shell = false } = opts;
    let command: string;
    let args: string[];
    if (shell) {
      command = "sh";
      args = ["-c", cmd];
    } else {
      [command, args] = CommandsModule._parseCmd(cmd);
    }

    const start_time = _seams.monotonic();

    const reader = await this._process.start(this._envd_url, this._envd_token, {
      cmd: command,
      args,
      env,
      cwd,
      timeout,
      user,
    });

    if (background) return reader;

    const stdout_parts: string[] = [];
    const stderr_parts: string[] = [];
    let exit_code = 0;

    for await (const chunk of reader) {
      if (chunk.type === ProcessChunkType.STDOUT) {
        stdout_parts.push(chunk.data);
      } else if (chunk.type === ProcessChunkType.STDERR) {
        stderr_parts.push(chunk.data);
      } else if (chunk.type === ProcessChunkType.EXIT) {
        exit_code = chunk.exit_code || 0;
      }
    }

    const execution_time = _seams.monotonic() - start_time;

    return new ProcessResult({
      stdout: stdout_parts.join(""),
      stderr: stderr_parts.join(""),
      exit_code,
      execution_time,
    });
  }

  /** Run a command and stream output chunks (stdout, stderr, exit events). */
  async *stream(cmd: string, opts: StartOptions = {}): AsyncGenerator<ProcessChunk> {
    const { timeout = 60, env = null, cwd = "", user = "" } = opts;
    const [command, args] = CommandsModule._parseCmd(cmd);
    const reader = await this._process.start(this._envd_url, this._envd_token, {
      cmd: command,
      args,
      env,
      cwd,
      timeout,
      user,
    });
    for await (const chunk of reader) {
      yield chunk;
    }
  }

  /** Start a command without waiting, returning a StreamReader. */
  async start(cmd: string, opts: StartOptions = {}): Promise<StreamReader<ProcessChunk>> {
    const { timeout = 60, env = null, cwd = "", user = "" } = opts;
    const [command, args] = CommandsModule._parseCmd(cmd);
    return this._process.start(this._envd_url, this._envd_token, {
      cmd: command,
      args,
      env,
      cwd,
      timeout,
      user,
    });
  }

  /** List running processes in the sandbox. */
  async list(): Promise<ProcessInfo[]> {
    return this._process.listProcesses(this._envd_url, this._envd_token);
  }

  /** Kill a process by PID. */
  async kill(pid: number | string): Promise<void> {
    await this._process.sendSignal(this._envd_url, this._envd_token, { pid, signal: 9 });
  }


  /** Send data to a process's stdin. */
  async sendInput(pid: number | string, data: string): Promise<void> {
    await this._process.sendInput(this._envd_url, this._envd_token, { pid, data });
  }

  /** Send a signal to a process (e.g. SIGTERM=15, SIGKILL=9). */
  async sendSignal(pid: number | string, signal: number = 15): Promise<void> {
    await this._process.sendSignal(this._envd_url, this._envd_token, { pid, signal });
  }
}
