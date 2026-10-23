/** Execute the recovery workflow's actual scripts with controlled registry responses. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflow = parse(readFileSync(resolve(import.meta.dirname, "../../.github/workflows/release.yml"), "utf8"));
const steps = workflow.jobs.publish.steps as Array<{ name?: string; run?: string; if?: string }>;
const guard = steps.find(step => step.name === "Check an existing immutable npm publication")!.run!;
const readback = steps.find(step => step.name === "Install from the public npm registry")!.run!;
const folders: string[] = [];
const bytes = "immutable tested candidate\n";
const integrity = "sha512-" + createHash("sha512").update(bytes).digest("base64");
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

function fixture(): string {
  const folder = mkdtempSync(join(tmpdir(), "abx-npm-recovery-"));
  folders.push(folder);
  mkdirSync(join(folder, "bin"));
  mkdirSync(join(folder, "dist-pack"));
  writeFileSync(join(folder, "package.json"), JSON.stringify({ name: "@agent-sandbox/cli", version: "0.4.8" }));
  writeFileSync(join(folder, "dist-pack/candidate.tgz"), bytes);
  return folder;
}

function executable(file: string, source: string): void {
  writeFileSync(file, source);
  chmodSync(file, 0o700);
}

describe.skipIf(process.platform === "win32")("immutable npm recovery", () => {
  it.each([
    [404, {}, 0, "false"],
    [200, { version: "0.4.8", dist: { integrity } }, 0, "true"],
    [200, { version: "0.4.8", dist: { integrity: "sha512-different" } }, 1, ""],
    [200, { version: "0.4.7", dist: { integrity } }, 1, ""],
    [200, { version: "0.4.8" }, 1, ""],
    [503, {}, 1, ""],
  ] as const)("handles HTTP %s and verified identity without republishing", (status, body, expected, published) => {
    const folder = fixture();
    executable(join(folder, "bin/node"), `#!${process.execPath}
const fs = require("node:fs");
globalThis.fetch = async (url, options) => {
  if (!url.startsWith("https://registry.npmjs.org/@agent-sandbox/cli/0.4.8?readback=") || options.redirect !== "error" || options.headers["Cache-Control"] !== "no-cache") throw new Error("unsafe metadata request");
  const status = Number(process.env.TEST_STATUS);
  return { status, ok: status === 200, json: async () => JSON.parse(process.env.TEST_BODY) };
};
import("data:text/javascript;base64," + Buffer.from(fs.readFileSync(0, "utf8")).toString("base64"));
`);
    const envFile = join(folder, "environment");
    const result = spawnSync("bash", ["-eu", "-c", guard], { cwd: folder, encoding: "utf8",
      env: { ...process.env, PATH: join(folder, "bin") + ":" + process.env.PATH,
        TEST_STATUS: String(status), TEST_BODY: JSON.stringify(body), GITHUB_ENV: envFile } });
    expect(result.status, result.stderr).toBe(expected);
    if (published) expect(readFileSync(envFile, "utf8")).toContain(`NPM_RELEASE_ALREADY_PUBLISHED=${published}`);
    else expect(existsSync(envFile)).toBe(false);
    expect(steps.find(step => step.name === "Publish the tested tarball with provenance")!.if)
      .toBe("env.NPM_RELEASE_ALREADY_PUBLISHED != 'true'");
  });
});

describe.skipIf(process.platform === "win32")("public registry readback retries", () => {
  it.each([false, true])("uses fresh online metadata and bounds permanent failure=%s", (permanentFailure) => {
    const folder = fixture();
    const trace = join(folder, "npm.jsonl");
    const checked = join(folder, "checked");
    mkdirSync(join(folder, "scripts"));
    writeFileSync(join(folder, "scripts/check-release-artifact.mjs"), 'import { writeFileSync } from "node:fs"; writeFileSync(process.env.TEST_CHECKED, "checked");');
    executable(join(folder, "bin/npm"), `#!${process.execPath}
const fs = require("node:fs");
const trace = process.env.TEST_TRACE;
fs.appendFileSync(trace, JSON.stringify(process.argv.slice(2)) + "\\n");
const count = fs.readFileSync(trace, "utf8").trim().split("\\n").length;
process.exit(process.env.TEST_PERMANENT === "true" || count < 3 ? 1 : 0);
`);
    executable(join(folder, "bin/sleep"), "#!/bin/sh\nexit 0\n");
    const result = spawnSync("bash", ["-eu", "-c", readback], { cwd: folder, encoding: "utf8", timeout: 30_000,
      env: { ...process.env, PATH: join(folder, "bin") + ":" + process.env.PATH, RUNNER_TEMP: folder,
        TEST_TRACE: trace, TEST_CHECKED: checked, TEST_PERMANENT: String(permanentFailure) } });
    expect(result.status, result.stderr).toBe(permanentFailure ? 1 : 0);
    expect(workflow.jobs.publish.steps.find((step: { name?: string }) => step.name === "Install from the public npm registry")["timeout-minutes"]).toBe(10);
    const calls = readFileSync(trace, "utf8").trim().split("\n").map(line => JSON.parse(line) as string[]);
    expect(calls).toHaveLength(permanentFailure ? 30 : 3);
    expect(existsSync(checked)).toBe(!permanentFailure);
    expect(new Set(calls.map(args => args[args.indexOf("--cache") + 1])).size).toBe(calls.length);
    for (const args of calls) expect(args).toContain("--prefer-online");
  });
});
