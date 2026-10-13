/**
 * Unit tests for the host-side Qwen Code adapter.
 *
 * Port of `tests/test_agent/test_qwen_code.py`. No test performs real network access or executes the real CLI:
 * downloads are replaced through `seams.downloadToFile` / `seams.httpGetText` (the Python tests monkeypatch
 * `_download_to_file` / `_http_get_text`) and the blocking-path subprocess runs are faked through `seams.spawnHeadless`.
 * The `TestRealProcess` tests use genuine subprocesses: the fake `qwen` is a small Node script (the Python original
 * uses a Python script), including a descendant that must be reaped on timeout / Ctrl-C.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as qwenCode from "../../src/agent/qwen_code.js";
import {
  type HeadlessProcess,
  KeyboardInterrupt,
  TimeoutExpired,
  detectStandaloneTarget,
  findQwenCodeBinary,
  officialInstallCommand,
  resolveQwenCodeCredentials,
  runQwenCodeHeadless,
  standaloneAssetName,
  standaloneDownloadUrls,
} from "../../src/agent/qwen_code.js";
import {
  AICodegenError,
  QwenCodeCredentialError,
  QwenCodeNotInstalledError,
  QwenCodeStartupError,
  QwenCodeTimeoutError,
} from "../../src/models/errors.js";
import { makeTmp, raises, readGolden, rmTmp, tarGzBytes, writeFile, zipBytes } from "../helpers/agentSupport.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sha256 = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");

/** Build a minimal archive matching the official tar.gz layout. */
function tarGzForTarget(target: string): Buffer {
  const entry = qwenCode._entryRelativePath(target).split(path.sep).join("/");
  const node = qwenCode._nodeRelativePath(target).split(path.sep).join("/");
  return tarGzBytes([
    { name: entry, content: "#!/bin/sh\necho qwen\n", mode: 0o755 },
    { name: node, content: "node-binary", mode: 0o755 },
  ]);
}

/** Build a minimal archive matching the official win-x64 zip layout. */
function zipForTarget(target: string): Buffer {
  return zipBytes([
    { name: qwenCode._entryRelativePath(target).split(path.sep).join("/"), content: "@echo off\r\n" },
    { name: qwenCode._nodeRelativePath(target).split(path.sep).join("/"), content: "node" },
  ]);
}

function patchNetwork(archive: Uint8Array, opts: { digest?: string | null; checksumText?: string | null } = {}): void {
  const assetDigest = opts.digest ?? sha256(archive);
  const seen: { asset?: string } = {};
  vi.spyOn(qwenCode.seams, "downloadToFile").mockImplementation(async (url, dest) => {
    // The archive download URL ends with the release asset name; the later SHA256SUMS request does not, so remember
    // it here.
    seen.asset = url.slice(url.lastIndexOf("/") + 1);
    fs.writeFileSync(dest, archive);
  });
  vi.spyOn(qwenCode.seams, "httpGetText").mockImplementation(async () => {
    if (opts.checksumText != null) return opts.checksumText;
    return `${assetDigest}  ${seen.asset}\n`;
  });
}

const isExecutable = (file: string): boolean => {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

let tmpPath = "";
const envKeys = ["EBX_QWEN_CODE_BIN", "COMSPEC", "FAKE_QWEN_MODE", "FAKE_QWEN_PIDFILE", "FAKE_QWEN_COUNTER"];
let savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  tmpPath = makeTmp();
  savedEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmTmp(tmpPath);
});

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

describe("TestPlatformDetection", () => {
  it("test_darwin_variants", () => {
    expect(detectStandaloneTarget({ system: "Darwin", machine: "arm64" })).toBe("darwin-arm64");
    expect(detectStandaloneTarget({ system: "Darwin", machine: "x86_64" })).toBe("darwin-x64");
  });

  it("test_linux_variants", () => {
    expect(detectStandaloneTarget({ system: "Linux", machine: "x86_64" })).toBe("linux-x64");
    expect(detectStandaloneTarget({ system: "Linux", machine: "aarch64" })).toBe("linux-arm64");
  });

  it("test_windows_x64", () => {
    expect(detectStandaloneTarget({ system: "Windows", machine: "AMD64" })).toBe("win-x64");
  });

  it("test_windows_arm64_unsupported", () => {
    // Verified: the official release matrix has no win-arm64 asset.
    expect(detectStandaloneTarget({ system: "Windows", machine: "ARM64" })).toBeNull();
  });

  it("test_unknown_platform_or_arch", () => {
    expect(detectStandaloneTarget({ system: "FreeBSD", machine: "x86_64" })).toBeNull();
    expect(detectStandaloneTarget({ system: "Linux", machine: "riscv64" })).toBeNull();
  });
});

describe("TestAssetNaming", () => {
  it("test_unix_tarball", () => {
    expect(standaloneAssetName("darwin-arm64")).toBe("qwen-code-darwin-arm64.tar.gz");
    expect(standaloneAssetName("linux-x64")).toBe("qwen-code-linux-x64.tar.gz");
  });

  it("test_windows_zip", () => {
    expect(standaloneAssetName("win-x64")).toBe("qwen-code-win-x64.zip");
  });

  it("test_unknown_target_rejected", async () => {
    await raises(() => standaloneAssetName("win-arm64"), Error);
  });

  it("test_mirror_order_and_urls", () => {
    const urls = standaloneDownloadUrls("darwin-arm64");
    const labels = urls.map(([label]) => label);
    expect(labels).toEqual(["aliyun", "github"]);
    expect(urls[0]![1]).toBe(
      "https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/releases/qwen-code/" +
        "latest/qwen-code-darwin-arm64.tar.gz",
    );
    expect(urls[1]![1]).toBe(
      "https://github.com/QwenLM/qwen-code/releases/latest/download/" + "qwen-code-darwin-arm64.tar.gz",
    );
  });

  it("test_official_install_command", () => {
    expect(officialInstallCommand({ windows: false })).toContain("install-qwen-standalone.sh");
    expect(officialInstallCommand({ windows: true })).toContain("install-qwen-standalone.ps1");
  });
});

// ---------------------------------------------------------------------------
// Binary discovery
// ---------------------------------------------------------------------------

describe("TestFindBinary", () => {
  it("test_env_override_wins", () => {
    const exe = path.join(tmpPath, "custom-qwen");
    fs.writeFileSync(exe, "#!/bin/sh\n");
    process.env.EBX_QWEN_CODE_BIN = exe;
    expect(findQwenCodeBinary({ binDir: path.join(tmpPath, "empty") })).toBe(exe);
  });

  it("test_env_override_missing_file", () => {
    process.env.EBX_QWEN_CODE_BIN = path.join(tmpPath, "missing");
    expect(findQwenCodeBinary({ binDir: path.join(tmpPath, "empty") })).toBeNull();
  });

  it("test_managed_dir_found", () => {
    delete process.env.EBX_QWEN_CODE_BIN;
    const binDir = path.join(tmpPath, "bin");
    fs.mkdirSync(binDir);
    const managed = path.join(binDir, "qwen");
    fs.writeFileSync(managed, "#!/bin/sh\n");
    fs.chmodSync(managed, 0o755);
    vi.spyOn(qwenCode.seams, "which").mockReturnValue(null);
    expect(findQwenCodeBinary({ binDir })).toBe(managed);
  });

  it("test_managed_dir_skips_non_executable", () => {
    delete process.env.EBX_QWEN_CODE_BIN;
    const binDir = path.join(tmpPath, "bin");
    fs.mkdirSync(binDir);
    fs.writeFileSync(path.join(binDir, "qwen"), "not executable");
    vi.spyOn(qwenCode.seams, "which").mockReturnValue(null);
    expect(findQwenCodeBinary({ binDir })).toBeNull();
  });

  it("test_windows_cmd_name", () => {
    delete process.env.EBX_QWEN_CODE_BIN;
    const binDir = path.join(tmpPath, "bin");
    fs.mkdirSync(binDir);
    fs.writeFileSync(path.join(binDir, "qwen.cmd"), "@echo off\n");
    expect(findQwenCodeBinary({ binDir, windows: true })).toBe(path.join(binDir, "qwen.cmd"));
  });

  it("test_path_lookup", () => {
    delete process.env.EBX_QWEN_CODE_BIN;
    const found = path.join(tmpPath, "usr-bin-qwen");
    vi.spyOn(qwenCode.seams, "which").mockReturnValue(found);
    expect(findQwenCodeBinary({ binDir: path.join(tmpPath, "empty") })).toBe(found);
  });
});

// ---------------------------------------------------------------------------
// Checksum parsing
// ---------------------------------------------------------------------------

describe("TestChecksumParsing", () => {
  it("test_parses_star_prefix_and_ignores_junk", () => {
    const text =
      `${"a".repeat(64)}  qwen-code-linux-x64.tar.gz\n` +
      `${"b".repeat(64)} *qwen-code-win-x64.zip\n` +
      "not-a-checksum-line\n" +
      `${"z".repeat(64)}  invalid-hex\n`;
    const sums = qwenCode._parseSha256sums(text);
    expect(sums["qwen-code-linux-x64.tar.gz"]).toBe("a".repeat(64));
    expect(sums["qwen-code-win-x64.zip"]).toBe("b".repeat(64));
    expect(Object.keys(sums).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

describe("TestDownloadAndInstall", () => {
  it("test_installs_verified_unix_archive", async () => {
    const binDir = path.join(tmpPath, "bin");
    const archive = tarGzForTarget("darwin-arm64");
    patchNetwork(archive);

    const wrapper = await qwenCode.downloadAndInstallStandalone({ target: "darwin-arm64", binDir });

    expect(wrapper).toBe(path.join(binDir, "qwen"));
    expect(fs.statSync(wrapper).isFile()).toBe(true);
    expect(isExecutable(wrapper)).toBe(true);
    const content = fs.readFileSync(wrapper, "utf8");
    expect(content.startsWith("#!/usr/bin/env sh")).toBe(true);
    expect(content).toContain("qwen-code/bin/qwen");
    const entry = path.join(binDir, "qwen-code", "bin", "qwen");
    expect(fs.statSync(entry).isFile()).toBe(true);
    expect(isExecutable(entry)).toBe(true);
    // Staging leftovers are cleaned up.
    expect(fs.existsSync(path.join(binDir, ".qwen-code-staging"))).toBe(false);
  });

  it("test_installs_windows_zip_with_cmd_wrapper", async () => {
    const binDir = path.join(tmpPath, "bin");
    const archive = zipForTarget("win-x64");
    patchNetwork(archive);

    const wrapper = await qwenCode.downloadAndInstallStandalone({ target: "win-x64", binDir });

    expect(path.basename(wrapper)).toBe("qwen.cmd");
    expect(fs.readFileSync(wrapper, "utf8").toLowerCase().startsWith("@echo off")).toBe(true);
    expect(fs.readFileSync(wrapper, "utf8").toLowerCase()).toContain("call");
  });

  it("test_checksum_mismatch_aborts_without_fallback", async () => {
    const binDir = path.join(tmpPath, "bin");
    const archive = tarGzForTarget("linux-x64");
    const asset = standaloneAssetName("linux-x64");
    const downloads: string[] = [];

    vi.spyOn(qwenCode.seams, "downloadToFile").mockImplementation(async (url, dest) => {
      downloads.push(url);
      fs.writeFileSync(dest, archive);
    });
    vi.spyOn(qwenCode.seams, "httpGetText").mockImplementation(async () => `${"0".repeat(64)}  ${asset}\n`);

    await raises(() => qwenCode.downloadAndInstallStandalone({ target: "linux-x64", binDir }), QwenCodeNotInstalledError, "integrity");

    // The mismatch must not trigger a silent retry with the second mirror.
    expect(downloads.length).toBe(1);
    expect(fs.existsSync(path.join(binDir, "qwen"))).toBe(false);
  });

  it("test_aliyun_failure_falls_back_to_github", async () => {
    const archive = tarGzForTarget("linux-x64");
    const digest = sha256(archive);
    const asset = standaloneAssetName("linux-x64");
    const downloads: string[] = [];

    vi.spyOn(qwenCode.seams, "downloadToFile").mockImplementation(async (url, dest) => {
      downloads.push(url);
      if (url.includes("aliyuncs.com")) throw new Error("network down");
      fs.writeFileSync(dest, archive);
    });
    vi.spyOn(qwenCode.seams, "httpGetText").mockImplementation(async () => `${digest}  ${asset}\n`);

    const wrapper = await qwenCode.downloadAndInstallStandalone({ target: "linux-x64", binDir: path.join(tmpPath, "bin") });

    expect(downloads[downloads.length - 1]).toContain("github.com");
    expect(fs.statSync(wrapper).isFile()).toBe(true);
  });

  it("test_all_mirrors_failing_raises", async () => {
    vi.spyOn(qwenCode.seams, "downloadToFile").mockImplementation(async () => {
      throw new Error("no network");
    });

    await raises(
      () => qwenCode.downloadAndInstallStandalone({ target: "linux-x64", binDir: path.join(tmpPath, "bin") }),
      QwenCodeNotInstalledError,
      "all official mirrors",
    );
  });

  it("test_missing_checksum_entry_never_installs_unverified", async () => {
    const archive = tarGzForTarget("linux-x64");
    patchNetwork(archive, { checksumText: "deadbeef  other-file\n" });

    await raises(
      () => qwenCode.downloadAndInstallStandalone({ target: "linux-x64", binDir: path.join(tmpPath, "bin") }),
      QwenCodeNotInstalledError,
      "all official mirrors",
    );
  });

  it("test_rejects_path_traversal_entries", async () => {
    const archive = tarGzBytes([{ name: "../evil.txt", content: "x" }]);
    patchNetwork(archive);

    const binDir = path.join(tmpPath, "bin");
    await raises(() => qwenCode.downloadAndInstallStandalone({ target: "linux-x64", binDir }), QwenCodeNotInstalledError);

    expect(fs.existsSync(path.join(tmpPath, "evil.txt"))).toBe(false);
  });

  it("test_unexpected_layout_rejected", async () => {
    const archive = tarGzBytes([{ name: "qwen-code/README.md", content: "hi" }]);
    patchNetwork(archive);

    await raises(
      () => qwenCode.downloadAndInstallStandalone({ target: "linux-x64", binDir: path.join(tmpPath, "bin") }),
      QwenCodeNotInstalledError,
      "all official mirrors",
    );
  });

  it("test_unsupported_platform_raises", async () => {
    vi.spyOn(qwenCode.seams, "detectStandaloneTarget").mockReturnValue(null);
    await raises(
      () => qwenCode.downloadAndInstallStandalone({ binDir: path.join(tmpPath, "bin") }),
      QwenCodeNotInstalledError,
      "No official",
    );
  });
});

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

describe("TestCredentials", () => {
  const absent = (): string => path.join(tmpPath, "absent.json");

  it("test_stored_key_wins_over_llm_key", () => {
    const creds = resolveQwenCodeCredentials({
      storedApiKey: "sk-stored",
      llmApiKey: "sk-llm",
      environ: {},
      settingsPath: absent(),
    });
    expect(creds.source).toBe("qwen-stored");
    const env = creds.asEnv();
    expect(env.OPENAI_API_KEY).toBe("sk-stored");
    expect(env.OPENAI_BASE_URL).toBe(qwenCode._DEFAULT_OPENAI_BASE_URL);
    expect(env.OPENAI_MODEL).toBe(qwenCode._DEFAULT_OPENAI_MODEL);
  });

  it("test_llm_api_key_fallback_is_compatible", () => {
    const creds = resolveQwenCodeCredentials({
      storedApiKey: null,
      llmApiKey: "sk-llm",
      environ: {},
      settingsPath: absent(),
    });
    expect(creds.source).toBe("llm-stored");
    expect(creds.asEnv().OPENAI_API_KEY).toBe("sk-llm");
  });

  it("test_custom_base_url_and_model", () => {
    const creds = resolveQwenCodeCredentials({
      storedApiKey: "sk",
      storedBaseUrl: "https://example.test/v1",
      storedModel: "my-model",
      environ: {},
      settingsPath: absent(),
    });
    expect(creds.asEnv()).toEqual({
      OPENAI_API_KEY: "sk",
      OPENAI_BASE_URL: "https://example.test/v1",
      OPENAI_MODEL: "my-model",
    });
  });

  it("test_environment_key_needs_no_injection", () => {
    const creds = resolveQwenCodeCredentials({ environ: { OPENAI_API_KEY: "sk-env" }, settingsPath: absent() });
    expect(creds.source).toBe("environment");
    expect(creds.asEnv()).toEqual({});
  });

  it("rankCodegenModels keeps coding and chat models and drops the rest", () => {
    const ranked = qwenCode.rankCodegenModels([
      "qwen-image-2.1-pro",
      "qwen3.8-omni-flash-realtime",
      "stepfun/step-5-preview",
      "glm-5.3",
      "qwen3.7-text-embedding-flash",
      "qwen3.7-text-rerank",
      "qwen-mt-uni",
      "deepseek-v4-pro",
      "qwen3.8-flash",
      "qwen3.8-max-0902",
      "qwen3.8-max",
      "qwen3-coder-plus",
      "qwen-plus",
    ]);
    expect(ranked[0]).toBe("qwen3-coder-plus");
    expect(ranked).toContain("qwen3.8-max");
    expect(ranked).toContain("qwen-plus");
    expect(ranked).toContain("qwen3.8-flash");
    expect(ranked).toContain("deepseek-v4-pro");
    expect(ranked.indexOf("qwen3.8-max")).toBeLessThan(ranked.indexOf("qwen3.8-max-0902"));
    for (const dropped of ["qwen-image-2.1-pro", "qwen3.8-omni-flash-realtime", "stepfun/step-5-preview", "glm-5.3", "qwen3.7-text-embedding-flash", "qwen-mt-uni"]) {
      expect(ranked).not.toContain(dropped);
    }
  });

  it("an explicit model is injected even when the key comes from the environment", () => {
    const creds = resolveQwenCodeCredentials({
      environ: { DASHSCOPE_API_KEY: "sk-dash" },
      storedModel: "qwen-plus",
      settingsPath: absent(),
    });
    expect(creds.asEnv()).toEqual({ OPENAI_MODEL: "qwen-plus" });
  });

  it("test_dashscope_env_recognized", () => {
    const creds = resolveQwenCodeCredentials({ environ: { DASHSCOPE_API_KEY: "sk-dash" }, settingsPath: absent() });
    expect(creds.source).toBe("environment");
    expect(creds.asEnv()).toEqual({});
  });

  it("test_qwen_settings_file_recognized", () => {
    const settings = path.join(tmpPath, "settings.json");
    fs.writeFileSync(settings, JSON.stringify({ modelProviders: { openai: {} } }), "utf8");
    const creds = resolveQwenCodeCredentials({ environ: {}, settingsPath: settings });
    expect(creds.source).toBe("qwen-settings");
    expect(creds.asEnv()).toEqual({});
  });

  it("test_missing_credentials_raise", async () => {
    await raises(() => resolveQwenCodeCredentials({ environ: {}, settingsPath: absent() }), QwenCodeCredentialError, "no model credentials");
  });
});

// ---------------------------------------------------------------------------
// Headless command + execution
// ---------------------------------------------------------------------------

const BIN = "/usr/local/bin/qwen";

describe("TestHeadlessCommand", () => {
  it("test_posix_argv_uses_list_not_shell", () => {
    const argv = qwenCode._buildHeadlessCommand(BIN, "hi", { windows: false });
    expect(argv).toEqual(["/usr/local/bin/qwen", "hi", "--output-format", "json", "--yolo"]);
  });

  it("test_prompt_travels_as_positional_not_deprecated_flag", () => {
    // The prompt is positional; the deprecated `-p` flag must not appear.
    const argv = qwenCode._buildHeadlessCommand(BIN, "hi", { windows: false });
    expect(argv[1]).toBe("hi");
    expect(argv).not.toContain("-p");
  });

  it("test_windows_cmd_wrapped_with_comspec", () => {
    process.env.COMSPEC = "cmd.exe";
    const argv = qwenCode._buildHeadlessCommand("qwen.cmd", "hi", { windows: true });
    expect(argv[0]).toBe("cmd.exe");
    expect(argv[1]).toBe("/c");
    expect(argv[2]).toBe("qwen.cmd");
  });

  it("test_max_session_turns_default_adds_no_flag", () => {
    // Without a turn budget the argv keeps the minimal headless flags.
    const argv = qwenCode._buildHeadlessCommand(BIN, "hi", { windows: false });
    expect(argv).toEqual(["/usr/local/bin/qwen", "hi", "--output-format", "json", "--yolo"]);
  });

  it("test_max_session_turns_forwarded_as_official_flag", () => {
    // A turn budget travels as the official `--max-session-turns` flag.
    const argv = qwenCode._buildHeadlessCommand(BIN, "hi", { maxSessionTurns: 30, windows: false });
    expect(argv).toEqual(["/usr/local/bin/qwen", "hi", "--output-format", "json", "--yolo", "--max-session-turns", "30"]);
  });

  it("test_session_id_flag_forwarded", () => {
    // The first clarification round pins the native session via --session-id.
    const session = "6f0f8e9a-1b2c-4d5e-8f90-123456789abc";
    const argv = qwenCode._buildHeadlessCommand(BIN, "hi", { sessionId: session, windows: false });
    expect(argv).toEqual(["/usr/local/bin/qwen", "hi", "--output-format", "json", "--yolo", "--session-id", session]);
  });

  it("test_resume_wins_over_session_id", () => {
    // The CLI rejects both session flags; --resume takes precedence.
    const argv = qwenCode._buildHeadlessCommand(BIN, "hi", {
      sessionId: "6f0f8e9a-1b2c-4d5e-8f90-123456789abc",
      resume: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      windows: false,
    });
    expect(argv).not.toContain("--session-id");
    expect(argv.slice(-2)).toEqual(["--resume", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"]);
  });

  it("test_json_schema_mapping_dumped_as_json_literal", () => {
    const schema = { type: "object", properties: { completeness: { type: "number" } } };
    const argv = qwenCode._buildHeadlessCommand(BIN, "hi", { jsonSchema: schema, windows: false });
    expect(argv[argv.length - 2]).toBe("--json-schema");
    expect(JSON.parse(argv[argv.length - 1] as string)).toEqual(schema);
  });

  it("test_json_schema_string_passed_through", () => {
    // The CLI also accepts an @path reference; strings are not re-encoded.
    const argv = qwenCode._buildHeadlessCommand(BIN, "hi", { jsonSchema: "@/tmp/schema.json", windows: false });
    expect(argv.slice(-2)).toEqual(["--json-schema", "@/tmp/schema.json"]);
  });

  it("test_native_session_flags_combine_with_turn_budget", () => {
    const argv = qwenCode._buildHeadlessCommand(BIN, "hi", {
      maxSessionTurns: 3,
      resume: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      jsonSchema: { type: "object" },
      windows: false,
    });
    expect(argv.slice(-2)).toEqual(["--max-session-turns", "3"]);
    expect(argv.slice(-4, -2)).toEqual(["--resume", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"]);
    expect(argv[argv.length - 6]).toBe("--json-schema");
    expect(JSON.parse(argv[argv.length - 5] as string)).toEqual({ type: "object" });
  });
});

interface Completed {
  returncode: number;
  stdout: string;
  stderr: string;
}

/** Minimal `Popen` stand-in for the blocking (json) path. */
class FakeProc {
  completed: Completed | null;
  pid = 4242;
  returncode: number;
  communicateTimeout: number | null = null;
  private timeoutOnce: boolean;

  constructor(completed: Completed | null, opts: { timeoutOnCommunicate?: boolean } = {}) {
    this.completed = completed;
    this.returncode = completed !== null ? completed.returncode : -9;
    this.timeoutOnce = opts.timeoutOnCommunicate ?? false;
  }

  async communicate(timeout: number | null = null): Promise<[string, string]> {
    this.communicateTimeout = timeout;
    if (this.timeoutOnce) {
      this.timeoutOnce = false;
      throw new TimeoutExpired("qwen", timeout ?? 0.0);
    }
    if (this.completed === null) return ["", ""];
    return [this.completed.stdout, this.completed.stderr];
  }
}

const asProc = (proc: FakeProc): HeadlessProcess => proc as unknown as HeadlessProcess;

function fakeSpawn(completed: Completed) {
  return async (_argv: string[], _kwargs: unknown): Promise<HeadlessProcess> => asProc(new FakeProc(completed));
}

const fakeBinary = (): void => {
  vi.spyOn(qwenCode.seams, "findQwenCodeBinary").mockReturnValue("/fake/qwen");
};

const ok = (stdout: string): Completed => ({ returncode: 0, stdout, stderr: "" });

describe("TestRunHeadless", () => {
  it("test_parses_result_message_and_passes_bounded_options", async () => {
    fakeBinary();
    const stdout = JSON.stringify([
      { type: "assistant", content: "working" },
      { type: "result", result: "all done", is_error: false },
    ]);
    const captured: { argv?: string[]; kwargs?: any } = {};
    const procs: FakeProc[] = [];

    vi.spyOn(qwenCode.seams, "spawnHeadless").mockImplementation(async (argv, kwargs) => {
      captured.argv = argv;
      captured.kwargs = kwargs;
      const proc = new FakeProc(ok(stdout));
      procs.push(proc);
      return asProc(proc);
    });

    const result = await runQwenCodeHeadless("hello", { cwd: tmpPath, timeout: 12.0 });

    expect(result.exitCode).toBe(0);
    expect(result.isError).toBe(false);
    expect(result.text).toBe("all done");
    const argv = captured.argv!;
    expect(Array.isArray(argv)).toBe(true);
    expect(argv.slice(0, 2)).toEqual(["/fake/qwen", "hello"]);
    expect(argv).not.toContain("-p");
    expect(argv).toContain("--output-format");
    expect(argv).toContain("--yolo");
    expect(captured.kwargs.cwd).toBe(tmpPath);
    expect(procs[0]!.communicateTimeout).toBe(12.0);
  });

  it("test_max_session_turns_forwarded_to_subprocess", async () => {
    // `runQwenCodeHeadless` forwards the turn budget to the CLI argv.
    fakeBinary();
    const stdout = JSON.stringify([{ type: "result", result: "ok", is_error: false }]);
    const captured: { argv?: string[] } = {};
    vi.spyOn(qwenCode.seams, "spawnHeadless").mockImplementation(async (argv) => {
      captured.argv = argv;
      return asProc(new FakeProc(ok(stdout)));
    });

    await runQwenCodeHeadless("hello", { cwd: tmpPath, maxSessionTurns: 42 });

    expect(captured.argv!.slice(-2)).toEqual(["--max-session-turns", "42"]);
  });

  it("test_structured_result_and_session_id_parsed", async () => {
    // A --json-schema run exposes structured_result + session_id.
    fakeBinary();
    const payload = { completeness: 0.9, question: "", missing: [], example: "x" };
    const stdout = JSON.stringify([
      { type: "assistant", content: "thinking" },
      {
        type: "result",
        result: JSON.stringify(payload),
        is_error: false,
        structured_result: payload,
        session_id: "6f0f8e9a-1b2c-4d5e-8f90-123456789abc",
      },
    ]);
    vi.spyOn(qwenCode.seams, "spawnHeadless").mockImplementation(fakeSpawn(ok(stdout)));

    const result = await runQwenCodeHeadless("hello", { cwd: tmpPath, jsonSchema: { type: "object" } });

    expect(result.structured).toEqual(payload);
    expect(result.sessionId).toBe("6f0f8e9a-1b2c-4d5e-8f90-123456789abc");
  });

  it("test_structured_result_falls_back_to_result_json", async () => {
    // Without structured_result the JSON-object result string is parsed.
    fakeBinary();
    const payload = { completeness: 0.5 };
    const stdout = JSON.stringify([{ type: "result", result: JSON.stringify(payload), is_error: false }]);
    vi.spyOn(qwenCode.seams, "spawnHeadless").mockImplementation(fakeSpawn(ok(stdout)));

    const result = await runQwenCodeHeadless("hello", { cwd: tmpPath });

    expect(result.structured).toEqual(payload);
    expect(result.sessionId).toBe("");
  });

  it("test_plain_text_result_keeps_structured_none", async () => {
    fakeBinary();
    const stdout = JSON.stringify([{ type: "result", result: "all done", is_error: false }]);
    vi.spyOn(qwenCode.seams, "spawnHeadless").mockImplementation(fakeSpawn(ok(stdout)));

    const result = await runQwenCodeHeadless("hello", { cwd: tmpPath });

    expect(result.structured).toBeNull();
    expect(result.sessionId).toBe("");
  });

  it("test_session_flags_reach_the_subprocess", async () => {
    fakeBinary();
    const stdout = JSON.stringify([{ type: "result", result: "ok", is_error: false }]);
    const captured: { argv?: string[] } = {};
    vi.spyOn(qwenCode.seams, "spawnHeadless").mockImplementation(async (argv) => {
      captured.argv = argv;
      return asProc(new FakeProc(ok(stdout)));
    });

    await runQwenCodeHeadless("assess", {
      cwd: tmpPath,
      sessionId: "6f0f8e9a-1b2c-4d5e-8f90-123456789abc",
      jsonSchema: { type: "object" },
    });

    const argv = captured.argv!;
    expect(argv).toContain("--session-id");
    expect(argv[argv.indexOf("--session-id") + 1]).toBe("6f0f8e9a-1b2c-4d5e-8f90-123456789abc");
    expect(argv).toContain("--json-schema");
  });

  it("test_error_result_flagged", async () => {
    fakeBinary();
    const stdout = JSON.stringify([{ type: "result", result: "boom", is_error: true }]);
    vi.spyOn(qwenCode.seams, "spawnHeadless").mockImplementation(fakeSpawn({ returncode: 1, stdout, stderr: "err" }));

    const result = await runQwenCodeHeadless("hello", { cwd: tmpPath });

    expect(result.isError).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.rawStderr).toBe("err");
  });

  it("test_missing_result_message_marks_error", async () => {
    fakeBinary();
    const stdout = JSON.stringify([{ type: "assistant", content: "hi" }]);
    vi.spyOn(qwenCode.seams, "spawnHeadless").mockImplementation(fakeSpawn(ok(stdout)));

    const result = await runQwenCodeHeadless("hello", { cwd: tmpPath });

    expect(result.isError).toBe(true);
    expect(result.text).toBe("");
  });

  it("test_non_json_stdout_marks_error", async () => {
    fakeBinary();
    vi.spyOn(qwenCode.seams, "spawnHeadless").mockImplementation(fakeSpawn(ok("plain text")));

    const result = await runQwenCodeHeadless("hello", { cwd: tmpPath });

    expect(result.isError).toBe(true);
  });

  it("test_timeout_raises_codegen_error", async () => {
    fakeBinary();
    const proc = new FakeProc(null, { timeoutOnCommunicate: true });
    const killed: unknown[] = [];
    vi.spyOn(qwenCode.seams, "spawnHeadless").mockImplementation(async () => asProc(proc));
    vi.spyOn(qwenCode.seams, "killProcessTree").mockImplementation(async (p) => {
      killed.push(p);
    });

    await raises(() => runQwenCodeHeadless("hello", { cwd: tmpPath, timeout: 1.0 }), AICodegenError, "did not finish");

    expect(killed.length).toBe(1);
    expect(killed[0]).toBe(proc); // the whole tree is reaped, not just the parent
  });

  it("test_missing_binary_raises", async () => {
    vi.spyOn(qwenCode.seams, "findQwenCodeBinary").mockReturnValue(null);
    await raises(() => runQwenCodeHeadless("hello", { cwd: tmpPath }), QwenCodeNotInstalledError);
  });

  it("test_missing_cwd_raises", async () => {
    fakeBinary();
    await raises(() => runQwenCodeHeadless("hello", { cwd: path.join(tmpPath, "missing") }), AICodegenError, "Working directory");
  });
});

// ---------------------------------------------------------------------------
// Real-subprocess tests: process tree, streaming, activity callback
// ---------------------------------------------------------------------------

const FAKE_QWEN = `#!${process.execPath}
const fs = require("fs");
const cp = require("child_process");

const mode = process.env.FAKE_QWEN_MODE || "ok";
const argv = process.argv.slice(2);
const stream = argv.includes("stream-json");
const pidfile = process.env.FAKE_QWEN_PIDFILE;
const counter = process.env.FAKE_QWEN_COUNTER;

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\\n");
}

function finish(text) {
  const result = { type: "result", result: text === undefined ? "ok" : text, is_error: false, session_id: "sid" };
  if (stream) emit(result);
  else process.stdout.write(JSON.stringify([result]) + "\\n");
}

if (counter) fs.appendFileSync(counter, "x");

if (mode === "reject-stream" && stream) {
  process.stderr.write("Unknown arguments: include-partial-messages, output-format\\n");
  process.exit(1);
}

if (mode === "hang") {
  const child = cp.spawn(process.execPath, ["-e", "setTimeout(() => {}, 120000)"], { stdio: "inherit" });
  fs.writeFileSync(pidfile, String(child.pid));
  if (stream) emit({ type: "system", subtype: "init" });
  setTimeout(() => {}, 120000);
} else if (mode === "stream") {
  emit({ type: "system", subtype: "init" });
  for (const piece of ["Hel", "lo \\x1b[31mwor\\x1b[0m\\nld"]) {
    emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: piece } } });
  }
  emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "private reasoning" } } });
  emit({ type: "assistant", message: { content: [{ type: "tool_use", name: "run_shell_command", input: { command: "echo sk-secret-token" } }] } });
  finish("streamed");
} else if (mode === "flood") {
  process.stderr.write("e".repeat(300000));
  finish("flooded");
} else if (mode === "slow") {
  setTimeout(() => finish("slow"), 2500);
} else if (mode === "stdin") {
  let length = 0;
  try { length = fs.readFileSync(0).length; } catch (e) { length = 0; }
  finish("stdin=" + length);
} else if (mode === "env") {
  finish(JSON.stringify(Object.keys(process.env).sort()));
} else if (mode === "argv") {
  finish(JSON.stringify({ argv, cwd: process.cwd() }));
} else if (mode === "exit3") {
  process.stderr.write("some failure\\n");
  process.exit(3);
} else {
  finish("ok");
}
`;

/** `true` once `pid` is gone (or only a zombie) — polled, never assumed. */
async function pidDead(pid: number, wait = 4000): Promise<boolean> {
  const deadline = Date.now() + wait;
  while (Date.now() < deadline) {
    const r = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" });
    if (r.error) {
      try {
        process.kill(pid, 0);
      } catch {
        return true;
      }
    } else {
      const stat = r.stdout.trim();
      if (!stat || stat.startsWith("Z")) return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

function setupFakeQwen(): string {
  const script = path.join(tmpPath, "fake-qwen");
  // The script is CommonJS; pin that so a stray "type": "module" package.json in an ancestor directory cannot change it.
  writeFile(path.join(tmpPath, "package.json"), '{"type":"commonjs"}\n');
  writeFile(script, FAKE_QWEN, 0o755);
  process.env.FAKE_QWEN_PIDFILE = path.join(tmpPath, "child.pid");
  process.env.FAKE_QWEN_COUNTER = path.join(tmpPath, "counter");
  return script;
}

const posixOnly = process.platform === "win32" ? describe.skip : describe;

posixOnly("TestRealProcess", () => {
  let fakeQwen = "";
  beforeEach(() => {
    fakeQwen = setupFakeQwen();
  });

  it("test_streaming_reports_activity_without_leaking_input", async () => {
    process.env.FAKE_QWEN_MODE = "stream";
    const seen: string[] = [];

    const result = await runQwenCodeHeadless("hi", {
      binary: fakeQwen,
      cwd: tmpPath,
      timeout: 20,
      onActivity: (s) => seen.push(s),
    });

    expect(result.text).toBe("streamed");
    expect(result.sessionId).toBe("sid");
    expect(result.isError).toBe(false);
    // The feed scrolls by line: text lines first, the tool as its own line.
    expect(seen[seen.length - 1]!.split("\n")).toEqual(["starting", "Hello wor", "ld", "tool: run_shell_command echo sk-…"]);
    expect(seen.some((s) => s.split("\n").includes("Hello wor"))).toBe(true);
    const joined = seen.join("\n");
    expect(joined).not.toContain("sk-secret-token"); // the command is shown, the token is redacted
    expect(joined).not.toContain("private reasoning"); // neither is thinking
    expect(joined).not.toContain("\x1b");
    expect(seen.every((s) => s.split("\n").length <= qwenCode._ACTIVITY_FEED_LINES)).toBe(true);
    expect(result.rawStdout).not.toContain("stream_event"); // per-token lines are not kept
  });

  it("test_without_callback_the_run_stays_plain_json", async () => {
    process.env.FAKE_QWEN_MODE = "stream";
    const result = await runQwenCodeHeadless("hi", { binary: fakeQwen, cwd: tmpPath, timeout: 20 });
    expect(result.text).toBe("streamed");
    expect(result.rawStdout).not.toContain("stream-json");
  });

  it("test_heartbeat_while_the_agent_is_silent", async () => {
    process.env.FAKE_QWEN_MODE = "slow";
    const beats: string[] = [];
    await runQwenCodeHeadless("hi", { binary: fakeQwen, cwd: tmpPath, timeout: 20, onActivity: (s) => beats.push(s) });
    expect(beats.length).toBeGreaterThanOrEqual(2);
  });

  it("test_stderr_flood_does_not_deadlock", async () => {
    process.env.FAKE_QWEN_MODE = "flood";
    const result = await runQwenCodeHeadless("hi", { binary: fakeQwen, cwd: tmpPath, timeout: 20, onActivity: () => {} });
    expect(result.text).toBe("flooded");
    expect(result.rawStderr.length).toBe(300000);
  });

  it("test_rejected_stream_flags_fall_back_to_json_once", async () => {
    process.env.FAKE_QWEN_MODE = "reject-stream";
    const result = await runQwenCodeHeadless("hi", { binary: fakeQwen, cwd: tmpPath, timeout: 20, onActivity: () => {} });
    expect(result.text).toBe("ok");
    expect(fs.readFileSync(path.join(tmpPath, "counter"), "utf8")).toBe("xx"); // stream attempt + json retry
  });

  it("test_stdin_is_not_inherited", async () => {
    process.env.FAKE_QWEN_MODE = "stdin";
    const result = await runQwenCodeHeadless("hi", { binary: fakeQwen, cwd: tmpPath, timeout: 20 });
    expect(result.text).toBe("stdin=0");
  });

  for (const [id, streaming] of [
    ["json", false],
    ["stream-json", true],
  ] as Array<[string, boolean]>) {
    it(`test_timeout_kills_the_whole_process_tree [${id}]`, async () => {
      // A timed-out run must not leave descendants running (the 13-minute leak).
      process.env.FAKE_QWEN_MODE = "hang";
      const started = performance.now();
      await raises(
        () =>
          runQwenCodeHeadless("hi", {
            binary: fakeQwen,
            cwd: tmpPath,
            timeout: 1.5,
            onActivity: streaming ? () => {} : null,
          }),
        QwenCodeTimeoutError,
      );
      expect((performance.now() - started) / 1000).toBeLessThan(15);
      const child = parseInt(fs.readFileSync(path.join(tmpPath, "child.pid"), "utf8"), 10);
      expect(await pidDead(child)).toBe(true);
    });
  }

  it("test_keyboard_interrupt_kills_the_whole_process_tree", async () => {
    process.env.FAKE_QWEN_MODE = "hang";

    const interrupt = (_summary: string): void => {
      throw new KeyboardInterrupt();
    };

    await raises(
      () => runQwenCodeHeadless("hi", { binary: fakeQwen, cwd: tmpPath, timeout: 30, onActivity: interrupt }),
      KeyboardInterrupt,
    );
    expect(await pidDead(parseInt(fs.readFileSync(path.join(tmpPath, "child.pid"), "utf8"), 10))).toBe(true);
  });

  it("test_callback_errors_never_fail_the_run", async () => {
    process.env.FAKE_QWEN_MODE = "stream";

    const broken = (_summary: string): void => {
      throw new Error("renderer exploded");
    };

    const result = await runQwenCodeHeadless("hi", { binary: fakeQwen, cwd: tmpPath, timeout: 20, onActivity: broken });
    expect(result.text).toBe("streamed");
  });
});

describe("TestStreamHelpers", () => {
  it("test_stream_argv_uses_stream_json_and_partial_messages", () => {
    const argv = qwenCode._buildHeadlessCommand(BIN, "hi", { stream: true, windows: false });
    expect(argv.slice(0, 6)).toEqual([
      "/usr/local/bin/qwen",
      "hi",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--yolo",
    ]);
  });

  it("test_default_argv_is_unchanged", () => {
    const argv = qwenCode._buildHeadlessCommand(BIN, "hi", { windows: false });
    expect(argv).toEqual(["/usr/local/bin/qwen", "hi", "--output-format", "json", "--yolo"]);
  });

  it("test_feed_ignores_thinking_and_unknown_events", () => {
    const feed = new qwenCode._ActivityFeed();
    const thinking = {
      type: "stream_event",
      event: { delta: { type: "thinking_delta", thinking: "secret" } },
    };
    expect(qwenCode._feedStreamEvent(thinking, feed)).toBe(false);
    expect(qwenCode._feedStreamEvent({ type: "wat" }, feed)).toBe(false);
    expect(qwenCode._feedStreamEvent("not a dict", feed)).toBe(false);
    expect(feed.render()).toBe("");
  });

  const text = (feed: qwenCode._ActivityFeed, value: string): void => {
    qwenCode._feedStreamEvent({ type: "stream_event", event: { delta: { type: "text_delta", text: value } } }, feed);
  };

  it("test_feed_scrolls_by_line", () => {
    const feed = new qwenCode._ActivityFeed();
    text(feed, "first li");
    expect(feed.render()).toBe("first li"); // the unfinished line is shown live
    text(feed, "ne\nsecond line\nthi");
    expect(feed.render().split("\n")).toEqual(["first line", "second line", "thi"]);
    text(feed, "rd\n");
    expect(feed.render().split("\n")).toEqual(["first line", "second line", "third"]);
  });

  it("test_tool_use_starts_its_own_line", () => {
    const feed = new qwenCode._ActivityFeed();
    text(feed, "checking docs");
    qwenCode._feedStreamEvent(
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "web_fetch", input: { url: "u" } }] },
      },
      feed,
    );
    expect(feed.render().split("\n")).toEqual(["checking docs", "tool: web_fetch u"]);
    expect(feed.render()).not.toContain('"u"');
    expect(feed.render().split("\n").some((line) => line === "u")).toBe(false);
  });

  it("test_tool_name_shows_when_the_call_starts_and_is_not_repeated", () => {
    const feed = new qwenCode._ActivityFeed();
    const started = qwenCode._feedStreamEvent(
      {
        type: "stream_event",
        event: {
          type: "content_block_start",
          content_block: { type: "tool_use", name: "write_file", input: {} },
        },
      },
      feed,
    );
    expect(started).toBe(true);
    expect(feed.render()).toBe("tool: write_file");
    const finished = qwenCode._feedStreamEvent(
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "write_file", input: { path: "commands.py", content: "secret" } }],
        },
      },
      feed,
    );
    expect(finished).toBe(true);
    expect(feed.render().split("\n")).toEqual(["tool: write_file commands.py"]);
    expect(feed.render()).not.toContain("secret");
  });

  it("test_streamed_tool_json_rewrites_the_open_line", () => {
    const feed = new qwenCode._ActivityFeed();
    qwenCode._feedStreamEvent(
      {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 1,
          content_block: { type: "tool_use", name: "run_shell_command", input: {} },
        },
      },
      feed,
    );
    const partial = qwenCode._feedStreamEvent(
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: '{"command": "echo ' },
        },
      },
      feed,
    );
    expect(partial).toBe(false);
    expect(feed.render()).toBe("tool: run_shell_command");
    const done = qwenCode._feedStreamEvent(
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: 'hi"}' },
        },
      },
      feed,
    );
    expect(done).toBe(true);
    expect(feed.render()).toBe("tool: run_shell_command echo hi");
    const stopped = qwenCode._feedStreamEvent(
      { type: "stream_event", event: { type: "content_block_stop", index: 1 } },
      feed,
    );
    expect(stopped).toBe(false);
    expect(feed.render()).toBe("tool: run_shell_command echo hi");
  });

  it("test_detail_appends_when_text_was_committed_after_the_tool", () => {
    const feed = new qwenCode._ActivityFeed();
    qwenCode._feedStreamEvent(
      {
        type: "stream_event",
        event: { type: "content_block_start", content_block: { type: "tool_use", name: "write_file", input: {} } },
      },
      feed,
    );
    text(feed, "done\n");
    const changed = qwenCode._feedStreamEvent(
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "write_file", input: { path: "commands.py", content: "secret" } }] },
      },
      feed,
    );
    expect(changed).toBe(true);
    expect(feed.render().split("\n")).toEqual(["tool: write_file", "done", "tool: write_file commands.py"]);
    expect(feed.render()).not.toContain("secret");
  });

  it("test_tool_detail_prefers_the_first_key_and_redacts", () => {
    const feed = new qwenCode._ActivityFeed();
    qwenCode._feedStreamEvent(
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "run_shell_command",
              input: {
                url: "https://example.com",
                command: ["echo", "sk-abcd", "github_pat_abcd", "ghp_abcd", "gho_abcd", "AKIAABCD", "Bearer abcd"],
                content: "secret",
                old_string: "secret",
                new_string: "secret",
                api_key: "secret",
                token: "secret",
                secret: "secret",
                password: "secret",
                thinking: "secret",
              },
            },
          ],
        },
      },
      feed,
    );
    expect(feed.render()).toBe("tool: run_shell_command echo sk-… github_pat_… ghp_… gho_… AKIA… Bearer …");
    expect(feed.render()).not.toContain("abcd");
    expect(feed.render()).not.toContain("secret");
    expect(feed.render()).not.toContain("https://example.com");
  });

  it("test_feed_is_bounded_and_single_line_entries_are_clean", () => {
    const feed = new qwenCode._ActivityFeed();
    text(feed, "x".repeat(1000) + "\n\x1b[31mend");
    const lines = feed.render().split("\n");
    expect(lines[lines.length - 1]).toBe("end");
    expect(lines.every((line) => [...line].length <= qwenCode._ACTIVITY_SUMMARY_MAX)).toBe(true);
    expect(feed.render()).not.toContain("\x1b");
    for (let n = 0; n < 50; n += 1) text(feed, `line ${n}\n`);
    expect(feed.render().split("\n").length).toBe(qwenCode._ACTIVITY_FEED_LINES);
    const rendered = feed.render().split("\n");
    expect(rendered[rendered.length - 1]).toBe("line 49");
  });
});

// ---------------------------------------------------------------------------
// Extra coverage for the TypeScript port (no Python counterpart): byte-exact agreement with the original module on
// generated corpora (`tests/fixtures/agent/render_golden.py`), and the Node-specific I/O helpers.
// ---------------------------------------------------------------------------

describe("TestGoldenAgreement", () => {
  const golden = readGolden().qwen;

  it("_parse_headless_output", () => {
    for (const entry of golden.parse_output) {
      expect(qwenCode._parseHeadlessOutput(entry.stdout), JSON.stringify(entry.stdout)).toEqual(entry.result);
    }
  });

  it("_one_line", () => {
    for (const entry of golden.one_line) {
      expect(qwenCode._oneLine(entry.text, entry.limit), JSON.stringify(entry)).toBe(entry.result);
    }
  });

  it("_build_headless_command", () => {
    process.env.COMSPEC = "cmd.exe";
    for (const entry of golden.command) {
      const kw = entry.kw as Record<string, any>;
      const argv = qwenCode._buildHeadlessCommand(entry.binary, "p中 'quote' \"dq\"", {
        windows: entry.windows,
        maxSessionTurns: kw.max_session_turns,
        sessionId: kw.session_id,
        resume: kw.resume,
        jsonSchema: kw.json_schema,
        stream: kw.stream,
      });
      expect(argv, JSON.stringify(entry)).toEqual(entry.argv);
    }
  });

  it("detect_standalone_target", () => {
    for (const entry of golden.target) {
      expect(detectStandaloneTarget({ system: entry.system, machine: entry.machine }), JSON.stringify(entry)).toBe(entry.result);
    }
  });

  it("asset names, urls and install commands", () => {
    for (const [target, name] of Object.entries(golden.asset)) expect(standaloneAssetName(target)).toBe(name);
    for (const [target, urls] of Object.entries(golden.urls)) expect(standaloneDownloadUrls(target)).toEqual(urls);
    expect(officialInstallCommand({ windows: false })).toBe(golden.install_command.posix);
    expect(officialInstallCommand({ windows: true })).toBe(golden.install_command.windows);
  });

  it("_parse_sha256sums", () => {
    for (const entry of golden.sha256sums) {
      expect({ ...qwenCode._parseSha256sums(entry.text) }, JSON.stringify(entry.text)).toEqual(entry.result);
    }
  });

  it("scrubbed_environ", () => {
    expect(qwenCode.scrubbedEnviron(golden.scrub.env)).toEqual(golden.scrub.result);
  });

  it("resolve_qwen_code_credentials (sources, defaults, error text)", async () => {
    let index = 0;
    for (const entry of golden.credentials) {
      const settings = path.join(tmpPath, `s${index}.json`);
      index += 1;
      if (entry.settings != null) fs.writeFileSync(settings, entry.settings, "utf8");
      const kw = entry.kw as Record<string, any>;
      const call = () =>
        resolveQwenCodeCredentials({
          storedApiKey: kw.stored_api_key,
          llmApiKey: kw.llm_api_key,
          storedBaseUrl: kw.stored_base_url,
          storedModel: kw.stored_model,
          environ: entry.environ,
          settingsPath: settings,
        });
      if (entry.error) {
        const exc = await raises(call, QwenCodeCredentialError);
        expect({ message: exc.message, suggestion: exc.suggestion, str: String(exc), code: exc.code }).toEqual(entry.error);
      } else {
        const creds = call();
        expect({
          source: creds.source,
          api_key: creds.apiKey,
          base_url: creds.baseUrl,
          model: creds.model,
          env: creds.asEnv(),
        }).toEqual(entry.result);
      }
    }
  });

  it("activity feed event sequences", () => {
    for (const steps of golden.feed) {
      const feed = new qwenCode._ActivityFeed();
      for (const step of steps) {
        const changed = qwenCode._feedStreamEvent(step.event, feed);
        expect({ changed, render: feed.render() }, JSON.stringify(step.event)).toEqual({ changed: step.changed, render: step.render });
      }
    }
  });
});

describe("TestRunHeadlessExtras", () => {
  it("uses the located binary when none is passed, and reports startup failures like OSError", async () => {
    const missing = path.join(tmpPath, "does-not-exist");
    const exc = await raises(
      () => runQwenCodeHeadless("hi", { binary: missing, cwd: tmpPath, timeout: 5 }),
      QwenCodeStartupError,
    );
    expect(exc.message).toBe(`Failed to start Qwen Code: [Errno 2] No such file or directory: '${missing}'`);
  });

  it("passes the prompt untouched as one argv element (no shell)", async () => {
    process.env.FAKE_QWEN_MODE = "argv";
    const script = setupFakeQwen();
    const prompt = "line1\nsecond 'quoted' \"dq\" $HOME `x` ; rm -rf / 中文";
    const result = await runQwenCodeHeadless(prompt, { binary: script, cwd: tmpPath, timeout: 20, maxSessionTurns: 5 });
    const seen = JSON.parse(result.text) as { argv: string[]; cwd: string };
    expect(seen.argv[0]).toBe(prompt);
    expect(seen.argv.slice(1)).toEqual(["--output-format", "json", "--yolo", "--max-session-turns", "5"]);
    expect(fs.realpathSync(seen.cwd)).toBe(fs.realpathSync(tmpPath));
  });

  it("merges env on top of the inherited environment, and cleanEnv scrubs cloud credentials", async () => {
    process.env.FAKE_QWEN_MODE = "env";
    const script = setupFakeQwen();
    process.env.E2B_API_KEY = "cloud-secret";
    process.env.ALICLOUD_ACCESS_KEY_ID = "cloud-secret";
    try {
      const inherited = await runQwenCodeHeadless("hi", { binary: script, cwd: tmpPath, timeout: 20, env: { OPENAI_API_KEY: "sk-x" } });
      const inheritedKeys = JSON.parse(inherited.text) as string[];
      expect(inheritedKeys).toContain("E2B_API_KEY");
      expect(inheritedKeys).toContain("OPENAI_API_KEY");

      const scrubbed = await runQwenCodeHeadless("hi", {
        binary: script,
        cwd: tmpPath,
        timeout: 20,
        env: { OPENAI_API_KEY: "sk-x", EXTRA_FROM_CALLER: "1", FAKE_QWEN_MODE: "env" },
        cleanEnv: true,
      });
      const scrubbedKeys = JSON.parse(scrubbed.text) as string[];
      expect(scrubbedKeys).not.toContain("E2B_API_KEY");
      expect(scrubbedKeys).not.toContain("ALICLOUD_ACCESS_KEY_ID");
      expect(scrubbedKeys).toContain("OPENAI_API_KEY");
      expect(scrubbedKeys).toContain("EXTRA_FROM_CALLER");
      expect(scrubbedKeys).toContain("PATH");
    } finally {
      delete process.env.E2B_API_KEY;
      delete process.env.ALICLOUD_ACCESS_KEY_ID;
    }
  });

  it("reports a non-zero exit with stderr and no result message as an error", async () => {
    process.env.FAKE_QWEN_MODE = "exit3";
    const script = setupFakeQwen();
    const result = await runQwenCodeHeadless("hi", { binary: script, cwd: tmpPath, timeout: 20 });
    expect(result.isError).toBe(true);
    expect(result.exitCode).toBe(3);
    expect(result.rawStderr).toBe("some failure\n");
    expect(result.text).toBe("");
  });

  it("does not retry in json mode for an unrelated streaming failure", async () => {
    process.env.FAKE_QWEN_MODE = "exit3";
    const script = setupFakeQwen();
    const result = await runQwenCodeHeadless("hi", { binary: script, cwd: tmpPath, timeout: 20, onActivity: () => {} });
    expect(result.exitCode).toBe(3);
    expect(fs.readFileSync(path.join(tmpPath, "counter"), "utf8")).toBe("x");
  });
});

describe("TestArchiveSafety", () => {
  const fails = async (archive: Buffer, target = "linux-x64"): Promise<void> => {
    patchNetwork(archive);
    await raises(
      () => qwenCode.downloadAndInstallStandalone({ target, binDir: path.join(tmpPath, "bin") }),
      QwenCodeNotInstalledError,
    );
    expect(fs.existsSync(path.join(tmpPath, "bin", ".qwen-code-staging"))).toBe(false);
    expect(fs.existsSync(path.join(tmpPath, "bin", "qwen"))).toBe(false);
  };

  it("rejects a symlink pointing outside the extraction directory", async () => {
    await fails(tarGzBytes([{ name: "qwen-code/link", type: "2", linkname: "../../../etc/passwd" }]));
  });

  it("rejects an absolute symlink target", async () => {
    await fails(tarGzBytes([{ name: "qwen-code/link", type: "2", linkname: "/etc/passwd" }]));
  });

  it("rejects device nodes", async () => {
    await fails(tarGzBytes([{ name: "qwen-code/dev", type: "3" }]));
  });

  it("rejects zip entries escaping the destination", async () => {
    await fails(zipBytes([{ name: "../evil.txt", content: "x" }]), "win-x64");
  });

  it("rejects a zip member with a bad CRC", async () => {
    const entry = qwenCode._entryRelativePath("win-x64").split(path.sep).join("/");
    const node = qwenCode._nodeRelativePath("win-x64").split(path.sep).join("/");
    await fails(
      zipBytes([
        { name: entry, content: "@echo off\r\n", crc: 1 },
        { name: node, content: "node" },
      ]),
      "win-x64",
    );
  });

  it("rejects absolute member names instead of escaping", async () => {
    await fails(
      tarGzBytes([
        { name: "/abs-evil.txt", content: "x" },
        { name: "qwen-code/bin/qwen", content: "#!/bin/sh\n", mode: 0o755 },
        { name: "qwen-code/node/bin/node", content: "n", mode: 0o755 },
      ]),
    );
    expect(fs.existsSync("/abs-evil.txt")).toBe(false);
  });

  it("replaces an existing installation atomically and keeps no .old/.new leftovers", async () => {
    const binDir = path.join(tmpPath, "bin");
    const archive = tarGzForTarget("linux-x64");
    patchNetwork(archive);
    await qwenCode.downloadAndInstallStandalone({ target: "linux-x64", binDir });
    fs.writeFileSync(path.join(binDir, "qwen-code", "stale.txt"), "old");
    await qwenCode.downloadAndInstallStandalone({ target: "linux-x64", binDir });
    expect(fs.existsSync(path.join(binDir, "qwen-code", "stale.txt"))).toBe(false);
    expect(fs.readdirSync(binDir).sort()).toEqual(["qwen", "qwen-code"]);
  });

  it("writes a wrapper that survives quotes and spaces in the install path", async () => {
    const binDir = path.join(tmpPath, "it's a dir");
    patchNetwork(tarGzForTarget("linux-x64"));
    const wrapper = await qwenCode.downloadAndInstallStandalone({ target: "linux-x64", binDir });
    const run = spawnSync(wrapper, [], { encoding: "utf8" });
    expect(run.stdout).toBe("qwen\n");
  });

  it("reports progress messages in order", async () => {
    patchNetwork(tarGzForTarget("linux-x64"));
    const messages: string[] = [];
    await qwenCode.downloadAndInstallStandalone({ target: "linux-x64", binDir: path.join(tmpPath, "bin"), onProgress: (m) => messages.push(m) });
    expect(messages).toEqual([
      "Downloading qwen-code-linux-x64.tar.gz from aliyun mirror...",
      "Verifying SHA256 checksum...",
      "Extracting archive...",
      `Installing Qwen Code into ${path.join(tmpPath, "bin")}...`,
    ]);
  });
});

describe("TestHttpHelpers", () => {
  let server: http.Server;
  let base = "";
  const seenHeaders: http.IncomingHttpHeaders[] = [];
  const proxyKeys = ["http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY", "all_proxy", "ALL_PROXY", "no_proxy", "NO_PROXY"];
  let savedProxies: Record<string, string | undefined> = {};

  beforeEach(async () => {
    savedProxies = Object.fromEntries(proxyKeys.map((k) => [k, process.env[k]]));
    for (const k of proxyKeys) delete process.env[k];
    server = http.createServer((req, res) => {
      seenHeaders.push(req.headers);
      if (req.url === "/file") {
        res.writeHead(200, { "content-type": "application/octet-stream" });
        res.end(Buffer.from([0, 1, 2, 255, 254]));
      } else if (req.url === "/redirect") {
        res.writeHead(302, { location: "/file" });
        res.end();
      } else if (req.url === "/text") {
        res.writeHead(200);
        res.end(Buffer.from([0x61, 0xff, 0x62]));
      } else if (req.url === "/hang") {
        res.writeHead(200);
        res.write("partial");
      } else {
        res.writeHead(404, "Not Found");
        res.end("nope");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const [k, v] of Object.entries(savedProxies)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("downloads bytes, sends the documented User-Agent and follows redirects", async () => {
    const dest = path.join(tmpPath, "out.bin");
    await qwenCode._downloadToFile(`${base}/redirect`, dest, { timeout: 5 });
    expect([...fs.readFileSync(dest)]).toEqual([0, 1, 2, 255, 254]);
    expect(seenHeaders[0]!["user-agent"]).toBe("easy-sandbox-qwen-code/1.0");
  });

  it("decodes text with replacement characters like bytes.decode('utf-8', 'replace')", async () => {
    expect(await qwenCode._httpGetText(`${base}/text`, { timeout: 5 })).toBe("a\ufffdb");
  });

  it("raises HTTP Error 404 for non-2xx responses", async () => {
    const exc = await raises(() => qwenCode._httpGetText(`${base}/missing`, { timeout: 5 }), Error);
    expect(exc.message).toBe("HTTP Error 404: Not Found");
  });

  it("times out on a stalled body instead of hanging", async () => {
    const started = performance.now();
    await raises(() => qwenCode._downloadToFile(`${base}/hang`, path.join(tmpPath, "x"), { timeout: 0.5 }), Error);
    expect((performance.now() - started) / 1000).toBeLessThan(10);
  });
});
