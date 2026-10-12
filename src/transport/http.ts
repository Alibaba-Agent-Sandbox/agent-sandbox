/**
 * Async HTTP client for Platform API and sandbox envd API.
 *
 * Uses an httpx-compatible AsyncClient with HTTP/2 support. A long-lived client is kept for the Platform API; envd
 * clients are created on demand per sandbox URL.
 *
 * envd URL 格式: https://49983-{sandbox_id}.{domain}（已实测验证）
 */

import { ConnectionError_, EnvdRpcError, InvalidAPIKeyError, InvalidCredentialsError } from "../models/errors.js";
import { pyStrip, pyTruncate } from "../utils/_pyformat.js";
import { getLogger } from "../utils/logging.js";
import { type AsyncClient, ConnectError, ConnectTimeout, HTTPStatusError, httpx, type RequestOptions, type Response } from "./_httpx.js";
import { AkSkAuth, type AuthProvider, type EnvdTokenManager } from "./auth.js";
import { CONNECT_CONTENT_TYPE, ConnectCodec, EnvelopeStreamParser } from "./codec.js";
import type { TransportConfig } from "./config.js";

// The httpx exception classes are part of this module's public surface: protocol/api code catches
// `HTTPStatusError` / `RequestError` / `ConnectError` ... through `transport/http`.
export {
  CloseError,
  ConnectError,
  ConnectTimeout,
  DecodingError,
  HTTPError,
  HTTPStatusError,
  LocalProtocolError,
  NetworkError,
  PoolTimeout,
  ProtocolError,
  ProxyError,
  ReadError,
  ReadTimeout,
  RemoteProtocolError,
  RequestError,
  TimeoutException,
  TooManyRedirects,
  TransportError,
  UnsupportedProtocol,
  WriteError,
  WriteTimeout,
  httpx,
  AsyncClient,
  Headers,
  Limits,
  MockTransport,
  Request,
  Response,
  Timeout,
} from "./_httpx.js";

const logger = getLogger("transport.http");

// Upper bound on bytes read from an envd error response body (defensive —
// an error body is diagnostic text, not data; avoid buffering anything huge).
export const _MAX_ERROR_BODY_BYTES = 8192;

// How much of the error body is kept in the exception / logs.
export const _ERROR_BODY_TEXT_LIMIT = 500;

function isDict(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Extract a human-readable detail string from an envd JSON error body.
 *
 * Covers the shapes observed from envd / Connect implementations:
 * `{"error": {"code": ..., "message": ...}}`, `{"error": "text"}`, and flat `{"code": ..., "message": ...}` /
 * `{"message": ...}`. Returns `""` when nothing readable is found.
 */
export function _envdErrorDetail(envd_error: Record<string, unknown> | null | undefined): string {
  if (!isDict(envd_error)) return "";
  const err = envd_error["error"];
  if (isDict(err)) {
    for (const key of ["message", "msg", "detail", "code"]) {
      const val = err[key];
      if (typeof val === "string" && val) return val;
    }
  } else if (typeof err === "string") {
    return err;
  }
  for (const key of ["message", "msg", "detail", "code"]) {
    const val = envd_error[key];
    if (typeof val === "string" && val) return val;
  }
  return "";
}

/** Build an {@link EnvdRpcError} from an envd error response body (no sandbox URL in it). */
export function _buildEnvdRpcError(raw: Uint8Array, status_code: number, rpc_path: string, decode: (raw: Buffer) => unknown): EnvdRpcError {
  const bounded = Buffer.from(raw.subarray(0, _MAX_ERROR_BODY_BYTES));
  const body_text = pyTruncate(bounded.toString("utf-8"), _ERROR_BODY_TEXT_LIMIT);

  let envd_error: Record<string, unknown> | null = null;
  if (bounded.length) {
    let parsed: unknown;
    try {
      parsed = decode(bounded);
    } catch {
      parsed = null;
    }
    if (isDict(parsed)) envd_error = parsed;
  }

  const detail = _envdErrorDetail(envd_error) || pyStrip(body_text);
  let message = `envd RPC ${rpc_path} failed (HTTP ${status_code})`;
  if (detail) message = `${message}: ${detail}`;
  return new EnvdRpcError(message, { status_code, rpc_path, envd_error, body_text });
}

/**
 * Convert the `HTTPStatusError` of a unary envd call into an {@link EnvdRpcError} (KI-004).
 *
 * Same shape as the error raised for streaming calls: the message carries the RPC path, the HTTP status and the envd
 * detail (e.g. `process not found`), never the sandbox URL.
 */
export function envdStatusError(exc: HTTPStatusError, rpc_path: string): EnvdRpcError {
  return _buildEnvdRpcError(exc.response.content, exc.response.status_code, rpc_path, (raw) => new ConnectCodec().decodeResponse(raw));
}

export interface PlatformRequestOptions {
  json?: Record<string, unknown> | null;
  params?: Record<string, unknown> | null;
  headers?: Record<string, string> | null;
  request_timeout?: number | null;
}

export interface EnvdRequestOptions {
  payload?: Record<string, unknown> | null;
  envd_token: EnvdTokenManager;
  headers?: Record<string, string> | null;
  request_timeout?: number | null;
}

export interface EnvdHttpRequestOptions {
  envd_token: EnvdTokenManager;
  params?: Record<string, string> | null;
  headers?: Record<string, string> | null;
  content?: Uint8Array | string | null;
  files?: Record<string, any> | null;
}

/**
 * Async HTTP client for Platform API and envd API.
 *
 * A single long-lived client is used for the Platform API. Envd clients are created on demand (different sandboxes
 * may have different base URLs) and tracked for proper cleanup.
 */
export class HttpClient {
  _config: TransportConfig;
  _auth: AuthProvider;
  _codec: ConnectCodec;
  _platform_client: AsyncClient | null = null;
  _envd_clients: Map<string, AsyncClient> = new Map();

  constructor(config: TransportConfig, auth: AuthProvider) {
    this._config = config;
    this._auth = auth;
    this._codec = new ConnectCodec();
  }

  /** Get or create the Platform API client. */
  async _getPlatformClient(): Promise<AsyncClient> {
    if (this._platform_client === null || this._platform_client.is_closed) {
      this._platform_client = new httpx.AsyncClient({
        base_url: this._config.api_url,
        http2: this._config.http2,
        timeout: new httpx.Timeout(this._config.http_timeout),
        limits: new httpx.Limits({
          max_connections: this._config.max_connections,
          max_keepalive_connections: this._config.max_keepalive_connections,
          keepalive_expiry: this._config.keepalive_expiry,
        }),
      });
    }
    return this._platform_client;
  }

  /** Create (or reuse a cached) envd API client for a sandbox URL. */
  _createEnvdClient(envd_url: string): AsyncClient {
    const existing = this._envd_clients.get(envd_url);
    if (existing !== undefined && !existing.is_closed) {
      return existing;
    }
    const client = new httpx.AsyncClient({
      base_url: envd_url,
      http2: this._config.http2,
      timeout: new httpx.Timeout(this._config.http_timeout),
    });
    this._envd_clients.set(envd_url, client);
    return client;
  }

  /**
   * Send a request to the Platform API (REST).
   *
   * Automatically injects authentication headers.
   *
   * `request_timeout`: Per-request timeout override in seconds. When provided, overrides the client-level default
   * `http_timeout` for this single request. When null/undefined, the client-level default is used unchanged.
   */
  async platformRequest(method: string, path: string, opts: PlatformRequestOptions = {}): Promise<Response> {
    const { json = null, params = null, headers = null, request_timeout = null } = opts;
    const client = await this._getPlatformClient();
    const auth_headers = await this._auth.getHeaders();

    const all_headers: Record<string, string> = { ...auth_headers };
    if (headers) Object.assign(all_headers, headers);

    // Build optional per-request timeout override (mirrors envd_request).
    const extra_kwargs: Pick<RequestOptions, "timeout"> = {};
    if (request_timeout !== null && request_timeout !== undefined) {
      extra_kwargs.timeout = new httpx.Timeout(request_timeout);
    }

    logger.debug("Platform %s %s", method, path);
    try {
      const response = await client.request(method, path, {
        json,
        params: params as RequestOptions["params"],
        headers: all_headers,
        ...extra_kwargs,
      });
      response.raiseForStatus();
      return response;
    } catch (exc) {
      if (exc instanceof ConnectError) {
        throw new ConnectionError_(`Failed to connect to Platform API: ${exc}`, {
          suggestion: "Check network connectivity and API base URL.",
        });
      }
      if (exc instanceof HTTPStatusError && exc.response.status_code === 401) {
        throw this._authenticationError(path);
      }
      // httpx.HTTPStatusError: let higher layers handle the other HTTP errors
      throw exc;
    }
  }

  /** The SDK error for a Platform API 401 (KI-006; the text never includes the key or the base URL). */
  _authenticationError(path: string): InvalidAPIKeyError | InvalidCredentialsError {
    if (this._auth instanceof AkSkAuth) {
      return new InvalidCredentialsError(`The Platform API rejected the AK/SK credentials (HTTP 401) for ${path}.`);
    }
    return new InvalidAPIKeyError(
      `The Platform API rejected the API key (HTTP 401) for ${path}: it is invalid, revoked or for another region.`,
    );
  }

  /**
   * Send a Connect RPC request to the envd API.
   *
   * `request_timeout`: Per-request timeout override in seconds. When provided, overrides the default `http_timeout`
   * from TransportConfig for this single request. When null/undefined, the client-level default is used.
   *
   * Returns the decoded response dict.
   */
  async envdRequest(envd_url: string, rpc_path: string, opts: EnvdRequestOptions): Promise<Record<string, any>> {
    const { payload = null, envd_token, headers = null, request_timeout = null } = opts;
    const client = this._createEnvdClient(envd_url);
    const auth_headers = envd_token.getHeaders();

    const all_headers: Record<string, string> = {
      "Content-Type": CONNECT_CONTENT_TYPE,
      ...auth_headers,
    };
    if (headers) Object.assign(all_headers, headers);

    const body = this._codec.encodeRequest(payload || {});

    // Build optional per-request timeout override
    const extra_kwargs: Pick<RequestOptions, "timeout"> = {};
    if (request_timeout !== null && request_timeout !== undefined) {
      extra_kwargs.timeout = new httpx.Timeout(request_timeout);
    }

    logger.debug("envd POST %s%s", envd_url, rpc_path);
    try {
      const response = await client.post(rpc_path, {
        content: body,
        headers: all_headers,
        ...extra_kwargs,
      });
      response.raiseForStatus();
      return this._codec.decodeResponse(response.content);
    } catch (exc) {
      if (exc instanceof ConnectError) {
        throw new ConnectionError_(`Failed to connect to sandbox envd: ${exc}`, {
          suggestion: "Check if the sandbox is still running.",
        });
      }
      throw exc;
    }
  }

  /**
   * Build and raise an EnvdRpcError from an envd error response.
   *
   * Reads a *bounded* slice of the error body, parses it as JSON when possible (structured propagation for upper
   * layers), and logs the details at DEBUG level only — never a default WARNING, and never with the full sandbox URL
   * (which embeds the sandbox ID).  The RPC path (e.g. `/process.Process/Start`) is not sensitive and is kept for
   * diagnostics.  Task 166.
   */
  async _raiseEnvdRpcError(response: Response, rpc_path: string): Promise<never> {
    let raw: Buffer = Buffer.alloc(0);
    for await (const chunk of response.aiterBytes()) {
      raw = Buffer.concat([raw, chunk]);
      if (raw.length >= _MAX_ERROR_BODY_BYTES) {
        raw = raw.subarray(0, _MAX_ERROR_BODY_BYTES);
        break;
      }
    }
    const error = _buildEnvdRpcError(raw, response.status_code, rpc_path, (b) => this._codec.decodeResponse(b));
    logger.debug("envd STREAM %s failed (HTTP %s): %s", rpc_path, response.status_code, error.body_text);
    throw error;
  }

  /**
   * Send a Connect RPC streaming request to the envd API.
   *
   * Returns an async iterator of decoded response frames. Connect streaming uses binary envelope framing
   * (已实测验证): flags (1 byte) + length (4 bytes big-endian) + JSON payload.
   *
   * The response is consumed incrementally so frames are yielded as soon as they arrive (server-side per-line output
   * is visible line by line). The full response body is never buffered — only a single in-flight frame is held in
   * memory.
   *
   * NOTE: A fresh client is used for each streaming call to avoid HTTP/2 connection-state issues observed with
   * connection reuse on some envd versions (cached connections that served earlier unary RPCs can return spurious
   * 500 errors on subsequent streaming calls).
   *
   * Resource cleanup: both the streaming response and the client are closed on normal completion, on errors, and
   * when the consumer stops iterating early (`return()` on the async generator).
   *
   * Error responses (HTTP >= 400) raise EnvdRpcError — a structured SandboxError carrying the parsed envd JSON error
   * body, the status code and the RPC path.
   *
   * `request_timeout`: Per-request timeout override in seconds. When null/undefined, `config.http_timeout` is used.
   */
  async *envdStream(envd_url: string, rpc_path: string, opts: EnvdRequestOptions): AsyncGenerator<Record<string, any>> {
    const { payload = null, envd_token, headers = null, request_timeout = null } = opts;
    const auth_headers = envd_token.getHeaders();

    const all_headers: Record<string, string> = {
      "Content-Type": CONNECT_CONTENT_TYPE,
      ...auth_headers,
    };
    if (headers) Object.assign(all_headers, headers);

    const body = this._codec.encodeRequest(payload || {});
    const effective_timeout =
      request_timeout !== null && request_timeout !== undefined ? request_timeout : this._config.http_timeout;

    logger.debug("envd STREAM %s%s (timeout=%.1fs)", envd_url, rpc_path, effective_timeout);
    let client: AsyncClient | null = null;
    let streamCm: { __aenter__(): Promise<Response>; __aexit__(): Promise<void> } | null = null;
    let entered = false;
    try {
      // Use a fresh client per streaming call (see NOTE above) and a true streaming request so frames are decoded
      // incrementally as network chunks arrive.
      client = new httpx.AsyncClient({
        http2: this._config.http2,
        timeout: new httpx.Timeout(effective_timeout),
      });
      const url = envd_url.replace(/\/+$/, "") + rpc_path;
      streamCm = client.stream("POST", url, { content: body, headers: all_headers });
      const response = await streamCm.__aenter__();
      entered = true;
      if (response.status_code >= 400) {
        // Structured error propagation instead of httpx's raise_for_status (whose message embeds the full sandbox
        // URL and an MDN status link).
        await this._raiseEnvdRpcError(response, rpc_path);
      }

      const parser = new EnvelopeStreamParser();
      for await (const chunk of response.aiterBytes()) {
        for (const frame of parser.feed(chunk)) {
          yield frame;
        }
      }

      if (parser.pendingBytes()) {
        logger.warning(
          "envd STREAM %s ended with %d truncated byte(s); incomplete final frame dropped",
          rpc_path,
          parser.pendingBytes(),
        );
      }
    } catch (exc) {
      // `httpx.Timeout(<= 0)` is already expired: httpcore's connect deadline fires before any bytes are sent, as
      // `ConnectTimeout`. That class is not a `ConnectError` subclass, and the Python client only remaps `ConnectError`
      // here, so the MCP tool result stays `{"error": "ConnectTimeout"}` (AT-12). A `ConnectTimeout` raised while a
      // positive timeout is in force is still a failed connect (KI-003).
      if (exc instanceof ConnectTimeout && effective_timeout <= 0) throw exc;
      if (exc instanceof ConnectError || exc instanceof ConnectTimeout) {
        throw new ConnectionError_(`Failed to connect to sandbox envd for streaming: ${exc}`, {
          suggestion: "Check if the sandbox is still running.",
        });
      }
      throw exc;
    } finally {
      try {
        if (streamCm !== null && entered) await streamCm.__aexit__();
      } finally {
        if (client !== null) await client.__aexit__();
      }
    }
  }

  /**
   * Send a plain HTTP request (not Connect RPC) to the envd API.
   *
   * Used for file upload/download which use standard HTTP rather than Connect protocol (已实测验证).
   */
  async envdHttpRequest(envd_url: string, method: string, path: string, opts: EnvdHttpRequestOptions): Promise<Response> {
    const { envd_token, params = null, headers = null, content = null, files = null } = opts;
    const client = this._createEnvdClient(envd_url);
    const auth_headers = envd_token.getHeaders();

    const all_headers: Record<string, string> = { ...auth_headers };
    if (headers) Object.assign(all_headers, headers);

    logger.debug("envd HTTP %s %s%s", method, envd_url, path);
    try {
      const response = await client.request(method, path, {
        params,
        headers: all_headers,
        content,
        files,
      });
      response.raiseForStatus();
      return response;
    } catch (exc) {
      if (exc instanceof ConnectError) {
        throw new ConnectionError_(`Failed to connect to sandbox envd: ${exc}`, {
          suggestion: "Check if the sandbox is still running.",
        });
      }
      throw exc;
    }
  }

  /** Close all HTTP clients and release connections. */
  async close(): Promise<void> {
    if (this._platform_client && !this._platform_client.is_closed) {
      await this._platform_client.aclose();
      this._platform_client = null;
    }

    for (const client of [...this._envd_clients.values()]) {
      if (!client.is_closed) {
        await client.aclose();
      }
    }
    this._envd_clients.clear();
    logger.debug("All HTTP clients closed");
  }

  async __aenter__(): Promise<HttpClient> {
    return this;
  }

  async __aexit__(..._args: unknown[]): Promise<void> {
    await this.close();
  }
}

// snake_case aliases for the Python-named module members
export { _envdErrorDetail as _envd_error_detail };
