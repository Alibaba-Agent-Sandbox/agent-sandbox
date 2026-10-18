import { qualify } from "../providers/registry.js";
/**
 * Agent Sandbox MCP Server。
 *
 * 将沙箱能力暴露为 MCP Tools，支持 Cursor / Claude Desktop / VS Code 等 IDE 集成。
 *
 * 传输方式：STDIO（本地 IDE 集成）。
 *
 * 实现：自包含的最小 JSON-RPC 2.0 over STDIO 处理器，无需外部 MCP SDK 依赖。
 *
 * MCP 协议版本协商：本模块默认支持 STDIO 传输版本 `2024-11-05`；
 * Streamable HTTP 传输（`mcp_http.ts`）通过 `supported_protocol_versions`
 * 构造参数声明 `2025-06-18`。`initialize` 回显受支持的请求版本；请求缺失或不支持时，
 * 回退到传输的首选（第一个）支持版本。
 *
 * Port of `agent_sandbox/agent/mcp.py`.
 */

import type { Readable, Writable } from "node:stream";

import { pyExcStr } from "../api/_pyerrors.js";
import { ExcInfo, getLogger } from "../utils/logging.js";
import {
  AsyncLock,
  CancelledError,
  ValueError,
  assertHashable,
  isDict,
  pyJsonDumps,
  pyJsonLoads,
  pyStr,
  pyStrip,
  pyTruthy,
  type JsonObject,
} from "./_py.js";
import { TOOL_SCHEMAS, TOOL_SCHEMA_MAP, dispatchTool } from "./tools.js";

const logger = getLogger("agent.mcp");

/**
 * MCP protocol version supported by the STDIO transport — the default for
 * SandboxMCPServer. Other transports (e.g. Streamable HTTP in mcp_http.ts)
 * declare their own version via the `supported_protocol_versions` argument.
 */
export const MCP_PROTOCOL_VERSION = "2024-11-05";

/**
 * A single tools/call (for example write_file of a source file) is one JSON
 * line. Lines longer than this are rejected without killing the process.
 */
export const _STDIO_READ_LIMIT = 8 * 1024 * 1024;

export const SERVER_NAME = "agent-sandbox";
export const SERVER_VERSION = "0.3.0";

// ---------------------------------------------------------------------------
// Sandbox SDK access (lazy, like the Python function-level imports)
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
type SandboxInstance = any;

interface SandboxStatic {
  create(options: Record<string, unknown>): Promise<SandboxInstance>;
  list(options?: Record<string, unknown>): Promise<any[]>;
  getInfoById(id: string, options?: Record<string, unknown>): Promise<any>;
  connect(options: Record<string, unknown>): Promise<SandboxInstance>;
  killById(sandboxId: string, options?: Record<string, unknown>): Promise<void>;
}

/** Seam for the lazy SDK import (Python imports `agent_sandbox.api.sandbox` inside each method). */
let loadedSandbox: SandboxStatic | null = null;

export const sdk = {
  async loadSandbox(): Promise<SandboxStatic> {
    // Once imported, answer from the cache: a repeated `import()` is a round trip through the module loader (a macrotask
    // under loader hooks), and the STDIO loop relies on cached lookups costing microtasks only.
    if (loadedSandbox !== null) return loadedSandbox;
    const mod = await import("../api/sandbox.js");
    loadedSandbox = mod.Sandbox as unknown as SandboxStatic;
    return loadedSandbox;
  },
};

export interface CreateSandboxOptions {
  template?: string | null;
  timeout?: number;
  envs?: Record<string, string> | null;
  cpu?: number;
  memory?: number;
  region?: string;
  retain?: boolean;
}

export interface SandboxManagerOptions {
  api_key?: string | null;
  api_url?: string | null;
  domain?: string | null;
  template?: string;
}

// ---------------------------------------------------------------------------
// Sandbox Manager — manages sandbox lifecycle for MCP sessions
// ---------------------------------------------------------------------------

/**
 * Manage sandbox instances for an MCP session.
 *
 * The default sandbox is the one omitted `sandbox_id` arguments use:
 *
 * - The first such call lazily creates it with this manager's template.
 * - `create_sandbox` makes the new sandbox the default, so the usual
 *   agent sequence (create, then write / run / kill without an id) stays
 *   on that sandbox. Earlier sandboxes stay alive until killed or the
 *   session ends.
 * - An explicit `sandbox_id` addresses that sandbox and does not change
 *   the default.
 * - Concurrent callers share one lazy create.
 */
export class SandboxManager {
  _api_key: string | null;
  _api_url: string | null;
  _domain: string | null;
  _default_template: string;
  _default_sandbox: SandboxInstance = null;
  _sandboxes: Map<string, SandboxInstance> = new Map();
  _lifetimes: Map<string, number> = new Map();
  private readonly preserved = new Set<string>();
  private readonly borrowed = new Set<string>();
  _state_lock = new AsyncLock();
  _default_lock = new AsyncLock();
  /** Bumped by `shutdown()` so a create still in flight can clean up after itself. */
  private _epoch = 0;

  constructor(options: SandboxManagerOptions = {}) {
    this._api_key = options.api_key ?? null;
    this._api_url = options.api_url ?? null;
    this._domain = options.domain ?? null;
    this._default_template = options.template ?? "base";
  }

  /** Build SDK kwargs shared by create, connect, and kill. */
  _connectKwargs(extra: Record<string, unknown> = {}): Record<string, unknown> {
    const kwargs: Record<string, unknown> = { ...extra };
    if (this._api_key) kwargs.api_key = this._api_key;
    if (this._api_url) kwargs.api_url = this._api_url;
    if (this._domain) kwargs.domain = this._domain;
    return kwargs;
  }

  /** Provider-qualified identity prevents collisions across backends. */
  reference(sandbox: SandboxInstance): string {
    return sandbox.provider ? qualify(sandbox.provider, sandbox.id) : sandbox.id;
  }

  /** Explicit retention only; observation never refreshes TTL. */
  retainSandbox(id: string, retain = true): void {
    if (!retain && this.borrowed.has(id)) throw new Error("Connected sandbox is borrowed; retention cannot transfer cleanup ownership. Use kill_sandbox explicitly to delete it.");
    if (retain) this.preserved.add(id);
    else this.preserved.delete(id);
  }

  /** Query without adopting or extending the resource. */
  async observeSandbox(id: string): Promise<Record<string, unknown>> {
    return (await sdk.loadSandbox()).getInfoById(id, this._connectKwargs());
  }

  /** List without adopting any returned resource. */
  async listSandboxes(options: Record<string, unknown> = {}): Promise<Record<string, unknown>[]> {
    return (await sdk.loadSandbox()).list(this._connectKwargs(options));
  }

  /** Kept as an internal compatibility seam; lifetime changes must now be explicit. */
  async _refreshLifetime(_sandbox: SandboxInstance): Promise<void> {}

  /** Create a sandbox and make it the session default. */
  async createSandbox(options: CreateSandboxOptions = {}): Promise<SandboxInstance> {
    const { template = null, timeout = 300, envs = null } = options;
    const Sandbox = await sdk.loadSandbox();
    const epoch = this._epoch;

    const kwargs = this._connectKwargs({
      template: template || this._default_template,
      timeout,
      envs: envs || {},
    });
    if (options.cpu !== undefined) kwargs.cpu = options.cpu;
    if (options.memory !== undefined) kwargs.memory = options.memory;
    if (options.region !== undefined) kwargs.provider_options = { region: options.region };
    const sandbox = await Sandbox.create(kwargs);
    if (epoch !== this._epoch) {
      // The session was shut down while this create was in flight. Python
      // cancels the pending call; here the sandbox exists already, so remove it.
      try {
        await sandbox.kill();
      } catch (exc) {
        logger.warning("Failed to kill sandbox %s created during shutdown", sandbox.id, new ExcInfo(exc));
      }
      throw new CancelledError();
    }
    await this._state_lock.runExclusive(() => {
      this._sandboxes.set(this.reference(sandbox), sandbox);
      this._lifetimes.set(this.reference(sandbox), timeout);
      if (options.retain) this.preserved.add(this.reference(sandbox));
      this._default_sandbox = sandbox;
    });
    logger.info("Created sandbox: %s", sandbox.id);
    return sandbox;
  }

  /** Get a sandbox by ID, or create/return the default sandbox. */
  async getSandbox(sandboxId: string | null = null): Promise<SandboxInstance> {
    if (sandboxId) {
      const cached = await this._state_lock.runExclusive(() => this._sandboxes.get(sandboxId));
      if (cached !== undefined && cached !== null) {
        await this._refreshLifetime(cached);
        return cached;
      }
      const Sandbox = await sdk.loadSandbox();
      const epoch = this._epoch;
      const sb = await Sandbox.connect(this._connectKwargs({ sandbox_id: sandboxId }));
      if (epoch !== this._epoch) throw new CancelledError();
      await this._state_lock.runExclusive(() => {
        this._sandboxes.set(sandboxId, sb);
        this.borrowed.add(sandboxId);
        this.preserved.add(sandboxId);
        if (!this._lifetimes.has(sb.id)) this._lifetimes.set(sb.id, 300);
      });
      await this._refreshLifetime(sb);
      return sb;
    }

    // One lazy create even when two tool calls arrive together.
    const sandbox = await this._default_lock.runExclusive(async () => {
      if (this._default_sandbox === null || this._default_sandbox === undefined) {
        const created = await this.createSandbox();
        if (this._default_sandbox === null || this._default_sandbox === undefined) {
          this._default_sandbox = created;
        }
        logger.info("Auto-created default sandbox: %s", this._default_sandbox.id);
      }
      return this._default_sandbox;
    });
    await this._refreshLifetime(sandbox);
    return sandbox;
  }

  /**
   * Kill a sandbox by ID, or the default sandbox.
   *
   * @returns The killed sandbox id, or `null` when there was no default
   * sandbox to kill.
   */
  async killSandbox(sandboxId: string | null = null): Promise<string | null> {
    const sb = await this._state_lock.runExclusive(() => sandboxId
      ? this._sandboxes.get(sandboxId)
      : this._default_sandbox);
    if (sb === null || sb === undefined) {
      if (!sandboxId) return null;
      await (await sdk.loadSandbox()).killById(sandboxId, this._connectKwargs());
      return sandboxId;
    }
    const id = sandboxId ?? this.reference(sb);
    // Keep the handle/default until deletion succeeds, so failures remain retryable.
    await sb.kill();
    await this._state_lock.runExclusive(() => {
      if (this._sandboxes.get(id) === sb) {
        this._sandboxes.delete(id);
        this._lifetimes.delete(id);
        this.preserved.delete(id);
        this.borrowed.delete(id);
      }
      if (this._default_sandbox === sb) this._default_sandbox = null;
    });
    logger.info("Killed sandbox: %s", id);
    return id;
  }

  /** Kill all sandboxes. */
  async shutdown(): Promise<void> {
    const items = await this._state_lock.runExclusive(() => {
      const snapshot = [...this._sandboxes.entries()].map(([sid, sb]) => ({ sid, sb, preserve: this.borrowed.has(sid) || this.preserved.has(sid) }));
      this._sandboxes.clear();
      this.borrowed.clear();
      this.preserved.clear();
      this._lifetimes.clear();
      this._default_sandbox = null;
      this._epoch += 1;
      return snapshot;
    });
    for (const { sid, sb, preserve } of items) {
      try {
        if (preserve) await sb.close?.();
        else await sb.kill();
        logger.info("Shutdown: released sandbox %s", sid);
      } catch (exc) {
        logger.warning("Failed to kill sandbox %s during shutdown", sid, new ExcInfo(exc));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 helpers
// ---------------------------------------------------------------------------

/** Build a JSON-RPC 2.0 success response. */
export function _jsonrpcResponse(id: unknown, result: unknown): JsonObject {
  return { jsonrpc: "2.0", id, result };
}

/** Build a JSON-RPC 2.0 error response. */
export function _jsonrpcError(
  id: unknown,
  code: number,
  message: string,
  data: unknown = null,
): JsonObject {
  const err: JsonObject = { code, message };
  if (data !== null && data !== undefined) err.data = data;
  return { jsonrpc: "2.0", id, error: err };
}

// JSON-RPC standard error codes
export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

// ---------------------------------------------------------------------------
// STDIO framing
// ---------------------------------------------------------------------------

export type StdioFrame = { kind: "line"; data: Buffer } | { kind: "overlong" };

/**
 * Newline framing with the same overlong-line policy as the Python server:
 * a line above `limit` bytes is dropped through its newline and reported as
 * one `overlong` frame, and later messages keep flowing.
 */
export class StdioLineSplitter {
  private buf: Buffer = Buffer.alloc(0);
  private discarding = false;

  constructor(private readonly limit: number = _STDIO_READ_LIMIT) {}

  push(chunk: Buffer): StdioFrame[] {
    const frames: StdioFrame[] = [];
    let data = chunk;
    if (this.discarding) {
      const nl = data.indexOf(0x0a);
      if (nl === -1) return frames;
      this.discarding = false;
      frames.push({ kind: "overlong" });
      data = data.subarray(nl + 1);
    }
    this.buf = this.buf.length === 0 ? Buffer.from(data) : Buffer.concat([this.buf, data]);
    for (;;) {
      const nl = this.buf.indexOf(0x0a);
      if (nl === -1) {
        if (this.buf.length > this.limit) {
          this.buf = Buffer.alloc(0);
          this.discarding = true;
        }
        return frames;
      }
      const line = this.buf.subarray(0, nl);
      this.buf = this.buf.subarray(nl + 1);
      frames.push(nl > this.limit ? { kind: "overlong" } : { kind: "line", data: Buffer.from(line) });
    }
  }

  end(): StdioFrame[] {
    const frames: StdioFrame[] = [];
    if (this.discarding) {
      this.discarding = false;
      frames.push({ kind: "overlong" });
    } else if (this.buf.length > 0) {
      frames.push({ kind: "line", data: this.buf });
    }
    this.buf = Buffer.alloc(0);
    return frames;
  }
}

export interface RunOptions {
  stdin?: Readable;
  stdout?: Writable;
  /** Install SIGINT/SIGTERM handlers that stop the loop and run shutdown. Default true. */
  handleSignals?: boolean;
}

// ---------------------------------------------------------------------------
// SandboxMCPServer
// ---------------------------------------------------------------------------

export interface SandboxMCPServerOptions extends SandboxManagerOptions {
  supported_protocol_versions?: readonly string[] | null;
}

/**
 * 沙箱 MCP Server — 自包含 JSON-RPC 2.0 over STDIO 实现。
 *
 * 支持 MCP 协议的 initialize / tools/list / tools/call 方法。
 *
 * 协议版本按 transport 协商：默认支持 STDIO 的 `2024-11-05`；
 * 其他 transport 通过 `supported_protocol_versions` 声明自己的版本集，
 * 首个条目为缺失/不支持请求时的回退版本。
 */
export class SandboxMCPServer {
  _manager: SandboxManager;
  _initialized = false;
  _supported_protocol_versions: readonly string[];
  private _stopRequested: (() => void) | null = null;

  constructor(options: SandboxMCPServerOptions = {}) {
    this._manager = new SandboxManager({
      api_key: options.api_key,
      api_url: options.api_url,
      domain: options.domain,
      template: options.template,
    });
    const versions =
      options.supported_protocol_versions === undefined || options.supported_protocol_versions === null
        ? ([MCP_PROTOCOL_VERSION] as const)
        : [...options.supported_protocol_versions];
    if (versions.length === 0) {
      throw new ValueError("supported_protocol_versions must contain at least one version");
    }
    this._supported_protocol_versions = versions;
  }

  /** Expose sandbox manager for testing. */
  get manager(): SandboxManager {
    return this._manager;
  }

  /** Whether the server has received an initialize request. */
  get initialized(): boolean {
    return this._initialized;
  }

  // ---- MCP method handlers ----

  /**
   * Handle MCP initialize request with per-transport version negotiation.
   *
   * Echoes the client-requested `protocolVersion` when this transport
   * supports it. Otherwise — the request is missing `protocolVersion`
   * or asks for an unsupported version — respond with the preferred
   * (first) supported version, per the MCP version negotiation rule that
   * the server replies with another protocol version it supports (the
   * client may then disconnect if it cannot accept it).
   */
  async _handleInitialize(params: JsonObject): Promise<JsonObject> {
    this._initialized = true;
    const requested = params.protocolVersion;
    let negotiated: string;
    if (typeof requested === "string" && this._supported_protocol_versions.includes(requested)) {
      negotiated = requested;
    } else {
      negotiated = this._supported_protocol_versions[0] as string;
      logger.debug(
        "MCP initialize: requested protocolVersion %r is missing or unsupported; " +
          "negotiating to preferred version %s",
        requested === undefined ? "None" : pyStr(requested),
        negotiated,
      );
    }
    return {
      protocolVersion: negotiated,
      capabilities: {
        tools: { listChanged: false },
      },
      serverInfo: {
        name: SERVER_NAME,
        version: SERVER_VERSION,
      },
    };
  }

  /** Handle MCP initialized notification (no response needed). */
  async _handleInitialized(_params: JsonObject): Promise<null> {
    logger.info("MCP client confirmed initialization");
    return null;
  }

  /** Handle tools/list request — return all available tools. */
  async _handleToolsList(_params: JsonObject): Promise<JsonObject> {
    return { tools: TOOL_SCHEMAS };
  }

  /** Handle tools/call request — dispatch to tool handler. */
  async _handleToolsCall(params: JsonObject): Promise<JsonObject> {
    const toolName = Object.hasOwn(params, "name") ? params.name : "";
    const rawArguments = Object.hasOwn(params, "arguments") ? params.arguments : null;
    const toolArguments = pyTruthy(rawArguments) ? rawArguments : {};
    if (!isDict(toolArguments)) {
      return {
        content: [
          {
            type: "text",
            text: pyJsonDumps({ error: "Tool arguments must be an object" }),
          },
        ],
        isError: true,
      };
    }

    assertHashable(toolName);
    if (typeof toolName !== "string" || !Object.hasOwn(TOOL_SCHEMA_MAP, toolName)) {
      return {
        content: [
          {
            type: "text",
            text: pyJsonDumps({ error: `Unknown tool: ${pyStr(toolName)}` }),
          },
        ],
        isError: true,
      };
    }

    const result = await dispatchTool(toolName, toolArguments, this._manager);

    const exitCode = result.exit_code;
    const isError =
      "error" in result ||
      result.verified === false || result.cleanup_verified === false ||
      // A successful status query/cancel can report a nonzero task exit. The query itself succeeded.
      ((toolName === "run_code" || toolName === "run_command") &&
        typeof exitCode === "number" && Number.isInteger(exitCode) && exitCode !== 0);
    return {
      content: [
        {
          type: "text",
          text: pyJsonDumps(result, { ensureAscii: false, defaultStr: true }),
        },
      ],
      isError,
    };
  }

  /** Handle ping request. */
  async _handlePing(_params: JsonObject): Promise<JsonObject> {
    return {};
  }

  // ---- Method dispatch ----

  static readonly _METHOD_MAP: Readonly<Record<string, string>> = {
    initialize: "_handleInitialize",
    "notifications/initialized": "_handleInitialized",
    "tools/list": "_handleToolsList",
    "tools/call": "_handleToolsCall",
    ping: "_handlePing",
  };

  /**
   * Process one JSON-RPC object and return its response.
   *
   * Non-object JSON values and JSON-RPC batches are rejected because this
   * minimal server intentionally supports one request object per message.
   */
  async handleRequest(request: unknown): Promise<JsonObject | null> {
    if (!isDict(request)) {
      return _jsonrpcError(null, INVALID_REQUEST, "Request must be a JSON object");
    }

    const method = Object.hasOwn(request, "method") ? request.method : "";
    let params: unknown = Object.hasOwn(request, "params") ? request.params : {};
    const reqId = Object.hasOwn(request, "id") ? (request.id ?? null) : null; // null for notifications
    if (params === null) params = {};
    if (!isDict(params)) {
      if (reqId !== null) {
        return _jsonrpcError(reqId, INVALID_PARAMS, "params must be a JSON object");
      }
      return null;
    }

    assertHashable(method);
    const handlerName =
      typeof method === "string" && Object.hasOwn(SandboxMCPServer._METHOD_MAP, method)
        ? SandboxMCPServer._METHOD_MAP[method]
        : undefined;
    if (handlerName === undefined) {
      if (reqId !== null) {
        return _jsonrpcError(reqId, METHOD_NOT_FOUND, `Method not found: ${pyStr(method)}`);
      }
      return null; // Unknown notification — silently ignore
    }

    const handler = (this as unknown as Record<string, (p: JsonObject) => Promise<unknown>>)[
      handlerName
    ] as (p: JsonObject) => Promise<unknown>;
    let result: unknown;
    try {
      result = await handler.call(this, params);
    } catch (exc) {
      if (exc instanceof CancelledError) throw exc;
      const text = pyExcStr(exc);
      logger.error("Error handling %s: %s", pyStr(method), text, new ExcInfo(exc));
      if (reqId !== null) {
        return _jsonrpcError(reqId, INTERNAL_ERROR, text);
      }
      return null;
    }

    // Notifications don't get responses
    if (reqId === null) return null;
    return _jsonrpcResponse(reqId, result);
  }

  // ---- STDIO transport ----

  /**
   * Run MCP Server over STDIO transport.
   *
   * Reads newline-delimited JSON-RPC from stdin and writes responses to
   * stdout. `ping` and other methods are answered while a `tools/call`
   * is still running; tool calls themselves stay serialized so two tools
   * do not share one sandbox at the same time. A line over the read limit
   * is rejected and the process keeps serving the next message.
   *
   * SIGINT and SIGTERM (`abx mcp stop`) stop the read loop; in-flight tool
   * calls are abandoned without a response and the session's sandboxes are
   * killed before this promise resolves.
   */
  async run(options: RunOptions = {}): Promise<void> {
    const input: Readable = options.stdin ?? process.stdin;
    const output: Writable = options.stdout ?? process.stdout;
    const handleSignals = options.handleSignals ?? true;
    logger.info("Starting MCP Server (STDIO mode)");
    // Protocol discovery and ping must work before the cloud SDK is needed.

    let stopped = false;
    let resolveStop!: () => void;
    const stopSignal = new Promise<"stop">((resolve) => {
      resolveStop = () => resolve("stop");
    });
    const requestStop = (): void => {
      if (stopped) {
        // A second signal while shutting down aborts the cleanup (asyncio: the
        // cancelled shutdown propagates CancelledError, exit status 1).
        if (handleSignals) process.exit(1);
        return;
      }
      stopped = true;
      resolveStop();
    };
    this._stopRequested = requestStop;

    const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
    if (handleSignals) for (const sig of signals) process.on(sig, requestStop);

    const swallowStreamError = (): void => {};
    output.on("error", swallowStreamError);

    const write = (payload: JsonObject): Promise<void> => {
      const encoded = `${pyJsonDumps(payload, { ensureAscii: false })}\n`;
      return new Promise<void>((resolve) => {
        if (output.destroyed || output.writableEnded) {
          resolve();
          return;
        }
        try {
          output.write(encoded, "utf8", () => resolve());
        } catch {
          resolve();
        }
      });
    };

    const writeNow = (payload: JsonObject): void => {
      void write(payload);
    };

    const toolLock = new AsyncLock();
    const pending = new Set<Promise<void>>();

    interface TaskToken {
      method: unknown;
      inLock: boolean;
      done: boolean;
    }

    const serve = async (request: unknown, token: TaskToken): Promise<void> => {
      const method = token.method;
      let response: JsonObject | null;
      try {
        if (method === "tools/call") {
          response = await toolLock.runExclusive(() => {
            token.inLock = true;
            return this.handleRequest(request);
          });
        } else {
          response = await this.handleRequest(request);
        }
      } catch (exc) {
        if (exc instanceof CancelledError) return;
        const reqId = isDict(request) ? (request.id ?? null) : null;
        const text = pyExcStr(exc);
        logger.error("STDIO dispatch failed: %s", text, new ExcInfo(exc));
        response = _jsonrpcError(reqId, INTERNAL_ERROR, text);
      }
      if (response !== null && !stopped) {
        await write(response);
      }
    };

    /**
     * Parse one frame the way the asyncio reader loop does: protocol errors are written right away (no suspension point),
     * a valid request is only returned; its task starts after the whole buffered batch has been scanned.
     */
    const scanFrame = (frame: StdioFrame): { request: unknown } | null => {
      if (frame.kind === "overlong") {
        writeNow(_jsonrpcError(null, INVALID_REQUEST, "Message exceeds the STDIO size limit"));
        return null;
      }
      let lineStr: string;
      try {
        lineStr = pyStrip(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(frame.data));
      } catch {
        writeNow(_jsonrpcError(null, PARSE_ERROR, "Parse error: invalid UTF-8 in message"));
        return null;
      }
      if (!lineStr) return null;

      try {
        return { request: pyJsonLoads(lineStr, { floats: "py" }) };
      } catch (exc) {
        const text = pyExcStr(exc);
        writeNow(_jsonrpcError(null, PARSE_ERROR, `Parse error: ${text}`));
        return null;
      }
    };

    // Python tasks run in creation order and a request that never has to wait for I/O completes inside its first step.
    // Microtask hops stand in for that: each task gets them all before the next task starts.
    const settleMicrotasks = async (): Promise<void> => {
      for (let i = 0; i < 256; i += 1) await null;
    };

    // Resources that mean "suspended on real I/O" (what asyncio would cancel at EOF). Local file reads are blocking calls
    // in Python, so they are not suspension points; module-loader ports and immediates are Node-internal plumbing.
    const PLUMBING = new Set(["MessagePort", "Immediate", "TickObject", "FSReqCallback", "FSReqPromise"]);
    const ioSnapshot = (): Map<string, number> => {
      const counts = new Map<string, number>();
      for (const type of process.getActiveResourcesInfo()) {
        if (!PLUMBING.has(type)) counts.set(type, (counts.get(type) ?? 0) + 1);
      }
      return counts;
    };
    let lastBatch: TaskToken[] = [];
    let ioBaseline = ioSnapshot();

    const startTasks = async (requests: unknown[]): Promise<void> => {
      lastBatch = [];
      ioBaseline = ioSnapshot();
      for (const request of requests) {
        if (stopped) return;
        const token: TaskToken = { method: isDict(request) ? request.method : undefined, inLock: false, done: false };
        lastBatch.push(token);
        const task = serve(request, token);
        pending.add(task);
        void task.finally(() => {
          token.done = true;
          pending.delete(task);
        });
        await settleMicrotasks();
      }
    };

    /**
     * EOF reaches asyncio while the tasks of the last batch are inside their first step: those that never wait for I/O
     * finish (and answer) before the loop sees the EOF, those suspended on I/O are cancelled. The Node tasks need an
     * unknown number of microtask/macrotask hops for the same work, so wait until each task is done or provably blocked
     * (a new socket/timer/process resource, or a `tools/call` queued behind a running one).
     */
    const settleLastBatch = async (): Promise<void> => {
      const deadline = Date.now() + 2000;
      for (;;) {
        const live = lastBatch.filter((token) => !token.done);
        if (live.length === 0 || stopped || Date.now() > deadline) return;
        if (live.every((token) => token.method === "tools/call" && !token.inLock && toolLock.locked)) return;
        const now = ioSnapshot();
        for (const [type, count] of now) if (count > (ioBaseline.get(type) ?? 0)) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    };

    const splitter = new StdioLineSplitter();
    const iterator = input[Symbol.asyncIterator]() as AsyncIterator<Buffer | string>;
    try {
      read: for (;;) {
        const next = await Promise.race([iterator.next(), stopSignal]);
        if (next === "stop") break;
        let frames: StdioFrame[];
        if (next.done) {
          frames = splitter.end();
        } else {
          const chunk = typeof next.value === "string" ? Buffer.from(next.value) : next.value;
          frames = splitter.push(chunk);
        }
        const requests: unknown[] = [];
        for (const frame of frames) {
          if (stopped) break read;
          const scanned = scanFrame(frame);
          if (scanned) requests.push(scanned.request);
        }
        if (next.done) {
          // asyncio cancels the tasks of the line that EOF completed before they take their first step: a final
          // message without a trailing newline is never answered (parse errors for it still are).
          await settleLastBatch();
          break;
        }
        await startTasks(requests);
      }
    } finally {
      stopped = true;
      this._stopRequested = null;
      pending.clear();
      try {
        input.pause();
      } catch {
        // already closed
      }
      try {
        await this.shutdown();
      } finally {
        if (handleSignals) for (const sig of signals) process.off(sig, requestStop);
        output.off("error", swallowStreamError);
      }
    }
  }

  /** Ask a running `run()` loop to stop (what SIGTERM does). */
  requestStop(): void {
    this._stopRequested?.();
  }

  /** Shutdown the server and clean up sandboxes. */
  async shutdown(): Promise<void> {
    logger.info("Shutting down MCP Server");
    await this._manager.shutdown();
  }
}
