/** The CLI-only keys (`llm_*`, `acr_*`, `team_id`) stay out of the shared registry and out of the Python contract. */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CLI_BUILTIN_KEYS, CLI_CORE_KEYS, CLI_ONLY_KEYS } from "../../src/utils/cli_config_keys.js";
import { ALICLOUD_EXPRESS_KEYS, BUILTIN_PROVIDER_ID, CORE_KEYS, exportSchema, getKey } from "../../src/utils/config_keys.js";

const CONTRACT = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "docs", "design", "fixtures", "config-keys.json"), "utf-8"),
) as { keys: Array<{ key: string; scope: string }> };

describe("CLI-only config keys", () => {
  it("test_cli_keys_are_the_template_build_and_generation_keys", () => {
    expect(CLI_CORE_KEYS.map((k) => k.key)).toEqual(["server_token", "llm_api_key", "llm_base_url", "llm_model"]);
    expect(CLI_BUILTIN_KEYS.map((k) => k.key)).toEqual([
      "acr_namespace", "acr_registry", "acr_repo", "acr_username", "acr_password", "acr_instance_id", "acr_vpc_id",
      "acr_vswitch_ids", "acr_security_group_id", "team_id",
    ]);
  });

  it("test_cli_builtin_keys_use_the_builtin_provider_scope", () => {
    for (const k of CLI_BUILTIN_KEYS) expect(k.scope).toBe(BUILTIN_PROVIDER_ID);
    for (const k of CLI_CORE_KEYS) expect(k.scope).toBe("core");
  });

  it("test_cli_keys_are_in_the_runtime_registry", () => {
    for (const k of CLI_ONLY_KEYS) expect(getKey(k.key, k.scope)).toBe(k);
    expect(CORE_KEYS).toEqual(expect.arrayContaining([...CLI_CORE_KEYS]));
    expect(ALICLOUD_EXPRESS_KEYS).toEqual(expect.arrayContaining([...CLI_BUILTIN_KEYS]));
  });

  it("test_cli_keys_are_not_in_the_python_contract", () => {
    const shared = new Set(CONTRACT.keys.map((k) => `${k.scope}/${k.key}`));
    for (const k of CLI_ONLY_KEYS) expect(shared.has(`${k.scope}/${k.key}`)).toBe(false);
    expect(exportSchema().keys.map((k) => k.key)).not.toContain("llm_api_key");
    expect(exportSchema().keys.map((k) => k.key)).not.toContain("acr_password");
  });

  it("test_every_key_name_is_declared_once", () => {
    const names = [...CORE_KEYS, ...ALICLOUD_EXPRESS_KEYS].map((k) => `${k.scope}/${k.key}`);
    expect(new Set(names).size).toBe(names.length);
  });

  it("test_secrets_are_flagged", () => {
    expect(getKey("llm_api_key")?.secret).toBe(true);
    expect(getKey("acr_password", BUILTIN_PROVIDER_ID)?.secret).toBe(true);
  });
});
