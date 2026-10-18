/**
 * Platform API protocol — sandbox lifecycle management (REST) (port of `protocol/sandbox.py`).
 *
 * All methods use standard HTTP REST with Authorization: Bearer authentication.
 * Endpoints are relative to the Platform API base URL.
 *
 * 路径无 /api/v1 前缀（已实测验证）。
 */

import type { TransportConfig } from "../../../transport/config.js";
import { EnvdTokenManager } from "./auth.js";
import { envdUrl } from "./url.js";
import { QuotaExceededError, SandboxCreationError, SandboxNotFoundError, TemplateNotFoundError } from "../../../models/errors.js";
import { SandboxConfig, SandboxInfo, SandboxStatus } from "../../../models/sandbox.js";
import { HTTPStatusError, type HttpClient } from "../../../transport/http.js";
import { dictGet, pyExcStr } from "../../../utils/_pyerrors.js";
import { getLogger } from "../../../utils/logging.js";

const logger = getLogger("protocol.sandbox");

export interface ListOptions {
  status?: SandboxStatus | null;
  limit?: number;
  offset?: number;
}

/** Typed wrapper for Platform API sandbox operations. */
export class SandboxProtocol {
  _http: HttpClient;
  /** A plugin provider speaks this wire format but is not the platform: an absent region/timeout stays "unknown" ("" and 0). */
  _unknownIfAbsent: boolean;

  constructor(http_client: HttpClient, opts: { unknownIfAbsent?: boolean } = {}) {
    this._http = http_client;
    this._unknownIfAbsent = opts.unknownIfAbsent ?? false;
  }

  resolveSessionUrl(info: SandboxInfo, config: TransportConfig): string {
    return info.envd_url || envdUrl(info.sandbox_id, config.domain);
  }

  /** Session authentication belongs to this explicitly selected wire adapter. */
  createSessionAuth(info: SandboxInfo): EnvdTokenManager {
    return new EnvdTokenManager(info.envd_access_token, info.sandbox_id);
  }

  _info(data: unknown): SandboxInfo {
    if (this._unknownIfAbsent && data !== null && typeof data === "object" && !Array.isArray(data)) {
      const d = { ...(data as Record<string, unknown>) };
      if (!("region" in d)) d["region"] = "";
      if (!("timeout" in d)) d["timeout"] = 0;
      return SandboxInfo.modelValidate(d);
    }
    // A response omission is not evidence that the service applied client defaults.
    if (data !== null && typeof data === "object" && !Array.isArray(data)) {
      const observed = { ...(data as Record<string, unknown>) };
      if (!("timeout" in observed)) observed.timeout = 0;
      if (!("region" in observed)) observed.region = "";
      return SandboxInfo.modelValidate(observed);
    }
    return SandboxInfo.modelValidate(data);
  }

  /** Request `/sandboxes/{id}{suffix}`; a 404 raises {@link SandboxNotFoundError}. */
  async _sandboxRequest(method: string, sandbox_id: string, suffix = "", init: { json?: Record<string, unknown> | null } = {}): Promise<Awaited<ReturnType<HttpClient["platformRequest"]>>> {
    try {
      return await this._http.platformRequest(method, `/sandboxes/${sandbox_id}${suffix}`, init);
    } catch (exc) {
      if (exc instanceof HTTPStatusError && exc.response.status_code === 404) {
        throw new SandboxNotFoundError(`Sandbox '${sandbox_id}' was not found.`);
      }
      throw exc;
    }
  }

  /**
   * Create a new sandbox.
   *
   * POST /sandboxes → 201（已实测验证）
   *
   * 请求体使用 camelCase: templateID, timeout, autoPause, metadata, envVars
   * 响应体使用 camelCase: sandboxID, templateID, envdAccessToken, envdVersion, clientID
   *
   * `request_timeout`: per-request HTTP timeout override in seconds for this single create call. When `null`, the
   * client-level default (`http_timeout` / `ABX_HTTP_TIMEOUT`) is used. This is independent of `config.timeout`
   * (the sandbox TTL).
   */
  async create(config: SandboxConfig, opts: { request_timeout?: number | null } = {}): Promise<SandboxInfo> {
    const request_timeout = opts.request_timeout ?? null;
    const payload = config.toCreatePayload();

    try {
      // 已实测验证：路径无 /api/v1 前缀
      const response = await this._http.platformRequest("POST", "/sandboxes", { json: payload, request_timeout });
      const data = response.json();
      return this._info(data);
    } catch (exc) {
      if (exc instanceof HTTPStatusError) {
        this._handleCreateError(exc);
      }
      throw exc;
    }
  }

  /**
   * List sandboxes (v1).
   *
   * GET /sandboxes → 200（已实测验证）
   */
  async list(opts: ListOptions = {}): Promise<SandboxInfo[]> {
    const { status = null, limit = 100, offset = 0 } = opts;
    const params: Record<string, unknown> = { limit, offset };
    if (status !== null) params["status"] = status;

    // 已实测验证：路径无 /api/v1 前缀
    const response = await this._http.platformRequest("GET", "/sandboxes", { params });
    const data = response.json();
    // API may return list directly or wrapped in a data field
    const items = Array.isArray(data) ? data : dictGet(data, "data", dictGet(data, "sandboxes", []));
    return (items as unknown[]).map((item) => this._info(item));
  }

  /**
   * List sandboxes (v2).
   *
   * GET /v2/sandboxes → 200（已实测验证）
   */
  async listV2(opts: ListOptions = {}): Promise<SandboxInfo[]> {
    const { status = null, limit = 100, offset = 0 } = opts;
    const params: Record<string, unknown> = { limit, offset };
    if (status !== null) params["status"] = status;

    const response = await this._http.platformRequest("GET", "/v2/sandboxes", { params });
    const data = response.json();
    const items = Array.isArray(data) ? data : dictGet(data, "data", dictGet(data, "sandboxes", []));
    return (items as unknown[]).map((item) => this._info(item));
  }

  /**
   * Get sandbox information.
   *
   * GET /sandboxes/{sandboxId} → 200（已实测验证）
   */
  async getInfo(sandbox_id: string): Promise<SandboxInfo> {
    const response = await this._sandboxRequest("GET", sandbox_id);
    const data = response.json();
    return this._info(data);
  }

  /**
   * Kill/destroy a sandbox.
   *
   * DELETE /sandboxes/{sandbox_id} → 204（已实测验证）
   */
  async kill(sandbox_id: string): Promise<void> {
    try {
      await this._http.platformRequest("DELETE", `/sandboxes/${sandbox_id}`);
    } catch (exc) {
      if (exc instanceof HTTPStatusError) {
        if (exc.response.status_code === 404) {
          logger.warning("Sandbox %s not found (already killed?)", sandbox_id);
          return;
        }
      }
      throw exc;
    }
  }

  /**
   * Update sandbox timeout.
   *
   * POST /sandboxes/{sandbox_id}/timeout → 204（已实测验证）
   */
  async setTimeout(sandbox_id: string, timeout: number): Promise<void> {
    // 已实测验证：POST（非 PUT）
    await this._sandboxRequest("POST", sandbox_id, "/timeout", { json: { timeout } });
  }

  /**
   * Connect to an existing sandbox (fetch current info).
   *
   * GET /sandboxes/{sandbox_id} → 200（已实测验证）
   */
  async connect(sandbox_id: string): Promise<SandboxInfo> {
    const response = await this._sandboxRequest("GET", sandbox_id);
    const data = response.json();
    return this._info(data);
  }

  /** Check if a sandbox is currently running. Calls getInfo and checks status. */
  async isRunning(sandbox_id: string): Promise<boolean> {
    try {
      const info = await this.getInfo(sandbox_id);
      return info.status === SandboxStatus.RUNNING;
    } catch {
      return false;
    }
  }

  /**
   * Pause a running sandbox.
   *
   * POST /sandboxes/{sandbox_id}/pause
   * 注意：REST 路径基于 E2B SDK 逆向推断，未经官方文档确认
   */
  async pause(sandbox_id: string): Promise<void> {
    await this._sandboxRequest("POST", sandbox_id, "/pause");
  }

  /**
   * Resume a paused sandbox.
   *
   * POST /sandboxes/{sandbox_id}/resume
   * 注意：REST 路径基于 E2B SDK 逆向推断，未经官方文档确认
   */
  async resume(sandbox_id: string): Promise<void> {
    await this._sandboxRequest("POST", sandbox_id, "/resume");
  }

  /** Convert HTTP errors to typed exceptions for create. */
  _handleCreateError(exc: HTTPStatusError): never {
    const status = exc.response.status_code;
    let body: Record<string, unknown>;
    try {
      body = exc.response.json() ?? {};
    } catch {
      body = {};
    }

    const message = dictGet(body, "message", pyExcStr(exc)) as string;

    if (status === 404) {
      throw new TemplateNotFoundError(message);
    } else if (status === 429) {
      throw new QuotaExceededError(message);
    } else if (status >= 400) {
      throw new SandboxCreationError(message);
    }
    throw exc;
  }
}
