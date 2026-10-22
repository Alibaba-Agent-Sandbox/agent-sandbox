/** Configuration declarations owned by the Express build/registry adapter. */
import type { ConfigKey, Storage } from "../../utils/config_keys.js";
import { configKey } from "../../utils/config_key_builder.js";
const BUILTIN = "alicloud-express";
const ENV_GROUP_AUTH = "Alibaba Cloud credentials";
const GROUP_ACR = "Alibaba Cloud registry (ACR)";
function provider(
  name: string,
  spec: { env: string; group: string; description: string; type?: ConfigKey["type"]; secret?: boolean; stored?: "env" },
): ConfigKey {
  const storage: Storage = spec.stored === "env" ? { file: "env", name: spec.env } : { file: "toml", name, section: `providers.${BUILTIN}` };
  return configKey({
    key: name,
    scope: BUILTIN,
    env: spec.env,
    storage: storage,
    group: spec.group,
    description: spec.description,
    type: spec.type ?? "str",
    secret: spec.secret ?? false,
  });
}

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
