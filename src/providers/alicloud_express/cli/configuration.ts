/** Express legacy configuration aliases and wizard prompts. Host code only interprets these descriptors. */
import type { ProviderConfigUi } from "../../../cli/provider_config_contract.js";
import { CONFIG_HELP_TEXT } from "./config_help.js";
export const CONFIGURATION_UI: ProviderConfigUi = {
  allowed: [
    ["access_key_id", "Alibaba Cloud AccessKey ID for template deploy / ACR push"],
    ["access_key_secret", "Alibaba Cloud AccessKey Secret for template deploy / ACR push"],
    ["acr_namespace", "ACR namespace for template build, push, and install (env: ACR_NAMESPACE)"],
    ["region", "Default region (e.g. cn-hangzhou, cn-shanghai)"],
  ],
  envStored: [["access_key_id", "ALICLOUD_ACCESS_KEY_ID"], ["access_key_secret", "ALICLOUD_ACCESS_KEY_SECRET"], ["acr_namespace", "ACR_NAMESPACE"]],
  envOverrides: [["access_key_id", ["ALICLOUD_ACCESS_KEY_ID"]], ["access_key_secret", ["ALICLOUD_ACCESS_KEY_SECRET"]], ["acr_namespace", ["ACR_NAMESPACE"]], ["region", ["ALIBABA_CLOUD_REGION_ID"]]],
  groups: [["Alibaba Cloud credentials", ["access_key_id", "access_key_secret", "acr_namespace"]]],
  sensitive: ["access_key_secret"],
  extraGroups: [["Alibaba Cloud registry (ACR)", ["acr_registry", "acr_repo", "acr_username", "acr_password", "acr_instance_id", "acr_vpc_id", "acr_vswitch_ids", "acr_security_group_id", "team_id"]]],
  initFields: [
    { key: "sandbox_api_key", env: "ABX_SANDBOX_API_KEY", prompt: "Sandbox API key (sandbox_api_key / ABX_SANDBOX_API_KEY, input masked)", hidden: true, result: "stored" },
    { key: "region", prompt: "Region", current: true, default: "cn-hangzhou", result: "set" },
  ],
  buildFields: [
    { key: "acr_namespace", env: "ACR_NAMESPACE", prompt: "ACR namespace (needed by abx template install / build / deploy)", current: true, result: "set" },
    { key: "access_key_id", env: "ALICLOUD_ACCESS_KEY_ID", prompt: "Alibaba Cloud AccessKey ID (template deploy / ACR push)", current: true, result: "stored" },
    { key: "access_key_secret", env: "ALICLOUD_ACCESS_KEY_SECRET", prompt: "Alibaba Cloud AccessKey Secret (input masked)", hidden: true, result: "stored" },
  ],
  noninteractiveInit: ["  abx config set sandbox_api_key <ABX_SANDBOX_API_KEY>", "  abx config set region cn-hangzhou"],
  noninteractiveBuild: ["", "  # Template build, push and install:", "  abx config set acr_namespace <ACR_NAMESPACE>", "  abx config set access_key_id <ALICLOUD_ACCESS_KEY_ID>", "  abx config set access_key_secret <ALICLOUD_ACCESS_KEY_SECRET>"],
  environment: ["ABX_SANDBOX_API_KEY"], buildEnvironment: ["ACR_NAMESPACE", "ALICLOUD_ACCESS_KEY_ID", "ALICLOUD_ACCESS_KEY_SECRET"],
  help: CONFIG_HELP_TEXT,
};
