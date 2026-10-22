import { useMockCloudConfiguration } from "../_support/mockCloudConfiguration.js";
/** Tests for sandbox CLI commands: create, list, info, kill, exec, upload, download. */

import "../_support/isolatedHome.js";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Sandbox } from "../../src/api/sandbox.js";
import { cli } from "../../src/cli/main.js";
import { replSeams } from "../../src/cli/repl.js";
import { AuthenticationError, CommandTimeoutError, QuotaExceededError, TemplateNotFoundError } from "../../src/models/errors.js";
import { ProcessResult } from "../../src/models/process.js";
import { SandboxInfo } from "../../src/models/sandbox.js";
import * as layered from "../../src/transport/config_layers.js";
import { CliRunner } from "../helpers/cliRunner.js";

const runner = (): CliRunner => new CliRunner();

type Spy = ReturnType<typeof vi.fn>;

interface MockSandbox {
  id: string;
  status: string;
  url: string | null;
  info: SandboxInfo;
  kill: Spy;
  commands: { run: Spy };
  files: { write: Spy; readBytes: Spy };
}

/** Build a mock Sandbox object with an .info attribute. */
function _makeSandbox(sandbox_id = "sbx-cli-test-001", template = "python-base", status = "running"): MockSandbox {
  const sbInfo = SandboxInfo.modelValidate({
    sandboxID: sandbox_id,
    templateID: template,
    status,
    region: "cn-hangzhou",
    timeout: 300,
    envdUrl: `https://${sandbox_id}.cn-hangzhou.e2b.fc.aliyuncs.com`,
    envdAccessToken: "tok",
  });
  return {
    id: sbInfo.sandbox_id,
    status: sbInfo.status,
    url: sbInfo.envd_url,
    info: sbInfo,
    kill: vi.fn().mockResolvedValue(undefined),
    commands: { run: vi.fn() },
    files: { write: vi.fn().mockResolvedValue(undefined), readBytes: vi.fn().mockResolvedValue(Buffer.from("file-content")) },
  };
}

const asSandbox = (sb: unknown): Sandbox => sb as Sandbox;

function patchConnect(sb: unknown) {
  return vi.spyOn(Sandbox, "connect").mockResolvedValue(asSandbox(sb));
}

function patchCreate(sb: unknown) {
  return vi.spyOn(Sandbox, "create").mockResolvedValue(asSandbox(sb));
}

/** CLI list and kill-all use the public lifecycle facade for every provider. */
function patchTransport(listed: unknown[] | (() => Promise<unknown[]>)) {
  return vi.spyOn(Sandbox, "list").mockImplementation(async () =>
    (typeof listed === "function" ? await listed() : listed) as SandboxInfo[]);
}

let tmp = "";
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "abx-sbxcmd-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const infoOf = (id: string) => SandboxInfo.modelValidate({ sandboxID: id, templateID: "base", status: "running", region: "cn-hangzhou", timeout: 300 });

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe("TestCreate", () => {
  it("accepts repeatable named Volume mounts on both create routes", async () => {
    const create = patchCreate(_makeSandbox());
    for (const prefix of [["create"], ["sandbox", "create"]]) {
      const result = await runner().invoke(cli, [...prefix, "--template", "base", "--volume-mount", "/mnt/oss=workspace", "--volume-mount", "/data/input=input"]);
      expect(result.exit_code).toBe(0);
      expect((create.mock.calls.at(-1)![0] as Record<string, unknown>).volume_mounts).toEqual({ "/mnt/oss": "workspace", "/data/input": "input" });
    }
  });

  it.each([
    ["--volume-mount", "relative=workspace"], ["--volume-mount", "/mnt/oss"],
    ["--volume-mount", "/mnt/oss=workspace", "--volume-mount", "/mnt/oss=other"],
    ["--provider", "uninstalled-mount-provider", "--volume-mount", "/mnt/oss=workspace"],
  ].map((args) => ({ args })))("rejects invalid or unsupported mounts before create %#", async ({ args }) => {
    const create = patchCreate(_makeSandbox());
    const result = await runner().invoke(cli, ["create", "--template", "base", ...args]);
    expect(result.exit_code).not.toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it("test_create_basic", async () => {
    const sb = _makeSandbox();
    patchCreate(sb);

    const result = await runner().invoke(cli, ["create", "--template", "python-base"]);

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("sbx-cli-test-001");
  });

  it("test_create_json", async () => {
    patchCreate(_makeSandbox());

    const result = await runner().invoke(cli, ["--json", "create", "--template", "python-base"]);

    expect(result.exit_code).toBe(0);
    const data = JSON.parse(result.output);
    expect(data["ID"]).toBe("sbx-cli-test-001");
  });

  it("test_create_with_envs", async () => {
    const create = patchCreate(_makeSandbox());

    const result = await runner().invoke(cli, ["create", "--template", "base", "-e", "FOO=bar", "-e", "BAZ=qux"]);

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("sbx-cli-test-001");
    expect((create.mock.calls[0]![0] as Record<string, unknown>)["envs"]).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("test_create_invalid_env_format", async () => {
    const create = vi.spyOn(Sandbox, "create").mockRejectedValue(new Error("should not be called"));

    const result = await runner().invoke(cli, ["create", "-e", "INVALID"]);

    expect(result.exit_code).toBe(2);
    expect(create).not.toHaveBeenCalled();
  });

  it("test_create_with_metadata", async () => {
    const create = patchCreate(_makeSandbox());

    const result = await runner().invoke(cli, ["create", "--template", "base", "-m", "owner=test", "-m", "env=dev"]);

    expect(result.exit_code).toBe(0);
    expect((create.mock.calls[0]![0] as Record<string, unknown>)["metadata"]).toEqual({ owner: "test", env: "dev" });
  });

  it("test_create_enforces_timeout_floor_when_default", async () => {
    // Cold starts are slow: create enforces 120s floor over the 30s default.
    const create = patchCreate(_makeSandbox());
    vi.spyOn(layered, "loadLayeredConfig").mockReturnValue(new layered.LayeredConfig({ http_timeout: 30.0 }));

    const result = await runner().invoke(cli, ["create", "--template", "python-base"]);

    expect(result.exit_code).toBe(0);
    expect((create.mock.calls[0]![0] as Record<string, unknown>)["request_timeout"]).toBe(120.0);
  });

  it("test_create_respects_large_configured_timeout", async () => {
    // When the user sets http_timeout > 120s, the larger value is used.
    const create = patchCreate(_makeSandbox());
    vi.spyOn(layered, "loadLayeredConfig").mockReturnValue(new layered.LayeredConfig({ http_timeout: 300.0 }));

    const result = await runner().invoke(cli, ["create", "--template", "python-base"]);

    expect(result.exit_code).toBe(0);
    expect((create.mock.calls[0]![0] as Record<string, unknown>)["request_timeout"]).toBe(300.0);
  });

  it("test_create_explicit_request_timeout_flag", async () => {
    // --request-timeout always wins, even if smaller than the floor.
    const create = patchCreate(_makeSandbox());

    const result = await runner().invoke(cli, ["create", "--template", "python-base", "--request-timeout", "45"]);

    expect(result.exit_code).toBe(0);
    expect((create.mock.calls[0]![0] as Record<string, unknown>)["request_timeout"]).toBe(45.0);
  });
});

// ---------------------------------------------------------------------------
// connect
// ---------------------------------------------------------------------------

describe("TestConnect", () => {
  let savedInput: typeof replSeams.input;
  beforeEach(() => {
    savedInput = replSeams.input;
  });
  afterEach(() => {
    replSeams.input = savedInput;
  });

  /** `patch("builtins.input", side_effect=...)`: a list is consumed in order (exceptions are raised), a class always raises. */
  function patchInput(effect: Array<string | Error> | Error): void {
    const queue = Array.isArray(effect) ? [...effect] : null;
    replSeams.input = async () => {
      if (queue === null) throw effect;
      const item = queue.shift();
      if (item === undefined) throw new Error("StopIteration");
      if (item instanceof Error) throw item;
      return item;
    };
  }

  it("test_connect_interactive_exit", async () => {
    // Connect should start interactive session; 'exit' disconnects.
    patchConnect({ id: "sbx-cli-test-001", commands: {} });
    patchInput(["exit"]);

    const result = await runner().invoke(cli, ["connect", "sbx-cli-test-001"]);

    expect(result.exit_code).toBe(0);
    expect(result.output.includes("Connected") || result.output.includes("Disconnected")).toBe(true);
  });

  it("test_connect_eof", async () => {
    // Ctrl+D (EOF) should disconnect.
    const { EOFError } = await import("../../src/cli/errors.js");
    patchConnect({ id: "sbx-cli-test-001", commands: {} });
    patchInput(new EOFError());

    const result = await runner().invoke(cli, ["connect", "sbx-cli-test-001"]);

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("Disconnected");
  });

  it("test_connect_runs_command", async () => {
    // Connect should execute commands and print output.
    const run = vi.fn().mockResolvedValue({ stdout: "hello world\n", stderr: "", exit_code: 0 });
    patchConnect({ id: "sbx-cli-test-001", commands: { run } });
    patchInput(["echo hello", "exit"]);

    const result = await runner().invoke(cli, ["connect", "sbx-cli-test-001"]);

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("hello world");
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("TestList", () => {
  it("test_list_basic", async () => {
    patchTransport([infoOf("sbx-1")]);

    const result = await runner().invoke(cli, ["list"]);

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("sbx-1");
  });

  it("test_list_json", async () => {
    patchTransport([infoOf("sbx-1")]);

    const result = await runner().invoke(cli, ["--json", "list"]);

    expect(result.exit_code).toBe(0);
    const data = JSON.parse(result.output);
    expect(Array.isArray(data)).toBe(true);
    expect(data[0]["ID"]).toBe("sbx-1");
  });

  it("test_list_empty", async () => {
    patchTransport([]);

    const result = await runner().invoke(cli, ["list"]);

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("No sandboxes");
  });
});

// ---------------------------------------------------------------------------
// info
// ---------------------------------------------------------------------------

describe("TestInfo", () => {
  it("test_info_basic", async () => {
    patchConnect(_makeSandbox());

    const result = await runner().invoke(cli, ["info", "sbx-cli-test-001"]);

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("sbx-cli-test-001");
    expect(result.output).toContain("running");
  });
});

// ---------------------------------------------------------------------------
// kill
// ---------------------------------------------------------------------------

describe("TestKill", () => {
  it("test_kill_with_yes", async () => {
    const kill = vi.spyOn(Sandbox, "killById").mockResolvedValue(undefined);

    const result = await runner().invoke(cli, ["kill", "sbx-cli-test-001", "--yes"]);

    expect(result.exit_code).toBe(0);
    expect(result.output.toLowerCase()).toContain("killed");
    expect(kill).toHaveBeenCalledWith("sbx-cli-test-001");
  });

  it("test_kill_of_a_missing_sandbox_is_idempotent", async () => {
    // A vanished sandbox must not be looked up first: connect/get 404s, and `abx kill` is documented to stay idempotent.
    const connect = vi.spyOn(Sandbox, "connect").mockRejectedValue(new Error("connect must not run"));
    const kill = vi.spyOn(Sandbox, "killById").mockResolvedValue(undefined);

    const result = await runner().invoke(cli, ["kill", "sbx-gone", "--yes"]);

    expect(result.exit_code).toBe(0);
    expect(result.output.toLowerCase()).toContain("killed");
    expect(kill).toHaveBeenCalledWith("sbx-gone");
    expect(connect).not.toHaveBeenCalled();
  });

  it("test_kill_abort", async () => {
    const result = await runner().invoke(cli, ["kill", "sbx-cli-test-001"], { input: "n\n" });
    expect(result.exit_code).not.toBe(0); // Aborted
  });

  it("test_kill_no_id_no_all", async () => {
    // Should error when neither sandbox_id nor --all is given.
    const result = await runner().invoke(cli, ["kill", "--yes"]);
    expect(result.exit_code).toBe(2);
  });

  it("test_kill_all_empty", async () => {
    // --all with no running sandboxes.
    patchTransport([]);

    const result = await runner().invoke(cli, ["kill", "--all", "--yes"]);

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("No running");
  });

  it("test_kill_all_with_sandboxes", async () => {
    // --all should kill listed sandboxes without connecting first.
    const kill = vi.spyOn(Sandbox, "killById").mockResolvedValue(undefined);
    patchTransport([infoOf("sbx-1")]);

    const result = await runner().invoke(cli, ["kill", "--all", "--yes"]);

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("Killed");
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith("alicloud-express:sbx-1");
  });
});

// ---------------------------------------------------------------------------
// exec
// ---------------------------------------------------------------------------

describe("TestExec", () => {
  it("test_exec_basic", async () => {
    const sb = _makeSandbox();
    sb.commands.run = vi.fn().mockResolvedValue(new ProcessResult({ stdout: "hello\n", stderr: "", exit_code: 0, execution_time: 0.1 }));
    patchConnect(sb);

    const result = await runner().invoke(cli, ["exec", "sbx-cli-test-001", "echo hello"]);

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("hello");
  });

  it("test_exec_json", async () => {
    const sb = _makeSandbox();
    sb.commands.run = vi.fn().mockResolvedValue(new ProcessResult({ stdout: "hi\n", stderr: "", exit_code: 0, execution_time: 0.05 }));
    patchConnect(sb);

    const result = await runner().invoke(cli, ["--json", "exec", "sbx-cli-test-001", "echo hi"]);

    expect(result.exit_code).toBe(0);
    const data = JSON.parse(result.output);
    expect(data["stdout"]).toBe("hi\n");
    expect(data["exit_code"]).toBe(0);
  });

  it("test_exec_nonzero_exit", async () => {
    const sb = _makeSandbox();
    sb.commands.run = vi.fn().mockResolvedValue(new ProcessResult({ stdout: "", stderr: "error\n", exit_code: 1, execution_time: 0.05 }));
    patchConnect(sb);

    const result = await runner().invoke(cli, ["exec", "sbx-cli-test-001", "false"]);

    expect(result.exit_code).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("TestErrorHandling", () => {
  it("test_auth_error_exit_code_3", async () => {
    vi.spyOn(Sandbox, "create").mockRejectedValue(new AuthenticationError("bad key"));

    const result = await runner().invoke(cli, ["create", "--template", "base"]);

    expect(result.exit_code).toBe(3);
  });

  it("test_template_not_found_exit_code_4", async () => {
    vi.spyOn(Sandbox, "create").mockRejectedValue(new TemplateNotFoundError("no such template"));

    const result = await runner().invoke(cli, ["create", "--template", "base"]);

    expect(result.exit_code).toBe(4);
  });

  it("test_timeout_error_exit_code_5", async () => {
    const sb = _makeSandbox();
    sb.commands.run = vi.fn().mockRejectedValue(new CommandTimeoutError("timed out"));
    patchConnect(sb);

    const result = await runner().invoke(cli, ["exec", "sbx-1", "sleep 999"]);

    expect(result.exit_code).toBe(5);
  });

  it("test_quota_error_exit_code_6", async () => {
    vi.spyOn(Sandbox, "create").mockRejectedValue(new QuotaExceededError("quota exceeded"));

    const result = await runner().invoke(cli, ["create", "--template", "base"]);

    expect(result.exit_code).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// upload
// ---------------------------------------------------------------------------

describe("TestUpload", () => {
  it("test_upload_file", async () => {
    // Upload a single file.
    const localFile = path.join(tmp, "script.py");
    fs.writeFileSync(localFile, "print('hello')");
    const sb = _makeSandbox();
    patchConnect(sb);

    const result = await runner().invoke(cli, ["upload", "sbx-cli-test-001", localFile, "/app/script.py"]);

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("Uploaded");
    expect(result.output).toContain("/app/script.py");
  });

  it("test_upload_file_not_exists", async () => {
    // click.Path(exists=True) should reject missing files.
    const result = await runner().invoke(cli, ["upload", "sbx-1", "/nonexistent/file.py", "/app/file.py"]);
    expect(result.exit_code).not.toBe(0);
  });

  it("test_upload_directory", async () => {
    // Upload a directory recursively.
    fs.mkdirSync(path.join(tmp, "sub"));
    fs.writeFileSync(path.join(tmp, "a.txt"), "aaa");
    fs.writeFileSync(path.join(tmp, "sub", "b.txt"), "bbb");
    const sb = _makeSandbox();
    patchConnect(sb);

    const result = await runner().invoke(cli, ["upload", "sbx-cli-test-001", tmp, "/app/data"]);

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("Uploaded 2 files");
  });
});

// ---------------------------------------------------------------------------
// download
// ---------------------------------------------------------------------------

describe("TestDownload", () => {
  it("test_download_file", async () => {
    // Download a file to a specific path.
    const sb = _makeSandbox();
    sb.files.readBytes = vi.fn().mockResolvedValue(Buffer.from("csv-data"));
    const dest = path.join(tmp, "result.csv");
    patchConnect(sb);

    const result = await runner().invoke(cli, ["download", "sbx-cli-test-001", "/app/result.csv", dest]);

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("Downloaded");
    expect(fs.readFileSync(dest)).toEqual(Buffer.from("csv-data"));
  });

  it("test_download_to_directory", async () => {
    // Download to an existing directory -- use remote filename.
    const sb = _makeSandbox();
    sb.files.readBytes = vi.fn().mockResolvedValue(Buffer.from("log-data"));
    patchConnect(sb);

    const result = await runner().invoke(cli, ["download", "sbx-cli-test-001", "/app/output.log", tmp]);

    expect(result.exit_code).toBe(0);
    expect(fs.readFileSync(path.join(tmp, "output.log"))).toEqual(Buffer.from("log-data"));
  });

  it("test_download_creates_parent_dirs", async () => {
    // Intermediate directories should be created automatically.
    const sb = _makeSandbox();
    sb.files.readBytes = vi.fn().mockResolvedValue(Buffer.from("binary"));
    const dest = path.join(tmp, "deep", "nested", "file.bin");
    patchConnect(sb);

    const result = await runner().invoke(cli, ["download", "sbx-cli-test-001", "/app/file.bin", dest]);

    expect(result.exit_code).toBe(0);
    expect(fs.readFileSync(dest)).toEqual(Buffer.from("binary"));
  });
});

// Remote APIs in this file are mocked; provide configuration without bypassing preflight.
useMockCloudConfiguration();
