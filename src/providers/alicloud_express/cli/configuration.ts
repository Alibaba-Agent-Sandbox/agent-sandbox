/** Express configuration fields and wizard prompts. Host code only interprets these descriptors. */
import type { ProviderConfigUi } from "../../../cli/provider_config_contract.js";
import { CONFIG_HELP_TEXT } from "./config_help.js";
import { MANAGED_KEY_HELP, ManagedKeyConsentRequiredError, prepareManagedApiKey, resolveSandboxApiKey } from "../managed_api_key.js";
import { echo } from "../../../cli/io.js";
export const CONFIGURATION_UI: ProviderConfigUi = {
  fieldHelp: {
    sandbox_api_key: "Get your Sandbox API key: Agent Sandbox console > Express > API Keys, in the selected region. https://help.aliyun.com/zh/agent-sandbox/getting-started/create-api-key",
    access_key_id: "Express managed API keys and native template/ACR operations use an AccessKey pair. Key preparation needs sandbox:CreateApiKey, sandbox:DescribeApiKey and sandbox:UpdateApiKey on the target Team. Create or find the pair in RAM > Users > Authentication. https://help.aliyun.com/zh/acr/create-and-obtain-an-accesskey-pair",
    acr_namespace: "Use an existing ACR namespace in the selected region, or create one in Container Registry > Personal Edition > Namespaces. https://help.aliyun.com/zh/acr/user-guide/manage-namespaces",
  },
  runtimeAuthentication: {
    key: "sandbox_api_key", alternatives: [["sandbox_api_key"], ["access_key_id", "access_key_secret"]], help: MANAGED_KEY_HELP,
    async resolve(config, options) {
      try { return await resolveSandboxApiKey(config); }
      catch (error) {
        if (!(error instanceof ManagedKeyConsentRequiredError)) throw error;
        if (!options.ci && !await options.confirm(`${error.message} This manages a 30-day API key stored privately on this machine. ${MANAGED_KEY_HELP} Continue?`)) throw error;
        echo(`${options.ci ? "--ci authorized" : "Confirmed"}: managed API-key ${error.operation} in region ${error.region}, Team ${error.team}. The credential will be stored privately; its value is not displayed.`, { err: true });
        await prepareManagedApiKey(config, {}, true);
        return resolveSandboxApiKey(config);
      }
    },
  },
  allowed: [
    ["access_key_id", "Alibaba Cloud AccessKey ID for managed API keys, template deploy / ACR push"],
    ["access_key_secret", "Alibaba Cloud AccessKey Secret for managed API keys, template deploy / ACR push"],
    ["acr_namespace", "ACR namespace for template build, push, and install (env: ACR_NAMESPACE)"],
    ["region", "Default region (e.g. cn-hangzhou, cn-shanghai)"],
  ],
  envStored: [["access_key_id", "ALICLOUD_ACCESS_KEY_ID"], ["access_key_secret", "ALICLOUD_ACCESS_KEY_SECRET"], ["acr_namespace", "ACR_NAMESPACE"]],
  envOverrides: [["access_key_id", ["ALICLOUD_ACCESS_KEY_ID"]], ["access_key_secret", ["ALICLOUD_ACCESS_KEY_SECRET"]], ["acr_namespace", ["ACR_NAMESPACE"]], ["region", ["ALIBABA_CLOUD_REGION_ID"]]],
  groups: [["Alibaba Cloud credentials", ["access_key_id", "access_key_secret", "acr_namespace"]]],
  sensitive: ["access_key_id", "access_key_secret"],
  extraGroups: [["Alibaba Cloud registry (ACR)", ["acr_registry", "acr_repo", "acr_username", "acr_password", "acr_instance_id", "acr_vpc_id", "acr_vswitch_ids", "acr_security_group_id", "team_id"]]],
  initFields: [
    { key: "sandbox_api_key", env: "ABX_SANDBOX_API_KEY", prompt: "Sandbox API key (input masked; Enter to configure AK/SK instead)", hidden: true, result: "stored" },
    { key: "region", prompt: "Region", current: true, default: "cn-hangzhou", result: "set" },
  ],
  buildFields: [
    { key: "acr_namespace", env: "ACR_NAMESPACE", prompt: "ACR namespace (needed by abx template install / build / deploy)", current: true, result: "set" },
    { key: "access_key_id", env: "ALICLOUD_ACCESS_KEY_ID", prompt: "Alibaba Cloud AccessKey ID (managed API keys / template deploy / ACR, input masked)", hidden: true, result: "stored" },
    { key: "access_key_secret", env: "ALICLOUD_ACCESS_KEY_SECRET", prompt: "Alibaba Cloud AccessKey Secret (input masked)", hidden: true, result: "stored" },
  ],
  noninteractiveInit: ["  # Option 1: existing Sandbox API key", "  abx config set sandbox_api_key <ABX_SANDBOX_API_KEY>", "  # Option 2: AK/SK; prepare a managed API key after confirmation (or --ci)", "  abx config set access_key_id <ALICLOUD_ACCESS_KEY_ID>", "  abx config set access_key_secret <ALICLOUD_ACCESS_KEY_SECRET>", `  # ${MANAGED_KEY_HELP}`, "  abx config set region cn-hangzhou"],
  noninteractiveBuild: ["", "  # Template build, push and install:", "  abx config set acr_namespace <ACR_NAMESPACE>", "  abx config set access_key_id <ALICLOUD_ACCESS_KEY_ID>", "  abx config set access_key_secret <ALICLOUD_ACCESS_KEY_SECRET>"],
  environment: ["ABX_SANDBOX_API_KEY", "ALICLOUD_ACCESS_KEY_ID", "ALICLOUD_ACCESS_KEY_SECRET"], buildEnvironment: ["ACR_NAMESPACE", "ALICLOUD_ACCESS_KEY_ID", "ALICLOUD_ACCESS_KEY_SECRET"],
  help: CONFIG_HELP_TEXT,
};
