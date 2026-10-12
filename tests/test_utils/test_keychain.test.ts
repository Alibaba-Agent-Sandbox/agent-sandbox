/** Tests for SecretStore file-based storage. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SecretStore } from "../../src/utils/keychain.js";

let tmp_path: string;
let store: SecretStore;

// Provide a SecretStore backed by a temporary secrets file.
beforeEach(() => {
  tmp_path = fs.mkdtempSync(path.join(os.tmpdir(), "keychain-"));
  store = new SecretStore(path.join(tmp_path, "secrets.json"));
});

afterEach(() => {
  fs.rmSync(tmp_path, { recursive: true, force: true });
});

describe("TestSetAndGet", () => {
  it("test_set_and_get", () => {
    store.set("MY_API_KEY", "super-secret-123");
    expect(store.get("MY_API_KEY")).toBe("super-secret-123");
  });

  it("test_set_overwrites", () => {
    store.set("KEY", "v1");
    store.set("KEY", "v2");
    expect(store.get("KEY")).toBe("v2");
  });

  it("test_get_nonexistent_returns_none", () => {
    expect(store.get("nope")).toBeNull();
  });

  it("test_file_permissions", () => {
    // Secrets file should be chmod 600.
    store.set("KEY", "val");
    const mode = fs.statSync(store._secrets_file).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("test_file_is_valid_json", () => {
    store.set("A", "1");
    store.set("B", "2");
    const data = JSON.parse(fs.readFileSync(store._secrets_file, "utf-8"));
    expect(data).toEqual({ A: "1", B: "2" });
  });
});

describe("TestDelete", () => {
  it("test_delete_existing", () => {
    store.set("TO_DEL", "value");
    const result = store.delete("TO_DEL");
    expect(result).toBe(true);
    expect(store.get("TO_DEL")).toBeNull();
  });

  it("test_delete_nonexistent", () => {
    const result = store.delete("nope");
    expect(result).toBe(false);
  });
});

describe("TestListNames", () => {
  it("test_list_empty", () => {
    expect(store.listNames()).toEqual([]);
  });

  it("test_list_multiple", () => {
    store.set("BETA", "b");
    store.set("ALPHA", "a");
    store.set("GAMMA", "g");
    const names = store.listNames();
    expect(names).toEqual(["ALPHA", "BETA", "GAMMA"]); // sorted
  });
});

describe("TestCorruptFile", () => {
  it("test_corrupt_file_returns_empty", () => {
    // If the secrets file is corrupt JSON, operations degrade gracefully.
    fs.mkdirSync(path.dirname(store._secrets_file), { recursive: true });
    fs.writeFileSync(store._secrets_file, "NOT JSON!!!");
    expect(store.get("any")).toBeNull();
    expect(store.listNames()).toEqual([]);
  });
});
