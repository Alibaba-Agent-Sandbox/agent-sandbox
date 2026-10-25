/** Exercise the shipped executable path, including parser validation before cloud calls. */
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { RUNTIME_DEPENDENCY_NOTICES } from "../../src/licenses/runtime_dependencies.js";
import { renderScaffold } from "../../src/cli/scaffold.js";
import { AICodegenError, DescriptionClarificationError, QwenCodeNotInstalledError } from "../../src/models/errors.js";

const home = mkdtempSync(path.join(os.tmpdir(), "abx-standard-"));
const entry = fileURLToPath(new URL("../../src/bin/abx.ts", import.meta.url));
const tsx = fileURLToPath(new URL("../../node_modules/tsx/dist/esm/index.mjs", import.meta.url));
afterAll(() => rmSync(home, { recursive: true, force: true }));

async function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["--import", tsx, entry, ...args], {
      cwd: home, timeout: 30_000,
      env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, NO_COLOR: "1", E2B_API_KEY: "placeholder", E2B_API_URL: "https://api.example.invalid", E2B_DOMAIN: "example.invalid" },
    }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") return reject(error);
      resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
    });
  });
}

describe("standard executable contract", () => {
  it.each([QwenCodeNotInstalledError, AICodegenError, DescriptionClarificationError])(
    "renders an executable Express recovery command for %s", async (ErrorType) => {
      const rendered = String(new ErrorType("generation unavailable"));
      const command = rendered.match(/'abx create <name> --detach'/)?.[0];
      expect(command, rendered).toBeDefined();
      const args = command!.slice(1, -1).split(" ").slice(1).map((arg) => arg === "<name>" ? "base" : arg);
      const result = await run([...args, "--timeout", "29"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("--timeout must be at least 30 seconds");
      expect(rendered).not.toContain("create --template");
    },
  );

  it("distinguishes registered platform templates from Registry source in create help", async () => {
    const result = await run(["create", "--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("registered platform template ID or alias");
    expect(result.stdout).toContain("For Git Registry source, use abx template launch SOURCE --yes");
  });

  it("keeps native template help explicit about platform references", async () => {
    const result = await run(["--native", "create", "--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Provider-native template reference");
    expect(result.stdout).toContain("already registered alias");
    expect(result.stdout).not.toContain("abx create python-hello");
  });

  it("makes AI retry explicit and accepts its prompt syntax", async () => {
    const suggestion = new AICodegenError("unavailable").suggestion;
    expect(suggestion).toContain('abx create --prompt "<description>"');
    const result = await run(["create", "--prompt", "a Python environment", "--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("--prompt");
    expect(result.stdout).toContain("qwen3-coder-plus");
    expect(result.stdout).not.toContain("qwen-coder-plus");
  });

  it.each(["python", "node", "minimal"])("generates a gated detached %s workflow", async (caseName) => {
    const readme = renderScaffold(caseName, "demo", "alicloud-express").get("README.md")!;
    const block = readme.match(/```bash\n([\s\S]*?)```/)?.[1];
    expect(block).toBeDefined();
    const trace = path.join(home, `deploy-failure-${caseName}.txt`);
    // Execute the generated shell block: a rejected deploy must prevent creation.
    const code = await new Promise<number>((resolve) => {
      execFile("sh", ["-c", `abx() { printf '%s\\n' "$*" >> "$ABX_TEST_TRACE"; return 7; }\n${block}`],
        { env: { PATH: process.env.PATH, ABX_TEST_TRACE: trace } }, (error) => resolve(typeof error?.code === "number" ? error.code : 0));
    });
    expect(code).toBe(7);
    expect(readFileSync(trace, "utf8").trim()).toBe("--provider alicloud-express template deploy .");
    const create = block!.split("\n").find((line) => line.includes(" create "))!;
    const result = await run([...create.trim().split(" ").slice(1), "--timeout", "29"]);
    expect(result.stderr).toContain("--timeout must be at least 30 seconds");
    expect(readme).toContain("kill SANDBOX_ID");
  });

  it("keeps other provider scaffolds on their own workflow", () => {
    const readme = renderScaffold("python", "demo", "opensandbox").get("README.md")!;
    expect(readme).toContain("abx --provider opensandbox create --help");
    expect(readme).not.toContain("abx --provider alicloud-express");
    expect(readme).not.toContain("abx template deploy");
  });

  it("retains identified package licenses and prebundled copyright notices", async () => {
    const sources = JSON.parse(readFileSync(new URL("../../vendor/e2b-cli/sources.json", import.meta.url), "utf8")) as Array<{ name: string; version: string; license: string }>;
    expect(sources.length).toBeGreaterThan(30);
    const licenses = await run(["--licenses"]);
    expect(licenses.code).toBe(0);
    const expected = readFileSync(new URL("../../LICENSE", import.meta.url), "utf8") + "\n" +
      readFileSync(new URL("../../NOTICE", import.meta.url), "utf8") + "\n" +
      readFileSync(new URL("../../src/standard_cli/THIRD_PARTY_NOTICES.txt", import.meta.url), "utf8") + RUNTIME_DEPENDENCY_NOTICES;
    expect(licenses.stdout).toBe(expected);
    expect(licenses.stdout).toContain("@alicloud/fcsandbox20260509@");
    expect(licenses.stdout).toContain("Copyright (c) 2009-present, Alibaba Cloud All rights reserved.");
    expect(licenses.stdout).not.toContain("undefined@undefined");
    for (const source of sources) {
      expect(source.name).toBeTypeOf("string");
      expect(source.version).toBeTypeOf("string");
      expect(source.license).toBeTypeOf("string");
      expect(licenses.stdout).toContain(`${source.name}@${source.version}`);
    }
    for (const name of ["@inquirer/prompts", "@inquirer/core", "inquirer", "signal-exit"]) {
      expect(sources.some((source) => source.name === name)).toBe(true);
    }
    const prebundled = JSON.parse(readFileSync(new URL("../../vendor/e2b-cli/prebundled-sources.json", import.meta.url), "utf8")) as { packages: Array<{name: string; version: string}> };
    for (const pkg of prebundled.packages) expect(licenses.stdout).toContain(`${pkg.name}@${pkg.version}`);
    expect(licenses.stdout).toContain("Copyright 2014-2020 Benjamin Tan");
    expect(licenses.stdout).toContain("Copyright(c) 2014 Jonathan Ong");
  });

  it("documents positional template, default base and detached creation", async () => {
    const result = await run(["sandbox", "create", "--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: abx sandbox create");
    expect(result.stdout).toContain("Defaults to base");
    expect(result.stdout).toContain("--detach");
    expect(result.stdout).toContain("--lifecycle.ontimeout");
  });

  it.each(["0", "-1", "29", "NaN", "Infinity"])("rejects invalid lifetime %s before creating a resource", async (timeout) => {
    const result = await run(["sandbox", "create", "base", "--detach", "--timeout", timeout]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--timeout must be at least 30 seconds");
    expect(result.stderr).not.toContain("fetch failed");
  });

  it("retains the exec pass-through option boundary", async () => {
    const result = await run(["sandbox", "exec", "--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Everything after the sandbox ID is passed through");
    for (const option of ["--background", "--cwd", "--user", "--env"]) expect(result.stdout).toContain(option);
  });

  it("routes explicit Express provider and standard group aliases", async () => {
    const result = await run(["sbx", "create", "--provider=alicloud-express", "--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: abx sandbox create");
  });

  it("offers standard list filters and output selection", async () => {
    const result = await run(["sandbox", "list", "--help"]);
    expect(result.code).toBe(0);
    for (const option of ["--state", "--metadata", "--limit", "--format"]) expect(result.stdout).toContain(option);
  });

  it("lists the standard template surface and explicit project extensions", async () => {
    const result = await run(["template", "--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("create");
    expect(result.stdout).toContain("from-image");
  });

  it.each(["python-sync", "python-async"])("initializes %s files using the project Python package", async (language) => {
    const name = `contract-${language}`;
    const result = await run(["template", "init", "--name", name, "--language", language]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("install agent-sandbox-client dependency");
    expect(result.stdout).not.toContain("install e2b dependency");
    expect(readFileSync(path.join(home, name, "template.py"), "utf8")).toContain("from agent_sandbox import");
    const readme = readFileSync(path.join(home, name, "README.md"), "utf8");
    expect(readme).toContain("agent-sandbox-client==0.4.0a4");
    expect(readme).toContain("from agent_sandbox import");
    expect(readme).not.toContain("from e2b import");
    expect(readme).toContain("ABX_SANDBOX_API_KEY=");
    expect(readme).toContain("ABX_SANDBOX_BASE_URL=");
    expect(readme).toContain("ABX_SANDBOX_DOMAIN=");
    expect(readme).not.toContain("E2B_API_KEY=");
    expect(readme).toContain("finally:");
    expect(readme).toContain("sandbox.kill()");
    expect(readme).not.toContain("python-sdk/archive/");
  });

  it("retains the external TypeScript package and configuration contract", async () => {
    const name = "contract-typescript";
    const result = await run(["template", "init", "--name", name, "--language", "typescript"]);
    expect(result.code, result.stderr).toBe(0);
    const readme = readFileSync(path.join(home, name, "README.md"), "utf8");
    expect(result.stdout).toContain("install e2b dependency");
    expect(readme).toContain("npm install e2b");
    expect(readme).toContain("E2B_API_KEY=");
    expect(readme).not.toContain("ABX_SANDBOX_API_KEY=");
  });

  it("routes template list with its fixed format option", async () => {
    const result = await run(["tpl", "list", "--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: abx template list");
    expect(result.stdout).toContain("--format");
  });
});
