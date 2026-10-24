import fs from "node:fs";
import path from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { useIso } from "../_support/iso.js";
import { materializeSourceRecipe } from "../../src/providers/shared/source_recipe.js";
import { ProjectToolError, runTool, stageProject } from "../../src/providers/shared/project.js";

const iso = useIso();
const commit = "e2cb27e24fde0a67112f82b8d44af463445a5d1a";
const base = "fc-e2b-registry.<region>.cr.aliyuncs.com/runtime/base:<tag>";
const recipe = `# syntax=docker/dockerfile:1\nFROM ${base}\nCOPY *.whl /tmp/\nRUN if ls /tmp/*.whl; then pip install /tmp/*.whl; else pip install "https://github.com/Alibaba-Agent-Sandbox/python-sdk/archive/${commit}.tar.gz#subdirectory=server-sdk"; fi\nCOPY --chown=user:user commands.py /home/user/app/\nUSER user\n`;
beforeEach(() => {
  vi.stubEnv("ABX_BASE_IMAGE_REGION", ""); vi.stubEnv("ABX_BASE_IMAGE_TAG", "");
  vi.stubEnv("ALIBABA_CLOUD_REGION_ID", "unrelated-runtime-region");
});

it("builds the exact server source using Docker and retains the application instructions and non-root user", () => {
  const materialized = materializeSourceRecipe(recipe);
  expect(materialized).toMatch(/^# syntax=docker\/dockerfile:1\nFROM fc-e2b-registry.cn-hangzhou.cr.aliyuncs.com\/runtime\/base:v0.0.49 AS abx-server-wheel\n/);
  expect(materialized).toContain(`pip wheel --no-deps --wheel-dir /abx-wheels "https://github.com/Alibaba-Agent-Sandbox/python-sdk/archive/${commit}.tar.gz#subdirectory=server-sdk"`);
  expect(materialized).toContain("COPY --from=abx-server-wheel /abx-wheels/*.whl /tmp/");
  expect(materialized.endsWith(recipe.slice(recipe.indexOf("RUN if")))).toBe(true);
  expect(materializeSourceRecipe(materialized)).toBe(materialized);
});

it("only resolves placeholders in the official FROM and honors explicit base overrides", () => {
  vi.stubEnv("ABX_BASE_IMAGE_REGION", "cn-shanghai"); vi.stubEnv("ABX_BASE_IMAGE_TAG", "v0.0.50");
  const result = materializeSourceRecipe(`${recipe}RUN echo '<region> <tag>'\n`);
  expect(result).toContain("FROM fc-e2b-registry.cn-shanghai.cr.aliyuncs.com/runtime/base:v0.0.50");
  expect(result).toContain("RUN echo '<region> <tag>'");
  const custom = recipe.replace(base, "my-registry/<region>:<tag>");
  expect(materializeSourceRecipe(custom)).toBe(custom);
});

it("preserves user-supplied wheels and explicitly selected portable recipes", () => {
  const existing = materializeSourceRecipe(recipe, { hasWheels: true });
  expect(existing).toContain("COPY *.whl /tmp/"); expect(existing).not.toContain(" AS abx-server-wheel");
  const portable = recipe.replace(base, "python:3.12-slim");
  expect(materializeSourceRecipe(portable)).toBe(portable);
});

it("rejects mutable, conflicting or mismatched server source before a build", () => {
  expect(() => materializeSourceRecipe(recipe.replace(commit, "main"))).toThrow("exact python-sdk commit");
  expect(() => materializeSourceRecipe(recipe, { serverCommit: "a".repeat(40) + "\n" })).toThrow("same 40-character commit");
  expect(() => materializeSourceRecipe(recipe, { serverCommit: commit })).toThrow("followed by a newline");
  expect(() => materializeSourceRecipe(recipe + recipe.replaceAll(commit, "a".repeat(40)))).toThrow("exact python-sdk commit");
  expect(materializeSourceRecipe(recipe, { serverCommit: commit + "\n" })).toContain("COPY --from=");
});

it("avoids alias collisions and refuses to change custom multi-stage wheel semantics", () => {
  expect(materializeSourceRecipe(recipe.replace(base, `${base} AS abx-server-wheel`))).toContain(" AS abx-server-wheel-build\n");
  expect(() => materializeSourceRecipe(recipe + "FROM python:3.12-slim\n")).toThrow("single-stage official Dockerfile");
});

it("does not interpret Python imports or embedded Docker text in a heredoc as build instructions", () => {
  const heredoc = "RUN python3 - <<'NODE'\nfrom pathlib import Path\nprint('''\nFROM other:tag\nCOPY *.whl /tmp/\n''')\nNODE\n";
  const input = recipe.replace("COPY *.whl /tmp/\n", heredoc + "COPY *.whl /tmp/\n");
  const result = materializeSourceRecipe(input);
  expect(result).toContain(heredoc);
  expect(result).toContain("COPY --from=abx-server-wheel /abx-wheels/*.whl /tmp/");
});

it("freezes effective build inputs while leaving the checkout untouched", async () => {
  const directory = path.join(iso.root, "source"); fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "Dockerfile"), recipe);
  fs.writeFileSync(path.join(directory, "commands.py"), "print('hello')\n");
  fs.writeFileSync(path.join(directory, "server-sdk.commit"), commit + "\n");
  const stage = await stageProject(directory);
  try {
    expect(fs.readFileSync(path.join(directory, "Dockerfile"), "utf8")).toBe(recipe);
    expect(fs.readFileSync(path.join(stage.directory, "Dockerfile"), "utf8")).toContain("COPY --from=");
    await stage.verify();
    fs.appendFileSync(path.join(stage.directory, "Dockerfile"), "RUN echo changed\n");
    await expect(stage.verify()).rejects.toThrow("snapshot changed");
  } finally { await stage.close(); }
  expect(fs.existsSync(stage.directory)).toBe(false);
});

it("fails unresolved third-party inputs without selecting another Dockerfile", async () => {
  const directory = path.join(iso.root, "source"); fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "Dockerfile"), "FROM third-party:<version>\n");
  fs.writeFileSync(path.join(directory, "Dockerfile.portable"), "FROM python:3.12-slim\n");
  await expect(stageProject(directory)).rejects.toThrow("unresolved base image");
  const stage = await stageProject(directory, { dockerfile: "Dockerfile.portable" });
  try { expect(fs.readFileSync(path.join(stage.directory, "Dockerfile.portable"), "utf8")).toBe("FROM python:3.12-slim\n"); }
  finally { await stage.close(); }
});

it("reports the failed tool phase without copying arguments, output or private error text", async () => {
  const error = Object.assign(new Error("private-fixture-value"), { code: "ENOENT" });
  expect(new ProjectToolError("docker", "build", error).message).toBe("Docker build is not installed or is not on PATH. Check the tool installation, image registry access and provider configuration.");
  expect(new ProjectToolError("docker", "private-fixture-value", error).message).not.toContain("private-fixture-value");
  await expect(runTool(process.execPath, ["-e", "process.stderr.write('private-fixture-value'); process.exit(1)"])).rejects.toThrow("Project preparation tool failed");
});
