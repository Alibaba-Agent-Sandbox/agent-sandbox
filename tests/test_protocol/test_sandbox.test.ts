/** Tests for protocol.sandbox module — Platform API sandbox lifecycle. */

import { describe, expect, it, vi } from "vitest";

import { QuotaExceededError, SandboxCreationError, SandboxNotFoundError, TemplateNotFoundError } from "../../src/models/errors.js";
import { SandboxConfig, SandboxInfo, SandboxStatus } from "../../src/models/sandbox.js";
import { SandboxProtocol } from "../../src/protocol/sandbox.js";
import { ApiKeyAuth } from "../../src/transport/auth.js";
import { TransportConfig } from "../../src/transport/config.js";
import { HttpClient } from "../../src/transport/http.js";
import { useHttpxMock } from "../helpers/httpxMock.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const BASE = "https://sandbox-test.example.com";

const httpx_mock = useHttpxMock();

function makeProtocol(): SandboxProtocol {
  const transport_config = new TransportConfig({ api_url: BASE, http2: false });
  const api_key_auth = new ApiKeyAuth("test-api-key");
  const http_client = new HttpClient(transport_config, api_key_auth);
  return new SandboxProtocol(http_client);
}

// --- Sample API response payloads ---

const _SANDBOX_RESPONSE = {
  sandboxID: "sbx-abc123",
  templateID: "python3",
  status: "running",
  timeout: 300,
  region: "cn-hangzhou",
  metadata: {},
  envdUrl: "https://envd-sbx-abc123.example.com",
  envdAccessToken: "tok-envd-xyz",
};

const bodyOf = (request: { content: Uint8Array }) => JSON.parse(Buffer.from(request.content).toString("utf-8"));

describe("TestCreate", () => {
  // Test SandboxProtocol.create().
  it("test_create_minimal_config", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ url: `${BASE}/sandboxes`, method: "POST", json: _SANDBOX_RESPONSE });
    const config = new SandboxConfig({ template: "python3" });
    const info = await protocol.create(config);

    expect(info).toBeInstanceOf(SandboxInfo);
    expect(info.sandbox_id).toBe("sbx-abc123");
    expect(info.template).toBe("python3");
    expect(info.envd_access_token).toBe("tok-envd-xyz");

    const request = httpx_mock.get_request();
    const body = bodyOf(request);
    expect(body["templateID"]).toBe("python3");
    expect(body["timeout"]).toBe(300);
    expect("cpu" in body).toBe(false);
    expect("memory" in body).toBe(false);
  });

  it("test_create_full_config", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ url: `${BASE}/sandboxes`, method: "POST", json: _SANDBOX_RESPONSE });
    const config = new SandboxConfig({
      template: "nodejs",
      timeout: 600,
      env_vars: { NODE_ENV: "production" },
      auto_pause: true,
    });
    const info = await protocol.create(config);
    expect(info.sandbox_id).toBe("sbx-abc123");

    const request = httpx_mock.get_request();
    const body = bodyOf(request);
    expect(body["templateID"]).toBe("nodejs");
    expect(body["timeout"]).toBe(600);
    expect(body["envVars"]).toEqual({ NODE_ENV: "production" });
    expect(body["autoPause"]).toBe(true);
    expect("cpu" in body).toBe(false);
    expect("memory" in body).toBe(false);
    expect("disk" in body).toBe(false);
    expect("region" in body).toBe(false);
  });

  it("test_create_404_raises_template_not_found", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({
      url: `${BASE}/sandboxes`,
      method: "POST",
      status_code: 404,
      json: { message: "Template 'nonexistent' not found" },
    });
    const config = new SandboxConfig({ template: "nonexistent" });
    const p = protocol.create(config);
    await expect(p).rejects.toBeInstanceOf(TemplateNotFoundError);
    await expect(p).rejects.toThrow(/not found/);
  });

  it("test_create_429_raises_quota_exceeded", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ url: `${BASE}/sandboxes`, method: "POST", status_code: 429, json: { message: "Quota exceeded" } });
    const config = new SandboxConfig();
    const p = protocol.create(config);
    await expect(p).rejects.toBeInstanceOf(QuotaExceededError);
    await expect(p).rejects.toThrow(/Quota exceeded/);
  });

  it("test_create_500_raises_creation_error", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ url: `${BASE}/sandboxes`, method: "POST", status_code: 500, json: { message: "Internal server error" } });
    const config = new SandboxConfig();
    await expect(protocol.create(config)).rejects.toBeInstanceOf(SandboxCreationError);
  });

  it("test_create_forwards_request_timeout", async () => {
    // create(request_timeout=120) forwards it to platform_request.
    const mock_http: any = { platformRequest: vi.fn(async () => ({ json: () => _SANDBOX_RESPONSE })) };
    const proto = new SandboxProtocol(mock_http);

    await proto.create(new SandboxConfig({ template: "python3" }), { request_timeout: 120.0 });

    expect(mock_http.platformRequest.mock.calls[0][2]["request_timeout"]).toBe(120.0);
  });

  it("test_create_default_request_timeout_none", async () => {
    // create() without an override forwards request_timeout=None.
    const mock_http: any = { platformRequest: vi.fn(async () => ({ json: () => _SANDBOX_RESPONSE })) };
    const proto = new SandboxProtocol(mock_http);

    await proto.create(new SandboxConfig({ template: "python3" }));

    expect(mock_http.platformRequest.mock.calls[0][2]["request_timeout"]).toBeNull();
  });

  it("test_list_and_kill_do_not_send_request_timeout", async () => {
    // Non-create platform calls must not carry a request_timeout override.
    const mock_http: any = { platformRequest: vi.fn(async () => ({ json: () => [] })) };
    const proto = new SandboxProtocol(mock_http);

    await proto.list();
    expect("request_timeout" in (mock_http.platformRequest.mock.calls.at(-1)[2] ?? {})).toBe(false);

    mock_http.platformRequest.mockClear();
    await proto.kill("sbx-abc123");
    expect("request_timeout" in (mock_http.platformRequest.mock.calls.at(-1)[2] ?? {})).toBe(false);
  });
});

describe("TestList", () => {
  // Test SandboxProtocol.list().
  it("test_list_default_params", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ method: "GET", json: [_SANDBOX_RESPONSE] });
    const result = await protocol.list();
    expect(result.length).toBe(1);
    expect(result[0]!.sandbox_id).toBe("sbx-abc123");

    const request = httpx_mock.get_request();
    expect(request.url.toString()).toContain("limit=100");
    expect(request.url.toString()).toContain("offset=0");
  });

  it("test_list_with_status_filter", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ method: "GET", json: { sandboxes: [_SANDBOX_RESPONSE] } });
    const result = await protocol.list({ status: SandboxStatus.RUNNING });
    expect(result.length).toBe(1);

    const request = httpx_mock.get_request();
    expect(request.url.toString()).toContain("status=running");
  });

  it("test_list_with_data_wrapper", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ method: "GET", json: { data: [_SANDBOX_RESPONSE] } });
    const result = await protocol.list();
    expect(result.length).toBe(1);
  });

  it("test_list_empty", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ method: "GET", json: [] });
    const result = await protocol.list();
    expect(result).toEqual([]);
  });
});

describe("TestGetInfo", () => {
  // Test SandboxProtocol.get_info().
  it("test_get_info", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ url: `${BASE}/sandboxes/sbx-abc123`, method: "GET", json: _SANDBOX_RESPONSE });
    const info = await protocol.getInfo("sbx-abc123");
    expect(info).toBeInstanceOf(SandboxInfo);
    expect(info.sandbox_id).toBe("sbx-abc123");
    expect(info.status).toBe(SandboxStatus.RUNNING);
  });
});

describe("TestKill", () => {
  // Test SandboxProtocol.kill().
  it("test_kill_success", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ url: `${BASE}/sandboxes/sbx-abc123`, method: "DELETE", status_code: 200, json: {} });
    await protocol.kill("sbx-abc123"); // Should not raise
  });

  it("test_kill_404_does_not_raise", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ url: `${BASE}/sandboxes/sbx-gone`, method: "DELETE", status_code: 404, json: { message: "not found" } });
    await protocol.kill("sbx-gone"); // Should not raise
  });
});

describe("TestSetTimeout", () => {
  // Test SandboxProtocol.set_timeout().
  it("test_set_timeout", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ url: `${BASE}/sandboxes/sbx-abc123/timeout`, method: "POST", json: {} });
    await protocol.setTimeout("sbx-abc123", 600);

    const request = httpx_mock.get_request();
    const body = bodyOf(request);
    expect(body).toEqual({ timeout: 600 });
  });
});

// TestKeepAlive — removed upstream: keep_alive has been removed from SandboxProtocol (the Python class is an empty `pass`).

describe("TestConnect", () => {
  // Test SandboxProtocol.connect().
  it("test_connect", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ url: `${BASE}/sandboxes/sbx-abc123`, method: "GET", json: _SANDBOX_RESPONSE });
    const info = await protocol.connect("sbx-abc123");
    expect(info).toBeInstanceOf(SandboxInfo);
    expect(info.sandbox_id).toBe("sbx-abc123");
  });
});

describe("TestIsRunning", () => {
  // Test SandboxProtocol.is_running().
  it("test_is_running_true", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ url: `${BASE}/sandboxes/sbx-abc123`, method: "GET", json: _SANDBOX_RESPONSE }); // status is "running"
    expect(await protocol.isRunning("sbx-abc123")).toBe(true);
  });

  it("test_is_running_false", async () => {
    const protocol = makeProtocol();
    const stopped_response = { ..._SANDBOX_RESPONSE, status: "stopped" };
    httpx_mock.add_response({ url: `${BASE}/sandboxes/sbx-abc123`, method: "GET", json: stopped_response });
    expect(await protocol.isRunning("sbx-abc123")).toBe(false);
  });

  it("test_is_running_on_error", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ url: `${BASE}/sandboxes/sbx-gone`, method: "GET", status_code: 404, json: { message: "not found" } });
    expect(await protocol.isRunning("sbx-gone")).toBe(false);
  });
});

describe("TestPause", () => {
  // Test SandboxProtocol.pause().
  it("test_pause", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ url: `${BASE}/sandboxes/sbx-abc123/pause`, method: "POST", json: {} });
    await protocol.pause("sbx-abc123"); // Should not raise

    const request = httpx_mock.get_request();
    expect(request.method).toBe("POST");
  });
});

// TestGetUploadUrl and TestGetDownloadUrl removed upstream: those methods have been removed from SandboxProtocol.

describe("TestNotFoundMapping", () => {
  // A 404 on a sandbox id is SandboxNotFoundError (E2009, exit code 4).
  it("test_get_info_404_is_sandbox_not_found", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ url: `${BASE}/sandboxes/sbx-gone`, method: "GET", status_code: 404, json: { message: "not found" } });
    const err = await protocol.getInfo("sbx-gone").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SandboxNotFoundError);
    expect((err as SandboxNotFoundError).code).toBe("E2009");
  });

  it("test_connect_404_is_sandbox_not_found", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ url: `${BASE}/sandboxes/sbx-gone`, method: "GET", status_code: 404, json: { message: "not found" } });
    await expect(protocol.connect("sbx-gone")).rejects.toBeInstanceOf(SandboxNotFoundError);
  });

  it("test_other_status_codes_are_not_remapped", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ url: `${BASE}/sandboxes/sbx-x`, method: "GET", status_code: 500, json: { message: "boom" } });
    const err = await protocol.getInfo("sbx-x").catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(SandboxNotFoundError);
  });
});
