import { useMockCloudConfiguration } from "../_support/mockCloudConfiguration.js";
/**
 * Offline end-to-end: long CLI steps use one moving header.
 *
 * Docker, ACR, and the sandbox filesystem are mocked. A fake terminal captures the activity block (Rich is not used:
 * the runner's stdout is not a TTY, so the CLI draws the `--no-color` transient block). Quiet and non-TTY runs must
 * not dump per-line logs or file bytes.
 *
 * Port of `tests/integration/test_progress_activity_e2e.py`. Like its Python original this file is NOT marked as a
 * live integration test (no credentials, no network), so it also runs under the default `npm test`. A live Docker run
 * is still manual.
 */

import "../_support/isolatedHome.js";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { Sandbox } from "../../src/api/sandbox.js";
import * as fcTemplate from "../../src/providers/alicloud_express/fc_template.js";
import * as codingAgent from "../../src/cli/commands/_coding_agent.js";
import { codingAgentSeams } from "../../src/cli/commands/_coding_agent.js";
import { cli } from "../../src/cli/main.js";
import { outputSeams } from "../../src/cli/output.js";
import { CliError } from "../../src/cli/errors.js";
import { sys } from "../../src/cli/io.js";
import { SandboxInfo } from "../../src/models/sandbox.js";
import * as templateIndexMod from "../../src/utils/template_index.js";
import { CliRunner, type Result } from "../helpers/cliRunner.js";
import { _CI_ENV_VARS, useIsolatedEnv } from "../_support/env.js";
import { fakeConfig, patchLoadConfig, spyAny, useMockBuilder } from "../helpers/templateSupport.js";
import { TTYBuffer, useOutputSeams } from "../test_cli/conftest.js";

const iso = useIsolatedEnv();
const seams = useOutputSeams();
const mockBuilder = useMockBuilder();
const _SECRET = "super-secret-file-bytes";
const _TOKEN = "acr-placeholder-token";

const runner = (): CliRunner => new CliRunner();

let tmp = "";
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "abx-progress-"));
  for (const v of _CI_ENV_VARS) iso.monkeypatch.delenv(v);
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** `_FakeSys`: only `stderr` differs from the real module; stdout stays whatever the test runner installed. */
function fakeSys(stderr: TTYBuffer): typeof outputSeams.sys {
  return {
    get stdout() {
      return sys.stdout;
    },
    stderr,
  } as typeof outputSeams.sys;
}

/** `tty_stderr` fixture. */
function ttyStderr(): TTYBuffer {
  const buf = new TTYBuffer(true);
  seams.sys = fakeSys(buf);
  iso.monkeypatch.setenv("TERM", "xterm-256color");
  seams.activityMinInterval = 0.0;
  return buf;
}

const _combined = (result: Result): string => `${result.output}${result.stderr ?? ""}`;

function _prepareTemplate(dir: string): void {
  fs.writeFileSync(path.join(dir, "Dockerfile"), "FROM ubuntu:22.04\n");
  fs.writeFileSync(path.join(dir, "template.yaml"), "name: my-template\nresources:\n  cpu: 2\n  memory: 2048\n");
}

/** Install the mocked `DockerBuilder` that streams its lines through `on_output` / `on_poll`. */
function _installBuilder(): void {
  const { builder } = mockBuilder();
  builder.build.mockImplementation(async (...args: unknown[]) => {
    const emit = (args[2] as { on_output?: ((line: string) => void) | null } | undefined)?.on_output;
    if (emit) {
      emit("#5 [1/2] FROM ubuntu:22.04");
      emit("   ");
      emit("#5 DONE 0.1s");
    }
    return "my-template:latest";
  });
  builder.push.mockImplementation(async (...args: unknown[]) => {
    const emit = (args[1] as { on_output?: ((line: string) => void) | null } | undefined)?.on_output;
    if (emit) emit("Pushed my-template:latest");
  });
  builder.loginAcrWithAksk.mockResolvedValue({ tempUserName: "temp-user", authorizationToken: _TOKEN });
  builder.tag.mockResolvedValue(undefined);
  spyAny(fcTemplate, "createOfficialTemplate").mockResolvedValue({ templateID: "tpl-progress", statusCode: 200 });
  spyAny(fcTemplate, "waitForTemplateReady").mockImplementation((async (_id: string, opts: { on_poll?: (s: string, e: number) => void }) => {
    opts.on_poll?.("Creating", 0);
    opts.on_poll?.("Ready", 2);
    return { status: { state: "ready" } };
  }) as never);
  patchLoadConfig(fakeConfig({ access_key_secret: "platform-placeholder" }));
}

async function _invokeBuild(dir: string, prefix: string[] = []): Promise<Result> {
  _installBuilder();
  return runner().invoke(cli, [...prefix, "template", "build", dir, "--acr-namespace", "test-ns", "--yes"]);
}

function _sandbox(sandbox_id = "sbx-cli-test-001") {
  const info = SandboxInfo.modelValidate({
    sandboxID: sandbox_id,
    templateID: "python-base",
    status: "running",
    region: "cn-hangzhou",
    timeout: 300,
    envdUrl: `https://${sandbox_id}.example.invalid`,
    envdAccessToken: "envd-access-token-secret",
  });
  return {
    id: info.sandbox_id,
    status: info.status,
    url: info.envd_url,
    info,
    kill: vi.fn().mockResolvedValue(undefined),
    files: { write: vi.fn(), readBytes: vi.fn() },
  };
}

it("test_deploy_streams_build_lines_under_the_header", async () => {
  const tty = ttyStderr();
  _prepareTemplate(tmp);
  const result = await _invokeBuild(tmp);
  expect(result.exit_code, result.output).toBe(0);
  const shown = tty.getvalue();
  expect(shown).toContain("Building Docker image locally");
  expect(shown).toContain("... 0s");
  expect(shown).toContain("#5 [1/2] FROM ubuntu:22.04");
  expect(shown).toContain("#5 DONE 0.1s");
  expect(shown).toContain("Pushed my-template:latest");
  expect(shown).toContain("Ready 2s");
  expect(shown).not.toContain(_TOKEN);
  expect(shown).not.toContain(_SECRET);
  const stdout = result.stdout ?? "";
  expect(stdout).not.toContain("#5 [1/2] FROM ubuntu:22.04");
  expect(stdout).not.toContain(_TOKEN);
});

it("test_non_tty_deploy_does_not_dump_build_lines", async () => {
  _prepareTemplate(tmp);
  const result = await _invokeBuild(tmp);
  expect(result.exit_code, result.output).toBe(0);
  const combined = _combined(result);
  expect(combined).toContain("Building Docker image locally");
  expect(combined).not.toContain("#5 [1/2] FROM ubuntu:22.04");
  expect(combined).not.toContain("Pushed my-template:latest");
  expect(combined).not.toContain(_TOKEN);
});

it("test_upload_lists_paths_and_not_file_bytes", async () => {
  const tty = ttyStderr();
  const src = path.join(tmp, "payload");
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, "notes.txt"), _SECRET);
  fs.writeFileSync(path.join(src, "keep.py"), "print(1)\n");
  const seen: Array<[string, Buffer]> = [];
  const write = vi.fn(async (dest: string, data: Buffer | string) => {
    seen.push([dest, Buffer.from(data)]);
  });
  vi.spyOn(Sandbox, "connect").mockResolvedValue({ files: { write } } as unknown as Sandbox);

  const result = await runner().invoke(cli, ["sandbox", "upload", "sb-1", src, "/app/data"]);

  expect(result.exit_code, result.output).toBe(0);
  expect(seen.some(([, payload]) => payload.equals(Buffer.from(_SECRET)))).toBe(true);
  const shown = tty.getvalue();
  expect(shown).toContain("Uploading");
  expect(shown).toContain("notes.txt");
  expect(shown).toContain("keep.py");
  expect(shown).not.toContain(_SECRET);
  expect(_combined(result)).not.toContain(_SECRET);
});

it("test_quiet_upload_does_not_list_files", async () => {
  const src = path.join(tmp, "one.txt");
  fs.writeFileSync(src, _SECRET);
  seams.isTty = () => false;
  vi.spyOn(Sandbox, "connect").mockResolvedValue({ files: { write: vi.fn().mockResolvedValue(undefined) } } as unknown as Sandbox);

  const result = await runner().invoke(cli, ["--quiet", "sandbox", "upload", "sb-1", src, "/app/one.txt"]);

  expect(result.exit_code, result.output).toBe(0);
  const combined = _combined(result);
  expect(combined).not.toContain("notes.txt");
  expect(combined).not.toContain(_SECRET);
  expect(combined).not.toContain("Uploading");
});

it("test_json_deploy_does_not_dump_build_lines", async () => {
  _prepareTemplate(tmp);
  const result = await _invokeBuild(tmp, ["--json"]);
  expect(result.exit_code, result.output).toBe(0);
  const combined = _combined(result);
  expect(combined).toContain("tpl-progress");
  expect(combined).not.toContain("#5 [1/2] FROM ubuntu:22.04");
  expect(combined).not.toContain(_TOKEN);
});

it("test_create_shows_an_elapsed_header", async () => {
  const tty = ttyStderr();
  vi.spyOn(Sandbox, "create").mockResolvedValue(_sandbox() as unknown as Sandbox);

  const result = await runner().invoke(cli, ["create", "--template", "python-base", "--request-timeout", "45"]);

  expect(result.exit_code, result.output).toBe(0);
  const shown = tty.getvalue();
  expect(shown).toContain("Creating sandbox... 0s");
  expect(shown).not.toContain("envd-access-token-secret");
  const stdout = result.stdout ?? "";
  expect(stdout).toContain("sbx-cli-test-001");
  expect(stdout).not.toContain("envd-access-token-secret");
});

it("test_download_shows_a_header_and_hides_bytes", async () => {
  const tty = ttyStderr();
  const sandbox = _sandbox();
  sandbox.files.readBytes = vi.fn().mockResolvedValue(Buffer.from(_SECRET));
  const dest = path.join(tmp, "out.bin");
  vi.spyOn(Sandbox, "connect").mockResolvedValue(sandbox as unknown as Sandbox);

  const result = await runner().invoke(cli, ["download", "sb-1", "/app/secret.bin", dest]);

  expect(result.exit_code, result.output).toBe(0);
  expect(fs.readFileSync(dest).equals(Buffer.from(_SECRET))).toBe(true);
  const shown = tty.getvalue();
  expect(shown).toContain("Downloading /app/secret.bin... 0s");
  expect(shown).not.toContain(_SECRET);
  expect(_combined(result)).not.toContain(_SECRET);
});

it("test_kill_all_lists_ids_under_the_header", async () => {
  const tty = ttyStderr();
  const infos = ["sbx-a", "sbx-b"].map((id) =>
    SandboxInfo.modelValidate({ sandboxID: id, templateID: "base", status: "running", region: "cn-hangzhou", timeout: 300 }),
  );
  vi.spyOn(Sandbox, "list").mockResolvedValue(infos);
  vi.spyOn(Sandbox, "connect").mockResolvedValue(_sandbox() as unknown as Sandbox);
  vi.spyOn(Sandbox, "killById").mockResolvedValue(undefined);

  const result = await runner().invoke(cli, ["kill", "--all", "--yes"]);

  expect(result.exit_code, result.output).toBe(0);
  const shown = tty.getvalue();
  expect(shown).toContain("Killing 2 sandbox(es)");
  expect(shown).toContain("1/2 alicloud-express:sbx-a");
  expect(shown).toContain("2/2 alicloud-express:sbx-b");
  expect(result.output).toContain("Killed 2/2");
});

it("test_template_search_shows_a_fetch_header", async () => {
  const tty = ttyStderr();
  const index = { notice: "", filter: () => [] };
  spyAny(templateIndexMod, "fetchIndex").mockResolvedValue(index as never);

  const result = await runner().invoke(cli, ["template", "search", "python"]);

  expect(result.exit_code, result.output).toBe(0);
  expect(tty.getvalue()).toContain("Fetching the template index... 0s");
  expect(result.output).toContain("No templates matching");
});

it("test_template_create_shows_a_header_and_hides_the_password", async () => {
  const tty = ttyStderr();
  const password = "registry-password-placeholder";
  patchLoadConfig(fakeConfig({ access_key_secret: "platform-placeholder" }));
  const create = spyAny(fcTemplate, "createOfficialTemplate").mockResolvedValue({ templateID: "tpl-from-image", statusCode: 200 });

  const result = await runner().invoke(cli, [
    "template", "from-image", "registry.example/ns/app:latest", "--name", "from-image", "--registry-username", "registry-user", "--registry-password", password,
  ]);

  expect(result.exit_code, result.output).toBe(0);
  const shown = tty.getvalue();
  expect(shown).toContain("Creating template from-image... 0s");
  expect(shown).not.toContain(password);
  expect(_combined(result)).not.toContain(password);
  expect((create.mock.calls[0]![0] as Record<string, unknown>)["registry_password"]).toBe(password);
});

it("test_install_milestones_show_under_the_header", async () => {
  iso.monkeypatch.setenv("ABX_SERVER_TOKEN", "test-application-token");
  const tty = ttyStderr();
  const backend = {
    displayName: "Qwen Code",
    notInstalledError: Error,
    findBinary: async () => null,
    quickSetupLines: async () => ["Install the official standalone build."],
    install: async (opts: { onProgress?: (m: string) => void } = {}) => {
      opts.onProgress?.("Downloading qwen-code from github mirror...");
      opts.onProgress?.("Verifying SHA256 checksum...");
      opts.onProgress?.("Extracting archive...");
      return path.join(tmp, "qwen-abx-test");
    },
  };
  const saved = codingAgentSeams.resolveBackend;
  codingAgentSeams.resolveBackend = (() => backend) as never;
  vi.spyOn(codingAgent, "resolveCodingAgentCredentials").mockRejectedValue(new CliError("stop-after-install"));
  try {
    const result = await runner().invoke(cli, ["create", "--prompt", "a small http server", "--yes"]);

    expect(result.exit_code).not.toBe(0);
    expect(result.output).toContain("stop-after-install");
    const shown = tty.getvalue();
    expect(shown).toContain("Installing Qwen Code... 0s");
    expect(shown).toContain("Downloading qwen-code from github mirror...");
    expect(shown).toContain("Verifying SHA256 checksum...");
    expect(shown).toContain("Extracting archive...");
    expect(shown).not.toContain("sk-");
  } finally {
    codingAgentSeams.resolveBackend = saved;
  }
});

useMockCloudConfiguration();
