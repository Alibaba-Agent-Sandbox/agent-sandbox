/**
 * End-to-end CLI flows for natural-language create versus template init.
 *
 * Each test enters through the real `abx` command tree (`template init`, `init`, `create`, `sandbox create`). The
 * coding agent, image build, and sandbox API are stubbed so the run stays offline; the assertions are on the files
 * left on disk and on the calls that must not happen.
 *
 * Port of `tests/integration/test_nl_template_init_e2e.py` (every test there is `@pytest.mark.integration`, so this
 * file is excluded from the default `npm test`; run it with `npm run test:integration`). Nothing here needs
 * credentials or the network.
 */

import "../_support/isolatedHome.js";

import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import * as clarify from "../../src/agent/clarify.js";
import { ClarifyAssessment } from "../../src/agent/clarify.js";
import * as codegen from "../../src/agent/codegen.js";
import { CodegenResult } from "../../src/agent/codegen.js";
import * as qwenCode from "../../src/agent/qwen_code.js";
import { QwenCodeCredentials, QwenCodeRunResult } from "../../src/agent/qwen_code.js";
import { Sandbox } from "../../src/api/sandbox.js";
import { codingAgentSeams } from "../../src/cli/commands/_coding_agent.js";
import { configSeams } from "../../src/cli/commands/config_cmd.js";
import { sandboxSeams } from "../../src/cli/commands/sandbox.js";
import * as template from "../../src/cli/commands/template.js";
import { cli } from "../../src/cli/main.js";
import { SandboxInfo } from "../../src/models/sandbox.js";
import { CliRunner, type Result } from "../helpers/cliRunner.js";
import { useTmpPath } from "../helpers/templateSupport.js";

const tmpPath = useTmpPath();

type Mock = ReturnType<typeof vi.fn>;

/** Captured before any test patches it: the *real* generator, used by the "real codegen" tests below. */
const _REAL_GENERATE = codegen.seams.generateTemplateFiles;

const _CREDS = new QwenCodeCredentials({
  source: "qwen-stored",
  apiKey: "sk-test",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  model: "qwen3-coder-plus",
});
const _TEMPLATE_NAME = "abx-nl-sandbox-abc123";
const _DESCRIPTION = "a python data science env with pandas";

const runner = (): CliRunner => new CliRunner();

const _shown = (result: Result): string => (result.output || "") + (result.stderr || "");

const read = (p: string): string => fs.readFileSync(p, "utf-8");

function _codegenResult(tmp: string): CodegenResult {
  const workdir = path.join(tmp, "generated");
  fs.mkdirSync(workdir, { recursive: true });
  const dockerfile = path.join(workdir, "Dockerfile");
  fs.writeFileSync(dockerfile, "FROM python:3.12-slim\n", "utf-8");
  const templateYaml = path.join(workdir, "template.yaml");
  fs.writeFileSync(templateYaml, `name: ${_TEMPLATE_NAME}\n`, "utf-8");
  const commandsPy = path.join(workdir, "commands.py");
  fs.writeFileSync(
    commandsPy,
    "from agent_sandbox.server import CommandRegistry, SandboxServer\n" +
      "registry = CommandRegistry()\n" +
      "SandboxServer(registry=registry).serve(port=9000)\n",
    "utf-8",
  );
  fs.writeFileSync(path.join(workdir, "README.md"), "# generated\n", "utf-8");
  return new CodegenResult({
    workdir,
    templateName: _TEMPLATE_NAME,
    dockerfile,
    templateYaml,
    description: _DESCRIPTION,
    rawOutput: "generated",
    commandsPy,
    files: ["Dockerfile", "README.md", "commands.py", "template.yaml"],
  });
}

function _sandbox(): Sandbox {
  const info = SandboxInfo.modelValidate({
    sandboxID: "sbx-e2e-001",
    templateID: "tmpl-ai-123",
    status: "running",
    region: "cn-hangzhou",
    timeout: 300,
    envdUrl: "https://sbx-e2e-001.cn-hangzhou.e2b.fc.aliyuncs.com",
    envdAccessToken: "tok",
  });
  return { id: info.sandbox_id, status: info.status, url: info.envd_url, info } as unknown as Sandbox;
}

interface AgentReady {
  generated: CodegenResult;
  generate: Mock;
  deploy: Mock;
}

const savedSeams = {
  qwen: { ...qwenCode.seams },
  codegen: { ...codegen.seams },
  clarify: { ...clarify.seams },
  sandbox: { ...sandboxSeams },
  codingAgent: { ...codingAgentSeams },
  config: { ...configSeams },
};

afterEach(() => {
  Object.assign(qwenCode.seams, savedSeams.qwen);
  Object.assign(codegen.seams, savedSeams.codegen);
  Object.assign(clarify.seams, savedSeams.clarify);
  Object.assign(sandboxSeams, savedSeams.sandbox);
  Object.assign(codingAgentSeams, savedSeams.codingAgent);
  Object.assign(configSeams, savedSeams.config);
});

/** Hermetic coding-agent + deploy stubs. No network, no real Qwen Code. */
function agentReady(): AgentReady {
  const tmp = tmpPath();
  const binary = path.join(tmp, "qwen");
  fs.writeFileSync(binary, "#!/bin/sh\n", "utf-8");
  qwenCode.seams.findQwenCodeBinary = vi.fn(() => binary);
  qwenCode.seams.resolveQwenCodeCredentials = vi.fn(() => _CREDS);
  configSeams.loadConfigDict = vi.fn(() => ({}));
  configSeams.readEnvVar = vi.fn(() => null);
  vi.spyOn(template, "resolve_acr_namespace").mockReturnValue("test-acr-ns");
  const workspace = path.join(tmp, "generated-workspace");
  codegen.seams.prepareWorkdir = vi.fn(() => [workspace, _TEMPLATE_NAME] as [string, string]) as unknown as typeof codegen.seams.prepareWorkdir;
  clarify.seams.runResearch = vi.fn(async () => true) as unknown as typeof clarify.seams.runResearch;
  clarify.seams.evaluate = vi.fn(async () => new ClarifyAssessment({ completeness: 1.0, question: null })) as unknown as typeof clarify.seams.evaluate;
  const generated = _codegenResult(tmp);
  const generate = vi.fn(async () => generated);
  const deploy = vi.spyOn(template, "do_deploy").mockResolvedValue({ TemplateID: "tmpl-ai-123", Status: "success" }) as unknown as Mock;
  codegen.seams.generateTemplateFiles = generate as unknown as typeof codegen.seams.generateTemplateFiles;
  return { generated, generate, deploy };
}

function _assertLocalTemplate(directory: string): void {
  expect(read(path.join(directory, "Dockerfile")).startsWith("FROM")).toBe(true);
  expect(read(path.join(directory, "template.yaml"))).toContain("name:");
  // A Dockerfile alone is not a usable template: the HTTP server entry point (commands.py) and the docs must be
  // copied along with it.
  expect(read(path.join(directory, "commands.py"))).toContain("SandboxServer");
  expect(fs.statSync(path.join(directory, "README.md")).isFile()).toBe(true);
}

const isFile = (p: string): boolean => fs.existsSync(p) && fs.statSync(p).isFile();
const exists = (p: string): boolean => fs.existsSync(p);

const fakeTty = (): void => {
  sandboxSeams.stdinIsatty = () => true;
};

const spyCreate = (value?: Sandbox) => {
  const spy = vi.spyOn(Sandbox, "create");
  if (value !== undefined) spy.mockResolvedValue(value);
  return spy;
};

// ---------------------------------------------------------------------------
// Scaffold init: explicit directory, default subdirectory of cwd
// ---------------------------------------------------------------------------

it("test_scaffold_init_writes_the_given_directory", async () => {
  const tmp = tmpPath();
  process.chdir(tmp);
  const dest = path.join(tmp, "nested", "my-template");

  const result = await runner().invoke(cli, ["template", "init", dest, "-t", "python"]);

  expect(result.exit_code, result.output).toBe(0);
  expect(isFile(path.join(dest, "Dockerfile"))).toBe(true);
  expect(isFile(path.join(dest, "template.yaml"))).toBe(true);
  expect(isFile(path.join(dest, "commands.py"))).toBe(true);
  expect(exists(path.join(tmp, "python"))).toBe(false);
  expect(exists(path.join(tmp, "Dockerfile"))).toBe(false);
});

it("test_scaffold_init_defaults_to_a_subdirectory_of_cwd", async () => {
  const tmp = tmpPath();
  process.chdir(tmp);

  const result = await runner().invoke(cli, ["template", "init", "-t", "node", "--name", "myapp"]);

  expect(result.exit_code, result.output).toBe(0);
  expect(isFile(path.join(tmp, "myapp", "Dockerfile"))).toBe(true);
  expect(exists(path.join(tmp, "Dockerfile"))).toBe(false);
});

// ---------------------------------------------------------------------------
// Natural-language init: files only, under cwd/<name>/
// ---------------------------------------------------------------------------

it("test_nl_init_writes_under_cwd_and_does_not_deploy", async () => {
  const tmp = tmpPath();
  const ready = agentReady();
  process.chdir(tmp);
  const create = spyCreate();

  const result = await runner().invoke(cli, ["template", "init", "-y", _DESCRIPTION]);

  expect(result.exit_code, _shown(result)).toBe(0);
  expect(ready.deploy).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect(ready.generate).toHaveBeenCalledTimes(1);
  _assertLocalTemplate(path.join(tmp, _TEMPLATE_NAME));
  expect(_shown(result)).toContain("template deploy");
  expect(_shown(result)).not.toContain("created successfully");
});

it("test_nl_init_name_selects_the_subdirectory", async () => {
  const tmp = tmpPath();
  const ready = agentReady();
  process.chdir(tmp);

  const result = await runner().invoke(cli, ["template", "init", "-y", "--name", "myapp", "一个数据分析环境"]);

  expect(result.exit_code, _shown(result)).toBe(0);
  expect(ready.deploy).not.toHaveBeenCalled();
  _assertLocalTemplate(path.join(tmp, "myapp"));
  expect(read(path.join(tmp, "myapp", "template.yaml"))).toContain("name: myapp");
  expect(exists(path.join(tmp, _TEMPLATE_NAME))).toBe(false);
});

it("test_nl_init_rejects_a_second_directory_argument", async () => {
  // The description occupies the only positional; a path cannot ride along.
  const tmp = tmpPath();
  const result = await runner().invoke(cli, ["template", "init", "-y", _DESCRIPTION, path.join(tmp, "elsewhere")]);

  expect(result.exit_code).not.toBe(0);
  expect(exists(path.join(tmp, "elsewhere"))).toBe(false);
});

it("test_top_level_init_matches_template_init", async () => {
  const tmp = tmpPath();
  const ready = agentReady();
  process.chdir(tmp);

  const result = await runner().invoke(cli, ["template", "init", "-y", _DESCRIPTION]);

  expect(result.exit_code, _shown(result)).toBe(0);
  expect(ready.deploy).not.toHaveBeenCalled();
  _assertLocalTemplate(path.join(tmp, _TEMPLATE_NAME));
});

// ---------------------------------------------------------------------------
// create: switch to init, or continue through deploy + sandbox create
// ---------------------------------------------------------------------------

it("test_create_switch_stops_after_the_local_template", async () => {
  const tmp = tmpPath();
  const ready = agentReady();
  process.chdir(tmp);
  fakeTty();
  const create = spyCreate();

  const result = await runner().invoke(cli, ["create", _DESCRIPTION], { input: "y\n" });

  expect(result.exit_code, _shown(result)).toBe(0);
  expect(_shown(result)).toContain("Switch to template init");
  expect(ready.deploy).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  _assertLocalTemplate(path.join(tmp, _TEMPLATE_NAME));
});

it("test_create_yes_deploys_and_creates_a_sandbox", async () => {
  const tmp = tmpPath();
  const ready = agentReady();
  process.chdir(tmp);
  spyCreate(_sandbox());

  const result = await runner().invoke(cli, ["create", "-y", _DESCRIPTION]);

  expect(result.exit_code, _shown(result)).toBe(0);
  expect(_shown(result)).not.toContain("Switch to template init");
  expect(ready.deploy).toHaveBeenCalledTimes(1);
  expect(_shown(result)).toContain("sbx-e2e-001");
  expect(_shown(result)).toContain("created successfully");
  expect(exists(path.join(tmp, _TEMPLATE_NAME))).toBe(false);
});

it("test_sandbox_create_yes_is_the_same_pipeline", async () => {
  const tmp = tmpPath();
  const ready = agentReady();
  process.chdir(tmp);
  spyCreate(_sandbox());

  const result = await runner().invoke(cli, ["sandbox", "create", "-y", _DESCRIPTION]);

  expect(result.exit_code, _shown(result)).toBe(0);
  expect(ready.deploy).toHaveBeenCalledTimes(1);
  expect(_shown(result)).toContain("sbx-e2e-001");
});

it("test_noninteractive_create_reminds_about_init_and_does_not_launch", async () => {
  const tmp = tmpPath();
  const ready = agentReady();
  process.chdir(tmp);
  const create = spyCreate();

  const result = await runner().invoke(cli, ["create", _DESCRIPTION]);

  expect(result.exit_code).not.toBe(0);
  const shown = _shown(result);
  expect(shown).toContain("Confirmation required");
  expect(shown).toContain("abx template init");
  expect(ready.deploy).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Real generation chain: only the Qwen Code process is faked. The prompt that reaches the agent, the server-entry-point
// validation, the deliverable listing, the local copy, and the deploy hand-off all run for real.
// ---------------------------------------------------------------------------

const _SERVER_DOCKERFILE =
  "FROM python:3.12-slim\n" +
  "COPY *.whl /tmp/\n" +
  "RUN pip install --no-cache-dir agent-sandbox-server\n" +
  "WORKDIR /app\n" +
  "COPY commands.py .\n" +
  "EXPOSE 9000\n";
const _SERVER_COMMANDS =
  "from agent_sandbox.server import CommandRegistry, SandboxServer\n" +
  "registry = CommandRegistry()\n" +
  '@registry.command("hello")\n' +
  "def hello(name: str = 'World') -> str:\n" +
  "    return f'Hello, {name}!'\n" +
  "registry.freeze()\n" +
  "if __name__ == '__main__':\n" +
  "    SandboxServer(registry=registry).serve(port=9000)\n";
const _SERVER_YAML =
  "name: whatever\n" + "description: 数据分析环境\n" + "capabilities: [shell, files, ports]\n" + "ports: [9000]\n" + "resources:\n  cpu: 2\n  memory: 2048\n";

/** Replace the Qwen Code process with a writer; return the prompts it received. */
function _fakeQwen(commandsPy: string | null = _SERVER_COMMANDS): string[] {
  const prompts: string[] = [];
  codegen.seams.runQwenCodeHeadless = (async (prompt: string, opts: qwenCode.RunHeadlessOptions = {}) => {
    prompts.push(prompt);
    const cwd = String(opts.cwd);
    fs.mkdirSync(cwd, { recursive: true });
    fs.writeFileSync(path.join(cwd, "Dockerfile"), _SERVER_DOCKERFILE, "utf-8");
    fs.writeFileSync(path.join(cwd, "template.yaml"), _SERVER_YAML, "utf-8");
    fs.writeFileSync(path.join(cwd, "README.md"), "# generated\n", "utf-8");
    fs.writeFileSync(path.join(cwd, "app.py"), "print('business code')\n", "utf-8");
    fs.mkdirSync(path.join(cwd, ".qwen"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".qwen", "session.json"), "{}", "utf-8");
    if (commandsPy !== null) fs.writeFileSync(path.join(cwd, "commands.py"), commandsPy, "utf-8");
    return new QwenCodeRunResult({ text: "done", isError: false, exitCode: 0 });
  }) as typeof codegen.seams.runQwenCodeHeadless;
  return prompts;
}

function realCodegen(): AgentReady {
  const ready = agentReady();
  codegen.seams.generateTemplateFiles = _REAL_GENERATE;
  return ready;
}

it("test_nl_init_delivers_a_usable_template_not_just_a_dockerfile", async () => {
  const tmp = tmpPath();
  const ready = realCodegen();
  process.chdir(tmp);
  const prompts = _fakeQwen();

  const result = await runner().invoke(cli, ["template", "init", "-y", _DESCRIPTION]);

  expect(result.exit_code, _shown(result)).toBe(0);
  expect(ready.deploy).not.toHaveBeenCalled();

  // The agent was told to build a server and given the SDK reference.
  expect(prompts.length).toBe(1);
  for (const needle of ["commands.py", "SandboxServer", "CommandRegistry", "EXPOSE 9000"]) expect(prompts[0], needle).toContain(needle);

  // Every deliverable, and only deliverables, reached ./<name>/.
  const target = path.join(tmp, _TEMPLATE_NAME);
  expect(fs.readdirSync(target).sort()).toEqual(["Dockerfile", "README.md", "app.py", "commands.py", "template.yaml"]);
  expect(read(path.join(target, "commands.py"))).toContain("SandboxServer");
  expect(read(path.join(target, "Dockerfile"))).toContain("commands.py");
  expect(read(path.join(target, "template.yaml"))).toContain(`name: ${_TEMPLATE_NAME}`);
  const shown = _shown(result);
  expect(shown).toContain("commands.py"); // listed in the "Created files" summary
});

it("test_nl_init_rejects_a_dockerfile_only_result_and_writes_nothing", async () => {
  // The regression: a Dockerfile-only template cannot be used once deployed.
  const tmp = tmpPath();
  const ready = realCodegen();
  process.chdir(tmp);
  _fakeQwen(null);

  const result = await runner().invoke(cli, ["template", "init", "-y", _DESCRIPTION]);

  expect(result.exit_code).not.toBe(0);
  expect(_shown(result)).toContain("commands.py");
  expect(exists(path.join(tmp, _TEMPLATE_NAME))).toBe(false);
  expect(ready.deploy).not.toHaveBeenCalled();
});

it("test_nl_init_rejects_a_commands_py_that_never_starts_the_server", async () => {
  const tmp = tmpPath();
  realCodegen();
  process.chdir(tmp);
  _fakeQwen("print('hello')\n");

  const result = await runner().invoke(cli, ["template", "init", "-y", _DESCRIPTION]);

  expect(result.exit_code).not.toBe(0);
  expect(_shown(result)).toContain("SandboxServer");
  expect(exists(path.join(tmp, _TEMPLATE_NAME))).toBe(false);
});

it("test_create_yes_hands_the_whole_workspace_to_deploy", async () => {
  const tmp = tmpPath();
  const ready = realCodegen();
  process.chdir(tmp);
  _fakeQwen();
  spyCreate(_sandbox());

  const result = await runner().invoke(cli, ["create", "-y", _DESCRIPTION]);

  expect(result.exit_code, _shown(result)).toBe(0);
  expect(ready.deploy).toHaveBeenCalledTimes(1);
  const built = String(ready.deploy.mock.calls[0]![0]);
  expect(isFile(path.join(built, "commands.py"))).toBe(true);
  expect(isFile(path.join(built, "Dockerfile"))).toBe(true);
  expect(_shown(result)).toContain("sbx-e2e-001");
});

it("test_create_yes_with_a_dockerfile_only_result_never_deploys", async () => {
  const tmp = tmpPath();
  const ready = realCodegen();
  process.chdir(tmp);
  _fakeQwen(null);
  const create = spyCreate();

  const result = await runner().invoke(cli, ["create", "-y", _DESCRIPTION]);

  expect(result.exit_code).not.toBe(0);
  expect(_shown(result)).toContain("commands.py");
  expect(ready.deploy).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// No stray directories from misdirected interactive answers
// ---------------------------------------------------------------------------

it("test_answers_typed_at_the_directory_prompt_leave_no_directories", async () => {
  // `./pandas`, `./y`, `./2 CPU 4 GB` must never appear in the working directory.
  const tmp = tmpPath();
  realCodegen();
  process.chdir(tmp);
  fakeTty();
  _fakeQwen();
  const before = new Set(fs.readdirSync(tmp));

  // switch=n, directory="pandas" (meant as a clarification answer), confirm=y
  spyCreate(_sandbox());
  const result = await runner().invoke(cli, ["create", _DESCRIPTION], { input: "n\npandas\ny\n" });

  expect(result.exit_code, _shown(result)).toBe(0);
  expect(exists(path.join(tmp, "pandas"))).toBe(false);
  const created = fs.readdirSync(tmp).filter((name) => !before.has(name));
  expect(created.every((name) => name === "generated-workspace"), created.join(",")).toBe(true);
});
