/** Tests for DockerBuilder, ACRConfig, and ACR auth helpers. */

import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACRConfig,
  BuildResult,
  DockerBuilder,
  SERVER_SDK_SOURCE_ENV,
  _getAcrAuthToken,
  _seams,
  dockerBuildxAvailable,
  getAcrAuthToken,
  rewriteDockerfileForServerInstall,
  serverSdkVersion,
} from "../../src/api/docker_builder.js";
import { ABX_SERVER_INSTALL } from "../../src/utils/server_sdk_pin.js";
import { _provenanceNotice } from "../../src/cli/commands/template.js";
import { DockerBuildError } from "../../src/models/errors.js";
import {
  ConnectError,
  MockTransport,
  Response as HttpxResponse,
  _setDefaultTransportFactory,
} from "../../src/transport/_httpx.js";
import { captureLogs } from "./conftest.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const h = vi.hoisted(() => ({
  createOfficialTemplate: vi.fn(),
  spawn: vi.fn(),
  realSpawn: null as any,
}));

vi.mock("../../src/api/fc_template.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/fc_template.js")>()),
  createOfficialTemplate: h.createOfficialTemplate,
}));

vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  h.realSpawn = real.spawn;
  h.spawn.mockImplementation((...a: any[]) => (real.spawn as any)(...a));
  return { ...real, spawn: h.spawn };
});

function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), "abx-dockerbuilder-"));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  _setDefaultTransportFactory(null);
  vi.unstubAllEnvs();
  h.createOfficialTemplate.mockReset();
  h.spawn.mockReset();
  h.spawn.mockImplementation((...a: any[]) => h.realSpawn(...a));
});

// ---------------------------------------------------------------------------
// Backward-compatible alias tests (task #66 / review item 1)
// ---------------------------------------------------------------------------

describe("TestACRAuthTokenAlias", () => {
  // Verify that ``_get_acr_auth_token`` is a backward-compatible alias.
  it("test_alias_is_same_function", () => {
    // Old private name must point to exactly the same function object.
    expect(_getAcrAuthToken).toBe(getAcrAuthToken);
  });

  it("test_importable_via_old_name", async () => {
    // Scripts can ``from ... import _get_acr_auth_token``.
    const mod = await import("../../src/api/docker_builder.js");
    expect(mod._getAcrAuthToken).toBe(getAcrAuthToken);
  });

  it("test_importable_via_new_name", async () => {
    // The canonical public name is importable.
    const mod = await import("../../src/api/docker_builder.js");
    expect(typeof mod.getAcrAuthToken).toBe("function");
  });

  it("test_old_name_delegates_to_same_impl", async () => {
    // Calling via old name must reach the same implementation.
    const mock_personal = vi.spyOn(_seams, "getAcrAuthTokenPersonal").mockResolvedValue({ tempUserName: "u", authorizationToken: "t" } as any);
    const result = await _getAcrAuthToken("ak", "sk", "cn-hangzhou");
    expect(result["tempUserName"]).toBe("u");
    expect(mock_personal).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// ACRConfig tests
// ---------------------------------------------------------------------------

describe("TestACRConfig", () => {
  // Basic ACRConfig dataclass tests.
  it("test_full_image_ref", () => {
    const acr = new ACRConfig({ registry: "registry.cn-hangzhou.aliyuncs.com", namespace: "ns", repo: "repo" });
    expect(acr.full_image_ref).toBe("registry.cn-hangzhou.aliyuncs.com/ns/repo");
  });

  it("test_tagged_ref", () => {
    const acr = new ACRConfig({ registry: "reg", namespace: "ns", repo: "r" });
    expect(acr.tagged_ref("v1")).toBe("reg/ns/r:v1");
  });

  it("test_registry_type_auto_detect_acr", () => {
    const acr = new ACRConfig({ registry: "reg", namespace: "ns", repo: "r" });
    const headers = acr.to_platform_headers();
    expect(headers["X-E2B-Template-Source-Registry-Type"]).toBe("acr");
  });

  it("test_registry_type_auto_detect_acree", () => {
    const acr = new ACRConfig({ registry: "reg", namespace: "ns", repo: "r", acree_instance_id: "cri-xxx" });
    const headers = acr.to_platform_headers();
    expect(headers["X-E2B-Template-Source-Registry-Type"]).toBe("acree");
    expect(headers["X-E2B-Template-Source-ACREE-Instance-ID"]).toBe("cri-xxx");
  });
});

// ---------------------------------------------------------------------------
// BuildResult tests
// ---------------------------------------------------------------------------

describe("TestBuildResult", () => {
  // BuildResult dataclass tests.
  it("test_success_statuses", () => {
    for (const st of ["ready", "building", "pushed"]) {
      expect(new BuildResult({ build_status: st }).success).toBeTruthy();
    }
  });

  it("test_failure_status", () => {
    expect(new BuildResult({ build_status: "error" }).success).toBeFalsy();
    expect(new BuildResult({ build_status: "unknown" }).success).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// DockerBuilder.build_and_register_official — full mock test (task #66 / item 3)
// ---------------------------------------------------------------------------

const acr_config = () =>
  new ACRConfig({
    registry: "registry.cn-hangzhou.aliyuncs.com",
    namespace: "test-ns",
    repo: "test-repo",
    username: "ak-test",
    password: "sk-test",
  });

const acr_config_acree = () =>
  new ACRConfig({
    registry: "registry.cn-hangzhou.aliyuncs.com",
    namespace: "test-ns",
    repo: "test-repo",
    username: "ak-test",
    password: "sk-test",
    acree_instance_id: "cri-test-123",
  });

function _apply_mocks(builder: DockerBuilder): any {
  // Patch all subprocess-based methods on the builder.
  const b = builder as any;
  b.checkDocker = vi.fn(async () => true);
  b.build = vi.fn(async () => "test-repo:latest");
  b.loginAcrWithAksk = vi.fn(async () => ({ tempUserName: "tmp-user", authorizationToken: "tmp-token" }));
  b.tag = vi.fn(async () => undefined);
  b.push = vi.fn(async () => undefined);

  h.createOfficialTemplate.mockResolvedValue({
    templateID: "tpl-official-001",
    requestId: "req-001",
    code: "200",
    message: "",
    statusCode: 200,
  });
  return h.createOfficialTemplate;
}

function stubInjectNoWheels(wheels: string[] = []) {
  return vi.spyOn(DockerBuilder, "injectSdkWheel").mockResolvedValue(wheels);
}

function templateDir(): string {
  const tmp_path = mkTmp();
  writeFileSync(join(tmp_path, "Dockerfile"), "FROM ubuntu:22.04\n");
  return tmp_path;
}

describe("TestBuildAndRegisterOfficial", () => {
  // Full mock coverage of the official CreateTemplate API path. Mocks: Docker daemon, wheel injection, ACR token, tag,
  // push, and ``create_official_template``. No real Docker, network, or cloud API calls are made.
  it("test_basic_official_flow", async () => {
    // Basic end-to-end official flow: build → push → CreateTemplate.
    const builder: any = new DockerBuilder();
    const tmp_path = templateDir();
    stubInjectNoWheels();
    const mock_create = _apply_mocks(builder);

    const result = await builder.buildAndRegisterOfficial(tmp_path, acr_config(), {
      name: "test-tpl",
      tag: "v1",
      cpu_count: 4,
      memory_mb: 4096,
      disk_size: 10240,
      internet_access: true,
      generation: 2,
      envd_inject: true,
      team_id: "team-abc",
      region: "cn-shanghai",
      acr_access_key_id: "acr-ak",
      acr_access_key_secret: "acr-sk",
      api_access_key_id: "api-ak",
      api_access_key_secret: "api-sk",
    });

    // Result assertions
    expect(result.template_id).toBe("tpl-official-001");
    expect(["ready", "submitted"]).toContain(result.build_status);
    expect(result.acr_ref).toBe("registry.cn-hangzhou.aliyuncs.com/test-ns/test-repo:v1");

    // Docker build was called
    expect(builder.build).toHaveBeenCalledTimes(1);

    // ACR login used ACR-specific credentials (not API creds)
    expect(builder.loginAcrWithAksk).toHaveBeenCalledTimes(1);
    const login_args = builder.loginAcrWithAksk.mock.calls[0];
    expect(login_args[1]).toBe("acr-ak");
    expect(login_args[2]).toBe("acr-sk");

    // create_official_template called with platform API creds
    expect(mock_create).toHaveBeenCalledTimes(1);
    const call_kwargs = mock_create.mock.calls[0][0];
    expect(call_kwargs["name"]).toBe("test-tpl");
    expect(call_kwargs["access_key_id"]).toBe("api-ak");
    expect(call_kwargs["access_key_secret"]).toBe("api-sk");
    expect(call_kwargs["cpu"]).toBe(4);
    expect(call_kwargs["memory_size"]).toBe(4096);
    expect(call_kwargs["disk_size"]).toBe(10240);
    expect(call_kwargs["internet_access"]).toBe(true);
    expect(call_kwargs["generation"]).toBe(2);
    expect(call_kwargs["envd_inject"]).toBe(true);
    expect(call_kwargs["team_id"]).toBe("team-abc");
    expect(call_kwargs["region"]).toBe("cn-shanghai");
    expect(call_kwargs["registry_type"]).toBe("acr"); // no ACREE → acr
    expect(call_kwargs["registry_username"]).toBe("tmp-user");
    expect(call_kwargs["registry_password"]).toBe("tmp-token");
  });

  it("test_acree_instance_sets_registry_type", async () => {
    // When ACREE instance ID is present, registry_type must be 'acree'.
    const builder: any = new DockerBuilder();
    const tmp_path = templateDir();
    stubInjectNoWheels();
    const mock_create = _apply_mocks(builder);

    const result = await builder.buildAndRegisterOfficial(tmp_path, acr_config_acree(), { name: "acree-tpl" });

    expect(result.template_id).toBe("tpl-official-001");
    const call_kwargs = mock_create.mock.calls[0][0];
    expect(call_kwargs["registry_type"]).toBe("acree");
    expect(call_kwargs["acr_instance_id"]).toBe("cri-test-123");
  });

  it("test_image_ref_format", async () => {
    // Image ref forwarded to create_official_template matches ACR tagged ref.
    const builder: any = new DockerBuilder();
    const tmp_path = templateDir();
    stubInjectNoWheels();
    const mock_create = _apply_mocks(builder);

    await builder.buildAndRegisterOfficial(tmp_path, acr_config(), { tag: "build-42" });

    const call_kwargs = mock_create.mock.calls[0][0];
    const expected_image = "registry.cn-hangzhou.aliyuncs.com/test-ns/test-repo:build-42";
    expect(call_kwargs["image"]).toBe(expected_image);
  });

  it("test_defaults", async () => {
    // Default values: cpu=2, memory=2048, disk=None, internet=None, generation=1.
    const builder: any = new DockerBuilder();
    const tmp_path = templateDir();
    stubInjectNoWheels();
    const mock_create = _apply_mocks(builder);

    await builder.buildAndRegisterOfficial(tmp_path, acr_config());

    const call_kwargs = mock_create.mock.calls[0][0];
    expect(call_kwargs["cpu"]).toBe(2);
    expect(call_kwargs["memory_size"]).toBe(2048);
    expect(call_kwargs["disk_size"]).toBeNull();
    expect(call_kwargs["internet_access"]).toBeNull();
    expect(call_kwargs["generation"]).toBe(1);
    expect(call_kwargs["envd_inject"]).toBe(false); // default for template deploy
  });

  it("test_wheel_injection_called", async () => {
    // inject_sdk_wheel is called and returned wheels are cleaned up.
    const builder: any = new DockerBuilder();
    const tmp_path = templateDir();

    const fake_wheel = join(tmp_path, "agent_sandbox-0.0.0-py3-none-any.whl");
    writeFileSync(fake_wheel, "fake wheel");

    const mock_inject = stubInjectNoWheels([fake_wheel]);
    _apply_mocks(builder);

    await builder.buildAndRegisterOfficial(tmp_path, acr_config());

    expect(mock_inject).toHaveBeenCalledTimes(1);
  });

  it("test_progress_callback", async () => {
    // Progress callback receives step messages.
    const builder: any = new DockerBuilder();
    const tmp_path = templateDir();
    const progress: string[] = [];
    stubInjectNoWheels();
    _apply_mocks(builder);

    await builder.buildAndRegisterOfficial(tmp_path, acr_config(), { on_progress: (m: string) => progress.push(m) });

    expect(progress.length).toBeGreaterThanOrEqual(4);
    expect(progress.some((m) => m.includes("Docker"))).toBe(true);
    expect(progress.some((m) => m.includes("ACR") || m.includes("Pushing"))).toBe(true);
    expect(progress.some((m) => m.toLowerCase().includes("official") || m.includes("CreateTemplate") || m.includes("Creating"))).toBe(true);
  });

  it("test_no_docker_raises", async () => {
    // If Docker is not available, DockerBuildError is raised.
    const builder: any = new DockerBuilder();
    const tmp_path = templateDir();
    stubInjectNoWheels();
    builder.checkDocker = vi.fn(async () => false);

    const p = builder.buildAndRegisterOfficial(tmp_path, acr_config());
    await expect(p).rejects.toBeInstanceOf(DockerBuildError);
    await expect(p).rejects.toThrow(/not running/);
  });

  // ------------------------------------------------------------------ //
  // Credential separation tests (task #68)
  // ------------------------------------------------------------------ //

  it("test_credential_separation", async () => {
    // ACR creds and platform API creds must be routed independently.
    const builder: any = new DockerBuilder();
    const tmp_path = templateDir();

    const acr = new ACRConfig({
      registry: "registry.cn-hangzhou.aliyuncs.com",
      namespace: "ns",
      repo: "repo",
      username: "acr-cfg-user",
      password: "test-placeholder-token",
    });
    stubInjectNoWheels();
    const mock_create = _apply_mocks(builder);

    await builder.buildAndRegisterOfficial(tmp_path, acr, {
      acr_access_key_id: "explicit-acr-ak",
      acr_access_key_secret: "test-placeholder-token",
      api_access_key_id: "platform-api-ak",
      api_access_key_secret: "test-placeholder-token",
    });

    // ACR login must use the explicit ACR credentials
    const login_args = builder.loginAcrWithAksk.mock.calls.at(-1);
    expect(login_args[1]).toBe("explicit-acr-ak");
    expect(login_args[2]).toBe("test-placeholder-token");

    // CreateTemplate must use the platform API credentials
    const api_kwargs = mock_create.mock.calls.at(-1)[0];
    expect(api_kwargs["access_key_id"]).toBe("platform-api-ak");
    expect(api_kwargs["access_key_secret"]).toBe("test-placeholder-token");
  });

  it("test_acr_config_fallback_for_acr_creds", async () => {
    // When acr_access_key_id is not set, ACRConfig.username is used for ACR login.
    const builder: any = new DockerBuilder();
    const tmp_path = templateDir();

    const acr = new ACRConfig({
      registry: "registry.cn-hangzhou.aliyuncs.com",
      namespace: "ns",
      repo: "repo",
      username: "cfg-user",
      password: "test-placeholder-token",
    });
    stubInjectNoWheels();
    const mock_create = _apply_mocks(builder);

    await builder.buildAndRegisterOfficial(tmp_path, acr, {
      // No acr_access_key_id → should fall back to acr.username
      api_access_key_id: "platform-ak",
      api_access_key_secret: "test-placeholder-token",
    });

    const login_args = builder.loginAcrWithAksk.mock.calls.at(-1);
    expect(login_args[1]).toBe("cfg-user");
    expect(login_args[2]).toBe("test-placeholder-token");

    const api_kwargs = mock_create.mock.calls.at(-1)[0];
    expect(api_kwargs["access_key_id"]).toBe("platform-ak");
    expect(api_kwargs["access_key_secret"]).toBe("test-placeholder-token");
  });

  it("test_legacy_fallback_compat", async () => {
    // Legacy access_key_id/secret params still work as fallback for both.
    const builder: any = new DockerBuilder();
    const tmp_path = templateDir();

    const acr = new ACRConfig({
      registry: "registry.cn-hangzhou.aliyuncs.com",
      namespace: "ns",
      repo: "repo",
      // No username/password in ACRConfig
    });
    stubInjectNoWheels();
    const mock_create = _apply_mocks(builder);

    await builder.buildAndRegisterOfficial(tmp_path, acr, {
      // Old-style: only legacy params, no acr_*/api_* params
      access_key_id: "legacy-ak",
      access_key_secret: "test-placeholder-token",
    });

    // Both should fall back to legacy params
    const login_args = builder.loginAcrWithAksk.mock.calls.at(-1);
    expect(login_args[1]).toBe("legacy-ak");
    expect(login_args[2]).toBe("test-placeholder-token");

    const api_kwargs = mock_create.mock.calls.at(-1)[0];
    expect(api_kwargs["access_key_id"]).toBe("legacy-ak");
    expect(api_kwargs["access_key_secret"]).toBe("test-placeholder-token");
  });
});

// ---------------------------------------------------------------------------
// SDK wheel injection: explicit source tree vs. released-wheel download
//
// The Python client auto-detects a source checkout relative to its own file (`parents[4] / "server-sdk"`) and checks
// `sys.frozen`; the Node CLI has no such location, so a source tree is only used when given explicitly (option or
// ABX_SERVER_SDK_SOURCE) and every other case downloads the released wheel (see parity/KNOWN-GAPS.md).
// ---------------------------------------------------------------------------

const WHEEL = Buffer.from("PK-fake-wheel-bytes");

type Handler = (url: string) => Response | Promise<Response>;

function stubFetch(handler: Handler): void {
  _setDefaultTransportFactory(
    () =>
      new MockTransport(async (request) => {
        const r = await handler(request.url.toString());
        return new HttpxResponse(r.status, { content: Buffer.from(await r.arrayBuffer()), headers: [...r.headers] });
      }),
  );
}

function pypiHandler(opts: { digest?: string | null; wheels?: boolean } = {}): Handler {
  const { digest = null, wheels = true } = opts;
  const sha = digest || createHash("sha256").update(WHEEL).digest("hex");
  const filename = "agent_sandbox-0.1.0-py3-none-any.whl";

  return (url: string) => {
    if (new globalThis.URL(url).pathname.endsWith("/json")) {
      const urls = wheels
        ? [
            { packagetype: "sdist", filename: "agent_sandbox-0.1.0.tar.gz", url: "x" },
            {
              packagetype: "bdist_wheel",
              filename,
              url: "https://files.example/" + filename,
              digests: { sha256: sha },
            },
          ]
        : [];
      return new Response(JSON.stringify({ urls }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(WHEEL, { status: 200 });
  };
}

function fakeChild(opts: { stdout?: string[]; code?: number; onSpawn?: () => void } = {}): any {
  const { stdout = [], code = 0, onSpawn } = opts;
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
  child.kill = vi.fn();
  setImmediate(() => {
    onSpawn?.();
    for (const line of stdout) child.stdout.emit("data", Buffer.from(line));
    child.emit("close", code);
  });
  return child;
}

describe("TestInjectSdkWheel", () => {
  // ``inject_sdk_wheel`` must yield a wheel wherever abx is installed.
  beforeEach(() => {
    vi.stubEnv(SERVER_SDK_SOURCE_ENV, "");
    delete process.env[SERVER_SDK_SOURCE_ENV];
  });

  it("test_installed_sdk_downloads_the_matching_release", async () => {
    // Outside a source checkout the released wheel is injected into the context.
    const tmp_path = mkTmp();
    const seen: string[] = [];
    const inner = pypiHandler();
    stubFetch((url) => {
      seen.push(url);
      return inner(url);
    });

    const wheels = await DockerBuilder.injectSdkWheel(tmp_path);

    expect(wheels.map((w) => w.split("/").pop())).toEqual(["agent_sandbox-0.1.0-py3-none-any.whl"]);
    expect(readFileSync(wheels[0]!)).toEqual(WHEEL);
    expect(seen[0]).toBe(`https://pypi.org/pypi/agent-sandbox-server/${serverSdkVersion()}/json`);
  });

  it("test_frozen_binary_never_shells_out_to_pip", async () => {
    // A standalone binary has no pip: without an explicit source tree it must use the release download path.
    const tmp_path = mkTmp();
    stubFetch(pypiHandler());

    const wheels = await DockerBuilder.injectSdkWheel(tmp_path);

    expect(h.spawn).not.toHaveBeenCalled();
    expect(wheels.length).toBe(1);
  });

  it("test_digest_mismatch_injects_nothing", async () => {
    const tmp_path = mkTmp();
    stubFetch(pypiHandler({ digest: "0".repeat(64) }));
    expect(await DockerBuilder.injectSdkWheel(tmp_path)).toEqual([]);
    expect(readdirSync(tmp_path)).toEqual([]);
  });

  it("test_unpublished_version_falls_back_quietly", async () => {
    // A dev build (404 on PyPI) injects nothing; the Dockerfile installs from PyPI.
    const tmp_path = mkTmp();
    stubFetch(() => new Response(null, { status: 404 }));
    expect(await DockerBuilder.injectSdkWheel(tmp_path)).toEqual([]);
  });

  it("test_no_published_wheel_injects_nothing", async () => {
    const tmp_path = mkTmp();
    stubFetch(pypiHandler({ wheels: false }));
    expect(await DockerBuilder.injectSdkWheel(tmp_path)).toEqual([]);
  });

  it("test_network_error_injects_nothing", async () => {
    const tmp_path = mkTmp();
    stubFetch(() => {
      throw new ConnectError("offline");
    });
    expect(await DockerBuilder.injectSdkWheel(tmp_path)).toEqual([]);
  });

  it("test_source_checkout_still_builds_from_the_working_tree", async () => {
    // With an explicit source tree unreleased code must reach the image: no PyPI download.
    const project = mkTmp();
    writeFileSync(join(project, "pyproject.toml"), '[project]\nname = "agent-sandbox-server"\n');
    const ctx = join(mkTmp(), "ctx");
    mkdirSync(ctx);
    const download = vi.spyOn(DockerBuilder, "_downloadReleaseWheel");
    h.spawn.mockImplementation((_cmd: string, args: string[]) => {
      const out_dir = args[args.indexOf("-w") + 1]!;
      return fakeChild({ onSpawn: () => writeFileSync(join(out_dir, "agent_sandbox-9.9.9-py3-none-any.whl"), "local") });
    });

    const wheels = await DockerBuilder.injectSdkWheel(ctx, project);

    expect(download).not.toHaveBeenCalled();
    expect(wheels.map((w) => w.split("/").pop())).toEqual(["agent_sandbox-9.9.9-py3-none-any.whl"]);
  });

  it("test_source_tree_detection_requires_the_sdk_project", () => {
    // A venv living inside some *other* project must not be mistaken for the SDK.
    const tmp_path = mkTmp();
    writeFileSync(join(tmp_path, "pyproject.toml"), '[project]\nname = "my-app"\n');
    expect(DockerBuilder._isSdkSourceTree(tmp_path)).toBe(false);
    writeFileSync(join(tmp_path, "pyproject.toml"), '[project]\nname = "agent-sandbox-server"\n');
    expect(DockerBuilder._isSdkSourceTree(tmp_path)).toBe(true);
    expect(DockerBuilder._isSdkSourceTree(join(tmp_path, "missing"))).toBe(false);
  });

  it("test_this_checkout_is_detected_as_the_sdk_source_tree", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const root = resolve(here, "..", "..", "..", "python-sdk", "server-sdk");
    if (!existsSync(root)) {
      expect(DockerBuilder._isSdkSourceTree(root)).toBe(false);
      return;
    }
    expect(DockerBuilder._isSdkSourceTree(root)).toBe(true);
  });
});

describe("rewriteDockerfileForServerInstall", () => {
  it("drops an empty wheel glob and pins the archive install", () => {
    const text = "FROM scratch\nCOPY *.whl /tmp/\nRUN if ls /tmp/*.whl; then pip install /tmp/*.whl; else pip install --no-cache-dir agent-sandbox-server; fi\n";
    const out = rewriteDockerfileForServerInstall(text, []);
    expect(out).not.toContain("COPY *.whl");
    expect(out).toContain('pip install --no-cache-dir "agent-sandbox-server @ https://github.com/Alibaba-Agent-Sandbox/python-sdk/archive/');
    expect(out).not.toMatch(/pip install --no-cache-dir agent-sandbox-server(?! @)/);
  });

  it("keeps a scaffold install line when no wheel is present", () => {
    const text = `FROM scratch\n${ABX_SERVER_INSTALL}\n`;
    expect(rewriteDockerfileForServerInstall(text, [])).toBe(text);
  });

  it("replaces the archive install with the injected wheel", () => {
    const text = `FROM scratch\n${ABX_SERVER_INSTALL}\n`;
    const out = rewriteDockerfileForServerInstall(text, ["agent_sandbox_server-0.3.0-py3-none-any.whl"]);
    expect(out).toContain("COPY agent_sandbox_server-0.3.0-py3-none-any.whl /tmp/agent_sandbox_server-0.3.0-py3-none-any.whl");
    expect(out).not.toContain("github.com");
  });
});

describe("TestBuildProgress", () => {
  it("test_buildkit_build_streams_plain_progress", async () => {
    const tmp_path = mkTmp();
    vi.stubEnv("DOCKER_BUILDKIT", "1");
    h.spawn.mockImplementation(() => fakeChild({ stdout: ["#2 [1/2] FROM python:3.12\n"], code: 0 }));
    const seen: string[] = [];
    await new DockerBuilder().build(tmp_path, "app:latest", { on_output: (l) => seen.push(l) });
    const call = h.spawn.mock.calls.find((c) => Array.isArray(c[1]) && c[1].includes("build") && c[1].includes("-t"))!;
    const command: string[] = [call[0], ...call[1]];
    expect(command).toContain("--provenance=false");
    expect(command).toContain("--progress=plain");
    expect(seen).toEqual(["#2 [1/2] FROM python:3.12"]);
  });

  it("test_legacy_builder_omits_provenance_when_buildx_is_missing", async () => {
    const tmp_path = mkTmp();
    vi.stubEnv("DOCKER_BUILDKIT", "1");
    h.spawn.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === "buildx") return fakeChild({ code: 1, stdout: ["docker: 'buildx' is not a docker command\n"] });
      return fakeChild({ stdout: ["ok\n"], code: 0 });
    });
    await new DockerBuilder().build(tmp_path, "app:latest");
    const call = h.spawn.mock.calls.find((c) => Array.isArray(c[1]) && c[1].includes("build") && c[1].includes("-t"))!;
    const command: string[] = [call[0], ...call[1]];
    expect(command).not.toContain("--provenance=false");
    expect(command).not.toContain("--progress=plain");
    expect(await dockerBuildxAvailable()).toBe(false);
    const info = vi.fn();
    await _provenanceNotice({ info });
    expect(info).not.toHaveBeenCalled();
  });

  it("test_build_rewrites_an_empty_wheel_glob_for_the_legacy_builder", async () => {
    const tmp_path = mkTmp();
    writeFileSync(
      join(tmp_path, "Dockerfile"),
      "FROM scratch\nCOPY *.whl /tmp/\nRUN pip install --no-cache-dir agent-sandbox-server\n",
    );
    let seen = "";
    h.spawn.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === "buildx") return fakeChild({ code: 1 });
      if (args.includes("-f")) seen = readFileSync(args[args.indexOf("-f") + 1]!, "utf8");
      return fakeChild({ code: 0 });
    });
    await new DockerBuilder().build(tmp_path, "app:latest");
    expect(seen).not.toContain("COPY *.whl");
    expect(seen).toContain("subdirectory=server-sdk");
    expect(existsSync(join(tmp_path, "Dockerfile.abx-build"))).toBe(false);
    expect(readFileSync(join(tmp_path, "Dockerfile"), "utf8")).toContain("COPY *.whl");
  });

  it("test_build_arg_values_are_redacted_in_the_info_log", async () => {
    const tmp_path = mkTmp();
    vi.stubEnv("DOCKER_BUILDKIT", "0");
    h.spawn.mockImplementation(() => fakeChild({ stdout: [], code: 0 }));
    const cap = captureLogs("agent_sandbox", 20);
    try {
      await new DockerBuilder().build(tmp_path, "app:latest", { build_args: { ACR_PASSWORD: "s3cret-value" } });
    } finally {
      cap.restore();
    }
    const call = h.spawn.mock.calls[0]!;
    const command: string[] = [call[0], ...call[1]];
    expect(command).toContain("ACR_PASSWORD=s3cret-value");
    const text = cap.messages().join("\n");
    expect(text).not.toContain("s3cret-value");
    expect(text).toContain("ACR_PASSWORD=***");
  });
});
