/**
 * envd API protocol — process management (Connect protocol) (port of `protocol/process.py`).
 *
 * Uses Connect RPC over HTTP with application/connect+json content type.
 * Streaming endpoints (Start, Connect) return a StreamReader of typed chunks.
 *
 * RPC endpoints（已实测验证）:
 * - /process.Process/Start (streaming) — Start a process and stream output
 * - /process.Process/List — List running processes
 * - /process.Process/Connect (streaming) — Connect to existing process output
 * - /process.Process/Update — Update process settings
 * - /process.Process/SendInput — Send stdin to a process
 * - /process.Process/SendSignal — Send signal to a process
 */

import { CommandTimeoutError } from "../models/errors.js";
import { ProcessChunk, ProcessChunkType, ProcessInfo } from "../models/process.js";
import { ConnectCodec } from "../transport/codec.js";
import { StreamReader } from "../transport/streaming.js";
import type { EnvdTokenManager } from "../transport/auth.js";
import { HTTPStatusError, ReadTimeout, envdStatusError, type HttpClient } from "../transport/http.js";
import { dictGet, ValueError } from "../api/_pyerrors.js";
import { pyRepr } from "../utils/_pyformat.js";
import { pyFloat } from "../utils/coerce.js";
import { getLogger } from "../utils/logging.js";
import { pyB64Decode } from "./_b64.js";

const logger = getLogger("protocol.process");
void logger;

/**
 * Extra seconds added to the process-level timeout to derive the HTTP read timeout. This avoids the HTTP layer timing
 * out *before* the server-side process timeout fires, which would produce a misleading ReadTimeout instead of a clean
 * process-timeout error.
 */
export const _HTTP_TIMEOUT_BUFFER = 5.0;

/** envd lists `config.cmd` / `config.args`; the CLI table column is `command`. */
function withCommand(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const row = raw as Record<string, unknown>;
  if (typeof row.command === "string" && row.command.trim()) return raw;
  const config = row.config;
  const cfg = typeof config === "object" && config !== null ? (config as Record<string, unknown>) : {};
  const cmd = typeof cfg.cmd === "string" ? cfg.cmd : typeof row.cmd === "string" ? row.cmd : "";
  const argsRaw = Array.isArray(cfg.args) ? cfg.args : Array.isArray(row.args) ? row.args : [];
  const args = argsRaw.map((item) => String(item)).filter((item) => item !== cmd);
  const command = [cmd, ...args].filter(Boolean).join(" ");
  return { ...row, command };
}

const _codec = new ConnectCodec();

// RPC paths（已实测验证）
const _START = _codec.buildRpcPath("process", "Process", "Start");
const _LIST = _codec.buildRpcPath("process", "Process", "List");
const _CONNECT = _codec.buildRpcPath("process", "Process", "Connect");
const _UPDATE = _codec.buildRpcPath("process", "Process", "Update");
const _SEND_INPUT = _codec.buildRpcPath("process", "Process", "SendInput");
const _SEND_SIGNAL = _codec.buildRpcPath("process", "Process", "SendSignal");

/** envd `Signal` enum (process.proto): only these two can be delivered through `SendSignal`. */
const _SIGNAL_NAMES: ReadonlyMap<number, string> = new Map([
  [9, "SIGNAL_SIGKILL"],
  [15, "SIGNAL_SIGTERM"],
]);

/**
 * Build envd's `ProcessSelector` (`{"pid": N}` or `{"tag": "..."}`).
 *
 * A digit-only string is a pid (the CLI passes pids as text); any other string is a process tag.
 */
export function _processSelector(pid: number | bigint | string): Record<string, unknown> {
  if (typeof pid === "boolean") throw new TypeError("pid must be an int or str, not bool");
  if (typeof pid === "number" || typeof pid === "bigint") return { pid };
  const text = String(pid).trim();
  if (/^[0-9]+$/.test(text)) return { pid: Number.isSafeInteger(Number(text)) ? Number(text) : BigInt(text) };
  return { tag: text };
}

/** Python `format(x, "g")` for the finite, moderate values used as timeouts. */
function _formatG(x: number): string {
  return String(Number(x.toPrecision(6)));
}

function isDict(v: unknown): v is Record<string, any> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function decodeB64Text(raw: unknown): string {
  try {
    return pyB64Decode(raw as string).toString("utf8");
  } catch {
    return raw as string;
  }
}

/**
 * Parse a streaming frame into a ProcessChunk.
 *
 * 已实测验证的 NDJSON event 格式:
 * - {"event":{"start":{"pid":N}}} — 进程启动
 * - {"event":{"data":{"stdout":"base64"}}} — stdout 数据（base64 编码）
 * - {"event":{"data":{"stderr":"base64"}}} — stderr 数据（base64 编码）
 * - {"event":{"end":{"exitCode":N,"exited":bool,"status":"exited"}}} — 进程结束
 * - {} — 空结束帧（忽略）
 */
export function _parseProcessChunk(frame: Record<string, any>): ProcessChunk {
  const event = dictGet(frame, "event");
  if (!event || !isDict(event)) {
    // 空帧或无 event 字段 — 忽略
    return new ProcessChunk({ type: ProcessChunkType.STDOUT, data: "" });
  }

  // 进程启动事件
  if ("start" in event) {
    const start_data = event["start"];
    const pid = dictGet(start_data, "pid", 0);
    return new ProcessChunk({ type: ProcessChunkType.STDOUT, data: "", exit_code: null, pid });
  }

  // 数据输出事件（stdout/stderr，base64 编码）
  if ("data" in event) {
    const data_obj = event["data"];
    if ("stdout" in data_obj) {
      return new ProcessChunk({ type: ProcessChunkType.STDOUT, data: decodeB64Text(data_obj["stdout"]) });
    }
    if ("stderr" in data_obj) {
      return new ProcessChunk({ type: ProcessChunkType.STDERR, data: decodeB64Text(data_obj["stderr"]) });
    }
  }

  // 进程结束事件
  if ("end" in event) {
    const end_data = event["end"];
    const exit_code = dictGet(end_data, "exitCode", 0);
    return new ProcessChunk({ type: ProcessChunkType.EXIT, exit_code });
  }

  // 未知事件
  return new ProcessChunk({ type: ProcessChunkType.STDOUT, data: "" });
}

export interface ProcessStartOptions {
  cmd: string;
  args?: string[] | null;
  env?: Record<string, string> | null;
  cwd?: string;
  timeout?: number;
  user?: string;
}

/**
 * Typed wrapper for envd process operations (Connect protocol).
 *
 * 已实测验证的方法: Start, List, Connect, Update, SendInput, SendSignal
 */
export class ProcessProtocol {
  _http: HttpClient;

  constructor(http_client: HttpClient) {
    this._http = http_client;
  }

  /**
   * Start a process and return a streaming reader.
   *
   * POST envd_url + /process.Process/Start (Connect streaming)
   *
   * 请求格式（已实测验证）: {"process": {"cmd": "...", "args": [...]}}
   *
   * Note: `cwd` and `user` are only included in the payload when explicitly provided (non-empty). Sending
   * `user="user"` to certain platform base images triggers `fork/exec: no such file or directory` because the envd uses
   * a namespace that doesn't recognise that user account.
   */
  async start(
    envd_url: string,
    envd_token: EnvdTokenManager,
    opts: ProcessStartOptions,
  ): Promise<StreamReader<ProcessChunk>> {
    const { cmd, args = null, env = null, cwd = "", timeout = 60, user = "" } = opts;
    const process_obj: Record<string, unknown> = { cmd };
    if (args && args.length) process_obj["args"] = args;
    if (env && Object.keys(env).length) process_obj["envs"] = env;
    if (cwd) process_obj["cwd"] = cwd;
    if (user) process_obj["user"] = user;

    const payload: Record<string, unknown> = { process: process_obj };

    // Derive the HTTP read timeout from the process-level timeout so that long-running commands (e.g. `pip install`)
    // are not killed prematurely by the HTTP layer's default 30 s timeout.
    const http_timeout = pyFloat(timeout) + _HTTP_TIMEOUT_BUFFER;

    const raw_stream = this._http.envdStream(envd_url, _START, {
      payload,
      envd_token,
      request_timeout: http_timeout,
    });

    const guarded = this._guardCommandTimeout(raw_stream, envd_url, envd_token, { timeout, http_timeout });
    return new StreamReader(guarded, _parseProcessChunk);
  }

  /**
   * Re-raise the HTTP read timeout of a command stream as {@link CommandTimeoutError} (KI-003).
   *
   * The HTTP read timeout is derived from the command timeout, so a silent command that outlives it surfaces from httpx
   * as `ReadTimeout`. The process is killed on a best-effort basis (closing the HTTP stream does not stop it) and the
   * SDK error is raised.
   */
  async *_guardCommandTimeout(
    raw_stream: AsyncIterable<Record<string, any>>,
    envd_url: string,
    envd_token: EnvdTokenManager,
    opts: { timeout: number; http_timeout: number },
  ): AsyncGenerator<Record<string, any>> {
    let pid: number | null = null;
    try {
      for await (const frame of raw_stream) {
        const started = dictGet(dictGet(frame, "event", null) || {}, "start", null);
        if (isDict(started) && typeof started["pid"] === "number" && Number.isInteger(started["pid"])) pid = started["pid"];
        yield frame;
      }
    } catch (exc) {
      if (!(exc instanceof ReadTimeout)) throw exc;
      if (pid !== null) {
        try {
          await this.sendSignal(envd_url, envd_token, { pid, signal: 9, request_timeout: 10.0 });
        } catch {
          // best effort: the timeout is what the caller must see
          logger.debug("could not kill timed-out process %s", pid);
        }
      }
      let detail = `no output for ${_formatG(opts.http_timeout)}s`;
      if (pid !== null) detail += `; pid ${pid} was asked to stop`;
      throw new CommandTimeoutError(`Command timed out: did not finish within ${opts.timeout}s (${detail}).`);
    }
  }

  /** Unary envd call whose HTTP errors surface as `EnvdRpcError`. */
  async _unary(
    envd_url: string,
    envd_token: EnvdTokenManager,
    rpc_path: string,
    payload: Record<string, unknown>,
    request_timeout: number | null = null,
  ): Promise<Record<string, any>> {
    try {
      return await this._http.envdRequest(envd_url, rpc_path, { payload, envd_token, request_timeout });
    } catch (exc) {
      if (exc instanceof HTTPStatusError) throw envdStatusError(exc, rpc_path);
      throw exc;
    }
  }

  /**
   * List running processes in the sandbox.
   *
   * POST envd_url + /process.Process/List (Connect unary, 已实测验证)
   */
  async listProcesses(envd_url: string, envd_token: EnvdTokenManager): Promise<ProcessInfo[]> {
    const response = await this._unary(envd_url, envd_token, _LIST, {});

    const processes: unknown[] = dictGet(response, "processes", dictGet(dictGet(response, "result", {}), "processes", []));
    return processes.map((p) => ProcessInfo.modelValidate(withCommand(p)));
  }

  /**
   * Connect to an existing process and stream its output.
   *
   * POST envd_url + /process.Process/Connect (Connect streaming, 已实测验证)
   */
  async connectToProcess(
    envd_url: string,
    envd_token: EnvdTokenManager,
    opts: { pid: number | bigint | string },
  ): Promise<StreamReader<ProcessChunk>> {
    const raw_stream = this._http.envdStream(envd_url, _CONNECT, {
      payload: { process: _processSelector(opts.pid) },
      envd_token,
    });
    return new StreamReader(raw_stream, _parseProcessChunk);
  }

  /**
   * Update process settings.
   *
   * POST envd_url + /process.Process/Update (Connect unary, 已实测验证)
   */
  async update(
    envd_url: string,
    envd_token: EnvdTokenManager,
    opts: { pid: number | bigint | string; [key: string]: unknown },
  ): Promise<Record<string, any>> {
    const { pid, ...kwargs } = opts;
    const payload: Record<string, unknown> = { process: _processSelector(pid), ...kwargs };
    return this._unary(envd_url, envd_token, _UPDATE, payload);
  }

  /**
   * Send data to a process's stdin.
   *
   * POST envd_url + /process.Process/SendInput (Connect unary, 已实测验证)
   *
   * Body: `{"process": {"pid": N}, "input": {"stdin": <base64>}}` (`bytes` fields are base64 in protobuf-JSON).
   */
  async sendInput(envd_url: string, envd_token: EnvdTokenManager, opts: { pid: number | bigint | string; data: string }): Promise<void> {
    const stdin = Buffer.from(opts.data, "utf-8").toString("base64");
    await this._unary(envd_url, envd_token, _SEND_INPUT, { process: _processSelector(opts.pid), input: { stdin } });
  }

  /**
   * Send a signal to a process (SIGTERM=15 or SIGKILL=9).
   *
   * POST envd_url + /process.Process/SendSignal (Connect unary, 已实测验证)
   *
   * Body: `{"process": {"pid": N}, "signal": "SIGNAL_SIGTERM" | "SIGNAL_SIGKILL"}`. envd's `Signal` enum has only those
   * two values. The pid is envd's process id (`commands.list()` / the `start` event), which is not necessarily the OS
   * pid, so other signals cannot be emulated with `kill`.
   *
   * Throws `ValueError` when `signal` is neither 15 nor 9 (before any request).
   */
  async sendSignal(
    envd_url: string,
    envd_token: EnvdTokenManager,
    opts: { pid: number | bigint | string; signal?: number; request_timeout?: number | null },
  ): Promise<void> {
    const { pid, signal = 15, request_timeout = null } = opts;
    const name = typeof signal === "number" ? _SIGNAL_NAMES.get(signal) : undefined;
    if (name === undefined) {
      throw new ValueError(`envd can only deliver SIGTERM (15) and SIGKILL (9) to a process; got ${pyRepr(signal)}`);
    }
    await this._unary(envd_url, envd_token, _SEND_SIGNAL, { process: _processSelector(pid), signal: name }, request_timeout);
  }

  // --- backward-compat aliases ---

  /** Deprecated: use sendInput(). Kept for backward compatibility. */
  async sendStdin(envd_url: string, envd_token: EnvdTokenManager, opts: { pid: number | bigint | string; data: string }): Promise<void> {
    await this.sendInput(envd_url, envd_token, opts);
  }

  /** Deprecated: use sendSignal(). Kept for backward compatibility. */
  async kill(envd_url: string, envd_token: EnvdTokenManager, opts: { pid: number | bigint | string }): Promise<void> {
    await this.sendSignal(envd_url, envd_token, { pid: opts.pid, signal: 9 });
  }
}
