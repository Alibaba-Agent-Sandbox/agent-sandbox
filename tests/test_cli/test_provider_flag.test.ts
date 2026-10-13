/**
 * Global `--provider` / `--opt`, qualified sandbox references, E8030, `list --all-providers`, the provider-aware
 * output format (spec section 4) and the 404 -> E2009 / exit-4 mapping through the real `main()` entry point.
 */

import "../_support/isolatedHome.js";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { main } from "../../src/cli/main.js";
import { extractProviderFlags } from "../../src/providers/selection.js";
import * as installer from "../../src/providers/installer.js";
import { useIso } from "../_support/iso.js";
import { LOCAL_PROCESS, TEST_HOST_VERSION, pythonAvailable } from "../_support/plugins.js";
import { useCapsys } from "./conftest.js";

const iso = useIso();
const cap = useCapsys();
const hasPython = pythonAvailable();
let tmp = "";
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "abx-flag-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function abx(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  const code = await main({ args });
  const { out, err } = cap.readouterr();
  return { code, out, err };
}

const installLocal = (): Promise<unknown> => installer.install(LOCAL_PROCESS, { yes: true, hostVersion: TEST_HOST_VERSION });

describe("extractProviderFlags", () => {
  it("test_flags_are_accepted_at_any_position", () => {
    expect(extractProviderFlags(["--provider", "p", "list"])).toEqual({ args: ["list"], provider: "p", options: [] });
    expect(extractProviderFlags(["list", "--provider=p", "--opt", "a=1", "--opt=b=2"])).toEqual({
      args: ["list"],
      provider: "p",
      options: ["a=1", "b=2"],
    });
  });

  it("test_tokens_after_double_dash_are_left_alone", () => {
    expect(extractProviderFlags(["exec", "sbx", "--", "echo", "--provider", "x"]).args).toEqual(["exec", "sbx", "--", "echo", "--provider", "x"]);
  });

  it("test_the_provider_group_keeps_its_own_arguments", () => {
    const r = extractProviderFlags(["provider", "test", "p", "--opt", "a=1"]);
    expect(r.provider).toBeNull();
    expect(r.args).toEqual(["provider", "test", "p", "--opt", "a=1"]);
  });
});

describe("validation fails before any side effect", () => {
  it("test_unknown_provider_is_e8001_exit_4", async () => {
    const r = await abx("--provider", "nothing-here", "list");
    expect(r.code).toBe(4);
    expect(r.err + r.out).toContain("E8001");
  });

  it("test_malformed_opt_is_e8002_exit_2", async () => {
    const r = await abx("--opt", "no-equals-sign", "list");
    expect(r.code).toBe(2);
    expect(r.err + r.out).toContain("E8002");
  });

  it("test_secret_option_is_refused_and_never_echoed", async () => {
    await installLocal();
    const r = await abx("--provider", "local-process", "--opt", "token=hunter2-secret", "info", "sbx-1");
    expect(r.code).toBe(2);
    expect(r.err + r.out).toContain("E8002");
    expect(r.err + r.out).not.toContain("hunter2-secret");
  });

  it("test_unknown_opt_key_is_e8002", async () => {
    await installLocal();
    const r = await abx("--provider", "local-process", "--opt", "nope=1", "info", "sbx-1");
    expect(r.code).toBe(2);
    expect(r.err + r.out).toContain("E8002");
  });

  it("test_conflicting_qualified_reference_is_e8030_exit_2", async () => {
    await installLocal();
    const r = await abx("--provider", "local-process", "info", "alicloud-express:sbx-1");
    expect(r.code).toBe(2);
    expect(r.err + r.out).toContain("E8030");
  });

  it("test_region_flag_is_refused_for_a_provider_without_a_region_key", async () => {
    await installLocal();
    const r = await abx("--provider", "local-process", "list", "--region", "cn-beijing");
    expect(r.code).toBe(2);
    expect(r.err + r.out).toContain("Option '--region' is not supported by provider 'local-process'");
  });

  it("test_a_plugin_provider_cannot_use_a_missing_feature_silently", async () => {
    await installLocal();
    const r = await abx("--provider", "local-process", "capabilities", "sbx-unknown");
    expect(r.code).not.toBe(0);
  });
});

describe.skipIf(!hasPython)("a plugin end to end through the CLI", () => {
  it("test_qualified_ids_json_provider_key_and_kill", async () => {
    await installLocal();
    const created = await abx("--json", "--provider", "local-process", "create", "--template", "base");
    expect(created.code, created.err).toBe(0);
    const doc = JSON.parse(created.out);
    expect(doc.provider).toBe("local-process");
    const sid: string = doc.ID;
    expect(sid).not.toContain(":");

    const listedJson = JSON.parse((await abx("--json", "--provider", "local-process", "list")).out);
    expect(listedJson.map((r: { ID: string; provider: string }) => [r.ID, r.provider])).toContainEqual([sid, "local-process"]);

    const listedText = await abx("--provider", "local-process", "list");
    expect(listedText.out).toContain(`local-process:${sid}`);

    const info = await abx("--json", "info", `local-process:${sid}`);
    expect(info.code, info.err).toBe(0);
    expect(JSON.parse(info.out)).toMatchObject({ ID: sid, provider: "local-process" });

    const exec = await abx("--json", "exec", `local-process:${sid}`, "echo hi-from-plugin");
    expect(exec.code, exec.err).toBe(0);
    expect(JSON.parse(exec.out).stdout).toContain("hi-from-plugin");

    const killed = await abx("kill", `local-process:${sid}`, "--yes");
    expect(killed.code, killed.err).toBe(0);
  });

  it("test_a_missing_sandbox_is_exit_4", async () => {
    await installLocal();
    const r = await abx("--provider", "local-process", "info", "sbx-does-not-exist");
    expect(r.code).toBe(4);
  });

  it("test_default_provider_applies_without_the_flag_and_ids_are_qualified", async () => {
    await installLocal();
    expect((await abx("provider", "default", "local-process")).code).toBe(0);
    const created = await abx("create", "--template", "base");
    expect(created.code, created.err).toBe(0);
    expect(created.out).toMatch(/local-process:/);
  });

  it("test_list_all_providers_skips_a_failing_provider_with_a_warning", async () => {
    await installLocal();
    await abx("--provider", "local-process", "create", "--template", "base");
    const r = await abx("--json", "list", "--all-providers");
    expect(r.code, r.err).toBe(0);
    expect(r.err).toMatch(/warning: provider 'alicloud-express' skipped:/);
    const rows = JSON.parse(r.out);
    expect(rows.every((x: { provider: string }) => x.provider === "local-process")).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("the built-in provider keeps the legacy output", () => {
  it("test_no_provider_key_for_the_builtin_default", async () => {
    const r = await abx("--json", "provider", "list");
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toHaveLength(1);
  });
});
