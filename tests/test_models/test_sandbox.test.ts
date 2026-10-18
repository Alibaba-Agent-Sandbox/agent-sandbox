/** Tests for sandbox data models. */

import { describe, expect, it } from "vitest";

import { ValidationError } from "../../src/models/base.js";
import { SandboxConfig, SandboxInfo, SandboxStatus } from "../../src/models/sandbox.js";

describe("TestSandboxStatus", () => {
  it("test_enum_values", () => {
    expect(SandboxStatus.CREATING).toBe("creating");
    expect(SandboxStatus.RUNNING).toBe("running");
    expect(SandboxStatus.PAUSED).toBe("paused");
    expect(SandboxStatus.STOPPING).toBe("stopping");
    expect(SandboxStatus.STOPPED).toBe("stopped");
    expect(SandboxStatus.ERROR).toBe("error");
  });

  it("test_enum_count", () => {
    expect(Object.keys(SandboxStatus).length).toBe(6);
  });
});

describe("TestSandboxConfig", () => {
  it("serializes named Volume mounts using the official create wire format", () => {
    const cfg = new SandboxConfig({ volume_mounts: { "/mnt/oss": "oss-workspace" } });
    expect(cfg.toCreatePayload().volumeMounts).toEqual([{ name: "oss-workspace", path: "/mnt/oss" }]);
    expect(new SandboxConfig().toCreatePayload()).not.toHaveProperty("volumeMounts");
    expect(new SandboxConfig({ volume_mounts: {} }).toCreatePayload()).not.toHaveProperty("volumeMounts");
  });

  it.each([
    { relative: "workspace" }, { "/": "workspace" }, { "/mnt//oss": "workspace" },
    { "/mnt/../oss": "workspace" }, { "/mnt/./oss": "workspace" }, { "/mnt/oss/": "workspace" },
    { " /mnt/oss": "workspace" }, { "/mnt/oss ": "workspace" }, { "/mnt/.cache": "workspace" },
    { "/bin/oss": "workspace" }, { "/opt": "workspace" }, { "/var/oss": "workspace" }, { "/dev/oss": "workspace" },
    { "/mnt/oss\u0000": "workspace" }, { "/mnt/oss": "" }, { "/mnt/oss": " " },
    { "/mnt/oss": " workspace" }, { "/mnt/oss": "workspace\u0000" }, { "/mnt/oss": 1 },
    [], "invalid", JSON.parse('{"__proto__":"workspace"}'),
  ])("rejects invalid Volume maps before creating a payload %#", (volume_mounts) => {
    expect(() => new SandboxConfig({ volume_mounts })).toThrow(ValidationError);
  });

  it("test_defaults", () => {
    const cfg = new SandboxConfig();
    expect(cfg.template).toBe("base");
    expect(cfg.timeout).toBe(300);
    expect(cfg.metadata).toEqual({});
    expect(cfg.env_vars).toEqual({});
    expect(cfg.auto_pause).toBe(false);
  });

  it("test_custom_values", () => {
    const cfg = new SandboxConfig({
      template: "python3",
      timeout: 600,
      metadata: { owner: "test" },
      env_vars: { FOO: "bar" },
      auto_pause: true,
    });
    expect(cfg.template).toBe("python3");
    expect(cfg.timeout).toBe(600);
    expect(cfg.metadata).toEqual({ owner: "test" });
    expect(cfg.env_vars).toEqual({ FOO: "bar" });
    expect(cfg.auto_pause).toBe(true);
  });

  it("test_timeout_min_validation", () => {
    expect(() => new SandboxConfig({ timeout: 0 })).toThrow(ValidationError);
  });

  it("test_timeout_max_validation", () => {
    expect(() => new SandboxConfig({ timeout: 86401 })).toThrow(ValidationError);
  });

  it("test_to_create_payload", () => {
    const cfg = new SandboxConfig({
      template: "python3",
      timeout: 600,
      env_vars: { FOO: "bar" },
      metadata: { owner: "test" },
      auto_pause: true,
    });
    const payload = cfg.toCreatePayload();
    expect(payload["templateID"]).toBe("python3");
    expect(payload["timeout"]).toBe(600);
    expect(payload["envVars"]).toEqual({ FOO: "bar" });
    expect(payload["metadata"]).toEqual({ owner: "test" });
    expect(payload["autoPause"]).toBe(true);
  });

  it("test_to_create_payload_defaults", () => {
    const cfg = new SandboxConfig();
    const payload = cfg.toCreatePayload();
    expect(payload["templateID"]).toBe("base");
    expect(payload["timeout"]).toBe(300);
    expect(payload["envVars"]).toEqual({});
    expect(payload["autoPause"]).toBe(false);
  });

  it("test_alias_construction", () => {
    // Test constructing SandboxConfig via camelCase aliases.
    const cfg = SandboxConfig.modelValidate({
      templateID: "node-base",
      timeout: 600,
      envVars: { X: "1" },
      autoPause: true,
    });
    expect(cfg.template).toBe("node-base");
    expect(cfg.env_vars).toEqual({ X: "1" });
    expect(cfg.auto_pause).toBe(true);
  });
});

describe("TestSandboxInfo", () => {
  it("test_from_alias_dict", () => {
    const data = {
      sandboxID: "sbx-123",
      templateID: "python3",
      status: "running",
      startedAt: "2025-01-01T00:00:00Z",
      envdUrl: "https://env.example.com",
      envdAccessToken: "tok-abc",
    };
    const info = new SandboxInfo(data);
    expect(info.sandbox_id).toBe("sbx-123");
    expect(info.template).toBe("python3");
    expect(info.status).toBe(SandboxStatus.RUNNING);
    expect(info.started_at).not.toBeNull();
    expect(info.envd_url).toBe("https://env.example.com");
    expect(info.envd_access_token).toBe("tok-abc");
  });

  it("test_from_python_names", () => {
    const info = new SandboxInfo({ sandbox_id: "sbx-456", template: "node" });
    expect(info.sandbox_id).toBe("sbx-456");
  });

  it("test_json_roundtrip", () => {
    const data = {
      sandboxID: "sbx-789",
      templateID: "go",
      status: "creating",
    };
    const info = new SandboxInfo(data);
    const json_str = info.modelDumpJson({ by_alias: true });
    const info2 = SandboxInfo.modelValidateJson(json_str);
    expect(info2.sandbox_id).toBe(info.sandbox_id);
    expect(info2.template).toBe(info.template);
    expect(info2.status).toBe(info.status);
  });

  it("test_defaults", () => {
    const info = new SandboxInfo({ sandbox_id: "sbx-def" });
    expect(info.template).toBe("");
    expect(info.status).toBe(SandboxStatus.RUNNING);
    expect(info.started_at).toBeNull();
    expect(info.metadata).toEqual({});
    expect(info.timeout).toBe(300);
    expect(info.region).toBe("cn-hangzhou");
  });

  it("test_new_fields", () => {
    const data = {
      sandboxID: "sbx-new",
      envdAccessToken: "tok-new",
      envdVersion: "1.2.3",
      clientID: "client-abc",
      accountID: "acct-xyz",
      userID: "user-123",
    };
    const info = new SandboxInfo(data);
    expect(info.envd_access_token).toBe("tok-new");
    expect(info.envd_version).toBe("1.2.3");
    expect(info.client_id).toBe("client-abc");
    expect(info.account_id).toBe("acct-xyz");
    expect(info.user_id).toBe("user-123");
  });

  it("test_model_validate", () => {
    // Test model_validate with camelCase dict.
    const data = {
      sandboxID: "sbx-mv",
      templateID: "base",
      status: "running",
      envdAccessToken: "tok",
      timeout: 300,
      region: "cn-hangzhou",
    };
    const info = SandboxInfo.modelValidate(data);
    expect(info.sandbox_id).toBe("sbx-mv");
    expect(info.template).toBe("base");
    expect(info.envd_access_token).toBe("tok");
  });
});
