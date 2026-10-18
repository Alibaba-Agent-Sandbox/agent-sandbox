/** Tests for protocol.template module — Platform API template management. */

import { afterEach, describe, expect, it, vi } from "vitest";

import { SandboxError } from "../../src/models/errors.js";
import { TemplateBuildError, TemplateBuildTimeoutError, TemplateProtocol, _seams } from "../../src/providers/alicloud_express/template_protocol.js";
import { ApiKeyAuth } from "../../src/transport/auth.js";
import { TransportConfig } from "../../src/transport/config.js";
import { HttpClient } from "../../src/transport/http.js";
import { useHttpxMock } from "../helpers/httpxMock.js";

const BASE = "https://sandbox-test.example.com";

const httpx_mock = useHttpxMock();

afterEach(() => {
  vi.restoreAllMocks();
});

function makeProtocol(): TemplateProtocol {
  const transport_config = new TransportConfig({ api_url: BASE, http2: false });
  const api_key_auth = new ApiKeyAuth("test-api-key");
  return new TemplateProtocol(new HttpClient(transport_config, api_key_auth));
}

// --- Sample API response payloads ---


const _TEMPLATE_RESPONSE = {
  templateID: "tpl-abc123",
  buildID: "bld-xyz789",
  aliases: "my-template",
  public: false,
  cpuCount: 2,
  memoryMB: 4096,
};

const _BUILD_STATUS_READY = { buildID: "bld-xyz789", templateID: "tpl-abc123", status: "ready" };

const _BUILD_STATUS_BUILDING = { buildID: "bld-xyz789", templateID: "tpl-abc123", status: "building" };

const _BUILD_STATUS_ERROR = {
  buildID: "bld-xyz789",
  templateID: "tpl-abc123",
  status: "error",
  error: "Dockerfile syntax error",
};

const bodyOf = (request: { content: Uint8Array }) => JSON.parse(Buffer.from(request.content).toString("utf-8"));

describe("TestList", () => {
  // Test TemplateProtocol.list().
  it("test_list_as_array", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ url: `${BASE}/templates`, method: "GET", json: [_TEMPLATE_RESPONSE] });
    const result = await protocol.list();
    expect(result.length).toBe(1);
    expect(result[0]!["templateID"]).toBe("tpl-abc123");
  });

  it("test_list_with_data_wrapper", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ url: `${BASE}/templates`, method: "GET", json: { data: [_TEMPLATE_RESPONSE] } });
    const result = await protocol.list();
    expect(result.length).toBe(1);
  });

  it("test_list_empty", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ url: `${BASE}/templates`, method: "GET", json: [] });
    const result = await protocol.list();
    expect(result).toEqual([]);
  });
});

describe("TestGet", () => {
  // Test TemplateProtocol.get().
  it("test_get_template", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ url: `${BASE}/templates/tpl-abc123`, method: "GET", json: _TEMPLATE_RESPONSE });
    const result = await protocol.get("tpl-abc123");
    expect(result["templateID"]).toBe("tpl-abc123");
    expect(result["cpuCount"]).toBe(2);
  });
});

describe("TestDelete", () => {
  // Test TemplateProtocol.delete().
  it("test_delete_success", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ url: `${BASE}/templates/tpl-abc123`, method: "DELETE", status_code: 200, json: {} });
    await protocol.delete("tpl-abc123"); // Should not raise
  });

  it("test_delete_404_does_not_raise", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ url: `${BASE}/templates/tpl-gone`, method: "DELETE", status_code: 404, json: { message: "not found" } });
    await protocol.delete("tpl-gone"); // Should not raise
  });
});

describe("TestGetBuildStatus", () => {
  // Test TemplateProtocol.get_build_status().
  it("test_get_build_status", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ url: `${BASE}/templates/tpl-abc123/builds/bld-xyz789/status`, method: "GET", json: _BUILD_STATUS_READY });
    const result = await protocol.getBuildStatus("tpl-abc123", "bld-xyz789");
    expect(result["status"]).toBe("ready");
  });
});

describe("TestWaitForBuild", () => {
  // Test TemplateProtocol.wait_for_build().
  it("test_wait_immediately_ready", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ url: `${BASE}/templates/tpl-abc123/builds/bld-xyz789/status`, method: "GET", json: _BUILD_STATUS_READY });
    const result = await protocol.waitForBuild("tpl-abc123", "bld-xyz789", { timeout: 10, poll_interval: 1 });
    expect(result["status"]).toBe("ready");
  });

  it("test_on_poll_sees_each_status", async () => {
    const protocol = makeProtocol();
    vi.spyOn(_seams, "sleep").mockImplementation(async () => undefined);
    httpx_mock.add_response({ url: `${BASE}/templates/tpl-abc123/builds/bld-xyz789/status`, method: "GET", json: _BUILD_STATUS_BUILDING });
    httpx_mock.add_response({ url: `${BASE}/templates/tpl-abc123/builds/bld-xyz789/status`, method: "GET", json: _BUILD_STATUS_READY });
    const seen: [string, number][] = [];
    const result = await protocol.waitForBuild("tpl-abc123", "bld-xyz789", {
      timeout: 10,
      poll_interval: 1,
      on_poll: (status: string, elapsed: number) => seen.push([status, elapsed]),
    });
    expect(result["status"]).toBe("ready");
    expect(seen).toEqual([
      ["building", 0],
      ["ready", 1],
    ]);
  });

  it("test_wait_build_error", async () => {
    const protocol = makeProtocol();
    httpx_mock.add_response({ url: `${BASE}/templates/tpl-abc123/builds/bld-xyz789/status`, method: "GET", json: _BUILD_STATUS_ERROR });
    const p = protocol.waitForBuild("tpl-abc123", "bld-xyz789", { timeout: 10, poll_interval: 1 });
    await expect(p).rejects.toBeInstanceOf(TemplateBuildError);
    await expect(p).rejects.toThrow(/Dockerfile syntax error/);
  });

  it("test_wait_timeout", async () => {
    // (pytest.mark.httpx_mock(assert_all_responses_were_requested=False))
    httpx_mock.assert_all_responses_were_requested = false;
    const protocol = makeProtocol();
    // Add multiple "building" responses for the polling loop
    for (let i = 0; i < 5; i++) {
      httpx_mock.add_response({ url: `${BASE}/templates/tpl-abc123/builds/bld-xyz789/status`, method: "GET", json: _BUILD_STATUS_BUILDING });
    }
    const p = protocol.waitForBuild("tpl-abc123", "bld-xyz789", { timeout: 2, poll_interval: 1 });
    await expect(p).rejects.toBeInstanceOf(TemplateBuildTimeoutError);
    await expect(p).rejects.toThrow(/timed out/);
  });
});
