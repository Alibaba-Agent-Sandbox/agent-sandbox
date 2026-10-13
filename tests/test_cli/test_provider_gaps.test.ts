/**
 * Plugin-provider behaviour of commands that used to assume the built-in Alibaba Cloud provider: template commands
 * answer E8004 before any ACR/Docker work, named commands answer E8004 instead of an untyped crash, capabilities come
 * from the provider's declared features, and SandboxInfo carries no built-in region/timeout defaults.
 */

import "../_support/isolatedHome.js";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { main } from "../../src/cli/main.js";
import * as installer from "../../src/providers/installer.js";
import { useIso } from "../_support/iso.js";
import { LOCAL_PROCESS, TEST_HOST_VERSION, pythonAvailable } from "../_support/plugins.js";
import { useCapsys } from "./conftest.js";

useIso();
const cap = useCapsys();
const hasPython = pythonAvailable();
let tmp = "";
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "abx-gaps-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function abx(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  const code = await main({ args });
  const { out, err } = cap.readouterr();
  return { code, out, err };
}

const installLocal = (): Promise<unknown> => installer.install(LOCAL_PROCESS, { yes: true, hostVersion: TEST_HOST_VERSION });

describe("template commands honour the active provider", () => {
  const cases: Array<[string, string[]]> = [
    ["build", ["template", "build", "."]],
    ["deploy", ["template", "deploy", "."]],
    ["deploy shortcut", ["deploy", "."]],
    ["push", ["template", "push", "registry.example/ns/img:1"]],
    ["create", ["template", "create", "registry.example/ns/img:1", "--name", "t"]],
    ["install", ["template", "install", "owner/repo"]],
    ["delete", ["template", "delete", "tpl-1", "--yes"]],
    ["list", ["template", "list"]],
    ["info", ["template", "info", "tpl-1"]],
  ];

  for (const [name, args] of cases) {
    it(`test_${name.replace(" ", "_")}_answers_e8004_on_a_provider_without_templates`, async () => {
      await installLocal();
      const r = await abx("--provider", "local-process", ...args);
      const text = r.err + r.out;
      expect(text).toContain("E8004");
      expect(text).toContain("local-process");
      expect(text).toMatch(/templates\.(read|build)/);
      expect(r.code).toBe(1);
    });
  }

  it("test_the_configured_default_provider_is_honoured_too", async () => {
    await installLocal();
    expect((await abx("provider", "default", "local-process")).code).toBe(0);
    const r = await abx("template", "list");
    expect(r.err + r.out).toContain("E8004");
  });

  it("test_download_only_install_needs_no_provider_feature", async () => {
    await installLocal();
    const r = await abx("--provider", "local-process", "template", "install", path.join(tmp, "missing"), "--download-only");
    expect(r.err + r.out).not.toContain("E8004");
  });
});

describe.skipIf(!hasPython)("a plugin sandbox", () => {
  async function createSandbox(): Promise<string> {
    await installLocal();
    const created = await abx("--json", "--provider", "local-process", "create", "--template", "base");
    expect(created.code, created.err).toBe(0);
    return JSON.parse(created.out).ID as string;
  }

  it("test_named_commands_answer_e8004_not_an_untyped_crash", async () => {
    const sid = await createSandbox();
    for (const args of [
      ["sandbox", "command", "list", sid],
      ["sandbox", "command", "run", sid, "build"],
    ]) {
      const r = await abx("--provider", "local-process", ...args);
      expect(r.err + r.out, args.join(" ")).toContain("E8004");
      expect(r.err + r.out).not.toContain("_createEnvdClient");
      expect(r.err + r.out).toContain("named commands");
      expect(r.code).toBe(1);
    }
  });

  it("test_capabilities_come_from_the_declared_features", async () => {
    const sid = await createSandbox();
    const r = await abx("--json", "--provider", "local-process", "sandbox", "capabilities", sid);
    expect(r.code, r.err).toBe(0);
    expect(JSON.parse(r.out).capabilities).toEqual(["files", "shell"]);
  });

  it("test_info_has_no_builtin_region_or_timeout_defaults", async () => {
    const sid = await createSandbox();
    const r = await abx("--json", "--provider", "local-process", "info", sid);
    expect(r.code, r.err).toBe(0);
    const doc = JSON.parse(r.out);
    expect(doc.Region).toBe("-");
    expect(doc.Timeout).toBe("-");
    const listed = await abx("--provider", "local-process", "list");
    expect(listed.out).not.toContain("cn-hangzhou");
    expect(listed.out).toMatch(/\s-$/m);
  });
});
