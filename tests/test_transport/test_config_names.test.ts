/** Canonical names, legacy/compat aliases, precedence, audit and migration for `loadLayeredConfig` (port of `test_config_names.py`). */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { Provider } from "../../src/providers/base.js";
import { ProviderConfigError } from "../../src/providers/errors.js";
import { registerProvider } from "../../src/providers/registry.js";
import {
  LayeredConfig,
  _resetDeprecationWarnings,
  applyMigration,
  auditConfig,
  explainConfig,
  loadLayeredConfig,
  planMigration,
  resetLayeredConfig,
} from "../../src/transport/config_layers.js";
import { parseTomlText } from "../../src/utils/toml_plain.js";
import { useIso } from "../_support/iso.js";

class Dummy extends Provider {
  readonly id = "my-prov";
  async buildInfra(): Promise<never> {
    throw new Error("not implemented");
  }
}

const DEFAULT_URL = "https://api.cn-hangzhou.e2b.fc.aliyuncs.com";
const iso = useIso();

describe("TestBackwardCompatibleModel", () => {
  it("test_retired_constructor_names_are_ignored", () => {
    const c = new LayeredConfig({ api_key: "k", api_url: "https://x", domain: "d.example" } as never);
    expect(c.sandbox_api_key).toBeNull();
    expect(c.sandbox_base_url).toBe(DEFAULT_URL);
    expect(c.sandbox_domain).toBe("cn-hangzhou.e2b.fc.aliyuncs.com");
  });

  it("test_canonical_constructor_names", () => {
    const c = new LayeredConfig({ sandbox_api_key: "k", sandbox_base_url: "https://x", sandbox_domain: "d" });
    expect([c.api_key, c.api_url, c.domain]).toEqual(["k", "https://x", "d"]);
  });

  it("test_retired_kwarg_does_not_override_the_canonical_field", () => {
    const c = new LayeredConfig({ api_key: "a", sandbox_api_key: "b" } as never);
    expect(c.sandbox_api_key).toBe("b");
    expect(c.api_key).toBe("b");
  });

  it("test_legacy_setters", () => {
    const c = new LayeredConfig();
    c.api_key = "z";
    c.api_url = "https://y";
    expect([c.sandbox_api_key, c.sandbox_base_url]).toEqual(["z", "https://y"]);
  });

  it("test_defaults", () => {
    const c = new LayeredConfig();
    expect(c.sandbox_base_url).toBe(DEFAULT_URL);
    expect(c.provider).toBe("alicloud-express");
    expect(c.region).toBe("cn-hangzhou");
  });
});

const CASES: Array<[string, string, string | number | boolean]> = [
  ["ABX_SANDBOX_API_KEY", "sandbox_api_key", "v"],
  ["ABX_SANDBOX_BASE_URL", "sandbox_base_url", "https://v.example"],
  ["ABX_SANDBOX_DOMAIN", "sandbox_domain", "v.example"],
  ["ALIBABA_CLOUD_REGION_ID", "region", "cn-beijing"],
  ["ALICLOUD_ACCESS_KEY_ID", "access_key_id", "id"],
  ["ALICLOUD_ACCESS_KEY_SECRET", "access_key_secret", "sec"],
  ["ABX_HTTP_TIMEOUT", "http_timeout", 12.5],
  ["ABX_MAX_RETRIES", "max_retries", 7],
  ["ABX_HTTP2", "http2", false],
];
const RETIRED_ENV = [
  "E2B_API_KEY",
  "SANDBOX_API_KEY",
  "E2B_API_URL",
  "SANDBOX_API_BASE_URL",
  "E2B_DOMAIN",
  "SANDBOX_REGION",
  "ABX_ALICLOUD_EXPRESS_REGION",
  "AccessKey",
  "AccessSecret",
  "ABX_ALICLOUD_EXPRESS_ACCESS_KEY_ID",
  "ABX_ALICLOUD_EXPRESS_ACCESS_KEY_SECRET",
  "SANDBOX_HTTP_TIMEOUT",
];
const raw = (v: string | number | boolean): string => (v === false ? "false" : String(v));
const field = (cfg: LayeredConfig, name: string): unknown => (cfg as unknown as Record<string, unknown>)[name];

describe.each(CASES)("TestEveryNameInEveryLayer[%s -> %s]", (env, name, value) => {
  it("test_process_env", () => {
    iso.setenv(env, raw(value));
    expect(field(loadLayeredConfig(), name)).toBe(value);
  });
  it("test_dotenv", () => {
    iso.writeEnv(`${env}=${raw(value)}\n`);
    expect(field(loadLayeredConfig(), name)).toBe(value);
  });
  it("test_override_kwarg_by_field_name", () => {
    expect(field(loadLayeredConfig({ [name]: value }), name)).toBe(value);
  });
});

describe("retired names", () => {
  it.each(RETIRED_ENV)("test_retired_env_is_not_a_value[%s]", (env) => {
    iso.setenv(env, "retired-value");
    const cfg = loadLayeredConfig();
    expect(cfg.sandbox_api_key).toBeNull();
    expect(cfg.sandbox_base_url).toBe(DEFAULT_URL);
    expect(cfg.region).toBe("cn-hangzhou");
    expect(cfg.access_key_id).toBeNull();
    expect(cfg.access_key_secret).toBeNull();
    expect(cfg.http_timeout).toBe(30);
  });
});

describe("TestPrecedence", () => {
  it("test_retired_names_do_not_hide_the_canonical_dotenv", () => {
    iso.setenv("SANDBOX_API_KEY", "legacy");
    iso.setenv("E2B_API_KEY", "compat");
    iso.writeEnv("ABX_SANDBOX_API_KEY=canon-dotenv\n");
    expect(loadLayeredConfig().sandbox_api_key).toBe("canon-dotenv");
    iso.setenv("ABX_SANDBOX_API_KEY", "canon");
    expect(loadLayeredConfig().sandbox_api_key).toBe("canon");
  });

  it("test_layer_before_name", () => {
    iso.writeEnv("ABX_SANDBOX_API_KEY=canon-dotenv\n");
    iso.setenv("ABX_SANDBOX_API_KEY", "canon-env");
    expect(loadLayeredConfig().sandbox_api_key).toBe("canon-env");
  });

  it("test_override_beats_env_beats_dotenv_beats_toml", () => {
    iso.writeToml('[transport]\nsandbox_api_key = "toml"\n');
    expect(loadLayeredConfig().sandbox_api_key).toBe("toml");
    iso.writeEnv("ABX_SANDBOX_API_KEY=dotenv\n");
    expect(loadLayeredConfig().sandbox_api_key).toBe("dotenv");
    iso.setenv("ABX_SANDBOX_API_KEY", "env");
    expect(loadLayeredConfig().sandbox_api_key).toBe("env");
    expect(loadLayeredConfig({ api_key: "kw" }).sandbox_api_key).toBe("env");
    expect(loadLayeredConfig({ sandbox_api_key: "kw2" }).sandbox_api_key).toBe("kw2");
  });

  it("test_blank_override_and_env_are_ignored", () => {
    iso.writeEnv("ABX_SANDBOX_API_KEY=dotenv\n");
    iso.setenv("ABX_SANDBOX_API_KEY", "   ");
    expect(loadLayeredConfig({ sandbox_api_key: "  " }).sandbox_api_key).toBe("dotenv");
  });

  it("test_toml_ignores_retired_names", () => {
    iso.writeToml('[transport]\napi_url = "https://legacy"\n');
    expect(loadLayeredConfig().sandbox_base_url).toBe(DEFAULT_URL);
    iso.writeToml('[transport]\napi_url = "https://legacy"\nsandbox_base_url = "https://canon"\n');
    expect(loadLayeredConfig().sandbox_base_url).toBe("https://canon");
  });

  it("test_flat_retired_toml_is_ignored", () => {
    iso.writeToml('api_url = "https://flat"\n');
    expect(loadLayeredConfig().sandbox_base_url).toBe(DEFAULT_URL);
  });

  it("test_builtin_scoped_toml_table", () => {
    iso.writeToml('[providers.alicloud-express]\nregion = "cn-shanghai"\n');
    expect(loadLayeredConfig().region).toBe("cn-shanghai");
    iso.writeToml('[transport]\nregion = "cn-beijing"\n[providers.alicloud-express]\nregion = "cn-shanghai"\n');
    expect(loadLayeredConfig().region).toBe("cn-shanghai");
  });

  it("test_cache_is_used_without_overrides_and_reset_clears", () => {
    iso.setenv("ABX_SANDBOX_API_KEY", "one");
    expect(loadLayeredConfig()).toBe(loadLayeredConfig());
    process.env["ABX_SANDBOX_API_KEY"] = "two";
    expect(loadLayeredConfig().sandbox_api_key).toBe("one");
    resetLayeredConfig();
    expect(loadLayeredConfig().sandbox_api_key).toBe("two");
  });
});

describe("TestRegionDerivation", () => {
  it("test_region_derives_url_and_domain", () => {
    const c = loadLayeredConfig({ region: "cn-beijing" });
    expect(c.sandbox_base_url).toBe("https://api.cn-beijing.e2b.fc.aliyuncs.com");
    expect(c.sandbox_domain).toBe("cn-beijing.e2b.fc.aliyuncs.com");
  });

  it("test_explicit_process_env_url_wins_and_domain_stays_default", () => {
    iso.setenv("ABX_SANDBOX_BASE_URL", "https://custom.example");
    const c = loadLayeredConfig({ region: "cn-beijing" });
    expect(c.sandbox_base_url).toBe("https://custom.example");
    expect(c.sandbox_domain).toBe("cn-hangzhou.e2b.fc.aliyuncs.com");
  });

  it("test_dotenv_url_is_kept_as_default_semantics", () => {
    iso.writeEnv("ABX_SANDBOX_BASE_URL=https://dotenv.example\nALIBABA_CLOUD_REGION_ID=cn-beijing\n");
    expect(loadLayeredConfig().sandbox_base_url).toBe("https://dotenv.example");
  });

  it("test_retired_region_does_not_derive_the_url", () => {
    iso.setenv("SANDBOX_REGION", "cn-beijing");
    iso.setenv("E2B_API_URL", "https://retired.example");
    const c = loadLayeredConfig();
    expect(c.region).toBe("cn-hangzhou");
    expect(c.sandbox_base_url).toBe(DEFAULT_URL);
  });
});

describe("TestProviderSelectionAndOptions", () => {
  it("test_default_provider", () => {
    expect(loadLayeredConfig().provider).toBe("alicloud-express");
  });

  it.each(["env", "dotenv", "toml", "override"])("test_provider_from_each_layer[%s]", (where) => {
    registerProvider(new Dummy());
    if (where === "env") iso.setenv("ABX_PROVIDER", "my-prov");
    else if (where === "dotenv") iso.writeEnv("ABX_PROVIDER=my-prov\n");
    else if (where === "toml") iso.writeToml('[core]\nprovider = "my-prov"\n');
    const cfg = where === "override" ? loadLayeredConfig({ provider: "my-prov" }) : loadLayeredConfig();
    expect(cfg.provider).toBe("my-prov");
  });

  it("test_builtin_options", () => {
    expect(loadLayeredConfig({ provider_options: { region: "cn-shanghai" } }).region).toBe("cn-shanghai");
  });

  it("test_unknown_option_is_a_typed_error", () => {
    try {
      loadLayeredConfig({ provider_options: { nope: 1 } });
      expect.unreachable();
    } catch (exc) {
      expect(exc).toBeInstanceOf(ProviderConfigError);
      expect((exc as ProviderConfigError).code).toBe("E8002");
    }
  });
});

describe("TestExplain", () => {
  it("test_sources_and_masking", () => {
    iso.writeToml('[transport]\nsandbox_base_url = "https://t.example"\n');
    iso.setenv("ABX_SANDBOX_API_KEY", "abcdefghijkl");
    const info = explainConfig();
    expect(info["sandbox_api_key"]).toMatchObject({ source: "environ", name: "ABX_SANDBOX_API_KEY", value: "****ijkl" });
    expect(JSON.stringify(info)).not.toContain("abcdefgh");
    expect(info["sandbox_base_url"]?.source).toBe("toml");
    expect(info["http_timeout"]?.source).toBe("default");
  });

  it("test_short_secrets_fully_masked", () => {
    iso.setenv("ABX_SANDBOX_API_KEY", "short");
    expect(explainConfig()["sandbox_api_key"]?.value).toBe("****");
  });
});

describe("TestAudit", () => {
  it("test_retired_names_are_not_reported", () => {
    iso.setenv("SANDBOX_API_KEY", "secret-value");
    iso.setenv("E2B_API_KEY", "x");
    iso.writeEnv("SANDBOX_REGION=cn-beijing\nABX_HTTP_TIMEOUT=5\n");
    iso.writeToml('[transport]\napi_url = "https://t"\nsandbox_domain = "d"\n');
    const found = auditConfig();
    expect(found).toEqual([]);
    expect(JSON.stringify(found)).not.toContain("secret-value");
  });

  it("test_empty_when_clean", () => {
    iso.setenv("ABX_SANDBOX_API_KEY", "x");
    expect(auditConfig()).toEqual([]);
  });
});

describe("TestOptInWarning", () => {
  it("test_default_is_silent", () => {
    iso.setenv("SANDBOX_API_KEY", "x");
    _resetDeprecationWarnings();
    const spy = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    try {
      loadLayeredConfig();
      new LayeredConfig({ api_key: "x" } as never);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("test_opt_in_does_not_warn_for_a_retired_kwarg", () => {
    iso.setenv("ABX_WARN_DEPRECATED", "1");
    _resetDeprecationWarnings();
    const spy = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    try {
      const c = new LayeredConfig({ api_key: "x" } as never);
      expect(c.sandbox_api_key).toBeNull();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("TestMigration", () => {
  const write = (): void => {
    iso.writeToml('[transport]\napi_url = "https://t.example"\nregion = "cn-beijing"\nhttp_timeout = 9\n');
    iso.writeEnv("# keep me\nE2B_API_KEY=abc\nSANDBOX_REGION=cn-shanghai\nSANDBOX_API_KEY=old\nOPENAI_API_KEY=k\n");
  };

  it("test_plan_is_deterministic", () => {
    write();
    expect(planMigration()).toEqual(planMigration());
  });

  it("test_apply_rewrites_to_canonical_and_preserves_effective_config", () => {
    write();
    const before = loadLayeredConfig();
    const snapshot = ["sandbox_api_key", "sandbox_base_url", "region", "http_timeout"].map((f) => field(before, f));
    const plan = applyMigration();
    expect(plan.length).toBeGreaterThan(0);
    resetLayeredConfig();
    const after = loadLayeredConfig();
    ["sandbox_api_key", "sandbox_base_url", "region", "http_timeout"].forEach((f, i) => expect(field(after, f), f).toEqual(snapshot[i]));
    const doc = parseTomlText(fs.readFileSync(iso.toml, "utf-8")) as Record<string, Record<string, unknown>>;
    expect(doc["core"]?.["config_format"]).toBe(2);
    expect(doc["transport"]?.["api_url"]).toBe("https://t.example");
    expect(doc["transport"]?.["http_timeout"]).toBe(9);
    expect(doc["transport"]).not.toHaveProperty("region");
    const providers = doc["providers"] as Record<string, Record<string, unknown>> | undefined;
    expect(providers?.["alicloud-express"]?.["region"]).toBe("cn-beijing");
    const envText = fs.readFileSync(iso.env, "utf-8");
    expect(envText).toContain("# keep me");
    expect(envText).toContain("OPENAI_API_KEY=k");
    expect(envText).toContain("E2B_API_KEY=abc");
    expect(envText).toContain("SANDBOX_API_KEY=old");
    expect(envText).not.toContain("ABX_SANDBOX_API_KEY");
    expect(fs.existsSync(path.join(iso.home, "config.toml.bak"))).toBe(true);
    expect(fs.existsSync(path.join(iso.home, ".env.bak"))).toBe(true);
    if (process.platform !== "win32") {
      expect((fs.statSync(iso.toml).mode & 0o777).toString(8)).toBe("600");
      expect((fs.statSync(path.join(iso.home, ".env.bak")).mode & 0o777).toString(8)).toBe("600");
    }
  });

  it("test_apply_twice_is_stable", () => {
    write();
    applyMigration();
    const first = [fs.readFileSync(iso.toml, "utf-8"), fs.readFileSync(iso.env, "utf-8")];
    applyMigration();
    expect([fs.readFileSync(iso.toml, "utf-8"), fs.readFileSync(iso.env, "utf-8")]).toEqual(first);
    expect(auditConfig()).toEqual([]);
  });
});
