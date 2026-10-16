/** Tests for template CLI commands. */

import "../_support/isolatedHome.js";

import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import * as fcTemplate from "../../src/api/fc_template.js";
import {
  _isNlDescription,
  _readYamlDefaults,
  _resolveAcrNamespace,
  _doDeploy,
  resolveDeployRuntime,
  init as templateInit,
  template as templateGroup,
  templateSeams,
} from "../../src/cli/commands/template.js";
import { cli } from "../../src/cli/main.js";
import { UsageError } from "../../src/cli/errors.js";
import { RegistryClient } from "../../src/utils/registry.js";
import { CliRunner } from "../helpers/cliRunner.js";
import {
  delenv,
  fakeConfig,
  httpError,
  mockHttp,
  patchLoadConfig,
  patchOfficialApi,
  patchTransport,
  setenv,
  spyAny,
  useMockBuilder,
  useTmpPath,
  writeText,
} from "../helpers/templateSupport.js";
import { useCapsys } from "./conftest.js";

const runner = (): CliRunner => new CliRunner();
const tmpPath = useTmpPath();
const mockBuilder = useMockBuilder();
const capsys = useCapsys();

describe("TestTemplateGroup", () => {
  it("test_template_help", async () => {
    const result = await runner().invoke(cli, ["template", "--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output.toLowerCase()).toContain("template");
  });

  it("test_template_list_subcommands", async () => {
    const result = await runner().invoke(cli, ["template", "--help"]);
    expect(result.exit_code).toBe(0);
    for (const sub of ["template", "install", "list", "build", "delete", "info", "create"]) expect(result.output).toContain(sub);
  });
});

describe("TestInstallCommand", () => {
  const builtinOk = (out: string): boolean => out.toLowerCase().includes("built-in") || out.includes("No installation needed");

  it("test_install_builtin", async () => {
    const result = await runner().invoke(cli, ["template", "install", "base"]);
    expect(result.exit_code).toBe(0);
    expect(builtinOk(result.output)).toBe(true);
  });

  it("test_install_builtin_code_interpreter", async () => {
    const result = await runner().invoke(cli, ["template", "install", "code-interpreter-v1"]);
    expect(result.exit_code).toBe(0);
    expect(builtinOk(result.output)).toBe(true);
  });

  it("test_install_shortcut_help", async () => {
    const result = await runner().invoke(cli, ["template", "install", "--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output.includes("TEMPLATE_REF") || result.output.toLowerCase().includes("template_ref")).toBe(true);
  });

  it("test_install_help_discloses_cloud_costs", async () => {
    const result = await runner().invoke(cli, ["template", "install", "--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("Alibaba Cloud");
    expect(result.output.toLowerCase()).toContain("cost");
    expect(result.output).toContain("--download-only");
  });

  it("test_install_shortcut_help_discloses_cloud_costs", async () => {
    const result = await runner().invoke(cli, ["template", "install", "--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("Alibaba Cloud");
    expect(result.output.toLowerCase()).toContain("cost");
    expect(result.output).toContain("--download-only");
  });

  it("test_install_shortcut_builtin", async () => {
    const result = await runner().invoke(cli, ["template", "install", "base"]);
    expect(result.exit_code).toBe(0);
    expect(builtinOk(result.output)).toBe(true);
  });
});

describe("TestInstallSubdirFormat", () => {
  it("test_install_help_shows_subdir_examples", async () => {
    const result = await runner().invoke(cli, ["template", "install", "--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("//subdir");
  });

  it("test_install_subdir_builtin_passthrough", async () => {
    const result = await runner().invoke(cli, ["template", "install", "base"]);
    expect(result.exit_code).toBe(0);
    expect(result.output.toLowerCase().includes("built-in") || result.output.includes("No installation needed")).toBe(true);
  });

  it("test_install_shortcut_subdir_help", async () => {
    const result = await runner().invoke(cli, ["template", "install", "--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output.includes("TEMPLATE_REF") || result.output.toLowerCase().includes("template_ref")).toBe(true);
  });
});

describe("TestInstallRegistryType", () => {
  it("test_install_help_shows_registry_type", async () => {
    const result = await runner().invoke(cli, ["template", "install", "--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("--registry-type");
    expect(result.output).toContain("github");
    expect(result.output).toContain("local");
  });

  it("test_install_shortcut_has_registry_type", async () => {
    const result = await runner().invoke(cli, ["template", "install", "--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("--registry-type");
  });

  it("test_install_local_template", async () => {
    const tp = tmpPath();
    writeText(path.join(tp, "template.yaml"), "name: test-local\nversion: '1.0.0'\n");
    writeText(path.join(tp, "Dockerfile"), "FROM ubuntu:22.04\n");
    setenv("ACR_NAMESPACE", "test-namespace");
    patchTransport(mockHttp({ json: { templateID: "tpl-123", buildID: "bld-456" } }));

    const result = await runner().invoke(cli, ["template", "install", tp, "--registry-type", "local"]);
    expect(result.exit_code).toBe(2);
  });

  it("test_install_invalid_registry_type", async () => {
    const result = await runner().invoke(cli, ["template", "install", "owner/repo", "--registry-type", "invalid"]);
    expect(result.exit_code).not.toBe(0);
  });

  it("test_install_help_shows_local_example", async () => {
    const result = await runner().invoke(cli, ["template", "install", "--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output.includes("./my-template") || result.output.toLowerCase().includes("local")).toBe(true);
  });

  it("test_install_platform_400_friendly", async () => {
    const tp = tmpPath();
    writeText(path.join(tp, "template.yaml"), "name: test-local\nversion: '1.0.0'\n");
    writeText(path.join(tp, "Dockerfile"), "FROM ubuntu:22.04\n");

    const result = await runner().invoke(cli, ["template", "install", tp, "--registry-type", "local", "--download-only"]);

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("abx template build");
    expect(result.output.includes("installed-locally") || result.output.includes("installed locally")).toBe(true);
  });
});

describe("TestTemplateListCommand", () => {
  it("test_list_help_honest", async () => {
    const result = await runner().invoke(cli, ["template", "list", "--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output.toLowerCase().includes("custom templates") || result.output.toLowerCase().includes("platform")).toBe(true);
    expect(result.output.toLowerCase()).not.toContain("all available");
  });

  it("test_list_templates", async () => {
    patchTransport(mockHttp({ json: [] }));
    const result = await runner().invoke(cli, ["template", "list"]);
    expect([0, 1, 3]).toContain(result.exit_code);
  });

  it("test_list_official_templates", async () => {
    patchLoadConfig(fakeConfig({ access_key_id: "AK", access_key_secret: "SK" }));
    const templates = [{ templateID: "tpl-ready", name: "demo", status: { state: "ready" } }];
    const mockList = spyAny(fcTemplate, "listOfficialTemplates").mockResolvedValue(templates);

    const result = await runner().invoke(cli, ["template", "list", "--official-api"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("tpl-ready");
    expect(result.output).toContain("ready");
    expect(mockList).toHaveBeenCalledTimes(1);
  });
});

describe("TestTemplateBuildHelp", () => {
  it("test_build_help", async () => {
    const result = await runner().invoke(cli, ["template", "build", "--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output.includes("--dockerfile") || result.output.includes("-f")).toBe(true);
    expect(result.output).toContain("--official-api");
    expect(result.output).toContain("--acr-namespace");
  });

  it("test_build_help_discloses_cloud_costs", async () => {
    const result = await runner().invoke(cli, ["template", "build", "--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("Alibaba Cloud");
    expect(result.output.toLowerCase()).toContain("cost");
    expect(result.output.includes("cloud-side") || result.output.includes("cloud side")).toBe(true);
  });

  it("test_build_help_automation_hint", async () => {
    const result = await runner().invoke(cli, ["template", "build", "--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("automation/CI");
    expect(result.output).toContain("ACR_NAMESPACE");
    expect(result.output).toContain("ABX_TEMPLATE_DIR");
  });

  it("test_deploy_help_discloses_cloud_costs", async () => {
    const result = await runner().invoke(cli, ["template", "deploy", "--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("Alibaba Cloud");
    expect(result.output.toLowerCase()).toContain("cost");
  });

  it("test_deploy_help", async () => {
    const result = await runner().invoke(cli, ["template", "deploy", "--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("Build, push, and create template in one step");
    expect(result.output).toContain("--official-api");
    expect(result.output).toContain("--acr-namespace");
  });

  it("test_deploy_preserves_all_build_parameters", () => {
    const buildParams = templateGroup.commands!.get("build")!.params;
    const deployParams = templateGroup.commands!.get("deploy")!.params;
    const info = (params: typeof buildParams) => params.map((p) => ({ kind: p.kind, decls: p.decls, attrs: p.attrs }));
    expect(info(deployParams)).toEqual(info(buildParams));
  });

  it("test_build_local_removed", async () => {
    const result = await runner().invoke(cli, ["template", "build-local", "--help"]);
    expect(result.exit_code).not.toBe(0);
    expect(result.output).toContain("No such command 'build-local'");
  });
});

describe("TestTemplateDeleteHelp", () => {
  it("test_delete_help", async () => {
    const result = await runner().invoke(cli, ["template", "delete", "--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output.includes("TEMPLATE_ID") || result.output.toLowerCase().includes("template_id")).toBe(true);
  });

  it("test_delete_help_honest", async () => {
    const result = await runner().invoke(cli, ["template", "delete", "--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output.toLowerCase()).toContain("platform");
  });
});

describe("TestTemplateInfoHelp", () => {
  it("test_info_help", async () => {
    const result = await runner().invoke(cli, ["template", "info", "--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output.includes("TEMPLATE_ID") || result.output.toLowerCase().includes("template_id")).toBe(true);
  });

  it("test_info_official_template", async () => {
    patchLoadConfig(fakeConfig({ access_key_id: "AK", access_key_secret: "SK" }));
    const mockGet = spyAny(fcTemplate, "getTemplate").mockResolvedValue({ templateID: "tpl-ready", status: { state: "ready" } });

    const result = await runner().invoke(cli, ["template", "info", "tpl-ready", "--official-api"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("tpl-ready");
    expect(result.output).toContain("ready");
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});

describe("TestSandboxYamlAlias", () => {
  it("test_install_sandbox_yaml_only", async () => {
    const tp = tmpPath();
    writeText(path.join(tp, "sandbox.yaml"), "name: test-alias\nversion: '1.0.0'\n");
    writeText(path.join(tp, "Dockerfile"), "FROM ubuntu:22.04\n");
    setenv("ACR_NAMESPACE", "test-namespace");
    patchTransport(mockHttp({ json: { templateID: "tpl-alias-1", buildID: "bld-alias-1" } }));

    const result = await runner().invoke(cli, ["template", "install", tp, "--registry-type", "local"]);
    expect(result.exit_code).toBe(2);
  });

  it("test_install_prefers_template_yaml", async () => {
    const tp = tmpPath();
    writeText(path.join(tp, "template.yaml"), "name: canonical\nversion: '1.0.0'\n");
    writeText(path.join(tp, "sandbox.yaml"), "name: alias-version\nversion: '2.0.0'\n");
    writeText(path.join(tp, "Dockerfile"), "FROM ubuntu:22.04\n");
    setenv("ACR_NAMESPACE", "test-namespace");
    patchTransport(mockHttp({ json: { templateID: "tpl-pref-1", buildID: "bld-pref-1" } }));

    const result = await runner().invoke(cli, ["template", "install", tp, "--registry-type", "local"]);
    expect(result.exit_code).toBe(2);
  });

  it("test_install_no_yaml_mentions_both_names", async () => {
    const empty = path.join(tmpPath(), "empty-tmpl");
    fs.mkdirSync(empty);
    writeText(path.join(empty, "Dockerfile"), "FROM ubuntu:22.04\n");
    patchTransport(mockHttp());

    const result = await runner().invoke(cli, ["template", "install", empty, "--registry-type", "local"]);

    const combined = result.output + result.stderr;
    expect(result.exit_code).not.toBe(0);
    expect(combined).toContain("sandbox.yaml");
  });
});

describe("TestTemplateCommandErrorHandling", () => {
  it("test_list_server_error_friendly", async () => {
    const http = mockHttp({ error: httpError(500, { message: "internal error" }) });
    patchTransport(http);
    const result = await runner().invoke(cli, ["template", "list"]);
    expect(result.exit_code).toBe(1);
    expect(result.output).not.toContain("Traceback");
    expect(result.output).toContain("HTTP 500");
    expect(http.close).toHaveBeenCalled();
  });

  it("test_info_404_friendly", async () => {
    const http = mockHttp({ error: httpError(404, { message: "not found" }) });
    patchTransport(http);
    const result = await runner().invoke(cli, ["template", "info", "tpl-missing"]);
    expect(result.exit_code).toBe(4);
    expect(result.output).not.toContain("Traceback");
    expect(result.output).toContain("tpl-missing");
    expect(result.output).toContain("TEMPLATE_ID");
    expect(http.close).toHaveBeenCalled();
  });

  it("test_delete_404_friendly", async () => {
    const http = mockHttp({ error: httpError(404, { message: "not found" }) });
    patchTransport(http);
    const result = await runner().invoke(cli, ["template", "delete", "tpl-missing", "--yes"]);
    expect(result.exit_code).toBe(4);
    expect(result.output).not.toContain("Traceback");
    expect(result.output).toContain("tpl-missing");
    expect(result.output).toContain("TEMPLATE_ID");
    expect(http.close).toHaveBeenCalled();
  });
});

describe("TestTemplateCreateCommand", () => {
  it("test_create_help", async () => {
    const result = await runner().invoke(cli, ["template", "from-image", "--help"]);
    expect(result.exit_code).toBe(0);
    for (const s of ["IMAGE", "--name", "--team-id", "--cpu", "--memory", "--generation", "--envd-inject"]) expect(result.output).toContain(s);
  });

  it("test_create_requires_name", async () => {
    const result = await runner().invoke(cli, ["template", "from-image", "img:latest"]);
    expect(result.exit_code).not.toBe(0);
    expect(result.output.includes("--name") || result.output.includes("Missing")).toBe(true);
  });

  it("test_create_missing_aksk", async () => {
    patchLoadConfig(fakeConfig({ access_key_id: null, access_key_secret: null }));
    const result = await runner().invoke(cli, ["template", "from-image", "img:tag", "--name", "test"]);
    expect(result.exit_code).not.toBe(0);
    expect(result.output.includes("AK/SK") || result.output.toLowerCase().includes("credentials")).toBe(true);
  });

  it("test_create_success_mock", async () => {
    patchLoadConfig(fakeConfig({ access_key_id: "AK", access_key_secret: "SK" }));
    const { create } = patchOfficialApi({
      create: { templateID: "tpl-test-001", requestId: "req-001", code: "200", message: "", statusCode: 200 },
    });

    const result = await runner().invoke(cli, ["template", "from-image", "img:tag", "--name", "test-tpl"]);

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("tpl-test-001");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("test_create_json_output", async () => {
    patchLoadConfig(fakeConfig({ access_key_id: "AK", access_key_secret: "SK" }));
    patchOfficialApi({ create: { templateID: "tpl-json-001", requestId: "req-json", code: "200", message: "", statusCode: 200 } });

    const result = await runner().invoke(cli, ["--json", "template", "from-image", "img:tag", "--name", "test"]);

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("tpl-json-001");
  });
});

describe("TestTemplateDeployOfficialAPI", () => {
  it("test_deploy_help_shows_official_api", async () => {
    const result = await runner().invoke(cli, ["template", "deploy", "--help"]);
    expect(result.exit_code).toBe(0);
    for (const s of ["--official-api", "--legacy-api", "--team-id", "--envd-inject", "--generation", "--ready-cmd"]) expect(result.output).toContain(s);
  });

  it("test_deploy_template_dir_from_env", async () => {
    const tp = tmpPath();
    writeText(path.join(tp, "Dockerfile"), "FROM ubuntu:22.04\n");
    patchLoadConfig(fakeConfig({ access_key_id: null, access_key_secret: null }));

    const result = await runner().invoke(cli, ["template", "deploy", "--acr-namespace", "test-ns"], { env: { ABX_TEMPLATE_DIR: tp } });

    expect(result.exit_code).toBe(1);
    expect(result.output).not.toContain("Missing argument");
    expect(result.output.toLowerCase()).toContain("credentials missing");
  });

  it("test_deploy_default_is_official", async () => {
    const result = await runner().invoke(cli, ["template", "deploy", "--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output.toLowerCase().includes("official") || result.output.includes("CreateTemplate")).toBe(true);
  });
});

describe("TestTemplateDeployCredentialSeparation", () => {
  function _mockBuilder() {
    const mb = mockBuilder();
    mb.builder.loginAcrWithAksk.mockResolvedValue({ tempUserName: "temp-user", authorizationToken: "temp-token" });
    mb.builder.build.mockResolvedValue("local:latest");
    return mb.builder;
  }

  it("test_explicit_acr_creds_not_overridden", async () => {
    const tp = tmpPath();
    writeText(path.join(tp, "Dockerfile"), "FROM ubuntu:22.04\n");
    patchLoadConfig(fakeConfig());
    const builder = _mockBuilder();
    const { create } = patchOfficialApi({ create: { templateID: "tpl-001", statusCode: 200 } });

    const result = await runner().invoke(cli, [
      "template", "deploy", tp, "--acr-namespace", "test-ns", "--acr-username", "my-acr-user", "--acr-password", "my-acr-pass", "--yes",
    ]);

    expect(result.exit_code, result.output).toBe(0);
    const loginArgs = builder.loginAcrWithAksk.mock.calls[0]!;
    expect(loginArgs[1]).toBe("my-acr-user");
    expect(loginArgs[2]).toBe("my-acr-pass");
    const createKwargs = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(createKwargs["access_key_id"]).toBe("platform-ak");
    expect(createKwargs["access_key_secret"]).toBe("platform-sk");
  });

  it("test_acr_creds_fallback_to_platform", async () => {
    const tp = tmpPath();
    writeText(path.join(tp, "Dockerfile"), "FROM ubuntu:22.04\n");
    patchLoadConfig(fakeConfig());
    const builder = _mockBuilder();
    const { create } = patchOfficialApi({ create: { templateID: "tpl-002", statusCode: 200 } });

    const result = await runner().invoke(cli, ["template", "deploy", tp, "--acr-namespace", "test-ns", "--yes"]);

    expect(result.exit_code, result.output).toBe(0);
    const loginArgs = builder.loginAcrWithAksk.mock.calls[0]!;
    expect(loginArgs[1]).toBe("platform-ak");
    expect(loginArgs[2]).toBe("platform-sk");
    const createKwargs = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(createKwargs["access_key_id"]).toBe("platform-ak");
    expect(createKwargs["access_key_secret"]).toBe("platform-sk");
  });
});

describe("TestTemplatePushCommand", () => {
  it("test_push_help", async () => {
    const result = await runner().invoke(cli, ["template", "push", "--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("IMAGE");
    expect(result.output).toContain("--acr-namespace");
  });

  it("test_push_missing_creds", async () => {
    patchLoadConfig(fakeConfig({ access_key_id: null, access_key_secret: null }));
    const result = await runner().invoke(cli, ["template", "push", "my-img:latest", "--acr-namespace", "test-ns"]);
    expect(result.exit_code).not.toBe(0);
    expect(result.output).not.toContain("Traceback");
    expect(result.output.toLowerCase()).toContain("credentials");
  });

  it("test_push_success", async () => {
    patchLoadConfig(fakeConfig());
    const { builder } = mockBuilder();
    builder.loginAcrWithAksk.mockResolvedValue({ tempUserName: "u", authorizationToken: "t" });

    const result = await runner().invoke(cli, ["template", "push", "my-img:v1", "--acr-namespace", "test-ns"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("test-ns/my-img:v1");
    const tagArgs = builder.tag.mock.calls[0]!;
    expect(tagArgs[0]).toBe("my-img:v1");
    expect((tagArgs[1] as string).endsWith("test-ns/my-img:v1")).toBe(true);
  });
});

describe("TestTemplateBuildCommand", () => {
  it("test_build_runs_full_pipeline", async () => {
    const tp = tmpPath();
    writeText(path.join(tp, "Dockerfile"), "FROM ubuntu:22.04\n");
    patchLoadConfig(fakeConfig());
    const { builder } = mockBuilder();
    builder.build.mockResolvedValue("my-repo:v1");
    const { create } = patchOfficialApi({ create: { templateID: "tpl-b1", statusCode: 200 } });

    const result = await runner().invoke(cli, [
      "template", "build", tp, "--acr-namespace", "test-ns", "--acr-repo", "my-repo", "--tag", "v1", "--yes",
    ]);

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("tpl-b1");
    expect(builder.push).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("test_build_uses_yaml_defaults", async () => {
    const tp = tmpPath();
    writeText(path.join(tp, "Dockerfile"), "FROM ubuntu:22.04\n");
    writeText(path.join(tp, "template.yaml"), "name: my-template\nresources:\n  cpu: 4\n  memory: 4096\n");
    delenv("ACR_NAMESPACE");
    patchLoadConfig(fakeConfig());
    const { builder } = mockBuilder();
    builder.build.mockResolvedValue("my-template:latest");
    const { create } = patchOfficialApi({ create: { templateID: "tpl-yaml", statusCode: 200 } });

    const result = await runner().invoke(cli, ["template", "build", tp, "--acr-namespace", "test-ns", "--yes"]);

    expect(result.exit_code, result.output).toBe(0);
    const createKwargs = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(createKwargs["name"]).toBe("my-template");
    expect(createKwargs["cpu"]).toBe(4);
    expect(createKwargs["memory_size"]).toBe(4096);
    expect(result.output).toContain("Template: my-template");
    expect(result.output).toContain("cpu=4");
    expect(result.output).toContain("memory=4096MB");
  });

  it("test_build_acr_namespace_from_dotenv", async () => {
    const tp = tmpPath();
    writeText(path.join(tp, "Dockerfile"), "FROM ubuntu:22.04\n");
    writeText(path.join(tp, ".env"), "ACR_NAMESPACE=ns-from-dotenv\n");
    delenv("ACR_NAMESPACE");
    process.chdir(tp);
    patchLoadConfig(fakeConfig());
    const { builder } = mockBuilder();
    builder.build.mockResolvedValue("img:latest");
    const { create } = patchOfficialApi({ create: { templateID: "tpl-ns", statusCode: 200 } });

    const result = await runner().invoke(cli, ["template", "build", tp, "--yes"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("ACR: ns-from-dotenv/");
    expect((create.mock.calls[0]![0] as Record<string, string>)["image"]).toContain("ns-from-dotenv");
  });
});

describe("TestResolveAcrNamespace", () => {
  it("test_from_abx_home_dotenv", () => {
    const tp = tmpPath();
    fs.mkdirSync(path.join(tp, ".abx"));
    writeText(path.join(tp, ".abx", ".env"), "ACR_NAMESPACE=ns-from-home\n");
    const workdir = path.join(tp, "work");
    fs.mkdirSync(workdir);
    process.chdir(workdir);
    setenv("HOME", tp);
    delenv("ACR_NAMESPACE");

    expect(_resolveAcrNamespace(null)).toBe("ns-from-home");
  });

  it("test_cwd_dotenv_wins_over_home", () => {
    const tp = tmpPath();
    fs.mkdirSync(path.join(tp, ".abx"));
    writeText(path.join(tp, ".abx", ".env"), "ACR_NAMESPACE=ns-from-home\n");
    const workdir = path.join(tp, "work");
    fs.mkdirSync(workdir);
    writeText(path.join(workdir, ".env"), "ACR_NAMESPACE=ns-from-cwd\n");
    process.chdir(workdir);
    setenv("HOME", tp);
    delenv("ACR_NAMESPACE");

    expect(_resolveAcrNamespace(null)).toBe("ns-from-cwd");
  });

  it("test_missing_raises_usage_error", () => {
    const tp = tmpPath();
    const workdir = path.join(tp, "work");
    fs.mkdirSync(workdir);
    process.chdir(workdir);
    setenv("HOME", tp);
    delenv("ACR_NAMESPACE");

    expect(() => _resolveAcrNamespace(null)).toThrow(UsageError);
  });
});

describe("TestNaturalLanguageInitDetection", () => {
  it("test_sentence_and_cjk_are_descriptions", () => {
    expect(_isNlDescription("a python data science env")).toBe(true);
    expect(_isNlDescription("一个数据分析环境")).toBe(true);
    expect(_isNlDescription("my-app")).toBe(false);
    expect(_isNlDescription("./my app")).toBe(false);
    expect(_isNlDescription(".")).toBe(false);
    expect(_isNlDescription("../templates/app")).toBe(false);
  });
});

const listDir = (d: string): Set<string> =>
  new Set(fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name));

describe("TestTemplateInitCommand", () => {
  it("test_list_shows_all_cases", async () => {
    const result = await runner().invoke(cli, ["template", "scaffold", "--list"]);
    expect(result.exit_code).toBe(0);
    for (const s of ["python", "node", "minimal"]) expect(result.output).toContain(s);
  });

  it("test_python_generates_expected_files", async () => {
    const target = path.join(tmpPath(), "pyproj");
    const result = await runner().invoke(cli, ["template", "scaffold", target, "-t", "python"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(listDir(target)).toEqual(new Set(["template.yaml", "Dockerfile", "commands.py", "README.md"]));
  });

  it("test_node_generates_expected_files", async () => {
    const target = path.join(tmpPath(), "nodeproj");
    const result = await runner().invoke(cli, ["template", "scaffold", target, "-t", "node"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(listDir(target)).toEqual(new Set(["template.yaml", "Dockerfile", "commands.py", "README.md"]));
  });

  it("test_minimal_generates_expected_files", async () => {
    const target = path.join(tmpPath(), "minproj");
    const result = await runner().invoke(cli, ["template", "scaffold", target, "-t", "minimal"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(listDir(target)).toEqual(new Set(["template.yaml", "Dockerfile", "README.md"]));
    expect(fs.existsSync(path.join(target, "commands.py"))).toBe(false);
  });

  it("test_top_level_init_shortcut_works", async () => {
    const target = path.join(tmpPath(), "topshortcut");
    const result = await runner().invoke(cli, ["template", "scaffold", target, "-t", "python"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(fs.existsSync(path.join(target, "template.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(target, "Dockerfile"))).toBe(true);
  });

  it("test_from_path", async () => {
    const tp = tmpPath();
    const source = path.join(tp, "src");
    writeText(path.join(source, "template.yaml"), "name: from-test\n");
    writeText(path.join(source, "Dockerfile"), "FROM ubuntu:22.04\n");
    const target = path.join(tp, "dest");
    vi.spyOn(RegistryClient.prototype, "resolve").mockResolvedValue({
      is_builtin: false, registry_type: "local", local_path: source, owner: "test", repo: "test",
    } as never);
    vi.spyOn(RegistryClient.prototype, "fetch").mockResolvedValue(source);

    const result = await runner().invoke(cli, ["template", "scaffold", target, "--from", source]);

    expect(result.exit_code, result.output).toBe(0);
    expect(fs.existsSync(path.join(target, "template.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(target, "Dockerfile"))).toBe(true);
  });
});

describe("TestTemplateInitCommandObject", () => {
  it("test_template_group_exposes_init", async () => {
    expect(await templateGroup.getCommand("scaffold")).toBe(templateInit);
    expect(await cli.getCommand("scaffold")).toBeNull();
  });
});

const selectMock = vi.hoisted(() => vi.fn());
vi.mock("@inquirer/prompts", () => ({ select: (...a: unknown[]) => selectMock(...a) }));

describe("TestInitInteractivePicker", () => {
  beforeEach(() => {
    selectMock.mockReset();
    const prev = templateSeams.stdinIsatty;
    templateSeams.stdinIsatty = () => true;
    return () => {
      templateSeams.stdinIsatty = prev;
    };
  });

  it("test_arrow_picker_selects_case", async () => {
    selectMock.mockResolvedValue("node");
    process.chdir(tmpPath());
    const result = await runner().invoke(cli, ["template", "scaffold"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(tmpPath(), "node", "template.yaml"))).toBe(true);
    expect(result.output).not.toContain("1. python");
  });

  it("test_numbered_fallback_when_questionary_missing", async () => {
    vi.spyOn(templateSeams, "_tryArrowCasePicker").mockResolvedValue(null);
    process.chdir(tmpPath());
    const result = await runner().invoke(cli, ["template", "scaffold"], { input: "2\n" });
    expect(result.exit_code, result.output).toBe(0);
    expect(fs.existsSync(path.join(tmpPath(), "node", "template.yaml"))).toBe(true);
    expect(result.output).toContain("1. python");
  });

  it("test_numbered_fallback_when_picker_raises", async () => {
    selectMock.mockRejectedValue(new Error("no terminal"));
    process.chdir(tmpPath());
    const result = await runner().invoke(cli, ["template", "scaffold"], { input: "1\n" });
    expect(result.exit_code, result.output).toBe(0);
    expect(fs.existsSync(path.join(tmpPath(), "python", "template.yaml"))).toBe(true);
  });

  it("test_picker_cancel_aborts", async () => {
    selectMock.mockResolvedValue(null);
    process.chdir(tmpPath());
    const result = await runner().invoke(cli, ["template", "scaffold"]);
    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("Aborted");
    expect(fs.existsSync(path.join(tmpPath(), "python"))).toBe(false);
  });

  it("test_json_mode_never_prompts", async () => {
    process.chdir(tmpPath());
    const result = await runner().invoke(cli, ["--json", "template", "scaffold"]);
    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("No scaffold case specified");
    expect(selectMock).toHaveBeenCalledTimes(0);
  });

  it("test_ci_env_never_prompts", async () => {
    setenv("CI", "true");
    process.chdir(tmpPath());
    const result = await runner().invoke(cli, ["template", "scaffold"]);
    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("No scaffold case specified");
    expect(selectMock).toHaveBeenCalledTimes(0);
  });
});

const DEPLOY_RESULT = { TemplateID: "tpl-deploy-test", BuildID: "bld-1", "ACR Image": "registry/ns/repo:latest", Status: "ready" };

function patchDoDeploy(over: Record<string, unknown> = {}) {
  return vi.spyOn(templateSeams, "_doDeploy").mockResolvedValue({ ...DEPLOY_RESULT, ...over });
}

function envAliyun(ns: string | null = "test-ns"): void {
  if (ns) setenv("ACR_NAMESPACE", ns);
  setenv("ALICLOUD_ACCESS_KEY_ID", "ak-test");
  setenv("ALICLOUD_ACCESS_KEY_SECRET", "sk-test");
}

describe("TestInstallFullPipeline", () => {
  function _makeTemplateDir(): string {
    const tdir = path.join(tmpPath(), "tpl");
    writeText(path.join(tdir, "template.yaml"), "name: test-tpl\nresources:\n  cpu: 1\n  memory: 512\n");
    writeText(path.join(tdir, "Dockerfile"), "FROM ubuntu:22.04\n");
    return tdir;
  }

  it("test_install_deploy_with_yes", async () => {
    const tdir = _makeTemplateDir();
    envAliyun();
    const mockDeploy = patchDoDeploy({ TemplateID: "tpl-deploy-test" });

    const result = await runner().invoke(cli, ["template", "install", tdir, "--registry-type", "local", "--yes"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(mockDeploy).toHaveBeenCalled();
    const kw = mockDeploy.mock.calls[0]![1] as unknown as Record<string, unknown>;
    expect(kw["cpu"] === undefined || kw["cpu"] === null || kw["cpu"] === 1).toBe(true);
  });

  it("test_install_non_tty_without_yes_raises", async () => {
    const tdir = _makeTemplateDir();
    envAliyun();
    const result = await runner().invoke(cli, ["template", "install", tdir, "--registry-type", "local"]);
    expect(result.exit_code).not.toBe(0);
    expect(result.output.includes("--yes") || result.output.includes("Confirmation")).toBe(true);
  });

  it("test_install_missing_acr_namespace_error", async () => {
    const tdir = _makeTemplateDir();
    delenv("ACR_NAMESPACE");
    envAliyun(null);
    setenv("HOME", tmpPath());
    process.chdir(tmpPath());
    const result = await runner().invoke(cli, ["template", "install", tdir, "--registry-type", "local"]);
    expect(result.exit_code).not.toBe(0);
    expect(result.output).toContain("--download-only");
    expect(result.output.includes("Cannot build") || result.output.includes("Missing")).toBe(true);
  });
});

describe("TestGenerationFromYaml", () => {
  it("test_generation_from_yaml", () => {
    const tdir = path.join(tmpPath(), "gen");
    writeText(path.join(tdir, "template.yaml"), "name: test-gen\ngeneration: 2\nresources:\n  cpu: 1\n  memory: 512\n");
    const defaults = _readYamlDefaults(tdir);
    expect(defaults["generation"]).toBe(2);
  });

  it("test_generation_cli_overrides_yaml", async () => {
    const tdir = path.join(tmpPath(), "gen2");
    writeText(path.join(tdir, "template.yaml"), "name: test-gen2\ngeneration: 2\nresources:\n  cpu: 1\n");
    writeText(path.join(tdir, "Dockerfile"), "FROM ubuntu:22.04\n");
    envAliyun();
    const mockDeploy = patchDoDeploy({ TemplateID: "tpl-gen" });

    const result = await runner().invoke(cli, ["template", "build", tdir, "--generation", "1", "--yes"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(mockDeploy).toHaveBeenCalled();
    expect((mockDeploy.mock.calls[0]![1] as unknown as Record<string, unknown>)["generation"]).toBe(1);
  });
});

describe("TestStartReadyWarning", () => {
  it("test_warning_when_generation_not_2", async () => {
    const tdir = path.join(tmpPath(), "warn");
    writeText(path.join(tdir, "template.yaml"), "name: test-warn\n");
    writeText(path.join(tdir, "Dockerfile"), "FROM ubuntu:22.04\n");
    envAliyun();
    patchDoDeploy({ TemplateID: "tpl-w", "ACR Image": "img:latest" });

    const result = await runner().invoke(cli, ["template", "build", tdir, "--start-cmd", "/start.sh", "--generation", "1", "--yes"]);

    expect(result.exit_code, result.output).toBe(0);
  });

  it("test_do_deploy_warns_start_cmd_gen1", async () => {
    const tdir = path.join(tmpPath(), "warn2");
    writeText(path.join(tdir, "template.yaml"), "name: test-w2\n");
    writeText(path.join(tdir, "Dockerfile"), "FROM ubuntu:22.04\n");
    setenv("ALICLOUD_ACCESS_KEY_ID", "ak");
    setenv("ALICLOUD_ACCESS_KEY_SECRET", "sk");

    vi.spyOn(templateSeams, "_buildImage").mockResolvedValue("img:latest");
    vi.spyOn(templateSeams, "_pushImage").mockResolvedValue(["acr/img:latest", { tempUserName: "u", authorizationToken: "t" }]);
    patchOfficialApi({ create: { templateID: "tpl-w2", statusCode: 200 } });
    const warning = vi.fn();
    const mockOut = new Proxy(
      { verbose: false, use_live_status: false, warning } as Record<string, unknown>,
      {
        get(target, prop: string) {
          if (!(prop in target)) target[prop] = vi.fn();
          return target[prop];
        },
      },
    );
    vi.spyOn(templateSeams, "getOutput").mockReturnValue(mockOut as never);

    await _doDeploy(tdir, { acr_namespace: "ns", start_cmd: "/start.sh", generation: 1 });

    const warningsSent = warning.mock.calls.map((c) => c[0] as string);
    expect(warningsSent.some((m) => m.includes("--start-cmd") && m.includes("generation 2"))).toBe(true);
    expect(capsys.readouterr().err).toBe("");
  });
});

describe("TestInitDefaultDirectory", () => {
  it("test_init_no_dir_creates_subdir", async () => {
    process.chdir(tmpPath());
    const result = await runner().invoke(cli, ["template", "scaffold", "-t", "python"]);
    expect(result.exit_code, result.output).toBe(0);
    const subdir = path.join(tmpPath(), "python");
    expect(fs.statSync(subdir).isDirectory()).toBe(true);
    for (const f of ["template.yaml", "Dockerfile", "commands.py"]) expect(fs.existsSync(path.join(subdir, f))).toBe(true);
    expect(fs.existsSync(path.join(tmpPath(), "template.yaml"))).toBe(false);
  });

  it("test_init_no_dir_with_name", async () => {
    process.chdir(tmpPath());
    const result = await runner().invoke(cli, ["template", "scaffold", "-t", "python", "--name", "myapp"]);
    expect(result.exit_code, result.output).toBe(0);
    const subdir = path.join(tmpPath(), "myapp");
    expect(fs.statSync(subdir).isDirectory()).toBe(true);
    expect(fs.existsSync(path.join(subdir, "template.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(tmpPath(), "template.yaml"))).toBe(false);
  });

  it("test_init_explicit_dir_still_works", async () => {
    const target = path.join(tmpPath(), "custom");
    const result = await runner().invoke(cli, ["template", "scaffold", target, "-t", "python"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(fs.existsSync(path.join(target, "template.yaml"))).toBe(true);
  });

  it("test_init_name_precedence_name_over_case", async () => {
    process.chdir(tmpPath());
    const result = await runner().invoke(cli, ["template", "scaffold", "-t", "node", "--name", "webapp"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(fs.statSync(path.join(tmpPath(), "webapp")).isDirectory()).toBe(true);
    expect(fs.existsSync(path.join(tmpPath(), "node"))).toBe(false);
  });

  it("test_init_name_precedence_case_over_default", async () => {
    process.chdir(tmpPath());
    const result = await runner().invoke(cli, ["template", "scaffold", "-t", "minimal"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(fs.statSync(path.join(tmpPath(), "minimal")).isDirectory()).toBe(true);
  });

  it("test_template_init_no_dir_creates_subdir", async () => {
    process.chdir(tmpPath());
    const result = await runner().invoke(cli, ["template", "scaffold", "-t", "python"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(fs.existsSync(path.join(tmpPath(), "python", "template.yaml"))).toBe(true);
  });
});

describe("TestInitFromDefaultDirectory", () => {
  const refFor = (source: string, extra: Record<string, unknown>) =>
    ({ is_builtin: false, registry_type: "local", local_path: source, owner: "test", repo: "test", ...extra }) as never;

  it("test_init_from_no_dir_uses_yaml_name", async () => {
    const tp = tmpPath();
    const source = path.join(tp, "src");
    writeText(path.join(source, "template.yaml"), "name: from-yaml-name\n");
    writeText(path.join(source, "Dockerfile"), "FROM ubuntu:22.04\n");
    process.chdir(tp);
    vi.spyOn(RegistryClient.prototype, "resolve").mockResolvedValue(refFor(source, { path: "test" }));
    vi.spyOn(RegistryClient.prototype, "fetch").mockResolvedValue(source);

    const result = await runner().invoke(cli, ["template", "scaffold", "--from", source]);

    expect(result.exit_code, result.output).toBe(0);
    const subdir = path.join(tp, "from-yaml-name");
    expect(fs.statSync(subdir).isDirectory()).toBe(true);
    expect(fs.existsSync(path.join(subdir, "template.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(subdir, "Dockerfile"))).toBe(true);
  });

  it("test_init_from_no_yaml_uses_ref_basename", async () => {
    const tp = tmpPath();
    const source = path.join(tp, "src");
    writeText(path.join(source, "Dockerfile"), "FROM ubuntu:22.04\n");
    process.chdir(tp);
    vi.spyOn(RegistryClient.prototype, "resolve").mockResolvedValue(refFor(source, { repo: "my-ref-repo", path: "owner/my-ref-repo" }));
    vi.spyOn(RegistryClient.prototype, "fetch").mockResolvedValue(source);

    const result = await runner().invoke(cli, ["template", "scaffold", "--from", source]);

    expect(result.exit_code).not.toBe(0);
    expect(result.output).toContain("--adopt");
    expect(fs.existsSync(path.join(tp, "my-ref-repo"))).toBe(false);
  });
});

describe("TestBuildYamlGeneration", () => {
  it("test_build_yaml_generation_2_no_flag", async () => {
    const tdir = path.join(tmpPath(), "gen2");
    writeText(path.join(tdir, "template.yaml"), "name: test-gen2\ngeneration: 2\nresources:\n  cpu: 1\n  memory: 512\n");
    writeText(path.join(tdir, "Dockerfile"), "FROM ubuntu:22.04\n");
    envAliyun();
    const mockDeploy = patchDoDeploy({ TemplateID: "tpl-gen2" });

    const result = await runner().invoke(cli, ["template", "build", tdir, "--yes"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(mockDeploy).toHaveBeenCalled();
    expect((mockDeploy.mock.calls[0]![1] as unknown as Record<string, unknown>)["generation"]).toBe(2);
  });

  it("test_express_commands_py_defaults_generation_and_start", async () => {
    const tdir = path.join(tmpPath(), "express");
    writeText(path.join(tdir, "template.yaml"), "name: express-demo\nbase: python:3.12\n");
    writeText(path.join(tdir, "Dockerfile"), "FROM ubuntu:22.04\n");
    writeText(path.join(tdir, "commands.py"), "print('hi')\n");
    delenv("ABX_PROVIDER");
    envAliyun();
    const mockDeploy = patchDoDeploy({ TemplateID: "tpl-express" });

    const result = await runner().invoke(cli, ["template", "build", tdir, "--yes"]);

    expect(result.exit_code, result.output).toBe(0);
    const kw = mockDeploy.mock.calls[0]![1] as unknown as Record<string, unknown>;
    expect(kw["generation"]).toBe(2);
    expect(kw["start_cmd"]).toBe("agent-sandbox-server serve --port 9000 --commands /home/user/app/commands.py");
    expect(kw["ready_cmd"]).toBe("agent-sandbox-server healthcheck --port 9000");
  });

  it("test_generation_flag_wins_over_express_default", async () => {
    const tdir = path.join(tmpPath(), "express-flag");
    writeText(path.join(tdir, "template.yaml"), "name: express-flag\n");
    writeText(path.join(tdir, "Dockerfile"), "FROM ubuntu:22.04\n");
    writeText(path.join(tdir, "commands.py"), "print('hi')\n");
    delenv("ABX_PROVIDER");
    envAliyun();
    const mockDeploy = patchDoDeploy({ TemplateID: "tpl-flag" });

    const result = await runner().invoke(cli, ["template", "build", tdir, "--generation", "1", "--yes"]);

    expect(result.exit_code, result.output).toBe(0);
    const kw = mockDeploy.mock.calls[0]![1] as unknown as Record<string, unknown>;
    expect(kw["generation"]).toBe(1);
    expect(kw["start_cmd"]).toBeNull();
  });

  it("test_yaml_start_cmd_is_used_when_the_flag_is_omitted", () => {
    const tdir = path.join(tmpPath(), "yaml-start");
    writeText(path.join(tdir, "template.yaml"), 'name: yaml-start\ngeneration: 2\nstart_cmd: "serve"\nready_cmd: "health"\n');
    const runtime = resolveDeployRuntime(tdir, {}, { server_start: "image_cmd" } as never);
    expect(runtime).toEqual({ generation: 2, start_cmd: "serve", ready_cmd: "health" });
  });

  it("test_generic_provider_does_not_default_to_generation_2", () => {
    const tdir = path.join(tmpPath(), "generic");
    writeText(path.join(tdir, "commands.py"), "print('hi')\n");
    writeText(path.join(tdir, "template.yaml"), "name: generic\n");
    const runtime = resolveDeployRuntime(
      tdir,
      {},
      {
        server_start: "image_cmd",
        start_cmd: null,
        ready_cmd: null,
      } as never,
    );
    expect(runtime.generation).toBe(1);
    expect(runtime.start_cmd).toBeNull();
  });
});

describe("TestBuildTargetImagePassthrough", () => {
  it("test_build_envd_inject_target_image", async () => {
    const tdir = path.join(tmpPath(), "timg");
    writeText(path.join(tdir, "template.yaml"), "name: test-timg\n");
    writeText(path.join(tdir, "Dockerfile"), "FROM ubuntu:22.04\n");
    envAliyun();
    patchLoadConfig(fakeConfig({ access_key_id: "ak-test", access_key_secret: "sk-test" }));
    const { builder } = mockBuilder();
    builder.build.mockResolvedValue("test-timg:latest");
    const { create } = patchOfficialApi({ create: { templateID: "tpl-ti", statusCode: 200 } });

    const result = await runner().invoke(cli, [
      "template", "build", tdir, "--envd-inject", "--target-image", "custom-target:v1", "--yes",
    ]);

    expect(result.exit_code, result.output).toBe(0);
    expect(create).toHaveBeenCalledTimes(1);
    const kw = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(kw["target_image"]).toBe("custom-target:v1");
    expect(kw["envd_inject"]).toBe(true);
  });
});

describe("TestInstallDirOption", () => {
  function _src(name: string, tp: string): string {
    const source = path.join(tp, "src");
    writeText(path.join(source, "template.yaml"), `name: ${name}\n`);
    writeText(path.join(source, "Dockerfile"), "FROM ubuntu:22.04\n");
    return source;
  }

  it("test_install_dir_download_only", async () => {
    const tp = tmpPath();
    const source = _src("dir-test", tp);
    const dest = path.join(tp, "out");
    const result = await runner().invoke(cli, ["template", "install", source, "--registry-type", "local", "--download-only", "--dir", dest]);
    expect(result.exit_code, result.output).toBe(0);
    expect(fs.existsSync(path.join(dest, "template.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "Dockerfile"))).toBe(true);
  });

  it("test_install_dir_nonempty_errors", async () => {
    const tp = tmpPath();
    const source = _src("dir-test", tp);
    const dest = path.join(tp, "occupied");
    writeText(path.join(dest, "existing.txt"), "conflict\n");
    const result = await runner().invoke(cli, ["template", "install", source, "--registry-type", "local", "--download-only", "--dir", dest]);
    expect(result.exit_code).not.toBe(0);
    expect(result.output).toContain("not empty");
  });

  it("test_install_shortcut_dir_option", async () => {
    const tp = tmpPath();
    const source = _src("sc-test", tp);
    const dest = path.join(tp, "scdir");
    const result = await runner().invoke(cli, ["template", "install", source, "--registry-type", "local", "--download-only", "--dir", dest]);
    expect(result.exit_code, result.output).toBe(0);
    expect(fs.existsSync(path.join(dest, "template.yaml"))).toBe(true);
  });

  it("test_install_dir_deploy_passes_template_dir", async () => {
    const tp = tmpPath();
    const source = _src("deploy-dir", tp);
    envAliyun();
    const dest = path.join(tp, "destdir");
    const mockDeploy = patchDoDeploy({ TemplateID: "tpl-dir", "ACR Image": "reg/ns/repo:latest" });

    const result = await runner().invoke(cli, ["template", "install", source, "--registry-type", "local", "--dir", dest, "--yes"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(mockDeploy).toHaveBeenCalled();
    expect(mockDeploy.mock.calls[0]![0]).toBe(dest);
  });
});
