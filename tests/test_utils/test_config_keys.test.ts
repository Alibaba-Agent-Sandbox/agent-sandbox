/** Registry invariants and the pure resolver (precedence + alias table). Port of `tests/test_utils/test_config_keys.py`. */

import { describe, expect, it } from "vitest";

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
const key = (name: string): ConfigKey => getKey(name) as ConfigKey;
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

  it.each([
    "SANDBOX_API_KEY", "SANDBOX_API_BASE_URL", "SANDBOX_HTTP_TIMEOUT", "SANDBOX_LOG_LEVEL", "SANDBOX_TEMPLATE", "EBX_TEMPLATE",
    "EBX_QWEN_CODE_API_KEY", "SANDBOX_REGION", "AccessKey", "AccessSecret", "ACR_NAMESPACE", "ACR_REGISTRY", "ACR_REPO",
    "ACR_USERNAME", "ACR_PASSWORD", "ACREE_INSTANCE_ID", "ACR_VPC_ID", "ACR_VSWITCH_IDS", "ACR_SECURITY_GROUP_ID", "TEAM_ID",
  ])("test_inventory_names_are_all_known[%s]", (legacy) => {
    const known = new Set(ALL_KEYS.flatMap((k) => k.aliases.filter((a) => a.surface === "env").map((a) => a.name)));
    expect(known.has(legacy)).toBe(true);
  });

  it.each([
    "E2B_API_KEY", "E2B_API_URL", "E2B_DOMAIN", "E2B_TEAM_ID", "ALICLOUD_ACCESS_KEY_ID", "ALICLOUD_ACCESS_KEY_SECRET",
    "GITHUB_TOKEN", "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL", "DASHSCOPE_API_KEY", "BAILIAN_CODING_PLAN_API_KEY",
  ])("test_compat_and_native_names_are_known[%s]", (name) => {
    const known = new Set(
      ALL_KEYS.flatMap((k) => k.aliases.filter((a) => a.surface === "env" && (a.kind === "compat" || a.kind === "native")).map((a) => a.name)),
    );
    expect(known.has(name)).toBe(true);
  });

  it("test_e2b_names_are_never_legacy", () => {
    for (const k of ALL_KEYS) for (const a of k.aliases) if (a.name.startsWith("E2B_")) expect(a.kind).toBe("compat");
  });

  it("test_env_names_order_scoped_canonical_compat_legacy", () => {
    expect(envNames(key("sandbox_api_key"), { scopedFor: "my-prov" })).toEqual([
      "EBX_MY_PROV_SANDBOX_API_KEY",
      "EBX_SANDBOX_API_KEY",
      "E2B_API_KEY",
      "SANDBOX_API_KEY",
    ]);
  });

  it("test_schema_export_is_stable_and_complete", () => {
    const schema = exportSchema();
    expect(schema.builtin_provider.id).toBe("alicloud-express");
    expect(schema.builtin_provider.name_zh).toBe("阿里云极速版");
    expect(schema.keys.slice(0, CORE_KEYS.length).map((r) => r.key)).toEqual(CORE_KEYS.map((k) => k.key));
    expect(exportSchema()).toEqual(schema);
  });

  it.each([
    ["my-provider", true], ["e2b", false], ["e2b-compat", true], ["a", false], ["My-Provider", false], ["-x", false],
    ["a--b", false], ["alicloud-express", false], ["alicloud-foo", false], ["ebx-foo", false], ["x".repeat(41), false],
    ["1abc", false], ["a_b", false],
  ] as Array<[string, boolean]>)("test_validate_provider_id[%s]", (pid, ok) => {
    expect(validateProviderId(pid) === null).toBe(ok);
  });

  it("test_provider_env_name", () => {
    expect(providerEnvName("my-provider", "api_token")).toBe("EBX_MY_PROVIDER_API_TOKEN");
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
      environ: { EBX_SANDBOX_API_KEY: "e" },
      dotenv: [{ EBX_SANDBOX_API_KEY: "d1" }, { EBX_SANDBOX_API_KEY: "d2" }],
      toml: { transport: { sandbox_api_key: "t" } },
    });
    expect([val(s)?.value, val(s)?.layer]).toEqual(["o", "override"]);
    s.overrides = {};
    expect([val(s)?.value, val(s)?.layer]).toEqual(["e", "environ"]);
    s.environ = {};
    expect([val(s)?.value, val(s)?.layer, val(s)?.layer_index]).toEqual(["d1", "dotenv", 0]);
    s.dotenv = [{}, { EBX_SANDBOX_API_KEY: "d2" }];
    expect([val(s)?.value, val(s)?.layer_index]).toEqual(["d2", 1]);
    s.dotenv = [];
    expect([val(s)?.value, val(s)?.layer]).toEqual(["t", "toml"]);
  });

  it("test_layer_beats_name_priority", () => {
    const s = src({ environ: { SANDBOX_API_KEY: "legacy-env" }, dotenv: [{ EBX_SANDBOX_API_KEY: "canon-dotenv" }] });
    expect(val(s)?.value).toBe("legacy-env");
  });

  it("test_name_order_within_layer", () => {
    const names = ["EBX_SANDBOX_API_KEY", "E2B_API_KEY", "SANDBOX_API_KEY"];
    const environ: Record<string, string> = Object.fromEntries(names.map((n) => [n, n]));
    for (const n of names) {
      expect(val(src({ environ }))?.value).toBe(n);
      delete environ[n];
    }
  });

  it("test_blank_values_fall_through", () => {
    const s = src({ environ: { EBX_SANDBOX_API_KEY: "  ", E2B_API_KEY: "" }, dotenv: [{ SANDBOX_API_KEY: "from-dotenv" }] });
    expect(val(s)?.value).toBe("from-dotenv");
  });

  it("test_scoped_name_beats_canonical", () => {
    const s = src({ environ: { EBX_MY_PROV_SANDBOX_API_KEY: "scoped", EBX_SANDBOX_API_KEY: "plain" } });
    expect(val(s, { scopedFor: "my-prov" })?.value).toBe("scoped");
    expect(val(s)?.value).toBe("plain");
  });

  it("test_scoped_toml_table_beats_transport", () => {
    const toml = { providers: { "my-prov": { sandbox_api_key: "scoped" } }, transport: { sandbox_api_key: "plain" } };
    expect(val(src({ toml }), { scopedFor: "my-prov" })?.value).toBe("scoped");
    expect(val(src({ toml }))?.value).toBe("plain");
  });

  it("test_toml_name_order", () => {
    const k = key("sandbox_base_url");
    expect(resolveKey(k, src({ toml: { transport: { api_url: "legacy", sandbox_base_url: "canon" } } }))?.value).toBe("canon");
    expect(resolveKey(k, src({ toml: { transport: { api_base_url: "b", api_url: "a" } } }))?.value).toBe("a");
  });

  it("test_flat_legacy_toml_only_without_transport_table", () => {
    const k = key("sandbox_base_url");
    expect(resolveKey(k, src({ toml: { api_url: "flat" } }))?.value).toBe("flat");
    expect(resolveKey(k, src({ toml: { api_url: "flat", transport: { x: 1 } } }))?.layer).toBe("default");
  });

  it("test_default_applies_last_and_can_be_disabled", () => {
    const k = key("http_timeout");
    expect(resolveKey(k, src())?.value).toBe(30);
    expect(resolveKey(k, src(), { useDefault: false })).toBeNull();
  });

  it("test_overrides_accept_legacy_kwarg_names", () => {
    const k = key("sandbox_base_url");
    expect(resolveKey(k, src({ overrides: { api_url: "u" } }))?.value).toBe("u");
    expect(resolveKey(k, src({ overrides: { api_base_url: "u2" } }))?.value).toBe("u2");
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
