/** Authentication for the shared E2B/envd wire adapter. No process credential lookup. */
import { TokenExpiredError } from "../../../models/errors.js";
import { getLogger } from "../../../utils/logging.js";
const logger = getLogger("providers.shared.e2b.auth");
// Header names（已实测验证）
export const PLATFORM_AUTH_HEADER = "Authorization"; // 已实测验证：Bearer token 认证
export const ENVD_AUTH_HEADER = "X-Access-Token";
export const ENVD_SANDBOX_ID_HEADER = "E2b-Sandbox-Id";
export const ENVD_SANDBOX_PORT_HEADER = "E2b-Sandbox-Port";
export const _ENVD_BASIC_AUTH = Buffer.from("user:", "latin1").toString("base64"); // 已实测验证

/**
 * Manages envdAccessToken for sandbox envd API requests.
 *
 * Each sandbox has its own envdAccessToken returned during creation.
 * envd 认证需要四个 header（已实测验证）：
 * - X-Access-Token: {envd_access_token}
 * - E2b-Sandbox-Id: {sandbox_id}
 * - E2b-Sandbox-Port: 49983
 * - Authorization: Basic {base64("user:")}
 */
export interface EnvdTokenOptions {
  /** Send envd requests without `X-Access-Token` (a backend that issues no envd token). */
  allow_missing?: boolean;
  /** User name in the Basic header; `user` unless the backend expects another account. */
  basic_user?: string;
}

export class EnvdTokenManager {
  _token: string | null;
  _sandbox_id: string | null;
  private readonly _allow_missing: boolean;
  private readonly _basic: string;

  constructor(token: string | null = null, sandbox_id: string | null = null, opts: EnvdTokenOptions = {}) {
    this._token = token;
    this._sandbox_id = sandbox_id;
    this._allow_missing = opts.allow_missing ?? false;
    const user = opts.basic_user || "user";
    this._basic = user === "user" ? _ENVD_BASIC_AUTH : Buffer.from(`${user}:`, "latin1").toString("base64");
  }

  get token(): string | null {
    return this._token;
  }

  get sandbox_id(): string | null {
    return this._sandbox_id;
  }

  /** Set the envd access token (from sandbox create response). */
  setToken(token: string, sandbox_id: string | null = null): void {
    this._token = token;
    if (sandbox_id !== null) {
      this._sandbox_id = sandbox_id;
    }
    logger.debug("envdAccessToken set for sandbox %s", this._sandbox_id);
  }

  /**
   * Return all envd auth headers (已实测验证).
   *
   * Returns dict with X-Access-Token, E2b-Sandbox-Id, E2b-Sandbox-Port,
   * and Authorization (Basic) headers.
   */
  getHeaders(): Record<string, string> {
    if (this._token === null && !this._allow_missing) {
      throw new TokenExpiredError("envdAccessToken not available. Sandbox may not be created or connected.", {
        suggestion: "Create or connect to a sandbox first.",
      });
    }
    const headers: Record<string, string> = { Authorization: `Basic ${this._basic}` };
    if (this._token !== null) headers[ENVD_AUTH_HEADER] = this._token;
    if (this._sandbox_id !== null) {
      headers[ENVD_SANDBOX_ID_HEADER] = this._sandbox_id;
    }
    headers[ENVD_SANDBOX_PORT_HEADER] = "49983";
    return headers;
  }

  /** Clear the cached token. */
  clear(): void {
    this._token = null;
    this._sandbox_id = null;
  }
}

/**
 * Build envd authentication headers from sandbox_id and envd_access_token (已实测验证).
 *
 * Returns dict with all required envd auth headers.
 */
export function buildEnvdHeaders(sandbox_id: string, envd_access_token: string): Record<string, string> {
  return {
    [ENVD_AUTH_HEADER]: envd_access_token,
    [ENVD_SANDBOX_ID_HEADER]: sandbox_id,
    [ENVD_SANDBOX_PORT_HEADER]: "49983",
    Authorization: `Basic ${_ENVD_BASIC_AUTH}`,
  };
}


export { buildEnvdHeaders as build_envd_headers };
