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
  it("test_legacy_constructor_names", () => {
    const c = new LayeredConfig({ api_key: "k", api_url: "https://x", domain: "d.example" } as never);
    expect([c.sandbox_api_key, c.sandbox_base_url, c.sandbox_domain]).toEqual(["k", "https://x", "d.example"]);
    expect([c.api_key, c.api_url, c.api_base_url, c.domain]).toEqual(["k", "https://x", "https://x", "d.example"]);
  });

  it("test_canonical_constructor_names", () => {
    const c = new LayeredConfig({ sandbox_api_key: "k", sandbox_base_url: "https://x", sandbox_domain: "d" });
    expect([c.api_key, c.api_url, c.domain]).toEqual(["k", "https://x", "d"]);
  });

  it("test_same_value_twice_is_fine_conflict_is_error", () => {
    expect(new LayeredConfig({ api_key: "k", sandbox_api_key: "k" } as never).api_key).toBe("k");
    expect(() => new LayeredConfig({ api_key: "a", sandbox_api_key: "b" } as never)).toThrow(ProviderConfigError);
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
  ["EBX_SANDBOX_API_KEY", "sandbox_api_key", "v"],
  ["E2B_API_KEY", "sandbox_api_key", "v"],
  ["SANDBOX_API_KEY", "sandbox_api_key", "v"],
  ["EBX_SANDBOX_BASE_URL", "sandbox_base_url", "https://v.example"],
  ["E2B_API_URL", "sandbox_base_url", "https://v.example"],
  ["SANDBOX_API_BASE_URL", "sandbox_base_url", "https://v.example"],
  ["EBX_SANDBOX_DOMAIN", "sandbox_domain", "v.example"],
  ["E2B_DOMAIN", "sandbox_domain", "v.example"],
  ["EBX_ALICLOUD_EXPRESS_REGION", "region", "cn-beijing"],
  ["SANDBOX_REGION", "region", "cn-beijing"],
  ["EBX_ALICLOUD_EXPRESS_ACCESS_KEY_ID", "access_key_id", "id"],
  ["ALICLOUD_ACCESS_KEY_ID", "access_key_id", "id"],
  ["AccessKey", "access_key_id", "id"],
  ["EBX_ALICLOUD_EXPRESS_ACCESS_KEY_SECRET", "access_key_secret", "sec"],
  ["ALICLOUD_ACCESS_KEY_SECRET", "access_key_secret", "sec"],
  ["AccessSecret", "access_key_secret", "sec"],
  ["EBX_HTTP_TIMEOUT", "http_timeout", 12.5],
  ["SANDBOX_HTTP_TIMEOUT", "http_timeout", 12.5],
  ["EBX_MAX_RETRIES", "max_retries", 7],
  ["EBX_HTTP2", "http2", false],
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

describe("TestPrecedence", () => {
  it("test_name_order_in_process_env", () => {
    iso.setenv("SANDBOX_API_KEY", "legacy");
    expect(loadLayeredConfig().sandbox_api_key).toBe("legacy");
    iso.setenv("E2B_API_KEY", "compat");
    expect(loadLayeredConfig().sandbox_api_key).toBe("compat");
    iso.setenv("EBX_SANDBOX_API_KEY", "canon");
    expect(loadLayeredConfig().sandbox_api_key).toBe("canon");
  });

  it("test_layer_before_name", () => {
    iso.setenv("SANDBOX_API_KEY", "legacy-env");
    iso.writeEnv("EBX_SANDBOX_API_KEY=canon-dotenv\n");
    expect(loadLayeredConfig().sandbox_api_key).toBe("legacy-env");
  });

  it("test_override_beats_env_beats_dotenv_beats_toml", () => {
    iso.writeToml('[transport]\nsandbox_api_key = "toml"\n');
    expect(loadLayeredConfig().sandbox_api_key).toBe("toml");
    iso.writeEnv("E2B_API_KEY=dotenv\n");
    expect(loadLayeredConfig().sandbox_api_key).toBe("dotenv");
    iso.setenv("E2B_API_KEY", "env");
    expect(loadLayeredConfig().sandbox_api_key).toBe("env");
    expect(loadLayeredConfig({ api_key: "kw" }).sandbox_api_key).toBe("kw");
    expect(loadLayeredConfig({ sandbox_api_key: "kw2" }).sandbox_api_key).toBe("kw2");
  });

  it("test_blank_override_and_env_are_ignored", () => {
    iso.writeEnv("E2B_API_KEY=dotenv\n");
    iso.setenv("EBX_SANDBOX_API_KEY", "   ");
    expect(loadLayeredConfig({ api_key: "  " }).sandbox_api_key).toBe("dotenv");
  });

  it("test_toml_legacy_and_canonical_names", () => {
    iso.writeToml('[transport]\napi_url = "https://legacy"\n');
    expect(loadLayeredConfig().sandbox_base_url).toBe("https://legacy");
    iso.writeToml('[transport]\napi_url = "https://legacy"\nsandbox_base_url = "https://canon"\n');
    expect(loadLayeredConfig().sandbox_base_url).toBe("https://canon");
  });

  it("test_flat_legacy_toml", () => {
    iso.writeToml('api_url = "https://flat"\n');
    expect(loadLayeredConfig().sandbox_base_url).toBe("https://flat");
  });

  it("test_builtin_scoped_toml_table", () => {
    iso.writeToml('[providers.alicloud-express]\nregion = "cn-shanghai"\n');
    expect(loadLayeredConfig().region).toBe("cn-shanghai");
    iso.writeToml('[transport]\nregion = "cn-beijing"\n[providers.alicloud-express]\nregion = "cn-shanghai"\n');
    expect(loadLayeredConfig().region).toBe("cn-shanghai");
  });

  it("test_cache_is_used_without_overrides_and_reset_clears", () => {
    iso.setenv("E2B_API_KEY", "one");
    expect(loadLayeredConfig()).toBe(loadLayeredConfig());
    process.env["E2B_API_KEY"] = "two";
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
    iso.setenv("E2B_API_URL", "https://custom.example");
    const c = loadLayeredConfig({ region: "cn-beijing" });
    expect(c.sandbox_base_url).toBe("https://custom.example");
    expect(c.sandbox_domain).toBe("cn-hangzhou.e2b.fc.aliyuncs.com");
  });

  it("test_dotenv_url_is_kept_as_default_semantics", () => {
    iso.writeEnv("E2B_API_URL=https://dotenv.example\nSANDBOX_REGION=cn-beijing\n");
    expect(loadLayeredConfig().sandbox_base_url).toBe("https://dotenv.example");
  });
});

describe("TestProviderSelectionAndOptions", () => {
  it("test_default_provider", () => {
    expect(loadLayeredConfig().provider).toBe("alicloud-express");
  });

  it.each(["env", "dotenv", "toml", "override"])("test_provider_from_each_layer[%s]", (where) => {
    registerProvider(new Dummy());
    if (where === "env") iso.setenv("EBX_PROVIDER", "my-prov");
    else if (where === "dotenv") iso.writeEnv("EBX_PROVIDER=my-prov\n");
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
    iso.writeToml('[transport]\napi_url = "https://t.example"\n');
    iso.setenv("E2B_API_KEY", "abcdefghijkl");
    const info = explainConfig();
    expect(info["sandbox_api_key"]).toMatchObject({ source: "environ", name: "E2B_API_KEY", value: "****ijkl" });
    expect(JSON.stringify(info)).not.toContain("abcdefgh");
    expect(info["sandbox_base_url"]?.source).toBe("toml");
    expect(info["http_timeout"]?.source).toBe("default");
  });

  it("test_short_secrets_fully_masked", () => {
    iso.setenv("E2B_API_KEY", "short");
    expect(explainConfig()["sandbox_api_key"]?.value).toBe("****");
  });
});

describe("TestAudit", () => {
  it("test_reports_legacy_only_by_name", () => {
    iso.setenv("SANDBOX_API_KEY", "secret-value");
    iso.setenv("E2B_API_KEY", "x");
    iso.writeEnv("SANDBOX_REGION=cn-beijing\nEBX_HTTP_TIMEOUT=5\n");
    iso.writeToml('[transport]\napi_url = "https://t"\nsandbox_domain = "d"\n');
    const found = auditConfig();
    const names = new Set(found.map((f) => `${f.where}|${f.name}`));
    expect(names.has("env|SANDBOX_API_KEY")).toBe(true);
    expect(names.has("dotenv|SANDBOX_REGION")).toBe(true);
    expect(names.has("config|transport.api_url")).toBe(true);
    expect([...names].some((n) => n.endsWith("|E2B_API_KEY"))).toBe(false);
    expect([...names].some((n) => n.includes("sandbox_domain"))).toBe(false);
    expect(JSON.stringify(found)).not.toContain("secret-value");
  });

  it("test_empty_when_clean", () => {
    iso.setenv("E2B_API_KEY", "x");
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

  it("test_opt_in_warns_once_per_legacy_kwarg", () => {
    iso.setenv("EBX_WARN_DEPRECATED", "1");
    _resetDeprecationWarnings();
    const spy = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    try {
      new LayeredConfig({ api_key: "x" } as never);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0]?.[0])).toContain("api_key");
      expect(spy.mock.calls[0]?.[1]).toBe("DeprecationWarning");
      new LayeredConfig({ api_key: "y" } as never);
      expect(spy).toHaveBeenCalledTimes(1);
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
    expect(doc["transport"]).not.toHaveProperty("api_url");
    expect(doc["transport"]?.["sandbox_base_url"]).toBe("https://t.example");
    const envText = fs.readFileSync(iso.env, "utf-8");
    expect(envText).toContain("# keep me");
    expect(envText).toContain("OPENAI_API_KEY=k");
    const names = new Set(
      envText
        .split("\n")
        .filter((ln) => ln.includes("=") && !ln.startsWith("#"))
        .map((ln) => ln.split("=", 1)[0]),
    );
    expect(names).toEqual(new Set(["EBX_SANDBOX_API_KEY", "EBX_ALICLOUD_EXPRESS_REGION", "OPENAI_API_KEY"]));
    expect(fs.existsSync(path.join(iso.home, "config.toml.bak"))).toBe(true);
    expect(fs.existsSync(path.join(iso.home, ".env.bak"))).toBe(true);
    if (process.platform !== "win32") expect((fs.statSync(iso.env).mode & 0o777).toString(8)).toBe("600");
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
