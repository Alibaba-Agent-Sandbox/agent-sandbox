import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "../..");
const workflow = parse(readFileSync(join(root, ".github/workflows/release.yml"), "utf8"));
const steps = workflow.jobs.publish.steps as Array<{ name?: string; run?: string; with?: { ref?: string } }>;
const guard = steps.find((step) => step.name === "Require a matching version tag")!.run!;
const directories: string[] = [];
function temporary(): string {
  const directory = mkdtempSync(join(tmpdir(), "abx-release-workflow-"));
  directories.push(directory);
  return directory;
}
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

// The publisher runs on Ubuntu; these tests execute its actual shell and npm commands.
describe.skipIf(process.platform === "win32")("npm publication workflow", () => {
  it.each([
    ["release", "refs/tags/v0.4.0", "tag", "v0.4.0", true],
    ["workflow_dispatch", "refs/heads/main", "branch", "v0.4.0", true],
    ["workflow_dispatch", "refs/heads/main", "branch", "v0.3.0", false],
    ["release", "refs/heads/main", "branch", "v0.4.0", false],
    ["workflow_dispatch", "refs/heads/feature", "branch", "v0.4.0", false],
    ["workflow_dispatch", "refs/heads/main", "branch", "", false],
  ])("guards %s %s %s %s", (event, ref, refType, tag, allowed) => {
    const directory = temporary();
    writeFileSync(join(directory, "package.json"), JSON.stringify({ version: "0.4.0" }));
    const result = spawnSync("bash", ["-eu", "-c", guard], {
      cwd: directory,
      env: { ...process.env, GITHUB_EVENT_NAME: event as string, GITHUB_REF: ref as string,
        GITHUB_REF_TYPE: refType as string, SOURCE_TAG: tag as string, GITHUB_ENV: join(directory, "environment") },
      encoding: "utf8",
    });
    expect(result.status === 0).toBe(allowed);
    if (allowed) expect(readFileSync(join(directory, "environment"), "utf8")).toContain("NPM_DIST_TAG=latest");
  });

  it("checks out an existing tag even when recovery is dispatched from main", () => {
    expect(steps[0].with?.ref).toBe("refs/tags/${{ inputs.release_tag || github.ref_name }}");
    expect(workflow.on.workflow_dispatch.inputs.release_tag.required).toBe(true);
  });

  it("installs the actual local tarball using the publication command", () => {
    const directory = temporary();
    const source = join(directory, "fixture");
    const prefix = join(directory, "runner", "abx-candidate");
    mkdirSync(source);
    mkdirSync(join(directory, "dist-pack"));
    writeFileSync(join(source, "package.json"), JSON.stringify({ name: "abx-release-path-fixture", version: "1.0.0", files: ["marker.txt"] }));
    writeFileSync(join(source, "marker.txt"), "local tarball identity\n");
    const env = { ...process.env, RUNNER_TEMP: join(directory, "runner"), npm_config_audit: "false", npm_config_fund: "false" };
    execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", join(directory, "dist-pack")], { cwd: source, env, stdio: "pipe", timeout: 60_000 });
    const command = steps.find((step) => step.name === "Pack and install the exact publication artifact")!.run!
      .split("\n").find((line) => line.trimStart().startsWith("npm install --global"))!;
    execFileSync("bash", ["-eu", "-c", command], { cwd: directory, env, stdio: "pipe", timeout: 60_000 });
    expect(readFileSync(join(prefix, "lib/node_modules/abx-release-path-fixture/marker.txt"), "utf8")).toBe("local tarball identity\n");
  }, 120_000);
});
