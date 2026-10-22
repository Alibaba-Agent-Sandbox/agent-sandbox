import type { ConfigKey } from "./config_keys.js";
export function configKey(spec: Partial<ConfigKey> & Pick<ConfigKey, "key" | "scope" | "env" | "storage" | "group" | "description">): ConfigKey {
  return {
    type: "str",
    secret: false,
    credential: false,
    settable: true,
    aliases: [],
    env_names: [spec.env],
    toml_section: null,
    default: null,
    choices: [],
    ...spec,
  };
}
