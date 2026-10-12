/** Tests for the NetworkModule API. */

import { describe, expect, it } from "vitest";

import { NetworkModule } from "../../src/api/network.js";
import { TEST_ENVD_TOKEN, TEST_SANDBOX_ID, makeNetworkModule } from "./conftest.js";

const DOMAIN = "cn-hangzhou.e2b.fc.aliyuncs.com";

describe("TestNetworkGetHost", () => {
  // Test NetworkModule.get_host().
  it("test_get_host_returns_expected_format", () => {
    const network_module = makeNetworkModule();
    const host = network_module.getHost(8080);
    expect(host).toBe(`8080-${TEST_SANDBOX_ID}.${DOMAIN}`);
  });

  it("test_get_host_different_port", () => {
    const network_module = makeNetworkModule();
    const host = network_module.getHost(3000);
    expect(host).toBe(`3000-${TEST_SANDBOX_ID}.${DOMAIN}`);
  });
});

describe("TestNetworkGetUrl", () => {
  // Test NetworkModule.get_url().
  it("test_get_url_secure", () => {
    const network_module = makeNetworkModule();
    const url = network_module.getUrl(8080);
    expect(url).toBe(`https://8080-${TEST_SANDBOX_ID}.${DOMAIN}`);
  });

  it("test_get_url_insecure", () => {
    const mod = new NetworkModule({
      sandbox_id: TEST_SANDBOX_ID,
      domain: DOMAIN,
      secure: false,
      capabilities: new Set(["ports"]),
    });
    const url = mod.getUrl(8080);
    expect(url).toBe(`http://8080-${TEST_SANDBOX_ID}.${DOMAIN}`);
  });
});

describe("TestNetworkGetAccessHeaders", () => {
  // Test NetworkModule.get_access_headers().
  it("test_get_access_headers_with_token", () => {
    const network_module = makeNetworkModule();
    const headers = network_module.getAccessHeaders();
    expect(headers).toEqual({ "X-Access-Token": TEST_ENVD_TOKEN });
  });

  it("test_get_access_headers_no_token", () => {
    const mod = new NetworkModule({
      sandbox_id: TEST_SANDBOX_ID,
      domain: DOMAIN,
      secure: true,
      access_token: null,
      capabilities: new Set(["ports"]),
    });
    const headers = mod.getAccessHeaders();
    expect(headers).toEqual({});
  });

  it("test_get_access_headers_insecure_with_token", () => {
    const mod = new NetworkModule({
      sandbox_id: TEST_SANDBOX_ID,
      domain: DOMAIN,
      secure: false,
      access_token: "some-token",
      capabilities: new Set(["ports"]),
    });
    const headers = mod.getAccessHeaders();
    // Non-secure mode doesn't include access headers
    expect(headers).toEqual({});
  });
});

describe("TestNetworkModuleInit", () => {
  // Test NetworkModule initialization.
  it("test_default_secure", () => {
    const mod = new NetworkModule({ sandbox_id: "sbx-1", domain: "example.com", capabilities: new Set(["ports"]) });
    const url = mod.getUrl(8080);
    expect(url.startsWith("https://")).toBe(true);
  });

  it("test_custom_domain", () => {
    const mod = new NetworkModule({ sandbox_id: "sbx-1", domain: "custom.domain.com", capabilities: new Set(["ports"]) });
    const host = mod.getHost(3000);
    expect(host).toContain("custom.domain.com");
  });
});
