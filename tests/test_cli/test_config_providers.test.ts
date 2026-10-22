/**
 * Provider-aware `abx config`: canonical key names, `provider`, `providers.<id>.<key>`, bare provider keys, the TTY-only
 * legacy-key note, `config check`, `config migrate` and the canonical-name listing (spec sections 2 and 3).
 */

import "../_support/isolatedHome.js";

import fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cli } from "../../src/cli/main.js";
import { configSeams } from "../../src/cli/commands/config_cmd.js";
import { _readEnvVars } from "../../src/transport/config.js";
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

const abx = (...args: string[]) => new CliRunner().invoke(cli, args);
const json = (text: string): any => JSON.parse(text); // eslint-disable-line @typescript-eslint/no-explicit-any
const toml = (): string => (fs.existsSync(iso.toml) ? fs.readFileSync(iso.toml, "utf-8") : "");
const dotenv = (): string => (fs.existsSync(iso.env) ? fs.readFileSync(iso.env, "utf-8") : "");

describe("canonical key names", () => {
  it("stores canonical endpoint names without a migration step", async () => {
    expect((await abx("config", "set", "sandbox_base_url", "https://a.example")).exit_code).toBe(0);
    expect((await abx("config", "get", "sandbox_base_url")).output.trim()).toBe("https://a.example");
    expect(toml()).toContain('sandbox_base_url = "https://a.example"');
  });

  it.each(["api_key", "api_url", "api_base_url", "domain"])("rejects removed key %s", async (key) => {
    expect((await abx("config", "set", key, "unused")).exit_code).not.toBe(0);
  });

  it.each(["check", "migrate"])("rejects removed command %s", async (name) => {
    expect((await abx("config", name)).exit_code).not.toBe(0);
  });

  it("test_acr_and_team_keys_are_settable_and_stored_in_the_provider_table", async () => {
    expect((await abx("config", "set", "acr_repo", "myrepo")).exit_code).toBe(0);
    expect((await abx("config", "get", "acr_repo")).output.trim()).toBe("myrepo");
    expect((await abx("config", "get", "providers.alicloud-express.acr_repo")).output.trim()).toBe("myrepo");
    expect(toml()).toMatch(/\[providers\.alicloud-express\][^[]*acr_repo = "myrepo"/);
    expect((await abx("config", "set", "team_id", "t-1")).exit_code).toBe(0);
    expect((await abx("config", "delete", "acr_repo")).output).toContain("Cleared acr_repo");
    expect((await abx("config", "get", "acr_repo")).output.trim()).toBe("(not set)");
  });

  it("test_acr_password_is_a_masked_secret_in_dotenv", async () => {
    const r = await abx("config", "set", "acr_password", "pa55-w0rd-value");
    expect(r.output).not.toContain("pa55-w0rd-value");
    expect(dotenv()).toContain("ACR_PASSWORD=pa55-w0rd-value");
    expect((await abx("config", "get", "acr_password")).output).not.toContain("pa55-w0rd-value");
  });

  it("test_the_default_listing_is_unchanged_until_a_new_key_has_a_value", async () => {
    const r = await abx("config", "list");
    expect(r.output).not.toContain("Provider");
    expect(r.output).not.toContain("registry (ACR)");
    expect(r.output).toContain("sandbox_base_url");
    await abx("config", "set", "acr_repo", "myrepo");
    const after = await abx("config", "list");
    expect(after.output).toContain("Alibaba Cloud registry (ACR)");
    expect(after.output).toContain("acr_repo");
  });
});

describe("provider keys", () => {
  it("test_provider_key_sets_the_default_and_validates_it", async () => {
    await installer.install(LOCAL_PROCESS, { yes: true, hostVersion: TEST_HOST_VERSION });
    expect((await abx("config", "get", "provider")).output.trim()).toBe("alicloud-express");
    expect((await abx("config", "set", "provider", "local-process")).output).toContain("Set provider = local-process");
    expect(toml()).toContain('provider = "local-process"');
    expect((await abx("config", "get", "provider")).output.trim()).toBe("local-process");
    expect((await abx("config", "delete", "provider")).output).toContain("Cleared provider");
    expect(toml()).not.toContain("provider =");
    const bad = await abx("config", "set", "provider", "nothing-here");
    expect(bad.exit_code).toBe(4);
    expect(bad.output).toContain("E8001");
  });

  it("test_qualified_keys_for_an_installed_plugin", async () => {
    await installer.install(LOCAL_PROCESS, { yes: true, hostVersion: TEST_HOST_VERSION });
    expect((await abx("config", "set", "providers.local-process.debug", "true")).exit_code).toBe(0);
    expect(toml()).toMatch(/\[providers\.local-process\][^[]*debug = true/);
    expect((await abx("config", "get", "providers.local-process.debug")).output.trim()).toBe("True");
    const secret = await abx("config", "set", "providers.local-process.token", "tok-value-123456");
    expect(secret.output).not.toContain("tok-value-123456");
    expect(dotenv()).toContain("ABX_LOCAL_PROCESS_TOKEN=tok-value-123456");
    expect((await abx("config", "delete", "providers.local-process.token")).output).toContain("Cleared");
    expect(dotenv()).not.toContain("ABX_LOCAL_PROCESS_TOKEN");
  });

  it("test_inherited_core_key_can_be_overridden_per_provider_only_if_inherited", async () => {
    await installer.install(LOCAL_PROCESS, { yes: true, hostVersion: TEST_HOST_VERSION });
    const r = await abx("config", "set", "providers.local-process.sandbox_base_url", "https://x.example");
    expect(r.exit_code).toBe(2);
    expect(r.output).toContain("E8002");
  });

  it("test_unknown_qualified_provider_is_e8001_exit_4", async () => {
    const r = await abx("config", "get", "providers.nothing-here.x");
    expect(r.exit_code).toBe(4);
  });

  it("test_bare_key_of_the_default_plugin_and_the_did_you_mean_hint", async () => {
    await installer.install(LOCAL_PROCESS, { yes: true, hostVersion: TEST_HOST_VERSION });
    const hint = await abx("config", "get", "debug");
    expect(hint.exit_code).toBe(2);
    expect(hint.output).toContain("Did you mean 'providers.local-process.debug'?");
    await abx("config", "set", "provider", "local-process");
    expect((await abx("config", "set", "debug", "false")).exit_code).toBe(0);
    expect((await abx("config", "get", "providers.local-process.debug")).output.trim()).toBe("False");
    const listing = await abx("config", "list");
    expect(listing.output).toContain("── Provider");
    expect(listing.output).toContain("Local Process options");
    expect(listing.output).not.toContain("Alibaba Cloud credentials");
  });
});

describe("legacy names", () => {
  it("test_retired_env_names_are_not_read", () => {
    const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    try {
      iso.setenv("SANDBOX_REGION", "cn-beijing");
      iso.setenv("E2B_API_URL", "https://compat.example");
      iso.setenv("ABX_WARN_DEPRECATED", "1");

      const values = _readEnvVars();
      expect(values["region"]).toBeUndefined();
      expect(values["api_url"]).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("test_canonical_env_names_win_over_retired_ones", () => {
    iso.setenv("SANDBOX_REGION", "cn-beijing");
    iso.setenv("ALIBABA_CLOUD_REGION_ID", "cn-shanghai");
    iso.setenv("ABX_SANDBOX_BASE_URL", "https://canon.example");
    iso.setenv("SANDBOX_API_BASE_URL", "https://legacy.example");
    const values = _readEnvVars();
    expect(values["region"]).toBe("cn-shanghai");
    expect(values["api_url"]).toBe("https://canon.example");
  });

  it("test_host_version_is_the_package_version", () => {
    const pkg = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf-8"));
    expect(hostVersion()).toBe(pkg.version);
  });
});
