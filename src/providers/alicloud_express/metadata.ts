import { TEMPLATE_PROFILE } from "./template_profile.js";
/** Pure provider-owned configuration metadata; contains no executable cloud adapter. */
import { ALICLOUD_EXPRESS_KEYS, BUILTIN_PROVIDER_ID, GENERIC_ENDPOINT_KEYS } from "../../utils/config_keys.js";
export const CONFIG_METADATA = {
  id: BUILTIN_PROVIDER_ID,
  templateProfile: TEMPLATE_PROFILE,
  keys: ALICLOUD_EXPRESS_KEYS,
  inherit: new Set(GENERIC_ENDPOINT_KEYS),
  derive: { sandbox_base_url: "https://api.{region}.e2b.fc.aliyuncs.com", sandbox_domain: "{region}.e2b.fc.aliyuncs.com" },
  endpointDefaults: { sandbox_base_url: "https://api.cn-hangzhou.e2b.fc.aliyuncs.com", sandbox_domain: "cn-hangzhou.e2b.fc.aliyuncs.com" },
  legacyFields: new Set(["region", "access_key_id", "access_key_secret"]),
  omitDefaultOptions: true,
  legacyEnvironment: [
    ["ABX_SANDBOX_API_KEY", "api_key", true], ["ABX_SANDBOX_BASE_URL", "api_url", true],
    ["ABX_SANDBOX_DOMAIN", "domain", true], ["ALICLOUD_ACCESS_KEY_ID", "access_key_id", true],
    ["ALICLOUD_ACCESS_KEY_SECRET", "access_key_secret", true], ["ALIBABA_CLOUD_REGION_ID", "region", true],
    ["ABX_HTTP_TIMEOUT", "http_timeout", true],
  ] as [string, string, boolean][],
};
