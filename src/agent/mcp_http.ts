/**
 * MCP Streamable HTTP transport.
 *
 * Implements the MCP Streamable HTTP transport (2025-06-18 specification):
 * - `POST /mcp`   — JSON-RPC request/response
 * - `GET  /mcp`   — returns 405 until SSE server notifications exist
 * - `DELETE /mcp` — Session termination & sandbox cleanup
 *
 * Reuses the 7 P0 tools defined in `tools.ts` via `SandboxMCPServer` and
 * `SandboxManager`.
 *
 * Protocol version: this transport supports `2025-06-18` only. Each session's
 * `SandboxMCPServer` is created with that supported-version set, so
 * `initialize` negotiates `2025-06-18` — consistent with the version reported
 * by `GET /health`. The STDIO transport keeps its own `2024-11-05` default.
 *
 * Authentication:
 * - Client → MCP: `Authorization: Bearer <token>` (validated here)
 * - MCP → Sandbox: `E2B_API_KEY` environment variable (forwarded by SandboxManager)
 *
 * Session affinity requires platform routing based on the `Mcp-Session-Id`
 * response header.
 *
 * Port of `agent_sandbox/agent/mcp_http.py`. The Python app is Starlette on
 * uvicorn; this one is `node:http` with the same routes, status codes,
 * header names, and body bytes.
 */

import { randomUUID, timingSafeEqual } from "node:crypto";
import * as http from "node:http";
import type { AddressInfo } from "node:net";

import { ExcInfo, getLogger } from "../utils/logging.js";
import {
  ValueError,
  isDict,
  pyJsonDumps,
  pyJsonLoadsBytes,
  pyStrip,
  type JsonObject,
} from "./_py.js";
import { SandboxMCPServer } from "./mcp.js";

const logger = getLogger("agent.mcp_http");

// ---------------------------------------------------------------------------
// MCP protocol constants (Streamable HTTP — 2025-06-18)
// ---------------------------------------------------------------------------

/**
 * The only protocol version this transport supports. Passed to each session's
 * SandboxMCPServer so initialize negotiates consistently with GET /health.
 */
export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const CONTENT_TYPE_JSON = "application/json";

// JSON-RPC error codes
export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INTERNAL_ERROR = -32603;
export const SESSION_LIMIT_ERROR = -32000;

export const DEFAULT_SESSION_TTL_SECONDS = 3600.0;
export const DEFAULT_MAX_SESSIONS = 100;

// ---------------------------------------------------------------------------
// Seams the Python tests patch (`hmac.compare_digest`, `time.monotonic`)
// ---------------------------------------------------------------------------

export const hmac = {
  /** `hmac.compare_digest(a, b)` for bytes: constant time, false on length mismatch. */
  compareDigest(a: Buffer, b: Buffer): boolean {
    if (a.length !== b.length) {
      timingSafeEqual(b, b);
      return false;
    }
    return timingSafeEqual(a, b);
  },
};

export const time = {
  /** `time.monotonic()` in seconds. */
  monotonic(): number {
    return Number(process.hrtime.bigint()) / 1e9;
  },
};

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 helpers (shared format with agent/mcp.ts)
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

// ---------------------------------------------------------------------------
// Session store — in-process session → SandboxMCPServer mapping
// ---------------------------------------------------------------------------

/** A server session and its most recent access time. */
export interface _SessionEntry {
  server: SandboxMCPServer;
  last_access: number;
}

/** Raised when the configured concurrent-session limit is reached. */
export class SessionCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionCapacityError";
  }
}

export interface SessionStoreOptions {
  api_key?: string | null;
  api_url?: string | null;
  domain?: string | null;
  template?: string;
  session_ttl_seconds?: number;
  max_sessions?: number;
}

/**
 * Manage bounded, expiring MCP sessions.
 *
 * In FC, requests carrying the same `Mcp-Session-Id` must be routed to
 * the same instance. Idle sessions are expired and the total number of
 * in-process sessions is capped to prevent unbounded resource growth.
 */
export class SessionStore {
  _api_key: string | null;
  _api_url: string | null;
  _domain: string | null;
  _template: string;
  _session_ttl_seconds: number;
  _max_sessions: number;
  _sessions: Map<string, _SessionEntry> = new Map();

  constructor(options: SessionStoreOptions = {}) {
    const sessionTtlSeconds = options.session_ttl_seconds ?? DEFAULT_SESSION_TTL_SECONDS;
    const maxSessions = options.max_sessions ?? DEFAULT_MAX_SESSIONS;
    if (sessionTtlSeconds <= 0) {
      throw new ValueError("session_ttl_seconds must be positive");
    }
    if (maxSessions <= 0) {
      throw new ValueError("max_sessions must be positive");
    }
    this._api_key = options.api_key ?? null;
    this._api_url = options.api_url ?? null;
    this._domain = options.domain ?? null;
    this._template = options.template ?? "base";
    this._session_ttl_seconds = sessionTtlSeconds;
    this._max_sessions = maxSessions;
  }

  /**
   * Create a session after removing expired entries.
   *
   * @returns Tuple of (session_id, SandboxMCPServer).
   * @throws SessionCapacityError if the active-session limit is reached.
   */
  async createSession(): Promise<[string, SandboxMCPServer]> {
    await this.cleanupExpired();
    if (this._sessions.size >= this._max_sessions) {
      throw new SessionCapacityError(`MCP session limit reached (${this._max_sessions})`);
    }

    const sessionId = randomUUID();
    const server = new SandboxMCPServer({
      api_key: this._api_key,
      api_url: this._api_url,
      domain: this._domain,
      template: this._template,
      // Streamable HTTP transport supports only 2025-06-18 — the same
      // version GET /health reports. Keeps initialize negotiation
      // consistent with the transport declaration.
      supported_protocol_versions: [MCP_PROTOCOL_VERSION],
    });
    this._sessions.set(sessionId, { server, last_access: time.monotonic() });
    logger.info("Created MCP session: %s", sessionId);
    return [sessionId, server];
  }

  /**
   * Look up an existing session and refresh its idle timestamp.
   *
   * @returns SandboxMCPServer if found, else null.
   */
  getSession(sessionId: string): SandboxMCPServer | null {
    const entry = this._sessions.get(sessionId);
    if (entry === undefined) return null;
    entry.last_access = time.monotonic();
    return entry.server;
  }

  /**
   * Destroy a session and shut down its sandboxes.
   *
   * @returns true if the session existed and was cleaned up.
   */
  async destroySession(sessionId: string): Promise<boolean> {
    const entry = this._sessions.get(sessionId);
    this._sessions.delete(sessionId);
    if (entry === undefined) return false;
    await entry.server.shutdown();
    logger.info("Destroyed MCP session: %s", sessionId);
    return true;
  }

  /**
   * Destroy idle sessions whose TTL has elapsed.
   *
   * @returns Number of expired sessions removed.
   */
  async cleanupExpired(): Promise<number> {
    const now = time.monotonic();
    const expiredIds = [...this._sessions.entries()]
      .filter(([, entry]) => now - entry.last_access >= this._session_ttl_seconds)
      .map(([sessionId]) => sessionId);
    for (const sessionId of expiredIds) {
      await this.destroySession(sessionId);
    }
    return expiredIds.length;
  }

  /** Destroy every session (used on process exit). */
  async shutdownAll(): Promise<void> {
    for (const sessionId of [...this._sessions.keys()]) {
      await this.destroySession(sessionId);
    }
  }
}

// ---------------------------------------------------------------------------
// Authentication helper
// ---------------------------------------------------------------------------

/** The remote MCP server was started without a usable Bearer token. */
export class MCPAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MCPAuthConfigError";
  }
}

/**
 * Return a non-empty Bearer token or refuse to start.
 *
 * A missing token used to mean "authentication disabled". That is acceptable
 * on a loopback STDIO or HTTP process the operator started themselves. A
 * function deployed for remote clients must not boot in that mode.
 *
 * @param value `ABX_MCP_AUTH_TOKEN` or an equivalent setting.
 * @returns The stripped token.
 * @throws MCPAuthConfigError when the token is missing or only whitespace.
 */
export function requireAuthToken(value: string | null | undefined): string {
  const token = pyStrip(value ?? "");
  if (!token) {
    throw new MCPAuthConfigError(
      "ABX_MCP_AUTH_TOKEN is empty. Refusing to start a remote MCP " +
        "server with client authentication disabled.",
    );
  }
  return token;
}

/** Anything with a `headers` lookup: Web `Headers`, `HeaderBag`, or a plain object. */
export interface HeaderSource {
  headers?:
    | { get(name: string): string | null | undefined }
    | Record<string, string | undefined>;
}

function headerValue(request: HeaderSource, name: string): string | null {
  const headers = request.headers;
  if (headers === undefined || headers === null) return null;
  if (typeof (headers as { get?: unknown }).get === "function") {
    const found = (headers as { get(name: string): string | null | undefined }).get(name);
    return found === undefined ? null : found;
  }
  const record = headers as Record<string, string | undefined>;
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === name.toLowerCase()) return record[key] ?? null;
  }
  return null;
}

/**
 * Check `Authorization: Bearer <token>` header.
 *
 * @param request Object with a `headers` lookup.
 * @param expectedToken The expected token value. If null, auth is disabled.
 * @returns true if the request is authorized.
 */
export function _validateBearerToken(
  request: HeaderSource,
  expectedToken: string | null | undefined,
): boolean {
  if (expectedToken === null || expectedToken === undefined) {
    return true; // authentication explicitly disabled
  }

  const normalizedExpected = pyStrip(expectedToken);
  if (!normalizedExpected) {
    return false; // configured-but-empty tokens fail closed
  }

  const authHeader = headerValue(request, "authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return false;
  }
  const suppliedToken = pyStrip(authHeader.slice(7));
  return hmac.compareDigest(
    Buffer.from(suppliedToken, "utf-8"),
    Buffer.from(normalizedExpected, "utf-8"),
  );
}

/** `urllib.parse.urlparse(origin).hostname` (lower-cased by the caller). */
function urlparseHostname(url: string): string | null {
  // urlsplit drops tab/CR/LF and leading C0 controls + space before parsing.
  let rest = url.replace(/[\t\r\n]/g, "").replace(/^[\u0000-\u0020]+/, "");
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(rest);
  if (scheme) rest = rest.slice(scheme[0].length);
  if (!rest.startsWith("//")) return null;
  rest = rest.slice(2);
  let end = rest.length;
  for (const ch of ["/", "?", "#"]) {
    const at = rest.indexOf(ch);
    if (at !== -1 && at < end) end = at;
  }
  const netloc = rest.slice(0, end);
  if ((netloc.includes("[") && !netloc.includes("]")) || (netloc.includes("]") && !netloc.includes("["))) {
    throw new ValueError("Invalid IPv6 URL");
  }
  const at = netloc.lastIndexOf("@");
  const hostinfo = at === -1 ? netloc : netloc.slice(at + 1);
  let hostname: string;
  if (hostinfo.startsWith("[")) {
    hostname = hostinfo.slice(1).split("]", 1)[0] as string;
  } else {
    hostname = hostinfo.split(":", 1)[0] as string;
  }
  return hostname ? hostname : null;
}

/**
 * Allow missing Origin, localhost, and an explicit allow-list.
 *
 * Browsers always send Origin. A remote MCP endpoint with authentication
 * disabled must still reject a page on another host (DNS rebinding).
 * Non-browser clients omit Origin and are allowed.
 */
export function _originAllowed(
  request: HeaderSource,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  const origin = headerValue(request, "origin");
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  const host = (urlparseHostname(origin) ?? "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

// ---------------------------------------------------------------------------
// Minimal ASGI-style request / response model (Starlette behaviour)
// ---------------------------------------------------------------------------

/** Case-insensitive header lookup returning the first value, like Starlette `Headers`. */
export class HeaderBag {
  constructor(private readonly raw: ReadonlyArray<readonly [string, string]>) {}

  get(name: string): string | null {
    const wanted = name.toLowerCase();
    for (const [key, value] of this.raw) {
      if (key.toLowerCase() === wanted) return value;
    }
    return null;
  }
}

export interface McpRequest {
  method: string;
  /** Percent-decoded path without the query string (`scope["path"]`). */
  path: string;
  queryString: string;
  headers: HeaderBag;
  body(): Promise<Buffer>;
  json(): Promise<unknown>;
  /** Origin the request was addressed to, for redirect URLs. */
  baseUrl(path: string): string;
}

export interface McpResponse {
  status: number;
  /** Lower-cased header names in wire order. */
  headers: Array<[string, string]>;
  body: Buffer;
}

function jsonResponse(
  content: unknown,
  status = 200,
  extraHeaders: Array<[string, string]> = [],
): McpResponse {
  // Starlette JSONResponse: ensure_ascii=False, allow_nan=False, compact separators.
  const body = Buffer.from(pyJsonDumps(content, { ensureAscii: false, compact: true, allowNan: false }), "utf-8");
  return {
    status,
    headers: [
      ...extraHeaders.map(([k, v]) => [k.toLowerCase(), v] as [string, string]),
      ["content-length", String(body.length)],
      ["content-type", CONTENT_TYPE_JSON],
    ],
    body,
  };
}

function emptyResponse(status: number, extraHeaders: Array<[string, string]> = []): McpResponse {
  return {
    status,
    headers: [
      ...extraHeaders.map(([k, v]) => [k.toLowerCase(), v] as [string, string]),
      ["content-length", "0"],
    ],
    body: Buffer.alloc(0),
  };
}

function plainTextResponse(
  text: string,
  status: number,
  extraHeaders: Array<[string, string]> = [],
): McpResponse {
  const body = Buffer.from(text, "utf-8");
  return {
    status,
    headers: [
      ...extraHeaders.map(([k, v]) => [k.toLowerCase(), v] as [string, string]),
      ["content-length", String(body.length)],
      ["content-type", "text/plain; charset=utf-8"],
    ],
    body,
  };
}

/** 403 used when the Origin header is present and not allowed. */
function _rejectOrigin(): McpResponse {
  return jsonResponse({ error: "Origin is not allowed" }, 403);
}

function _unauthorized(): McpResponse {
  return jsonResponse(_jsonrpcError(null, -32001, "Unauthorized"), 401);
}

/** `urllib.parse.quote(value, safe=":/%#?=@[]!$&'()*+,;")` as used by Starlette redirects. */
function quoteRedirect(value: string): string {
  const safe = new Set(":/%#?=@[]!$&'()*+,;");
  let out = "";
  for (const ch of value) {
    if (/[A-Za-z0-9_.~-]/.test(ch) || safe.has(ch)) out += ch;
    else {
      for (const byte of Buffer.from(ch, "utf-8")) {
        out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
      }
    }
  }
  return out;
}

/** `urllib.parse.unquote` (invalid UTF-8 becomes U+FFFD). */
function unquote(value: string): string {
  return value.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => {
    const bytes = Buffer.from(run.replace(/%/g, ""), "hex");
    return new TextDecoder("utf-8").decode(bytes);
  });
}

// ---------------------------------------------------------------------------
// Application factory
// ---------------------------------------------------------------------------

export interface McpHttpApp {
  /** `node:http` request listener. */
  handler: http.RequestListener;
  /** Mirrors Starlette `app.state` (`session_store` is exposed for tests). */
  state: { session_store: SessionStore };
  /** Pure request → response dispatch used by `handler` (no sockets involved). */
  handle(request: McpRequest): Promise<McpResponse>;
  /** ASGI lifespan shutdown: destroy every session and its sandboxes. */
  shutdown(): Promise<void>;
  /** Build an `http.Server` bound to `handler`. */
  createServer(): http.Server;
}

export interface CreateMcpAppOptions {
  /** Bearer token for client authentication. If null/undefined, authentication is disabled. */
  auth_token?: string | null;
  /** `E2B_API_KEY` for MCP → Sandbox backend auth. */
  api_key?: string | null;
  /** Override for the sandbox API URL. */
  api_url?: string | null;
  /** Override for the sandbox domain. */
  domain?: string | null;
  /** Default sandbox template. */
  template?: string;
  /** Idle time before a session is cleaned up. */
  session_ttl_seconds?: number;
  /** Maximum concurrent sessions in this process. */
  max_sessions?: number;
  /** Extra `Origin` values to accept. Localhost is always accepted. A missing Origin is accepted. */
  allowed_origins?: Iterable<string> | null;
}

type RouteHandler = (request: McpRequest) => Promise<McpResponse>;

interface Route {
  path: string;
  methods: readonly string[];
  handler: RouteHandler;
}

/** Create the MCP Streamable HTTP application. */
export function createMcpApp(options: CreateMcpAppOptions = {}): McpHttpApp {
  const authToken = options.auth_token ?? null;
  const origins: ReadonlySet<string> = new Set(options.allowed_origins ?? []);

  const store = new SessionStore({
    api_key: options.api_key,
    api_url: options.api_url,
    domain: options.domain,
    template: options.template,
    session_ttl_seconds: options.session_ttl_seconds,
    max_sessions: options.max_sessions,
  });

  // ---- POST /mcp ----
  const handlePost: RouteHandler = async (request) => {
    if (!_originAllowed(request, origins)) {
      return _rejectOrigin();
    }
    if (!_validateBearerToken(request, authToken)) {
      return _unauthorized();
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(_jsonrpcError(null, PARSE_ERROR, "Invalid JSON"), 400);
    }
    if (!isDict(body)) {
      return jsonResponse(_jsonrpcError(null, INVALID_REQUEST, "Request must be a JSON object"), 400);
    }

    await store.cleanupExpired();

    // Resolve or create session
    let sessionId = request.headers.get("mcp-session-id");
    const method = Object.hasOwn(body, "method") ? body.method : "";
    const bodyId = Object.hasOwn(body, "id") ? (body.id ?? null) : null;

    let server: SandboxMCPServer | null;
    if (sessionId) {
      server = store.getSession(sessionId);
      if (server === null) {
        return jsonResponse(
          _jsonrpcError(bodyId, INVALID_REQUEST, `Unknown session: ${sessionId}`),
          404,
        );
      }
    } else if (method === "initialize") {
      // Only 'initialize' may create a new session
      try {
        [sessionId, server] = await store.createSession();
      } catch (exc) {
        if (exc instanceof SessionCapacityError) {
          return jsonResponse(_jsonrpcError(bodyId, SESSION_LIMIT_ERROR, exc.message), 503);
        }
        throw exc;
      }
    } else {
      return jsonResponse(
        _jsonrpcError(
          bodyId,
          INVALID_REQUEST,
          "Missing Mcp-Session-Id header. Send an 'initialize' request first.",
        ),
        400,
      );
    }

    // Dispatch to the shared MCP logic
    const responseBody = await server.handleRequest(body);

    const resp =
      responseBody === null || responseBody === undefined
        ? emptyResponse(202)
        : jsonResponse(responseBody);

    // Attach session header
    if (sessionId) {
      resp.headers.push(["mcp-session-id", sessionId]);
    }
    return resp;
  };

  // ---- GET /mcp (SSE not implemented; 405 per the Streamable HTTP spec) ----
  const handleGet: RouteHandler = async (request) => {
    if (!_originAllowed(request, origins)) {
      return _rejectOrigin();
    }
    if (!_validateBearerToken(request, authToken)) {
      return _unauthorized();
    }
    return jsonResponse(
      { error: "SSE server notifications are not implemented. Use POST /mcp." },
      405,
      [["Allow", "POST, DELETE"]],
    );
  };

  // ---- DELETE /mcp ----
  const handleDelete: RouteHandler = async (request) => {
    if (!_originAllowed(request, origins)) {
      return _rejectOrigin();
    }
    if (!_validateBearerToken(request, authToken)) {
      return _unauthorized();
    }

    const sessionId = request.headers.get("mcp-session-id");
    if (!sessionId) {
      return jsonResponse({ error: "Missing Mcp-Session-Id header" }, 400);
    }

    const destroyed = await store.destroySession(sessionId);
    if (!destroyed) {
      return jsonResponse({ error: `Unknown session: ${sessionId}` }, 404);
    }
    return jsonResponse({ status: "session_terminated" });
  };

  // ---- Health check ----
  const handleHealth: RouteHandler = async () =>
    jsonResponse({ status: "ok", protocol: MCP_PROTOCOL_VERSION });

  const routes: Route[] = [
    { path: "/mcp", methods: ["POST"], handler: handlePost },
    { path: "/mcp", methods: ["GET", "HEAD"], handler: handleGet },
    { path: "/mcp", methods: ["DELETE"], handler: handleDelete },
    { path: "/health", methods: ["GET", "HEAD"], handler: handleHealth },
  ];

  /** Starlette `Router`: full match, first partial (405), slash redirect, else 404. */
  async function route(request: McpRequest): Promise<McpResponse> {
    let partial: Route | undefined;
    for (const candidate of routes) {
      if (candidate.path !== request.path) continue;
      if (candidate.methods.includes(request.method)) return candidate.handler(request);
      partial ??= candidate;
    }
    if (partial !== undefined) {
      return plainTextResponse("Method Not Allowed", 405, [["Allow", partial.methods.join(", ")]]);
    }

    if (request.path !== "/") {
      const redirectPath = request.path.endsWith("/")
        ? request.path.replace(/\/+$/, "")
        : `${request.path}/`;
      if (routes.some((candidate) => candidate.path === redirectPath)) {
        let url = request.baseUrl(redirectPath);
        if (request.queryString) url += `?${request.queryString}`;
        const redirect = emptyResponse(307);
        redirect.headers.push(["location", quoteRedirect(url)]);
        return redirect;
      }
    }
    return plainTextResponse("Not Found", 404);
  }

  async function handle(request: McpRequest): Promise<McpResponse> {
    try {
      return await route(request);
    } catch (exc) {
      process.stderr.write(
        `ERROR:    Exception in ASGI application\n${exc instanceof Error ? (exc.stack ?? exc.message) : String(exc)}\n`,
      );
      return plainTextResponse("Internal Server Error", 500);
    }
  }

  const handler: http.RequestListener = (req, res) => {
    void respond(handle, req, res);
  };

  const app: McpHttpApp = {
    handler,
    state: { session_store: store },
    handle,
    shutdown: () => store.shutdownAll(),
    createServer: () => createUvicornLikeServer(handler),
  };
  return app;
}

function rawHeaderPairs(req: http.IncomingMessage): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i + 1 < req.rawHeaders.length; i += 2) {
    pairs.push([req.rawHeaders[i] as string, req.rawHeaders[i + 1] as string]);
  }
  return pairs;
}

function toMcpRequest(req: http.IncomingMessage): McpRequest {
  const target = req.url ?? "/";
  const queryAt = target.indexOf("?");
  const rawPath = queryAt === -1 ? target : target.slice(0, queryAt);
  const queryString = queryAt === -1 ? "" : target.slice(queryAt + 1);
  const headers = new HeaderBag(rawHeaderPairs(req));
  let cached: Promise<Buffer> | undefined;
  const readBody = (): Promise<Buffer> => {
    cached ??= (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer));
      return Buffer.concat(chunks);
    })();
    return cached;
  };
  return {
    method: (req.method ?? "GET").toUpperCase(),
    path: unquote(rawPath),
    queryString,
    headers,
    body: readBody,
    json: async () => pyJsonLoadsBytes(await readBody(), { floats: "py" }),
    baseUrl: (path: string) => {
      const hostHeader = headers.get("host");
      if (hostHeader !== null) return `http://${hostHeader}${path}`;
      const socket = req.socket;
      const port = socket.localPort;
      const host = socket.localAddress ?? "127.0.0.1";
      return `http://${host}${port === undefined || port === 80 ? "" : `:${port}`}${path}`;
    },
  };
}

async function respond(
  handle: (request: McpRequest) => Promise<McpResponse>,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  let response: McpResponse;
  try {
    response = await handle(toMcpRequest(req));
  } catch {
    response = plainTextResponse("Internal Server Error", 500);
  }
  if (res.destroyed) return;
  const flat: string[] = [];
  for (const [key, value] of response.headers) flat.push(key, value);
  res.writeHead(response.status, flat);
  res.end(response.body);
}

// ---------------------------------------------------------------------------
// Convenience: default app (read config from env)
// ---------------------------------------------------------------------------

/**
 * Create a default app reading configuration from environment variables.
 *
 * Environment variables:
 * - `ABX_MCP_AUTH_TOKEN` — Bearer token for client auth (optional)
 * - `ABX_SANDBOX_API_KEY` — Sandbox backend API key
 * - `ABX_SANDBOX_BASE_URL` — API URL override
 * - `ABX_SANDBOX_DOMAIN` — Domain override
 * - `ABX_DEFAULT_TEMPLATE` — Default template
 * - `ABX_MCP_ALLOWED_ORIGINS` — comma separated extra `Origin` values
 */
export function _createDefaultApp(env: NodeJS.ProcessEnv = process.env): McpHttpApp {
  const rawOrigins = env.ABX_MCP_ALLOWED_ORIGINS ?? "";
  const allowedOrigins = new Set(
    rawOrigins
      .split(",")
      .map((part) => pyStrip(part))
      .filter((part) => part),
  );
  // Python: os.environ.get("SANDBOX_TEMPLATE") or os.environ.get("ABX_TEMPLATE", "base")
  const template = env.ABX_DEFAULT_TEMPLATE ?? "base";
  return createMcpApp({
    auth_token: env.ABX_MCP_AUTH_TOKEN ?? null,
    api_key: env.ABX_SANDBOX_API_KEY || null,
    api_url: env.ABX_SANDBOX_BASE_URL || null,
    domain: env.ABX_SANDBOX_DOMAIN || null,
    template,
    allowed_origins: allowedOrigins,
  });
}

let _cachedApp: McpHttpApp | null = null;

/** Return the module-level app (lazily created from the environment). */
export function getAsgiApp(): McpHttpApp {
  _cachedApp ??= _createDefaultApp();
  return _cachedApp;
}

/** Module-level request listener that lazily creates the real app on first call. */
export const asgiApp: http.RequestListener = (req, res) => getAsgiApp().handler(req, res);

// ---------------------------------------------------------------------------
// Serving (what `uvicorn.run(app, host=..., port=..., log_level="info")` does)
// ---------------------------------------------------------------------------

export interface ServeOptions {
  host: string;
  port: number;
  /** uvicorn log level; "info" prints the startup banner and access lines. */
  log_level?: "critical" | "error" | "warning" | "info" | "debug" | "trace";
  /** Called once the socket is listening. */
  onListening?: (address: AddressInfo) => void;
  /** Install SIGINT/SIGTERM handlers for graceful shutdown. Default true. */
  handleSignals?: boolean;
}

export interface RunningServer {
  server: http.Server;
  address: AddressInfo;
  /** Stop accepting connections, drain, then destroy sessions (lifespan shutdown). */
  close(): Promise<void>;
  /** Resolves once the server has fully shut down. */
  closed: Promise<void>;
}

const STATUS_PHRASES = http.STATUS_CODES;

/**
 * uvicorn's h11 protocol only rejects a request head ("Receive buffer too long" -> 400) when it arrives in several reads
 * and the buffered incomplete head exceeds 16 KiB; a head delivered by a single `recv` is accepted whatever its size. On
 * loopback the oracle accepted heads up to 127 589 bytes (20 KB headers and URLs included) and answered larger ones
 * with this response, whereas Node's default cap is 16 KiB with a 431.
 */
const MAX_REQUEST_HEAD_BYTES = 127_589;

/** `http.createServer` with uvicorn's request-head limits and its answer to an oversized head. */
export function createUvicornLikeServer(listener: http.RequestListener): http.Server {
  const server = http.createServer({ maxHeaderSize: MAX_REQUEST_HEAD_BYTES }, listener);
  server.on("clientError", (err: NodeJS.ErrnoException, socket) => {
    if (!socket.writable || socket.destroyed) return;
    if (err.code === "HPE_HEADER_OVERFLOW") socket.end(H11_INVALID_REQUEST_RESPONSE);
    else socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  return server;
}
const H11_INVALID_REQUEST_RESPONSE =
  "HTTP/1.1 400 Bad Request\r\ncontent-type: text/plain; charset=utf-8\r\nconnection: close\r\n\r\nInvalid HTTP request received.";

/**
 * Listen on `host:port` and serve `app` until SIGINT/SIGTERM, like
 * `uvicorn.run`. A second signal forces an immediate exit.
 */
export async function serveMcpApp(app: McpHttpApp, options: ServeOptions): Promise<RunningServer> {
  const logLevel = options.log_level ?? "info";
  const infoEnabled = logLevel === "info" || logLevel === "debug" || logLevel === "trace";
  const colors = Boolean(process.stderr.isTTY);
  const prefix = (level: "INFO" | "ERROR"): string => {
    const tag = colors ? `\u001b[${level === "INFO" ? "32" : "31"}m${level}\u001b[0m:` : `${level}:`;
    return `${tag}${" ".repeat(Math.max(1, 10 - level.length - 1))}`;
  };
  const log = (message: string): void => {
    if (infoEnabled) process.stderr.write(`${prefix("INFO")}${message}\n`);
  };

  const server = createUvicornLikeServer((req, res) => {
    if (infoEnabled) {
      res.once("finish", () => {
        const client = `${req.socket.remoteAddress ?? "-"}:${req.socket.remotePort ?? 0}`;
        const status = res.statusCode;
        log(
          `${client} - "${req.method} ${req.url} HTTP/${req.httpVersion}" ${status} ${STATUS_PHRASES[status] ?? ""}`,
        );
      });
    }
    app.handler(req, res);
  });

  log(`Started server process [${process.pid}]`);
  log("Waiting for application startup.");
  log("Application startup complete.");

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const shownHost = address.family === "IPv6" ? `[${address.address}]` : address.address;
  log(`Uvicorn running on http://${shownHost}:${address.port} (Press CTRL+C to quit)`);
  options.onListening?.(address);

  let closing: Promise<void> | null = null;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const close = (): Promise<void> => {
    closing ??= (async () => {
      log("Shutting down");
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
      });
      log("Waiting for application shutdown.");
      await app.shutdown();
      log("Application shutdown complete.");
      log(`Finished server process [${process.pid}]`);
      resolveClosed();
    })();
    return closing;
  };

  if (options.handleSignals ?? true) {
    const onSignal = (): void => {
      if (closing !== null) {
        process.exit(1);
      }
      void close().then(() => {
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
      });
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  }

  return { server, address, close, closed };
}
