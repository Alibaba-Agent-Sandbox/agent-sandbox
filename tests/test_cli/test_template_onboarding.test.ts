import { manifestYaml } from "../helpers/workflowManifest.js";
import "../_support/isolatedHome.js";

import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cli } from "../../src/cli/main.js";
import { command, type Context } from "../../src/cli/kit.js";
import { getFormatter } from "../../src/cli/formatters.js";
import * as extensions from "../../src/cli/provider_extensions.js";
import { templateSeams } from "../../src/cli/template_catalog.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { useTmpPath } from "../helpers/templateSupport.js";

const tmpPath = useTmpPath();
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function interactive(): void {
  vi.spyOn(templateSeams, "_scaffoldPickerAvailable").mockReturnValue(true);
  vi.spyOn(templateSeams, "_tryArrowCasePicker").mockResolvedValue("python");
}

describe("Template project onboarding", () => {
  function backend() {
    const original = extensions.providerCliExtension()!;
    const record = vi.fn((ctx: Context, params: Record<string, unknown>) => {
      const directory = String(params["path"] ?? params["template_dir"]);
      expect(fs.existsSync(path.join(directory, "template.yaml"))).toBe(true);
      getFormatter(ctx).printData({ TemplateID: "test-template", alias: params["alias"] });
    });
    const target = command("build", { params: [...original.templateUi["build"]!.params], callback: record });
    vi.spyOn(extensions, "providerCliExtension").mockReturnValue({ ...original,
      loadTemplates: async () => ({ build: target, deploy: target }),
      loadDeploy: async () => ({ deploy_shortcut: target }),
    });
    return record;
  }

  it.each([["deploy"], ["template", "deploy"], ["template", "build"]])("guides unconfirmed missing paths without writes: %s", async (...prefix) => {
    const directory = path.join(tmpPath(), "dev-services");
    const record = backend();
    const result = await new CliRunner().invoke(cli, [...prefix, directory]);
    expect(result.exit_code, result.output).toBe(2);
    expect(result.output).toContain("abx template scaffold");
    expect(result.output).toContain("--yes/-y");
    expect(fs.existsSync(directory)).toBe(false);
    expect(record).not.toHaveBeenCalled();
  });

  it.each([["deploy"], ["template", "deploy"], ["template", "build"]])("yes creates a usable project and continues with original options: %s", async (...prefix) => {
    const directory = path.join(tmpPath(), "dev-services");
    const record = backend();
    const result = await new CliRunner().invoke(cli, [...prefix, directory, "-y", "--alias", "dev-services", "--timeout", "123"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(fs.readFileSync(path.join(directory, "template.yaml"), "utf8")).toContain("name: dev-services");
    expect(fs.readFileSync(path.join(directory, "Dockerfile"), "utf8")).toContain("FROM");
    expect(fs.existsSync(path.join(directory, "commands.py"))).toBe(true);
    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0]![1]).toMatchObject({ yes: true, alias: "dev-services", timeout: 123 });
    expect(record.mock.calls[0]![1][prefix.length === 1 ? "path" : "template_dir"]).toBe(directory);
  });

  it.each([["deploy"], ["template", "deploy"], ["template", "build"]])("interactive confirmation creates and continues: %s", async (...prefix) => {
    interactive();
    const directory = path.join(tmpPath(), "dev-services");
    const record = backend();
    const result = await new CliRunner().invoke(cli, [...prefix, directory, "--alias", "kept"], { input: "y\n" });
    expect(result.exit_code, result.output).toBe(0);
    expect(fs.existsSync(path.join(directory, "template.yaml"))).toBe(true);
    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0]![1]).toMatchObject({ alias: "kept", yes: false });
    expect(result.output).not.toContain("Review the generated files, then deploy:");
  });

  it.each([["deploy"], ["template", "deploy"], ["template", "build"]])("CI creates without prompting and produces one final JSON result: %s", async (...prefix) => {
    const directory = path.join(tmpPath(), "ci-project");
    const record = backend();
    const result = await new CliRunner().invoke(cli, ["--ci", ...prefix, directory, "--alias", "kept"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ TemplateID: "test-template", alias: "kept" });
    expect(record.mock.calls[0]![1]["yes"]).toBe(true);
  });

  it("CI environment creates without prompts or a yes flag", async () => {
    vi.stubEnv("CI", "true");
    const record = backend();
    const directory = path.join(tmpPath(), "ci-env");
    const result = await new CliRunner().invoke(cli, ["template", "deploy", directory]);
    expect(result.exit_code, result.output).toBe(0);
    expect(JSON.parse(result.stdout)["TemplateID"]).toBe("test-template");
    expect(record.mock.calls[0]![1]["yes"]).toBe(true);
  });

  it("JSON plus yes suppresses the intermediate scaffold summary", async () => {
    backend();
    const directory = path.join(tmpPath(), "json-project");
    const result = await new CliRunner().invoke(cli, ["--json", "template", "deploy", directory, "--yes"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(JSON.parse(result.stdout)["TemplateID"]).toBe("test-template");
  });

  it("an existing project is passed through without re-scaffolding", async () => {
    const record = backend();
    fs.writeFileSync(path.join(tmpPath(), "Dockerfile"), "original\n");
    fs.writeFileSync(path.join(tmpPath(), "template.yaml"), manifestYaml("name: existing\n"));
    const result = await new CliRunner().invoke(cli, ["template", "deploy", tmpPath(), "-y"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(record).toHaveBeenCalledOnce();
    expect(fs.readFileSync(path.join(tmpPath(), "Dockerfile"), "utf8")).toBe("original\n");
    expect(fs.existsSync(path.join(tmpPath(), "commands.py"))).toBe(false);
  });

  it("interactive creation uses the selected runtime", async () => {
    interactive();
    vi.mocked(templateSeams._tryArrowCasePicker).mockResolvedValue("node");
    const directory = path.join(tmpPath(), "node-project");
    const record = backend();
    const result = await new CliRunner().invoke(cli, ["template", "deploy", directory], { input: "y\n" });
    expect(result.exit_code, result.output).toBe(0);
    expect(fs.readFileSync(path.join(directory, "template.yaml"), "utf8")).toContain("Node.js");
    expect(record).toHaveBeenCalledOnce();
  });

  it("JSON alone does not authorize project creation", async () => {
    const directory = path.join(tmpPath(), "json-unconfirmed");
    const record = backend();
    const result = await new CliRunner().invoke(cli, ["--json", "template", "deploy", directory]);
    expect(result.exit_code).toBe(2);
    expect(JSON.parse(result.stdout)["message"]).toContain("--yes/-y");
    expect(fs.existsSync(directory)).toBe(false);
    expect(record).not.toHaveBeenCalled();
  });

  it("yes never replaces a file with a directory", async () => {
    const target = path.join(tmpPath(), "not-a-directory");
    fs.writeFileSync(target, "keep original\n");
    const record = backend();
    const result = await new CliRunner().invoke(cli, ["template", "deploy", target, "-y"]);
    expect(result.exit_code).toBe(2);
    expect(fs.readFileSync(target, "utf8")).toBe("keep original\n");
    expect(record).not.toHaveBeenCalled();
  });

  it("declining project creation leaves the path absent", async () => {
    interactive();
    const directory = path.join(tmpPath(), "declined");
    const result = await new CliRunner().invoke(cli, ["template", "deploy", directory], { input: "n\n" });
    expect(result.exit_code).toBe(2);
    expect(fs.existsSync(directory)).toBe(false);
  });

  it.each([false, true])("declining overwrite preserves every existing file (force=%s)", async (force) => {
    interactive();
    const directory = tmpPath();
    fs.writeFileSync(path.join(directory, "Dockerfile"), "original dockerfile\n");
    fs.writeFileSync(path.join(directory, "notes.txt"), "keep me\n");
    const result = await new CliRunner().invoke(cli, ["template", "scaffold", "-t", "python", directory, ...(force ? ["--force"] : [])], { input: "n\n" });
    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("Dockerfile");
    expect(fs.readFileSync(path.join(directory, "Dockerfile"), "utf8")).toBe("original dockerfile\n");
    expect(fs.readFileSync(path.join(directory, "notes.txt"), "utf8")).toBe("keep me\n");
    expect(fs.existsSync(path.join(directory, "template.yaml"))).toBe(false);
  });

  it("confirmed replacement updates template files and preserves unrelated files", async () => {
    interactive();
    const directory = tmpPath();
    fs.writeFileSync(path.join(directory, "Dockerfile"), "old\n");
    fs.writeFileSync(path.join(directory, "notes.txt"), "keep\n");
    const result = await new CliRunner().invoke(cli, ["template", "scaffold", "-t", "python", directory], { input: "y\n" });
    expect(result.exit_code, result.output).toBe(0);
    expect(fs.readFileSync(path.join(directory, "Dockerfile"), "utf8")).toContain("FROM");
    expect(fs.readFileSync(path.join(directory, "notes.txt"), "utf8")).toBe("keep\n");
    expect(result.output).toContain("Replaced files:");
  });

  it("yes alone does not authorize replacement", async () => {
    interactive();
    const directory = tmpPath();
    fs.writeFileSync(path.join(directory, "Dockerfile"), "old\n");
    const result = await new CliRunner().invoke(cli, ["template", "scaffold", "-t", "python", directory, "-y"]);
    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("--force");
    expect(fs.readFileSync(path.join(directory, "Dockerfile"), "utf8")).toBe("old\n");
    expect(fs.existsSync(path.join(directory, "template.yaml"))).toBe(false);
  });

  it("force and yes still disclose existing entries before replacement", async () => {
    const directory = tmpPath();
    fs.writeFileSync(path.join(directory, "Dockerfile"), "old\n");
    const result = await new CliRunner().invoke(cli, ["template", "scaffold", "-t", "python", directory, "--force", "-y"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(result.stderr).toContain("Existing entries may be overwritten: Dockerfile");
    expect(fs.readFileSync(path.join(directory, "Dockerfile"), "utf8")).toContain("FROM");
  });

  it("declining addition to a nonempty directory preserves unrelated files", async () => {
    interactive();
    fs.writeFileSync(path.join(tmpPath(), "notes.txt"), "keep\n");
    const result = await new CliRunner().invoke(cli, ["template", "scaffold", "-t", "python", tmpPath()], { input: "n\n" });
    expect(result.exit_code).toBe(1);
    expect(fs.readdirSync(tmpPath())).toEqual(["notes.txt"]);
  });

  it("copying a local template can be declined before any destination write", async () => {
    interactive();
    const source = path.join(tmpPath(), "source");
    const target = path.join(tmpPath(), "target");
    fs.mkdirSync(source); fs.mkdirSync(target);
    fs.writeFileSync(path.join(source, "template.yaml"), manifestYaml("name: copied\nversion: '1.0.0'\n"));
    fs.writeFileSync(path.join(source, "Dockerfile"), "FROM python:3.12\n");
    fs.writeFileSync(path.join(target, "Dockerfile"), "original\n");
    const result = await new CliRunner().invoke(cli, ["template", "scaffold", "--from", source, target], { input: "n\n" });
    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("Overwrite these existing entries?");
    expect(fs.readFileSync(path.join(target, "Dockerfile"), "utf8")).toBe("original\n");
    expect(fs.existsSync(path.join(target, "template.yaml"))).toBe(false);
  });

  it("a directory at a scaffold file path fails before changing other files", async () => {
    fs.mkdirSync(path.join(tmpPath(), "README.md"));
    fs.writeFileSync(path.join(tmpPath(), "Dockerfile"), "original\n");
    const result = await new CliRunner().invoke(cli, ["template", "scaffold", "-t", "python", tmpPath(), "--force", "-y"]);
    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("Cannot replace directory or symbolic link");
    expect(fs.readFileSync(path.join(tmpPath(), "Dockerfile"), "utf8")).toBe("original\n");
    expect(fs.existsSync(path.join(tmpPath(), "template.yaml"))).toBe(false);
  });
});
