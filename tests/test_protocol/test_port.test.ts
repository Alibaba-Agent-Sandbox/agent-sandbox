/** Tests for protocol.port module — 端口 URL 本地计算。 */

import { describe, expect, it } from "vitest";

import { PortClient } from "../../src/protocol/port.js";

describe("TestGetHost", () => {
  // Test PortClient.get_host() static method.
  it("test_returns_expected_format", () => {
    const host = PortClient.getHost("sbx-123", 8080, "e2b.dev");
    expect(host).toBe("8080-sbx-123.e2b.dev");
  });

  it("test_different_port", () => {
    const host = PortClient.getHost("sbx-abc", 3000, "cn-hangzhou.e2b.fc.aliyuncs.com");
    expect(host).toBe("3000-sbx-abc.cn-hangzhou.e2b.fc.aliyuncs.com");
  });

  it("test_different_sandbox_id", () => {
    const host = PortClient.getHost("my-sandbox-999", 443, "example.com");
    expect(host).toBe("443-my-sandbox-999.example.com");
  });
});

describe("TestGetPortUrl", () => {
  // Test PortClient.get_port_url() static method.
  it("test_secure_url", () => {
    const url = PortClient.getPortUrl("sbx-123", 8080, "e2b.dev", true);
    expect(url).toBe("https://8080-sbx-123.e2b.dev");
  });

  it("test_insecure_url", () => {
    const url = PortClient.getPortUrl("sbx-123", 8080, "e2b.dev", false);
    expect(url).toBe("http://8080-sbx-123.e2b.dev");
  });

  it("test_default_is_secure", () => {
    const url = PortClient.getPortUrl("sbx-123", 3000, "cn-hangzhou.e2b.fc.aliyuncs.com");
    expect(url.startsWith("https://")).toBe(true);
    expect(url).toContain("3000-sbx-123.cn-hangzhou.e2b.fc.aliyuncs.com");
  });

  it("test_url_contains_host", () => {
    const host = PortClient.getHost("sbx-test", 9090, "domain.io");
    const url = PortClient.getPortUrl("sbx-test", 9090, "domain.io");
    expect(url).toContain(host);
  });

  it("test_various_ports", () => {
    for (const port of [80, 443, 3000, 5173, 8080, 9090]) {
      const url = PortClient.getPortUrl("sbx-1", port, "e2b.dev");
      expect(url).toContain(`${port}-sbx-1.e2b.dev`);
    }
  });
});

describe("TestStaticMethods", () => {
  // Verify methods are usable as static methods without instantiation.
  it("test_get_host_is_static", () => {
    const result = PortClient.getHost("sbx-1", 8080, "e2b.dev");
    expect(typeof result).toBe("string");
  });

  it("test_get_port_url_is_static", () => {
    const result = PortClient.getPortUrl("sbx-1", 8080, "e2b.dev");
    expect(typeof result).toBe("string");
  });
});
