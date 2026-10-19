/**
 * Adversarial review fixes (agent-template area): the `template init --adopt` validation gate (YAML acceptance, qwen
 * timeout overflow, `~user` expansion).
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  abx,
  put,
  sandbox,
  useAdvSandboxes,
} from "../helpers/advAgentTemplate.js";
import type { Run, Sandbox } from "../helpers/advAgentTemplate.js";

useAdvSandboxes();

describe("ADV-agent-template: template init --adopt validation gate", () => {
  const COMMANDS_OK =
    "from agent_sandbox.server import SandboxServer\n\nif __name__ == '__main__':\n    SandboxServer().serve(port=9000)\n";
  const DOCKER_OK =
    "FROM python:3.12-slim\nWORKDIR /app\nCOPY app.py commands.py /app/\nCOPY *.whl /tmp/\nEXPOSE 9000\n";
  const TEMPLATE_OK =
    'name: whatever\nversion: "1.0.0"\ndescription: adopted\nports: [9000]\nresources:\n  cpu: 1\n  memory: 512\n';

  /** Runs `template init --adopt` with a fake `qwen` that copies `$HOME/fix/*` into its cwd. */
  async function adopt(
    files: Record<string, string>,
    env: Record<string, string> = {},
  ): Promise<{ run: Run; sb: Sandbox }> {
    const sb = sandbox();
    put(sb.work, "app/app.py", "print('hi')\n");
    for (const [k, v] of Object.entries({
      Dockerfile: DOCKER_OK,
      "commands.py": COMMANDS_OK,
      "template.yaml": TEMPLATE_OK,
      ...files,
    }))
      put(sb.home, `fix/${k}`, v);
    const fake = path.join(sb.work, "fakeq", "qwen");
    mkdirSync(path.dirname(fake));
    writeFileSync(
      fake,
      '#!/bin/sh\ncp "$HOME"/fix/* .\necho \'[{"type":"result","subtype":"success","is_error":false,"result":"done"}]\'\n',
    );
    chmodSync(fake, 0o755);
    const run = await abx(
      sb,
      [
        "template",
        "scaffold",
        "--adopt",
        path.join(sb.work, "app"),
        "-y",
        "--name",
        "demo",
      ],
      {
        ABX_QWEN_CODE_BIN: fake,
        OPENAI_API_KEY: "sk-fake-key-for-test",
        ABX_QWEN_CODEGEN_TIMEOUT: "20",
        ...env,
      },
    );
    return { run, sb };
  }
  const firstError = (r: Run) =>
    r.stderr
      .split("\n")
      .find((l) => l.startsWith("[E") || l.startsWith("Unexpected error")) ??
    "<none>";

  it("ADV-agent-template-09 template.yaml carrying a !!python/object/apply tag is rejected (safe_load) and not promoted", async () => {
    const { run, sb } = await adopt({
      "template.yaml": `${TEMPLATE_OK}z: !!python/object/apply:os.system [echo pwn]\n`,
    });
    expect(firstError(run)).toBe(
      "[E2007] Generated template.yaml could not be parsed: Unresolved tag: tag:yaml.org,2002:python/object/apply:os.system at line 8, column 4:",
    );
    expect(existsSync(path.join(sb.work, "app", "template.yaml"))).toBe(false);
  });

  it("ADV-agent-template-10 template.yaml containing a NUL character is rejected by the YAML reader", async () => {
    const { run, sb } = await adopt({
      "template.yaml": "name: demo\0\nports: [9000]\n",
    });
    expect(firstError(run)).toBe(
      "[E2007] Generated template.yaml could not be parsed: Unacceptable character #x0000: special characters are not allowed",
    );
    expect(existsSync(path.join(sb.work, "app", "template.yaml"))).toBe(false);
  });

  it("ADV-agent-template-11 a timeout beyond setTimeout's 2^31-1 ms is a clean error, not an instant kill plus a Node warning", async () => {
    const { run } = await adopt({}, { ABX_QWEN_CODEGEN_TIMEOUT: "3000000" });
    expect(run.stderr).not.toContain("TimeoutOverflowWarning");
    expect(firstError(run)).toBe("Unexpected error: timeout is too large");
  });

  it("ADV-agent-template-12 ~user adopt target that cannot be expanded fails like Path.expanduser() (RuntimeError)", async () => {
    const sb = sandbox();
    const r = await abx(sb, [
      "template",
      "scaffold",
      "--adopt",
      "~nobodyxyz/proj",
      "-y",
      "--name",
      "demo",
    ]);
    expect(r.stderr.split("\n")[0]).toBe(
      "Unexpected error: Could not determine home directory.",
    );
  });
});
