/** Authoring has no implicit application lifecycle; artifacts and Git commits are reusable. */
import "../_support/isolatedHome.js";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { cli } from "../../src/cli/main.js";
import {deploymentSeams} from "../../src/cli/commands/deploy.js";
import {resourceDeploymentSeams} from "../../src/cli/resource_deployment.js";
import { snapshotTemplateSource } from "../../src/cli/template_build.js";
import { validateTemplateManifest } from "../../src/template/launch_plan.mjs";
import { renderScaffold } from "../../src/cli/scaffold.js";
import { TemplateIndex, TemplateIndexEntry } from "../../src/utils/template_index.js";
import * as index from "../../src/utils/template_index.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { useTmpPath } from "../helpers/templateSupport.js";

const tmp = useTmpPath(), run = (args: string[]) => new CliRunner().invoke(cli, args);
afterEach(() => vi.restoreAllMocks());
function project(name = "source", version = 5): string {
  const directory = path.join(tmp(), name); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "template.yaml"), `spec_version: ${version}\nname: example\nprovides: {}\n`);
  fs.writeFileSync(path.join(directory, "Dockerfile"), "FROM python:3.12-slim\n");
  return directory;
}

describe("template authoring", () => {
  it("rejects a missing source with initialization guidance before build work", async () => {
    const launch = vi.spyOn(deploymentSeams, "launch");
    const source = path.join(tmp(), "missing");
    const result = await run(["template", "build", source]);
    expect(result.exit_code).toBe(2);
    expect(result.output).toContain("abx template init DIRECTORY");
    expect(result.output).not.toContain("Unexpected error");
    expect(fs.existsSync(source)).toBe(false);
    expect(launch).not.toHaveBeenCalled();
  });
  it("lists and inspects catalog entries without a cloud template manager", async () => {
    vi.spyOn(index, "fetchIndex").mockResolvedValue(new TemplateIndex({ entries: [new TemplateIndexEntry({ name: "example", repo: "https://github.com/example/templates", path: "example", ref: "v1" })] }));
    const list = await run(["--json", "template", "list"]);
    expect(list.exit_code, list.output).toBe(0); expect(JSON.parse(list.stdout)[0].name).toBe("example");
    const info = await run(["--json", "template", "info", "example"]);
    expect(info.exit_code, info.output).toBe(0); expect(JSON.parse(info.stdout).source).toBe("example/templates//example@v1");
  });

  it.each([6, 999])("copies source with spec %s without deployment validation", async version => {
    const source = project("source", version), target = path.join(tmp(), "copied");
    const result = await run(["template", "init", target, "--from", source]);
    expect(result.exit_code, result.output).toBe(0);
    expect(fs.readFileSync(path.join(target, "template.yaml"))).toEqual(fs.readFileSync(path.join(source, "template.yaml")));
  });

  it("renders a deployable MCP service without embedding local secrets", () => {
    const files = renderScaffold("mcp", "my-mcp", "alicloud-express");
    const manifest = parse(files.get("template.yaml")!);
    expect(() => validateTemplateManifest(manifest)).not.toThrow();
    expect(manifest.provides.mcp).toMatchObject({ protocol: "http", port: 9000 });
    expect(manifest.start_cmd).toContain("uvicorn app:app");
    expect(manifest.env.ABX_SERVER_TOKEN).toBe("");
    expect(files.get("app.py")).toContain("require_auth_token");
    const json = files.get("README.md")!.split("```json\n")[1].split("\n```")[0];
    expect(JSON.parse(json).method).toBe("initialize");
  });

  it("builds local images through the public command without a cloud-preparation handoff", async () => {
    const source = project(), prepare = vi.spyOn(deploymentSeams, "launch");
    const build = vi.spyOn(resourceDeploymentSeams, "build").mockResolvedValue({status: "built", images: [{resource: "example", image_id: `sha256:${"a".repeat(64)}`, cached: false}], deferred: []});
    const result = await run(["--json", "template", "build", source]);
    expect(result.exit_code, result.output).toBe(0);expect(build).toHaveBeenCalledWith(path.join(source, "template.yaml"), {timeoutSeconds: 600, buildProfile: null});
    expect(prepare).not.toHaveBeenCalled();expect(JSON.parse(result.stdout)).toMatchObject({status: "built", images: [{resource: "example"}]});expect(result.output).not.toMatch(/build_file|journal|receipt/);
  });
  it("explains local-only construction and separate deployment in public build help", async () => {
    const result = await run(["template", "build", "--help"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("local Docker");
    expect(result.output).toContain("abx deploy");
    expect(result.output).not.toMatch(/--out\b|--clean\b|build\.json/);
  });
  it.each(["--out", "--clean", "--yes", "-y"])("rejects retired build option %s before preparation", async flag => {
    const source = project(), build = vi.spyOn(resourceDeploymentSeams, "build");
    const result = await run(["template", "build", source, flag, "private-build-file"]);
    expect(result.exit_code).toBe(2);expect(result.output).toContain("No such option");expect(build).not.toHaveBeenCalled();
  });

  it("rejects symlinked source before a build", () => {
    const source = project(); fs.symlinkSync(path.join(source, "Dockerfile"), path.join(source, "linked"));
    expect(() => snapshotTemplateSource(source, path.join(tmp(), "snapshot"))).toThrow(/Symlink/);
  });

  it("publishes a real Git commit once and refuses to replace its version", async () => {
    const source = project(), remote = path.join(tmp(), "remote.git");
    const git = (args: string[], cwd = source) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    git(["init"]); git(["config", "user.email", "fixture@example.invalid"]); git(["config", "user.name", "Fixture"]);
    git(["add", "."]); git(["commit", "-m", "fixture"]); git(["init", "--bare", remote]);
    git(["remote", "add", "origin", "https://github.com/example/templates.git"]);
    git(["config", `url.${remote}.insteadOf`, "https://github.com/example/templates.git"]);
    const commit = git(["rev-parse", "HEAD"]);
    const result = await run(["--json", "template", "publish", source, "--tag", "v1", "--yes"]);
    expect(result.exit_code, result.output).toBe(0); expect(JSON.parse(result.stdout).source).toBe(`example/templates@${commit}`);
    expect(git(["rev-parse", "refs/tags/v1"], remote)).toBe(commit);
    fs.appendFileSync(path.join(source, "Dockerfile"), "# changed\n"); git(["add", "."]); git(["commit", "-m", "change"]);
    const conflict = await run(["template", "publish", source, "--tag", "v1", "--yes"]);
    expect(conflict.exit_code).not.toBe(0); expect(git(["rev-parse", "refs/tags/v1"], remote)).toBe(commit);
  });
});
