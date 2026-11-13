/** Shipped entry checks: the protocol SDK has no command parser of its own. */
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { RUNTIME_DEPENDENCY_NOTICES } from "../../src/licenses/runtime_dependencies.js";

const home = mkdtempSync(path.join(os.tmpdir(), "abx-single-cli-"));
const entry = fileURLToPath(new URL("../../src/bin/abx.ts", import.meta.url));
const tsx = fileURLToPath(new URL("../../node_modules/tsx/dist/esm/index.mjs", import.meta.url));
afterAll(() => rmSync(home, { recursive: true, force: true }));
async function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => execFile(process.execPath, ["--import", tsx, entry, ...args], {
    cwd: home, timeout: 30000, env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, NO_COLOR: "1" },
  }, (error, stdout, stderr) => {
    if (error && typeof error.code !== "number") return reject(error);
    resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
  }));
}
describe("single executable contract", () => {
  it.each(["create", "delete", "pause", "resume", "metrics", "snapshot", "fork", "network", "exec", "connect", "files", "process", "command", "system"])("exposes native %s capability", async name => {
    const result = await run(["sandbox", name, "--help"]);
    expect(result.code, result.stderr).toBe(0); expect(result.stdout).toContain("Usage:");
  });
  it.each(["list", "info", "kill", "logs"])("has no duplicate sandbox %s management entry", async name => {
    expect((await run(["sandbox", name, "--help"])).code).toBe(2);
  });
  it.each(["--json", "--quiet", "--verbose", "--no-color"])("uses the root %s option for protocol operations", async flag => {
    const result = await run([flag, "sandbox", "metrics", "--help"]);
    expect(result.code, result.stderr).toBe(0);
  });
  it("rejects the retired parser switch", async () => { expect((await run(["--native", "config", "get", "region"])).code).toBe(2); });
  it("retains actual bundled package licenses and upstream terminal attribution", async () => {
    const sources = JSON.parse(readFileSync(new URL("../../vendor/e2b-cli/sources.json", import.meta.url), "utf8")) as Array<{ name: string; version: string }>;
    const licenses = await run(["--licenses"]); expect(licenses.code).toBe(0);
    expect(licenses.stdout).toBe(readFileSync(new URL("../../LICENSE", import.meta.url), "utf8") + "\n" + readFileSync(new URL("../../NOTICE", import.meta.url), "utf8") + "\n" + readFileSync(new URL("../../src/standard_cli/THIRD_PARTY_NOTICES.txt", import.meta.url), "utf8") + RUNTIME_DEPENDENCY_NOTICES);
    for (const source of sources) expect(licenses.stdout).toContain(`${source.name}@${source.version}`);
    expect(licenses.stdout).toContain("@e2b/cli@2.20.0"); expect(licenses.stdout).toContain("Redistribution and use");
    expect(sources.some(source => source.name === "commander")).toBe(false);
  });
});
