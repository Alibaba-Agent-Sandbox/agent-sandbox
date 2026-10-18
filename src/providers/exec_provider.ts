import { sessionAuth as e2bSessionAuth, openTerminal as e2bOpenTerminal } from "./shared/e2b/session.js";
import type { SandboxInfo as SessionInfo } from "../models/sandbox.js";
import type { TerminalContext as SessionTerminalContext, ProviderInfra as SessionInfra } from "./base.js";
/**
 * `exec` providers: manifest-described plugin processes spoken to over EPP/1 (port of `providers/exec_provider.py`).
 *
 * The adapters implement the shape of the built-in protocol classes (`protocol/sandbox.ts`, `process.ts`,
 * `filesystem.ts`) so `api/sandbox.ts` can use them unchanged. In hybrid mode (a record with a real `envd_url`) process
 * and file calls are delegated to the native envd transport.
 */

import { Buffer } from "node:buffer";

import { CommandTimeoutError, SandboxError, SandboxNotFoundError } from "../models/errors.js";
import { FileInfo, FileType } from "../models/filesystem.js";
import { ProcessChunk, ProcessChunkType, ProcessInfo } from "../models/process.js";
import { SandboxInfo, SandboxStatus, type SandboxConfig } from "../models/sandbox.js";
import { decodeBytes, FilesystemProtocol } from "./shared/e2b/filesystem.js";
import { ProcessProtocol } from "./shared/e2b/process.js";
import type { DataPlaneAuth as EnvdTokenManager } from "../transport/auth_contract.js";
import type { LayeredConfig } from "../transport/config_layers.js";
import { HttpClient } from "../transport/http.js";
import { StreamReader } from "../transport/streaming.js";
import { Provider, consentedInherit, type ProviderInfra } from "./base.js";
import { EppClient, PROTOCOL, isMethodNotFound, resolveCommand, scrubbedEnv, type AsyncQueue, type EppPeer, type Notification } from "./epp.js";
import { ProviderFeatureNotSupportedError, ProviderProtocolError, ProviderResourceNotFoundError } from "./errors.js";
import { hostVersion } from "./host.js";
import type { Manifest } from "./manifest.js";
import * as store from "./store.js";

type Dict = Record<string, unknown>;

function asDict(v: unknown): Dict {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Dict) : {};
}

function parseTime(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const iso = /(?:Z|[+-]\d\d:?\d\d)$/i.test(value) ? value : `${value}Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

const STATUSES = new Set<string>(Object.values(SandboxStatus));

/** Convert an EPP `SandboxRecord` to the SDK's `SandboxInfo`. */
export function recordToInfo(rec: unknown, providerId: string): SandboxInfo {
  const r = asDict(rec);
  const sandboxId = r["sandbox_id"] === undefined || r["sandbox_id"] === null ? "" : String(r["sandbox_id"]);
  if (!sandboxId) throw new ProviderProtocolError(`Provider '${providerId}' returned a sandbox without an id.`);
  const rawStatus = String(r["status"] ?? "running");
  const status = STATUSES.has(rawStatus) ? rawStatus : SandboxStatus.RUNNING;
  const envdUrl = r["envd_url"] || r["url"];
  const meta = asDict(r["metadata"]);
  const data: Dict = {
    sandbox_id: sandboxId,
    template: String(r["template"] ?? ""),
    status,
    metadata: Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, String(v)])),
    // Non-envd providers get a marker URL; adapters recognise it and route over EPP.
    envd_url: typeof envdUrl === "string" && envdUrl ? envdUrl : `epp://${providerId}/${sandboxId}`,
    envd_access_token: typeof r["envd_access_token"] === "string" ? r["envd_access_token"] : null,
    started_at: parseTime(r["created_at"]),
    end_at: parseTime(r["expires_at"]),
  };
  // The model defaults (cn-hangzhou, 300 s) describe the built-in platform; a plugin must not inherit them by accident.
  // "" and 0 mean "the provider did not say"; the CLI prints them as "-".
  data["region"] = r["region"] ? String(r["region"]) : "";
  data["timeout"] = 0;
  const started = data["started_at"] as string | null;
  const ends = data["end_at"] as string | null;
  if (started && ends) {
    const lifetime = Math.round((Date.parse(ends) - Date.parse(started)) / 1000);
    if (lifetime > 0) data["timeout"] = lifetime;
  }
  return SandboxInfo.modelValidate(data);
}

export function isEppUrl(url: string): boolean {
  return url.startsWith("epp://");
}

function sandboxIdFrom(envdUrl: string): string {
  return envdUrl.slice(envdUrl.lastIndexOf("/") + 1);
}

/** Adapter for a feature group the plugin does not provide (every call raises E8004). */
export function unsupportedAdapter(providerId: string, feature: string): Record<string, (...args: unknown[]) => Promise<never>> {
  return new Proxy({} as Record<string, (...args: unknown[]) => Promise<never>>, {
    get: (_t, name) => {
      if (typeof name !== "string" || name === "then") return undefined;
      return async (): Promise<never> => {
        throw new ProviderFeatureNotSupportedError(providerId, feature);
      };
    },
  });
}

/** Seconds a stream waits beyond the command timeout for the plugin's `exec.exit` (tests shrink it). */
export const execTuning = { exitGraceSeconds: 5 };

export type CreateConfig = SandboxConfig & { secure?: boolean | null; provider_options?: Record<string, unknown> };

export class ExecSandboxProtocol {
  private hasConnect = true;
  private readonly pid: string;

  constructor(
    private readonly client: EppPeer,
    private readonly features: ReadonlySet<string>,
    private readonly secretOptionKeys: ReadonlySet<string> = new Set(),
  ) {
    this.pid = client.provider_id;
  }

  get hasPortUrl(): boolean {
    return this.features.has("ports.url");
  }

  /** Ask the plugin for the public URL (and access headers) of `port`. */
  async portUrl(sandboxId: string, port: number): Promise<[string, Record<string, string>]> {
    this.need("ports.url");
    const res = asDict(await this.client.call("ports.url", { sandbox_id: sandboxId, port: Math.trunc(port) }));
    const url = res["url"];
    if (typeof url !== "string" || !url) throw new ProviderProtocolError(`Provider '${this.pid}' returned no url for ports.url.`);
    const raw = asDict(res["headers"]);
    return [url, Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v)]))];
  }

  private need(feature: string): void {
    if (!this.features.has(feature)) throw new ProviderFeatureNotSupportedError(this.pid, feature);
  }

  /** A `sandbox.*` call that names an existing sandbox: "not found" is the SDK's `SandboxNotFoundError` (E2009) on every provider. */
  private async onSandbox<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (exc) {
      if (exc instanceof ProviderResourceNotFoundError) throw new SandboxNotFoundError(exc.message);
      throw exc;
    }
  }

  async create(config: CreateConfig, opts: { request_timeout?: number | null } = {}): Promise<SandboxInfo> {
    this.need("sandbox.lifecycle");
    const requestTimeout = opts.request_timeout ?? null;
    const params: Dict = {
      template: config.template,
      timeout: config.timeout,
      metadata: config.metadata,
      envs: config.env_vars,
      cpu: config.cpu,
      memory: config.memory,
      disk: config.disk,
      gpu: config.gpu,
      request_timeout: requestTimeout,
    };
    if (config.secure !== undefined && config.secure !== null) params["secure"] = config.secure;
    const options = Object.fromEntries(Object.entries(config.provider_options ?? {}).filter(([k]) => !this.secretOptionKeys.has(k)));
    if (Object.keys(options).length > 0) params["options"] = options;
    const rec = await this.client.call("sandbox.create", params, requestTimeout === null ? {} : { timeout: requestTimeout });
    return recordToInfo(rec, this.pid);
  }

  /** `sandbox.connect` when the plugin has it (it may resume), else `sandbox.get`. */
  async connect(sandboxId: string): Promise<SandboxInfo> {
    this.need("sandbox.lifecycle");
    if (this.hasConnect) {
      try {
        return await this.onSandbox(async () => recordToInfo(await this.client.call("sandbox.connect", { sandbox_id: sandboxId }), this.pid));
      } catch (exc) {
        if (!(exc instanceof ProviderProtocolError) || !isMethodNotFound(exc)) throw exc;
        this.hasConnect = false;
      }
    }
    return this.getInfo(sandboxId);
  }

  async getInfo(sandboxId: string): Promise<SandboxInfo> {
    this.need("sandbox.lifecycle");
    return this.onSandbox(async () => recordToInfo(await this.client.call("sandbox.get", { sandbox_id: sandboxId }), this.pid));
  }

  async list(opts: { status?: string | null; limit?: number; offset?: number } = {}): Promise<SandboxInfo[]> {
    this.need("sandbox.lifecycle");
    const limit = opts.limit ?? 100;
    const offset = opts.offset ?? 0;
    const out: SandboxInfo[] = [];
    let cursor: string | null = null;
    while (out.length < limit + offset) {
      const params: Dict = { limit: limit + offset };
      if (opts.status) params["status"] = opts.status;
      if (cursor) params["cursor"] = cursor;
      const res = asDict(await this.client.call("sandbox.list", params));
      const items = Array.isArray(res["sandboxes"]) ? (res["sandboxes"] as unknown[]) : [];
      out.push(...items.map((r) => recordToInfo(r, this.pid)));
      cursor = typeof res["next"] === "string" && res["next"] ? res["next"] : null;
      if (!cursor) break;
    }
    return out.slice(offset, offset + limit);
  }

  async kill(sandboxId: string): Promise<void> {
    this.need("sandbox.lifecycle");
    try {
      await this.client.call("sandbox.kill", { sandbox_id: sandboxId });
    } catch (exc) {
      if (exc instanceof ProviderResourceNotFoundError) return; // idempotent, like the built-in provider's 404 handling
      throw exc;
    }
  }

  async setTimeout(sandboxId: string, timeout: number): Promise<void> {
    this.need("sandbox.timeout");
    await this.onSandbox(() => this.client.call("sandbox.set_timeout", { sandbox_id: sandboxId, timeout }));
  }

  async isRunning(sandboxId: string): Promise<boolean> {
    const info = await this.getInfo(sandboxId);
    return info.status === SandboxStatus.RUNNING;
  }

  async pause(sandboxId: string): Promise<void> {
    this.need("sandbox.pause");
    await this.onSandbox(() => this.client.call("sandbox.pause", { sandbox_id: sandboxId }));
  }

  async resume(sandboxId: string): Promise<void> {
    this.need("sandbox.pause");
    await this.onSandbox(() => this.client.call("sandbox.resume", { sandbox_id: sandboxId }));
  }
}

function frameToChunk(frame: Record<string, unknown>): ProcessChunk {
  const kind = String(frame["type"] ?? "stdout");
  const type = kind === "stdout" || kind === "stderr" || kind === "exit" ? kind : ProcessChunkType.STDOUT;
  return new ProcessChunk({ type, data: String(frame["data"] ?? ""), exit_code: (frame["exit_code"] as number | null | undefined) ?? null });
}

export interface ProcessStartOpts {
  cmd: string;
  args?: string[] | null;
  env?: Record<string, string> | null;
  cwd?: string;
  timeout?: number;
  user?: string;
}

/**
 * An interactive terminal that a plugin hosts (`pty.*`). It has the shape of `TerminalSession`: output arrives as
 * `pty.output` notifications (`data_b64`), input and resize go out as calls, and `pty.exit` ends the stream.
 */
export class ExecTerminal {
  private open = true;

  constructor(
    private readonly client: EppPeer,
    private readonly sandboxId: string,
    private readonly ptyId: string,
    private readonly queue: AsyncQueue<Notification | null>,
  ) {}

  get is_connected(): boolean {
    return this.open;
  }

  async send(data: string): Promise<void> {
    await this.sendBytes(Buffer.from(data, "utf-8"));
  }

  async sendBytes(data: Uint8Array): Promise<void> {
    await this.client.call("pty.write", { sandbox_id: this.sandboxId, process_id: this.ptyId, data_b64: Buffer.from(data).toString("base64") });
  }

  async resize(cols: number, rows: number): Promise<void> {
    await this.client.call("pty.resize", { sandbox_id: this.sandboxId, process_id: this.ptyId, cols, rows });
  }

  private async next(timeoutMs: number | null): Promise<Uint8Array | null> {
    for (;;) {
      const note = timeoutMs === null ? await this.queue.get() : await this.queue.getWithin(timeoutMs);
      if (note === undefined) throw new CommandTimeoutError("No terminal output arrived in time.");
      if (note === null || note["method"] === "pty.exit") {
        this.open = false;
        return null;
      }
      if (note["method"] === "pty.output") return Buffer.from(String(note["data_b64"] ?? ""), "base64");
    }
  }

  async receive(timeout: number | null = null): Promise<string | Uint8Array> {
    const chunk = await this.next(timeout === null ? null : timeout * 1000);
    if (chunk === null) throw new SandboxError("terminal stream closed");
    return chunk;
  }

  async *outputStream(): AsyncGenerator<string | Uint8Array> {
    for (;;) {
      const chunk = await this.next(null);
      if (chunk === null) return;
      yield chunk;
    }
  }

  async close(): Promise<void> {
    const wasOpen = this.open;
    this.open = false;
    this.client.closeStream(this.ptyId);
    if (wasOpen) await this.client.call("pty.close", { sandbox_id: this.sandboxId, process_id: this.ptyId }).catch(() => undefined);
  }

  async __aenter__(): Promise<this> {
    return this;
  }

  async __aexit__(): Promise<void> {
    await this.close();
  }
}

/** `ProcessProtocol` over EPP; delegates to the native envd transport in hybrid mode. */
export class ExecProcessProtocol {
  private readonly pid: string;

  constructor(
    private readonly client: EppPeer,
    private readonly features: ReadonlySet<string>,
    private readonly native: ProcessProtocol | null,
  ) {
    this.pid = client.provider_id;
  }

  private nativeOr(): ProcessProtocol {
    if (this.native === null) throw new ProviderFeatureNotSupportedError(this.pid, "exec.stream");
    return this.native;
  }

  async start(envdUrl: string, envdToken: EnvdTokenManager, opts: ProcessStartOpts): Promise<StreamReader<ProcessChunk>> {
    if (!isEppUrl(envdUrl)) return this.nativeOr().start(envdUrl, envdToken, opts);
    const timeout = opts.timeout ?? 60;
    const params: Dict = {
      sandbox_id: sandboxIdFrom(envdUrl),
      cmd: opts.cmd,
      args: [...(opts.args ?? [])],
      env: { ...(opts.env ?? {}) },
      cwd: opts.cwd ?? "",
      user: opts.user ?? "",
      timeout,
    };
    if (this.features.has("exec.stream")) return new StreamReader(this.stream(params, timeout), frameToChunk);
    if (!this.features.has("exec.run")) throw new ProviderFeatureNotSupportedError(this.pid, "exec.run");
    return new StreamReader(this.buffered(params, timeout), frameToChunk);
  }

  private async *buffered(params: Dict, timeout: number): AsyncGenerator<Dict> {
    const res = asDict(await this.client.call("exec.run", params, { timeout: timeout + 5 }));
    if (res["stdout"]) yield { type: "stdout", data: res["stdout"] };
    if (res["stderr"]) yield { type: "stderr", data: res["stderr"] };
    yield { type: "exit", exit_code: Math.trunc(Number(res["exit_code"] ?? 0)) };
  }

  private async *stream(params: Dict, timeout: number): AsyncGenerator<Dict> {
    const res = asDict(await this.client.call("exec.start", params, { timeout: timeout + execTuning.exitGraceSeconds }));
    const processId = String(res["process_id"]);
    const queue: AsyncQueue<Notification | null> = this.client.openStream(processId);
    try {
      for (;;) {
        const note = await queue.getWithin((timeout + execTuning.exitGraceSeconds) * 1000);
        if (note === undefined) {
          throw new CommandTimeoutError(`Command did not finish within ${timeout}s (provider '${this.pid}' reported no exit).`, {
            suggestion: "Raise the command timeout or fix the plugin's timeout handling",
          });
        }
        if (note === null) {
          if (this.client.failure !== null) throw this.client.failure;
          return;
        }
        if (note["method"] === "exec.output") {
          yield { type: note["stream"] === "stderr" ? "stderr" : "stdout", data: String(note["data"] ?? "") };
        } else if (note["method"] === "exec.exit") {
          yield { type: "exit", exit_code: Math.trunc(Number(note["exit_code"] ?? 0)) };
          return;
        }
      }
    } finally {
      this.client.closeStream(processId);
    }
  }

  /** Open a plugin-hosted terminal (`pty` feature). */
  async openTerminal(envdUrl: string, opts: { cols?: number; rows?: number } = {}): Promise<ExecTerminal> {
    if (!this.features.has("pty")) throw new ProviderFeatureNotSupportedError(this.pid, "pty");
    const sandboxId = sandboxIdFrom(envdUrl);
    const res = asDict(await this.client.call("pty.open", { sandbox_id: sandboxId, cols: opts.cols ?? 80, rows: opts.rows ?? 24 }));
    const ptyId = String(res["process_id"]);
    return new ExecTerminal(this.client, sandboxId, ptyId, this.client.openStream(ptyId));
  }

  async listProcesses(envdUrl: string, envdToken: EnvdTokenManager): Promise<ProcessInfo[]> {
    if (!isEppUrl(envdUrl)) return this.nativeOr().listProcesses(envdUrl, envdToken);
    this.needManage();
    const res = asDict(await this.client.call("process.list", { sandbox_id: sandboxIdFrom(envdUrl) }));
    const items = Array.isArray(res["processes"]) ? (res["processes"] as unknown[]) : [];
    return items.map((p) => toProcessInfo(p));
  }

  async connectToProcess(envdUrl: string, envdToken: EnvdTokenManager, opts: { pid: number }): Promise<StreamReader<ProcessChunk>> {
    if (!isEppUrl(envdUrl)) return this.nativeOr().connectToProcess(envdUrl, envdToken, opts);
    throw new ProviderFeatureNotSupportedError(this.pid, "process.manage");
  }

  async update(envdUrl: string, envdToken: EnvdTokenManager, opts: { pid: number; [key: string]: unknown }): Promise<Record<string, unknown>> {
    if (!isEppUrl(envdUrl)) return this.nativeOr().update(envdUrl, envdToken, opts);
    throw new ProviderFeatureNotSupportedError(this.pid, "process.manage");
  }

  private needManage(): void {
    if (!this.features.has("process.manage")) throw new ProviderFeatureNotSupportedError(this.pid, "process.manage");
  }

  private async simple(method: string, envdUrl: string, params: Dict): Promise<void> {
    this.needManage();
    await this.client.call(method, { sandbox_id: sandboxIdFrom(envdUrl), ...params });
  }

  async sendInput(envdUrl: string, envdToken: EnvdTokenManager, opts: { pid: number | string; data: string }): Promise<void> {
    if (!isEppUrl(envdUrl)) return this.nativeOr().sendInput(envdUrl, envdToken, opts as { pid: number; data: string });
    await this.simple("process.stdin", envdUrl, { pid: opts.pid, data: opts.data });
  }

  async sendSignal(envdUrl: string, envdToken: EnvdTokenManager, opts: { pid: number | string; signal?: number }): Promise<void> {
    if (!isEppUrl(envdUrl)) return this.nativeOr().sendSignal(envdUrl, envdToken, opts as { pid: number; signal?: number });
    await this.simple("process.signal", envdUrl, { pid: opts.pid, signal: opts.signal ?? 15 });
  }

  async sendStdin(envdUrl: string, envdToken: EnvdTokenManager, opts: { pid: number | string; data: string }): Promise<void> {
    await this.sendInput(envdUrl, envdToken, opts);
  }

  async kill(envdUrl: string, envdToken: EnvdTokenManager, opts: { pid: number | string }): Promise<void> {
    if (!isEppUrl(envdUrl)) return this.nativeOr().kill(envdUrl, envdToken, opts as { pid: number });
    await this.simple("process.kill", envdUrl, { pid: opts.pid });
  }
}

function toProcessInfo(p: unknown): ProcessInfo {
  const d = asDict(p);
  const pid = d["pid"];
  // Digit-only strings are pids (`int | str` tries int first, as pydantic does). Other strings stay process ids.
  const numeric = typeof pid === "string" && /^\d+$/.test(pid) ? Number(pid) : pid;
  return ProcessInfo.modelValidate({ ...d, pid: numeric });
}

/** `FilesystemProtocol` over EPP; delegates in hybrid mode. */
export class ExecFilesystemProtocol {
  private readonly pid: string;

  constructor(
    private readonly client: EppPeer,
    private readonly features: ReadonlySet<string>,
    private readonly native: FilesystemProtocol | null,
  ) {
    this.pid = client.provider_id;
  }

  private nativeOr(): FilesystemProtocol {
    if (this.native === null) throw new ProviderFeatureNotSupportedError(this.pid, "files.rw");
    return this.native;
  }

  private async call(method: string, envdUrl: string, params: Dict): Promise<Dict> {
    if (!this.features.has("files.rw")) throw new ProviderFeatureNotSupportedError(this.pid, "files.rw");
    return asDict(await this.client.call(method, { sandbox_id: sandboxIdFrom(envdUrl), ...params }));
  }

  private static info(entry: Dict): FileInfo {
    const kind = entry["type"] === "dir" || entry["type"] === "directory" ? FileType.DIRECTORY : FileType.FILE;
    return FileInfo.modelValidate({
      name: String(entry["name"] ?? ""),
      path: String(entry["path"] ?? ""),
      type: kind,
      size: Math.trunc(Number(entry["size"] ?? 0) || 0),
      modified: parseTime(entry["mtime"]),
    });
  }

  async stat(envdUrl: string, token: EnvdTokenManager, opts: { path: string }): Promise<FileInfo> {
    if (!isEppUrl(envdUrl)) return this.nativeOr().stat(envdUrl, token, opts);
    return ExecFilesystemProtocol.info(await this.call("files.stat", envdUrl, { path: opts.path }));
  }

  async listDir(envdUrl: string, token: EnvdTokenManager, opts: { path?: string } = {}): Promise<FileInfo[]> {
    if (!isEppUrl(envdUrl)) return this.nativeOr().listDir(envdUrl, token, opts);
    const res = await this.call("files.list", envdUrl, { path: opts.path ?? "/" });
    const entries = Array.isArray(res["entries"]) ? (res["entries"] as unknown[]) : [];
    return entries.map((e) => ExecFilesystemProtocol.info(asDict(e)));
  }

  async makeDir(envdUrl: string, token: EnvdTokenManager, opts: { path: string }): Promise<void> {
    if (!isEppUrl(envdUrl)) return this.nativeOr().makeDir(envdUrl, token, opts);
    await this.call("files.mkdir", envdUrl, { path: opts.path });
  }

  async remove(envdUrl: string, token: EnvdTokenManager, opts: { path: string }): Promise<void> {
    if (!isEppUrl(envdUrl)) return this.nativeOr().remove(envdUrl, token, opts);
    await this.call("files.remove", envdUrl, { path: opts.path });
  }

  async move(envdUrl: string, token: EnvdTokenManager, opts: { source: string; destination: string }): Promise<void> {
    if (!isEppUrl(envdUrl)) return this.nativeOr().move(envdUrl, token, opts);
    await this.call("files.move", envdUrl, { source: opts.source, destination: opts.destination });
  }

  async watchDir(envdUrl: string, token: EnvdTokenManager, opts: { path: string }): ReturnType<FilesystemProtocol["watchDir"]> {
    if (!isEppUrl(envdUrl)) return this.nativeOr().watchDir(envdUrl, token, opts);
    throw new ProviderFeatureNotSupportedError(this.pid, "files.watch");
  }

  async uploadFile(envdUrl: string, token: EnvdTokenManager, opts: { path: string; content: Uint8Array; username?: string }): Promise<void> {
    if (!isEppUrl(envdUrl)) return this.nativeOr().uploadFile(envdUrl, token, opts);
    await this.call("files.write", envdUrl, { path: opts.path, content_b64: Buffer.from(opts.content).toString("base64") });
  }

  async downloadFile(envdUrl: string, token: EnvdTokenManager, opts: { path: string; username?: string }): Promise<Uint8Array> {
    if (!isEppUrl(envdUrl)) return this.nativeOr().downloadFile(envdUrl, token, opts);
    const res = await this.call("files.read", envdUrl, { path: opts.path });
    return Buffer.from(String(res["content_b64"] ?? ""), "base64");
  }

  async exists(envdUrl: string, token: EnvdTokenManager, opts: { path: string }): Promise<boolean> {
    try {
      await this.stat(envdUrl, token, opts);
      return true;
    } catch (exc) {
      if (exc instanceof SandboxError) return false;
      throw exc;
    }
  }

  async getInfo(envdUrl: string, token: EnvdTokenManager, opts: { path: string }): Promise<FileInfo> {
    return this.stat(envdUrl, token, opts);
  }

  async read(envdUrl: string, token: EnvdTokenManager, opts: { path: string }): Promise<Uint8Array> {
    return this.downloadFile(envdUrl, token, { path: opts.path });
  }

  async readText(envdUrl: string, token: EnvdTokenManager, opts: { path: string; encoding?: unknown }): Promise<string> {
    const raw = await this.read(envdUrl, token, { path: opts.path });
    return decodeBytes(raw, opts.encoding === undefined ? "utf-8" : opts.encoding);
  }

  async write(envdUrl: string, token: EnvdTokenManager, opts: { path: string; content: string | Uint8Array }): Promise<void> {
    const raw = typeof opts.content === "string" ? new TextEncoder().encode(opts.content) : opts.content;
    await this.uploadFile(envdUrl, token, { path: opts.path, content: raw });
  }

  async rename(envdUrl: string, token: EnvdTokenManager, opts: { old_path: string; new_path: string }): Promise<void> {
    await this.move(envdUrl, token, { source: opts.old_path, destination: opts.new_path });
  }
}

/** Platform auth placeholder: exec providers never call the Alibaba platform API. */
export class NoPlatformAuth {
  async getHeaders(): Promise<Record<string, string>> {
    return {};
  }
  async refresh(): Promise<void> {
    /* nothing to refresh */
  }
}

/** A provider backed by an installed (or linked) plugin process. */
export class ExecProvider extends Provider {
  override createSessionAuth(info: SessionInfo, infra?: SessionInfra) { return e2bSessionAuth(info, infra); }
  override async openTerminal(context: SessionTerminalContext, opts: { cols: number; rows: number; shell: string }) {
    this.require("pty");
    if (context.url.startsWith("epp://")) return super.openTerminal(context, opts);
    return e2bOpenTerminal(context, opts);
  }
  override kind = "exec" as const;
  readonly id: string;

  constructor(
    readonly manifest: Manifest,
    readonly pluginRoot: string,
    readonly receipt: Record<string, unknown> | null = null,
  ) {
    super();
    this.id = manifest.id;
    this.displayName = manifest.name;
    this.displayNameZh = manifest.name_zh;
    this.version = manifest.version;
    this.features = new Set(manifest.features);
    this.commands = manifest.commands;
    this.commandTimeoutMs = manifest.call_timeout_ms;
    this.configFields = manifest.fields;
    this.authAnyOf = manifest.auth_any_of;
    this.inherit = consentedInherit(manifest.inherit, receipt);
  }

  async buildInfra(config: LayeredConfig): Promise<ProviderInfra> {
    this.validateConfig(config);
    if (this.receipt !== null) store.verifyIntegrity(this.id);
    const argv = resolveCommand(this.manifest.command, this.pluginRoot);
    const dataDir = store.dataDir(this.id);
    const opts = config.provider_options;
    const initConfig: Dict = {};
    for (const f of this.configFields) {
      const v = opts[f.key];
      if (v !== undefined && v !== null) initConfig[f.key] = v;
    }
    const core: Dict = {};
    for (const key of this.inherit) {
      const val = (config as unknown as Dict)[key];
      if (val !== undefined && val !== null) core[key] = val;
    }
    core["http_timeout"] = config.http_timeout;
    core["max_retries"] = config.max_retries;
    const secretValues = [
      ...this.configFields.filter((f) => f.secret && initConfig[f.key]).map((f) => String(initConfig[f.key])),
      ...(core["sandbox_api_key"] !== undefined ? [String(core["sandbox_api_key"])] : []),
    ];
    const client = new EppClient(this.id, argv, {
      cwd: dataDir,
      env: scrubbedEnv(dataDir, this.manifest.security.env_passthrough),
      startupTimeout: this.manifest.startup_timeout_ms / 1000,
      callTimeout: this.manifest.call_timeout_ms / 1000,
      secrets: secretValues,
    });
    await client.start({
      protocol: PROTOCOL,
      host: { name: "abx", version: hostVersion() },
      provider_id: this.id,
      config: initConfig,
      core,
      locale: "en",
      data_dir: dataDir,
    });
    const advertised = client.features.size > 0 ? client.features : this.features;
    const supported = new Set([...this.features].filter((f) => advertised.has(f)));
    let httpClient: HttpClient | null = null;
    let auth: NoPlatformAuth | null = null;
    let nativeProcess: ProcessProtocol | null = null;
    let nativeFiles: FilesystemProtocol | null = null;
    if (["exec.run", "exec.stream", "files.rw", "process.manage"].some((f) => supported.has(f))) {
      auth = new NoPlatformAuth();
      httpClient = new HttpClient(config.toTransportConfig(), auth);
      nativeProcess = new ProcessProtocol(httpClient);
      nativeFiles = new FilesystemProtocol(httpClient);
    }
    const close = async (): Promise<void> => {
      await client.close();
      if (httpClient !== null) await httpClient.close();
    };
    return {
      config,
      auth,
      http_client: httpClient,
      provider_commands: {
        run: async (command, input) => {
          try { return await client.call("provider.commands.run", { command, input }); }
          catch (exc) {
            if (exc instanceof ProviderProtocolError && exc.rpc_code === -32601) throw new ProviderFeatureNotSupportedError(this.id, `command:${command}`);
            throw exc;
          }
        },
      },
      sandbox_protocol: new ExecSandboxProtocol(client, supported, new Set(this.configFields.filter((f) => f.secret).map((f) => f.key))) as never,
      process_protocol: new ExecProcessProtocol(client, supported, nativeProcess) as never,
      filesystem_protocol: new ExecFilesystemProtocol(client, supported, nativeFiles) as never,
      code_interpreter_protocol: unsupportedAdapter(this.id, "code.interpret") as never,
      close,
    };
  }
}
