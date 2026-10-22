import { useMockCloudConfiguration } from "../_support/mockCloudConfiguration.js";
/** Tests for sandbox files CLI commands: list, stat, mkdir, rm, mv, search. */

import "../_support/isolatedHome.js";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Sandbox } from "../../src/api/sandbox.js";
import { cli } from "../../src/cli/main.js";
import { FileNotFoundError_, FileOperationError } from "../../src/models/errors.js";
import { FileInfo, FileType } from "../../src/models/filesystem.js";
import { ProcessResult } from "../../src/models/process.js";
import { CliRunner } from "../helpers/cliRunner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const runner = (): CliRunner => new CliRunner();

/** Build a lightweight mock Sandbox for file-command tests. */
function _makeSandbox() {
  return {
    id: "sbx-test-001",
    capabilities: new Set(["shell", "files", "code"]),
    files: {
      list: vi.fn().mockResolvedValue([]),
      getInfo: vi.fn(),
      makeDir: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      move: vi.fn().mockResolvedValue(undefined),
    },
    commands: { run: vi.fn() },
    kill: vi.fn().mockResolvedValue(undefined),
  };
}

function _patchConnect(sb: ReturnType<typeof _makeSandbox>) {
  return vi.spyOn(Sandbox, "connect").mockResolvedValue(sb as unknown as Sandbox);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ===================================================================
// sandbox files list
// ===================================================================

describe("TestFilesList", () => {
  it("test_list_non_recursive_happy", async () => {
    // Non-recursive list returns two entries.
    const sb = _makeSandbox();
    sb.files.list = vi.fn().mockResolvedValue([
      new FileInfo({ name: "app.py", path: "/home/user/app.py", type: FileType.FILE, size: 1024 }),
      new FileInfo({ name: "data", path: "/home/user/data", type: FileType.DIRECTORY, size: 0 }),
    ]);
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "files", "list", "sbx-test-001"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("app.py");
    expect(result.output).toContain("data");
  });

  it("test_list_recursive", async () => {
    // Recursive list uses 'find' via commands.run.
    const sb = _makeSandbox();
    sb.commands.run = vi.fn().mockResolvedValue(
      new ProcessResult({
        stdout: "/home/user\n/home/user/app.py\n/home/user/data\n",
        stderr: "",
        exit_code: 0,
      }),
    );
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "files", "list", "sbx-test-001", "--recursive"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("/home/user/app.py");
  });

  it("test_list_empty_directory", async () => {
    // Empty directory shows 'empty' message.
    const sb = _makeSandbox();
    sb.files.list = vi.fn().mockResolvedValue([]);
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "files", "list", "sbx-test-001"]);
    expect(result.exit_code).toBe(0);
    expect(result.output.toLowerCase()).toContain("empty");
  });

  it("test_list_json", async () => {
    // Non-recursive list with --json outputs a JSON array.
    const sb = _makeSandbox();
    sb.files.list = vi
      .fn()
      .mockResolvedValue([new FileInfo({ name: "test.py", path: "/home/user/test.py", type: FileType.FILE, size: 512 })]);
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["--json", "sandbox", "files", "list", "sbx-test-001"]);
    expect(result.exit_code).toBe(0);
    const data = JSON.parse(result.output);
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].name).toBe("test.py");
  });

  it("test_list_recursive_json", async () => {
    // Recursive list with --json outputs entries key.
    const sb = _makeSandbox();
    sb.commands.run = vi.fn().mockResolvedValue(
      new ProcessResult({
        stdout: "/home/user/a.py\n/home/user/b.py\n",
        stderr: "",
        exit_code: 0,
      }),
    );
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["--json", "sandbox", "files", "list", "sbx-test-001", "-r"]);
    expect(result.exit_code).toBe(0);
    const data = JSON.parse(result.output);
    expect("entries" in data).toBe(true);
    expect(data.entries.length).toBe(2);
  });

  it("test_list_missing_sandbox_id", async () => {
    // Missing SANDBOX_ID argument -> exit 2.
    const result = await runner().invoke(cli, ["sandbox", "files", "list"]);
    expect(result.exit_code).toBe(2);
  });

  it("test_list_api_error", async () => {
    // Backend FileOperationError -> exit 1 (general SDK error).
    const sb = _makeSandbox();
    sb.files.list = vi.fn().mockRejectedValue(new FileOperationError("disk error"));
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "files", "list", "sbx-test-001"]);
    expect(result.exit_code).toBe(1);
  });
});

// ===================================================================
// sandbox files stat
// ===================================================================

describe("TestFilesStat", () => {
  it("test_stat_happy", async () => {
    const sb = _makeSandbox();
    sb.files.getInfo = vi
      .fn()
      .mockResolvedValue(new FileInfo({ name: "app.py", path: "/home/user/app.py", type: FileType.FILE, size: 2048 }));
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "files", "stat", "sbx-test-001", "--path", "/home/user/app.py"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("app.py");
    expect(result.output).toContain("file");
  });

  it("test_stat_json", async () => {
    const sb = _makeSandbox();
    sb.files.getInfo = vi
      .fn()
      .mockResolvedValue(new FileInfo({ name: "data", path: "/app/data", type: FileType.DIRECTORY, size: 0 }));
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["--json", "sandbox", "files", "stat", "sbx-test-001", "-p", "/app/data"]);
    expect(result.exit_code).toBe(0);
    const data = JSON.parse(result.output);
    expect(data.Name).toBe("data");
    expect(data.Type).toBe("directory");
  });

  it("test_stat_missing_path", async () => {
    // --path is required -> exit 2.
    const result = await runner().invoke(cli, ["sandbox", "files", "stat", "sbx-test-001"]);
    expect(result.exit_code).toBe(2);
  });

  it("test_stat_not_found", async () => {
    const sb = _makeSandbox();
    sb.files.getInfo = vi.fn().mockRejectedValue(new FileNotFoundError_("not found"));
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "files", "stat", "sbx-test-001", "-p", "/no/such"]);
    expect(result.exit_code).toBe(4);
  });
});

// ===================================================================
// sandbox files mkdir
// ===================================================================

describe("TestFilesMkdir", () => {
  it("test_mkdir_happy", async () => {
    const sb = _makeSandbox();
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "files", "mkdir", "sbx-test-001", "-p", "/home/user/new_dir"]);
    expect(result.exit_code).toBe(0);
    expect(sb.files.makeDir).toHaveBeenCalledTimes(1);
    expect(sb.files.makeDir).toHaveBeenCalledWith("/home/user/new_dir");
  });

  it("test_mkdir_missing_path", async () => {
    const result = await runner().invoke(cli, ["sandbox", "files", "mkdir", "sbx-test-001"]);
    expect(result.exit_code).toBe(2);
  });

  it("test_mkdir_already_exists", async () => {
    const sb = _makeSandbox();
    sb.files.makeDir = vi.fn().mockRejectedValue(new FileOperationError("already exists"));
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "files", "mkdir", "sbx-test-001", "-p", "/existing"]);
    expect(result.exit_code).toBe(1);
  });
});

// ===================================================================
// sandbox files rm
// ===================================================================

describe("TestFilesRm", () => {
  it("test_rm_yes_flag", async () => {
    // --yes skips confirmation; remove is called.
    const sb = _makeSandbox();
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "files", "rm", "sbx-test-001", "-p", "/tmp/old.txt", "-y"]);
    expect(result.exit_code).toBe(0);
    expect(sb.files.remove).toHaveBeenCalledTimes(1);
    expect(sb.files.remove).toHaveBeenCalledWith("/tmp/old.txt");
  });

  it("test_rm_abort", async () => {
    // User answers 'n' to confirmation prompt -> abort.
    const sb = _makeSandbox();
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "files", "rm", "sbx-test-001", "-p", "/tmp/old.txt"], {
      input: "n\n",
    });
    expect(result.exit_code).not.toBe(0);
    expect(sb.files.remove).not.toHaveBeenCalled();
  });

  it("test_rm_confirm_yes", async () => {
    // User answers 'y' to confirmation prompt -> proceed.
    const sb = _makeSandbox();
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "files", "rm", "sbx-test-001", "-p", "/tmp/old.txt"], {
      input: "y\n",
    });
    expect(result.exit_code).toBe(0);
    expect(sb.files.remove).toHaveBeenCalledTimes(1);
    expect(sb.files.remove).toHaveBeenCalledWith("/tmp/old.txt");
  });

  it("test_rm_missing_path", async () => {
    const result = await runner().invoke(cli, ["sandbox", "files", "rm", "sbx-test-001"]);
    expect(result.exit_code).toBe(2);
  });

  it("test_rm_not_found", async () => {
    const sb = _makeSandbox();
    sb.files.remove = vi.fn().mockRejectedValue(new FileNotFoundError_("not found"));
    _patchConnect(sb);
    const result = await runner().invoke(cli, ["sandbox", "files", "rm", "sbx-test-001", "-p", "/gone", "-y"]);
    expect(result.exit_code).toBe(4);
  });
});

// ===================================================================
// sandbox files mv
// ===================================================================

describe("TestFilesMv", () => {
  it("test_mv_happy", async () => {
    const sb = _makeSandbox();
    _patchConnect(sb);
    const result = await runner().invoke(cli, [
      "sandbox",
      "files",
      "mv",
      "sbx-test-001",
      "--source",
      "/home/user/old.py",
      "--dest",
      "/home/user/new.py",
    ]);
    expect(result.exit_code).toBe(0);
    expect(sb.files.move).toHaveBeenCalledTimes(1);
    expect(sb.files.move).toHaveBeenCalledWith("/home/user/old.py", "/home/user/new.py");
  });

  it("test_mv_missing_source", async () => {
    const result = await runner().invoke(cli, ["sandbox", "files", "mv", "sbx-test-001", "--dest", "/home/user/new.py"]);
    expect(result.exit_code).toBe(2);
  });

  it("test_mv_missing_dest", async () => {
    const result = await runner().invoke(cli, ["sandbox", "files", "mv", "sbx-test-001", "--source", "/home/user/old.py"]);
    expect(result.exit_code).toBe(2);
  });

  it("test_mv_source_not_found", async () => {
    const sb = _makeSandbox();
    sb.files.move = vi.fn().mockRejectedValue(new FileNotFoundError_("source not found"));
    _patchConnect(sb);
    const result = await runner().invoke(cli, [
      "sandbox",
      "files",
      "mv",
      "sbx-test-001",
      "-s",
      "/no/such",
      "-d",
      "/home/user/dest",
    ]);
    expect(result.exit_code).toBe(4);
  });
});

// ===================================================================
// sandbox files search
// ===================================================================

describe("TestFilesSearch", () => {
  it("test_search_happy", async () => {
    // Three hits displayed.
    const sb = _makeSandbox();
    sb.commands.run = vi.fn().mockResolvedValue(
      new ProcessResult({
        stdout: "/app/a.py\n/app/b.py\n/app/c.py\n",
        stderr: "",
        exit_code: 0,
      }),
    );
    _patchConnect(sb);
    const result = await runner().invoke(cli, [
      "sandbox",
      "files",
      "search",
      "sbx-test-001",
      "--path",
      "/app",
      "--pattern",
      "*.py",
    ]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("Found 3 file(s)");
  });

  it("test_search_no_match", async () => {
    const sb = _makeSandbox();
    sb.commands.run = vi.fn().mockResolvedValue(new ProcessResult({ stdout: "", stderr: "", exit_code: 0 }));
    _patchConnect(sb);
    const result = await runner().invoke(cli, [
      "sandbox",
      "files",
      "search",
      "sbx-test-001",
      "-p",
      "/app",
      "--pattern",
      "*.rs",
    ]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("No files found");
  });

  it("test_search_json", async () => {
    const sb = _makeSandbox();
    sb.commands.run = vi.fn().mockResolvedValue(new ProcessResult({ stdout: "/app/x.log\n", stderr: "", exit_code: 0 }));
    _patchConnect(sb);
    const result = await runner().invoke(cli, [
      "--json",
      "sandbox",
      "files",
      "search",
      "sbx-test-001",
      "-p",
      "/app",
      "--pattern",
      "*.log",
    ]);
    expect(result.exit_code).toBe(0);
    const data = JSON.parse(result.output);
    expect("results" in data).toBe(true);
    expect(data.results.length).toBe(1);
  });

  it("test_search_max_depth", async () => {
    // --max-depth 3 is forwarded to find -maxdepth 3.
    const sb = _makeSandbox();
    sb.commands.run = vi.fn().mockResolvedValue(new ProcessResult({ stdout: "", stderr: "", exit_code: 0 }));
    _patchConnect(sb);
    await runner().invoke(cli, [
      "sandbox",
      "files",
      "search",
      "sbx-test-001",
      "-p",
      "/app",
      "--pattern",
      "*.py",
      "--max-depth",
      "3",
    ]);
    const callArgs = sb.commands.run.mock.lastCall as unknown[];
    expect(callArgs[0] as string).toContain("-maxdepth 3");
  });

  it("test_search_missing_pattern", async () => {
    const result = await runner().invoke(cli, ["sandbox", "files", "search", "sbx-test-001", "--path", "/app"]);
    expect(result.exit_code).toBe(2);
  });

  it("test_search_missing_path", async () => {
    const result = await runner().invoke(cli, ["sandbox", "files", "search", "sbx-test-001", "--pattern", "*.py"]);
    expect(result.exit_code).toBe(2);
  });
});

// Remote APIs in this file are mocked; provide configuration without bypassing preflight.
useMockCloudConfiguration();
