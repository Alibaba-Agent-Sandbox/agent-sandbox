/** Tests for the official FCSandbox CreateTemplate API adapter. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _SDK_INSTALL_HINT,
  _deriveTargetImage,
  _requireSdk,
  _resolveTargetImage,
  _sdkLoader,
  _seams,
  buildCreateTemplateRequestMap,
  createOfficialTemplate,
  getTemplate,
  listOfficialTemplates,
  waitForTemplateReady,
  type FcSdk,
} from "../../src/providers/alicloud_express/fc_template.js";
import { SandboxError, TemplateBuildError } from "../../src/models/errors.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const realLoad = _sdkLoader.load;
// Real generated classes are a fixture, not part of a mocked cloud-call deadline.
const realSdk = realLoad();

/**
 * Equivalent of `patch("alibabacloud_fcsandbox20260509.client.Client")`: keeps the real model classes but swaps the
 * `Client` class for one returning `mockClient`.
 */
function patchClient(mockClient: any): { clientCls: ReturnType<typeof vi.fn> } {
  const real = realSdk;
  const clientCls = vi.fn(function () {
    return mockClient;
  });
  const sdk: FcSdk = { models: real.models, Config: real.Config, Client: clientCls as any };
  _sdkLoader.load = () => sdk;
  return { clientCls };
}

afterEach(() => {
  _sdkLoader.load = realLoad;
  vi.restoreAllMocks();
});

describe("TestDeriveTargetImage", () => {
  it("test_simple_tag", () => {
    const result = _deriveTargetImage("registry.cn-hangzhou.aliyuncs.com/ns/repo:v1");
    expect(result.startsWith("registry.cn-hangzhou.aliyuncs.com/ns/repo:v1-fcsandbox-")).toBe(true);
    expect(result).not.toBe("registry.cn-hangzhou.aliyuncs.com/ns/repo:v1");
  });

  it("test_latest_tag", () => {
    const result = _deriveTargetImage("registry.cn-hangzhou.aliyuncs.com/ns/repo:latest");
    expect(result).toContain(":latest-fcsandbox-");
  });

  it("test_no_tag", () => {
    const result = _deriveTargetImage("registry.cn-hangzhou.aliyuncs.com/ns/repo");
    expect(result.startsWith("registry.cn-hangzhou.aliyuncs.com/ns/repo:fcsandbox-")).toBe(true);
  });

  it("test_port_in_registry", () => {
    // host:port/path:tag — colon before '/' is port, not tag.
    const result = _deriveTargetImage("registry.example.com:5000/ns/repo:v1");
    expect(result.startsWith("registry.example.com:5000/ns/repo:v1-fcsandbox-")).toBe(true);
  });

  it("test_port_only_no_tag", () => {
    const result = _deriveTargetImage("registry.example.com:5000/ns/repo");
    expect(result.startsWith("registry.example.com:5000/ns/repo:fcsandbox-")).toBe(true);
  });

  it("test_suffix_is_unique", () => {
    const r1 = _deriveTargetImage("img:v1");
    const r2 = _deriveTargetImage("img:v1");
    expect(r1).not.toBe(r2);
  });
});

describe("TestResolveTargetImage", () => {
  it("test_none_target_derives", () => {
    const result = _resolveTargetImage("img:v1", null);
    expect(result).not.toBe("img:v1");
    expect(result).toContain("-fcsandbox-");
  });

  it("test_same_as_source_derives", () => {
    const result = _resolveTargetImage("img:v1", "img:v1");
    expect(result).not.toBe("img:v1");
    expect(result).toContain("-fcsandbox-");
  });

  it("test_different_target_returned_as_is", () => {
    expect(_resolveTargetImage("img:v1", "other:v2")).toBe("other:v2");
  });
});

describe("TestRequireSDK", () => {
  it("test_missing_sdk_raises_friendly_error", () => {
    _sdkLoader.load = () => {
      throw new Error("Cannot find module '@alicloud/fcsandbox20260509'");
    };
    let caught: unknown;
    try {
      _requireSdk();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SandboxError);
    expect(String((caught as Error).message)).toMatch(/not installed/);
    expect(_SDK_INSTALL_HINT).toContain("not installed");
  });
});

describe("TestBuildCreateTemplateRequestMap", () => {
  it("test_basic_request_map", () => {
    const result = buildCreateTemplateRequestMap({
      name: "test-template",
      image: "registry.cn-hangzhou.aliyuncs.com/ns/repo:latest",
      team_id: "team-123",
      cpu: 2,
      memory_size: 2048,
      generation: 1,
    });

    const body = result["body"] ?? {};
    expect(body["name"]).toBe("test-template");
    expect(body["teamID"]).toBe("team-123");

    const runtime = body["runtimeConfig"] ?? {};
    expect(runtime["cpu"]).toBe(2);
    expect(runtime["memorySize"]).toBe(2048);

    const sandbox = runtime["sandboxConfig"] ?? {};
    expect(sandbox["image"]).toBe("registry.cn-hangzhou.aliyuncs.com/ns/repo:latest");
    expect(sandbox["generation"]).toBe(1);
  });

  it("test_envd_inject_enabled", () => {
    const result = buildCreateTemplateRequestMap({
      name: "test-envd",
      image: "img:v1",
      team_id: "t",
      envd_inject: true,
    });

    const body = result["body"] ?? {};
    const build_config = body["buildConfig"] ?? {};
    expect(build_config["envdInject"]["enabled"]).toBe(true);
    const copy_image = build_config["copy"]["image"];
    const sandbox_image = body["runtimeConfig"]["sandboxConfig"]["image"];
    expect(copy_image).not.toBe(sandbox_image);
    expect(copy_image).toContain("-fcsandbox-");
  });

  it("test_envd_inject_disabled", () => {
    const result = buildCreateTemplateRequestMap({
      name: "test-no-envd",
      image: "img",
      team_id: "t",
      envd_inject: false,
    });

    const body = result["body"] ?? {};
    const build_config = body["buildConfig"];
    expect(build_config === null || build_config === undefined || !Object.keys(build_config).length).toBe(true);
  });

  it("test_registry_type_auto_detected_acree", () => {
    const result = buildCreateTemplateRequestMap({
      name: "test-acree",
      image: "img",
      team_id: "t",
      acr_instance_id: "cri-xxx",
    });

    const sandbox = result["body"]["runtimeConfig"]["sandboxConfig"];
    expect(sandbox["registryType"]).toBe("acree");
    expect(sandbox["acrInstanceId"]).toBe("cri-xxx");
  });

  it("test_registry_credentials", () => {
    const result = buildCreateTemplateRequestMap({
      name: "test-creds",
      image: "img",
      team_id: "t",
      registry_username: "user",
      registry_password: "pass",
    });

    const sandbox = result["body"]["runtimeConfig"]["sandboxConfig"];
    const reg_config = sandbox["registryConfig"] ?? {};
    const auth = reg_config["authConfig"] ?? {};
    expect(auth["userName"]).toBe("user");
    expect(auth["password"]).toBe("pass");
  });

  it("test_explicit_target_image_honored", () => {
    const result = buildCreateTemplateRequestMap({
      name: "test-explicit",
      image: "source:v1",
      team_id: "t",
      envd_inject: true,
      target_image: "custom-target:v1",
    });

    const body = result["body"] ?? {};
    const copy_image = body["buildConfig"]["copy"]["image"];
    expect(copy_image).toBe("custom-target:v1");
    expect(body["runtimeConfig"]["sandboxConfig"]["image"]).toBe("source:v1");
  });

  it("test_target_image_equals_source_forces_derivation", () => {
    const src = "registry.cn-hangzhou.aliyuncs.com/ns/repo:v1";
    const result = buildCreateTemplateRequestMap({
      name: "test-same",
      image: src,
      team_id: "t",
      envd_inject: true,
      target_image: src,
    });

    const body = result["body"] ?? {};
    const copy_image = body["buildConfig"]["copy"]["image"];
    const sandbox_image = body["runtimeConfig"]["sandboxConfig"]["image"];
    expect(copy_image).not.toBe(sandbox_image);
    expect(copy_image).toContain("-fcsandbox-");
  });

  it("test_start_and_ready_commands", () => {
    const result = buildCreateTemplateRequestMap({
      name: "test-cmds",
      image: "img",
      team_id: "t",
      start_command: "/start.sh",
      ready_command: "/ready.sh",
    });

    const sandbox = result["body"]["runtimeConfig"]["sandboxConfig"];
    expect(sandbox["startCommand"]).toBe("/start.sh");
    expect(sandbox["readyCommand"]).toBe("/ready.sh");
  });

  it("test_platform_steps_are_sent_and_omitted_when_empty", () => {
    const withSteps = buildCreateTemplateRequestMap({
      name: "test-steps",
      image: "python:3.12-slim",
      team_id: "t",
      steps: [{ type: "RUN", args: ["pip install cowsay"] }],
    });
    const sandbox = withSteps["body"]["runtimeConfig"]["sandboxConfig"];
    expect(sandbox["steps"]).toEqual([{ type: "RUN", args: ["pip install cowsay"] }]);

    const without = buildCreateTemplateRequestMap({
      name: "test-no-steps",
      image: "img",
      team_id: "t",
    });
    expect(without["body"]["runtimeConfig"]["sandboxConfig"]["steps"]).toBeUndefined();
  });
});

describe("TestCreateOfficialTemplate", () => {
  it("test_successful_create", async () => {
    const mock_client = {
      createTemplate: vi.fn().mockResolvedValue({
        body: { templateID: "tpl-abc123", requestId: "req-xyz", code: "200", message: "" },
        statusCode: 200,
      }),
      listTeams: vi.fn().mockResolvedValue({ body: { teams: [{ teamID: "team-auto" }] } }),
    };
    patchClient(mock_client);

    const result = await createOfficialTemplate({
      name: "test",
      image: "registry.cn-hangzhou.aliyuncs.com/ns/repo:latest",
      access_key_id: "AK",
      access_key_secret: "SK",
      region: "cn-hangzhou",
    });

    expect(result["templateID"]).toBe("tpl-abc123");
    expect(result["requestId"]).toBe("req-xyz");
    expect(result["statusCode"]).toBe(200);
    expect(mock_client.listTeams).toHaveBeenCalledTimes(1);
  });

  it("test_create_with_explicit_team_id", async () => {
    const mock_client = {
      createTemplate: vi.fn().mockResolvedValue({
        body: { templateID: "tpl-explicit", requestId: "req-002", code: "200", message: "" },
        statusCode: 200,
      }),
      listTeams: vi.fn(),
    };
    patchClient(mock_client);

    const result = await createOfficialTemplate({
      name: "test",
      image: "img",
      access_key_id: "AK",
      access_key_secret: "SK",
      team_id: "team-explicit",
    });

    expect(result["templateID"]).toBe("tpl-explicit");
    expect(mock_client.listTeams).not.toHaveBeenCalled();
  });

  it("test_envd_inject_target_image_in_create", async () => {
    const mock_client = {
      createTemplate: vi.fn().mockResolvedValue({
        body: { templateID: "tpl-envd", requestId: "req-e", code: "200", message: "" },
        statusCode: 200,
      }),
    };
    patchClient(mock_client);

    const result = await createOfficialTemplate({
      name: "test",
      image: "registry/ns/repo:v1",
      access_key_id: "AK",
      access_key_secret: "SK",
      team_id: "team-x",
      envd_inject: true,
    });

    expect(result["templateID"]).toBe("tpl-envd");
    const req = mock_client.createTemplate.mock.calls[0]![0];
    const body = req.body;
    const copy_img = body.buildConfig.copy.image;
    const sandbox_img = body.runtimeConfig.sandboxConfig.image;
    expect(copy_img).not.toBe(sandbox_img);
    expect(copy_img).toContain("-fcsandbox-");
    expect(sandbox_img).toBe("registry/ns/repo:v1");
  });

  it("test_409_update_uses_same_target_image", async () => {
    const mock_client = {
      createTemplate: vi.fn().mockRejectedValue(new Error("TemplateAlreadyExists 409")),
      listTemplates: vi.fn().mockResolvedValue({
        body: { templates: [{ name: "test", templateID: "tpl-existing" }], nextToken: null },
      }),
      updateTemplate: vi.fn().mockResolvedValue({ body: { requestId: "req-u" }, statusCode: 200 }),
    };
    patchClient(mock_client);

    const result = await createOfficialTemplate({
      name: "test",
      image: "registry/ns/repo:v1",
      access_key_id: "AK",
      access_key_secret: "SK",
      team_id: "team-x",
      envd_inject: true,
      target_image: "explicit-target:v1",
    });

    expect(result["templateID"]).toBe("tpl-existing");
    const update_req = mock_client.updateTemplate.mock.calls[0]![1];
    expect(update_req.body.buildConfig.copy.image).toBe("explicit-target:v1");
  });

  it("test_409_update_target_equals_source_forces_derivation", async () => {
    const src = "registry/ns/repo:v1";
    const create_req_holder: any[] = [];
    const mock_client = {
      createTemplate: vi.fn(async (req: any) => {
        create_req_holder.push(req);
        throw new Error("TemplateAlreadyExists 409");
      }),
      listTemplates: vi.fn().mockResolvedValue({
        body: { templates: [{ name: "test", templateID: "tpl-existing" }], nextToken: null },
      }),
      updateTemplate: vi.fn().mockResolvedValue({ body: { requestId: "req-u" }, statusCode: 200 }),
    };
    patchClient(mock_client);

    await createOfficialTemplate({
      name: "test",
      image: src,
      access_key_id: "AK",
      access_key_secret: "SK",
      team_id: "team-x",
      envd_inject: true,
      target_image: src,
    });

    const create_req = create_req_holder[0];
    const create_copy_img = create_req.body.buildConfig.copy.image;
    expect(create_copy_img).not.toBe(src);
    expect(create_copy_img).toContain("-fcsandbox-");

    const update_req = mock_client.updateTemplate.mock.calls[0]![1];
    expect(update_req.body.buildConfig.copy.image).toBe(create_copy_img);
  });

  it("test_api_failure_raises_template_build_error", async () => {
    const mock_client = {
      createTemplate: vi.fn().mockRejectedValue(new Error("API error")),
    };
    patchClient(mock_client);

    const p = createOfficialTemplate({
      name: "test",
      image: "img",
      access_key_id: "AK",
      access_key_secret: "SK",
      team_id: "team-x",
    });
    await expect(p).rejects.toBeInstanceOf(TemplateBuildError);
    await expect(p).rejects.toThrow(/API call failed/);
  });
});

describe("TestGetTemplate", () => {
  it("test_get_template_success", async () => {
    const mock_client = {
      getTemplate: vi.fn().mockResolvedValue({
        body: { toMap: () => ({ templateID: "tpl-xyz", buildStatus: "ready" }) },
        statusCode: 200,
      }),
      listTeams: vi.fn().mockResolvedValue({ body: { teams: [{ teamID: "team-x" }] } }),
    };
    patchClient(mock_client);

    const result = await getTemplate("tpl-xyz", { access_key_id: "AK", access_key_secret: "SK" });

    expect(result["templateID"]).toBe("tpl-xyz");
    expect(result["statusCode"]).toBe(200);
  });
});

describe("TestListOfficialTemplates", () => {
  it("test_list_paginated_success", async () => {
    const tpl1 = { toMap: () => ({ templateID: "t1", name: "a", status: "READY" }) };
    const tpl2 = { toMap: () => ({ templateID: "t2", name: "b", status: "BUILDING" }) };
    const page1 = { body: { templates: [tpl1], nextToken: "tok-2" } };
    const page2 = { body: { templates: [tpl2], nextToken: null } };

    const mock_client = {
      listTemplates: vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2),
    };
    patchClient(mock_client);
    vi.spyOn(_seams, "getTeamId").mockResolvedValue("team-x");

    const results = await listOfficialTemplates({ access_key_id: "AK", access_key_secret: "SK" });

    expect(results.map((r) => r["templateID"])).toEqual(["t1", "t2"]);
    expect(mock_client.listTemplates).toHaveBeenCalledTimes(2);
  });
});

describe("TestWaitForTemplateReady", () => {
  beforeEach(() => {
    vi.spyOn(_seams, "getTeamId").mockResolvedValue("team-x");
    vi.spyOn(_seams, "sleep").mockResolvedValue(undefined);
  });

  it("test_returns_only_after_ready", async () => {
    const mock_get = vi
      .spyOn(_seams, "getTemplate")
      .mockResolvedValueOnce({ status: { state: "building" } })
      .mockResolvedValueOnce({ templateID: "tpl-1", status: { state: "ready" } });

    const result = await waitForTemplateReady("tpl-1", {
      access_key_id: "AK",
      access_key_secret: "SK",
      poll_interval: 0,
    });

    expect(result["status"]["state"]).toBe("ready");
    expect(mock_get).toHaveBeenCalledTimes(2);
  });

  it("test_error_state_raises", async () => {
    vi.spyOn(_seams, "getTemplate").mockResolvedValue({
      status: { state: "error", reason: { message: "bad image" } },
    });

    const p = waitForTemplateReady("tpl-1", { access_key_id: "AK", access_key_secret: "SK" });
    await expect(p).rejects.toBeInstanceOf(TemplateBuildError);
    await expect(p).rejects.toThrow(/bad image/);
  });
});

function generationClient(generation: number | null, opts: { updateError?: string } = {}) {
  let creates = 0;
  const mock_client = {
    createTemplate: vi.fn(async () => {
      creates += 1;
      if (creates === 1) throw new Error("TemplateAlreadyExists 409");
      return { body: { templateID: "tpl-new", requestId: "req-new" }, statusCode: 200 };
    }),
    listTemplates: vi.fn().mockResolvedValue({
      body: { templates: [{ name: "test", templateID: "tpl-old" }], nextToken: null },
    }),
    getTemplate: vi.fn(async () => {
      if (generation === null) throw new Error("get failed");
      return {
        body: { toMap: () => ({ runtimeConfig: { sandboxConfig: { generation } } }) },
        statusCode: 200,
      };
    }),
    updateTemplate: vi.fn(async () => {
      if (opts.updateError) throw new Error(opts.updateError);
      return { body: { requestId: "req-u" }, statusCode: 200 };
    }),
    deleteTemplate: vi.fn().mockResolvedValue({ statusCode: 200 }),
  };
  patchClient(mock_client);
  return mock_client;
}

describe("TestGeneration1StartCommand", () => {
  it("refuses a concurrent name collision without updating or deleting the old template", async () => {
    const client = generationClient(2);
    await expect(createOfficialTemplate({ name: "test", image: "example/image:1", access_key_id: "AK", access_key_secret: "SK", team_id: "test-team", update_existing: false })).rejects.toThrow("already exists");
    expect(client.updateTemplate).not.toHaveBeenCalled();
    expect(client.deleteTemplate).not.toHaveBeenCalled();
    expect(client.listTemplates).not.toHaveBeenCalled();
  });
  const create = (force = false) =>
    createOfficialTemplate({
      name: "test",
      image: "registry/ns/repo:v1",
      access_key_id: "AK",
      access_key_secret: "SK",
      team_id: "team-x",
      generation: 2,
      start_command: "agent-sandbox-server serve --port 9000",
      ready_command: "agent-sandbox-server healthcheck --port 9000",
      force,
    });

  it("refuses to update a generation-1 template and names the delete command", async () => {
    const client = generationClient(1);
    await expect(create()).rejects.toThrow(
      /sandboxConfig.startCommand is only supported when updating a generation 2 sandbox template/,
    );
    expect(client.updateTemplate).not.toHaveBeenCalled();
    expect(client.deleteTemplate).not.toHaveBeenCalled();
  });

  it("includes the delete command on the suggestion", async () => {
    generationClient(1);
    try {
      await create();
      throw new Error("expected TemplateBuildError");
    } catch (exc) {
      expect(exc).toBeInstanceOf(TemplateBuildError);
      expect((exc as TemplateBuildError).suggestion).toContain("abx template delete tpl-old -y");
      expect((exc as TemplateBuildError).suggestion).toContain("abx template deploy . -y");
      expect((exc as TemplateBuildError).suggestion).toContain("--force");
    }
  });

  it("deletes a generation-1 template and recreates it when force is set", async () => {
    const client = generationClient(1);
    const result = await create(true);
    expect(result["templateID"]).toBe("tpl-new");
    expect(client.deleteTemplate).toHaveBeenCalledTimes(1);
    expect(client.updateTemplate).not.toHaveBeenCalled();
    expect(client.createTemplate).toHaveBeenCalledTimes(2);
  });

  it("updates a generation-2 template in place", async () => {
    const client = generationClient(2);
    const result = await create();
    expect(result["templateID"]).toBe("tpl-old");
    expect(client.updateTemplate).toHaveBeenCalledTimes(1);
    expect(client.deleteTemplate).not.toHaveBeenCalled();
  });

  it("turns the platform generation-1 update error into the delete command", async () => {
    const client = generationClient(null, {
      updateError: "sandboxConfig.startCommand is only supported when updating a generation 2 sandbox template",
    });
    try {
      await create();
      throw new Error("expected TemplateBuildError");
    } catch (exc) {
      expect(exc).toBeInstanceOf(TemplateBuildError);
      expect((exc as TemplateBuildError).message).toContain(
        "sandboxConfig.startCommand is only supported when updating a generation 2 sandbox template",
      );
      expect((exc as TemplateBuildError).suggestion).toContain("abx template delete tpl-old -y");
    }
    expect(client.updateTemplate).toHaveBeenCalled();
    expect(client.deleteTemplate).not.toHaveBeenCalled();
  });
});
