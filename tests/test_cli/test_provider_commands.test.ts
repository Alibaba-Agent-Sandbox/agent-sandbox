/**
 * `abx provider ...` (list, info/show, install, uninstall, update, default, config, doctor, test): help text, `--json`
 * shapes, exit codes E8000-E8030 (spec `docs/design/providers-and-credentials-cli.md` section 5).
 */

import "./host-version-for-plugins.js";
import "../_support/isolatedHome.js";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cli } from "../../src/cli/main.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { useIso } from "../_support/iso.js";
import { LOCAL_PROCESS, git, gitCommitAll, initRepo, pythonAvailable, writePlugin } from "../_support/plugins.js";

const iso = useIso();
const hasPython = pythonAvailable();
let tmp = "";
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "abx-provcli-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const abx = (...args: string[]) => new CliRunner().invoke(cli, args);
const json = (text: string): any => JSON.parse(text); // eslint-disable-line @typescript-eslint/no-explicit-any

describe("provider help and discovery", () => {
  it("test_provider_group_help_names_the_builtin", async () => {
    const r = await abx("provider", "--help");
    expect(r.exit_code).toBe(0);
    expect(r.output).toContain("alicloud-express");
    for (const sub of ["list", "info", "install", "uninstall", "update", "default", "config", "doctor", "test"]) {
      expect(r.output).toContain(sub);
    }
  });

  it("test_every_subcommand_has_help", async () => {
    for (const sub of ["list", "info", "show", "install", "uninstall", "update", "default", "doctor", "test", "config"]) {
      const r = await abx("provider", sub, "--help");
      expect(r.exit_code, `${sub}: ${r.output}`).toBe(0);
      expect(r.output).toContain("Usage:");
    }
  });

  it("test_list_always_contains_the_builtin", async () => {
    const r = await abx("--json", "provider", "list");
    expect(r.exit_code).toBe(0);
    const rows = json(r.stdout);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ID: "alicloud-express", Kind: "builtin", Trust: "builtin", Default: "yes" });
    expect(rows[0].Features).toContain("sandbox(");
    expect(Object.keys(rows[0])).toEqual(["ID", "Name", "Version", "Kind", "Trust", "Features", "Default"]);
  });

  it("test_list_text_table_is_readable_at_80_columns", async () => {
    const r = await abx("provider", "list");
    expect(r.exit_code).toBe(0);
    for (const line of r.stdout.split("\n")) expect(line.length).toBeLessThanOrEqual(80);
    expect(r.stdout).toMatch(/^alicloud-express\s+\S+\s+builtin\s+builtin\s+\d+\s+yes$/m);
    expect(r.stdout).toContain("abx provider info ID");
    expect(r.stdout).not.toContain("sandbox(");
  });

  it("test_list_quiet_prints_ids_only", async () => {
    const r = await abx("--quiet", "provider", "list");
    expect(r.stdout.trim()).toBe("alicloud-express");
  });

  it("test_info_unknown_provider_is_e8001_exit_4", async () => {
    const r = await abx("provider", "info", "nothing-here");
    expect(r.exit_code).toBe(4);
    expect(r.output).toContain("E8001");
  });

  it("test_info_builtin_json", async () => {
    const r = await abx("--json", "provider", "info", "alicloud-express");
    expect(r.exit_code).toBe(0);
    expect(json(r.stdout)).toMatchObject({ id: "alicloud-express", kind: "builtin", default: true });
  });

  it("test_show_is_an_alias_of_info", async () => {
    const a = await abx("--json", "provider", "info", "alicloud-express");
    const b = await abx("--json", "provider", "show", "alicloud-express");
    expect(b.stdout).toBe(a.stdout);
  });
});

describe("provider install / default / uninstall", () => {
  it("test_install_requires_yes_without_a_terminal", async () => {
    const r = await abx("provider", "install", LOCAL_PROCESS);
    expect(r.exit_code).toBe(2);
    expect(r.output).toContain("E8012");
    expect(json((await abx("--json", "provider", "list")).stdout)).toHaveLength(1);
  });

  it("test_install_json_requires_yes_too", async () => {
    const r = await abx("--json", "provider", "install", LOCAL_PROCESS);
    expect(r.exit_code).toBe(2);
  });

  it("test_install_path_then_list_info_default_uninstall", async () => {
    const r = await abx("--json", "provider", "install", LOCAL_PROCESS, "--yes", ...(hasPython ? [] : ["--no-verify"]));
    expect(r.exit_code, r.output).toBe(0);
    expect(json(r.stdout)).toMatchObject({ status: "success", id: "local-process", version: "0.1.0", trust: "local" });
    expect(json(r.stdout).tree_sha256).toMatch(/^[0-9a-f]{64}$/);

    const list = json((await abx("--json", "provider", "list")).stdout);
    expect(list.map((x: { ID: string }) => x.ID)).toEqual(["alicloud-express", "local-process"]);
    expect(list[1]).toMatchObject({ Kind: "exec", Trust: "local", Default: "" });

    const info = json((await abx("--json", "provider", "info", "local-process")).stdout);
    expect(info.id).toBe("local-process");
    expect(info.install.source.path ?? info.install.source.url).toBeDefined();
    expect(JSON.stringify(info)).not.toContain("token_value");

    expect((await abx("provider", "default")).stdout.trim()).toBe("alicloud-express");
    const set = await abx("provider", "default", "local-process");
    expect(set.exit_code).toBe(0);
    expect(json((await abx("--json", "provider", "default")).stdout)).toEqual({ default: "local-process", source: "config" });
    expect(fs.readFileSync(iso.toml, "utf-8")).toContain('provider = "local-process"');

    const un = await abx("provider", "uninstall", "local-process", "--yes");
    expect(un.exit_code, un.output).toBe(0);
    expect(json((await abx("--json", "provider", "list")).stdout)).toHaveLength(1);
    expect((await abx("provider", "default")).stdout.trim()).toBe("alicloud-express");
  });

  it("test_default_unknown_is_e8001", async () => {
    const r = await abx("provider", "default", "nothing-here");
    expect(r.exit_code).toBe(4);
    expect(r.output).toContain("E8001");
  });

  it("test_default_unset_and_env_override_note", async () => {
    await abx("provider", "install", LOCAL_PROCESS, "--yes", "--no-verify");
    await abx("provider", "default", "local-process");
    iso.setenv("ABX_PROVIDER", "alicloud-express");
    const shown = json((await abx("--json", "provider", "default")).stdout);
    expect(shown).toEqual({ default: "alicloud-express", source: "env" });
    const unset = await abx("provider", "default", "--unset");
    expect(unset.exit_code).toBe(0);
    expect(fs.readFileSync(iso.toml, "utf-8")).not.toContain("provider =");
  });

  it("test_install_from_local_git_repo_requires_insecure_flag_and_pins", async () => {
    const repo = path.join(tmp, "repo");
    writePlugin(repo, { id: "git-prov" });
    initRepo(repo);
    const commit = gitCommitAll(repo);
    const url = `file://${repo}`;
    const refused = await abx("provider", "install", url, "--yes", "--no-verify");
    expect(refused.exit_code).toBe(2);
    expect(refused.output).toContain("E8012");

    const unpinned = await abx("--json", "provider", "install", url, "--yes", "--no-verify", "--allow-insecure-transport");
    expect(unpinned.exit_code, unpinned.output).toBe(2);

    const ok = await abx("--json", "provider", "install", url, "--ref", commit, "--yes", "--no-verify", "--allow-insecure-transport");
    expect(ok.exit_code, ok.output).toBe(0);
    expect(json(ok.stdout)).toMatchObject({ id: "git-prov", trust: "pinned", commit });
    void git;
  });

  it("test_install_conflict_needs_force", async () => {
    await abx("provider", "install", LOCAL_PROCESS, "--yes", "--no-verify");
    const again = await abx("provider", "install", LOCAL_PROCESS, "--yes", "--no-verify");
    expect(again.exit_code).toBe(1);
    expect(again.output).toContain("E8003");
    const forced = await abx("provider", "install", LOCAL_PROCESS, "--yes", "--no-verify", "--force");
    expect(forced.exit_code, forced.output).toBe(0);
  });

  it("test_uninstall_unknown_is_e8001", async () => {
    const r = await abx("provider", "uninstall", "nothing-here", "--yes");
    expect(r.exit_code).toBe(4);
  });

  it("test_update_check_reports_without_changing", async () => {
    await abx("provider", "install", LOCAL_PROCESS, "--yes", "--no-verify");
    const r = await abx("--json", "provider", "update", "--check", "local-process");
    expect(r.exit_code, r.output).toBe(1);
    expect(r.output).toContain("E8010");
  });

  it("test_update_check_on_a_git_install_reports_the_new_commit", async () => {
    const repo = path.join(tmp, "upd");
    writePlugin(repo, { id: "upd-prov", version: "0.1.0" });
    initRepo(repo);
    const first = gitCommitAll(repo);
    const branch = git(repo, "rev-parse", "--abbrev-ref", "HEAD");
    const url = `file://${repo}`;
    const installed = await abx("provider", "install", url, "--ref", branch, "--allow-unpinned", "--yes", "--no-verify", "--allow-insecure-transport");
    expect(installed.exit_code, installed.output).toBe(0);
    writePlugin(repo, { id: "upd-prov", version: "0.2.0" });
    gitCommitAll(repo, "bump");
    const r = await abx("--json", "provider", "update", "--check", "upd-prov", "--allow-insecure-transport");
    expect(r.exit_code, r.output).toBe(0);
    expect(json(r.stdout)[0]).toMatchObject({ id: "upd-prov", status: "available", installed: first });
    expect(json(r.stdout)[0].available).not.toBeNull();
    const info = json((await abx("--json", "provider", "info", "upd-prov")).stdout);
    expect(info.version).toBe("0.1.0");
  });
});

describe("provider config", () => {
  beforeEach(async () => {
    await abx("provider", "install", LOCAL_PROCESS, "--yes", "--no-verify");
  });

  it("test_set_plain_option_goes_to_the_provider_table", async () => {
    const r = await abx("provider", "config", "local-process", "set", "debug", "true");
    expect(r.exit_code, r.output).toBe(0);
    expect(fs.readFileSync(iso.toml, "utf-8")).toMatch(/\[providers\.local-process\]\s+debug = true/);
    expect((await abx("provider", "config", "local-process", "get", "debug")).stdout.trim()).toBe("true");
  });

  it("test_secret_goes_to_dotenv_and_is_masked", async () => {
    const r = await abx("provider", "config", "local-process", "set", "token", "s3cr3t-value");
    expect(r.exit_code, r.output).toBe(0);
    expect(r.output).not.toContain("s3cr3t-value");
    expect(fs.readFileSync(iso.env, "utf-8")).toContain("ABX_LOCAL_PROCESS_TOKEN=s3cr3t-value");
    if (fs.existsSync(iso.toml)) expect(fs.readFileSync(iso.toml, "utf-8")).not.toContain("s3cr3t-value");
    const got = await abx("provider", "config", "local-process", "get", "token");
    expect(got.output).not.toContain("s3cr3t-value");
    const listed = await abx("--json", "provider", "config", "local-process", "list");
    expect(listed.output).not.toContain("s3cr3t-value");
    expect(fs.statSync(iso.env).mode & 0o777).toBe(0o600);
  });

  it("test_unknown_option_is_e8002", async () => {
    const r = await abx("provider", "config", "local-process", "set", "nope", "1");
    expect(r.exit_code).toBe(2);
    expect(r.output).toContain("E8002");
  });

  it("test_invalid_value_is_e8002", async () => {
    const r = await abx("provider", "config", "local-process", "set", "debug", "maybe");
    expect(r.exit_code).toBe(2);
  });

  it("test_unset_clears_the_value", async () => {
    await abx("provider", "config", "local-process", "set", "debug", "true");
    const r = await abx("provider", "config", "local-process", "unset", "debug");
    expect(r.exit_code).toBe(0);
    expect(fs.readFileSync(iso.toml, "utf-8")).not.toContain("debug");
  });
});

describe("provider doctor / test", () => {
  it("test_doctor_builtin_has_no_failures", async () => {
    const r = await abx("--json", "provider", "doctor", "alicloud-express", "--no-handshake");
    expect(r.exit_code, r.output).toBe(0);
    for (const row of json(r.stdout)) expect(["ok", "warn"]).toContain(row.status);
  });

  it("test_doctor_detects_a_tampered_install_exit_1", async () => {
    await abx("provider", "install", LOCAL_PROCESS, "--yes", "--no-verify");
    const dir = path.join(iso.home, "providers", "local-process");
    const root = fs.existsSync(path.join(dir, "abx-provider.toml")) ? dir : path.join(dir, "current");
    const target = fs.existsSync(path.join(root, "provider.py")) ? path.join(root, "provider.py") : null;
    if (target !== null) fs.appendFileSync(target, "\n# tampered\n");
    const r = await abx("--json", "provider", "doctor", "local-process", "--no-handshake");
    if (target !== null) {
      expect(r.exit_code).toBe(1);
      expect(json(r.stdout).some((c: { status: string }) => c.status === "fail")).toBe(true);
    }
  });

  it.skipIf(!hasPython)("test_doctor_handshake_and_contract_suite_pass", async () => {
    await abx("provider", "install", LOCAL_PROCESS, "--yes");
    const doc = await abx("provider", "doctor", "local-process");
    expect(doc.exit_code, doc.output).toBe(0);
    expect(doc.output).toContain("handshake");
    const t = await abx("provider", "test", "local-process");
    expect(t.exit_code, t.output).toBe(0);
    expect(t.output).toMatch(/passed|ok/);
  });
});
