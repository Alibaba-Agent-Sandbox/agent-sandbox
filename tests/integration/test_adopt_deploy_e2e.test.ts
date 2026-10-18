/**
 * Offline end-to-end: `abx template scaffold --adopt` then `abx deploy`.
 *
 * The coding agent is the real `QwenCodeBackend`, with only the `qwen` subprocess replaced. Docker, ACR and
 * `CreateTemplate` are mocked. The assertions are the ones a real publish depends on: the registered payload matches
 * the `template.yaml` that `--adopt` wrote, the user's source and secrets are unchanged, and deploy makes no second
 * model call.
 *
 * Port of `tests/integration/test_adopt_deploy_e2e.py`. Like its Python original this file is NOT marked as a live
 * integration test (no credentials, no network), so it also runs under the default `npm test`. A live Qwen Code +
 * Docker run is still manual.
 */

import "../_support/isolatedHome.js";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse as yamlParse } from "yaml";

import * as fcTemplate from "../../src/providers/alicloud_express/fc_template.js";
import { QwenCodeBackend } from "../../src/agent/coding_agent.js";
import * as qwenCode from "../../src/agent/qwen_code.js";
import { QwenCodeCredentials, QwenCodeRunResult, scrubbedEnviron } from "../../src/agent/qwen_code.js";
import * as codingAgent from "../../src/cli/commands/_coding_agent.js";
import { codingAgentSeams } from "../../src/cli/commands/_coding_agent.js";
import { cli } from "../../src/cli/main.js";
import { DockerIgnore } from "../../src/utils/dockerignore.js";
import { CliRunner, type Result } from "../helpers/cliRunner.js";
import { fakeConfig, patchLoadConfig, setenv, spyAny, useMockBuilder, useTmpPath } from "../helpers/templateSupport.js";

const tmpPath = useTmpPath();
const mockBuilder = useMockBuilder();

const _CREDS = new QwenCodeCredentials({
  source: "qwen-stored",
  apiKey: "sk-test",
  baseUrl: "https://dashscope.example/compatible-mode/v1",
  model: "qwen3-coder-plus",
});

const _COMMANDS = `\
from agent_sandbox.server import CommandRegistry, SandboxServer

registry = CommandRegistry()
registry.freeze()
if __name__ == "__main__":
    SandboxServer(registry=registry).serve(port=9000)
`;

const _LEAKS: Record<string, string> = {
  ALICLOUD_ACCESS_KEY_ID: "LTAI-leak",
  E2B_API_KEY: "e2b-leak",
  ACR_PASSWORD: "acr-leak",
  AWS_SECRET_ACCESS_KEY: "aws-leak",
  GITHUB_TOKEN: "gh-leak",
};

interface Sample {
  name: string;
  hint: string;
  files: Record<string, string>;
  copy: string[];
  cpu: number;
  memory: number;
  generation: number;
}

const _SAMPLES: Record<string, Sample> = {
  flask: {
    name: "flask-api",
    hint: "the API listens on 8080",
    files: {
      "app.py": "print('hello from flask')\n",
      "requirements.txt": "flask==3.0.0\n",
      ".env": "APP_TOKEN=placeholder-not-real\n",
    },
    copy: ["app.py", "requirements.txt"],
    cpu: 4,
    memory: 4096,
    generation: 2,
  },
  express: {
    name: "express-api",
    hint: "the server listens on 3000",
    files: {
      "index.js": "console.log('hello from express')\n",
      "package.json": '{"name":"web","version":"1.0.0"}\n',
      ".env": "APP_TOKEN=placeholder-not-real\n",
    },
    copy: ["index.js", "package.json"],
    cpu: 2,
    memory: 2048,
    generation: 1,
  },
};

const _text = (result: Result): string => (result.output || "") + (result.stderr || "");

function _dockerfile(sources: string[]): string {
  const copies = sources.map((name) => `COPY ${name} .`).join("\n");
  return (
    "FROM python:3.12-slim\n" +
    "COPY *.whl /tmp/\n" +
    "RUN pip install --no-cache-dir agent-sandbox\n" +
    "WORKDIR /app\n" +
    "COPY commands.py .\n" +
    `${copies}\n` +
    "EXPOSE 9000\n"
  );
}

function _templateYaml(sample: Sample): string {
  return (
    "name: ignored-by-cli\n" +
    'version: "1.0.0"\n' +
    `description: ${sample.name} demo\n` +
    "capabilities: [shell, files, ports]\n" +
    "ports: [9000]\n" +
    `generation: ${sample.generation}\n` +
    "resources:\n" +
    `  cpu: ${sample.cpu}\n` +
    `  memory: ${sample.memory}\n`
  );
}

/** `_no_staging_left_behind`. */
afterEach(() => {
  const root = fs.realpathSync(os.tmpdir());
  for (const name of fs.readdirSync(root)) {
    if (name.startsWith(`abx-adopt-${process.pid}`)) fs.rmSync(path.join(root, name), { recursive: true, force: true });
  }
});

interface Seen {
  calls: number;
  prompt?: string;
  clean_env?: boolean;
  max_session_turns?: number | null;
  cwd?: string;
  child_env?: Record<string, string>;
  staged_files?: string[];
}

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out.sort();
}

const savedResolver = codingAgentSeams.resolveBackend;
const savedHeadless = qwenCode.seams.runQwenCodeHeadless;
afterEach(() => {
  codingAgentSeams.resolveBackend = savedResolver;
  qwenCode.seams.runQwenCodeHeadless = savedHeadless;
});

/** Real backend; the qwen subprocess writes a valid template into cwd. */
function _agent(sample: Sample): Seen {
  const seen: Seen = { calls: 0 };
  qwenCode.seams.runQwenCodeHeadless = (async (prompt: string, opts: qwenCode.RunHeadlessOptions = {}) => {
    seen.calls += 1;
    seen.prompt = prompt;
    seen.clean_env = Boolean(opts.cleanEnv);
    seen.max_session_turns = opts.maxSessionTurns ?? null;
    const cwd = String(opts.cwd);
    seen.cwd = cwd;
    seen.child_env = opts.cleanEnv ? { ...scrubbedEnviron(), ...(opts.env ?? {}) } : { ...(opts.env ?? {}) };
    seen.staged_files = listFiles(cwd);
    fs.writeFileSync(path.join(cwd, "Dockerfile"), _dockerfile(sample.copy), "utf-8");
    fs.writeFileSync(path.join(cwd, "commands.py"), _COMMANDS, "utf-8");
    fs.writeFileSync(path.join(cwd, "template.yaml"), _templateYaml(sample), "utf-8");
    fs.writeFileSync(path.join(cwd, "README.md"), "written by the agent\n", "utf-8");
    return new QwenCodeRunResult({ text: "done", isError: false, exitCode: 0 });
  }) as typeof qwenCode.seams.runQwenCodeHeadless;
  codingAgentSeams.resolveBackend = () => new QwenCodeBackend();
  vi.spyOn(codingAgent, "ensureCodingAgentBinary").mockResolvedValue("qwen");
  vi.spyOn(codingAgent, "resolveCodingAgentCredentials").mockResolvedValue(_CREDS as never);
  return seen;
}

function _project(kind: string, sample: Sample): string {
  const project = path.join(tmpPath(), kind);
  fs.mkdirSync(project, { recursive: true });
  for (const [name, text] of Object.entries(sample.files)) fs.writeFileSync(path.join(project, name), text, "utf-8");
  return project;
}

const read = (p: string): string => fs.readFileSync(p, "utf-8");

beforeEach(() => {
  for (const [key, value] of Object.entries(_LEAKS)) setenv(key, value);
});

it.each(Object.keys(_SAMPLES).sort())("test_adopt_then_deploy_registers_the_written_template [%s]", async (kind) => {
  const sample = _SAMPLES[kind]!;
  const project = _project(kind, sample);
  const before = Object.fromEntries(Object.keys(sample.files).map((name) => [name, read(path.join(project, name))]));
  const seen = _agent(sample);

  const adopted = await new CliRunner().invoke(cli, ["template", "scaffold", "--adopt", project, "--name", sample.name, "--hint", sample.hint, "-y"]);
  expect(adopted.exit_code, _text(adopted)).toBe(0);
  expect(seen.calls).toBe(1);
  expect(seen.clean_env).toBe(true);
  expect(seen.max_session_turns).toBe(40);
  expect(seen.cwd).not.toBe(project);
  expect(path.basename(seen.cwd!).startsWith("abx-adopt-")).toBe(true);
  expect(seen.prompt).toContain(sample.hint);
  expect(seen.prompt).not.toMatch(/(?<![A-Za-z0-9_])\.env(?![A-Za-z])/);
  expect(seen.staged_files).not.toContain(".env");
  for (const source of sample.copy) expect(seen.staged_files).toContain(source);
  for (const [key, value] of Object.entries(_LEAKS)) {
    expect(Object.keys(seen.child_env!)).not.toContain(key);
    expect(Object.values(seen.child_env!)).not.toContain(value);
  }
  expect(seen.child_env!["OPENAI_API_KEY"]).toBe("sk-test");

  for (const [name, text] of Object.entries(before)) expect(read(path.join(project, name))).toBe(text);
  expect(fs.existsSync(path.join(project, "README.md"))).toBe(false);
  const manifest = yamlParse(read(path.join(project, "template.yaml"))) as Record<string, unknown> & { resources: Record<string, number> };
  expect(manifest["name"]).toBe(sample.name);
  expect(manifest.resources["cpu"]).toBe(sample.cpu);
  expect(manifest.resources["memory"]).toBe(sample.memory);
  expect(manifest["generation"]).toBe(sample.generation);
  expect(manifest["description"]).toBe(`${sample.name} demo`);
  const ignore = DockerIgnore.fromText(read(path.join(project, ".dockerignore")));
  expect(ignore.excludes(".env")).toBe(true);
  expect(ignore.excludes("agent_sandbox-0.0.0-py3-none-any.whl")).toBe(false);

  patchLoadConfig(fakeConfig());
  const { builder } = mockBuilder();
  builder.build.mockResolvedValue(`${sample.name}:latest`);
  builder.loginAcrWithAksk.mockResolvedValue({ tempUserName: "u", authorizationToken: "t" });
  builder.tag.mockResolvedValue(undefined);
  builder.push.mockResolvedValue(undefined);
  spyAny(fcTemplate, "waitForTemplateReady").mockResolvedValue({ status: { state: "ready" } });
  const create = spyAny(fcTemplate, "createOfficialTemplate").mockResolvedValue({ templateID: `tpl-${kind}`, statusCode: 200 });
  const deployed = await new CliRunner().invoke(cli, ["deploy", project, "--acr-namespace", "test-ns", "-y"]);

  expect(deployed.exit_code, _text(deployed)).toBe(0);
  expect(_text(deployed)).toContain(`tpl-${kind}`);
  expect(seen.calls).toBe(1);
  expect(builder.build.mock.calls[0]![0]).toBe(fs.realpathSync(project));
  const registered = create.mock.calls[0]![0] as Record<string, unknown>;
  expect(registered["name"]).toBe(manifest["name"]);
  expect(registered["cpu"]).toBe(manifest.resources["cpu"]);
  expect(registered["memory_size"]).toBe(manifest.resources["memory"]);
  expect(registered["generation"]).toBe(manifest["generation"]);
  expect("description" in registered).toBe(false);
  expect(String(registered["image"])).toContain(sample.name);
  expect(String(registered["image"])).toContain("test-ns");
  for (const [name, text] of Object.entries(before)) expect(read(path.join(project, name))).toBe(text);
});
