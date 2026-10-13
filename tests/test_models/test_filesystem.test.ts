/** Tests for filesystem data models. */

import { describe, expect, it } from "vitest";

import { FileInfo, FileType, WatchEvent, WatchEventType } from "../../src/models/filesystem.js";

describe("TestFileType", () => {
  it("test_enum_values", () => {
    expect(FileType.FILE).toBe("file");
    expect(FileType.DIRECTORY).toBe("directory");
  });

  it("test_enum_count", () => {
    expect(Object.keys(FileType).length).toBe(2);
  });
});

describe("TestFileInfo", () => {
  it("test_all_fields", () => {
    const now = new Date();
    const info = new FileInfo({
      name: "test.py",
      path: "/home/user/test.py",
      type: FileType.FILE,
      size: 1234,
      modified: now,
    });
    expect(info.name).toBe("test.py");
    expect(info.path).toBe("/home/user/test.py");
    expect(info.type).toBe(FileType.FILE);
    expect(info.size).toBe(1234);
    expect(info.modified).not.toBeNull();
    expect((info.modified as Date).valueOf()).toBe(now.valueOf());
  });

  it("test_defaults", () => {
    const info = new FileInfo({ name: "a.txt", path: "/a.txt" });
    expect(info.type).toBe(FileType.FILE);
    expect(info.size).toBe(0);
    expect(info.modified).toBeNull();
  });

  it("test_directory_type", () => {
    const info = new FileInfo({ name: "src", path: "/src", type: FileType.DIRECTORY });
    expect(info.type).toBe(FileType.DIRECTORY);
  });
});

describe("TestWatchEventType", () => {
  it("test_enum_values", () => {
    expect(WatchEventType.CREATED).toBe("created");
    expect(WatchEventType.MODIFIED).toBe("modified");
    expect(WatchEventType.DELETED).toBe("deleted");
    expect(WatchEventType.RENAMED).toBe("renamed");
  });

  it("test_enum_count", () => {
    expect(Object.keys(WatchEventType).length).toBe(4);
  });
});

describe("TestWatchEvent", () => {
  it("test_serialization", () => {
    const event = new WatchEvent({
      type: WatchEventType.CREATED,
      path: "/home/user/new.txt",
      timestamp: 1234567890.0,
    });
    const d = event.modelDump();
    expect(d["type"]).toBe("created");
    expect(d["path"]).toBe("/home/user/new.txt");
    expect(d["old_path"]).toBeNull();
    expect(d["timestamp"]).toBe(1234567890.0);
  });

  it("test_rename_event", () => {
    const event = new WatchEvent({
      type: WatchEventType.RENAMED,
      path: "/new_name.txt",
      old_path: "/old_name.txt",
    });
    expect(event.old_path).toBe("/old_name.txt");
  });
});
