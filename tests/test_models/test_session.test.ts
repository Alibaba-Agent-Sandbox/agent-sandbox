/** Tests for session data models. */

import { describe, expect, it } from "vitest";

import { SessionConfig, SessionInfo } from "../../src/models/session.js";

describe("TestSessionConfig", () => {
  it("test_defaults", () => {
    const cfg = new SessionConfig({ name: "test-session" });
    expect(cfg.name).toBe("test-session");
    expect(cfg.description).toBe("");
    expect(cfg.sandbox_template).toBe("base");
    expect(cfg.auto_connect).toBe(true);
    expect(cfg.ttl).toBe(86400);
    expect(cfg.envs).toEqual({});
    expect(cfg.metadata).toEqual({});
  });

  it("test_custom_values", () => {
    const cfg = new SessionConfig({
      name: "dev",
      description: "Dev session",
      sandbox_template: "python3",
      auto_connect: false,
      ttl: 3600,
      envs: { KEY: "val" },
      metadata: { owner: "me" },
    });
    expect(cfg.name).toBe("dev");
    expect(cfg.description).toBe("Dev session");
    expect(cfg.sandbox_template).toBe("python3");
    expect(cfg.auto_connect).toBe(false);
    expect(cfg.ttl).toBe(3600);
  });
});

describe("TestSessionInfo", () => {
  it("test_from_aliases", () => {
    const data = {
      sessionId: "sess-001",
      name: "test",
      sandboxId: "sbx-111",
      status: "active",
      createdAt: "2025-06-01T12:00:00Z",
      lastConnected: "2025-06-01T13:00:00Z",
    };
    const info = new SessionInfo(data);
    expect(info.session_id).toBe("sess-001");
    expect(info.name).toBe("test");
    expect(info.sandbox_id).toBe("sbx-111");
    expect(info.created_at).not.toBeNull();
    expect(info.last_connected).not.toBeNull();
  });

  it("test_from_python_names", () => {
    const info = new SessionInfo({ session_id: "sess-002", name: "dev" });
    expect(info.session_id).toBe("sess-002");
  });

  it("test_defaults", () => {
    const info = new SessionInfo({ session_id: "sess-005", name: "x" });
    expect(info.sandbox_id).toBeNull();
    expect(info.status).toBe("active");
    expect(info.created_at).toBeNull();
    expect(info.last_connected).toBeNull();
    expect(info.config).toBeNull();
  });
});
