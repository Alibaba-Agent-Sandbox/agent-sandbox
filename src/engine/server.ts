/**
 * The engine: one long-lived local process that hosts the provider layer for every SDK and the CLI.
 *
 * It listens on 127.0.0.1 only, answers HTTP/JSON (SSE for streams, WebSocket for the PTY) and requires the bearer
 * token that `discovery.ts` publishes. Each request carries the connection (provider, options, credentials) the client
 * resolved, so the engine never has to guess which account a call belongs to. Sandboxes are kept connected between
 * calls and keyed by sandbox id and connection.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import * as http from "node:http";
import type { Duplex } from "node:stream";

import { WebSocketServer, type WebSocket } from "ws";

import { Sandbox } from "../api/sandbox.js";
import { SandboxError, SandboxNotFoundError, SandboxCreationError, TemplateNotFoundError, QuotaExceededError, AuthenticationError, CapabilityNotSupportedError } from "../models/errors.js";
import { ValueError } from "../models/value_error.js";
import { ProviderNotFoundError, ProviderConfigError } from "../providers/errors.js";
import * as registry from "../providers/registry.js";
import { hostVersion } from "../providers/host.js";
import { ENGINE_PROTOCOL, acquireLock, removeRecord, writeRecord, type EngineRecord } from "./discovery.js";

type Dict = Record<string, unknown>;

/** What a client resolved for one call. Every key is optional; absent keys fall back to the engine's own layers. */
export interface Connection {
  provider?: string | null;
  provider_options?: Dict | null;
  api_key?: string | null;
  api_url?: string | null;
  domain?: string | null;
  access_key_id?: string | null;
  access_key_secret?: string | null;
}

export interface EngineOptions {
  /** 0 picks a free port. */
  port?: number;
  /** Seconds without a request or a stream before the engine exits; 0 never exits. */
  idle_timeout?: number;
  /** Seconds an unused sandbox session stays connected. */
  session_ttl?: number;
}

export interface EngineHandle {
  record: EngineRecord;
  /** Resolves once the engine has shut down. */
  closed: Promise<void>;
  close(): Promise<void>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly type = "EngineError",
    readonly code = "E0000",
  ) {
    super(message);
  }
}

const MAX_BODY = 512 * 1024 * 1024;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function statusFor(exc: unknown): number {
  if (exc instanceof HttpError) return exc.status;
  if (exc instanceof SandboxNotFoundError) return 404;
  if (exc instanceof ProviderNotFoundError) return 404;
  if (exc instanceof AuthenticationError) return 401;
  if (exc instanceof CapabilityNotSupportedError) return 501;
  if (exc instanceof ProviderConfigError || exc instanceof ValueError) return 400;
  if (exc instanceof TemplateNotFoundError) return 404;
  if (exc instanceof QuotaExceededError) return 429;
  if (exc instanceof SandboxCreationError) return 400;
  const name = exc instanceof Error ? exc.name : "";
  if (name === "FileNotFoundError_") return 404;
  return 500;
}

function errorBody(exc: unknown): Dict {
  if (exc instanceof HttpError) return { error: { type: exc.type, code: exc.code, message: exc.message, suggestion: "" } };
  if (exc instanceof SandboxError) {
    return { error: { type: exc.name, code: exc.code, message: exc.message, suggestion: exc.suggestion, docs_url: exc.docs_url } };
  }
  const message = exc instanceof Error ? exc.message : String(exc);
  return { error: { type: exc instanceof Error ? exc.name : "Error", code: "E0000", message, suggestion: "" } };
}

const dump = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(dump);
  if (value !== null && typeof value === "object" && typeof (value as { modelDump?: unknown }).modelDump === "function") {
    return (value as { modelDump(o: Dict): unknown }).modelDump({ mode: "json" });
  }
  return value;
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Dict).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function fingerprint(connection: Connection): string {
  return createHash("sha256").update(stable(connection)).digest("hex").slice(0, 16);
}

interface Session {
  sandbox: Sandbox;
  key: string;
  last_used: number;
}

interface Ctx {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  params: string[];
  query: URLSearchParams;
  connection: Connection;
  json(): Promise<Dict>;
  raw(): Promise<Buffer>;
  sandbox(): Promise<Sandbox>;
  /** The sandbox id of this route. */
  id: string;
}

type Handler = (ctx: Ctx) => Promise<unknown>;

interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
}

class Engine {
  readonly sessions = new Map<string, Session>();
  private readonly pending = new Map<string, Promise<Sandbox>>();
  private inflight = 0;
  private lastActivity = Date.now();
  private readonly routes: Route[] = [];
  private server: http.Server | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private stopping = false;
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
  private resolveClosed: () => void = () => undefined;
  readonly closed = new Promise<void>((r) => {
    this.resolveClosed = r;
  });

  constructor(
    private readonly token: string,
    private readonly opts: Required<EngineOptions>,
    private readonly releaseLock: () => void,
  ) {
    this.defineRoutes();
  }

  private route(method: string, pattern: string, handler: Handler): void {
    const source = pattern.replace(/:[a-z_]+/g, "([^/]+)");
    this.routes.push({ method, pattern: new RegExp(`^${source}$`), handler });
  }

  private key(id: string, connection: Connection): string {
    return `${fingerprint(connection)}/${id}`;
  }

  /** The connected sandbox for `id`, reusing the session unless the connection differs. */
  async session(id: string, connection: Connection): Promise<Sandbox> {
    const key = this.key(id, connection);
    const have = this.sessions.get(key);
    if (have !== undefined) {
      have.last_used = Date.now();
      return have.sandbox;
    }
    const inflight = this.pending.get(key);
    if (inflight !== undefined) return inflight;
    const task = (async () => {
      const sandbox = await Sandbox.connect(id, { ...connection } as never);
      this.sessions.set(key, { sandbox, key, last_used: Date.now() });
      return sandbox;
    })();
    this.pending.set(key, task);
    try {
      return await task;
    } finally {
      this.pending.delete(key);
    }
  }

  private register(sandbox: Sandbox, connection: Connection): void {
    const key = this.key(sandbox.id, connection);
    const old = this.sessions.get(key);
    this.sessions.set(key, { sandbox, key, last_used: Date.now() });
    if (old !== undefined && old.sandbox !== sandbox) void old.sandbox.close().catch(() => undefined);
  }

  private async drop(id: string, connection: Connection): Promise<void> {
    const key = this.key(id, connection);
    const have = this.sessions.get(key);
    this.sessions.delete(key);
    if (have !== undefined) await have.sandbox.close().catch(() => undefined);
  }

  private defineRoutes(): void {
    const r = this.route.bind(this);

    r("GET", "/v1/health", async () => ({
      protocol: ENGINE_PROTOCOL,
      version: hostVersion(),
      pid: process.pid,
      uptime_s: Math.round(process.uptime()),
      sessions: this.sessions.size,
    }));
    r("POST", "/v1/shutdown", async (c) => {
      setImmediate(() => void this.close());
      void c;
      return { ok: true };
    });
    r("GET", "/v1/providers", async () => ({
      providers: registry.listProviders().map((p) => ({ id: p.id, name: p.name, version: p.version, kind: p.kind, trust: p.trust, features: p.features, error: p.error ?? null })),
    }));

    r("POST", "/v1/sandboxes", async (c) => {
      const body = await c.json();
      const connection = this.connectionOf(c, body);
      const create: Dict = {
        template: body["template"],
        timeout: body["timeout"],
        request_timeout: body["request_timeout"],
        metadata: body["metadata"],
        envs: body["envs"],
        cpu: body["cpu"],
        memory: body["memory"],
        disk: body["disk"],
        gpu: body["gpu"],
        description: body["description"],
        secure: body["secure"],
        ...connection,
      };
      for (const k of Object.keys(create)) if (create[k] === undefined) delete create[k];
      const sandbox = await Sandbox.create(create as never);
      this.register(sandbox, connection);
      return new Reply(201, this.describe(sandbox));
    });
    r("GET", "/v1/sandboxes", async (c) => {
      const q = c.query;
      const list = await Sandbox.list({
        status: (q.get("status") as never) ?? null,
        limit: q.has("limit") ? Number(q.get("limit")) : 100,
        offset: q.has("offset") ? Number(q.get("offset")) : 0,
        ...c.connection,
      } as never);
      return { sandboxes: dump(list) };
    });
    r("POST", "/v1/sandboxes/:id/connect", async (c) => {
      const sandbox = await c.sandbox();
      await sandbox.refreshInfo().catch(() => undefined);
      return this.describe(sandbox);
    });
    r("GET", "/v1/sandboxes/:id", async (c) => {
      const sandbox = await c.sandbox();
      return dump(await sandbox.refreshInfo());
    });
    r("DELETE", "/v1/sandboxes/:id", async (c) => {
      await Sandbox.killById(c.id, { ...c.connection } as never);
      await this.drop(c.id, c.connection);
      return { ok: true };
    });
    r("GET", "/v1/sandboxes/:id/running", async (c) => ({ running: await (await c.sandbox()).isRunning() }));
    r("POST", "/v1/sandboxes/:id/timeout", async (c) => {
      const body = await c.json();
      await (await c.sandbox()).setTimeout(Number(body["timeout"]));
      return { ok: true };
    });
    r("POST", "/v1/sandboxes/:id/pause", async (c) => {
      await (await c.sandbox()).pause();
      return { ok: true };
    });
    r("POST", "/v1/sandboxes/:id/resume", async (c) => {
      await (await c.sandbox()).resume();
      return { ok: true };
    });
    r("GET", "/v1/sandboxes/:id/ports/:port/url", async (c) => {
      const [url, headers] = await (await c.sandbox()).network.resolve(Number(c.params[1]));
      return { url, headers };
    });

    r("POST", "/v1/sandboxes/:id/commands/run", async (c) => {
      const body = await c.json();
      const result = await (await c.sandbox()).commands.run(String(body["cmd"] ?? ""), commandOptions(body));
      return dump(result);
    });
    r("POST", "/v1/sandboxes/:id/commands/stream", async (c) => {
      const body = await c.json();
      const sandbox = await c.sandbox();
      const options = commandOptions(body);
      let stream: AsyncIterable<unknown>;
      if (Array.isArray(body["args"])) {
        const m = sandbox.commands;
        stream = await m._process.start(m._envd_url, m._envd_token, {
          cmd: String(body["cmd"] ?? ""),
          args: (body["args"] as unknown[]).map(String),
          env: (options["env"] as Record<string, string> | undefined) ?? null,
          cwd: String(options["cwd"] ?? ""),
          user: String(options["user"] ?? ""),
          timeout: Number(options["timeout"] ?? 60),
        });
      } else {
        stream = sandbox.commands.stream(String(body["cmd"] ?? ""), options);
      }
      await this.sse(c, stream, (chunk) => dump(chunk));
      return HANDLED;
    });
    r("GET", "/v1/sandboxes/:id/processes", async (c) => ({ processes: dump(await (await c.sandbox()).commands.list()) }));
    r("POST", "/v1/sandboxes/:id/processes/:pid/signal", async (c) => {
      const body = await c.json();
      await (await c.sandbox()).commands.sendSignal(pid(c.params[1]), body["signal"] === undefined ? 15 : Number(body["signal"]));
      return { ok: true };
    });
    r("POST", "/v1/sandboxes/:id/processes/:pid/stdin", async (c) => {
      const body = await c.json();
      await (await c.sandbox()).commands.sendStdin(pid(c.params[1]), String(body["data"] ?? ""));
      return { ok: true };
    });
    r("DELETE", "/v1/sandboxes/:id/processes/:pid", async (c) => {
      await (await c.sandbox()).commands.kill(pid(c.params[1]));
      return { ok: true };
    });

    const path = (c: Ctx): string => {
      const p = c.query.get("path");
      if (p === null || p === "") throw new HttpError(400, "query parameter 'path' is required", "ValueError");
      return p;
    };
    r("GET", "/v1/sandboxes/:id/files/content", async (c) => {
      const bytes = await (await c.sandbox()).files.readBytes(path(c));
      c.res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": bytes.length });
      c.res.end(Buffer.from(bytes));
      return HANDLED;
    });
    r("PUT", "/v1/sandboxes/:id/files/content", async (c) => {
      const target = path(c);
      await (await c.sandbox()).files.write(target, new Uint8Array(await c.raw()));
      return { ok: true };
    });
    r("GET", "/v1/sandboxes/:id/files/list", async (c) => ({ entries: dump(await (await c.sandbox()).files.list(c.query.get("path") ?? "/")) }));
    r("GET", "/v1/sandboxes/:id/files/info", async (c) => dump(await (await c.sandbox()).files.getInfo(path(c))));
    r("GET", "/v1/sandboxes/:id/files/exists", async (c) => ({ exists: await (await c.sandbox()).files.exists(path(c)) }));
    r("POST", "/v1/sandboxes/:id/files/mkdir", async (c) => {
      const body = await c.json();
      await (await c.sandbox()).files.makeDir(String(body["path"] ?? ""));
      return { ok: true };
    });
    r("POST", "/v1/sandboxes/:id/files/move", async (c) => {
      const body = await c.json();
      await (await c.sandbox()).files.move(String(body["source"] ?? ""), String(body["destination"] ?? ""));
      return { ok: true };
    });
    r("DELETE", "/v1/sandboxes/:id/files", async (c) => {
      await (await c.sandbox()).files.remove(path(c));
      return { ok: true };
    });
    r("GET", "/v1/sandboxes/:id/files/watch", async (c) => {
      const stream = await (await c.sandbox()).files.watch(path(c));
      await this.sse(c, stream, (event) => dump(event));
      return HANDLED;
    });

    r("POST", "/v1/sandboxes/:id/code/run", async (c) => {
      const body = await c.json();
      const opts: Dict = { language: body["language"] ?? "python", timeout: body["timeout"] ?? 30, envs: body["envs"] ?? null, context_id: body["context_id"] ?? null };
      return dump(await (await c.sandbox()).code.run(String(body["code"] ?? ""), opts as never));
    });
    r("POST", "/v1/sandboxes/:id/code/contexts", async (c) => {
      const body = await c.json();
      return new Reply(201, await (await c.sandbox()).code.createContext({ language: String(body["language"] ?? "python") }));
    });
    r("GET", "/v1/sandboxes/:id/code/contexts", async (c) => ({ contexts: await (await c.sandbox()).code.listContexts() }));
    r("POST", "/v1/sandboxes/:id/code/contexts/:ctx/restart", async (c) => (await c.sandbox()).code.restartContext(c.params[1] as string));
    r("DELETE", "/v1/sandboxes/:id/code/contexts/:ctx", async (c) => {
      await (await c.sandbox()).code.removeContext(c.params[1] as string);
      return { ok: true };
    });
  }

  private describe(sandbox: Sandbox): Dict {
    return { sandbox_id: sandbox.id, provider: sandbox.provider, url: sandbox.url, status: sandbox.status, info: dump(sandbox.info) };
  }

  private connectionOf(c: Ctx, body: Dict | null = null): Connection {
    const inline = body?.["connection"];
    if (inline !== null && inline !== undefined && typeof inline === "object") return cleanConnection(inline as Dict);
    return c.connection;
  }

  /** Stream `source` as server-sent events until it ends or the client goes away. */
  private async sse(c: Ctx, source: AsyncIterable<unknown>, map: (item: unknown) => unknown): Promise<void> {
    c.res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const iterator = source[Symbol.asyncIterator]();
    let gone = false;
    c.res.on("close", () => {
      gone = true;
      void iterator.return?.(undefined)?.catch?.(() => undefined);
    });
    try {
      for (;;) {
        const step = await iterator.next();
        if (step.done || gone) break;
        c.res.write(`data: ${JSON.stringify(map(step.value))}\n\n`);
      }
      if (!gone) c.res.write("event: end\ndata: {}\n\n");
    } catch (exc) {
      if (!gone) c.res.write(`event: error\ndata: ${JSON.stringify(errorBody(exc))}\n\n`);
    }
    if (!gone) c.res.end();
  }

  private authorized(req: http.IncomingMessage): boolean {
    const host = String(req.headers["host"] ?? "").replace(/:\d+$/, "");
    if (!LOOPBACK.has(host)) return false;
    if (req.headers["origin"] !== undefined) return false;
    const header = String(req.headers["authorization"] ?? "");
    if (!header.startsWith("Bearer ")) return false;
    const given = Buffer.from(header.slice(7));
    const want = Buffer.from(this.token);
    return given.length === want.length && timingSafeEqual(given, want);
  }

  private connectionHeader(req: http.IncomingMessage): Connection {
    const raw = req.headers["x-abx-connection"];
    if (raw === undefined || Array.isArray(raw) || raw === "") return {};
    try {
      const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf-8")) as unknown;
      if (parsed !== null && typeof parsed === "object") return cleanConnection(parsed as Dict);
    } catch {
      /* falls through */
    }
    throw new HttpError(400, "X-Abx-Connection must be base64url-encoded JSON", "ValueError");
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    this.inflight += 1;
    this.lastActivity = Date.now();
    try {
      if (!this.authorized(req)) throw new HttpError(401, "Missing or invalid engine token.", "AuthenticationError", "E1000");
      const url = new URL(req.url ?? "/", "http://engine.local");
      const method = req.method ?? "GET";
      const connection = this.connectionHeader(req);
      for (const route of this.routes) {
        if (route.method !== method) continue;
        const m = route.pattern.exec(url.pathname);
        if (m === null) continue;
        const params = m.slice(1).map((p) => decodeURIComponent(p));
        const id = url.pathname.startsWith("/v1/sandboxes/") ? (params[0] ?? "") : "";
        const ctx: Ctx = {
          req,
          res,
          params,
          query: url.searchParams,
          connection,
          id,
          json: () => readJson(req),
          raw: () => readBody(req),
          sandbox: () => this.session(id, connection),
        };
        try {
          const out = await route.handler(ctx);
          if (out === HANDLED) return;
          if (out instanceof Reply) send(res, out.status, out.body);
          else send(res, 200, out);
        } catch (exc) {
          if (exc instanceof SandboxNotFoundError && id !== "") await this.drop(id, connection);
          throw exc;
        }
        return;
      }
      throw new HttpError(404, `No route for ${method} ${url.pathname}`, "NotFound");
    } catch (exc) {
      if (res.headersSent) {
        res.end();
      } else {
        send(res, statusFor(exc), errorBody(exc));
      }
    } finally {
      this.inflight -= 1;
      this.lastActivity = Date.now();
    }
  }

  private async upgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const reject = (status: number, text: string): void => {
      socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if (!this.authorized(req)) return reject(401, "Unauthorized");
    const url = new URL(req.url ?? "/", "http://engine.local");
    const m = /^\/v1\/sandboxes\/([^/]+)\/terminal$/.exec(url.pathname);
    if (m === null) return reject(404, "Not Found");
    this.inflight += 1;
    try {
      const id = decodeURIComponent(m[1] as string);
      const sandbox = await this.session(id, this.connectionHeader(req));
      const term = await sandbox.getTerminal({
        cols: Number(url.searchParams.get("cols") ?? 80),
        rows: Number(url.searchParams.get("rows") ?? 24),
        shell: url.searchParams.get("shell") ?? "/bin/bash",
      });
      this.wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        const pump = (async () => {
          for await (const message of term.outputStream()) {
            if (ws.readyState !== ws.OPEN) break;
            ws.send(message, { binary: typeof message !== "string" });
          }
        })();
        ws.on("message", (data, isBinary) => {
          const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
          void (isBinary ? term.sendBytes(new Uint8Array(bytes)) : term.send(bytes.toString("utf-8"))).catch(() => ws.close());
        });
        const finish = (): void => {
          this.inflight -= 1;
          this.lastActivity = Date.now();
          void term.close().catch(() => undefined);
        };
        ws.on("close", finish);
        void pump.then(() => ws.close()).catch(() => ws.close());
      });
    } catch (exc) {
      this.inflight -= 1;
      reject(statusFor(exc), exc instanceof Error ? exc.message.replace(/[\r\n]+/g, " ") : "error");
    }
  }

  async listen(): Promise<number> {
    this.server = http.createServer((req, res) => void this.handle(req, res));
    this.server.on("upgrade", (req, socket, head) => void this.upgrade(req, socket, head));
    this.server.requestTimeout = 0;
    this.server.headersTimeout = 30_000;
    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.opts.port, "127.0.0.1", resolve);
    });
    const { port } = this.server.address() as { port: number };

    if (this.opts.idle_timeout > 0) {
      const limit = this.opts.idle_timeout * 1000;
      this.idleTimer = setInterval(() => {
        if (this.inflight === 0 && Date.now() - this.lastActivity >= limit) void this.close();
      }, Math.min(5000, Math.max(50, limit / 4)));
      this.idleTimer.unref();
    }
    if (this.opts.session_ttl > 0) {
      const ttl = this.opts.session_ttl * 1000;
      this.sweepTimer = setInterval(() => {
        for (const [key, s] of this.sessions) {
          if (this.inflight === 0 && Date.now() - s.last_used >= ttl) {
            this.sessions.delete(key);
            void s.sandbox.close().catch(() => undefined);
          }
        }
      }, Math.min(30_000, Math.max(50, ttl / 4)));
      this.sweepTimer.unref();
    }
    return port;
  }

  async close(): Promise<void> {
    if (this.stopping) return this.closed;
    this.stopping = true;
    if (this.idleTimer) clearInterval(this.idleTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    const server = this.server;
    if (server !== null) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    }
    for (const ws of this.wss.clients) ws.terminate();
    await Promise.all([...this.sessions.values()].map((s) => s.sandbox.close().catch(() => undefined)));
    this.sessions.clear();
    removeRecord(process.pid);
    this.releaseLock();
    this.resolveClosed();
    return this.closed;
  }
}

const HANDLED = Symbol("handled");

class Reply {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {}
}

function cleanConnection(raw: Dict): Connection {
  const keys = ["provider", "provider_options", "api_key", "api_url", "domain", "access_key_id", "access_key_secret"] as const;
  const out: Dict = {};
  for (const k of keys) if (raw[k] !== undefined && raw[k] !== null && raw[k] !== "") out[k] = raw[k];
  return out as Connection;
}

function pid(raw: string | undefined): number | string {
  const text = raw ?? "";
  return /^\d+$/.test(text) ? Number(text) : text;
}

function commandOptions(body: Dict): Dict {
  const out: Dict = {};
  for (const k of ["timeout", "env", "cwd", "user", "shell"]) if (body[k] !== undefined && body[k] !== null) out[k] = body[k];
  return out;
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY) throw new HttpError(413, "Request body is too large.", "PayloadTooLarge");
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: http.IncomingMessage): Promise<Dict> {
  const raw = (await readBody(req)).toString("utf-8");
  if (raw.trim() === "") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Dict;
  } catch {
    /* falls through */
  }
  throw new HttpError(400, "The request body must be a JSON object.", "ValueError");
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body ?? {}));
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": payload.length });
  res.end(payload);
}

/** Start an engine, publish it, and return a handle. Throws `EngineRunning` when another engine holds the lock. */
export async function startEngine(options: EngineOptions = {}): Promise<EngineHandle> {
  const release = acquireLock();
  if (release === null) throw new Error("EngineRunning");
  const token = randomBytes(24).toString("base64url");
  const engine = new Engine(
    token,
    { port: options.port ?? 0, idle_timeout: options.idle_timeout ?? 900, session_ttl: options.session_ttl ?? 600 },
    release,
  );
  let port: number;
  try {
    port = await engine.listen();
  } catch (exc) {
    release();
    throw exc;
  }
  const record: EngineRecord = {
    protocol: ENGINE_PROTOCOL,
    pid: process.pid,
    host: "127.0.0.1",
    port,
    token,
    version: hostVersion(),
    started_at: new Date().toISOString(),
  };
  writeRecord(record);
  return { record, closed: engine.closed, close: () => engine.close() };
}
