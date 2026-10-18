/**
 * Authentication providers for Platform API and Sandbox envd API.
 *
 * Sandbox requests use an explicitly configured API key as an Authorization Bearer.
 * AK/SK belongs to official control-plane APIs. AkSkAuth is an explicit custom
 * exchange adapter; no default credential-resource creation occurs.
 *
 * After sandbox creation, envd API uses envdAccessToken from create response,
 * sent via multiple headers (X-Access-Token, E2b-Sandbox-Id, etc. 已实测验证).
 */

import {
  InvalidAPIKeyError,
  InvalidCredentialsError,
  TokenExchangeError,
  TokenExpiredError,
} from "../models/errors.js";
import { pyStrip } from "../utils/_pyformat.js";
import { AKSK_ENV_SUGGESTION, CREDENTIAL_ENV_SUGGESTION } from "../utils/credential_names.js";
import { getLogger } from "../utils/logging.js";

const logger = getLogger("transport.auth");

// Header names（已实测验证）
export const PLATFORM_AUTH_HEADER = "Authorization"; // 已实测验证：Bearer token 认证
export const ENVD_AUTH_HEADER = "X-Access-Token";
export const ENVD_SANDBOX_ID_HEADER = "E2b-Sandbox-Id";
export const ENVD_SANDBOX_PORT_HEADER = "E2b-Sandbox-Port";
export const _ENVD_BASIC_AUTH = Buffer.from("user:", "latin1").toString("base64"); // 已实测验证

/** Protocol for authentication providers. */
export interface AuthProvider {
  /** Return authentication headers for Platform API requests. */
  getHeaders(): Promise<Record<string, string>>;
  /** Force refresh credentials if applicable. */
  refresh(): Promise<void>;
}

/**
 * API Key authentication for Platform API.
 *
 * Uses ABX_SANDBOX_API_KEY environment variable or explicit api_key parameter.
 * Sends an Authorization Bearer header on Platform API requests.
 */
export class ApiKeyAuth implements AuthProvider {
  _api_key: string;

  constructor(api_key: string) {
    if (!api_key || !pyStrip(api_key)) {
      throw new InvalidAPIKeyError("API key cannot be empty");
    }
    this._api_key = pyStrip(api_key);
  }

  /** Return Authorization: Bearer header (已实测验证). */
  async getHeaders(): Promise<Record<string, string>> {
    return { [PLATFORM_AUTH_HEADER]: `Bearer ${this._api_key}` };
  }

  /** No-op for API key auth. */
  async refresh(): Promise<void> {
    /* nothing to do */
  }
}

export type ExchangeFunc = (access_key_id: string, access_key_secret: string) => Promise<string>;

/**
 * Legacy adapter for an explicitly configured custom exchange. Callers own its
 * endpoint, credential lifecycle and documented cache lifetime. No default
 * Alibaba token exchange or CreateApiKey operation is supplied.
 */
export class AkSkAuth implements AuthProvider {
  static TOKEN_TTL = 3600; // Legacy custom cache policy, not a platform TTL.
  static REFRESH_BEFORE_EXPIRY = 300;

  _ak: string;
  _sk: string;
  _cached_token: string | null = null;
  _token_expires_at = 0.0;
  _exchange_func: ExchangeFunc | null = null; // Set by transport layer

  constructor(access_key_id: string, access_key_secret: string) {
    if (!access_key_id || !access_key_secret) {
      throw new InvalidCredentialsError("AccessKey ID and Secret cannot be empty", {
        suggestion: AKSK_ENV_SUGGESTION,
      });
    }
    this._ak = pyStrip(access_key_id);
    this._sk = pyStrip(access_key_secret);
  }

  /** Check if cached token is still valid (with refresh buffer). */
  _isTokenValid(): boolean {
    if (this._cached_token === null) return false;
    return Date.now() / 1000 < this._token_expires_at - AkSkAuth.REFRESH_BEFORE_EXPIRY;
  }

  /**
   * Exchange AK/SK for a temporary API key.
   *
   * The caller supplies the exchange implementation and owns its lifecycle.
   */
  async _exchangeToken(): Promise<string> {
    if (this._exchange_func === null) {
      throw new InvalidCredentialsError(
        "Token exchange function not configured. " +
          "Set an explicit custom callback with setExchangeFunc(), or use ApiKeyAuth.",
      );
    }
    const token = await this._exchange_func(this._ak, this._sk);
    if (typeof token !== "string" || !pyStrip(token)) {
      throw new TokenExchangeError("Custom token exchange must return a non-empty token string.", {
        suggestion: "Check the custom exchange contract and token lifetime.",
      });
    }
    this._cached_token = pyStrip(token);
    this._token_expires_at = Date.now() / 1000 + AkSkAuth.TOKEN_TTL;
    logger.debug("AK/SK token exchanged, expires at %.0f", this._token_expires_at);
    return this._cached_token;
  }

  /** Return Authorization: Bearer header with exchanged token. */
  async getHeaders(): Promise<Record<string, string>> {
    if (!this._isTokenValid()) {
      await this._exchangeToken();
    }
    if (this._cached_token === null) {
      throw new TokenExpiredError("Failed to obtain API token via AK/SK exchange");
    }
    return { [PLATFORM_AUTH_HEADER]: `Bearer ${this._cached_token}` };
  }

  /** Force refresh the exchanged token. */
  async refresh(): Promise<void> {
    if (this._exchange_func === null) {
      throw new InvalidCredentialsError("AK/SK token exchange function not configured.", {
        suggestion: "Set an explicit custom callback with setExchangeFunc(), or configure ABX_SANDBOX_API_KEY.",
      });
    }
    this._cached_token = null;
    this._token_expires_at = 0.0;
    await this._exchangeToken();
  }

  /** Set the token exchange function (called by transport layer). */
  setExchangeFunc(func: ExchangeFunc | null): void {
    this._exchange_func = func;
  }
}

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

export interface CreateAuthProviderOptions {
  api_key?: string | null;
  access_key_id?: string | null;
  access_key_secret?: string | null;
  region?: string;
}

/**
 * Create API-key authentication for sandbox requests. Legacy AK/SK/region option
 * names remain accepted but do not select an automatic credential-creation route.
 */
export function createAuthProvider(opts: CreateAuthProviderOptions = {}): AuthProvider {
  const { api_key = null, access_key_id = null, access_key_secret = null } = opts;
  if (api_key) {
    logger.debug("Using API Key authentication");
    return new ApiKeyAuth(api_key);
  }

  const sandbox_key = process.env["ABX_SANDBOX_API_KEY"];
  if (sandbox_key) {
    logger.debug("Using API Key authentication (via ABX_SANDBOX_API_KEY)");
    return new ApiKeyAuth(sandbox_key);
  }

  if (access_key_id && access_key_secret) {
    throw new InvalidAPIKeyError("A sandbox API Key is required; AK/SK credentials are for control-plane operations.", {
      suggestion: "Configure ABX_SANDBOX_API_KEY or pass api_key explicitly.",
    });
  }

  throw new InvalidAPIKeyError("No authentication credentials provided", {
    suggestion: CREDENTIAL_ENV_SUGGESTION,
  });
}

// snake_case aliases for the Python-named public functions (the Python module exports these names).
export {
  buildEnvdHeaders as build_envd_headers,
  createAuthProvider as create_auth_provider,
};
