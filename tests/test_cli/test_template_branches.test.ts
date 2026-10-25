import { manifestYaml } from "../helpers/templateManifest.js";
import "../_support/isolatedHome.js";
import * as guidance from "../../src/cli/config_guidance.js";
/**
 * Branch coverage tests added while re-reading `template.py` line by line: paths of the ported module that the Python
 * suite never exercises (legacy `build_and_register` pipeline, early credential checks, confirmation prompts, shape
 * variants of the platform responses).
 */


import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _doDeploy, templateSeams } from "../../src/providers/alicloud_express/cli/template.js";
import { unifiedDiff } from "../../src/cli/commands/_adopt.js";
import { cli } from "../../src/cli/main.js";
import { CliError } from "../../src/cli/errors.js";
import { DockerBuilder } from "../../src/providers/alicloud_express/docker_builder.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { fakeConfig, mockHttp, patchLoadConfig, patchTransport, setenv, spyAny, useMockBuilder, useTmpPath, writeText } from "../helpers/templateSupport.js";

const runner = (): CliRunner => new CliRunner();
const tmpPath = useTmpPath();
useMockBuilder();

let originalIsatty = templateSeams.stdinIsatty;
beforeEach(() => {
  originalIsatty = templateSeams.stdinIsatty;
});
afterEach(() => {
  templateSeams.stdinIsatty = originalIsatty;
});

function templateDir(): string {
  const tdir = path.join(tmpPath(), "tpl");
  writeText(path.join(tdir, "template.yaml"), manifestYaml("name: test-tpl\nresources:\n  cpu: 1\n  memory: 512\n"));
  writeText(path.join(tdir, "Dockerfile"), "FROM ubuntu:22.04\n");
  return tdir;
}

function envAliyun(): void {
  setenv("ACR_NAMESPACE", "test-ns");
  setenv("ALICLOUD_ACCESS_KEY_ID", "ak-test");
  setenv("ALICLOUD_ACCESS_KEY_SECRET", "sk-test");
}

describe("TestDeployConfirmation", () => {
  it("test_deploy_early_credential_check_exits_1", async () => {
    patchLoadConfig(fakeConfig({ access_key_id: null, access_key_secret: null }));
    const tdir = templateDir();
    const result = await runner().invoke(cli, ["template", "deploy", tdir, "--acr-namespace", "ns", "--yes"]);
    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("Missing configuration");
    expect(result.output).toContain("access_key_id");
    expect(result.output).toContain("access_key_secret");
    expect(result.output).not.toContain("AccessKey / AccessSecret");
  });

  it("test_deploy_json_prints_template_id_on_stdout", async () => {
    patchLoadConfig(fakeConfig());
    const deployed = vi.spyOn(templateSeams, "_doDeploy").mockResolvedValue({
      TemplateID: "tpl-json-alias",
      BuildID: "bld-1",
      "ACR Image": "registry/ns/repo:latest",
      Status: "ready",
      _build_logs: ["noise"],
    });
    const result = await runner().invoke(cli, [
      "--json",
      "template",
      "deploy",
      templateDir(),
      "--alias",
      "uniq-alias",
      "-y",
      "--acr-namespace",
      "ns",
    ]);
    expect(result.exit_code, result.output).toBe(0);
    const payload = JSON.parse(result.stdout) as { TemplateID?: string };
    expect(payload.TemplateID).toBe("tpl-json-alias");
    expect(result.stdout).not.toContain("Template: ");
    deployed.mockRestore();
  });

  it("test_deploy_without_yes_in_non_interactive_mode_is_usage_error", async () => {
    patchLoadConfig(fakeConfig());
    const result = await runner().invoke(cli, ["template", "deploy", templateDir(), "--acr-namespace", "ns"]);
    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("Confirmation required for deploying to cloud");
  });

  it("test_deploy_confirmation_declined_aborts", async () => {
    patchLoadConfig(fakeConfig());
    templateSeams.stdinIsatty = () => true;
    vi.spyOn(guidance, "canGuideConfiguration").mockReturnValue(true);
    const doDeploy = vi.spyOn(templateSeams, "_doDeploy");
    const result = await runner().invoke(cli, ["template", "deploy", templateDir(), "--acr-namespace", "ns"], { input: "n\n" });
    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("Push image to ns/test-tpl:latest and register template 'test-tpl'?");
    expect(result.output).toContain("Aborted!");
    expect(doDeploy).not.toHaveBeenCalled();
  });
});

describe("TestDeleteConfirmation", () => {
  it("test_delete_without_yes_in_non_interactive_mode_is_usage_error", async () => {
    patchLoadConfig(fakeConfig());
    const result = await runner().invoke(cli, ["template", "delete", "tpl-1"]);
    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("Confirmation required for deleting template");
  });

  it("test_delete_confirmation_declined_aborts", async () => {
    patchLoadConfig();
    templateSeams.stdinIsatty = () => true;
    vi.spyOn(guidance, "canGuideConfiguration").mockReturnValue(true);
    const http = mockHttp({ json: {} });
    patchTransport(http);
    const result = await runner().invoke(cli, ["template", "delete", "tpl-1"], { input: "n\n" });
    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("Delete template 'tpl-1'? This action cannot be undone.");
    expect(result.output).toContain("Aborted!");
    expect(http.platformRequest).not.toHaveBeenCalled();
  });
});

describe("TestInstallPipelineStatuses", () => {
  const install = async (status: string): Promise<string> => {
    envAliyun();
    const tp = tmpPath();
    const source = path.join(tp, "src");
    writeText(path.join(source, "template.yaml"), manifestYaml("name: st-test\n"));
    writeText(path.join(source, "Dockerfile"), "FROM ubuntu:22.04\n");
    spyAny(templateSeams, "_doDeploy").mockResolvedValue({
      TemplateID: "tpl-9",
      BuildID: "b",
      "ACR Image": "r/n/x:latest",
      Status: status,
      _build_logs: [],
    });
    const result = await runner().invoke(cli, ["template", "install", source, "--registry-type", "local", "--yes"]);
    expect(result.exit_code, result.output).toBe(0);
    return result.output;
  };

  it("test_install_ready_status_prints_usage_hint", async () => {
    const out = await install("ready");
    expect(out).toContain("Template installed, built, and ready!");
    expect(out).toContain("Use: abx create tpl-9");
  });

  it("test_install_pushed_status_message", async () => {
    expect(await install("pushed")).toContain("Template downloaded and image pushed; registration submitted.");
  });

  it("test_install_other_status_prints_error", async () => {
    expect(await install("failed")).toContain("Build status: failed");
  });

  it("test_install_without_yes_in_non_interactive_mode_is_usage_error", async () => {
    envAliyun();
    const tp = tmpPath();
    const source = path.join(tp, "src");
    writeText(path.join(source, "template.yaml"), manifestYaml("name: st-test\n"));
    writeText(path.join(source, "Dockerfile"), "FROM ubuntu:22.04\n");
    const result = await runner().invoke(cli, ["template", "install", source, "--registry-type", "local"]);
    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("Confirmation required for build + deploy");
  });

  it("test_install_confirmation_declined_aborts", async () => {
    envAliyun();
    templateSeams.stdinIsatty = () => true;
    vi.spyOn(guidance, "canGuideConfiguration").mockReturnValue(true);
    const tp = tmpPath();
    const source = path.join(tp, "src");
    writeText(path.join(source, "template.yaml"), manifestYaml("name: st-test\n"));
    writeText(path.join(source, "Dockerfile"), "FROM ubuntu:22.04\n");
    const doDeploy = spyAny(templateSeams, "_doDeploy");
    const result = await runner().invoke(cli, ["template", "install", source, "--registry-type", "local"], { input: "n\n" });
    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("Build and deploy template 'st-test'?");
    expect(doDeploy).not.toHaveBeenCalled();
  });
});

describe("TestInitFlagCombinations", () => {
  it("test_nl_description_cannot_combine_with_template_flag", async () => {
    const result = await runner().invoke(cli, ["template", "scaffold", "--prompt", "a python web service that serves files", "-t", "python"]);
    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("A natural-language description cannot be combined with --template/-t or --from.");
  });

  it("test_from_builtin_template_is_rejected", async () => {
    const result = await runner().invoke(cli, ["template", "scaffold", "--from", "base"]);
    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("'base' is a built-in template and cannot be used with --from.");
  });
});

describe("TestAdoptUnifiedDiff", () => {
  it("test_unified_diff_for_multiple_hunks", () => {
    const a = Array.from({ length: 20 }, (_, i) => `l${i}\n`);
    const b = [...a];
    b[2] = "L2\n";
    b.splice(10, 0, "new\n");
    b[b.length - 1] = "l19";
    expect(unifiedDiff(a, b, "f.py", "f.py")).toEqual([
      "--- f.py\n", "+++ f.py\n", "@@ -1,6 +1,6 @@\n", " l0\n", " l1\n", "-l2\n", "+L2\n", " l3\n", " l4\n", " l5\n",
      "@@ -8,6 +8,7 @@\n", " l7\n", " l8\n", " l9\n", "+new\n", " l10\n", " l11\n", " l12\n",
      "@@ -17,4 +18,4 @@\n", " l16\n", " l17\n", " l18\n", "-l19\n", "+l19\n", "\\ No newline at end of file\n",
    ]);
  });

  it("test_unified_diff_empty_source_and_identical_inputs", () => {
    expect(unifiedDiff([], ["x\n"], "f", "f")).toEqual(["--- f\n", "+++ f\n", "@@ -0,0 +1 @@\n", "+x\n"]);
    expect(unifiedDiff(["x\n"], ["x\n"], "f", "f")).toEqual([]);
  });
});
