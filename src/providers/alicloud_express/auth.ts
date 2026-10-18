/** Express authentication: explicit sandbox API keys; control-plane AK/SK remains separate. */
import { InvalidAPIKeyError, InvalidCredentialsError, TokenExchangeError, TokenExpiredError } from "../../models/errors.js";
import { pyStrip } from "../../utils/_pyformat.js";
import { AKSK_ENV_SUGGESTION, CREDENTIAL_ENV_SUGGESTION } from "./credential_names.js";
import { getLogger } from "../../utils/logging.js";
import { ApiKeyAuth, PLATFORM_AUTH_HEADER, type AuthProvider } from "../../transport/auth_contract.js";
export { ApiKeyAuth, PLATFORM_AUTH_HEADER, type AuthProvider } from "../../transport/auth_contract.js";
export * from "../shared/e2b/auth.js";
const logger = getLogger("transport.auth");
export type ExchangeFunc = (access_key_id: string, access_key_secret: string) => Promise<string>;

/**
 * Legacy adapter for an explicitly configured custom exchange. Callers own its
 * endpoint, credential lifecycle and documented cache lifetime. No default
 * Alibaba token exchange or CreateApiKey operation is supplied.
 */
export class AkSkAuth implements AuthProvider {
  authenticationError(path: string): InvalidCredentialsError {
    return new InvalidCredentialsError(`The Platform API rejected the AK/SK credentials (HTTP 401) for ${path}.`);
  }
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

export { createAuthProvider as create_auth_provider };
