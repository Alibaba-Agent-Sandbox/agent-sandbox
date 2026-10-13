/** Registry invariants and the pure resolver (precedence + alias table). Port of `tests/test_utils/test_config_keys.py`. */

import { describe, expect, it } from "vitest";

import { CLI_ONLY_KEYS } from "../../src/utils/cli_config_keys.js";
import {
  ALIAS_KINDS,
  ALIAS_SURFACES,
  ALICLOUD_EXPRESS_KEYS,
  CORE_KEYS,
  envNames,
  exportSchema,
  getKey,
  providerEnvName,
  validateProviderId,
  type ConfigKey,
} from "../../src/utils/config_keys.js";
import { coerce, resolveKey, type Sources } from "../../src/utils/config_resolver.js";

const ALL_KEYS: readonly ConfigKey[] = [...CORE_KEYS, ...ALICLOUD_EXPRESS_KEYS];
const key = (name: string, scope = "core"): ConfigKey => getKey(name, scope) as ConfigKey;
const src = (kw: Partial<Sources> = {}): Sources => ({ overrides: {}, environ: {}, dotenv: [], toml: {}, ...kw });

describe("TestRegistry", () => {
  it("test_unique_keys_per_scope", () => {
    const seen = ALL_KEYS.map((k) => `${k.scope}.${k.key}`);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("test_every_canonical_env_name_is_unique", () => {
    const names = ALL_KEYS.map((k) => k.env);
    expect(new Set(names).size).toBe(names.length);
  });

  it("test_no_alias_collides_with_another_key", () => {
    const owners = new Map<string, string>();
    for (const k of ALL_KEYS) {
      for (const a of k.aliases) {
        const slot = `${a.surface}:${a.name}`;
        const owner = `${k.scope}.${k.key}`;
        if (owners.has(slot) && owners.get(slot) !== owner) {
          throw new Error(`alias ${slot} used by ${owners.get(slot)} and ${owner}`);
        }
        owners.set(slot, owner);
      }
    }
  });

  it("test_aliases_are_well_formed", () => {
    for (const k of ALL_KEYS) {
      for (const a of k.aliases) {
        expect(ALIAS_KINDS).toContain(a.kind);
        expect(ALIAS_SURFACES).toContain(a.surface);
      }
    }
  });

  it("test_secrets_are_masked_kinds", () => {
    const secrets = new Set(ALL_KEYS.filter((k) => k.secret).map((k) => k.key));
    for (const s of ["sandbox_api_key", "access_key_secret", "llm_api_key", "github_token", "acr_password", "mcp_auth_token"]) {
      expect(secrets.has(s)).toBe(true);
    }
  });

  it("test_each_key_has_one_environment_name", () => {
    for (const k of ALL_KEYS) {
      expect(k.aliases).toEqual([]);
      expect(envNames(k)).toEqual([k.env]);
    }
  });

  it("test_vendor_official_names_are_the_canonical_env", () => {
    expect(key("access_key_id", "alicloud-express").env).toBe("ALICLOUD_ACCESS_KEY_ID");
    expect(key("access_key_secret", "alicloud-express").env).toBe("ALICLOUD_ACCESS_KEY_SECRET");
    expect(key("region", "alicloud-express").env).toBe("ALIBABA_CLOUD_REGION_ID");
    expect(key("acr_namespace", "alicloud-express").env).toBe("ACR_NAMESPACE");
    expect(key("github_token").env).toBe("GITHUB_TOKEN");
    expect(key("sandbox_api_key").env).toBe("ABX_SANDBOX_API_KEY");
    expect(key("llm_api_key").env).toBe("ABX_LLM_API_KEY");
  });

  it("test_retired_names_are_not_resolved", () => {
    const known = new Set(ALL_KEYS.map((k) => k.env));
    for (const name of ["E2B_API_KEY", "SANDBOX_API_KEY", "AccessKey", "ABX_ALICLOUD_EXPRESS_ACCESS_KEY_ID", "OPENAI_API_KEY"]) {
      expect(known.has(name)).toBe(false);
    }
  });

  it("test_env_names_order_is_scoped_then_canonical", () => {
    expect(envNames(key("sandbox_api_key"), { scopedFor: "my-prov" })).toEqual([
      "ABX_MY_PROV_SANDBOX_API_KEY",
      "ABX_SANDBOX_API_KEY",
    ]);
  });

  it("test_schema_export_is_stable_and_complete", () => {
    const schema = exportSchema();
    expect(schema.builtin_provider.id).toBe("alicloud-express");
    expect(schema.builtin_provider.name_zh).toBe("阿里云极速版");
    const shared = CORE_KEYS.filter((k) => !CLI_ONLY_KEYS.includes(k));
    expect(schema.keys.slice(0, shared.length).map((r) => r.key)).toEqual(shared.map((k) => k.key));
    expect(exportSchema()).toEqual(schema);
  });

  it.each([
    ["my-provider", true], ["e2b", false], ["e2b-compat", true], ["a", false], ["My-Provider", false], ["-x", false],
    ["a--b", false], ["alicloud-express", false], ["alicloud-foo", false], ["abx-foo", false], ["x".repeat(41), false],
    ["1abc", false], ["a_b", false],
  ] as Array<[string, boolean]>)("test_validate_provider_id[%s]", (pid, ok) => {
    expect(validateProviderId(pid) === null).toBe(ok);
  });

  it("test_provider_env_name", () => {
    expect(providerEnvName("my-provider", "api_token")).toBe("ABX_MY_PROVIDER_API_TOKEN");
  });
});

describe("TestCoerce", () => {
  it("test_blank_is_unset", () => {
    expect(coerce(key("sandbox_api_key"), "   ")).toBeNull();
    expect(coerce(key("sandbox_api_key"), null)).toBeNull();
  });

  it.each([["true", true], ["1", true], ["No", false], ["off", false], ["maybe", null]] as Array<[string, boolean | null]>)(
    "test_bool[%s]",
    (raw, want) => {
      expect(coerce(key("http2"), raw)).toBe(want);
    },
  );

  it("test_int_and_float", () => {
    expect(coerce(key("max_retries"), "5")).toBe(5);
    expect(coerce(key("max_retries"), "5.0")).toBe(5);
    expect(coerce(key("max_retries"), "x")).toBeNull();
    expect(coerce(key("http_timeout"), "2.5")).toBe(2.5);
  });

  it("test_enum_is_case_insensitive_and_validated", () => {
    expect(coerce(key("log_level"), "debug")).toBe("DEBUG");
    expect(coerce(key("log_level"), "loud")).toBeNull();
  });
});

describe("TestResolvePrecedence", () => {
  const KEY = key("sandbox_api_key");
  const val = (s: Sources, opts = {}) => resolveKey(KEY, s, opts);

  it("test_layer_order", () => {
    const s = src({
      overrides: { sandbox_api_key: "o" },
      environ: { ABX_SANDBOX_API_KEY: "e" },
      dotenv: [{ ABX_SANDBOX_API_KEY: "d1" }, { ABX_SANDBOX_API_KEY: "d2" }],
      toml: { transport: { sandbox_api_key: "t" } },
    });
    expect([val(s)?.value, val(s)?.layer]).toEqual(["o", "override"]);
    s.overrides = {};
    expect([val(s)?.value, val(s)?.layer]).toEqual(["e", "environ"]);
    s.environ = {};
    expect([val(s)?.value, val(s)?.layer, val(s)?.layer_index]).toEqual(["d1", "dotenv", 0]);
    s.dotenv = [{}, { ABX_SANDBOX_API_KEY: "d2" }];
    expect([val(s)?.value, val(s)?.layer_index]).toEqual(["d2", 1]);
    s.dotenv = [];
    expect([val(s)?.value, val(s)?.layer]).toEqual(["t", "toml"]);
  });

  it("test_retired_name_does_not_beat_the_canonical_name", () => {
    const s = src({
      environ: { SANDBOX_API_KEY: "legacy-env", E2B_API_KEY: "compat-env" },
      dotenv: [{ ABX_SANDBOX_API_KEY: "canon-dotenv" }],
    });
    expect(val(s)?.value).toBe("canon-dotenv");
  });

  it("test_blank_values_fall_through", () => {
    const s = src({ environ: { ABX_SANDBOX_API_KEY: "  " }, dotenv: [{ ABX_SANDBOX_API_KEY: "from-dotenv" }] });
    expect(val(s)?.value).toBe("from-dotenv");
  });

  it("test_scoped_name_beats_canonical", () => {
    const s = src({ environ: { ABX_MY_PROV_SANDBOX_API_KEY: "scoped", ABX_SANDBOX_API_KEY: "plain" } });
    expect(val(s, { scopedFor: "my-prov" })?.value).toBe("scoped");
    expect(val(s)?.value).toBe("plain");
  });

  it("test_scoped_toml_table_beats_transport", () => {
    const toml = { providers: { "my-prov": { sandbox_api_key: "scoped" } }, transport: { sandbox_api_key: "plain" } };
    expect(val(src({ toml }), { scopedFor: "my-prov" })?.value).toBe("scoped");
    expect(val(src({ toml }))?.value).toBe("plain");
  });

  it("test_toml_ignores_retired_names", () => {
    const k = key("sandbox_base_url");
    expect(resolveKey(k, src({ toml: { transport: { api_url: "legacy", sandbox_base_url: "canon" } } }))?.value).toBe("canon");
    expect(resolveKey(k, src({ toml: { transport: { api_base_url: "b", api_url: "a" } } }))?.layer).toBe("default");
  });

  it("test_flat_retired_toml_is_ignored", () => {
    const k = key("sandbox_base_url");
    expect(resolveKey(k, src({ toml: { api_url: "flat" } }))?.layer).toBe("default");
  });

  it("test_default_applies_last_and_can_be_disabled", () => {
    const k = key("http_timeout");
    expect(resolveKey(k, src())?.value).toBe(30);
    expect(resolveKey(k, src(), { useDefault: false })).toBeNull();
  });

  it("test_overrides_ignore_retired_kwarg_names", () => {
    const k = key("sandbox_base_url");
    expect(resolveKey(k, src({ overrides: { api_url: "u" } }))?.layer).toBe("default");
    expect(resolveKey(k, src({ overrides: { sandbox_base_url: "u2" } }))?.value).toBe("u2");
  });
});

function sampleFor(k: ConfigKey): string {
  if (k.type === "int" || k.type === "float") return "1";
  if (k.type === "bool") return "true";
  if (k.type === "enum") return "DEBUG";
  return "value";
}

describe.each(ALL_KEYS.map((k) => [`${k.scope}.${k.key}`, k] as const))("every name of %s", (_id, k) => {
  it("test_every_env_name_resolves_its_key", () => {
    for (const name of envNames(k)) {
      const r = resolveKey(k, src({ environ: { [name]: sampleFor(k) } }), { useDefault: false });
      expect(r).not.toBeNull();
      expect(r?.name).toBe(name);
      expect(r?.layer).toBe("environ");
    }
  });

  it("test_every_env_name_resolves_from_dotenv", () => {
    for (const name of envNames(k)) {
      const r = resolveKey(k, src({ dotenv: [{ [name]: sampleFor(k) }] }), { useDefault: false });
      expect(r?.layer).toBe("dotenv");
    }
  });
});
