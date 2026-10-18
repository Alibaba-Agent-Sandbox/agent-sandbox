import { configKey } from "./config_key_builder.js";
import { CLI_BUILTIN_KEYS } from "../providers/alicloud_express/cli_config_keys.js";
export { CLI_BUILTIN_KEYS } from "../providers/alicloud_express/cli_config_keys.js";
/**
 * Configuration keys that only the CLI reads: the template-generation LLM profile (`llm_*`) and the template build /
 * registry settings (`acr_*`, `team_id`).
 *
 * The Python client neither builds nor generates templates, so these keys are not part of the shared registry
 * (`config_keys.ts`, generated from the Python `config_keys.py`). Each side declares only the keys it reads.
 * `config_keys.ts` appends this list to the shared keys; the shared schema export stays free of them.
 */

import type { ConfigKey, Storage } from "./config_keys.js";

const GROUP_LLM = "LLM";

function core(
  name: string,
  spec: { env: string; group: string; description: string; type?: ConfigKey["type"]; secret?: boolean; default?: string; toml?: boolean },
): ConfigKey {
  const storage: Storage = spec.toml
    ? { file: "toml", name, section: "transport" }
    : { file: "env", name: spec.env };
  return configKey({
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

export const CLI_ONLY_KEYS: readonly ConfigKey[] = [...CLI_CORE_KEYS, ...CLI_BUILTIN_KEYS];
