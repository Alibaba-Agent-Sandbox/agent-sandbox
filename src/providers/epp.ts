/**
 * EPP/1 client: JSON-RPC 2.0 over a plugin's stdin/stdout (NDJSON), plus error mapping (port of `providers/epp.py`).
 *
 * Security properties (design section 8): the plugin gets a scrubbed environment and its own process group, secrets are
 * sent only inside `initialize`, protocol lines and the stderr ring are capped, every plugin-supplied string is
 * sanitized and redacted before it reaches an error, and the process group is reaped on every exit path.
 */

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as path from "node:path";

import {
  AuthenticationError,
  CommandTimeoutError,
  ConnectionError_,
  FileNotFoundError_,
  InvalidAPIKeyError,
  InvalidCredentialsError,
  NetworkError,
  PermissionDeniedError,
  QuotaExceededError,
  RegionUnavailableError,
  SandboxError,
  SandboxNotFoundError,
  TemplateNotFoundError,
  TokenExchangeError,
  TokenExpiredError,
  type SandboxErrorOptions,
} from "../models/errors.js";
import { getLogger } from "../utils/logging.js";
import {
  ProviderConfigError,
  ProviderError,
  ProviderFeatureNotSupportedError,
  ProviderManifestError,
  ProviderProcessError,
  ProviderProtocolError,
  ProviderResourceNotFoundError,
  ProviderTimeoutError,
  ProviderVersionError,
  exitCodeFor,
} from "./errors.js";

export { exitCodeFor };

const logger = getLogger("providers.epp");

export const PROTOCOL = "epp/1";
export const MAX_LINE_BYTES = 8 * 1024 * 1024;
export const STDERR_RING_BYTES = 64 * 1024;

const ENV_ALLOW = ["PATH", "HOME", "USERPROFILE", "TMPDIR", "TEMP", "TMP", "LANG", "SYSTEMROOT", "COMSPEC", "ComSpec"];
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-_]/g;
const CTRL = /[\x00-\x08\x0b-\x1f\x7f]/g;
const CTRL_KEEP_WS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

// ------------------------------------------------------------------ errors

type ErrorCtor = new (message: string, options?: SandboxErrorOptions) => SandboxError;

/** `sdk_code` -> exception class (codes a plugin may name in `error.data.sdk_code`). */
const SDK_CODE_CLASSES: ReadonlyMap<string, ErrorCtor> = new Map(
  (
    [
      InvalidAPIKeyError,
      TokenExpiredError,
      InvalidCredentialsError,
      TokenExchangeError,
      TemplateNotFoundError,
      SandboxNotFoundError,
      QuotaExceededError,
      RegionUnavailableError,
      CommandTimeoutError,
      FileNotFoundError_,
      PermissionDeniedError,
      NetworkError,
      ConnectionError_,
    ] as unknown as ErrorCtor[]
  ).map((cls) => [(cls as unknown as { code: string }).code, cls]),
);

function asDict(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function pyStr(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function flatten(value: unknown): string {
  return pyStr(value).replace(ANSI, "").replace(CTRL, "");
}

/** Strip ANSI/control characters and redact `secrets` (>= 4 characters) from plugin-supplied text. */
export function sanitizeText(text: string, secrets: readonly string[] = []): string {
  let out = text.replace(ANSI, "");
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join("***");
  }
  return out.replace(CTRL_KEEP_WS, "");
}

/** Map a JSON-RPC `error` object to the SDK exception hierarchy (design section 7.4). */
export function mapError(err: Readonly<Record<string, unknown>>, providerId: string, secrets: readonly string[] = []): SandboxError {
  const code = err["code"];
  const message = sanitizeText(flatten(err["message"] ?? "provider error"), secrets);
  const data = asDict(err["data"]);
  const sdkCode = typeof data["sdk_code"] === "string" ? (data["sdk_code"] as string) : null;
  const suggestion = data["suggestion"] ? sanitizeText(flatten(data["suggestion"]), secrets) : null;
  const opts: SandboxErrorOptions = suggestion ? { suggestion } : {};

  const bySdkCode = (dflt: ErrorCtor): SandboxError => {
    const Cls = SDK_CODE_CLASSES.get(sdkCode ?? "") ?? dflt;
    return new Cls(message, opts);
  };

  if (code === -32001) return bySdkCode(AuthenticationError as unknown as ErrorCtor);
  if (code === -32002) {
    if (sdkCode !== null && SDK_CODE_CLASSES.has(sdkCode)) return bySdkCode(ProviderResourceNotFoundError as unknown as ErrorCtor);
    return new ProviderResourceNotFoundError(message, opts);
  }
  if (code === -32003) {
    const details = asDict(data["details"]);
    const feature = pyStr(details["feature"] || data["feature"] || "unknown");
    return new ProviderFeatureNotSupportedError(providerId, feature, { message, ...opts });
  }
  if (code === -32004) return new QuotaExceededError(message, opts);
  if (code === -32005) return new ProviderTimeoutError(message, opts);
  if (code === -32006) return new ProviderConfigError(message, opts);
  if (code === -32000) {
    if (sdkCode !== null && SDK_CODE_CLASSES.has(sdkCode)) return bySdkCode(ProviderError as unknown as ErrorCtor);
    return new ProviderError(message, opts);
  }
  const exc = new ProviderProtocolError(message, opts);
  exc.rpc_code = typeof code === "number" ? code : undefined;
  return exc;
}

/** True for a `-32601` answer: the plugin does not implement the (optional) method. */
export function isMethodNotFound(exc: unknown): boolean {
  return (exc as { rpc_code?: number } | null)?.rpc_code === -32601;
}

// ------------------------------------------------------------------ helpers

/** The only environment a plugin process gets (design section 8.3). */
export function scrubbedEnv(dataDir: string, passthrough: readonly string[] = [], environ: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of [...ENV_ALLOW, ...passthrough]) {
    const v = environ[name];
    if (v !== undefined) env[name] = v;
  }
  for (const [name, value] of Object.entries(environ)) {
    if (name.startsWith("LC_") && value !== undefined) env[name] = value;
  }
  env["ABX_PROVIDER_DATA_DIR"] = dataDir;
  env["PYTHONDONTWRITEBYTECODE"] = "1";
  return env;
}

/** Resolve `./`-prefixed argv elements inside the plugin directory (no escape). */
export function resolveCommand(command: readonly string[], pluginRoot: string): string[] {
  const root = path.resolve(pluginRoot);
  return command.map((item) => {
    if (item.startsWith("./") || item.startsWith(".\\")) {
      const resolved = path.resolve(root, item);
      const rel = path.relative(root, resolved);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new ProviderManifestError(`Invalid abx-provider.toml: '${item}' escapes the plugin directory.`);
      }
      return resolved;
    }
    return item;
  });
}

/** Minimal unbounded async queue (`null` marks the end of a stream). */
export class AsyncQueue<T> {
  private items: T[] = [];
  private waiters: Array<(v: T) => void> = [];

  push(item: T): void {
    const w = this.waiters.shift();
    if (w) w(item);
    else this.items.push(item);
  }

  get(): Promise<T> {
    const item = this.items.shift();
    if (item !== undefined) return Promise.resolve(item);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /** Resolves with the next item, or `undefined` after `ms` without one. */
  getWithin(ms: number): Promise<T | undefined> {
    const item = this.items.shift();
    if (item !== undefined) return Promise.resolve(item);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(waiter);
        if (idx >= 0) this.waiters.splice(idx, 1);
        resolve(undefined);
      }, ms);
      const waiter = (v: T): void => {
        clearTimeout(timer);
        resolve(v);
      };
      this.waiters.push(waiter);
    });
  }
}

export type Notification = { method: string } & Record<string, unknown>;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

export interface EppClientOptions {
  cwd: string;
  env: Readonly<Record<string, string>>;
  /** Seconds. */
  startupTimeout?: number;
  /** Seconds. */
  callTimeout?: number;
  secrets?: readonly string[];
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Plugin processes still running; killed synchronously when the CLI exits without a graceful `close()` (Ctrl-C, `process.exit`). */
const livePlugins = new Set<EppClient>();
let exitHookInstalled = false;

export function killAllPlugins(): void {
  for (const client of [...livePlugins]) client.killNow();
}

/** One plugin process speaking EPP/1. Create with `start()`; always `close()`. */
export class EppClient {
  plugin_info: Record<string, unknown> = {};
  features: ReadonlySet<string> = new Set();

  private proc: ChildProcessWithoutNullStreams | null = null;
  private exited: Promise<number | null> | null = null;
  private exitCode: number | null | undefined;
  private nextId = 0;
  private pending = new Map<number, Pending>();
  private stderrChunks: Buffer[] = [];
  private stderrSize = 0;
  private queues = new Map<string, AsyncQueue<Notification | null>>();
  private early = new Map<string, Notification[]>();
  private failure_: SandboxError | null = null;
  private closed = false;
  private stdoutBuf: Buffer = Buffer.alloc(0);
  private readonly secrets: string[];
  private readonly startupTimeout: number;
  private readonly callTimeout: number;
  private readerDone: Promise<void> = Promise.resolve();

  constructor(
    readonly provider_id: string,
    private readonly argv: readonly string[],
    private readonly opts: EppClientOptions,
  ) {
    livePlugins.add(this);
    if (!exitHookInstalled) {
      exitHookInstalled = true;
      process.once("exit", killAllPlugins);
    }
    this.secrets = (opts.secrets ?? []).filter(Boolean);
    this.startupTimeout = opts.startupTimeout ?? 10;
    this.callTimeout = opts.callTimeout ?? 60;
  }

  get failure(): SandboxError | null {
    return this.failure_;
  }

  get stderrTail(): string {
    return sanitizeText(Buffer.concat(this.stderrChunks).toString("utf-8"), this.secrets).trim();
  }

  private withTail(): string {
    const tail = this.stderrTail;
    return tail ? `Plugin stderr: ${tail.slice(-500)}` : "";
  }

  // -- lifecycle

  /** Spawn the plugin and perform `initialize`; returns its result. */
  async start(initParams: Record<string, unknown>): Promise<Record<string, unknown>> {
    const [cmd, ...args] = this.argv;
    if (!cmd) throw new ProviderProcessError(`Cannot start provider '${this.provider_id}': empty command.`);
    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawn(cmd, args, {
        cwd: this.opts.cwd,
        env: { ...this.opts.env },
        shell: false,
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      }) as ChildProcessWithoutNullStreams;
    } catch (exc) {
      throw this.spawnFailure(exc);
    }
    this.proc = proc;
    let spawnError: unknown = null;
    const spawned = new Promise<void>((resolve) => {
      proc.once("spawn", () => resolve());
      proc.once("error", (e) => {
        spawnError = e;
        resolve();
      });
    });
    this.exited = new Promise((resolve) => {
      proc.once("close", (code) => {
        this.exitCode = code;
        resolve(code);
      });
      proc.once("error", () => {
        if (this.exitCode === undefined) {
          this.exitCode = null;
          resolve(null);
        }
      });
    });
    proc.stdin.on("error", () => undefined);
    proc.stderr.on("data", (chunk: Buffer) => this.onStderr(chunk));
    this.readerDone = this.attachReader(proc);
    await spawned;
    if (spawnError !== null) {
      this.closed = true;
      await Promise.race([this.readerDone, sleep(2000)]);
      throw this.spawnFailure(spawnError);
    }

    let result: unknown;
    try {
      result = await this.call("initialize", initParams, { timeout: this.startupTimeout, startup: true });
    } catch (exc) {
      await this.close();
      if (exc instanceof ProviderTimeoutError) {
        throw new ProviderTimeoutError(`Provider '${this.provider_id}' did not initialize within ${this.startupTimeout}s.`, {
          suggestion: this.withTail(),
        });
      }
      throw exc;
    }
    const res = asDict(result);
    if (res["protocol"] !== PROTOCOL) {
      await this.close();
      throw new ProviderVersionError(`Provider '${this.provider_id}' answered protocol '${pyStr(res["protocol"])}', expected '${PROTOCOL}'.`);
    }
    this.plugin_info = asDict(res["plugin"]);
    const feats = res["features"];
    this.features = Array.isArray(feats) ? new Set(feats.filter((f): f is string => typeof f === "string")) : new Set();
    return res;
  }

  private spawnFailure(exc: unknown): ProviderProcessError {
    const e = exc as NodeJS.ErrnoException;
    return new ProviderProcessError(`Cannot start provider '${this.provider_id}': ${sanitizeText(e.code ?? e.message ?? String(exc))}.`, {
      suggestion: `Run 'abx provider doctor ${this.provider_id}'.`,
    });
  }

  /** Synchronous last resort: SIGKILL the plugin and everything it started. */
  killNow(): void {
    this.closed = true;
    livePlugins.delete(this);
    this.signalGroup("SIGKILL");
    this.reapGroup();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const proc = this.proc;
    if (proc !== null && this.exitCode === undefined) {
      try {
        await this.callRaw("shutdown", {}, 2);
      } catch {
        /* the plugin may already be gone */
      }
      try {
        proc.stdin.end();
      } catch {
        /* ignore */
      }
      if (!(await this.waitExit(3000))) {
        this.signalGroup("SIGTERM");
        if (!(await this.waitExit(3000))) {
          this.signalGroup("SIGKILL");
          await this.waitExit(3000);
        }
      }
    }
    this.reapGroup();
    livePlugins.delete(this);
    if (proc !== null) {
      proc.stdout.destroy();
      proc.stderr.destroy();
      proc.stdin.destroy();
    }
    await Promise.race([this.readerDone, sleep(2000)]);
    this.failAll(new ProviderProcessError(`Provider '${this.provider_id}' was closed.`), true);
  }

  private async waitExit(ms: number): Promise<boolean> {
    if (this.exitCode !== undefined) return true;
    if (this.exited === null) return true;
    const raced = await Promise.race([this.exited.then(() => true), sleep(ms).then(() => false)]);
    return raced;
  }

  /** Kill children the plugin left behind (POSIX: the plugin leads its own session). */
  private reapGroup(): void {
    const proc = this.proc;
    if (proc === null || process.platform === "win32" || proc.pid === undefined) return;
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      /* group already gone */
    }
  }

  private signalGroup(sig: NodeJS.Signals): void {
    const proc = this.proc;
    if (proc === null || this.exitCode !== undefined || proc.pid === undefined) return;
    try {
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/T", "/F", "/PID", String(proc.pid)], { windowsHide: true });
      } else {
        process.kill(-proc.pid, sig);
      }
    } catch {
      try {
        proc.kill(sig);
      } catch {
        /* ignore */
      }
    }
  }

  // -- I/O

  private onStderr(chunk: Buffer): void {
    this.stderrChunks.push(chunk);
    this.stderrSize += chunk.length;
    while (this.stderrSize > STDERR_RING_BYTES && this.stderrChunks.length > 0) {
      const first = this.stderrChunks[0] as Buffer;
      const overflow = this.stderrSize - STDERR_RING_BYTES;
      if (first.length <= overflow) {
        this.stderrChunks.shift();
        this.stderrSize -= first.length;
      } else {
        this.stderrChunks[0] = first.subarray(overflow);
        this.stderrSize -= overflow;
      }
    }
  }

  private attachReader(proc: ChildProcessWithoutNullStreams): Promise<void> {
    return new Promise((resolve) => {
      let finished = false;
      const done = (): void => {
        if (finished) return;
        finished = true;
        resolve();
      };
      proc.stdout.on("data", (chunk: Buffer) => {
        if (this.failure_ !== null && this.stdoutBuf.length === 0 && finished) return;
        this.stdoutBuf = this.stdoutBuf.length === 0 ? chunk : Buffer.concat([this.stdoutBuf, chunk]);
        for (;;) {
          const nl = this.stdoutBuf.indexOf(10);
          if (nl < 0) {
            if (this.stdoutBuf.length > MAX_LINE_BYTES) {
              this.violation("Plugin sent a protocol line larger than 8 MiB.");
              this.stdoutBuf = Buffer.alloc(0);
              proc.stdout.destroy();
              done();
            }
            return;
          }
          const line = this.stdoutBuf.subarray(0, nl);
          this.stdoutBuf = this.stdoutBuf.subarray(nl + 1);
          if (line.length > MAX_LINE_BYTES) {
            this.violation("Plugin sent a protocol line larger than 8 MiB.");
            this.stdoutBuf = Buffer.alloc(0);
            proc.stdout.destroy();
            done();
            return;
          }
          if (!this.handleLine(line)) {
            this.stdoutBuf = Buffer.alloc(0);
            proc.stdout.destroy();
            done();
            return;
          }
        }
      });
      const onEnd = (): void => {
        if (finished) return;
        void (this.exited ?? Promise.resolve(null)).then((rc) => {
          if (!this.closed || this.failure_ === null) {
            this.failAll(
              new ProviderProcessError(`Provider '${this.provider_id}' exited unexpectedly (code ${rc === null ? "None" : rc}).`, {
                suggestion: this.withTail(),
              }),
              true,
            );
          }
          done();
        });
      };
      proc.stdout.once("end", onEnd);
      proc.stdout.once("close", onEnd);
    });
  }

  /** Returns false when the line was a protocol violation (the process has been killed). */
  private handleLine(raw: Buffer): boolean {
    const text = raw.toString("utf-8").trim();
    if (!text) return true;
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      this.violation("Plugin sent a malformed (non-JSON) protocol line.");
      return false;
    }
    if (typeof msg !== "object" || msg === null || Array.isArray(msg)) {
      this.violation("Plugin sent a protocol line that is not a JSON object.");
      return false;
    }
    this.dispatch(msg as Record<string, unknown>);
    return true;
  }

  private violation(message: string): void {
    this.signalGroup("SIGKILL");
    this.failAll(new ProviderProtocolError(`Provider '${this.provider_id}': ${message}`, { suggestion: this.withTail() }), true);
  }

  private failAll(exc: SandboxError, endStreams = false): void {
    if (this.failure_ === null) this.failure_ = exc;
    for (const p of this.pending.values()) p.reject(exc);
    this.pending.clear();
    if (endStreams) for (const q of this.queues.values()) q.push(null);
  }

  private dispatch(msg: Record<string, unknown>): void {
    if ("id" in msg && ("result" in msg || "error" in msg)) {
      const id = msg["id"];
      const pend = typeof id === "number" ? this.pending.get(id) : undefined;
      if (pend === undefined) return;
      this.pending.delete(id as number);
      const error = msg["error"];
      if ("error" in msg && typeof error === "object" && error !== null && !Array.isArray(error)) {
        pend.reject(mapError(error as Record<string, unknown>, this.provider_id, this.secrets));
      } else {
        pend.resolve(msg["result"]);
      }
      return;
    }
    const method = msg["method"];
    const params = asDict(msg["params"]);
    if (method === "log") {
      logger.debug("[%s] %s", this.provider_id, sanitizeText(pyStr(params["message"] ?? ""), this.secrets));
      return;
    }
    const pid = params["process_id"];
    if (typeof method === "string" && pid !== null && pid !== undefined) {
      const key = pyStr(pid);
      const note: Notification = { method, ...params };
      const queue = this.queues.get(key);
      if (queue === undefined) {
        const list = this.early.get(key) ?? [];
        list.push(note);
        this.early.set(key, list);
      } else {
        queue.push(note);
      }
    }
  }

  // -- API

  private async callRaw(method: string, params: Record<string, unknown>, timeoutSeconds: number): Promise<unknown> {
    return this.call(method, params, { timeout: timeoutSeconds, startup: true });
  }

  /** Send a request and await its result (errors are mapped to SDK exceptions). */
  async call(method: string, params: Record<string, unknown> = {}, opts: { timeout?: number; startup?: boolean } = {}): Promise<unknown> {
    if (this.failure_ !== null) throw this.failure_;
    const proc = this.proc;
    if (proc === null || this.exitCode !== undefined || proc.stdin.destroyed || !proc.stdin.writable) {
      throw new ProviderProcessError(`Provider '${this.provider_id}' is not running.`);
    }
    this.nextId += 1;
    const rid = this.nextId;
    const limit = opts.timeout ?? this.callTimeout;
    const result = new Promise<unknown>((resolve, reject) => this.pending.set(rid, { resolve, reject }));
    result.catch(() => undefined);
    const payload = JSON.stringify({ jsonrpc: "2.0", id: rid, method, params });
    try {
      await new Promise<void>((resolve, reject) => {
        proc.stdin.write(`${payload}\n`, (err) => (err ? reject(err) : resolve()));
      });
    } catch {
      this.pending.delete(rid);
      throw new ProviderProcessError(`Provider '${this.provider_id}' closed its input.`, { suggestion: this.withTail() });
    }
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new TimeoutMarker()), limit * 1000);
    });
    try {
      return await Promise.race([result, timeout]);
    } catch (exc) {
      if (!(exc instanceof TimeoutMarker)) throw exc;
      this.pending.delete(rid);
      if (!opts.startup) {
        try {
          proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "$/cancel", params: { id: rid } })}\n`);
        } catch {
          /* ignore */
        }
      }
      throw new ProviderTimeoutError(`Provider '${this.provider_id}' did not answer '${method}' within ${limit}s.`, {
        suggestion: this.withTail(),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Register a notification queue for a process id (drains early notifications). */
  openStream(processId: string): AsyncQueue<Notification | null> {
    const queue = new AsyncQueue<Notification | null>();
    this.queues.set(processId, queue);
    for (const note of this.early.get(processId) ?? []) queue.push(note);
    this.early.delete(processId);
    if (this.failure_ !== null) queue.push(null);
    return queue;
  }

  closeStream(processId: string): void {
    this.queues.delete(processId);
  }
}

class TimeoutMarker extends Error {}
