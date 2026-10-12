/**
 * Provider-aware `ebx config`: canonical key names, `provider`, `providers.<id>.<key>`, bare provider keys, the TTY-only
 * legacy-key note, `config check`, `config migrate` and the canonical-name listing (spec sections 2 and 3).
 */

import "../_support/isolatedHome.js";

import fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cli } from "../../src/cli/main.js";
import { configSeams } from "../../src/cli/commands/config_cmd.js";
import { _readEnvVars } from "../../src/transport/config.js";
import { _resetDeprecationWarnings } from "../../src/transport/config_layers.js";
import { hostVersion } from "../../src/providers/host.js";
import * as installer from "../../src/providers/installer.js";
import { useIso } from "../_support/iso.js";
import { LOCAL_PROCESS, TEST_HOST_VERSION } from "../_support/plugins.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { storagePatch, withConfig } from "../helpers/configSupport.js";

const iso = useIso();
let undo: () => void = () => undefined;
beforeEach(() => {
  const patch = storagePatch(iso.home, { env: true });
  const saved = { ...configSeams };
  Object.assign(configSeams, patch);
  undo = () => Object.assign(configSeams, saved);
});
afterEach(() => undo());

const ebx = (...args: string[]) => new CliRunner().invoke(cli, args);
const json = (text: string): any => JSON.parse(text); // eslint-disable-line @typescript-eslint/no-explicit-any
const toml = (): string => (fs.existsSync(iso.toml) ? fs.readFileSync(iso.toml, "utf-8") : "");
const dotenv = (): string => (fs.existsSync(iso.env) ? fs.readFileSync(iso.env, "utf-8") : "");

describe("canonical key names", () => {
  it("test_canonical_and_legacy_names_address_the_same_value", async () => {
    expect((await ebx("config", "set", "sandbox_base_url", "https://a.example")).output).toContain("Set sandbox_base_url = https://a.example");
    expect((await ebx("config", "get", "api_url")).output.trim()).toBe("https://a.example");
    expect((await ebx("config", "get", "api_base_url")).output.trim()).toBe("https://a.example");
    expect((await ebx("config", "set", "domain", "d.example")).output).toContain("Set domain = d.example");
    expect((await ebx("config", "get", "sandbox_domain")).output.trim()).toBe("d.example");
    expect(toml()).toContain('api_url = "https://a.example"');
  });

  it("test_the_legacy_api_key_alias_keeps_printing_the_canonical_name", async () => {
    const r = await ebx("config", "set", "api_key", "abcdefghijkl");
    expect(r.output).toContain("Set sandbox_api_key = ");
    expect(r.output).not.toContain("abcdefghijkl");
  });

  it("test_acr_and_team_keys_are_settable_and_stored_in_the_provider_table", async () => {
    expect((await ebx("config", "set", "acr_repo", "myrepo")).exit_code).toBe(0);
    expect((await ebx("config", "get", "acr_repo")).output.trim()).toBe("myrepo");
    expect((await ebx("config", "get", "providers.alicloud-express.acr_repo")).output.trim()).toBe("myrepo");
    expect(toml()).toMatch(/\[providers\.alicloud-express\][^[]*acr_repo = "myrepo"/);
    expect((await ebx("config", "set", "team_id", "t-1")).exit_code).toBe(0);
    expect((await ebx("config", "delete", "acr_repo")).output).toContain("Cleared acr_repo");
    expect((await ebx("config", "get", "acr_repo")).output.trim()).toBe("(not set)");
  });

  it("test_acr_password_is_a_masked_secret_in_dotenv", async () => {
    const r = await ebx("config", "set", "acr_password", "pa55-w0rd-value");
    expect(r.output).not.toContain("pa55-w0rd-value");
    expect(dotenv()).toContain("ACR_PASSWORD=pa55-w0rd-value");
    expect((await ebx("config", "get", "acr_password")).output).not.toContain("pa55-w0rd-value");
  });

  it("test_the_default_listing_is_unchanged_until_a_new_key_has_a_value", async () => {
    const r = await ebx("config", "list");
    expect(r.output).not.toContain("Provider");
    expect(r.output).not.toContain("registry (ACR)");
    expect(r.output).toContain("api_url");
    await ebx("config", "set", "acr_repo", "myrepo");
    const after = await ebx("config", "list");
    expect(after.output).toContain("Alibaba Cloud registry (ACR)");
    expect(after.output).toContain("acr_repo");
  });
});

describe("provider keys", () => {
  it("test_provider_key_sets_the_default_and_validates_it", async () => {
    await installer.install(LOCAL_PROCESS, { yes: true, hostVersion: TEST_HOST_VERSION });
    expect((await ebx("config", "get", "provider")).output.trim()).toBe("alicloud-express");
    expect((await ebx("config", "set", "provider", "local-process")).output).toContain("Set provider = local-process");
    expect(toml()).toContain('provider = "local-process"');
    expect((await ebx("config", "get", "provider")).output.trim()).toBe("local-process");
    expect((await ebx("config", "delete", "provider")).output).toContain("Cleared provider");
    expect(toml()).not.toContain("provider =");
    const bad = await ebx("config", "set", "provider", "nothing-here");
    expect(bad.exit_code).toBe(4);
    expect(bad.output).toContain("E8001");
  });

  it("test_qualified_keys_for_an_installed_plugin", async () => {
    await installer.install(LOCAL_PROCESS, { yes: true, hostVersion: TEST_HOST_VERSION });
    expect((await ebx("config", "set", "providers.local-process.debug", "true")).exit_code).toBe(0);
    expect(toml()).toMatch(/\[providers\.local-process\][^[]*debug = true/);
    expect((await ebx("config", "get", "providers.local-process.debug")).output.trim()).toBe("True");
    const secret = await ebx("config", "set", "providers.local-process.token", "tok-value-123456");
    expect(secret.output).not.toContain("tok-value-123456");
    expect(dotenv()).toContain("EBX_LOCAL_PROCESS_TOKEN=tok-value-123456");
    expect((await ebx("config", "delete", "providers.local-process.token")).output).toContain("Cleared");
    expect(dotenv()).not.toContain("EBX_LOCAL_PROCESS_TOKEN");
  });

  it("test_inherited_core_key_can_be_overridden_per_provider_only_if_inherited", async () => {
    await installer.install(LOCAL_PROCESS, { yes: true, hostVersion: TEST_HOST_VERSION });
    const r = await ebx("config", "set", "providers.local-process.sandbox_base_url", "https://x.example");
    expect(r.exit_code).toBe(2);
    expect(r.output).toContain("E8002");
  });

  it("test_unknown_qualified_provider_is_e8001_exit_4", async () => {
    const r = await ebx("config", "get", "providers.nothing-here.x");
    expect(r.exit_code).toBe(4);
  });

  it("test_bare_key_of_the_default_plugin_and_the_did_you_mean_hint", async () => {
    await installer.install(LOCAL_PROCESS, { yes: true, hostVersion: TEST_HOST_VERSION });
    const hint = await ebx("config", "get", "debug");
    expect(hint.exit_code).toBe(2);
    expect(hint.output).toContain("Did you mean 'providers.local-process.debug'?");
    await ebx("config", "set", "provider", "local-process");
    expect((await ebx("config", "set", "debug", "false")).exit_code).toBe(0);
    expect((await ebx("config", "get", "providers.local-process.debug")).output.trim()).toBe("False");
    const listing = await ebx("config", "list");
    expect(listing.output).toContain("── Provider");
    expect(listing.output).toContain("Local Process options");
    expect(listing.output).not.toContain("Alibaba Cloud credentials");
  });
});

describe("the TTY-only legacy-key note", () => {
  const tty = (stderrTty: boolean) => ({ stdin: { isatty: () => false }, stderr: { isatty: () => stderrTty } });

  it("test_note_appears_on_stderr_for_a_renamed_legacy_key_in_a_terminal", async () => {
    const r = await withConfig({ ...storagePatch(iso.home, { env: true }), sys: tty(true) as never }, () => ebx("config", "set", "api_url", "https://n.example"));
    expect(r.stderr).toContain("note: 'api_url' is now 'sandbox_base_url' (the old name keeps working).");
    expect(r.stdout).toContain("Set api_url = https://n.example");
  });

  it("test_no_note_without_a_terminal_in_json_quiet_or_ci", async () => {
    for (const args of [["config", "set", "api_url", "https://n.example"], ["--json", "config", "set", "api_url", "https://n.example"], ["--quiet", "config", "set", "api_url", "https://n.example"]]) {
      const r = await withConfig({ ...storagePatch(iso.home, { env: true }), sys: tty(false) as never }, () => ebx(...args));
      expect(r.stderr).not.toContain("note:");
    }
    for (const args of [["--json", "config", "set", "api_url", "https://n.example"], ["--quiet", "config", "set", "api_url", "https://n.example"]]) {
      const r = await withConfig({ ...storagePatch(iso.home, { env: true }), sys: tty(true) as never }, () => ebx(...args));
      expect(r.stderr).not.toContain("note:");
    }
    iso.setenv("CI", "true");
    const ci = await withConfig({ ...storagePatch(iso.home, { env: true }), sys: tty(true) as never }, () => ebx("config", "set", "api_url", "https://n.example"));
    expect(ci.stderr).not.toContain("note:");
  });

  it("test_canonical_names_never_trigger_the_note", async () => {
    const r = await withConfig({ ...storagePatch(iso.home, { env: true }), sys: tty(true) as never }, () => ebx("config", "set", "sandbox_base_url", "https://n.example"));
    expect(r.stderr).not.toContain("note:");
  });
});

describe("config check", () => {
  it("test_clean_configuration", async () => {
    const r = await ebx("config", "check");
    expect(r.exit_code).toBe(0);
    expect(r.output).toContain("No legacy names in use.");
  });

  it("test_reports_legacy_names_only_and_never_values", async () => {
    iso.setenv("SANDBOX_API_KEY", "key-value-abcdef");
    iso.setenv("E2B_API_KEY", "compat-value-abcdef");
    iso.setenv("ALICLOUD_ACCESS_KEY_ID", "native-value-abcdef");
    iso.writeToml('[transport]\napi_url = "https://t.example"\nhttp_timeout = 9\n');
    const text = await ebx("config", "check");
    expect(text.exit_code).toBe(0);
    expect(text.output).toContain("env      SANDBOX_API_KEY");
    expect(text.output).toContain("-> EBX_SANDBOX_API_KEY (sandbox_api_key)");
    expect(text.output).toContain("config   [transport] api_url");
    expect(text.output).toContain("-> sandbox_base_url");
    for (const secret of ["key-value-abcdef", "compat-value-abcdef", "native-value-abcdef", "t.example"]) expect(text.output).not.toContain(secret);
    expect(text.output).not.toContain("E2B_API_KEY");
    expect(text.output).not.toContain("ALICLOUD_ACCESS_KEY_ID");

    const asJson = json((await ebx("--json", "config", "check")).stdout);
    expect(asJson).toContainEqual({ where: "env", name: "SANDBOX_API_KEY", canonical_key: "sandbox_api_key", canonical_name: "EBX_SANDBOX_API_KEY", kind: "legacy" });
    expect(asJson.every((f: { kind: string }) => f.kind === "legacy")).toBe(true);
  });

  it("test_strict_exits_1_when_something_is_found", async () => {
    iso.setenv("SANDBOX_REGION", "cn-beijing");
    expect((await ebx("config", "check")).exit_code).toBe(0);
    expect((await ebx("config", "check", "--strict")).exit_code).toBe(1);
  });
});

describe("config migrate", () => {
  const seed = (): void => {
    iso.writeToml('[transport]\napi_url = "https://t.example"\nregion = "cn-beijing"\nhttp_timeout = 9\n');
    iso.writeEnv("E2B_API_KEY=old-key-value\nACR_NAMESPACE=ns1\n");
  };

  it("test_dry_run_prints_the_plan_and_changes_nothing", async () => {
    seed();
    const before = [toml(), dotenv()];
    const r = await ebx("config", "migrate", "--dry-run");
    expect(r.exit_code).toBe(0);
    expect(r.output).toContain("would rename transport.api_url -> transport.sandbox_base_url");
    expect(r.output).toContain("would set core.config_format = 2");
    expect([toml(), dotenv()]).toEqual(before);
  });

  it("test_refuses_without_confirmation_when_not_interactive", async () => {
    seed();
    const r = await ebx("config", "migrate");
    expect(r.exit_code).toBe(2);
    expect(toml()).not.toContain("config_format");
  });

  it("test_yes_rewrites_names_backs_up_with_0600_and_is_idempotent", async () => {
    seed();
    const r = await ebx("config", "migrate", "--yes");
    expect(r.exit_code, r.output).toBe(0);
    expect(toml()).toContain("config_format = 2");
    expect(toml()).toContain('sandbox_base_url = "https://t.example"');
    expect(toml()).not.toContain("api_url");
    expect(dotenv()).toContain("EBX_SANDBOX_API_KEY=old-key-value");
    expect(dotenv()).not.toContain("E2B_API_KEY");
    expect(fs.readFileSync(`${iso.toml}.bak`, "utf-8")).toContain("api_url");
    expect(fs.statSync(`${iso.toml}.bak`).mode & 0o777).toBe(0o600);
    expect(fs.statSync(`${iso.env}.bak`).mode & 0o777).toBe(0o600);

    const again = await ebx("config", "migrate", "--yes");
    expect(again.exit_code).toBe(0);
    expect(again.output).toContain("Nothing to migrate");
  });

  it("test_after_migration_values_resolve_and_listing_uses_the_canonical_names", async () => {
    seed();
    await ebx("config", "migrate", "--yes");
    expect((await ebx("config", "get", "api_url")).output.trim()).toBe("https://t.example");
    expect((await ebx("config", "get", "region")).output.trim()).toBe("cn-beijing");
    expect((await ebx("config", "get", "sandbox_api_key")).output).toContain("***");

    const listing = await ebx("config", "list");
    expect(listing.output).toContain("sandbox_base_url");
    expect(listing.output).toContain("sandbox_domain");
    expect(listing.output).not.toMatch(/^api_url /m);
    const legacy = await ebx("config", "list", "--legacy-names");
    expect(legacy.output).toMatch(/^api_url /m);
    expect(Object.keys(json((await ebx("--json", "config", "list")).stdout))).toContain("sandbox_base_url");
    expect(Object.keys(json((await ebx("--json", "config", "list", "--legacy-names")).stdout))).toContain("api_url");

    await ebx("config", "set", "api_url", "https://z.example");
    expect((await ebx("config", "get", "sandbox_base_url")).output.trim()).toBe("https://z.example");
    expect(toml()).not.toContain("api_url");
    expect((await ebx("config", "delete", "region")).output).toContain("Cleared region");
    expect((await ebx("config", "get", "region")).output.trim()).toBe("cn-hangzhou");
    expect((await ebx("config", "check")).output).toContain("No legacy names in use.");
  });
});

describe("legacy names", () => {
  it("test_legacy_env_names_are_silent_by_default_and_warn_when_asked", () => {
    const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    try {
      iso.setenv("SANDBOX_REGION", "cn-beijing");
      iso.setenv("E2B_API_URL", "https://compat.example");
      _resetDeprecationWarnings();
      expect(_readEnvVars()["region"]).toBe("cn-beijing");
      expect(warn).not.toHaveBeenCalled();

      iso.setenv("EBX_WARN_DEPRECATED", "1");
      _resetDeprecationWarnings();
      _readEnvVars();
      const messages = warn.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => m.includes("SANDBOX_REGION") && m.includes("EBX_ALICLOUD_EXPRESS_REGION"))).toBe(true);
      expect(messages.some((m) => m.includes("E2B_API_URL"))).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it("test_canonical_env_names_win_over_legacy_ones", () => {
    iso.setenv("SANDBOX_REGION", "cn-beijing");
    iso.setenv("EBX_ALICLOUD_EXPRESS_REGION", "cn-shanghai");
    iso.setenv("EBX_SANDBOX_BASE_URL", "https://canon.example");
    iso.setenv("SANDBOX_API_BASE_URL", "https://legacy.example");
    const values = _readEnvVars();
    expect(values["region"]).toBe("cn-shanghai");
    expect(values["api_url"]).toBe("https://canon.example");
  });

  it("test_host_version_is_the_package_version", () => {
    const pkg = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf-8"));
    expect(hostVersion()).toBe(pkg.version);
    expect(pkg.version).toBe("0.3.0");
  });
});
