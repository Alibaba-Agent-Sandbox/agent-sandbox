/** Authoring has no implicit application lifecycle; artifacts and Git commits are reusable. */
import "../_support/isolatedHome.js";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { cli } from "../../src/cli/main.js";
import { templateBuildSeams, snapshotTemplateSource } from "../../src/cli/template_build.js";
import { ResourceJournal } from "../../src/template/resource_journal.js";
import { withApplicationLock } from "../../src/application/lock.js";
import { paths } from "../../src/transport/config_layers.js";
import { sourceDigest } from "../../src/application/config.js";
import { normalizeProjectIntent } from "../../src/template/definition.mjs";
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
    const launch = vi.spyOn(templateBuildSeams, "launch");
    const source = path.join(tmp(), "missing");
    const result = await run(["template", "build", source, "--yes"]);
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
    expect(() => normalizeProjectIntent(manifest)).not.toThrow();
    expect(manifest.sandbox.services.mcp).toMatchObject({ protocol: "http", port: 9000 });
    expect(manifest.sandbox.start).toContain("uvicorn app:app");
    expect(manifest.sandbox.instance.envs.ABX_SERVER_TOKEN).toBe("");
    expect(files.get("app.py")).toContain("require_auth_token");
    const json = files.get("README.md")!.split("```json\n")[1].split("\n```")[0];
    expect(JSON.parse(json).method).toBe("initialize");
  });

  it("freezes source and a reusable prepared artifact without creating an application", async () => {
    const source = project(), output = path.join(tmp(), "build.json");
    fs.writeFileSync(path.join(source, ".env"), "PLACEHOLDER=private\n");
    fs.writeFileSync(path.join(source, "start.sh"), "#!/bin/sh\necho ok\n", { mode: 0o755 });
    fs.chmodSync(path.join(source, "start.sh"), 0o755);
    const prepare = vi.spyOn(templateBuildSeams, "launch").mockImplementation(async (_ctx, params, options) => {
      expect(options?.prepareOnly).toBe(true);
      expect(fs.existsSync(path.join(String(params.template_ref), ".env"))).toBe(false);
      return { receipt: { kind: "SandboxTemplateBuild", version: 1, prepared: { template: "built" }, journal_id: "build-journal", target: { provider: "alicloud-express" } }, creation: {} };
    });
    const result = await run(["--json", "template", "build", source, "--out", output, "--yes"]);
    expect(result.exit_code, result.output).toBe(0); expect(prepare).toHaveBeenCalledOnce();
    const artifact = JSON.parse(fs.readFileSync(output, "utf8"));
    expect(artifact).toMatchObject({ status: "ready", prepared: { template: "built" }, target: { provider: "alicloud-express" } });
    expect(artifact.sourceDigest).toBe(sourceDigest(artifact.projectRoot));
    fs.writeFileSync(path.join(source, "Dockerfile"), "changed");
    expect(artifact.sourceDigest).toBe(sourceDigest(artifact.projectRoot));
    if (process.platform !== "win32") {
      expect(fs.statSync(artifact.projectRoot).mode & 0o777).toBe(0o700);
      expect(fs.statSync(path.join(artifact.projectRoot, "start.sh")).mode & 0o777).toBe(0o755);
    }
    const again = await run(["template", "build", source, "--out", output, "--yes"]);
    expect(again.exit_code).not.toBe(0); expect(prepare).toHaveBeenCalledOnce();
  });

  it("retains failed preparation and only cleans an unused artifact", async () => {
    const source = project(), output = path.join(tmp(), "failed-build.json");
    vi.spyOn(templateBuildSeams, "launch").mockImplementation(async (_ctx, _params, options) => {
      options?.onTarget?.({ provider: "alicloud-express", providerOptions: {}, connection: {} });
      options?.onJournal?.(new ResourceJournal("alicloud-express", "fixture"));
      throw new Error("preparation failed");
    });
    const failed = await run(["template", "build", source, "--out", output, "--yes"]);
    expect(failed.exit_code).not.toBe(0);
    const artifact = JSON.parse(fs.readFileSync(output, "utf8"));
    expect(artifact).toMatchObject({ status: "requires_reconcile", target: { provider: "alicloud-express" } });
    expect(artifact.journal_file).toContain(artifact.journal_id);
    const cleanup = vi.spyOn(templateBuildSeams, "cleanup").mockResolvedValue({ complete: true, failures: [], retained: [{ kind: "image", cleanup: "manual" }] });
    fs.writeFileSync(output, JSON.stringify({ ...artifact, consumers: ["running-app"] }));
    expect((await run(["template", "build", "--clean", output, "--yes"])).exit_code).not.toBe(0);
    expect(cleanup).not.toHaveBeenCalled();
    fs.writeFileSync(output, JSON.stringify(artifact));
    await withApplicationLock(path.join(paths.abxDir, "template-build-locks"), fs.realpathSync(output), async () => {
      const locked = await run(["template", "build", "--clean", output, "--yes"]);
      expect(locked.exit_code).not.toBe(0); expect(locked.output).toContain("locked by another operation");
      expect(cleanup).not.toHaveBeenCalled();
    });
    const cleaned = await run(["--json", "template", "build", "--clean", output, "--yes"]);
    expect(cleaned.exit_code, cleaned.output).toBe(0);
    expect(JSON.parse(cleaned.stdout)).toMatchObject({ status: "cleaned", retained: [{ kind: "image" }] });
    expect(JSON.parse(fs.readFileSync(output, "utf8")).status).toBe("cleaned");
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
