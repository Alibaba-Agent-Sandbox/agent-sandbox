/** Exercise the shipped parser: removed aliases must not select a second implementation. */
import "../_support/isolatedHome.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cli } from "../../src/cli/main.js";
import { CliRunner } from "../helpers/cliRunner.js";
const run = (args: string[]) => new CliRunner().invoke(cli, args);
const groups = ["template", "config", "provider", "mcp"];
const platformCommands = ["exec", "connect", "upload", "download", "capabilities", "files", "process", "system", "pause", "resume", "metrics", "snapshot", "fork", "network"];
const commands = ["sandbox", "deploy", "list", "status", "logs", "delete", "recover", ...platformCommands];
describe("one command contract", () => {
  it("exposes the same root operations in help and both reference pages", async () => {
    expect(cli.listCommands().sort()).toEqual([...groups, ...commands].sort());
    const result = await run(["--help"]); expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("Commands:"); expect(result.stdout).not.toContain("alias:");
    for (const language of ["en", "zh"]) {
      const text = readFileSync(new URL(`../../docs/${language}/reference/cli-commands.md`, import.meta.url), "utf8");
      for (const name of [...groups, ...commands]) expect(text).toContain(`\`abx ${name}\``);
    }
  });
  it.each(["create", "info", "kill", "run", "app", "auth", "registry-command"])("rejects removed root %s", async name => {
    expect((await run([name, "--help"])).exit_code).toBe(2);
  });
  it.each(["launch", "deploy", "install", "scaffold", "search", "from-image", "delete", "push"])("rejects retired template %s", async name => {
    expect((await run(["template", name, "--help"])).exit_code).toBe(2);
  });
  it.each([["--native", "list"], ["mcp", "deploy", "--help"], ["sandbox", "command", "run", "id", "operation"], ["sandbox", "command", "list", "id"], ["provider", "show", "--help"]].map(args => ({args})))("rejects implementation selectors and duplicate paths %j", async ({args}) => {
    expect((await run(args)).exit_code).toBe(2);
  });
  it("retains advanced operations and separates command deadline from Sandbox lifetime", async () => {
    for (const name of platformCommands) expect((await run([name, "--help"])).exit_code, name).toBe(0);
    const deploy = await run(["deploy", "--help"]); expect(deploy.stdout).toContain("--sandbox-timeout"); expect(deploy.stdout).toContain("--build-timeout");
    expect((await run(["exec", "--help"])).stdout).toContain("--timeout");
  });
  it("keeps authoring and image-build options out of the instance deployment command", async () => {
    for (const option of ["--prompt", "--dockerfile", "--cpu", "--acr-namespace"]) {
      const result = await run(["deploy", option, "value", "--plan"]);
      expect(result.exit_code, option).toBe(2);
      expect(result.output).toContain("No such option");
    }
    expect((await run(["template", "init", "--help"])).stdout).toContain("--prompt");
    expect((await run(["template", "build", "--help"])).stdout).toContain("--build-profile");
  });
});
