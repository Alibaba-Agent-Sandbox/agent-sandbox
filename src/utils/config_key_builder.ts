import type { ConfigKey } from "./config_keys.js";
export function configKey(spec: Partial<ConfigKey> & Pick<ConfigKey, "key" | "scope" | "env" | "storage_phase1" | "group" | "description">): ConfigKey {
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
