import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// Run the exact workflow script with controlled registry responses, including sensitive error text.
describe.skipIf(process.platform === "win32")("read-only npm credential diagnostics", () => {
  const job = workflow.jobs.diagnose;
  const command = job.steps.find((step: { run?: string }) => step.run)?.run;

  it("excludes publication on diagnostic requests and grants no OIDC permission", () => {
    expect(job.if).toBe("github.event_name == 'workflow_dispatch' && inputs.diagnostics_only");
    expect(workflow.jobs.publish.if).toBe("github.event_name != 'workflow_dispatch' || !inputs.diagnostics_only");
    expect(job.permissions).toEqual({ contents: "read" });
    expect(workflow.on.workflow_dispatch.inputs.diagnostics_only.default).toBe(false);
  });

  it.each(["valid", "rejected", "missing", "scope-denied", "malformed"])("reports %s credentials without leaking upstream data", (mode) => {
    const directory = temporary();
    const executable = join(directory, "npm");
    writeFileSync(executable, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.DIAGNOSTIC_CALLS, JSON.stringify(args) + '\\n');
if (process.env.DIAGNOSTIC_MODE === 'rejected') {
  console.log(JSON.stringify({error:{code:'E401',message:'private-account sentinel-credential'}}));
  console.error('private-account sentinel-credential');
  process.exit(1);
}
if (process.env.DIAGNOSTIC_MODE === 'malformed') {
  console.log('private-account sentinel-credential');
  process.exit(0);
}
if (process.env.DIAGNOSTIC_MODE === 'scope-denied' && args[0] !== 'whoami') {
  console.log(JSON.stringify({error:{code:args[0] === 'org' ? 'E403' : 'E404',message:'private-account sentinel-credential'}}));
  process.exit(1);
}
if (args[0] === 'whoami') console.log(JSON.stringify('private-account'));
else if (args[0] === 'org' && args[1] === 'ls') console.log(JSON.stringify({'private-account':'developer','other-private-member':'owner'}));
else if (args[0] === 'access' && args[1] === 'list' && args[2] === 'packages') console.log(JSON.stringify({'@agent-sandbox/cli':'read-write','@private/package':'read-only'}));
else process.exit(2);
`);
    chmodSync(executable, 0o755);
    const callsFile = join(directory, "calls");
    const result = spawnSync("bash", ["-eu", "-c", command], {
      cwd: directory, encoding: "utf8", timeout: 30_000,
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, NODE_AUTH_TOKEN: mode === "missing" ? "" : "sentinel-credential",
        DIAGNOSTIC_MODE: mode, DIAGNOSTIC_CALLS: callsFile },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    for (const sensitive of ["private-account", "sentinel-credential", "other-private-member", "@private/package"]) {
      expect(result.stdout).not.toContain(sensitive);
    }
    const report = JSON.parse(result.stdout.slice(0, result.stdout.lastIndexOf("}") + 1));
    expect(report.credential_present).toBe(mode !== "missing");
    expect(report.identity_authenticated).toBe(["valid", "scope-denied"].includes(mode));
    if (mode === "valid") {
      expect(report.organization_membership).toBe("confirmed");
      expect(report.target_package_access).toBe("read-write");
    } else if (mode === "scope-denied") {
      expect(report.organization_membership).toBe("unknown");
      expect(report.organization_check_error).toBe("E403");
      expect(report.target_package_access).toBe("unknown");
      expect(report.package_check_error).toBe("E404");
    } else if (mode === "rejected") expect(report.identity_error).toBe("E401");
    else if (mode === "malformed") expect(report.identity_error).toBe("UNKNOWN_ERROR");
    if (mode !== "missing") {
      const calls: string[][] = readFileSync(callsFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(calls.map((args) => args[0])).toEqual(["valid", "scope-denied"].includes(mode) ? ["whoami", "org", "access"] : ["whoami"]);
      expect(calls.every((args) => args.includes("--logs-max=0") && args.includes("--registry=https://registry.npmjs.org"))).toBe(true);
    }
  });
});
