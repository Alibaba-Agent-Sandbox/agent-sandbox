/**
 * Provider template profiles: default alicloud-express, an explicit provider with no profile, and a missing profile.
 * The generator must say when it substituted the generic Docker profile, and must not fall through to the FC image.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { validateTemplateWorkspace } from "../../src/agent/codegen.js";
import { buildTemplateGuide } from "../../src/agent/template_guide.js";
import { renderScaffold } from "../../src/cli/scaffold.js";
import * as installer from "../../src/providers/installer.js";
import { resetCliSelection, setCliProvider } from "../../src/providers/selection.js";
import { resolveTemplateProfile } from "../../src/providers/template_profile.js";
import { resetLayeredConfig } from "../../src/transport/config_layers.js";
import { useIso } from "../_support/iso.js";
import { TEST_HOST_VERSION, writePlugin } from "../_support/plugins.js";

const iso = useIso();
const CMD_INSTRUCTION = /(?:^|\n)[ \t]*CMD[ \t]/;
const FC_FROM = "FROM fc-e2b-registry.<region>.cr.aliyuncs.com/runtime/base:<tag>";

const GENERIC_TABLE = `
[template]
base_image = "python:3.12-slim"
entrypoint_replaceable = true
server_start = "image_cmd"
cmd = ["python3", "commands.py"]
arch = "linux/amd64"
workdir = "/app"
reserved_ports = []
registry = "pull by image URI; no region-locked FC registry; no envdInject; private-registry auth stays in provider config"
`;

let tmp = "";
beforeEach(() => {
  resetCliSelection();
  tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "abx-tprof-"));
});
afterEach(() => {
  resetCliSelection();
  resetLayeredConfig();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function workspace(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(tmp, "ws-"));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

const YAML = "name: demo\ndescription: demo\nresources:\n  cpu: 1\n  memory: 512\n";
const MAIN_COMMANDS =
  "from agent_sandbox.server import SandboxServer\n" +
  "if __name__ == '__main__':\n" +
  "    SandboxServer().serve(port=9000)\n";
const IMPORT_COMMANDS = "from agent_sandbox.server import SandboxServer\nSandboxServer().serve(port=9000)\n";
const NO_CMD_DOCKER = "FROM python:3.12-slim\nCOPY commands.py .\nEXPOSE 9000\n";
const CMD_DOCKER = 'FROM python:3.12-slim\nCOPY commands.py .\nCMD ["python3", "commands.py"]\n';

describe("template profile selection", () => {
  it("defaults to the alicloud-express FC profile", () => {
    const profile = resolveTemplateProfile();
    expect(profile.provider_id).toBe("alicloud-express");
    expect(profile.missing_profile).toBe(false);
    expect(profile.notice).toBe("");
    expect(profile.base_image).toBe("fc-e2b-registry.<region>.cr.aliyuncs.com/runtime/base:<tag>");
    expect(profile.server_start).toBe("platform_start_cmd");
    expect(profile.entrypoint_replaceable).toBe(false);
    expect(profile.cmd).toBeNull();
    expect(profile.start_cmd).toBe("agent-sandbox-server serve --port 9000 --commands /home/user/app/commands.py");
    expect(profile.ready_cmd).toBe("agent-sandbox-server healthcheck --port 9000");
    expect(profile.workdir).toBe("/home/user/app");
    expect(profile.arch).toBe("linux/amd64");
    expect([...profile.reserved_ports]).toEqual([49983, 5000, 49999]);
  });

  it("uses the generic profile for an explicit provider that declares none", () => {
    setCliProvider("opensandbox");
    const profile = resolveTemplateProfile();
    expect(profile.provider_id).toBe("opensandbox");
    expect(profile.missing_profile).toBe(true);
    expect(profile.base_image).toBe("python:3.12-slim");
    expect(profile.server_start).toBe("image_cmd");
    expect(profile.cmd).toEqual(["python3", "commands.py"]);
    expect(profile.reserved_ports).toEqual([]);
    expect(profile.notice).toContain("opensandbox");
    expect(profile.notice).toContain("has no template profile");
    expect(profile.notice).not.toContain("fc-e2b-registry");
    expect(profile.base_image).not.toContain("fc-e2b-registry");
  });

  it("uses the generic profile and says so when the provider id is unknown", () => {
    const profile = resolveTemplateProfile("no-such-provider");
    expect(profile.provider_id).toBe("no-such-provider");
    expect(profile.missing_profile).toBe(true);
    expect(profile.base_image).toBe("python:3.12-slim");
    expect(profile.base_image).not.toContain("fc-e2b-registry");
    expect(profile.notice).toContain("no-such-provider");
    expect(profile.notice).toContain("has no template profile");
  });

  it("keeps a declared [template] table, including an explicit generic profile", async () => {
    const src = writePlugin(path.join(tmp, "plug"), { id: "demo-prov", extra: GENERIC_TABLE });
    await installer.install(src, { yes: true, hostVersion: TEST_HOST_VERSION });
    const declared = resolveTemplateProfile("demo-prov");
    expect(declared.missing_profile).toBe(false);
    expect(declared.notice).toBe("");
    expect(declared.base_image).toBe("python:3.12-slim");
    expect(declared.server_start).toBe("image_cmd");
    expect(declared.entrypoint_replaceable).toBe(true);
    expect(declared.base_image).not.toContain("fc-e2b-registry");

    const bare = writePlugin(path.join(tmp, "bare"), { id: "bare-prov" });
    await installer.install(bare, { yes: true, hostVersion: TEST_HOST_VERSION });
    const missing = resolveTemplateProfile("bare-prov");
    expect(missing.missing_profile).toBe(true);
    expect(missing.base_image).toBe("python:3.12-slim");
    expect(missing.notice).toContain("bare-prov");
    expect(missing.base_image).not.toContain("fc-e2b-registry");
  });
});

describe("template guide text", () => {
  it("describes only the FC profile for alicloud-express and only the generic profile otherwise", () => {
    const alicloud = buildTemplateGuide("create", "alicloud-express");
    const generic = buildTemplateGuide("create", "no-such-provider");
    expect(alicloud).toContain(FC_FROM);
    expect(alicloud).not.toMatch(CMD_INSTRUCTION);
    expect(alicloud).not.toContain("python:3.12-slim");
    expect(alicloud).toContain("agent-sandbox-server");
    expect(alicloud).toContain("/home/user/app");
    expect(alicloud).toContain("generation: 2");
    expect(generic).toContain("FROM python:3.12-slim");
    expect(generic).toContain('CMD ["python3", "commands.py"]');
    expect(generic).toContain("no-such-provider");
    expect(generic).toContain("has no template profile");
    expect(generic).not.toContain("fc-e2b-registry");
  });
});

describe("scaffold dockerfiles", () => {
  it("uses the FC base and no CMD or ENTRYPOINT for the default provider", () => {
    const files = renderScaffold("python", "demo");
    const docker = files.get("Dockerfile") ?? "";
    const commands = files.get("commands.py") ?? "";
    expect(docker.startsWith(`${FC_FROM}\n`)).toBe(true);
    expect(docker).not.toMatch(CMD_INSTRUCTION);
    expect(docker).not.toMatch(/(?:^|\n)[ \t]*ENTRYPOINT[ \t]/);
    expect(docker).toContain("pip install --no-cache-dir agent-sandbox-server");
    expect(docker).not.toMatch(/pip install --no-cache-dir agent-sandbox(?!-server)/);
    expect(docker).toContain("WORKDIR /home/user/app");
    expect(commands).toContain('if __name__ == "__main__":');
    expect(commands).toContain("start(int(os.environ.get(\"ABX_SERVER_PORT\", \"9000\")))");
    expect(commands).toContain('@command("hello"');
    expect(commands).not.toContain(".serve(");
    expect(commands).toContain("agent_sandbox.server");
    expect(commands).not.toMatch(/alicloud|opensandbox/);
    const yaml = files.get("template.yaml") ?? "";
    expect(yaml).toContain("generation: 2");
    expect(yaml).toContain('start_cmd: "agent-sandbox-server serve --port 9000 --commands /home/user/app/commands.py"');
    expect(yaml).toContain('ready_cmd: "agent-sandbox-server healthcheck --port 9000"');
    const minimal = renderScaffold("minimal", "demo").get("template.yaml") ?? "";
    expect(minimal).not.toContain("generation:");
    expect(minimal).not.toContain("start_cmd:");
  });

  it("uses the generic base and CMD when the selected provider has no profile", () => {
    iso.setenv("ABX_PROVIDER", "opensandbox");
    const files = renderScaffold("node", "demo");
    const docker = files.get("Dockerfile") ?? "";
    expect(docker.startsWith("FROM python:3.12-slim\n")).toBe(true);
    expect(docker).toContain('CMD ["python3", "commands.py"]');
    expect(docker).toContain("WORKDIR /app");
    expect(docker).not.toContain("fc-e2b-registry");
    expect(docker).toContain("agent-sandbox-server");
    const yaml = files.get("template.yaml") ?? "";
    expect(yaml).not.toContain("generation:");
    expect(yaml).not.toContain("start_cmd:");
  });
});

describe("generated workspace validation", () => {
  it("rejects CMD, ENTRYPOINT, and import-time serve for platform_start_cmd", () => {
    const cmdDir = workspace({ Dockerfile: CMD_DOCKER, "commands.py": MAIN_COMMANDS, "template.yaml": YAML });
    expect(() => validateTemplateWorkspace(cmdDir, "demo", { providerId: "alicloud-express" })).toThrow(/CMD or ENTRYPOINT/);
    const entryDir = workspace({
      Dockerfile: "FROM python:3.12-slim\nCOPY commands.py .\nENTRYPOINT [\"python3\", \"commands.py\"]\n",
      "commands.py": MAIN_COMMANDS,
      "template.yaml": YAML,
    });
    expect(() => validateTemplateWorkspace(entryDir, "demo", { providerId: "alicloud-express" })).toThrow(/CMD or ENTRYPOINT/);
    const importDir = workspace({ Dockerfile: NO_CMD_DOCKER, "commands.py": IMPORT_COMMANDS, "template.yaml": YAML });
    expect(() => validateTemplateWorkspace(importDir, "demo", { providerId: "alicloud-express" })).toThrow(/import time/);
    const ok = workspace({ Dockerfile: NO_CMD_DOCKER, "commands.py": MAIN_COMMANDS, "template.yaml": YAML });
    expect(validateTemplateWorkspace(ok, "demo", { providerId: "alicloud-express" })["name"]).toBe("demo");
  });

  it("keeps CMD and still requires serve() for image_cmd", () => {
    const ok = workspace({ Dockerfile: CMD_DOCKER, "commands.py": IMPORT_COMMANDS, "template.yaml": YAML });
    expect(validateTemplateWorkspace(ok, "demo", { providerId: "opensandbox" })["name"]).toBe("demo");
    const noServe = workspace({
      Dockerfile: CMD_DOCKER,
      "commands.py": "print('hi')\n",
      "template.yaml": YAML,
    });
    expect(() => validateTemplateWorkspace(noServe, "demo", { providerId: "opensandbox" })).toThrow(/agent_sandbox\.server/);
  });
});
