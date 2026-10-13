/**
 * Configuration keys that only the CLI reads: the template-generation LLM profile (`llm_*`) and the template build /
 * registry settings (`acr_*`, `team_id`).
 *
 * The Python client neither builds nor generates templates, so these keys are not part of the shared registry
 * (`config_keys.ts`, generated from the Python `config_keys.py`). Each side declares only the keys it reads.
 * `config_keys.ts` appends this list to the shared keys; the shared schema export stays free of them.
 */

import type { ConfigKey, Storage } from "./config_keys.js";

// Same value as BUILTIN_PROVIDER_ID; a literal avoids an import cycle with the generated module
// (`tests/test_utils/test_cli_config_keys.test.ts` pins them together).
const BUILTIN = "alicloud-express";

const ENV_GROUP_AUTH = "Alibaba Cloud credentials";
const GROUP_ACR = "Alibaba Cloud registry (ACR)";
const GROUP_LLM = "LLM";

function key(spec: Partial<ConfigKey> & Pick<ConfigKey, "key" | "scope" | "env" | "storage_phase1" | "group" | "description">): ConfigKey {
  return {
    type: "str",
    secret: false,
    credential: false,
    settable: true,
    aliases: [],
    env_names: [spec.env],
    toml_section: null,
    storage_phase2: spec.storage_phase1,
    default: null,
    choices: [],
    ...spec,
  };
}

function core(
  name: string,
  spec: { env: string; group: string; description: string; type?: ConfigKey["type"]; secret?: boolean; default?: string; toml?: boolean },
): ConfigKey {
  const storage: Storage = spec.toml
    ? { file: "toml", name, section: "transport" }
    : { file: "env", name: spec.env };
  return key({
    key: name,
    scope: "core",
    env: spec.env,
    storage_phase1: storage,
    group: spec.group,
    description: spec.description,
    type: spec.type ?? "str",
    secret: spec.secret ?? false,
    default: spec.default ?? null,
    toml_section: spec.toml ? "transport" : null,
  });
}

function provider(
  name: string,
  spec: { env: string; group: string; description: string; type?: ConfigKey["type"]; secret?: boolean; stored?: "env" },
): ConfigKey {
  const storage: Storage = spec.stored === "env" ? { file: "env", name: spec.env } : { file: "toml", name, section: `providers.${BUILTIN}` };
  return key({
    key: name,
    scope: BUILTIN,
    env: spec.env,
    storage_phase1: storage,
    group: spec.group,
    description: spec.description,
    type: spec.type ?? "str",
    secret: spec.secret ?? false,
  });
}

/** Core-scoped CLI keys: the template-generation LLM profile. */
export const CLI_CORE_KEYS: readonly ConfigKey[] = [
  core("llm_api_key", { env: "ABX_LLM_API_KEY", group: GROUP_LLM, secret: true, description: "LLM API key for template generation" }),
  core("llm_base_url", {
    env: "ABX_LLM_BASE_URL",
    group: GROUP_LLM,
    type: "url",
    toml: true,
    default: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    description: "LLM endpoint (OpenAI-compatible)",
  }),
  core("llm_model", { env: "ABX_LLM_MODEL", group: GROUP_LLM, toml: true, default: "qwen3-coder-plus", description: "LLM model name" }),
];

/** Keys of the built-in provider that only template build/push/deploy use. */
export const CLI_BUILTIN_KEYS: readonly ConfigKey[] = [
  provider("acr_namespace", { env: "ACR_NAMESPACE", group: ENV_GROUP_AUTH, stored: "env", description: "ACR namespace" }),
  provider("acr_registry", { env: "ACR_REGISTRY", group: GROUP_ACR, description: "ACR registry host" }),
  provider("acr_repo", { env: "ACR_REPO", group: GROUP_ACR, description: "ACR repository" }),
  provider("acr_username", { env: "ACR_USERNAME", group: GROUP_ACR, description: "ACR username" }),
  provider("acr_password", { env: "ACR_PASSWORD", group: GROUP_ACR, secret: true, stored: "env", description: "ACR password" }),
  provider("acr_instance_id", { env: "ACREE_INSTANCE_ID", group: GROUP_ACR, description: "ACR Enterprise instance id" }),
  provider("acr_vpc_id", { env: "ACR_VPC_ID", group: GROUP_ACR, description: "ACR VPC id" }),
  provider("acr_vswitch_ids", { env: "ACR_VSWITCH_IDS", group: GROUP_ACR, type: "csv", description: "ACR vSwitch ids (comma-separated)" }),
  provider("acr_security_group_id", { env: "ACR_SECURITY_GROUP_ID", group: GROUP_ACR, description: "ACR security group id" }),
  provider("team_id", { env: "ABX_ALICLOUD_EXPRESS_TEAM_ID", group: GROUP_ACR, description: "Team id" }),
];

export const CLI_ONLY_KEYS: readonly ConfigKey[] = [...CLI_CORE_KEYS, ...CLI_BUILTIN_KEYS];
