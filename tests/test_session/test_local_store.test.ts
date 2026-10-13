/** Tests for LocalSessionStore CRUD operations. */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { SessionInfo } from "../../src/models/session.js";
import { LocalSessionStore } from "../../src/session/local.js";

let store: LocalSessionStore;

beforeEach(() => {
  // Provide a LocalSessionStore backed by a temporary directory.
  const tmp_path = mkdtempSync(join(tmpdir(), "abx-store-"));
  store = new LocalSessionStore(join(tmp_path, "sessions"));
});

function _make_session(
  opts: { name?: string; sandbox_id?: string; template?: string; status?: string } = {},
): SessionInfo {
  const { name = "test-session", sandbox_id = "sbx-001", template = "base", status = "running" } = opts;
  return new SessionInfo({
    name,
    sandbox_id,
    template,
    status,
    created_at: new Date(),
    metadata: { owner: "test" },
  });
}

describe("TestSave", () => {
  it("test_save_creates_file", async () => {
    const session = _make_session();
    await store.save("test-session", session);

    const fpath = store._pathFor("test-session");
    expect(existsSync(fpath)).toBe(true);
    const data = JSON.parse(readFileSync(fpath, "utf-8"));
    expect(data["name"]).toBe("test-session");
    expect(data["sandboxId"]).toBe("sbx-001");
  });

  it("test_save_overwrites", async () => {
    const s1 = _make_session({ sandbox_id: "sbx-001" });
    const s2 = _make_session({ sandbox_id: "sbx-002" });

    await store.save("test-session", s1);
    await store.save("test-session", s2);

    const loaded = await store.load("test-session");
    expect(loaded).not.toBeNull();
    expect(loaded!.sandbox_id).toBe("sbx-002");
  });
});

describe("TestLoad", () => {
  it("test_load_existing", async () => {
    const session = _make_session();
    await store.save("my-session", session);

    const loaded = await store.load("my-session");
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe("test-session");
    expect(loaded!.sandbox_id).toBe("sbx-001");
    expect(loaded!.template).toBe("base");
  });

  it("test_load_nonexistent", async () => {
    const result = await store.load("does-not-exist");
    expect(result).toBeNull();
  });
});

describe("TestDelete", () => {
  it("test_delete_existing", async () => {
    const session = _make_session();
    await store.save("del-me", session);
    expect(await store.load("del-me")).not.toBeNull();

    await store.delete("del-me");
    expect(await store.load("del-me")).toBeNull();
  });

  it("test_delete_nonexistent", async () => {
    // Should not raise
    await store.delete("nope");
  });
});

describe("TestListAll", () => {
  it("test_list_empty", async () => {
    const result = await store.listAll();
    expect(result).toEqual([]);
  });

  it("test_list_multiple", async () => {
    for (let i = 0; i < 3; i++) {
      const s = _make_session({ name: `session-${i}`, sandbox_id: `sbx-${i}` });
      await store.save(`session-${i}`, s);
    }

    const result = await store.listAll();
    expect(result.length).toBe(3);
    const names = new Set(result.map((s) => s.name));
    expect(names).toEqual(new Set(["session-0", "session-1", "session-2"]));
  });

  it("test_list_skips_corrupt_files", async () => {
    // Write valid session
    const s = _make_session();
    await store.save("good", s);

    // Write corrupt JSON
    const corrupt = store._pathFor("bad");
    writeFileSync(corrupt, "NOT VALID JSON", "utf-8");

    const result = await store.listAll();
    expect(result.length).toBe(1);
    expect(result[0]!.name).toBe("test-session");
  });
});

describe("TestSanitisedNames", () => {
  it("test_special_chars", async () => {
    const session = _make_session({ name: "my/special:session" });
    await store.save("my/special:session", session);

    const loaded = await store.load("my/special:session");
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe("my/special:session");
  });
});
