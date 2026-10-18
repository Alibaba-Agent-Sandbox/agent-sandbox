/** Tests for transport.auth module. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  InvalidAPIKeyError,
  InvalidCredentialsError,
  TokenExchangeError,
  TokenExpiredError,
} from "../../src/models/errors.js";
import {
  AkSkAuth,
  ApiKeyAuth,
  ENVD_AUTH_HEADER,
  ENVD_SANDBOX_ID_HEADER,
  ENVD_SANDBOX_PORT_HEADER,
  EnvdTokenManager,
  PLATFORM_AUTH_HEADER,
  buildEnvdHeaders as build_envd_headers,
  createAuthProvider as create_auth_provider,
} from "../../src/transport/auth.js";
import { patchHttpxAsyncClient, restoreHttpx } from "../_support/patch.js";

afterEach(() => {
  restoreHttpx();
});

const time = () => Date.now() / 1000;

/** `pytest.raises(cls, match=...)` for async callables. */
async function expectRaises(fn: () => Promise<unknown>, cls: new (...a: never[]) => Error, match?: RegExp): Promise<Error> {
  let caught: unknown;
  try {
    await fn();
  } catch (e) {
    caught = e;
  }
  expect(caught, "DID NOT RAISE").toBeInstanceOf(cls);
  if (match) expect(String((caught as Error).message)).toMatch(match);
  return caught as Error;
}

function expectRaisesSync(fn: () => unknown, cls: new (...a: never[]) => Error, match?: RegExp): void {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught, "DID NOT RAISE").toBeInstanceOf(cls);
  if (match) expect(String((caught as Error).message)).toMatch(match);
}

describe("TestApiKeyAuth", () => {
  // Test API Key authentication.

  it("test_get_headers", async () => {
    const auth = new ApiKeyAuth("my-api-key");
    const headers = await auth.getHeaders();
    expect(headers).toEqual({ [PLATFORM_AUTH_HEADER]: "Bearer my-api-key" });
  });

  it("test_get_headers_strips_whitespace", async () => {
    const auth = new ApiKeyAuth("  my-api-key  ");
    const headers = await auth.getHeaders();
    expect(headers).toEqual({ [PLATFORM_AUTH_HEADER]: "Bearer my-api-key" });
  });

  it("test_empty_key_raises", () => {
    expectRaisesSync(() => new ApiKeyAuth(""), InvalidAPIKeyError);
  });

  it("test_whitespace_only_key_raises", () => {
    expectRaisesSync(() => new ApiKeyAuth("   "), InvalidAPIKeyError);
  });

  it("test_refresh_is_noop", async () => {
    const auth = new ApiKeyAuth("key");
    await auth.refresh(); // Should not raise
  });
});

describe("TestAkSkAuth", () => {
  // Test AK/SK authentication.

  it("test_empty_ak_raises", () => {
    expectRaisesSync(() => new AkSkAuth("", "secret"), InvalidCredentialsError);
  });

  it("test_empty_sk_raises", () => {
    expectRaisesSync(() => new AkSkAuth("ak-id", ""), InvalidCredentialsError);
  });

  it("test_is_token_valid_no_token", () => {
    const auth = new AkSkAuth("ak-id", "sk-secret");
    expect(auth._isTokenValid()).toBe(false);
  });

  it("test_is_token_valid_fresh_token", () => {
    const auth = new AkSkAuth("ak-id", "sk-secret");
    auth._cached_token = "some-token";
    auth._token_expires_at = time() + 3600;
    expect(auth._isTokenValid()).toBe(true);
  });

  it("test_is_token_valid_near_expiry", () => {
    const auth = new AkSkAuth("ak-id", "sk-secret");
    auth._cached_token = "some-token";
    // Set expiry within 5 min (300s) refresh buffer
    auth._token_expires_at = time() + 200;
    expect(auth._isTokenValid()).toBe(false);
  });

  it("test_is_token_valid_expired", () => {
    const auth = new AkSkAuth("ak-id", "sk-secret");
    auth._cached_token = "some-token";
    auth._token_expires_at = time() - 100;
    expect(auth._isTokenValid()).toBe(false);
  });

  it("test_get_headers_calls_exchange_when_invalid", async () => {
    const auth = new AkSkAuth("ak-id", "sk-secret");
    const mock_exchange = vi.fn(async (_ak: string, _sk: string) => "exchanged-token");
    auth.setExchangeFunc(mock_exchange);

    const headers = await auth.getHeaders();
    expect(headers).toEqual({ [PLATFORM_AUTH_HEADER]: "Bearer exchanged-token" });
    expect(mock_exchange).toHaveBeenCalledTimes(1);
    expect(mock_exchange).toHaveBeenCalledWith("ak-id", "sk-secret");
  });

  it("test_get_headers_uses_cached_token", async () => {
    const auth = new AkSkAuth("ak-id", "sk-secret");
    auth._cached_token = "cached-token";
    auth._token_expires_at = time() + 3600;

    const mock_exchange = vi.fn(async (_ak: string, _sk: string) => "new-token");
    auth.setExchangeFunc(mock_exchange);

    const headers = await auth.getHeaders();
    expect(headers).toEqual({ [PLATFORM_AUTH_HEADER]: "Bearer cached-token" });
    expect(mock_exchange).not.toHaveBeenCalled();
  });

  it("test_refresh_clears_and_exchanges", async () => {
    const auth = new AkSkAuth("ak-id", "sk-secret");
    auth._cached_token = "old-token";
    auth._token_expires_at = time() + 3600;

    const mock_exchange = vi.fn(async (_ak: string, _sk: string) => "new-token");
    auth.setExchangeFunc(mock_exchange);

    await auth.refresh();
    expect(auth._cached_token).toBe("new-token");
    expect(mock_exchange).toHaveBeenCalledTimes(1);
  });

  it("test_exchange_without_func_raises", async () => {
    const auth = new AkSkAuth("ak-id", "sk-secret");
    await expectRaises(() => auth.getHeaders(), InvalidCredentialsError, /exchange function not configured/);
  });

  it("test_set_exchange_func", () => {
    const auth = new AkSkAuth("ak-id", "sk-secret");
    const func = vi.fn(async () => "x");
    auth.setExchangeFunc(func);
    expect(auth._exchange_func).toBe(func);
  });

  it("test_refresh_without_exchange_func_raises_credentials_error", async () => {
    const auth = new AkSkAuth("ak-id", "sk-secret");
    await expectRaises(() => auth.refresh(), InvalidCredentialsError, /exchange function not configured/);
  });
});

describe("TestEnvdTokenManager", () => {
  // Test envd access token manager.

  it("test_initial_token_none", () => {
    const mgr = new EnvdTokenManager();
    expect(mgr.token).toBeNull();
  });

  it("test_initial_token_set", () => {
    const mgr = new EnvdTokenManager("my-token");
    expect(mgr.token).toBe("my-token");
  });

  it("test_set_token", () => {
    const mgr = new EnvdTokenManager();
    mgr.setToken("new-token");
    expect(mgr.token).toBe("new-token");
  });

  it("test_get_headers", () => {
    const mgr = new EnvdTokenManager("my-token", "sbx-123");
    const headers = mgr.getHeaders();
    expect(ENVD_AUTH_HEADER in headers).toBe(true);
    expect(headers[ENVD_AUTH_HEADER]).toBe("my-token");
    expect(ENVD_SANDBOX_ID_HEADER in headers).toBe(true);
    expect(headers[ENVD_SANDBOX_ID_HEADER]).toBe("sbx-123");
    expect(ENVD_SANDBOX_PORT_HEADER in headers).toBe(true);
    expect(headers[ENVD_SANDBOX_PORT_HEADER]).toBe("49983");
    expect("Authorization" in headers).toBe(true);
    expect(headers["Authorization"]!.startsWith("Basic ")).toBe(true);
  });

  it("test_get_headers_without_sandbox_id", () => {
    const mgr = new EnvdTokenManager("my-token");
    const headers = mgr.getHeaders();
    expect(ENVD_AUTH_HEADER in headers).toBe(true);
    expect(ENVD_SANDBOX_ID_HEADER in headers).toBe(false);
    expect(ENVD_SANDBOX_PORT_HEADER in headers).toBe(true);
    expect("Authorization" in headers).toBe(true);
  });

  it("test_get_headers_no_token_raises", () => {
    const mgr = new EnvdTokenManager();
    expectRaisesSync(() => mgr.getHeaders(), TokenExpiredError);
  });

  it("test_clear", () => {
    const mgr = new EnvdTokenManager("my-token");
    mgr.clear();
    expect(mgr.token).toBeNull();
  });
});

describe("TestCreateAuthProvider", () => {
  // Test create_auth_provider factory.
  const credentialEnv = ["ABX_SANDBOX_API_KEY", "E2B_API_KEY", "SANDBOX_API_KEY"] as const;
  const saved: Partial<Record<(typeof credentialEnv)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const name of credentialEnv) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of credentialEnv) {
      const previous = saved[name];
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
  });

  it("test_api_key_priority", () => {
    const auth = create_auth_provider({ api_key: "my-key", access_key_id: "ak", access_key_secret: "sk" });
    expect(auth).toBeInstanceOf(ApiKeyAuth);
  });

  it.each(["cn-hangzhou", "cn-shanghai"])("AK/SK requires an API key without network (%s)", (region) => {
    const network = patchHttpxAsyncClient({});
    expect(() => create_auth_provider({ access_key_id: "ak", access_key_secret: "sk", region }))
      .toThrow(InvalidAPIKeyError);
    expect(network).not.toHaveBeenCalled();
  });

  it("test_no_credentials_raises", () => {
    expectRaisesSync(() => create_auth_provider(), InvalidAPIKeyError, /No authentication credentials/);
  });

  it("test_partial_ak_sk_raises", () => {
    expectRaisesSync(
      () => create_auth_provider({ access_key_id: "ak" }),
      InvalidAPIKeyError,
      /No authentication credentials/,
    );
  });

  it("test_api_key_used", () => {
    const auth = create_auth_provider({ api_key: "key-123" });
    expect(auth).toBeInstanceOf(ApiKeyAuth);
  });

  it("test_env_sandbox_api_key_is_used", async () => {
    process.env["ABX_SANDBOX_API_KEY"] = "env-key-123";
    const auth = create_auth_provider();
    expect(auth).toBeInstanceOf(ApiKeyAuth);
    expect((auth as ApiKeyAuth)._api_key).toBe("env-key-123");
    expect(await auth.getHeaders()).toEqual({ [PLATFORM_AUTH_HEADER]: "Bearer env-key-123" });
  });

  it("test_retired_api_key_names_are_not_read", () => {
    process.env["E2B_API_KEY"] = "retired-e2b";
    process.env["SANDBOX_API_KEY"] = "retired-sandbox";
    let caught: unknown;
    try {
      create_auth_provider();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidAPIKeyError);
    const suggestion = (caught as InvalidAPIKeyError).suggestion ?? "";
    expect(suggestion).toContain("ABX_SANDBOX_API_KEY");
    expect(suggestion).not.toContain("ALICLOUD_ACCESS_KEY_ID");
    expect(suggestion).not.toContain("ALICLOUD_ACCESS_KEY_SECRET");
    expect(suggestion).toContain("ABX_SANDBOX_BASE_URL");
    expect(suggestion).toContain("ABX_SANDBOX_DOMAIN");
    expect(suggestion).toContain("ALIBABA_CLOUD_REGION_ID");
    expect(suggestion).not.toContain("E2B_API_KEY");
    expect(suggestion).not.toContain("AccessKey");
  });
});

describe("TestBuildEnvdHeaders", () => {
  // Test build_envd_headers convenience function.

  it("test_returns_all_four_headers", () => {
    const headers = build_envd_headers("sbx-abc", "tok-xyz");
    expect(headers[ENVD_AUTH_HEADER]).toBe("tok-xyz");
    expect(headers[ENVD_SANDBOX_ID_HEADER]).toBe("sbx-abc");
    expect(headers[ENVD_SANDBOX_PORT_HEADER]).toBe("49983");
    expect(headers["Authorization"]!.startsWith("Basic ")).toBe(true);
    expect(Object.keys(headers).length).toBe(4);
  });
});

describe("TestAkSkAuthIntegration", () => {
  // Integration tests for AK/SK auth with injected exchange function.

  it("test_end_to_end_exchange_and_cache", async () => {
    // Test full flow: create provider -> first call exchanges -> second uses cache.
    const mock_exchange = vi.fn(async (_ak: string, _sk: string) => "ek-fresh-token");

    const auth = new AkSkAuth("ak-id", "sk-secret");
    auth.setExchangeFunc(mock_exchange);

    // First call triggers exchange
    const headers1 = await auth.getHeaders();
    expect(headers1).toEqual({ [PLATFORM_AUTH_HEADER]: "Bearer ek-fresh-token" });
    expect(mock_exchange.mock.calls.length).toBe(1);

    // Second call uses cache
    const headers2 = await auth.getHeaders();
    expect(headers2).toEqual({ [PLATFORM_AUTH_HEADER]: "Bearer ek-fresh-token" });
    expect(mock_exchange.mock.calls.length).toBe(1); // not called again
  });

  it("test_token_refresh_on_near_expiry", async () => {
    // Test that token is refreshed when near expiry.
    let call_count = 0;

    const mock_exchange = async (_ak: string, _sk: string): Promise<string> => {
      call_count += 1;
      return `ek-token-${call_count}`;
    };

    const auth = new AkSkAuth("ak-id", "sk-secret");
    auth.setExchangeFunc(mock_exchange);

    // First call
    await auth.getHeaders();
    expect(call_count).toBe(1);

    // Simulate near-expiry (within REFRESH_BEFORE_EXPIRY buffer)
    auth._token_expires_at = time() + 100; // within 300s buffer

    // Should trigger re-exchange
    const headers = await auth.getHeaders();
    expect(call_count).toBe(2);
    expect(headers).toEqual({ [PLATFORM_AUTH_HEADER]: "Bearer ek-token-2" });
  });

  it("test_force_refresh", async () => {
    // Test force refresh clears cache and re-exchanges.
    const mock_exchange = vi
      .fn(async (_ak: string, _sk: string) => "unused")
      .mockResolvedValueOnce("token-1")
      .mockResolvedValueOnce("token-2");

    const auth = new AkSkAuth("ak-id", "sk-secret");
    auth.setExchangeFunc(mock_exchange);

    await auth.getHeaders();
    expect(auth._cached_token).toBe("token-1");

    await auth.refresh();
    expect(auth._cached_token).toBe("token-2");
    expect(mock_exchange.mock.calls.length).toBe(2);
  });

  it("test_exchange_error_propagates", async () => {
    // Test that exchange errors propagate correctly.
    const failing_exchange = async (_ak: string, _sk: string): Promise<string> => {
      throw new TokenExchangeError("Exchange endpoint returned 500");
    };

    const auth = new AkSkAuth("ak-id", "sk-secret");
    auth.setExchangeFunc(failing_exchange);

    await expectRaises(() => auth.getHeaders(), TokenExchangeError, /500/);
  });

  it.each([null, "", "   ", { apiKeyValue: "placeholder" }, 42])("rejects custom non-token return %#", async (value) => {
    const auth = new AkSkAuth("ak-id", "sk-secret");
    auth.setExchangeFunc(async () => value as unknown as string);
    await expect(auth.getHeaders()).rejects.toThrow("non-empty token string");
    expect(auth._cached_token).toBeNull();
    expect(auth._token_expires_at).toBe(0);
  });

  it("normalizes a valid custom token before caching", async () => {
    const auth = new AkSkAuth("ak-id", "sk-secret");
    auth.setExchangeFunc(async () => "  custom-token  ");
    expect(await auth.getHeaders()).toEqual({ [PLATFORM_AUTH_HEADER]: "Bearer custom-token" });
  });
});
