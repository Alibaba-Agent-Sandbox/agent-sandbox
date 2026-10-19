/**
 * Unit tests for the AI code-generation orchestrator.
 *
 * Port of `tests/test_agent/test_codegen.py`. No test performs real network access or executes the real Qwen Code
 * CLI: every headless run is replaced by a fake that writes files into the requested workspace (`seams.runQwenCodeHeadless`
 * plays the role of `patch("agent_sandbox.agent.codegen.run_qwen_code_headless")`). `commands.py` is checked by a real
 * `python3` where available (the Python original uses `ast.parse`).
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as codegen from "../../src/agent/codegen.js";
import {
  DEFAULT_CODEGEN_TIMEOUT,
  TEMPLATE_NAME_PREFIX,
  buildCodegenPrompt,
  defaultCodegenTimeout,
  generateTemplateFiles,
  lexicalSyntaxCheck,
  listTemplateFiles,
  makeTemplateName,
  prepareWorkdir,
  validateTemplateWorkspace,
} from "../../src/agent/codegen.js";
import { pyStrip } from "../../src/agent/_pycompat.js";
import { loadYaml as safeLoad } from "../../src/utils/yaml_io.js";
import { QwenCodeRunResult } from "../../src/agent/qwen_code.js";
import { AICodegenError } from "../../src/models/errors.js";
import { findPython, itWithPython, makeTmp, raises, readGolden, rmTmp } from "../helpers/agentSupport.js";

const pythonIt = itWithPython(it);

const VALID_TEMPLATE_YAML = `\
name: whatever-the-model-wrote
description: 一个用于数据分析的 Python 环境
resources:
  cpu: 2
  memory: 4096
`;

const DOCKERFILE = "FROM python:3.12-slim\nRUN pip install pandas\nCOPY commands.py .\nEXPOSE 9000\n";

const COMMANDS_PY =
  "from agent_sandbox.server import CommandRegistry, SandboxServer\n" +
  "registry = CommandRegistry()\n" +
  "registry.freeze()\n" +
  "if __name__ == \"__main__\":\n" +
  "    SandboxServer(registry=registry).serve(port=9000)\n";

type Fake = (prompt: string, kwargs: any) => Promise<QwenCodeRunResult>;

function patchRun(fake: Fake) {
  return vi.spyOn(codegen.seams, "runQwenCodeHeadless").mockImplementation(fake as any);
}

/** Return a fake `run_qwen_code_headless` that writes the given files (`null` = do not write that file). */
function fakeRunWriting(
  opts: {
    dockerfile?: string | null;
    templateYaml?: string | null;
    commandsPy?: string | null;
    readme?: string | null;
    result?: QwenCodeRunResult | null;
  } = {},
): Fake {
  const dockerfile = opts.dockerfile === undefined ? DOCKERFILE : opts.dockerfile;
  const templateYaml = opts.templateYaml === undefined ? VALID_TEMPLATE_YAML : opts.templateYaml;
  const commandsPy = opts.commandsPy === undefined ? COMMANDS_PY : opts.commandsPy;
  const readme = opts.readme === undefined ? "# demo\n" : opts.readme;
  const result = opts.result ?? null;
  return async (_prompt, kwargs) => {
    const cwd: string = kwargs.cwd;
    if (dockerfile !== null) fs.writeFileSync(path.join(cwd, "Dockerfile"), dockerfile, "utf8");
    if (templateYaml !== null) fs.writeFileSync(path.join(cwd, "template.yaml"), templateYaml, "utf8");
    if (commandsPy !== null) fs.writeFileSync(path.join(cwd, "commands.py"), commandsPy, "utf8");
    if (readme !== null) fs.writeFileSync(path.join(cwd, "README.md"), readme, "utf8");
    if (result !== null) return result;
    return new QwenCodeRunResult({ text: "done", isError: false, exitCode: 0 });
  };
}

let tmpPath = "";
beforeEach(() => {
  tmpPath = makeTmp();
});
afterEach(() => {
  vi.restoreAllMocks();
  rmTmp(tmpPath);
});

// ---------------------------------------------------------------------------
// Template naming
// ---------------------------------------------------------------------------

describe("TestTemplateName", () => {
  it("test_ascii_slug_with_injected_token", () => {
    const name = makeTemplateName("Run a Python data analysis job", { token: "abc123" });
    expect(name).toBe(`${TEMPLATE_NAME_PREFIX}-run-a-python-dat-abc123`);
  });

  it("test_non_ascii_description_falls_back", () => {
    const name = makeTemplateName("运行数据分析", { token: "abc123" });
    expect(name).toBe(`${TEMPLATE_NAME_PREFIX}-sandbox-abc123`);
  });

  it("test_ascii_words_inside_non_ascii_description_survive", () => {
    const name = makeTemplateName("运行 Python 数据分析", { token: "abc123" });
    expect(name).toBe(`${TEMPLATE_NAME_PREFIX}-python-abc123`);
  });

  it("test_token_is_random_hex_when_omitted", () => {
    const first = makeTemplateName("node service");
    const second = makeTemplateName("node service");
    expect(first).not.toBe(second);
    expect(first.split("-").pop()!.length).toBe(6);
    expect(first.split("-").pop()).toMatch(/^[0-9a-f]{6}$/);
  });
});

describe("TestPrompt", () => {
  it("test_prompt_mentions_description_and_template_name", () => {
    const prompt = buildCodegenPrompt("用 playwright 截图", "abx-nl-sandbox-abc123");
    expect(prompt).toContain("用 playwright 截图");
    expect(prompt).toContain("abx-nl-sandbox-abc123");
    expect(prompt).toContain("Dockerfile");
    expect(prompt).toContain("template.yaml");
  });

  it("test_prompt_demands_a_server_not_just_a_dockerfile", () => {
    const prompt = buildCodegenPrompt("做一个 markdown 转 PDF 的服务", "abx-nl-sandbox-abc123", "alicloud-express");
    for (const required of [
      "commands.py",
      "agent_sandbox.server",
      '@command("',
      "start(",
      "EXPOSE 9000",
      "HTTP",
      "FROM fc-e2b-registry.<region>.cr.aliyuncs.com/runtime/base:<tag>",
    ]) {
      expect(prompt, required).toContain(required);
    }
    expect(prompt).not.toMatch(/(?:^|\n)[ \t]*CMD[ \t]/);
    expect(prompt).toContain("不是只有 Dockerfile 的镜像");
  });

  it("test_prompt_carries_the_sdk_reference_and_the_reference_example", () => {
    const prompt = buildCodegenPrompt("x", "abx-nl-sandbox-abc123");
    expect(prompt).toContain('@command("');
    expect(prompt).toContain("@table.route");
    expect(prompt).toContain("CapabilityGroup");
    expect(prompt).toContain("start(");
    expect(prompt).not.toContain("@registry.command");
    expect(prompt).not.toContain("registry.freeze()");
    expect(prompt).toContain("X-Access-Token");
  });

  it("test_prompt_braces_in_user_text_survive_formatting", () => {
    const prompt = buildCodegenPrompt("return {'a': {b}} as json", "abx-nl-sandbox-abc123");
    expect(prompt).toContain("return {'a': {b}} as json");
  });

  it("test_prompt_has_no_replayed_transcript", async () => {
    // Generation resumes the native session; no Q/A section is embedded.
    const prompt = buildCodegenPrompt("用 playwright 截图", "abx-nl-sandbox-abc123", "alicloud-express");
    expect(prompt).not.toContain("澄清");
    expect(prompt).toContain("用户需求：用 playwright 截图\n\n必须创建的文件：");
  });
});

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

describe("TestGenerateTemplateFiles", () => {
  it("test_success_writes_validated_workspace", async () => {
    patchRun(fakeRunWriting());
    const result = await generateTemplateFiles("运行 Python 数据分析", { baseDir: tmpPath });

    expect(fs.statSync(result.workdir).isDirectory()).toBe(true);
    expect(path.dirname(result.workdir)).toBe(tmpPath);
    expect(fs.statSync(result.dockerfile).isFile()).toBe(true);
    expect(fs.statSync(result.templateYaml).isFile()).toBe(true);
    expect(result.rawOutput).toBe("done");

    // The generated name replaces the model-provided one.
    const data = safeLoad(fs.readFileSync(result.templateYaml, "utf8")) as Record<string, any>;
    expect(data.name).toBe(result.templateName);
    expect(data.resources).toEqual({ cpu: 2, memory: 4096 });
    expect(data.description).toBe("一个用于数据分析的 Python 环境");
  });

  it("test_passes_bounded_options_and_progress", async () => {
    const captured: Record<string, any> = {};
    const progress: string[] = [];

    const fake: Fake = async (prompt, kwargs) => {
      Object.assign(captured, kwargs);
      captured.prompt = prompt;
      const cwd: string = kwargs.cwd;
      fs.writeFileSync(path.join(cwd, "Dockerfile"), DOCKERFILE, "utf8");
      fs.writeFileSync(path.join(cwd, "template.yaml"), VALID_TEMPLATE_YAML, "utf8");
      fs.writeFileSync(path.join(cwd, "commands.py"), COMMANDS_PY, "utf8");
      fs.writeFileSync(path.join(cwd, "README.md"), "# demo\n", "utf8");
      return new QwenCodeRunResult({ text: "ok", exitCode: 0 });
    };
    patchRun(fake);
    const result = await generateTemplateFiles("node service", {
      binary: "/opt/qwen",
      env: { OPENAI_API_KEY: "sk-test" },
      timeout: 42.0,
      baseDir: tmpPath,
      onProgress: (msg) => progress.push(msg),
    });

    expect(captured.binary).toBe("/opt/qwen");
    expect(captured.env).toEqual({ OPENAI_API_KEY: "sk-test" });
    expect(captured.timeout).toBe(42.0);
    expect(captured.cwd).toBe(result.workdir);
    expect(captured.prompt).toContain(result.templateName);
    expect(progress.some((msg) => msg.includes("Generating template"))).toBe(true);
  });

  it("test_resume_session_reaches_the_generation_run", async () => {
    // The clarification session is continued via ``--resume``, not replayed.
    const captured: Record<string, any> = {};
    patchRun(async (prompt, kwargs) => {
      Object.assign(captured, kwargs);
      return fakeRunWriting()(prompt, kwargs);
    });
    const session = "3f5c1c9e-2f6a-4a5b-9d1e-0a1b2c3d4e5f";
    await generateTemplateFiles("运行 python", { resumeSession: session, baseDir: tmpPath });

    expect(captured.resume).toBe(session);
  });

  it("test_resume_defaults_to_none", async () => {
    const captured: Record<string, any> = {};
    patchRun(async (prompt, kwargs) => {
      Object.assign(captured, kwargs);
      captured.prompt = prompt;
      return fakeRunWriting()(prompt, kwargs);
    });
    await generateTemplateFiles("node service", { baseDir: tmpPath });

    expect(captured.resume).toBeNull();
    expect(captured.prompt).not.toContain("澄清");
  });

  it("test_missing_files_raise_and_keep_workspace", async () => {
    patchRun(fakeRunWriting({ dockerfile: null, templateYaml: null, commandsPy: null }));
    await raises(
      () => generateTemplateFiles("empty run", { baseDir: tmpPath }),
      AICodegenError,
      "Dockerfile, commands.py, template.yaml",
    );

    // The workspace is kept for inspection.
    const workspaces = fs.readdirSync(tmpPath);
    expect(workspaces.length).toBe(1);
    expect(fs.statSync(path.join(tmpPath, workspaces[0]!)).isDirectory()).toBe(true);
  });

  it("test_result_lists_the_server_and_every_deliverable", async () => {
    patchRun(async (prompt, kwargs) => {
      const cwd: string = kwargs.cwd;
      fs.writeFileSync(path.join(cwd, "README.md"), "# t\n", "utf8");
      fs.writeFileSync(path.join(cwd, "app.py"), "print(1)\n", "utf8");
      fs.mkdirSync(path.join(cwd, "__pycache__"));
      fs.writeFileSync(path.join(cwd, "__pycache__", "x.pyc"), Buffer.from([0]));
      fs.mkdirSync(path.join(cwd, ".qwen"));
      fs.writeFileSync(path.join(cwd, ".qwen", "session.json"), "{}", "utf8");
      fs.writeFileSync(path.join(cwd, ".dockerignore"), ".git\n", "utf8");
      fs.writeFileSync(path.join(cwd, "agent_sandbox-0.1.0-py3-none-any.whl"), Buffer.from("whl"));
      return fakeRunWriting()(prompt, kwargs);
    });
    const result = await generateTemplateFiles("web service", { baseDir: tmpPath });

    expect(result.commandsPy).toBe(path.join(result.workdir, "commands.py"));
    expect([...result.files]).toEqual([".dockerignore", "Dockerfile", "README.md", "app.py", "commands.py", "template.yaml"]);
  });

  it("test_missing_readme_is_rejected", async () => {
    patchRun(fakeRunWriting({ readme: null }));
    await raises(() => generateTemplateFiles("no readme", { baseDir: tmpPath }), AICodegenError, "README.md");
  });

  it("test_dockerfile_only_result_is_rejected", async () => {
    // The regression this guards: a Dockerfile-only template cannot be used.
    patchRun(fakeRunWriting({ commandsPy: null }));
    const exc = await raises(
      () => generateTemplateFiles("dockerfile only", { baseDir: tmpPath }),
      AICodegenError,
      "commands.py",
    );
    expect(String(exc)).toContain("did not create the expected file");
  });

  it("test_commands_py_with_a_syntax_error_raises", async () => {
    patchRun(fakeRunWriting({ commandsPy: "def broken(:\n" }));
    await raises(() => generateTemplateFiles("bad commands", { baseDir: tmpPath }), AICodegenError, "not valid Python");
  });

  for (const source of [
    "print('hello')\n",
    "import http.server\nhttp.server.HTTPServer(('', 9000), None).serve_forever()\n",
    "from agent_sandbox.server import SandboxServer\nserver = SandboxServer()\n",
  ]) {
    it(`test_commands_py_that_never_starts_the_server_raises [${source}]`, async () => {
      patchRun(fakeRunWriting({ commandsPy: source }));
      await raises(
        () => generateTemplateFiles("no server", { baseDir: tmpPath }),
        AICodegenError,
        "does not start an agent_sandbox.server",
      );
    });
  }

  it("test_start_helper_counts_as_starting_the_server", async () => {
    const source = "from agent_sandbox.server import start\nif __name__ == '__main__':\n    start(9000)\n";
    patchRun(fakeRunWriting({ commandsPy: source }));
    const result = await generateTemplateFiles("start helper", { baseDir: tmpPath });
    expect(result.commandsPy).not.toBeNull();
  });

  it("test_dockerfile_that_never_starts_commands_py_raises", async () => {
    patchRun(fakeRunWriting({ dockerfile: "FROM python:3.12-slim\nCMD ['sleep', 'inf']\n" }));
    await raises(
      () => generateTemplateFiles("idle image", { baseDir: tmpPath }),
      AICodegenError,
      "never references commands.py",
    );
  });

  it("test_dockerfile_without_from_raises", async () => {
    patchRun(fakeRunWriting({ dockerfile: "# just a comment\n" }));
    await raises(() => generateTemplateFiles("bad dockerfile", { baseDir: tmpPath }), AICodegenError, "no FROM instruction");
  });

  it("test_invalid_yaml_syntax_raises", async () => {
    patchRun(fakeRunWriting({ templateYaml: "name: [unclosed\n" }));
    await raises(() => generateTemplateFiles("bad yaml", { baseDir: tmpPath }), AICodegenError, "could not be parsed");
  });

  it("test_yaml_failing_schema_raises", async () => {
    const bad = "name: x\ncapabilities: [not-a-real-capability]\n";
    patchRun(fakeRunWriting({ templateYaml: bad }));
    await raises(() => generateTemplateFiles("bad schema", { baseDir: tmpPath }), AICodegenError, "schema validation");
  });

  it("test_yaml_not_a_mapping_raises", async () => {
    patchRun(fakeRunWriting({ templateYaml: "- a\n- b\n" }));
    await raises(() => generateTemplateFiles("list yaml", { baseDir: tmpPath }), AICodegenError, "not a YAML mapping");
  });

  it("test_empty_description_rejected_before_running", async () => {
    const mockRun = patchRun(fakeRunWriting());
    await raises(() => generateTemplateFiles("   ", { baseDir: tmpPath }), AICodegenError, "empty description");
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("test_failure_details_include_exit_code_and_stderr", async () => {
    const result = new QwenCodeRunResult({
      text: "",
      isError: true,
      exitCode: 55,
      rawStderr: "budget exceeded\n",
    });
    patchRun(fakeRunWriting({ dockerfile: null, templateYaml: null, result }));
    await raises(() => generateTemplateFiles("budget", { baseDir: tmpPath }), AICodegenError, "exit_code=55");
  });
});

describe("TestPrepareWorkdir", () => {
  it("test_creates_the_workspace_under_base_dir", () => {
    const [workdir, name] = prepareWorkdir("运行 Python 数据分析", { baseDir: tmpPath });
    expect(fs.statSync(workdir).isDirectory()).toBe(true);
    expect(path.dirname(workdir)).toBe(tmpPath);
    expect(name.startsWith(`${TEMPLATE_NAME_PREFIX}-`)).toBe(true);
    expect(path.basename(workdir).endsWith(name.slice(-6))).toBe(true);
  });

  it("test_generate_reuses_a_prepared_workspace", async () => {
    // Clarification and generation must share one cwd (Qwen sessions are per-cwd).
    const [workdir, name] = prepareWorkdir("node service", { baseDir: tmpPath });
    patchRun(fakeRunWriting());
    const result = await generateTemplateFiles("node service", { workdir, templateName: name });
    expect(result.workdir).toBe(workdir);
    expect(result.templateName).toBe(name);
  });
});

describe("TestDefaults", () => {
  const saved = process.env.ABX_QWEN_CODEGEN_TIMEOUT;
  afterEach(() => {
    if (saved === undefined) delete process.env.ABX_QWEN_CODEGEN_TIMEOUT;
    else process.env.ABX_QWEN_CODEGEN_TIMEOUT = saved;
  });

  it("test_timeout_default", () => {
    delete process.env.ABX_QWEN_CODEGEN_TIMEOUT;
    expect(defaultCodegenTimeout()).toBe(DEFAULT_CODEGEN_TIMEOUT);
  });

  it("test_timeout_env_override", () => {
    process.env.ABX_QWEN_CODEGEN_TIMEOUT = "120";
    expect(defaultCodegenTimeout()).toBe(120.0);
  });

  it("test_invalid_timeout_env_ignored", () => {
    process.env.ABX_QWEN_CODEGEN_TIMEOUT = "not-a-number";
    expect(defaultCodegenTimeout()).toBe(DEFAULT_CODEGEN_TIMEOUT);
    process.env.ABX_QWEN_CODEGEN_TIMEOUT = "-5";
    expect(defaultCodegenTimeout()).toBe(DEFAULT_CODEGEN_TIMEOUT);
  });

  it("test_generated_dir_default", () => {
    expect(codegen.defaultGeneratedDir()).toBe(path.join(homedir(), ".abx", "generated"));
  });
});

describe("TestOnActivity", () => {
  it("test_generate_forwards_on_activity_only_when_given", async () => {
    const seen: Array<Record<string, any>> = [];
    patchRun(async (prompt, kwargs) => {
      seen.push(kwargs);
      return fakeRunWriting()(prompt, kwargs);
    });
    const onActivity = (_summary: string): void => {};
    await generateTemplateFiles("one", { baseDir: tmpPath });
    await generateTemplateFiles("two", { baseDir: tmpPath, onActivity });

    expect("onActivity" in seen[0]!).toBe(false);
    expect(seen[1]!.onActivity).toBe(onActivity);
  });
});

// ---------------------------------------------------------------------------
// Extra coverage for the TypeScript port (no Python counterpart)
// ---------------------------------------------------------------------------

describe("TestPromptGolden", () => {
  it("embeds the selected provider profile and not a second image contract", () => {
    const golden = readGolden();
    for (const entry of golden.codegen as Array<{ description: string; name: string; prompt: string }>) {
      const prompt = buildCodegenPrompt(entry.description, entry.name, "alicloud-express");
      expect(prompt).toContain(pyStrip(entry.description));
      expect(prompt).toContain(entry.name);
      expect(prompt).toContain("FROM fc-e2b-registry.<region>.cr.aliyuncs.com/runtime/base:<tag>");
      expect(prompt).not.toContain("FROM python:3.12-slim");
      expect(prompt).not.toMatch(/(?:^|\n)[ \t]*CMD[ \t]/);
    }
    const generic = buildCodegenPrompt("x", "abx-nl-sandbox-abc123", "opensandbox");
    expect(generic).toContain('CMD ["python3", "commands.py"]');
    expect(generic).toContain("has no template profile");
    expect(generic).not.toContain("fc-e2b-registry");
  });
});

describe("TestValidateTemplateWorkspace", () => {
  function write(files: Record<string, string>): string {
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(tmpPath, name), text, "utf8");
    return tmpPath;
  }

  it("returns the manifest with the generated name and keeps the model's other keys", () => {
    write({ Dockerfile: DOCKERFILE, "template.yaml": VALID_TEMPLATE_YAML, "commands.py": COMMANDS_PY });
    const data = validateTemplateWorkspace(tmpPath, "my-name");
    expect(data["name"]).toBe("my-name");
    expect(data).toEqual({
      name: "my-name",
      description: "一个用于数据分析的 Python 环境",
      resources: { cpu: 2, memory: 4096 },
    });
  });

  it("uses the caller's retry hint as the suggestion of every error", async () => {
    const exc = await raises(() => validateTemplateWorkspace(tmpPath, "n", { retry: "try again" }), AICodegenError, "Expected file is missing: Dockerfile");
    expect(exc.suggestion).toBe("try again");
  });

  it("default suggestion names the workspace and the fallback command", async () => {
    const exc = await raises(() => validateTemplateWorkspace(tmpPath, "n"), AICodegenError);
    expect(exc.suggestion).toBe(
      `Inspect the generated workspace: ${tmpPath} — then retry, or fall back to 'abx create <name>'.`,
    );
  });

  it("rewrites template.yaml in block style, keeping key order, after generation", async () => {
    patchRun(fakeRunWriting({ templateYaml: "name: x\ndescription: 'quoted: yes'\nports: [9000, 8080]\nresources: {cpu: 1, memory: 512}\n" }));
    const result = await generateTemplateFiles("canon", { baseDir: tmpPath });
    expect(fs.readFileSync(result.templateYaml, "utf8")).toBe(
      `name: ${result.templateName}\ndescription: 'quoted: yes'\nports:\n- 9000\n- 8080\nresources:\n  cpu: 1\n  memory: 512\n`,
    );
  });
});

describe("TestListTemplateFiles", () => {
  it("skips dot-dirs, pycache, node_modules and wheels; keeps .dockerignore", () => {
    for (const rel of ["a/b.txt", "a/.hidden", ".git/config", "node_modules/x.js", "__pycache__/y.pyc", "z.whl", "m.abx-bak", ".dockerignore", "top.py"]) {
      fs.mkdirSync(path.dirname(path.join(tmpPath, rel)), { recursive: true });
      fs.writeFileSync(path.join(tmpPath, rel), "x");
    }
    expect([...listTemplateFiles(tmpPath)]).toEqual([".dockerignore", "a/b.txt", "top.py"].map((p) => p.split("/").join(path.sep)));
  });

  it("is bounded to 200 entries", () => {
    for (let i = 0; i < 230; i += 1) fs.writeFileSync(path.join(tmpPath, `f${String(i).padStart(3, "0")}.txt`), "x");
    expect(listTemplateFiles(tmpPath).length).toBe(200);
  });
});

describe("TestPythonSyntaxCheck", () => {
  const python = findPython();

  pythonIt("asks a real interpreter (SyntaxError text comes from CPython itself)", () => {
    expect(python).not.toBeNull();
    const verdict = codegen.pythonSyntaxCheck(Buffer.from("def broken(:\n"), "commands.py");
    expect(verdict?.valid).toBe(false);
    expect(verdict?.message).toContain("commands.py");
    expect(codegen.pythonSyntaxCheck(Buffer.from("x = 1\n"), "commands.py")).toEqual({ valid: true, message: "" });
  });

  it("decodes invalid UTF-8 like read_text(errors='replace') and accepts CRLF / CR newlines", () => {
    expect(codegen.pythonSyntaxCheck(Buffer.from("x = '\xff'\n", "latin1"), "commands.py")?.valid).toBe(true);
    expect(codegen.pythonSyntaxCheck(Buffer.from("if 1:\r\n    x = 1\r\n"), "commands.py")?.valid).toBe(true);
    expect(codegen.pythonSyntaxCheck(Buffer.from("if 1:\r    x = 1\r"), "commands.py")?.valid).toBe(true);
  });

  it("falls back to the lexical check only when no interpreter answers", async () => {
    const spy = vi.spyOn(codegen.seams, "pythonSyntaxCheck").mockReturnValue(null);
    // Lexically broken: caught by the fallback.
    await raises(
      async () => {
        patchRun(fakeRunWriting({ commandsPy: "x = (1,\n" }));
        await generateTemplateFiles("fallback", { baseDir: tmpPath });
      },
      AICodegenError,
      /not valid Python: '\(' was never closed/,
    );
    // Lexically fine: accepted.
    vi.restoreAllMocks();
    vi.spyOn(codegen.seams, "pythonSyntaxCheck").mockReturnValue(null);
    patchRun(fakeRunWriting());
    const result = await generateTemplateFiles("fallback ok", { baseDir: tmpPath });
    expect(result.commandsPy).not.toBeNull();
    expect(spy).toHaveBeenCalled();
  });
});

describe("TestLexicalSyntaxCheck", () => {
  const cases: Array<[string, string, string | null]> = [
    ["valid module", COMMANDS_PY, null],
    ["unterminated string", "x = 'abc\n", "unterminated string literal \\(detected at line 1\\) \\(commands.py, line 1\\)"],
    ["unterminated triple", 'x = """abc\n\n', "unterminated triple-quoted string literal \\(detected at line 3\\) \\(commands.py, line 1\\)"],
    ["never closed", "x = [1,\n  2\n", "'\\[' was never closed \\(commands.py, line 1\\)"],
    ["unmatched", "x = 1)\n", "unmatched '\\)' \\(commands.py, line 1\\)"],
    ["mismatch", "x = (1]\n", "closing parenthesis '\\]' does not match opening parenthesis '\\(' \\(commands.py, line 1\\)"],
    ["mismatch other line", "x = (1,\n 2]\n", "closing parenthesis '\\]' does not match opening parenthesis '\\(' on line 1 \\(commands.py, line 2\\)"],
    ["unexpected indent", "x = 1\n    y = 2\n", "unexpected indent \\(commands.py, line 2\\)"],
    ["bad dedent", "if 1:\n        x = 1\n    y = 2\n", "unindent does not match any outer indentation level \\(commands.py, line 3\\)"],
    ["nul", "x = 1\0\n", "source code string cannot contain null bytes"],
    ["trailing backslash", "x = 1 \\", "unexpected EOF while parsing \\(commands.py, line 1\\)"],
  ];
  for (const [title, source, expected] of cases) {
    it(`reports ${title}`, () => {
      const verdict = lexicalSyntaxCheck(source, "commands.py");
      if (expected === null) {
        expect(verdict).toEqual({ valid: true, message: "" });
      } else {
        expect(verdict.valid).toBe(false);
        expect(verdict.message).toMatch(new RegExp(`^${expected}$`));
      }
    });
  }

  pythonIt("never rejects valid Python and never accepts what its own checks prove invalid (vs the real interpreter)", () => {
    const python = findPython();
    expect(python).not.toBeNull();
    const snippets = [
      "x = 1\n",
      "def f(a,\n      b):\n    return a + b\n",
      'x = """doc\nstring"""\n',
      "x = r'\\'\n",
      "s = 'it\\'s'\n",
      "if 1:\n\tx = 1\n\ty = 2\n",
      "x = [\n 1,\n  2,\n]\n# comment (\n",
      "x = f'{1}' f\"{2}\"\n",
      "x = 1 + \\\n  2\n",
      "class A:\n    def m(self):\n        pass\n\n    # c\n    y = 1\n",
      "\n\n   \n# only comments\n",
      "x = 'a' 'b'\n",
      "x = ('a'\n     \"b\")\n",
      "x = 'abc\n",
      'x = """abc\n',
      "x = (1,\n",
      "x = 1)\n",
      "x = (1]\n",
      "if 1:\n        x = 1\n    y = 2\n",
      "x = 1\n    y = 2\n",
      "def broken(:\n",
    ];
    const script = [
      "import ast, json, sys",
      "out = []",
      "for src in json.load(sys.stdin):",
      "    try:",
      "        ast.parse(src)",
      "        out.append(True)",
      "    except (SyntaxError, ValueError):",
      "        out.append(False)",
      "print(json.dumps(out))",
    ].join("\n");
    const r = spawnSync(python as string, ["-c", script], { input: JSON.stringify(snippets), encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const real = JSON.parse(r.stdout) as boolean[];
    snippets.forEach((src, i) => {
      const lexical = lexicalSyntaxCheck(src, "commands.py").valid;
      if (real[i]) expect(lexical, JSON.stringify(src)).toBe(true);
      // `def broken(:` is a grammar error the lexical fallback documents it cannot see only when brackets balance.
      else if (src !== "def broken(:\n") expect(lexical, JSON.stringify(src)).toBe(false);
    });
  });
});
