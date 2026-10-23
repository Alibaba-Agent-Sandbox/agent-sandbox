/**
 * CLI tests for `abx template scaffold --adopt`.
 *
 * The coding agent is a fake that writes a valid template into its cwd. No model, Docker or cloud call is made.
 * `abx deploy` is then checked only as far as the fixed pipeline hand-off.
 */

import "../_support/isolatedHome.js";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import * as codingAgent from "../../src/cli/commands/_coding_agent.js";
import * as sandboxCommand from "../../src/cli/commands/sandbox.js";
import * as guidance from "../../src/cli/config_guidance.js";
import { deploySeams } from "../../src/providers/alicloud_express/cli/deploy.js";
import { build as realBuild } from "../../src/providers/alicloud_express/cli/template.js";
import { cli } from "../../src/cli/main.js";
import { command } from "../../src/cli/kit.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { adoptSeams } from "../../src/cli/commands/_adopt.js";
import { useTmpPath, writeText } from "../helpers/templateSupport.js";


const runner = (): CliRunner => new CliRunner();
const tmpPath = useTmpPath();

const COMMANDS = `\
from agent_sandbox.server import CommandRegistry, SandboxServer

registry = CommandRegistry()
registry.freeze()
if __name__ == "__main__":
    SandboxServer(registry=registry).serve(port=9000)
`;

const DOCKER = `\
FROM python:3.12-slim
COPY *.whl /tmp/
RUN pip install --no-cache-dir agent-sandbox
WORKDIR /app
COPY commands.py .
COPY app.py .
EXPOSE 9000
`;

const YAML = `\
name: ignored
version: "1.0.0"
description: demo
spec_version: 4
workflow_contract_version: 1
provides:
  app: {protocol: agent-sandbox-server, version: 2, port: 9000, operations: [commands.list, commands.run]}
default_workflow: application
workflows:
  application:
    kind: application
    input: source
    service: app
    startup: none
    binding: {transport: http, endpoint: provider-port, caller: host, authentication: none}
    operation: commands.run
    required_operations: []

ports: [9000]
resources:
  cpu: 1
  memory: 512
`;

const _text = (result: { output: string; stderr: string }): string => (result.output || "") + (result.stderr || "");

function _project(): string {
  const project = path.join(tmpPath(), "app");
  writeText(path.join(project, "app.py"), "print('hi')\n");
  return project;
}

const read = (p: string): string => fs.readFileSync(p, "utf-8");
const exists = (p: string): boolean => fs.existsSync(p);

afterEach(() => {
  for (const name of fs.readdirSync(os.tmpdir())) {
    if (name.startsWith(`abx-adopt-${process.pid}`)) fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
  }
});

interface Seen {
  calls: number;
  env: Record<string, string> | null;
}

/** A backend that writes a valid template and records the call. */
function useAgent(): Seen {
  const seen: Seen = { calls: 0, env: null };
  const backend = {
    display_name: "Qwen Code",
    runInWorkspace: async (_prompt: string, opts: { workdir: string; env?: Record<string, string> | null }) => {
      seen.calls += 1;
      seen.env = { ...(opts.env ?? {}) };
      writeText(path.join(opts.workdir, "Dockerfile"), DOCKER);
      writeText(path.join(opts.workdir, "commands.py"), COMMANDS);
      writeText(path.join(opts.workdir, "template.yaml"), YAML);
      return "done";
    },
  };
  const creds = {
    base_url: "https://dashscope.example/compatible-mode/v1",
    baseUrl: "https://dashscope.example/compatible-mode/v1",
    asEnv: () => ({ OPENAI_API_KEY: "sk-test", OPENAI_BASE_URL: "https://dashscope.example/compatible-mode/v1" }),
  };
  vi.spyOn(codingAgent, "resolveCodingAgentBackend").mockReturnValue(backend as never);
  vi.spyOn(codingAgent, "ensureCodingAgentBinary").mockResolvedValue("qwen");
  vi.spyOn(codingAgent, "resolveCodingAgentCredentials").mockResolvedValue(creds as never);
  return seen;
}

describe("TestFlags", () => {
  it("announces only the model host without URL credentials or query values", async () => {
    useAgent();
    const credentials = { baseUrl: "https://user:private-fixture@models.example/v1?key=query-fixture", asEnv: () => ({}) };
    vi.mocked(codingAgent.resolveCodingAgentCredentials).mockResolvedValue(credentials);
    const result = await runner().invoke(cli, ["template", "scaffold", _project(), "--adopt", "-y"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("models.example");
    expect(result.output).not.toContain("private-fixture");
    expect(result.output).not.toContain("query-fixture");
  });

  it("offers one replacement model for adoption and keeps the change command-only", async () => {
    useAgent();
    const backend = codingAgent.resolveCodingAgentBackend();
    const original = backend.runInWorkspace.bind(backend);
    const run = vi.spyOn(backend, "runInWorkspace").mockRejectedValueOnce(new Error("model not exist")).mockImplementationOnce(original);
    vi.spyOn(adoptSeams, "_isInteractive").mockReturnValue(true);
    vi.spyOn(guidance, "canGuideConfiguration").mockReturnValue(true);
    const pick = vi.spyOn(sandboxCommand, "_pickReplacementModel").mockResolvedValue("replacement-model");
    const result = await runner().invoke(cli, ["template", "scaffold", _project(), "--adopt"], { input: "y\nn\ny\n" });
    expect(result.exit_code, result.output).toBe(0);
    expect(pick).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledTimes(2);
    expect(codingAgent.resolveCodingAgentCredentials).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ model: "replacement-model" }));
    expect(result.output).toContain("only for this command");
    expect(result.output).toContain("abx config set llm_model");
  });

  it("forwards an explicit model to the adoption backend", async () => {
    useAgent();
    const result = await runner().invoke(cli, ["template", "scaffold", _project(), "--adopt", "--model", "chosen-model", "-y"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(codingAgent.resolveCodingAgentCredentials).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ model: "chosen-model" }));
  });

  it("test_hint_and_dry_run_require_adopt", async () => {
    for (const args of [["--hint", "redis"], ["--dry-run"]]) {
      const result = await runner().invoke(cli, ["template", "scaffold", ...args]);
      expect(result.exit_code).toBe(2);
      expect(_text(result)).toContain("--adopt");
    }
  });

  it("test_adopt_rejects_scaffold_and_from", async () => {
    const project = _project();
    const result = await runner().invoke(cli, ["template", "scaffold", "--adopt", project, "-t", "python"]);
    expect(result.exit_code).toBe(2);
    expect(_text(result)).toContain("cannot be combined");
  });

  it("test_a_sentence_is_not_a_directory", async () => {
    const result = await runner().invoke(cli, ["template", "scaffold", "--adopt", "a python app", "-y"]);
    expect(result.exit_code).toBe(2);
    expect(_text(result)).toContain("--hint");
  });

  it("test_noninteractive_without_yes_sends_nothing", async () => {
    const agent = useAgent();
    const project = _project();
    const result = await runner().invoke(cli, ["template", "scaffold", "--adopt", project]);
    expect(result.exit_code).toBe(2);
    expect(_text(result)).toContain("Confirmation required");
    expect(agent.calls).toBe(0);
    expect(exists(path.join(project, "Dockerfile"))).toBe(false);
  });
});

describe("TestConsent", () => {
  it("test_declining_send_does_not_call_the_agent", async () => {
    const agent = useAgent();
    vi.spyOn(adoptSeams, "_isInteractive").mockReturnValue(true);
    const project = _project();
    const result = await runner().invoke(cli, ["template", "scaffold", "--adopt", project], { input: "n\n" });
    expect(result.exit_code).not.toBe(0);
    expect(_text(result)).toContain("Nothing was sent");
    expect(agent.calls).toBe(0);
    expect(exists(path.join(project, "Dockerfile"))).toBe(false);
  });
});

describe("TestDryRun", () => {
  it("test_lists_files_and_writes_nothing", async () => {
    const agent = useAgent();
    const project = _project();
    writeText(path.join(project, ".env"), "TOKEN=value\n");
    const result = await runner().invoke(cli, ["template", "scaffold", "--adopt", project, "--dry-run"]);
    const text = _text(result);
    expect(result.exit_code, text).toBe(0);
    expect(text).toContain("app.py");
    expect(text).toContain(".env");
    expect(text).toContain("nothing is sent");
    expect(agent.calls).toBe(0);
    expect(exists(path.join(project, "Dockerfile"))).toBe(false);
    expect(exists(path.join(project, "template.yaml"))).toBe(false);
  });
});

describe("TestAdopt", () => {
  it("test_writes_only_reserved_files_and_then_deploy_is_unchanged", async () => {
    const agent = useAgent();
    const project = _project();
    const result = await runner().invoke(cli, ["template", "scaffold", "--adopt", project, "--name", "my-app", "-y"]);
    const text = _text(result);
    expect(result.exit_code, text).toBe(0);
    expect(agent.calls).toBe(1);
    expect(agent.env).toEqual({
      OPENAI_API_KEY: "sk-test",
      OPENAI_BASE_URL: "https://dashscope.example/compatible-mode/v1",
    });
    expect(fs.statSync(path.join(project, "Dockerfile")).isFile()).toBe(true);
    expect(fs.statSync(path.join(project, "commands.py")).isFile()).toBe(true);
    expect(read(path.join(project, "template.yaml"))).toContain("name: my-app");
    expect(fs.statSync(path.join(project, ".dockerignore")).isFile()).toBe(true);
    expect(read(path.join(project, "app.py"))).toBe("print('hi')\n");
    expect(text).toContain("abx deploy");

    const calls: Array<Record<string, unknown>> = [];
    const savedBuild = deploySeams.build;
    const savedResolve = deploySeams.resolve_acr_namespace;
    try {
      deploySeams.build = command("build", {
        params: [...realBuild.params],
        callback: (_ctx: unknown, params: Record<string, unknown>) => {
          calls.push(params);
        },
      });
      deploySeams.resolve_acr_namespace = () => "ns";

      const boom = () => {
        throw new Error("agent");
      };
      vi.spyOn(codingAgent, "resolveCodingAgentBackend").mockImplementation(boom);
      vi.spyOn(codingAgent, "ensureCodingAgentBinary").mockImplementation(boom);
      vi.spyOn(codingAgent, "resolveCodingAgentCredentials").mockImplementation(boom);

      const deployed = await runner().invoke(cli, ["deploy", project, "--acr-namespace", "ns", "-y"]);
      expect(deployed.exit_code, _text(deployed)).toBe(0);
      expect(calls[0]!["template_dir"]).toBe(fs.realpathSync(project));
      expect(agent.calls).toBe(1);
    } finally {
      deploySeams.build = savedBuild;
      deploySeams.resolve_acr_namespace = savedResolve;
    }
  });

  it("test_agent_edits_outside_the_whitelist_do_not_land", async () => {
    const agent = useAgent();
    const project = _project();
    const nasty = {
      display_name: "Qwen Code",
      runInWorkspace: async (_prompt: string, opts: { workdir: string }) => {
        agent.calls += 1;
        const { workdir } = opts;
        writeText(path.join(workdir, "Dockerfile"), DOCKER);
        writeText(path.join(workdir, "commands.py"), COMMANDS);
        writeText(path.join(workdir, "template.yaml"), YAML);
        writeText(path.join(workdir, "app.py"), "hacked\n");
        writeText(path.join(path.dirname(workdir), "evil.txt"), "nope\n");
        return "done";
      },
    };
    vi.spyOn(codingAgent, "resolveCodingAgentBackend").mockReturnValue(nasty as never);
    const result = await runner().invoke(cli, ["template", "scaffold", "--adopt", project, "-y"]);
    expect(result.exit_code, _text(result)).toBe(0);
    expect(read(path.join(project, "app.py"))).toBe("print('hi')\n");
    expect(_text(result)).toContain("app.py");
    expect(exists(path.join(project, "evil.txt"))).toBe(false);
  });

  it("test_existing_dockerfile_without_force_is_refused", async () => {
    const agent = useAgent();
    const project = _project();
    writeText(path.join(project, "Dockerfile"), "FROM scratch\n");
    const result = await runner().invoke(cli, ["template", "scaffold", "--adopt", project, "-y"]);
    expect(result.exit_code).toBe(2);
    expect(_text(result)).toContain("without a preview");
    expect(agent.calls).toBe(0);
    expect(read(path.join(project, "Dockerfile"))).toBe("FROM scratch\n");
  });

  it("test_force_keeps_a_backup", async () => {
    useAgent();
    const project = _project();
    writeText(path.join(project, "Dockerfile"), "FROM scratch\n");
    const result = await runner().invoke(cli, ["template", "scaffold", "--adopt", project, "--force", "-y"]);
    expect(result.exit_code, _text(result)).toBe(0);
    expect(read(path.join(project, "Dockerfile"))).not.toBe("FROM scratch\n");
    expect(read(path.join(project, "Dockerfile.abx-bak"))).toBe("FROM scratch\n");
  });

  it("test_failed_generation_leaves_the_project_and_keeps_staging", async () => {
    const project = _project();
    const bad = {
      display_name: "Qwen Code",
      runInWorkspace: async (_prompt: string, opts: { workdir: string }) => {
        fs.symlinkSync(path.join(opts.workdir, "app.py"), path.join(opts.workdir, "Dockerfile"));
        return "done";
      },
    };
    vi.spyOn(codingAgent, "resolveCodingAgentBackend").mockReturnValue(bad as never);
    vi.spyOn(codingAgent, "ensureCodingAgentBinary").mockResolvedValue("qwen");
    vi.spyOn(codingAgent, "resolveCodingAgentCredentials").mockResolvedValue({ base_url: "", baseUrl: "", asEnv: () => ({}) } as never);
    const before = read(path.join(project, "app.py"));
    const result = await runner().invoke(cli, ["template", "scaffold", "--adopt", project, "-y"]);
    expect(result.exit_code).toBe(1);
    expect(_text(result)).toContain("symlink");
    expect(_text(result)).toContain("abx-adopt-");
    expect(read(path.join(project, "app.py"))).toBe(before);
    expect(exists(path.join(project, "Dockerfile"))).toBe(false);
  });

  it("test_deploy_missing_dockerfile_points_at_adopt", async () => {
    const saved = deploySeams.resolve_acr_namespace;
    deploySeams.resolve_acr_namespace = () => "ns";
    try {
      const result = await runner().invoke(cli, ["deploy", tmpPath()]);
      expect(result.exit_code).toBe(2);
      expect(_text(result)).toContain("scaffold --adopt");
    } finally {
      deploySeams.resolve_acr_namespace = saved;
    }
  });
});
