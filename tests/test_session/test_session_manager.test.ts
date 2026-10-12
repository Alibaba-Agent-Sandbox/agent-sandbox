/** Tests for SessionManager (mock Sandbox). */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Sandbox } from "../../src/api/sandbox.js";
import { SessionManager } from "../../src/api/session_manager.js";
import { SessionAlreadyExistsError, SessionNotFoundError } from "../../src/models/errors.js";
import { PyDatetime } from "../../src/models/_pydantic.js";
import { SandboxInfo } from "../../src/models/sandbox.js";
import { SessionInfo } from "../../src/models/session.js";
import { LocalSessionStore } from "../../src/session/local.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

let store: LocalSessionStore;
let manager: SessionManager;

beforeEach(() => {
  const tmp_path = mkdtempSync(join(tmpdir(), "ebx-mgr-"));
  store = new LocalSessionStore(join(tmp_path, "sessions"));
  manager = new SessionManager(store);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function _mock_sandbox(opts: { sandbox_id?: string; template?: string } = {}): any {
  const { sandbox_id = "sbx-mgr-001", template = "base" } = opts;
  const sb_info = SandboxInfo.modelValidate({
    sandboxID: sandbox_id,
    templateID: template,
    status: "running",
    region: "cn-hangzhou",
    timeout: 300,
    envdUrl: `https://${sandbox_id}.e2b.fc.aliyuncs.com`,
    envdAccessToken: "tok-test-123",
  });
  return { id: sb_info.sandbox_id, status: sb_info.status, url: sb_info.envd_url, info: sb_info };
}

describe("TestStart", () => {
  it("test_start_creates_session", async () => {
    const mock_sb = _mock_sandbox();
    vi.spyOn(Sandbox, "create").mockResolvedValue(mock_sb);
    const sandbox = await manager.start("my-project", "base", { timeout: 120 });

    expect(sandbox.id).toBe("sbx-mgr-001");

    // Check session was persisted
    const session = await store.load("my-project");
    expect(session).not.toBeNull();
    expect(session!.name).toBe("my-project");
    expect(session!.sandbox_id).toBe("sbx-mgr-001");
    expect(session!.template).toBe("base");
    expect(session!.status).toBe("running");
  });

  it("test_start_duplicate_raises", async () => {
    const mock_sb = _mock_sandbox();
    vi.spyOn(Sandbox, "create").mockResolvedValue(mock_sb);
    await manager.start("dup-session");

    await expect(manager.start("dup-session")).rejects.toBeInstanceOf(SessionAlreadyExistsError);
  });
});

describe("TestConnect", () => {
  it("test_connect_existing", async () => {
    // Pre-populate a session
    const session = new SessionInfo({
      name: "saved-session",
      sandbox_id: "sbx-saved-001",
      template: "python3",
      status: "running",
      created_at: PyDatetime.fromDate(new Date()),
    });
    await store.save("saved-session", session);

    const mock_sb = _mock_sandbox({ sandbox_id: "sbx-saved-001" });
    vi.spyOn(Sandbox, "connect").mockResolvedValue(mock_sb);
    const sandbox = await manager.connect("saved-session");

    expect(sandbox.id).toBe("sbx-saved-001");

    // last_connected should have been updated
    const updated = await store.load("saved-session");
    expect(updated).not.toBeNull();
    expect(updated!.last_connected).not.toBeNull();
  });

  it("test_connect_nonexistent", async () => {
    await expect(manager.connect("ghost")).rejects.toBeInstanceOf(SessionNotFoundError);
  });
});

describe("TestListSessions", () => {
  it("test_list_empty", async () => {
    const result = await manager.listSessions();
    expect(result).toEqual([]);
  });

  it("test_list_populated", async () => {
    for (let i = 0; i < 2; i++) {
      const s = new SessionInfo({ name: `s-${i}`, sandbox_id: `sbx-${i}`, template: "base", status: "running" });
      await store.save(`s-${i}`, s);
    }

    const result = await manager.listSessions();
    expect(result.length).toBe(2);
  });
});

describe("TestStop", () => {
  it("test_stop_kills_and_deletes", async () => {
    const session = new SessionInfo({ name: "to-stop", sandbox_id: "sbx-stop-001", template: "base", status: "running" });
    await store.save("to-stop", session);

    const mock_kill = vi.spyOn(Sandbox, "killById").mockResolvedValue(undefined as any);
    await manager.stop("to-stop", { kill: true });

    expect(mock_kill).toHaveBeenCalledTimes(1);
    expect(mock_kill).toHaveBeenCalledWith("sbx-stop-001");
    expect(await store.load("to-stop")).toBeNull();
  });

  it("test_stop_keep_alive", async () => {
    const session = new SessionInfo({ name: "keep-me", sandbox_id: "sbx-keep-001", template: "base", status: "running" });
    await store.save("keep-me", session);

    await manager.stop("keep-me", { kill: false });

    const kept = await store.load("keep-me");
    expect(kept).not.toBeNull();
    expect(kept!.status).toBe("stopped");
  });

  it("test_stop_nonexistent", async () => {
    await expect(manager.stop("nothing")).rejects.toBeInstanceOf(SessionNotFoundError);
  });
});

describe("TestGetInfo", () => {
  it("test_get_info_existing", async () => {
    const session = new SessionInfo({ name: "info-session", sandbox_id: "sbx-info-001", template: "base", status: "running" });
    await store.save("info-session", session);

    const info = await manager.getInfo("info-session");
    expect(info.name).toBe("info-session");
    expect(info.sandbox_id).toBe("sbx-info-001");
  });

  it("test_get_info_nonexistent", async () => {
    await expect(manager.getInfo("nope")).rejects.toBeInstanceOf(SessionNotFoundError);
  });
});
