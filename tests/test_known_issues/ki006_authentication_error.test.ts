/** KI-006: a Platform API 401 surfaces as `AuthenticationError` (CLI exit code 3). */

import { describe, expect, it } from "vitest";

import { Sandbox } from "../../src/api/sandbox.js";
import {
  AuthenticationError,
  InvalidAPIKeyError,
  InvalidCredentialsError,
  SandboxCreationError,
  SandboxError,
} from "../../src/models/errors.js";
import { SandboxConfig } from "../../src/models/sandbox.js";
import { SandboxProtocol } from "../../src/providers/shared/e2b/sandbox.js";
import { TransportConfig } from "../../src/transport/config.js";
import { HTTPError, HTTPStatusError, HttpClient } from "../../src/transport/http.js";
import { useIsolatedEnv, useTransportIsolation } from "../_support/env.js";
import { useHttpxMock } from "../helpers/httpxMock.js";
import { API, makeHttp, raises } from "./_helpers.js";

const iso = useIsolatedEnv();
useTransportIsolation(iso);
const httpx_mock = useHttpxMock();

const SECRET = "e2e-invalid-key-0000000000000000";

describe("KI-006 authentication error", () => {
  it("test_list_with_a_rejected_key_raises_authentication_error", async () => {
    httpx_mock.add_response({ method: "GET", status_code: 401, json: { message: "invalid api key" } });
    const err = await raises(() => new SandboxProtocol(makeHttp(SECRET)).list(), AuthenticationError);
    expect(err).toBeInstanceOf(InvalidAPIKeyError);
    expect(err).not.toBeInstanceOf(HTTPError);
    expect(err.code).toBe("E1001");
    expect(err.message).toBe(
      "The Platform API rejected the API key (HTTP 401) for /sandboxes: it is invalid, revoked or for another region.",
    );
    expect(err.message).not.toContain(SECRET);
    expect(err.message).not.toContain(API);
  });

  it("test_create_with_a_rejected_key_is_an_authentication_error", async () => {
    httpx_mock.add_response({ method: "POST", status_code: 401, json: { message: "invalid api key" } });
    const err = await raises(
      () => new SandboxProtocol(makeHttp(SECRET)).create(new SandboxConfig({ template: "base" })),
      AuthenticationError,
    );
    expect(err).not.toBeInstanceOf(SandboxCreationError);
  });

  it("test_sandbox_list_api_with_wrong_key", async () => {
    iso.monkeypatch.setenv("ABX_PROVIDER", "alicloud-express");
    httpx_mock.add_response({ method: "GET", status_code: 401, content: "" });
    await raises(() => Sandbox.list({ api_key: SECRET, api_url: API }), AuthenticationError);
  });

  it("test_custom_auth_maps_to_invalid_credentials", async () => {
    class CustomAuth {
      async refresh(): Promise<void> {}
      authenticationError(): InvalidCredentialsError { return new InvalidCredentialsError("Custom credentials were rejected"); }
      async getHeaders(): Promise<Record<string, string>> {
        return {};
      }
    }
    httpx_mock.add_response({ method: "GET", status_code: 401, content: "" });
    const client = new HttpClient(new TransportConfig({ api_url: API, http2: false }), new CustomAuth());
    const err = await raises(() => client.platformRequest("GET", "/sandboxes"), InvalidCredentialsError);
    expect(err.code).toBe("E1003");
    expect(err.message).toBe("Custom credentials were rejected");
  });

  it.each([403, 404, 429, 500])("test_other_statuses_are_left_to_the_callers(%i)", async (status) => {
    httpx_mock.add_response({ method: "GET", status_code: status, json: {} });
    await raises(() => makeHttp().platformRequest("GET", "/sandboxes"), HTTPStatusError);
  });

  it("test_authentication_error_is_a_sandbox_error", async () => {
    httpx_mock.add_response({ method: "GET", status_code: 401, json: {} });
    await raises(() => makeHttp().platformRequest("GET", "/sandboxes/x"), SandboxError);
  });
});
