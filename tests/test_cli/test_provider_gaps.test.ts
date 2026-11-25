/**
 * Plugin-provider behaviour of commands that used to assume the built-in Alibaba Cloud provider: template commands
 * answer E8004 before any ACR/Docker work, unbound APIs fail before Provider data-plane access, capabilities come
 * from the provider's declared features, and SandboxInfo carries no built-in region/timeout defaults.
 */

import "../_support/isolatedHome.js";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "../../src/cli/main.js";
import { Sandbox } from "../../src/api/sandbox.js";
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
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function abx(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  const code = await main({ args });
  const { out, err } = cap.readouterr();
  return { code, out, err };
}

const installLocal = (): Promise<unknown> => installer.install(LOCAL_PROCESS, { yes: true, hostVersion: TEST_HOST_VERSION });

describe("template commands honour the active provider", () => {
  for (const operation of ["template.list", "template.get", "template.create", "template.delete"]) {
    it(`does not expose Express ${operation} for an unrelated provider`, async () => {
      await installLocal();
      const result = await abx("--provider", "local-process", "provider", "run", operation);
      expect(result.code).toBe(2); expect(result.err + result.out).toContain("No such command");
    });
  }
  it("the configured default provider does not inherit Express commands", async () => {
    await installLocal();
    expect((await abx("config", "set", "provider", "local-process")).code).toBe(0);
    const result = await abx("provider", "run", "template.list");
    expect(result.code).toBe(2); expect(result.err + result.out).toContain("No such command");
  });

  it("test_download_only_install_needs_no_provider_feature", async () => {
    await installLocal();
    const r = await abx("--provider", "local-process", "template", "init", "output", "--from", path.join(tmp, "missing"));
    expect(r.err + r.out).not.toContain("E8004");
  });
});

it("rejects an unbound API before loading or connecting to its Provider", async () => {
  const connect = vi.spyOn(Sandbox, "connect").mockRejectedValue(new Error("must not connect"));
  const run = vi.spyOn(Sandbox.prototype, "runCommand").mockRejectedValue(new Error("must not run via envd"));
  for (const args of [["sandbox", "unbound-id", "--help"], ["sandbox", "unbound-id", "report"]]) {
    const result = await abx("--provider", "not-installed", ...args);
    expect(result.err + result.out).toContain("No API contract is bound to this target");
    expect(result.err + result.out).not.toContain("E8001");
    expect(result.code).not.toBe(0);
  }
  expect(connect).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

describe.skipIf(!hasPython)("a plugin sandbox", () => {
  async function createSandbox(): Promise<string> {
    await installLocal();
    const created = await abx("--json", "--provider", "local-process", "create", "--yes", "--template", "base");
    expect(created.code, created.err).toBe(0);
    return JSON.parse(created.out).sandbox_id as string;
  }

  it("test_capabilities_come_from_the_declared_features", async () => {
    const sid = await createSandbox();
    const r = await abx("--json", "--provider", "local-process", "capabilities", sid);
    expect(r.code, r.err).toBe(0);
    expect(JSON.parse(r.out).capabilities).toEqual(["files", "shell"]);
  });

  it("test_info_has_no_builtin_region_or_timeout_defaults", async () => {
    const sid = await createSandbox();
    const r = await abx("--json", "--provider", "local-process", "status", sid);
    expect(r.code, r.err).toBe(0);
    const doc = JSON.parse(r.out);
    expect(doc.region).toBe("");
    expect(doc.timeout).toBe(0);
    const listed = await abx("--provider", "local-process", "list");
    expect(listed.out).not.toContain("cn-hangzhou");
    expect(listed.out).toContain("local-process");
  });
});
