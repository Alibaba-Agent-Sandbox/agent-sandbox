/** Tests for the FilesModule API. */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { ProviderFeatureNotSupportedError } from "../../src/models/provider_errors.js";
import { FileInfo, FileType } from "../../src/models/filesystem.js";
import { TEST_ENVD_URL, makeFilesModule } from "./conftest.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const tmpPath = () => fs.mkdtempSync(path.join(os.tmpdir(), "abx-files-"));

describe("TestFilesRead", () => {
  // Test FilesModule.read() and read_bytes().
  it("test_read_returns_text", async () => {
    const { module: files_module, filesystem_protocol } = makeFilesModule();
    const result = await files_module.read("/app/main.py");
    expect(result).toBe("file content");
    expect(filesystem_protocol.readText).toHaveBeenCalledTimes(1);
    const call_kwargs = filesystem_protocol.readText.mock.calls[0][2];
    expect(call_kwargs["path"]).toBe("/app/main.py");
    expect(call_kwargs["encoding"]).toBe("utf-8");
  });

  it("test_read_custom_encoding", async () => {
    const { module: files_module, filesystem_protocol } = makeFilesModule();
    await files_module.read("/app/data.txt", { encoding: "latin-1" });
    const call_kwargs = filesystem_protocol.readText.mock.calls[0][2];
    expect(call_kwargs["encoding"]).toBe("latin-1");
  });

  it("test_read_bytes_returns_bytes", async () => {
    const { module: files_module, filesystem_protocol } = makeFilesModule();
    const result = await files_module.readBytes("/app/image.png");
    expect(Buffer.from(result)).toEqual(Buffer.from("file bytes"));
    expect(filesystem_protocol.read).toHaveBeenCalledTimes(1);
    const call_kwargs = filesystem_protocol.read.mock.calls[0][2];
    expect(call_kwargs["path"]).toBe("/app/image.png");
  });
});

describe("TestFilesWrite", () => {
  // Test FilesModule.write().
  it("test_write_string", async () => {
    const { module: files_module, filesystem_protocol } = makeFilesModule();
    await files_module.write("/app/test.py", "print('hello')");
    expect(filesystem_protocol.write).toHaveBeenCalledTimes(1);
    const call_kwargs = filesystem_protocol.write.mock.calls[0][2];
    expect(call_kwargs["path"]).toBe("/app/test.py");
    expect(call_kwargs["content"]).toBe("print('hello')");
  });

  it("test_write_bytes", async () => {
    const { module: files_module, filesystem_protocol } = makeFilesModule();
    await files_module.write("/app/data.bin", new Uint8Array([0, 1, 2]));
    const call_kwargs = filesystem_protocol.write.mock.calls[0][2];
    expect(call_kwargs["content"]).toEqual(new Uint8Array([0, 1, 2]));
  });
});

describe("TestFilesList", () => {
  // Test FilesModule.list().
  it("test_list_returns_file_infos", async () => {
    const { module: files_module } = makeFilesModule();
    const result = await files_module.list("/app");
    expect(result.length).toBe(2);
    expect(result[0]).toBeInstanceOf(FileInfo);
    expect(result[0]!.name).toBe("app.py");
    expect(result[1]!.type).toBe(FileType.DIRECTORY);
  });

  it("test_list_default_path", async () => {
    const { module: files_module, filesystem_protocol } = makeFilesModule();
    await files_module.list();
    const call_kwargs = filesystem_protocol.listDir.mock.calls[0][2];
    expect(call_kwargs["path"]).toBe("/");
  });
});

describe("TestFilesExists", () => {
  // Test FilesModule.exists().
  it("test_exists_returns_true", async () => {
    const { module: files_module } = makeFilesModule();
    const result = await files_module.exists("/app/main.py");
    expect(result).toBe(true);
  });

  it("test_exists_returns_false", async () => {
    const { module: files_module, filesystem_protocol } = makeFilesModule();
    filesystem_protocol.exists.mockResolvedValue(false);
    const result = await files_module.exists("/app/missing.py");
    expect(result).toBe(false);
  });
});

describe("TestFilesRemove", () => {
  // Test FilesModule.remove().
  it("test_remove_calls_protocol", async () => {
    const { module: files_module, filesystem_protocol } = makeFilesModule();
    await files_module.remove("/app/old.py");
    expect(filesystem_protocol.remove).toHaveBeenCalledTimes(1);
    const call_kwargs = filesystem_protocol.remove.mock.calls[0][2];
    expect(call_kwargs["path"]).toBe("/app/old.py");
  });
});

describe("TestFilesMakeDir", () => {
  // Test FilesModule.make_dir().
  it("test_make_dir_calls_protocol", async () => {
    const { module: files_module, filesystem_protocol } = makeFilesModule();
    await files_module.makeDir("/app/new_dir");
    expect(filesystem_protocol.makeDir).toHaveBeenCalledTimes(1);
    const call_kwargs = filesystem_protocol.makeDir.mock.calls[0][2];
    expect(call_kwargs["path"]).toBe("/app/new_dir");
  });
});

describe("TestFilesUploadDownload", () => {
  // Test upload and download methods.
  it("test_upload_reads_local_writes_remote", async () => {
    const { module: files_module, filesystem_protocol } = makeFilesModule();
    // Create a local test file
    const local_file = path.join(tmpPath(), "test.txt");
    fs.writeFileSync(local_file, Buffer.from("local content"));

    await files_module.upload(local_file, "/app/test.txt");
    expect(filesystem_protocol.write).toHaveBeenCalledTimes(1);
    const call_kwargs = filesystem_protocol.write.mock.calls[0][2];
    expect(call_kwargs["path"]).toBe("/app/test.txt");
    expect(Buffer.from(call_kwargs["content"])).toEqual(Buffer.from("local content"));
  });

  it("test_download_reads_remote_writes_local", async () => {
    const { module: files_module, filesystem_protocol } = makeFilesModule();
    const local_file = path.join(tmpPath(), "downloaded.bin");

    await files_module.download("/app/data.bin", local_file);
    expect(filesystem_protocol.read).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(local_file)).toEqual(Buffer.from("file bytes"));
  });
});

describe("TestFilesUploadDownloadUrls", () => {
  // Test upload_url and download_url methods.
  it("test_upload_url", async () => {
    const { module: files_module } = makeFilesModule();
    const url = await files_module.uploadUrl("/app/test.txt");
    expect(url).toBe(`${TEST_ENVD_URL}/files?path=/app/test.txt&username=user`);
  });

  it("test_download_url", async () => {
    const { module: files_module } = makeFilesModule();
    const url = await files_module.downloadUrl("/app/test.txt");
    expect(url).toBe(`${TEST_ENVD_URL}/files?path=/app/test.txt&username=user`);
  });
});

describe("TestFilesRename", () => {
  // Test FilesModule.move().
  it("test_rename_calls_protocol", async () => {
    const { module: files_module, filesystem_protocol } = makeFilesModule();
    await files_module.move("/app/old.py", "/app/new.py");
    expect(filesystem_protocol.move).toHaveBeenCalledTimes(1);
    const call_kwargs = filesystem_protocol.move.mock.calls[0][2];
    expect(call_kwargs["source"]).toBe("/app/old.py");
    expect(call_kwargs["destination"]).toBe("/app/new.py");
  });
});

describe("TestFilesWatch", () => {
  // Test FilesModule.watch().
  it("test_watch_calls_protocol", async () => {
    const { module: files_module, filesystem_protocol } = makeFilesModule();
    filesystem_protocol.watchDir.mockResolvedValue("mock_reader");
    const result = await files_module.watch("/app");
    expect(result).toBe("mock_reader");
    expect(filesystem_protocol.watchDir).toHaveBeenCalledTimes(1);
  });
});


it("requires an adapter for transfer URLs and preserves its opaque addressing", async () => {
  const { module: files } = makeFilesModule();
  delete (files._fs as any).transferUrl;
  await expect(files.uploadUrl("/private")).rejects.toBeInstanceOf(ProviderFeatureNotSupportedError);
  await expect(files.downloadUrl("/private")).rejects.toBeInstanceOf(ProviderFeatureNotSupportedError);
  files._fs.transferUrl = async (_url, _token, opts) => `https://foreign.example/${opts.operation}/opaque`;
  expect(await files.uploadUrl("/private")).toBe("https://foreign.example/upload/opaque");
  expect(await files.downloadUrl("/private")).toBe("https://foreign.example/download/opaque");
});
