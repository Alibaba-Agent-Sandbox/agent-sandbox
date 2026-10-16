/** Provider registry, credential scoping/isolation, rest preset and doctor (port of `test_registry_scoping.py`). */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InvalidCredentialsError, InvalidAPIKeyError } from "../../src/models/errors.js";
import { Provider, type ProviderInfra } from "../../src/providers/base.js";
import * as doctor from "../../src/providers/doctor.js";
import * as E from "../../src/providers/errors.js";
import * as installer from "../../src/providers/installer.js";
import { getProvider, listProviders, parseSandboxRef, qualify, registerProvider, resolveProviderId } from "../../src/providers/registry.js";
import { HeaderKeyAuth, RestProvider } from "../../src/providers/rest_provider.js";
import * as store from "../../src/providers/store.js";
import { loadLayeredConfig } from "../../src/transport/config_layers.js";
import { useIso } from "../_support/iso.js";
import { E2B_COMPATIBLE, LOCAL_PROCESS, TEST_HOST_VERSION, pythonAvailable, writePlugin } from "../_support/plugins.js";

const iso = useIso();
let tmp = "";
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "abx-reg-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const installPlugin = (src: string, opts: installer.InstallOptions = {}): Promise<installer.Receipt> =>
  installer.install(src, { yes: true, hostVersion: TEST_HOST_VERSION, ...opts });

class Py extends Provider {
  readonly id: string = "py-prov";
  constructor() {
    super();
    this.kind = "python";
    this.displayName = "Py";
  }
  async buildInfra(config: never): Promise<ProviderInfra> {
    return { config, auth: null, http_client: null, sandbox_protocol: {} as never, process_protocol: null, filesystem_protocol: null, code_interpreter_protocol: null };
  }
}

describe("TestRegistry", () => {
  it("test_builtin_identity_and_default", () => {
    const p = getProvider();
    expect(p.id).toBe("alicloud-express");
    expect(resolveProviderId()).toBe("alicloud-express");
    expect(p.displayName).toBe("Alibaba Cloud Express Edition");
    expect(p.displayNameZh).toBe("阿里云极速版");
    expect(p.kind).toBe("builtin");
    expect(p.supports("files.rw") && p.supports("storage.mount")).toBe(true);
  });

  it("test_register_and_conflicts", () => {
    registerProvider(new Py());
    expect(getProvider("py-prov").displayName).toBe("Py");
    expect(() => registerProvider(new Py())).toThrow(E.ProviderConflictError);
    registerProvider(new Py(), { replace: true });
    const bad = new Py();
    (bad as { id: string }).id = "alicloud-express";
    expect(() => registerProvider(bad)).toThrow(E.ProviderConflictError);
  });

  it("test_list_order_and_trust", async () => {
    registerProvider(new Py());
    await installPlugin(LOCAL_PROCESS);
    const rows = listProviders();
    expect(rows.map((r) => r.id)).toEqual(["alicloud-express", "local-process", "py-prov"]);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.trust]))).toEqual({
      "alicloud-express": "builtin",
      "local-process": "local",
      "py-prov": "python",
    });
  });

  it("test_broken_install_is_listed_with_error_not_fatal", async () => {
    await installPlugin(LOCAL_PROCESS);
    fs.writeFileSync(path.join(store.providerDir("local-process"), "abx-provider.toml"), "garbage [");
    const rows = Object.fromEntries(listProviders().map((r) => [r.id, r]));
    expect(rows["local-process"]).toHaveProperty("error");
  });

  it("test_unknown_provider_suggests_close_match", async () => {
    await installPlugin(LOCAL_PROCESS);
    try {
      getProvider("local-proces");
      expect.unreachable();
    } catch (exc) {
      expect(exc).toBeInstanceOf(E.ProviderNotFoundError);
      expect((exc as E.ProviderNotFoundError).suggestion).toContain("local-process");
    }
    expect(() => getProvider("../../etc")).toThrow(E.ProviderNotFoundError);
  });

  it("test_qualified_refs", async () => {
    await installPlugin(LOCAL_PROCESS);
    expect(parseSandboxRef("local-process:abc")).toEqual(["local-process", "abc"]);
    expect(parseSandboxRef("abc")).toEqual([null, "abc"]);
    expect(parseSandboxRef("unknown-prov:abc")).toEqual([null, "unknown-prov:abc"]);
    expect(parseSandboxRef("local-process:")).toEqual([null, "local-process:"]);
    expect(qualify("alicloud-express", "sb1", { ambient: "alicloud-express" })).toBe("sb1");
    expect(qualify("alicloud-express", "sb1", { ambient: "local-process" })).toBe("alicloud-express:sb1");
    expect(qualify("local-process", "sb1", { ambient: "alicloud-express" })).toBe("local-process:sb1");
  });
});

describe("TestProviderSelection", () => {
  it.each(["override", "env", "dotenv", "toml"])("test_precedence_chain[%s]", (where) => {
    registerProvider(new Py());
    if (where === "env") iso.setenv("ABX_PROVIDER", "py-prov");
    else if (where === "dotenv") iso.writeEnv("ABX_PROVIDER=py-prov\n");
    else if (where === "toml") iso.writeToml('[core]\nprovider = "py-prov"\n');
    expect(where === "override" ? resolveProviderId("py-prov") : resolveProviderId()).toBe("py-prov");
  });

  it("test_override_beats_env_beats_dotenv_beats_toml", () => {
    iso.writeToml('[core]\nprovider = "t"\n');
    expect(resolveProviderId()).toBe("t");
    iso.writeEnv("ABX_PROVIDER=d\n");
    expect(resolveProviderId()).toBe("d");
    iso.setenv("ABX_PROVIDER", "e");
    expect(resolveProviderId()).toBe("e");
    expect(resolveProviderId("o")).toBe("o");
  });
});

describe("TestCredentialIsolation", () => {
  beforeEach(async () => {
    await installPlugin(LOCAL_PROCESS);
    await installPlugin(E2B_COMPATIBLE);
  });

  it("test_generic_keys_only_reach_builtin_and_consented_inheritors", () => {
    iso.setenv("E2B_API_KEY", "generic-key-1234");
    iso.setenv("E2B_API_URL", "https://generic.example");
    expect(loadLayeredConfig({ provider: "alicloud-express" }).sandbox_api_key).toBe("generic-key-1234");
    expect(loadLayeredConfig({ provider: "local-process" }).sandbox_api_key).toBeNull();
    expect(loadLayeredConfig({ provider: "local-process" }).sandbox_base_url).not.toBe("https://generic.example");
    const c = loadLayeredConfig({ provider: "e2b-compatible" });
    expect([c.sandbox_api_key, c.sandbox_base_url]).toEqual(["generic-key-1234", "https://generic.example"]);
  });

  it("test_inherit_without_consent_is_dropped", async () => {
    iso.setenv("E2B_API_KEY", "generic-key-1234");
    const file = path.join(store.providerDir("e2b-compatible"), ".abx-install.json");
    const receipt = JSON.parse(fs.readFileSync(file, "utf-8"));
    receipt.consented.inherit = [];
    fs.writeFileSync(file, JSON.stringify(receipt));
    expect(loadLayeredConfig({ provider: "e2b-compatible" }).sandbox_api_key).toBeNull();
    expect(getProvider("e2b-compatible").inherit.size).toBe(0);
  });

  it("test_scoped_env_beats_generic_for_inheritor", () => {
    iso.setenv("E2B_API_KEY", "generic");
    iso.setenv("ABX_E2B_COMPATIBLE_SANDBOX_API_KEY", "scoped");
    expect(loadLayeredConfig({ provider: "e2b-compatible" }).sandbox_api_key).toBe("scoped");
    expect(loadLayeredConfig({ provider: "alicloud-express" }).sandbox_api_key).toBe("generic");
  });

  it("test_provider_defaults_beat_builtin_defaults", () => {
    const c = loadLayeredConfig({ provider: "e2b-compatible" });
    expect([c.sandbox_base_url, c.sandbox_domain]).toEqual(["https://api.e2b.dev", "e2b.dev"]);
  });

  it("test_provider_scoped_options_from_each_layer", () => {
    expect(loadLayeredConfig({ provider: "local-process" }).provider_options).toEqual({ debug: false });
    iso.writeToml("[providers.local-process]\ndebug = true\n");
    expect(loadLayeredConfig({ provider: "local-process" }).provider_options["debug"]).toBe(true);
    iso.writeEnv("ABX_LOCAL_PROCESS_TOKEN=from-dotenv\n");
    expect(loadLayeredConfig({ provider: "local-process" }).provider_options["token"]).toBe("from-dotenv");
    iso.setenv("ABX_LOCAL_PROCESS_TOKEN", "from-env");
    expect(loadLayeredConfig({ provider: "local-process" }).provider_options["token"]).toBe("from-env");
    expect(loadLayeredConfig({ provider: "local-process", provider_options: { token: "kw" } }).provider_options["token"]).toBe("kw");
  });

  it("test_other_providers_options_do_not_leak", () => {
    iso.setenv("ABX_LOCAL_PROCESS_TOKEN", "tok");
    expect(loadLayeredConfig({ provider: "alicloud-express" }).provider_options).not.toHaveProperty("token");
    expect(loadLayeredConfig({ provider: "alicloud-express" }).access_key_secret).toBeNull();
  });

  it("test_builtin_scoped_credentials_do_not_reach_plugins", () => {
    iso.setenv("ALICLOUD_ACCESS_KEY_ID", "ak");
    iso.setenv("ALICLOUD_ACCESS_KEY_SECRET", "sk");
    const c = loadLayeredConfig({ provider: "local-process" });
    expect(c.access_key_id).toBeNull();
    expect(c.access_key_secret).toBeNull();
    expect(c.provider_options).not.toHaveProperty("access_key_id");
  });
});

describe("TestRestProvider", () => {
  it("test_bearer_and_header_auth", async () => {
    expect(await new HeaderKeyAuth("k").getHeaders()).toEqual({ Authorization: "Bearer k" });
    expect(await new HeaderKeyAuth(" k ", "header", "X-Key").getHeaders()).toEqual({ "X-Key": "k" });
    expect(() => new HeaderKeyAuth("  ")).toThrow(InvalidAPIKeyError);
  });

  it("test_build_infra_uses_inherited_key", async () => {
    await installPlugin(E2B_COMPATIBLE);
    iso.setenv("E2B_API_KEY", "abcd1234");
    const prov = getProvider("e2b-compatible");
    expect(prov).toBeInstanceOf(RestProvider);
    const infra = await prov.buildInfra(loadLayeredConfig({ provider: "e2b-compatible" }));
    try {
      expect(await infra.auth?.getHeaders()).toEqual({ "X-API-Key": "abcd1234" });
      expect(infra.config.sandbox_base_url).toBe("https://api.e2b.dev");
    } finally {
      await infra.close?.();
    }
  });

  it("test_missing_key_is_credentials_error", async () => {
    await installPlugin(E2B_COMPATIBLE);
    await expect(getProvider("e2b-compatible").buildInfra(loadLayeredConfig({ provider: "e2b-compatible" }))).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("test_describe_lists_inherit_and_features", async () => {
    await installPlugin(E2B_COMPATIBLE);
    const d = getProvider("e2b-compatible").describe();
    expect(d.inherit).toEqual(["sandbox_api_key", "sandbox_base_url", "sandbox_domain"]);
    expect(d.features).toContain("files.rw");
    expect(d.features).not.toContain("storage.mount");
  });
});

describe("TestDoctor", () => {
  const names = (r: doctor.DoctorReport): string[] => r.checks.map((c) => c.name);

  it.skipIf(!pythonAvailable())("test_reference_plugin_passes", async () => {
    await installPlugin(LOCAL_PROCESS);
    const report = await doctor.doctor("local-process");
    expect(report.ok, JSON.stringify(report)).toBe(true);
    expect(names(report)).toEqual(["installed", "integrity", "config", "handshake"]);
  });

  it("test_not_installed", async () => {
    const report = await doctor.doctor("nothing-here");
    expect(report.ok).toBe(false);
    expect(report.checks[0]?.name).toBe("installed");
  });

  it("test_tamper_stops_before_spawn", async () => {
    await installPlugin(LOCAL_PROCESS);
    fs.writeFileSync(path.join(store.providerDir("local-process"), "provider.py"), "raise SystemExit(9)\n");
    const report = await doctor.doctor("local-process");
    expect(report.ok).toBe(false);
    expect(names(report)).toEqual(["installed", "integrity"]);
  });

  it("test_missing_rest_key_is_config_not_handshake", async () => {
    const src = path.join(tmp, "rest-no-key");
    fs.mkdirSync(src);
    fs.writeFileSync(
      path.join(src, "abx-provider.toml"),
      [
        "manifest_version = 1",
        "[provider]",
        'id = "rest-no-key"',
        'version = "0.1.0"',
        "[runtime]",
        'kind = "rest"',
        "[endpoint]",
        'base_url = "https://api.example.com"',
        "[features]",
        'supported = ["sandbox.lifecycle"]',
        "",
      ].join("\n"),
    );
    await installPlugin(src);
    const report = await doctor.doctor("rest-no-key");
    expect(report.ok).toBe(false);
    expect(report.checks.at(-1)).toMatchObject({ name: "config", ok: false });
    expect(names(report)).not.toContain("handshake");
    await doctor.verifyHandshake("rest-no-key");
    expect(store.listInstalledIds()).toEqual(["rest-no-key"]);
  });

  it("test_missing_config_stops_before_spawn", async () => {
    const src = writePlugin(path.join(tmp, "s"), {
      extra: '[config.fields.token]\ntype = "string"\nsecret = true\ncredential = true\nrequired = true\n',
    });
    await installPlugin(src);
    const report = await doctor.doctor("demo-prov");
    expect(names(report).at(-1)).toBe("config");
    expect(report.ok).toBe(false);
  });

  it.skipIf(!pythonAvailable())("test_handshake_failure_is_reported", async () => {
    const src = writePlugin(path.join(tmp, "s"), { files: { "provider.py": "import sys\nsys.exit(5)\n" } });
    await installPlugin(src);
    const report = await doctor.doctor("demo-prov");
    expect(report.checks.at(-1)).toMatchObject({ name: "handshake", ok: false });
  });

  it.skipIf(!pythonAvailable())("test_verify_handshake_raises_install_error", async () => {
    const src = writePlugin(path.join(tmp, "s"), { files: { "provider.py": "import sys\nsys.exit(5)\n" } });
    await expect(installPlugin(src, { verify: doctor.verifyHandshake })).rejects.toBeInstanceOf(E.ProviderInstallError);
    expect(store.listInstalledIds()).toEqual([]);
  });

  it.skipIf(!pythonAvailable())("test_doctor_inside_running_loop", async () => {
    await installPlugin(LOCAL_PROCESS);
    expect((await doctor.doctor("local-process")).ok).toBe(true);
  });
});
