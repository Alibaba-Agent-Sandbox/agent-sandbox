/**
 * Authentication providers for Platform API and Sandbox envd API.
 *
 * Two authentication modes:
 * 1. API Key: ABX_SANDBOX_API_KEY -> Authorization: Bearer {api_key} header (Platform API, 已实测验证)
 * 2. AK/SK: Exchange for temporary API key (TTL=3600s, auto-refresh 5min before expiry)
 *
 * After sandbox creation, envd API uses envdAccessToken from create response,
 * sent via multiple headers (X-Access-Token, E2b-Sandbox-Id, etc. 已实测验证).
 */

import { createHmac, randomUUID } from "node:crypto";
import {
  InvalidAPIKeyError,
  InvalidCredentialsError,
  TokenExchangeError,
  TokenExpiredError,
} from "../../models/errors.js";
import { PyFloat, pyRepr, pyStrip, pyTruncate } from "../../utils/_pyformat.js";
import { AKSK_ENV_SUGGESTION, CREDENTIAL_ENV_SUGGESTION } from "./credential_names.js";
import { getLogger } from "../../utils/logging.js";
import { asyncWith, ConnectError, httpx, TimeoutException } from "../../transport/_httpx.js";

const logger = getLogger("transport.auth");

import { ApiKeyAuth, PLATFORM_AUTH_HEADER, type AuthProvider } from "../../transport/auth_contract.js";
export { ApiKeyAuth, PLATFORM_AUTH_HEADER, type AuthProvider } from "../../transport/auth_contract.js";
export * from "../shared/e2b/auth.js";

export type ExchangeFunc = (access_key_id: string, access_key_secret: string) => Promise<string>;

/**
 * AK/SK authentication — exchanges AccessKey for temporary API key.
 *
 * Uses ALICLOUD_ACCESS_KEY_ID and ALICLOUD_ACCESS_KEY_SECRET.
 * Exchanges for a temporary token with TTL=3600s.
 * Auto-refreshes 5 minutes (300s) before expiry.
 * Token is cached in memory only (never persisted to disk).
 */
export class AkSkAuth implements AuthProvider {
  authenticationError(path: string): InvalidCredentialsError {
    return new InvalidCredentialsError(`The Platform API rejected the AK/SK credentials (HTTP 401) for ${path}.`);
  }

  static TOKEN_TTL = 3600; // 1 hour  // 假设值，官方文档未给出 token 交换参数，需实测验证
  static REFRESH_BEFORE_EXPIRY = 300; // 5 minutes  // 假设值，官方文档未给出 token 交换参数，需实测验证

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
   * This calls the Alibaba Cloud STS-like endpoint to get a temporary token.
   * The actual HTTP call is delegated to the exchange function set by the transport layer.
   */
  async _exchangeToken(): Promise<string> {
    if (this._exchange_func === null) {
      throw new InvalidCredentialsError(
        "Token exchange function not configured. " +
          "AK/SK auth requires the transport layer to be initialized first.",
      );
    }
    const token = await this._exchange_func(this._ak, this._sk);
    this._cached_token = token;
    this._token_expires_at = Date.now() / 1000 + AkSkAuth.TOKEN_TTL;
    logger.debug("AK/SK token exchanged, expires at %.0f", this._token_expires_at);
    return String(token);
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
      throw new InvalidCredentialsError(
        "AK/SK token exchange function not configured. " +
          "Use create_auth_provider() to get a properly initialised AkSkAuth.",
        {
          suggestion:
            "Call create_auth_provider(access_key_id=..., access_key_secret=...) " +
            "instead of constructing AkSkAuth directly, or set the exchange " +
            "function via set_exchange_func().",
        },
      );
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

// ── Alibaba Cloud API signing helpers ──────────────────────────────────────
// Minimal subset needed for token exchange.  These mirror the helpers in
// api/docker_builder.py but are duplicated here to respect the layer
// constraint (L1 transport must not import L3 api).

/** RFC 3986 percent-encoding (Alibaba Cloud signature convention). */
export function _percentEncode(s: string): string {
  let out = "";
  for (const b of Buffer.from(s, "utf-8")) {
    const ch = String.fromCharCode(b);
    if (b < 128 && /[A-Za-z0-9_.\-~]/.test(ch)) out += ch;
    else out += `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/** Compute Alibaba Cloud RPC (POP) V1 HMAC-SHA1 signature. */
export function _signRpc(params: Record<string, string>, secret: string, method = "GET"): string {
  const sortedParams = Object.entries(params).sort((a, b) => {
    const ka = Buffer.from(a[0], "utf-8");
    const kb = Buffer.from(b[0], "utf-8");
    const c = Buffer.compare(ka, kb);
    if (c !== 0) return c;
    return Buffer.compare(Buffer.from(a[1], "utf-8"), Buffer.from(b[1], "utf-8"));
  });
  const canonical = sortedParams.map(([k, v]) => `${_percentEncode(k)}=${_percentEncode(v)}`).join("&");
  const sts = `${method}&${_percentEncode("/")}&${_percentEncode(canonical)}`;
  const key = Buffer.from(secret + "&", "utf-8");
  return createHmac("sha1", key).update(Buffer.from(sts, "utf-8")).digest("base64");
}

// ── Token exchange endpoint ────────────────────────────────────────────────
// TODO(fcsandbox-api): The actual FCSandbox OpenAPI action for exchanging
// AK/SK to a temporary Platform API key has NOT been confirmed with the
// FC Agent Sandbox team.  Replace _TOKEN_EXCHANGE_ACTION and the
// response-parsing logic when the real endpoint is documented.
export const _TOKEN_EXCHANGE_ACTION = "CreateApiKey"; // TODO: confirm actual action name
export const _TOKEN_EXCHANGE_API_VERSION = "2026-05-09"; // matches alibabacloud-fcsandbox SDK

function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

function pyOr(...values: unknown[]): unknown {
  let last: unknown = null;
  for (const v of values) {
    last = v;
    if (truthy(v)) return v;
  }
  return last;
}

function dictGetStrict(d: unknown, key: string): unknown {
  if (d === null || typeof d !== "object" || Array.isArray(d) || d instanceof PyFloat) {
    const tn =
      d === null
        ? "NoneType"
        : Array.isArray(d)
          ? "list"
          : typeof d === "string"
            ? "str"
            : d instanceof PyFloat
              ? "float"
              : typeof d === "bigint"
                ? "int"
                : typeof d === "number"
                  ? Number.isInteger(d)
                    ? "int"
                    : "float"
                  : typeof d === "boolean"
                    ? "bool"
                    : "object";
    throw new TypeError(`'${tn}' object has no attribute 'get'`);
  }
  const v = (d as Record<string, unknown>)[key];
  return Object.prototype.hasOwnProperty.call(d, key) ? v : null;
}

/**
 * Exchange Alibaba Cloud AK/SK for a temporary FCSandbox Platform API key.
 *
 * Uses Alibaba Cloud RPC (POP) V1 HMAC-SHA1 signing to call the FCSandbox
 * API, similar to how docker_builder.get_acr_auth_token exchanges
 * AK/SK for temporary ACR credentials.
 *
 * Raises TokenExchangeError if the exchange fails.
 */
export async function _exchangeAkskForApiKey(
  access_key_id: string,
  access_key_secret: string,
  opts: { region?: string } = {},
): Promise<string> {
  const region = opts.region ?? "cn-hangzhou";
  const endpoint = `https://fcsandbox.${region}.aliyuncs.com`;
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const params: Record<string, string> = {
    Action: _TOKEN_EXCHANGE_ACTION,
    Format: "JSON",
    Version: _TOKEN_EXCHANGE_API_VERSION,
    AccessKeyId: access_key_id,
    SignatureMethod: "HMAC-SHA1",
    Timestamp: ts,
    SignatureVersion: "1.0",
    SignatureNonce: randomUUID(),
  };
  params["Signature"] = _signRpc(params, access_key_secret);

  logger.info("Exchanging AK/SK for Platform API key (region=%s, action=%s)", region, _TOKEN_EXCHANGE_ACTION);

  let resp: InstanceType<typeof httpx.Response>;
  try {
    resp = await asyncWith(new httpx.AsyncClient({ timeout: new httpx.Timeout(15.0) }), async (client) => {
      return client.get(endpoint, { params });
    });
  } catch (exc) {
    if (exc instanceof ConnectError) {
      throw new TokenExchangeError(`Failed to connect to FCSandbox API for token exchange: ${exc}`, {
        suggestion:
          "Check network connectivity to fcsandbox." +
          `${region}.aliyuncs.com. ` +
          "Or use ABX_SANDBOX_API_KEY directly.",
      });
    }
    if (exc instanceof TimeoutException) {
      throw new TokenExchangeError(`Token exchange request timed out: ${exc}`, {
        suggestion: "Check network connectivity or try again later.",
      });
    }
    throw exc;
  }

  if (resp.status_code !== 200) {
    const body_text = pyTruncate(resp.text, 500);
    logger.warning("Token exchange failed (HTTP %s): %s", resp.status_code, body_text);
    throw new TokenExchangeError(`Token exchange failed (HTTP ${resp.status_code}): ${body_text}`, {
      suggestion: "Verify AK/SK credentials have FCSandbox API access. Or use ABX_SANDBOX_API_KEY directly.",
    });
  }

  let data: unknown;
  try {
    data = resp.json();
  } catch {
    throw new TokenExchangeError(`Invalid JSON response from token exchange: ${pyTruncate(resp.text, 200)}`);
  }

  // TODO(fcsandbox-api): Adjust response field names to match the actual API response when confirmed.
  const api_key = pyOr(
    dictGetStrict(data, "ApiKey"),
    dictGetStrict(data, "apiKey"),
    dictGetStrict(pyOr(dictGetStrict(data, "Data"), {}), "ApiKey"),
    dictGetStrict(pyOr(dictGetStrict(data, "data"), {}), "apiKey"),
  );

  if (!truthy(api_key)) {
    throw new TokenExchangeError(
      `Token exchange response did not contain an API key: ${pyRepr(Object.keys(data as object))}`,
      {
        suggestion:
          "The FCSandbox token exchange API response format may have changed. " +
          "Use ABX_SANDBOX_API_KEY directly as a workaround.",
      },
    );
  }

  logger.debug("AK/SK token exchange succeeded (region=%s)", region);
  return String(api_key);
}

export interface CreateAuthProviderOptions {
  api_key?: string | null;
  access_key_id?: string | null;
  access_key_secret?: string | null;
  region?: string;
}

/**
 * Create the appropriate auth provider based on available credentials.
 *
 * Priority: api_key > ABX_SANDBOX_API_KEY (fallback) > AK/SK
 *
 * When the AK/SK path is selected, a token exchange function is
 * automatically injected into the AkSkAuth instance so that
 * credentials are exchanged for a temporary Platform API key on first
 * use (and auto-refreshed before expiry).
 *
 * Raises InvalidAPIKeyError if no credentials provided.
 */
export function createAuthProvider(opts: CreateAuthProviderOptions = {}): AuthProvider {
  const { api_key = null, access_key_id = null, access_key_secret = null, region = "cn-hangzhou" } = opts;
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
    logger.debug("Using AK/SK authentication (with token exchange)");
    const auth = new AkSkAuth(access_key_id, access_key_secret);

    // Bind region into the exchange function via closure
    const _region = region;
    auth.setExchangeFunc(async (ak: string, sk: string): Promise<string> => {
      return _exchangeAkskForApiKey(ak, sk, { region: _region });
    });
    return auth;
  }

  throw new InvalidAPIKeyError("No authentication credentials provided", {
    suggestion: CREDENTIAL_ENV_SUGGESTION,
  });
}

// snake_case aliases for the Python-named public functions (the Python module exports these names).
export {
  createAuthProvider as create_auth_provider,
  _exchangeAkskForApiKey as _exchange_aksk_for_api_key,
  _percentEncode as _percent_encode,
  _signRpc as _sign_rpc,
};
