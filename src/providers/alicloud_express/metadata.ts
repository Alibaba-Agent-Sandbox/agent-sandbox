/** Image/runtime defaults owned by Express. */
export const TEMPLATE_PROFILE: import("../../models/template_profile.js").ProfileFields = {
  base_image: "fc-e2b-registry.<region>.cr.aliyuncs.com/runtime/base:<tag>",
  entrypoint_replaceable: false,
  server_start: "platform_start_cmd",
  cmd: null,
  start_cmd: "agent-sandbox-server serve --port 9000 --commands /home/user/app/commands.py",
  ready_cmd: "agent-sandbox-server healthcheck --port 9000",
  arch: "linux/amd64",
  user: "user",
  workdir: "/home/user/app",
  reserved_ports: [49983, 5000, 49999],
  registry:
    "public pull; image region must equal the sandbox region; a non-matching FROM takes platform copy + envdInject; no ACR image acceleration",
};


/** Pure provider-owned configuration metadata; contains no executable cloud adapter. */
import { ALICLOUD_EXPRESS_KEYS, BUILTIN_PROVIDER_ID, GENERIC_ENDPOINT_KEYS } from "../../utils/config_keys.js";
export const CONFIG_METADATA = {
  id: BUILTIN_PROVIDER_ID,
  legacyDataPlanePort: 49983,
  legacyDataPlaneUrlTemplate: "https://49983-{sandbox_id}.{domain}",
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
