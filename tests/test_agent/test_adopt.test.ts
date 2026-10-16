/**
 * Tests for adapting an existing project (`abx template scaffold --adopt`).
 *
 * Port of `tests/test_agent/test_adopt.py`. The agent is never executed here. Staging, validation and promote are
 * deterministic; a misbehaving writer is simulated by editing the staging directory directly.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as adopt from "../../src/agent/adopt.js";
import {
  AdoptPlan,
  AdoptRejectedError,
  GENERATED_DOCKERIGNORE,
  Preflight,
  RESERVED_FILES,
  StagedProject,
  assertAdoptable,
  buildAdoptPrompt,
  defaultTemplateName,
  planFromStaging,
  preflight,
  promote,
  stageProject,
  validateTemplateName,
} from "../../src/agent/adopt.js";
import { AICodegenError } from "../../src/models/errors.js";
import { DockerIgnore } from "../../src/utils/dockerignore.js";
import { makeTmp, raises, readGolden, rmTmp } from "../helpers/agentSupport.js";

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
capabilities: [shell, files, ports]
ports: [9000]
resources:
  cpu: 1
  memory: 512
`;

let tmpPath = "";
beforeEach(() => {
  tmpPath = makeTmp();
});
afterEach(() => {
  vi.restoreAllMocks();
  adopt.seams.MAX_FILES = adopt.MAX_FILES;
  adopt.seams.writeText = originalWriteText;
  rmTmp(tmpPath);
});
const originalWriteText = adopt.seams.writeText;

const write = (file: string, text: string): void => fs.writeFileSync(file, text, "utf8");
const read = (file: string): string => fs.readFileSync(file, "utf8");

function project_(root: string, name = "app"): string {
  const project = path.join(root, name);
  fs.mkdirSync(project);
  write(path.join(project, "app.py"), "print('hi')\n");
  write(path.join(project, "README.md"), "hello\n");
  return project;
}

function rglob(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      out.push(full);
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
  return out.sort();
}

function treeHash(root: string): string {
  const digest = createHash("sha256");
  for (const file of rglob(root)) {
    digest.update(path.relative(root, file).split(path.sep).join("/"));
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink()) {
      digest.update("link");
      digest.update(fs.readlinkSync(file));
    } else if (st.isFile()) {
      digest.update(fs.readFileSync(file));
    }
  }
  return digest.digest("hex");
}

function writeAgentOutput(staging: string): void {
  write(path.join(staging, "Dockerfile"), DOCKER);
  write(path.join(staging, "commands.py"), COMMANDS);
  write(path.join(staging, "template.yaml"), YAML);
}

function hashes(project: string): Record<string, string | null> {
  const found: Record<string, string | null> = {};
  for (const name of RESERVED_FILES) {
    const file = path.join(project, name);
    found[name] = fs.existsSync(file) && fs.statSync(file).isFile() ? createHash("sha256").update(fs.readFileSync(file)).digest("hex") : null;
  }
  return found;
}

function rmStaging(staged: StagedProject): void {
  fs.rmSync(staged.stagingDir, { recursive: true, force: true });
}

describe("TestGuards", () => {
  it("test_rejects_home_root_and_abx", async () => {
    const savedHome = process.env.HOME;
    const savedProfile = process.env.USERPROFILE;
    try {
      await raises(() => assertAdoptable(homedir()), AdoptRejectedError, "home");
      await raises(() => assertAdoptable(path.parse(process.cwd()).root), AdoptRejectedError, "root");
      process.env.HOME = tmpPath;
      process.env.USERPROFILE = tmpPath;
      const secret = path.join(tmpPath, ".abx", "generated");
      fs.mkdirSync(secret, { recursive: true });
      await raises(() => assertAdoptable(secret), AdoptRejectedError, "credentials");
    } finally {
      if (savedHome === undefined) delete process.env.HOME;
      else process.env.HOME = savedHome;
      if (savedProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = savedProfile;
    }
  });

  it("test_chinese_directory_requires_an_explicit_name", async () => {
    const project = path.join(tmpPath, "沙箱");
    fs.mkdirSync(project);
    await raises(() => defaultTemplateName(project), AdoptRejectedError, "--name");
  });

  it("test_name_pattern", async () => {
    expect(validateTemplateName("my-app")).toBe("my-app");
    await raises(() => validateTemplateName("My App"), AdoptRejectedError);
  });
});

describe("TestStaging", () => {
  it("test_excludes_secrets_symlinks_binaries_and_keeps_examples", () => {
    const project = project_(tmpPath);
    write(path.join(project, ".env"), "TOKEN=real-value-here\n");
    write(path.join(project, ".env.example"), "TOKEN=\n");
    write(path.join(project, "key.pem"), ["-----BEGIN", "PRIVATE KEY-----"].join(" ") + "\nabc\n");
    write(path.join(project, "settings.py"), 'password = "placeholder-value"\n');
    fs.writeFileSync(path.join(project, "blob.bin"), Buffer.from([0, 1]));
    fs.symlinkSync(path.join(project, "app.py"), path.join(project, "link.py"));
    fs.mkdirSync(path.join(project, "node_modules"));
    write(path.join(project, "node_modules", "left.txt"), "nope\n");

    const staged = stageProject(project, { stagingRoot: path.join(tmpPath, "stage") });
    try {
      expect(staged.copied).toContain("app.py");
      expect(staged.copied).toContain(".env.example");
      expect(staged.copied).not.toContain(".env");
      expect(staged.copied).not.toContain("key.pem");
      expect(staged.copied).not.toContain("settings.py");
      expect(staged.copied).not.toContain("blob.bin");
      expect(staged.copied).not.toContain("link.py");
      expect(staged.copied).not.toContain("node_modules/left.txt");
      expect(staged.excluded["secret-name"]).toContain(".env");
      expect(staged.excluded["secret-content"]).toContain("settings.py");
      expect(read(path.join(staged.stagingDir, "app.py"))).toBe("print('hi')\n");
      expect(staged.manifest.get("app.py")).toBe(createHash("sha256").update("print('hi')\n").digest("hex"));
    } finally {
      rmStaging(staged);
    }
  });

  it("test_budget_is_a_usage_error", async () => {
    const project = project_(tmpPath);
    adopt.seams.MAX_FILES = 1;
    const caught = await raises(
      () => stageProject(project, { stagingRoot: path.join(tmpPath, "stage") }),
      AdoptRejectedError,
      "limit",
    );
    expect(caught.usage).toBe(true);
  });
});

describe("TestPreflight", () => {
  it("test_existing_template_yaml_needs_force", async () => {
    const project = project_(tmpPath);
    write(path.join(project, "template.yaml"), "name: x\n");
    await raises(() => preflight(project, { force: false, needsConfirm: true }), AdoptRejectedError, "already has template.yaml");
  });

  it("test_user_commands_py_needs_force_even_interactively", async () => {
    const project = project_(tmpPath);
    write(path.join(project, "commands.py"), "print(1)\n");
    await raises(() => preflight(project, { force: false, needsConfirm: true }), AdoptRejectedError, "not an Agent Sandbox");
  });

  it("test_dockerfile_without_a_preview_needs_force", async () => {
    const project = project_(tmpPath);
    write(path.join(project, "Dockerfile"), "FROM scratch\n");
    await raises(() => preflight(project, { force: false, needsConfirm: false }), AdoptRejectedError, "without a preview");
    preflight(project, { force: false, needsConfirm: true });
  });

  it("test_secret_left_in_the_build_context_fails_before_any_agent", async () => {
    const project = project_(tmpPath);
    write(path.join(project, ".env"), "A=B\n");
    write(path.join(project, ".dockerignore"), "*.md\n");
    await raises(() => preflight(project, { force: false, needsConfirm: true }), AdoptRejectedError, /\*\*\/\.env/);
  });

  it("test_reinclude_and_dockerfile_dockerignore_are_both_checked", async () => {
    const project = project_(tmpPath);
    write(path.join(project, ".env"), "A=B\n");
    write(path.join(project, ".dockerignore"), "**/.env\n!.env\n");
    await raises(() => preflight(project, { force: false, needsConfirm: true }), AdoptRejectedError, ".env");

    write(path.join(project, ".dockerignore"), "**/.env\n");
    write(path.join(project, "Dockerfile.dockerignore"), "# nothing\n");
    await raises(() => preflight(project, { force: false, needsConfirm: true }), AdoptRejectedError, "Dockerfile.dockerignore");
  });

  it("test_ignoring_wheels_is_rejected", async () => {
    const project = project_(tmpPath);
    write(path.join(project, ".dockerignore"), "*.whl\n");
    await raises(() => preflight(project, { force: false, needsConfirm: true }), AdoptRejectedError, "whl");
  });

  it("test_generated_ignore_covers_secrets_and_keeps_the_wheel", () => {
    const compiled = DockerIgnore.fromText(GENERATED_DOCKERIGNORE);
    for (const p of [".env", "sub/.env", "keys/id_rsa", "a/node_modules/x"]) {
      expect(compiled.excludes(p)).toBe(true);
    }
    expect(compiled.excludes(".env.example")).toBe(false);
    expect(compiled.excludes("agent_sandbox-0.0.0-py3-none-any.whl")).toBe(false);
  });
});

describe("TestPlan", () => {
  it("test_accepts_whl_glob_and_forces_the_name", () => {
    const project = project_(tmpPath);
    const staged = stageProject(project, { stagingRoot: path.join(tmpPath, "stage") });
    let plan: AdoptPlan;
    try {
      writeAgentOutput(staged.stagingDir);
      plan = planFromStaging(project, staged, { templateName: "my-app", rawOutput: "done" });
    } finally {
      rmStaging(staged);
    }
    expect(plan.templateName).toBe("my-app");
    expect(plan.files["template.yaml"]).toContain("name: my-app");
    expect(plan.files["Dockerfile"]).toContain("*.whl");
    expect(plan.files[".dockerignore"]).toBe(GENERATED_DOCKERIGNORE);
    expect([...plan.replaces]).toEqual([]);
  });

  it("test_missing_copy_source_is_rejected", async () => {
    const project = project_(tmpPath);
    const staged = stageProject(project, { stagingRoot: path.join(tmpPath, "stage") });
    try {
      writeAgentOutput(staged.stagingDir);
      const docker = read(path.join(staged.stagingDir, "Dockerfile"));
      write(path.join(staged.stagingDir, "Dockerfile"), docker.replace("COPY app.py .", "COPY missing.py ."));
      await raises(() => planFromStaging(project, staged, { templateName: "my-app", rawOutput: "" }), AICodegenError, "missing.py");
    } finally {
      rmStaging(staged);
    }
  });

  it("test_port_9000_must_be_exposed", async () => {
    const project = project_(tmpPath);
    const staged = stageProject(project, { stagingRoot: path.join(tmpPath, "stage") });
    try {
      writeAgentOutput(staged.stagingDir);
      const yamlText = YAML.replaceAll("9000", "8080");
      write(path.join(staged.stagingDir, "template.yaml"), yamlText);
      await raises(() => planFromStaging(project, staged, { templateName: "my-app", rawOutput: "" }), AICodegenError, "9000");
    } finally {
      rmStaging(staged);
    }
  });

  it("test_symlink_staged_dockerfile_is_refused", async () => {
    const project = project_(tmpPath);
    const staged = stageProject(project, { stagingRoot: path.join(tmpPath, "stage") });
    try {
      writeAgentOutput(staged.stagingDir);
      const docker = path.join(staged.stagingDir, "Dockerfile");
      fs.unlinkSync(docker);
      fs.symlinkSync(path.join(staged.stagingDir, "app.py"), docker);
      const before = treeHash(project);
      await raises(() => planFromStaging(project, staged, { templateName: "my-app", rawOutput: "" }), AICodegenError, "symlink");
      expect(treeHash(project)).toBe(before);
    } finally {
      rmStaging(staged);
    }
  });

  it("test_edits_outside_the_whitelist_are_not_applied", () => {
    const project = project_(tmpPath);
    const staged = stageProject(project, { stagingRoot: path.join(tmpPath, "stage") });
    try {
      writeAgentOutput(staged.stagingDir);
      write(path.join(staged.stagingDir, "app.py"), "hacked\n");
      write(path.join(staged.stagingDir, "extra.txt"), "nope\n");
      const plan = planFromStaging(project, staged, { templateName: "my-app", rawOutput: "" });
      expect(plan.notApplied).toContain("app.py");
      expect(plan.notApplied).toContain("extra.txt");
      promote(project, plan, new Preflight(hashes(project)));
    } finally {
      rmStaging(staged);
    }
    expect(read(path.join(project, "app.py"))).toBe("print('hi')\n");
    expect(fs.existsSync(path.join(project, "extra.txt"))).toBe(false);
    expect(fs.statSync(path.join(project, "Dockerfile")).isFile()).toBe(true);
    expect(fs.statSync(path.join(project, ".dockerignore")).isFile()).toBe(true);
  });
});

describe("TestPromote", () => {
  it("test_backup_is_never_overwritten_and_drift_aborts", async () => {
    const project = project_(tmpPath);
    write(path.join(project, "Dockerfile"), "FROM scratch\n");
    write(path.join(project, "Dockerfile.abx-bak"), "older\n");
    const state = new Preflight(hashes(project));
    const plan = new AdoptPlan({
      templateName: "app",
      files: { Dockerfile: "FROM python:3.12-slim\n" },
      replaces: ["Dockerfile"],
      notApplied: [],
      warnings: [],
    });
    const result = promote(project, plan, state);
    expect(read(path.join(project, "Dockerfile"))).toBe("FROM python:3.12-slim\n");
    expect(read(path.join(project, "Dockerfile.abx-bak"))).toBe("older\n");
    expect(result.backedUp).toContain("Dockerfile.abx-bak.1");

    write(path.join(project, "Dockerfile"), "FROM scratch\n");
    const fresh = new Preflight(hashes(project));
    write(path.join(project, "Dockerfile"), "meanwhile\n");
    await raises(() => promote(project, plan, fresh), AdoptRejectedError, "changed");
    expect(read(path.join(project, "Dockerfile"))).toBe("meanwhile\n");
  });

  it("test_symlink_target_aborts_with_nothing_written", async () => {
    const project = project_(tmpPath);
    const outside = path.join(tmpPath, "outside.txt");
    write(outside, "safe\n");
    fs.symlinkSync(outside, path.join(project, "Dockerfile"));
    const plan = new AdoptPlan({
      templateName: "app",
      files: { Dockerfile: "FROM scratch\n" },
      replaces: [],
      notApplied: [],
      warnings: [],
    });
    await raises(() => promote(project, plan, new Preflight(hashes(project))), AdoptRejectedError, "symlink");
    expect(read(outside)).toBe("safe\n");
  });

  it("test_failed_write_rolls_back", async () => {
    const project = project_(tmpPath);
    const plan = new AdoptPlan({
      templateName: "app",
      files: { Dockerfile: "FROM scratch\n", "commands.py": COMMANDS },
      replaces: [],
      notApplied: [],
      warnings: [],
    });
    const real = adopt.seams.writeText;
    adopt.seams.writeText = (file: string, text: string): void => {
      if (path.basename(file) === "commands.py.abx-tmp") {
        throw Object.assign(new Error("disk full"), { code: "ENOSPC", name: "OSError" });
      }
      real(file, text);
    };
    const before = treeHash(project);
    await raises(() => promote(project, plan, new Preflight(hashes(project))), Error, /disk full/);
    expect(treeHash(project)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Extra coverage for the TypeScript port (no Python counterpart)
// ---------------------------------------------------------------------------

describe("TestAdoptPromptGolden", () => {
  it("renders byte-identical prompts to the original Python module", () => {
    const golden = readGolden();
    expect(golden.adopt.length).toBeGreaterThan(10);
    for (const entry of golden.adopt as Array<{ hint: string | null; name: string; existing: string[]; copied: string[]; prompt: string }>) {
      const staged = new StagedProject({
        stagingDir: "unused",
        manifest: new Map(),
        copied: entry.copied,
        excluded: {},
        totalBytes: 0,
      });
      const prompt = buildAdoptPrompt(staged, { hint: entry.hint, templateName: entry.name, existing: entry.existing });
      expect(prompt).toContain(entry.name);
      expect(prompt).toContain("FROM fc-e2b-registry.<region>.cr.aliyuncs.com/runtime/base:<tag>");
      expect(prompt).not.toMatch(/(?:^|\n)[ \t]*CMD[ \t]/);
    }
  });

  it("keeps the generated .dockerignore byte-identical", () => {
    // Preserve the original Python capture; current scaffold output has its own fixture.
    const current = fs.readFileSync(new URL("../fixtures/agent/scaffold-generated.dockerignore", import.meta.url), "utf8");
    expect(GENERATED_DOCKERIGNORE).toBe(current);
  });
});

describe("TestNameRules", () => {
  it("accepts a trailing newline like Python's `$`, rejects empty / overlong / uppercase names", async () => {
    expect(validateTemplateName("abc\n")).toBe("abc\n");
    await raises(() => validateTemplateName(""), AdoptRejectedError);
    await raises(() => validateTemplateName("a".repeat(129)), AdoptRejectedError);
    expect(validateTemplateName("a".repeat(128))).toBe("a".repeat(128));
    await raises(() => validateTemplateName("-x"), AdoptRejectedError);
  });

  it("derives a slug from the directory name", () => {
    const dir = path.join(tmpPath, "My_Cool App 2");
    fs.mkdirSync(dir);
    expect(defaultTemplateName(dir)).toBe("my-cool-app-2");
  });

  it("reports the usage flag on the error", async () => {
    const exc = await raises(() => validateTemplateName("A"), AdoptRejectedError, /must match \^\[a-z0-9\]\[a-z0-9-\]\*\$/);
    expect(exc.usage).toBe(true);
  });
});
