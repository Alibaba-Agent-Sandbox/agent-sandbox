/** Provider-owned native API aliases and bounded storage configuration schemas. */
import { z } from "zod";

export const managementIdentifier = z.string().min(1).max(256).regex(/^[A-Za-z0-9_.:-]+$/);
const text = z.string().min(1).max(4096);
const nonnegative = z.number().int().min(0).max(2147483647);
export const managementVpcConfig = z.strictObject({
  vpc_id: managementIdentifier, security_group_id: managementIdentifier,
  v_switch_ids: z.array(managementIdentifier).min(1).max(16),
});
/** Native response models allow partial/empty VPC metadata; input requirements do not apply. */
export const managementVpcMetadata = z.strictObject({
  vpc_id: z.string().optional(), security_group_id: z.string().optional(), v_switch_ids: z.array(z.string()).optional(),
});
export const mountConfig = z.strictObject({ role: text.optional(), vpc_config: managementVpcConfig.optional() });
export const storageInputs = {
  oss_volume_config: z.strictObject({ bucket_name: text, bucket_path: text, endpoint: text, read_only: z.boolean() }),
  agentic_fs_volume_config: z.strictObject({ server_addr: text, user_id: nonnegative.optional(), group_id: nonnegative.optional() }),
  agentic_bucket_volume_config: z.strictObject({ agentic_bucket: text, bucket_name: text, bucket_path: text.optional(), endpoint: text, read_only: z.boolean().optional() }),
  juice_fs_volume_config: z.strictObject({ base_url: text, token: z.string().min(1).max(16384), volume_name: text, remote_dir: text, args: z.array(z.string().max(4096)).max(64).optional() }),
};
export const storageKeys = Object.keys(storageInputs) as Array<keyof typeof storageInputs>;

const aliases: Record<string, string> = {
  team_id: "teamID", volume_id: "volumeID", api_key_id: "apiKeyID", volume_name: "volumeName", template_id: "templateID",
  max_results: "maxResults", next_token: "nextToken", page_number: "pageNumber", page_size: "pageSize",
  resource_group_id: "resourceGroupID", user_id: "userID", team_name: "teamName", api_key_name: "apiKeyName",
  expire_time: "expireTime", ip_whitelist: "ipWhitelist", ip_blacklist: "ipBlacklist", ip_address: "ipAddress",
  oss_volume_config: "ossVolumeConfig", agentic_fs_volume_config: "agenticFSVolumeConfig", agentic_bucket_volume_config: "agenticBucketVolumeConfig",
  juice_fs_volume_config: "juiceFSVolumeConfig", bucket_name: "bucketName", bucket_path: "bucketPath", storage_class: "storageClass",
  read_only: "readOnly", agentic_bucket: "agenticBucket", server_addr: "serverAddr", group_id: "groupID", base_url: "baseURL", remote_dir: "remoteDir",
  mount_config: "mountConfig", vpc_config: "vpcConfig", vpc_id: "vpcId", security_group_id: "securityGroupId", v_switch_ids: "vSwitchIds",
  cpu_cores: "cpuCores", memory_gb: "memoryGB", instance_count: "instanceCount", runtime_config: "runtimeConfig", build_config: "buildConfig",
  memory_size: "memorySize", disk_size: "diskSize", internet_access: "internetAccess", log_config: "logConfig", sandbox_config: "sandboxConfig",
  start_command: "startCommand", ready_command: "readyCommand", os_type: "osType", registry_type: "registryType", acr_instance_id: "acrInstanceId",
  registry_config: "registryConfig", auth_config: "authConfig", network_config: "networkConfig", user_name: "userName", v_switch_id: "vSwitchId",
  envd_inject: "envdInject", install_storage_clients: "installStorageClients",
  cert_config: "certConfig",
};

/** Maps only an already validated native operation payload; never accepts an SDK method name. */
export function toManagementWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toManagementWire);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [aliases[key] ?? key, toManagementWire(entry)]));
}

/** Operation body secrets are independent from configured access credentials. */
export function managementInputSecrets(input: unknown): string[] {
  const secrets: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (["token", "password"].includes(key) && typeof child === "string" && child) secrets.push(child);
      else visit(child);
    }
  };
  visit(input);
  return secrets;
}
