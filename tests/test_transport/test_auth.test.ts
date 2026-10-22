/** Tests for transport.auth module. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  InvalidAPIKeyError,
  InvalidCredentialsError,
  TokenExchangeError,
  TokenExpiredError,
} from "../../src/models/errors.js";
import {
  ApiKeyAuth,
  ENVD_AUTH_HEADER,
  ENVD_SANDBOX_ID_HEADER,
  ENVD_SANDBOX_PORT_HEADER,
  EnvdTokenManager,
  PLATFORM_AUTH_HEADER,
  buildEnvdHeaders as build_envd_headers,
  createAuthProvider as create_auth_provider,
} from "../../src/providers/alicloud_express/auth.js";
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
    const auth = create_auth_provider({ api_key: "my-key" });
    expect(auth).toBeInstanceOf(ApiKeyAuth);
  });

  it("test_no_credentials_raises", () => {
    expectRaisesSync(() => create_auth_provider(), InvalidAPIKeyError, /No authentication credentials/);
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
