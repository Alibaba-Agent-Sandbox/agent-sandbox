import "../_support/isolatedHome.js";

import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cli } from "../../src/cli/main.js";
import { templateSeams } from "../../src/cli/template_catalog.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { useTmpPath } from "../helpers/templateSupport.js";

const tmpPath = useTmpPath();
afterEach(() => vi.restoreAllMocks());

function interactive(): void {
  vi.spyOn(templateSeams, "_scaffoldPickerAvailable").mockReturnValue(true);
  vi.spyOn(templateSeams, "_tryArrowCasePicker").mockResolvedValue("python");
}

describe("Template project onboarding", () => {
  it.each([["deploy"], ["template", "deploy"], ["template", "build"]])("guides missing paths without surprise writes: %s", async (...prefix) => {
    const directory = path.join(tmpPath(), "dev-services");
    const result = await new CliRunner().invoke(cli, [...prefix, directory, "-y"]);
    expect(result.exit_code, result.output).toBe(2);
    expect(result.output).toContain("abx template scaffold");
    expect(result.output).toContain("https://registry.agent-sandbox.cn/templates/");
    expect(fs.existsSync(directory)).toBe(false);
  });

  it.each([["deploy"], ["template", "deploy"]])("can create a missing project for review: %s", async (...prefix) => {
    interactive();
    const directory = path.join(tmpPath(), "dev-services");
    const result = await new CliRunner().invoke(cli, [...prefix, directory], { input: "y\n" });
    expect(result.exit_code, result.output).toBe(0);
    expect(fs.readFileSync(path.join(directory, "template.yaml"), "utf8")).toContain("dev-services");
    expect(fs.existsSync(path.join(directory, "Dockerfile"))).toBe(true);
    expect(result.output).toContain("Review the generated files, then deploy:");
    expect(result.output).not.toContain("credentials missing");
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
    fs.writeFileSync(path.join(source, "template.yaml"), "name: copied\nversion: '1.0.0'\n");
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
