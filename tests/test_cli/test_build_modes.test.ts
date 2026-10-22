/**
 * `abx template build --build` selects one publish path.
 */

import "../_support/isolatedHome.js";

import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import * as fcTemplate from "../../src/providers/alicloud_express/fc_template.js";
import { templateSeams } from "../../src/providers/alicloud_express/cli/template.js";
import { cli } from "../../src/cli/main.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { patchLoadConfig, patchOfficialApi, setenv, spyAny, useTmpPath, writeText } from "../helpers/templateSupport.js";

const runner = (): CliRunner => new CliRunner();
const tmpPath = useTmpPath();

function stepsDir(): string {
  const dir = path.join(tmpPath(), "steps");
  writeText(
    path.join(dir, "template.yaml"),
    "name: steps-tpl\nbase:\n  image: python:3.12-slim\nbuild:\n  run:\n    - pip install --no-cache-dir cowsay\nresources:\n  cpu: 1\n  memory: 512\n",
  );
  return dir;
}

describe("template build modes", () => {
  it("steps mode registers the base image and does not build locally", async () => {
    patchLoadConfig();
    const buildImage = vi.spyOn(templateSeams, "_buildImage");
    const { create, ready } = patchOfficialApi({ create: { templateID: "tpl-steps", statusCode: 200 } });

    const result = await runner().invoke(cli, ["template", "build", stepsDir(), "--build", "steps", "--yes"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(buildImage).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    const body = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(body["image"]).toBe("python:3.12-slim");
    expect(body["steps"]).toEqual([{ type: "RUN", args: ["pip install --no-cache-dir cowsay"] }]);
    expect(body["envd_inject"]).toBe(false);
    expect(result.output).toContain("tpl-steps");
    expect(result.output).toContain("submitted");
    expect(result.output).toContain("platform build steps");
  });

  it("ignores an ambient ACR namespace in steps mode", async () => {
    patchLoadConfig();
    setenv("ACR_NAMESPACE", "from-env");
    patchOfficialApi({ create: { templateID: "tpl-env", statusCode: 200 } });

    const result = await runner().invoke(cli, ["template", "build", stepsDir(), "--build", "steps", "--yes"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).not.toContain("from-env");
  });

  it("rejects --acr-namespace and --legacy-api with steps", async () => {
    patchLoadConfig();
    const create = spyAny(fcTemplate, "createOfficialTemplate");

    const withNamespace = await runner().invoke(cli, ["template", "build", stepsDir(), "--build", "steps", "--acr-namespace", "ns", "--yes"]);
    expect(withNamespace.exit_code).toBe(2);
    expect(withNamespace.output).toContain("--acr-namespace cannot be used with platform build steps");

    const legacy = await runner().invoke(cli, ["template", "build", stepsDir(), "--build", "steps", "--legacy-api", "--yes"]);
    expect(legacy.exit_code).toBe(2);
    expect(legacy.output).toContain("No such option");
    expect(create).not.toHaveBeenCalled();
  });

  it("tells the user when a Dockerfile hides platform steps", async () => {
    patchLoadConfig();
    const dir = stepsDir();
    writeText(path.join(dir, "Dockerfile"), "FROM python:3.12-slim\n");
    const deploy = vi.spyOn(templateSeams, "_doDeploy").mockResolvedValue({
      TemplateID: "tpl-docker",
      BuildID: "N/A",
      "ACR Image": "reg/ns/repo:latest",
      Status: "ready",
    });

    const result = await runner().invoke(cli, ["template", "build", dir, "--acr-namespace", "ns", "--yes"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("template.yaml build steps were not sent");
    expect(deploy).toHaveBeenCalledTimes(1);
  });
});
