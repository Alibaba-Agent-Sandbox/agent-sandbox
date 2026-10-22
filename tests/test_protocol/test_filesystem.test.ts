/** Tests for protocol.filesystem module — envd filesystem operations. */

import { describe, expect, it, vi } from "vitest";

import { FileInfo, FileType, WatchEvent, WatchEventType } from "../../src/models/filesystem.js";
import { FilesystemProtocol, _nameFromPath, _parseFileInfo, _parseWatchEvent } from "../../src/providers/shared/e2b/filesystem.js";
import { Request, Response } from "../../src/transport/_httpx.js";
import { EnvdTokenManager } from "../../src/providers/alicloud_express/auth.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const envd_token = () => new EnvdTokenManager("test-envd-token");
const envd_url = () => "https://envd-sbx-123.example.com";

function _makeMockHttp(
  opts: { envd_request_return?: Record<string, any> | null; stream_frames?: Record<string, any>[] | null; envd_http_response?: Response | null } = {},
): any {
  // Create a mock HttpClient.
  const { envd_request_return = null, stream_frames = null, envd_http_response = null } = opts;
  const mock: any = {};
  mock.envdRequest = vi.fn(async () => (envd_request_return !== null ? envd_request_return : {}));

  if (envd_http_response !== null) {
    mock.envdHttpRequest = vi.fn(async () => envd_http_response);
  } else {
    // Default: return a 200 response with empty content
    const default_resp = new Response(200, { request: new Request("GET", "https://fake"), content: new Uint8Array() });
    mock.envdHttpRequest = vi.fn(async () => default_resp);
  }

  if (stream_frames !== null) {
    mock.envdStream = async function* (..._args: any[]) {
      for (const frame of stream_frames) yield frame;
    };
  } else {
    mock.envdStream = async function* (..._args: any[]) {
      return;
    };
  }
  return mock;
}

const fakeResponse = (content: Uint8Array) => new Response(200, { request: new Request("GET", "https://fake"), content });

// =============================================================================
// Tests for _parse_file_info
// =============================================================================

describe("TestParseFileInfo", () => {
  // Test _parse_file_info helper.
  it("test_parse_file", () => {
    const info = _parseFileInfo({ name: "test.py", path: "/app/test.py", size: 1024 });
    expect(info.name).toBe("test.py");
    expect(info.path).toBe("/app/test.py");
    expect(info.type).toBe(FileType.FILE);
    expect(info.size).toBe(1024);
  });

  it("test_parse_directory_is_dir_flag", () => {
    const info = _parseFileInfo({ name: "src", path: "/app/src", isDir: true, size: 0 });
    expect(info.type).toBe(FileType.DIRECTORY);
  });

  it("test_parse_directory_type_field", () => {
    const info = _parseFileInfo({ name: "docs", path: "/app/docs", type: "directory", size: 0 });
    expect(info.type).toBe(FileType.DIRECTORY);
  });

  it("test_parse_defaults", () => {
    // Empty dict → all defaults (no path to fallback for name).
    const info = _parseFileInfo({});
    expect(info.name).toBe("");
    expect(info.path).toBe("");
    expect(info.type).toBe(FileType.FILE);
    expect(info.size).toBe(0);
  });

  // --- name fallback from path ---

  it("test_name_fallback_unix_path", () => {
    // Missing name → derived from Unix path.
    const info = _parseFileInfo({ path: "/app/test.py", size: 10 });
    expect(info.name).toBe("test.py");
  });

  it("test_name_fallback_empty_string", () => {
    // Explicit empty-string name → derived from path.
    const info = _parseFileInfo({ name: "", path: "/var/log/app.log" });
    expect(info.name).toBe("app.log");
  });

  it("test_name_fallback_trailing_slash", () => {
    // Trailing slash is stripped before extracting segment.
    const info = _parseFileInfo({ path: "/app/src/", isDir: true });
    expect(info.name).toBe("src");
  });

  it("test_name_fallback_root_path", () => {
    // Root path '/' has no valid segment → name stays empty.
    const info = _parseFileInfo({ path: "/" });
    expect(info.name).toBe("");
  });

  it("test_name_fallback_relative_path", () => {
    // Relative path without leading slash.
    const info = _parseFileInfo({ path: "relative/path.txt" });
    expect(info.name).toBe("path.txt");
  });

  it("test_name_fallback_bare_filename", () => {
    // Path is a bare filename (no separators).
    const info = _parseFileInfo({ path: "notes.md" });
    expect(info.name).toBe("notes.md");
  });

  it("test_name_fallback_windows_path", () => {
    // Windows-style backslash path.
    const info = _parseFileInfo({ path: "C:\\Users\\test\\file.txt" });
    expect(info.name).toBe("file.txt");
  });

  it("test_name_fallback_windows_trailing_backslash", () => {
    // Windows path with trailing backslash.
    const info = _parseFileInfo({ path: "C:\\Users\\docs\\", isDir: true });
    expect(info.name).toBe("docs");
  });

  it("test_name_explicit_preserved", () => {
    // Explicit non-empty name from server is always preserved.
    const info = _parseFileInfo({ name: "custom.txt", path: "/app/other.txt" });
    expect(info.name).toBe("custom.txt");
  });

  it("test_name_fallback_double_slash", () => {
    // Multiple trailing slashes handled.
    const info = _parseFileInfo({ path: "/app/dir//" });
    expect(info.name).toBe("dir");
  });

  it("test_name_fallback_mixed_separators", () => {
    // Mixed / and \ separators.
    const info = _parseFileInfo({ path: "C:\\project/src/main.py" });
    expect(info.name).toBe("main.py");
  });

  // --- type detection (OR logic) ---

  it("test_type_isdir_true_only", () => {
    const info = _parseFileInfo({ name: "d", path: "/d", isDir: true });
    expect(info.type).toBe(FileType.DIRECTORY);
  });

  it("test_type_type_directory_only", () => {
    const info = _parseFileInfo({ name: "d", path: "/d", type: "directory" });
    expect(info.type).toBe(FileType.DIRECTORY);
  });

  it("test_type_isdir_false_and_type_directory", () => {
    // isDir=False + type='directory' → trust type field (OR logic).
    const info = _parseFileInfo({ name: "d", path: "/d", isDir: false, type: "directory" });
    expect(info.type).toBe(FileType.DIRECTORY);
  });

  it("test_type_isdir_false_no_type", () => {
    const info = _parseFileInfo({ name: "f", path: "/f", isDir: false });
    expect(info.type).toBe(FileType.FILE);
  });

  it("test_type_no_signals", () => {
    const info = _parseFileInfo({ name: "f", path: "/f" });
    expect(info.type).toBe(FileType.FILE);
  });
});

// =============================================================================
// Tests for _name_from_path (standalone helper)
// =============================================================================

describe("TestNameFromPath", () => {
  // Test _name_from_path edge cases.
  it("test_empty", () => {
    expect(_nameFromPath("")).toBe("");
  });

  it("test_root", () => {
    expect(_nameFromPath("/")).toBe("");
  });

  it("test_double_root", () => {
    expect(_nameFromPath("//")).toBe("");
  });

  it("test_backslash_root", () => {
    expect(_nameFromPath("\\")).toBe("");
  });

  it("test_unix_abs", () => {
    expect(_nameFromPath("/usr/local/bin")).toBe("bin");
  });

  it("test_unix_trailing", () => {
    expect(_nameFromPath("/usr/local/bin/")).toBe("bin");
  });

  it("test_windows", () => {
    expect(_nameFromPath("C:\\Windows\\System32")).toBe("System32");
  });

  it("test_windows_trailing", () => {
    expect(_nameFromPath("C:\\Windows\\")).toBe("Windows");
  });

  it("test_bare_name", () => {
    expect(_nameFromPath("file.txt")).toBe("file.txt");
  });

  it("test_relative", () => {
    expect(_nameFromPath("a/b/c")).toBe("c");
  });

  it("test_mixed_sep", () => {
    expect(_nameFromPath("a\\b/c")).toBe("c");
  });

  it("test_drive_only", () => {
    // 'C:\' stripped to 'C:' which is returned as the name.
    expect(_nameFromPath("C:\\")).toBe("C:");
  });
});

// =============================================================================
// Tests for _parse_watch_event
// =============================================================================

describe("TestParseWatchEvent", () => {
  // Test _parse_watch_event helper.
  it("test_created_event", () => {
    const event = _parseWatchEvent({ type: "created", path: "/app/new.py" });
    expect(event.type).toBe(WatchEventType.CREATED);
    expect(event.path).toBe("/app/new.py");
  });

  it("test_modified_event", () => {
    const event = _parseWatchEvent({ type: "modified", path: "/app/mod.py" });
    expect(event.type).toBe(WatchEventType.MODIFIED);
  });

  it("test_deleted_event", () => {
    const event = _parseWatchEvent({ type: "deleted", path: "/app/old.py" });
    expect(event.type).toBe(WatchEventType.DELETED);
  });

  it("test_renamed_event", () => {
    const event = _parseWatchEvent({ type: "renamed", path: "/app/new_name.py", oldPath: "/app/old_name.py" });
    expect(event.type).toBe(WatchEventType.RENAMED);
    expect(event.old_path).toBe("/app/old_name.py");
  });

  it("test_short_form_event_types", () => {
    expect(_parseWatchEvent({ type: "create", path: "" }).type).toBe(WatchEventType.CREATED);
    expect(_parseWatchEvent({ type: "modify", path: "" }).type).toBe(WatchEventType.MODIFIED);
    expect(_parseWatchEvent({ type: "delete", path: "" }).type).toBe(WatchEventType.DELETED);
    expect(_parseWatchEvent({ type: "rename", path: "" }).type).toBe(WatchEventType.RENAMED);
  });

  it("test_result_wrapper", () => {
    const event = _parseWatchEvent({ result: { type: "created", path: "/app/x" } });
    expect(event.type).toBe(WatchEventType.CREATED);
    expect(event.path).toBe("/app/x");
  });

  it("test_unknown_type_defaults_to_modified", () => {
    const event = _parseWatchEvent({ type: "unknown", path: "/app/x" });
    expect(event.type).toBe(WatchEventType.MODIFIED);
  });
});

// =============================================================================
// Tests for FilesystemProtocol
// =============================================================================

describe("TestListDir", () => {
  // Test FilesystemProtocol.list_dir().
  it("test_parses_entries", async () => {
    const mock_http = _makeMockHttp({
      envd_request_return: {
        entries: [
          { name: "file.txt", path: "/file.txt", size: 100 },
          { name: "dir", path: "/dir", isDir: true, size: 0 },
        ],
      },
    });
    const proto = new FilesystemProtocol(mock_http);
    const result = await proto.listDir(envd_url(), envd_token(), { path: "/" });

    expect(result.length).toBe(2);
    expect(result[0]!.name).toBe("file.txt");
    expect(result[0]!.type).toBe(FileType.FILE);
    expect(result[1]!.name).toBe("dir");
    expect(result[1]!.type).toBe(FileType.DIRECTORY);
  });

  it("test_empty_directory", async () => {
    const mock_http = _makeMockHttp({ envd_request_return: { entries: [] } });
    const proto = new FilesystemProtocol(mock_http);
    const result = await proto.listDir(envd_url(), envd_token(), { path: "/empty" });
    expect(result).toEqual([]);
  });
});

describe("TestExists", () => {
  // Test FilesystemProtocol.exists() — now via stat().
  it("test_exists_true", async () => {
    // exists() returns True when stat() succeeds.
    const mock_http = _makeMockHttp({ envd_request_return: { name: "file.py", path: "/app/file.py", size: 100 } });
    const proto = new FilesystemProtocol(mock_http);
    expect(await proto.exists(envd_url(), envd_token(), { path: "/app/file.py" })).toBe(true);
  });

  it("test_exists_false", async () => {
    // exists() returns False when stat() raises an exception.
    const mock_http = _makeMockHttp();
    mock_http.envdRequest.mockRejectedValue(new Error("not found"));
    const proto = new FilesystemProtocol(mock_http);
    expect(await proto.exists(envd_url(), envd_token(), { path: "/nonexistent" })).toBe(false);
  });
});

describe("TestGetInfo", () => {
  // Test FilesystemProtocol.get_info().
  it("test_get_file_info", async () => {
    const mock_http = _makeMockHttp({ envd_request_return: { name: "app.py", path: "/app/app.py", size: 2048 } });
    const proto = new FilesystemProtocol(mock_http);
    const info = await proto.stat(envd_url(), envd_token(), { path: "/app/app.py" });

    expect(info).toBeInstanceOf(FileInfo);
    expect(info.name).toBe("app.py");
    expect(info.size).toBe(2048);
  });
});

describe("TestRead", () => {
  // Test FilesystemProtocol.read() — now uses HTTP file API (download_file).
  it("test_returns_bytes", async () => {
    const mock_http = _makeMockHttp({ envd_http_response: fakeResponse(Buffer.from("hello world")) });
    const proto = new FilesystemProtocol(mock_http);
    const result = await proto.read(envd_url(), envd_token(), { path: "/app/test.txt" });
    expect(Buffer.from(result)).toEqual(Buffer.from("hello world"));
  });

  it("test_binary_content", async () => {
    const mock_http = _makeMockHttp({ envd_http_response: fakeResponse(Uint8Array.from([0, 1, 2])) });
    const proto = new FilesystemProtocol(mock_http);
    const result = await proto.read(envd_url(), envd_token(), { path: "/app/bin" });
    expect(Buffer.from(result)).toEqual(Buffer.from([0, 1, 2]));
  });
});

describe("TestReadText", () => {
  // Test FilesystemProtocol.read_text() — delegates to read() then decodes.
  it("test_returns_string", async () => {
    const mock_http = _makeMockHttp({ envd_http_response: fakeResponse(Buffer.from("你好世界", "utf-8")) });
    const proto = new FilesystemProtocol(mock_http);
    const result = await proto.readText(envd_url(), envd_token(), { path: "/app/test.txt" });
    expect(result).toBe("你好世界");
  });
});

describe("TestWrite", () => {
  // Test FilesystemProtocol.write() — now uses HTTP file API (upload_file).
  it("test_writes_string", async () => {
    const mock_http = _makeMockHttp();
    const proto = new FilesystemProtocol(mock_http);
    await proto.write(envd_url(), envd_token(), { path: "/app/out.txt", content: "hello" });

    expect(mock_http.envdHttpRequest).toHaveBeenCalledTimes(1);
    const call_args = mock_http.envdHttpRequest.mock.calls[0];
    expect(call_args[2]).toBe("/files"); // path
    expect(call_args[3]["params"]["path"]).toBe("/app/out.txt");
  });

  it("test_writes_bytes", async () => {
    const mock_http = _makeMockHttp();
    const proto = new FilesystemProtocol(mock_http);
    await proto.write(envd_url(), envd_token(), { path: "/app/bin", content: Uint8Array.from([0, 1, 2]) });

    expect(mock_http.envdHttpRequest).toHaveBeenCalledTimes(1);
  });
});

describe("TestMakeDir", () => {
  // Test FilesystemProtocol.make_dir().
  it("test_sends_path", async () => {
    const mock_http = _makeMockHttp();
    const proto = new FilesystemProtocol(mock_http);
    await proto.makeDir(envd_url(), envd_token(), { path: "/app/new_dir" });

    const payload = mock_http.envdRequest.mock.calls.at(-1)[2]["payload"];
    expect(payload).toEqual({ path: "/app/new_dir" });
  });
});

describe("TestRemove", () => {
  // Test FilesystemProtocol.remove().
  it("test_sends_path", async () => {
    const mock_http = _makeMockHttp();
    const proto = new FilesystemProtocol(mock_http);
    await proto.remove(envd_url(), envd_token(), { path: "/app/old.txt" });

    const payload = mock_http.envdRequest.mock.calls.at(-1)[2]["payload"];
    expect(payload).toEqual({ path: "/app/old.txt" });
  });
});

describe("TestRename", () => {
  // Test FilesystemProtocol.move() — delegates to move() with source/destination.
  it("test_sends_old_and_new_paths", async () => {
    const mock_http = _makeMockHttp();
    const proto = new FilesystemProtocol(mock_http);
    await proto.move(envd_url(), envd_token(), { source: "/app/a.txt", destination: "/app/b.txt" });

    const payload = mock_http.envdRequest.mock.calls.at(-1)[2]["payload"];
    expect(payload).toEqual({ source: "/app/a.txt", destination: "/app/b.txt" });
  });
});

describe("TestWatchDir", () => {
  // Test FilesystemProtocol.watch_dir().
  it("test_returns_stream_reader", async () => {
    const mock_http = _makeMockHttp({
      stream_frames: [
        { type: "created", path: "/app/new.py" },
        { type: "modified", path: "/app/new.py" },
      ],
    });
    const proto = new FilesystemProtocol(mock_http);
    const reader = await proto.watchDir(envd_url(), envd_token(), { path: "/app" });

    const events: WatchEvent[] = [];
    for await (const event of reader) events.push(event);

    expect(events.length).toBe(2);
    expect(events[0]!.type).toBe(WatchEventType.CREATED);
    expect(events[1]!.type).toBe(WatchEventType.MODIFIED);
  });
});
