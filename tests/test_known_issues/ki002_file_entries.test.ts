/**
 * KI-002: `files.list` / `files.getInfo` must understand envd's `EntryInfo`.
 *
 * Shapes below were captured from a real envd 0.5.2 sandbox:
 *
 *     ListDir -> {"entries": [{"name": "sub", "path": "/tmp/pr/sub", "type": 2, "size": 4096, ...}]}
 *     Stat    -> {"entry": {"name": "f.txt", "path": "/tmp/pr/f.txt", "type": 1, "size": 6, ...}}
 *
 * `type` is the protobuf enum `FILE_TYPE_FILE = 1` / `FILE_TYPE_DIRECTORY = 2`; `Stat` nests the entry under `entry`.
 */

import { describe, expect, it } from "vitest";

import { FilesModule } from "../../src/api/files.js";
import { FileType } from "../../src/models/filesystem.js";
import { FilesystemProtocol, _parseFileInfo, _unwrapEntry } from "../../src/providers/shared/e2b/filesystem.js";
import { useIsolatedEnv, useTransportIsolation } from "../_support/env.js";
import { useHttpxMock } from "../helpers/httpxMock.js";
import { ENVD, makeHttp, token } from "./_helpers.js";

const iso = useIsolatedEnv();
useTransportIsolation(iso);
const httpx_mock = useHttpxMock();

const LIST_URL = `${ENVD}/filesystem.Filesystem/ListDir`;
const STAT_URL = `${ENVD}/filesystem.Filesystem/Stat`;

function entry(name: string, type: unknown, size: unknown, base = "/tmp/pr"): Record<string, unknown> {
  return {
    group: "1000",
    mode: 420,
    modifiedTime: "2026-10-12T12:01:49Z",
    name,
    owner: "1000",
    path: `${base}/${name}`,
    permissions: "-rw-r--r--",
    size,
    type,
  };
}

const files = () => new FilesModule(ENVD, token(), new FilesystemProtocol(makeHttp()));

describe("KI-002 file entries", () => {
  it("test_list_reports_directories_and_files_from_numeric_type", async () => {
    httpx_mock.add_response({
      url: LIST_URL,
      method: "POST",
      json: { entries: [entry("f.txt", 1, 6), entry("ln", 1, 13), entry("sub", 2, 4096)] },
    });
    const entries = Object.fromEntries((await files().list("/tmp/pr")).map((e) => [e.name, e]));
    expect(entries["sub"]!.type).toBe(FileType.DIRECTORY);
    expect(entries["f.txt"]!.type).toBe(FileType.FILE);
    expect(entries["ln"]!.type).toBe(FileType.FILE);
    expect(entries["f.txt"]!.path).toBe("/tmp/pr/f.txt");
    expect(entries["f.txt"]!.size).toBe(6);
  });

  it("test_get_info_unwraps_entry_object_for_a_file", async () => {
    httpx_mock.add_response({ url: STAT_URL, method: "POST", json: { entry: entry("f.txt", 1, 6) } });
    const info = await files().getInfo("/tmp/pr/f.txt");
    expect([info.name, info.path, info.size, info.type]).toEqual(["f.txt", "/tmp/pr/f.txt", 6, FileType.FILE]);
  });

  it("test_get_info_reports_a_directory", async () => {
    httpx_mock.add_response({ url: STAT_URL, method: "POST", json: { entry: entry("sub", 2, 4096) } });
    const info = await files().getInfo("/tmp/pr/sub");
    expect(info.type).toBe(FileType.DIRECTORY);
    expect(info.name).toBe("sub");
  });

  it.each<[unknown, FileType]>([
    [2, FileType.DIRECTORY],
    ["2", FileType.DIRECTORY],
    ["FILE_TYPE_DIRECTORY", FileType.DIRECTORY],
    ["directory", FileType.DIRECTORY],
    [1, FileType.FILE],
    ["FILE_TYPE_FILE", FileType.FILE],
    ["file", FileType.FILE],
    [0, FileType.FILE],
    [undefined, FileType.FILE],
  ])("test_entry_type_spellings(%s)", (rawType, expected) => {
    const data = entry("x", rawType, 1);
    if (rawType === undefined) delete data["type"];
    expect(_parseFileInfo(data).type).toBe(expected);
  });

  it("test_protobuf_json_int64_size_arrives_as_a_string", () => {
    expect(_parseFileInfo(entry("x", 1, "5")).size).toBe(5);
    expect(_parseFileInfo(entry("x", 1, "not-a-number")).size).toBe(0);
    expect(_parseFileInfo(entry("x", 1, null)).size).toBe(0);
  });

  it("test_name_falls_back_to_the_path_when_the_entry_has_none", () => {
    const data = entry("x", 1, 1);
    delete data["name"];
    expect(_parseFileInfo(data).name).toBe("x");
  });

  it("test_flat_legacy_shapes_still_parse", () => {
    expect(_parseFileInfo({ name: "d", path: "/d", isDir: true, size: 0 }).type).toBe(FileType.DIRECTORY);
    const wrapped = { result: { entry: entry("y", 2, 0) } };
    expect(_parseFileInfo(_unwrapEntry(wrapped)).type).toBe(FileType.DIRECTORY);
    expect(_unwrapEntry({ name: "flat" })).toEqual({ name: "flat" });
  });
});
