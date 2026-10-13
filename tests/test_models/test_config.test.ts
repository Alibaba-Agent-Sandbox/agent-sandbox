/** Tests for global config data model. */

import { describe, expect, it } from "vitest";

import { ValidationError } from "../../src/models/base.js";
import { GlobalConfig } from "../../src/models/config.js";

describe("TestGlobalConfig", () => {
  it("test_defaults", () => {
    const cfg = new GlobalConfig();
    expect(cfg.api_key).toBeNull();
    expect(cfg.access_key_id).toBeNull();
    expect(cfg.access_key_secret).toBeNull();
    expect(cfg.api_url).toBe("https://api.cn-hangzhou.e2b.fc.aliyuncs.com");
    expect(cfg.domain).toBe("cn-hangzhou.e2b.fc.aliyuncs.com");
    expect(cfg.region).toBe("cn-hangzhou");
    expect(cfg.timeout).toBe(300);
    expect(cfg.max_retries).toBe(3);
    expect(cfg.secure).toBe(true);
    expect(cfg.log_level).toBe("WARNING");
    expect(cfg.default_template).toBe("base");
  });

  it("test_custom_values", () => {
    const cfg = new GlobalConfig({
      api_key: "my-key",
      api_url: "https://custom.example.com",
      region: "cn-shanghai",
      timeout: 600,
      max_retries: 5,
      log_level: "DEBUG",
      secure: false,
    });
    expect(cfg.api_key).toBe("my-key");
    expect(cfg.api_url).toBe("https://custom.example.com");
    expect(cfg.timeout).toBe(600);
    expect(cfg.max_retries).toBe(5);
    expect(cfg.log_level).toBe("DEBUG");
    expect(cfg.secure).toBe(false);
  });

  it("test_timeout_min_validation", () => {
    expect(() => new GlobalConfig({ timeout: 0 })).toThrow(ValidationError);
  });

  it("test_max_retries_min_validation", () => {
    expect(() => new GlobalConfig({ max_retries: -1 })).toThrow(ValidationError);
  });

  it("test_max_retries_max_validation", () => {
    expect(() => new GlobalConfig({ max_retries: 11 })).toThrow(ValidationError);
  });

  it("test_api_url_for_region", () => {
    const url = GlobalConfig.apiUrlForRegion("cn-shanghai");
    expect(url).toBe("https://api.cn-shanghai.e2b.fc.aliyuncs.com");
  });

  it("test_domain_for_region", () => {
    const domain = GlobalConfig.domainForRegion("cn-shanghai");
    expect(domain).toBe("cn-shanghai.e2b.fc.aliyuncs.com");
  });
});
