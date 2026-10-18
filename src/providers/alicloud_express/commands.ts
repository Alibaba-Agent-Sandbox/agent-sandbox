/** Explicit Alibaba Cloud Express management commands backed by the official SDK. */
import { isIP } from "node:net";
import fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { AuthenticationError, QuotaExceededError, SandboxError } from "../../models/errors.js";
import type { LayeredConfig } from "../../transport/config_layers.js";
import type { ProviderCommand } from "../commands.js";
import { ProviderConfigError, ProviderFeatureNotSupportedError, ProviderProtocolError, ProviderResourceNotFoundError } from "../errors.js";
import { _requireSdk, type FcManagementSdk } from "./sdk.js";

type Dict = Record<string, unknown>;
const text = z.string().min(1).max(1024);
const identifier = z.string().min(1).max(256).regex(/^[A-Za-z0-9_.:-]+$/);
const shortText = z.string().min(1).max(256);
const nonnegative = z.number().int().min(0).max(2147483647);
const cursor = { max_results: z.number().int().min(1).max(100).optional(), next_token: text.optional() };
const page = { page_number: z.number().int().min(1).optional(), page_size: z.number().int().min(1).max(100).optional() };
const teamRef = { team_id: identifier };
const volumeRef = { ...teamRef, volume_id: identifier };
const keyRef = { api_key_id: identifier };
const secretFile = { secret_file: z.string().min(1).max(4096) };
const quotaRef = { team_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) };
const description = z.string().max(4096);
const ipConfig = z.strictObject({ ip_address: shortText, description: description.optional() });
const keyFields = {
  api_key_name: shortText.optional(), expire_time: z.iso.datetime({ offset: true }).optional(),
  ip_whitelist: z.array(ipConfig).max(100).optional(), ip_blacklist: z.array(ipConfig).max(100).optional(),
};
const teamFields = {
  team_name: shortText.optional(), description: description.optional(),
  plan: shortText.optional(), resource_group_id: identifier.optional(),
};
const ossConfig = z.strictObject({ bucket_name: shortText, bucket_path: text, endpoint: text, read_only: z.boolean() });
const agenticFsConfig = z.strictObject({ server_addr: text, user_id: nonnegative.optional(), group_id: nonnegative.optional() });
const agenticBucketConfig = z.strictObject({
  agentic_bucket: shortText, bucket_name: shortText, bucket_path: text.optional(), endpoint: text, read_only: z.boolean().optional(),
});
const mountConfig = z.strictObject({
  role: text.optional(),
  vpc_config: z.strictObject({
    vpc_id: identifier, security_group_id: identifier, v_switch_ids: z.array(identifier).min(1).max(16),
  }).optional(),
});

const inputs = {
  "volume.create": z.strictObject({
    ...teamRef, volume_name: shortText, oss_volume_config: ossConfig.optional(),
    agentic_fs_volume_config: agenticFsConfig.optional(), agentic_bucket_volume_config: agenticBucketConfig.optional(),
    mount_config: mountConfig.optional(),
  }),
  "volume.get": z.strictObject(volumeRef),
  "volume.list": z.strictObject({
    ...cursor, team_id: identifier.optional(), volume_name: shortText.optional(),
    status: shortText.optional(), resource_group_id: identifier.optional(), user_id: identifier.optional(),
  }),
  "volume.update": z.strictObject({ ...volumeRef, status: shortText }),
  "volume.delete": z.strictObject(volumeRef),
  "team.create": z.strictObject({ ...teamFields, team_name: shortText }),
  "team.get": z.strictObject(teamRef),
  "team.list": z.strictObject({ ...page, team_name: shortText.optional(), plan: shortText.optional(), resource_group_id: identifier.optional() }),
  "team.update": z.strictObject({ ...teamRef, ...teamFields }),
  "team.delete": z.strictObject(teamRef),
  "api-key.create": z.strictObject({ ...keyFields, ...teamRef, ...secretFile, api_key_name: shortText }),
  "api-key.get": z.strictObject(keyRef),
  "api-key.list": z.strictObject({
    ...page, api_key_name: shortText.optional(), team_id: identifier.optional(), user_id: identifier.optional(),
    status: z.enum(["active", "inactive"]).optional(), resource_group_id: identifier.optional(),
  }),
  "api-key.update": z.strictObject({ ...keyRef, ...keyFields, status: z.enum(["active", "inactive"]).optional() }),
  "api-key.reset": z.strictObject({ ...keyRef, ...secretFile }),
  "api-key.delete": z.strictObject(keyRef),
  "quota.get": z.strictObject(quotaRef),
  "quota.list": z.strictObject(cursor),
  "quota.update": z.strictObject({ ...quotaRef, cpu_cores: nonnegative, memory_gb: nonnegative }),
  "quota.delete": z.strictObject(quotaRef),
} as const;

type CommandId = keyof typeof inputs;

const optionalStrings = (names: readonly string[]): Record<string, z.ZodOptional<z.ZodString>> =>
  Object.fromEntries(names.map((name) => [name, z.string().optional()]));

const volumeOutput = z.strictObject({
  ...optionalStrings(["volume_id", "volume_name", "team_id", "storage_class", "status", "status_reason", "created_at", "updated_at", "resource_group_id", "user_id"]),
  oss_volume_config: ossConfig.partial().optional(), agentic_fs_volume_config: agenticFsConfig.partial().optional(),
  agentic_bucket_volume_config: agenticBucketConfig.partial().optional(), mount_config: mountConfig.partial().optional(),
});
const teamOutput = z.strictObject({
  ...optionalStrings(["team_id", "team_name", "description", "plan", "resource_group_id", "status", "created_time", "user_id"]),
  allow_update_team_name: z.boolean().optional(), read_only: z.boolean().optional(),
});
const keyOutput = z.strictObject({
  ...optionalStrings(["api_key_id", "api_key_name", "api_key_mask", "created_time", "expire_time", "last_used_time", "resource_group_id", "source", "status", "team_id", "team_name", "team_plan", "user_id", "username"]),
  api_key_value: z.literal("[REDACTED]").optional(),
  ip_whitelist: z.array(ipConfig.partial()).optional(), ip_blacklist: z.array(ipConfig.partial()).optional(),
});
const quotaOutput = z.strictObject({ tag_value: z.string().optional(), cpu_cores: z.number().optional(), memory_gb: z.number().optional() });
const deletionOutput = z.strictObject({ deleted: z.literal(true) });
const cursorOutput = { max_results: z.number().nullable(), next_token: z.string().nullable() };
const pageOutput = { page_number: z.number().nullable(), page_size: z.number().nullable(), total: z.number().nullable() };
const listOutputs = {
  volume: z.strictObject({ volumes: z.array(volumeOutput), ...cursorOutput }),
  team: z.strictObject({ teams: z.array(teamOutput), ...pageOutput }),
  "api-key": z.strictObject({ api_keys: z.array(keyOutput), ...pageOutput }),
  quota: z.strictObject({ quotas: z.array(quotaOutput), ...cursorOutput }),
};
const resourceOutputs = { volume: volumeOutput, team: teamOutput, "api-key": keyOutput, quota: quotaOutput };

const labels: Record<CommandId, readonly [string, string]> = {
  "volume.create": ["Create a Volume mount configuration.", "创建存储卷挂载配置。"],
  "volume.get": ["Get a Volume configuration.", "查询存储卷配置。"],
  "volume.list": ["List one page of Volumes.", "分页查询存储卷。"],
  "volume.update": ["Update Volume status.", "更新存储卷状态。"],
  "volume.delete": ["Delete Volume metadata; underlying storage is retained.", "删除存储卷配置，保留底层数据。"],
  "team.create": ["Create a Team.", "创建 Team。"],
  "team.get": ["Get a Team.", "查询 Team。"],
  "team.list": ["List one page of Teams.", "分页查询 Team。"],
  "team.update": ["Update a Team.", "更新 Team。"],
  "team.delete": ["Delete a Team.", "删除 Team。"],
  "api-key.create": ["Create an API key and save its secret exclusively to secret_file.", "创建 API Key，将密钥独占保存至 secret_file。"],
  "api-key.get": ["Describe an API key; its secret value is redacted.", "查询 API Key，返回密钥值脱敏。"],
  "api-key.list": ["List one page of API keys with secret values redacted.", "分页查询 API Key，密钥值脱敏。"],
  "api-key.update": ["Update an API key with secret values redacted.", "更新 API Key，密钥值脱敏。"],
  "api-key.reset": ["Rotate an API key and save its new secret exclusively to secret_file.", "轮换 API Key，将新密钥独占保存至 secret_file。"],
  "api-key.delete": ["Delete an inactive API key.", "删除已停用的 API Key。"],
  "quota.get": ["Get a Team resource quota.", "查询 Team 资源配额。"],
  "quota.list": ["List one page of Team resource quotas.", "分页查询 Team 资源配额。"],
  "quota.update": ["Replace a Team CPU and memory quota, including zero limits.", "设置 Team CPU 与内存配额，支持零配额。"],
  "quota.delete": ["Delete a Team quota configuration.", "删除 Team 配额配置。"],
};

function outputFor(id: CommandId): z.ZodType {
  const [group, action] = id.split(".") as [keyof typeof resourceOutputs, string];
  const data = group === "api-key" && (action === "create" || action === "reset") ? keyOutput.extend({ secret_file: z.string() }) : action === "delete" ? deletionOutput : action === "list" ? listOutputs[group] : resourceOutputs[group];
  return z.strictObject({ request_id: z.string().nullable(), data });
}

/** Host manifests intentionally exclude regex/format execution; local validation still checks them. */
function commandSchema(schema: z.ZodType): Dict {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    const record = object(value);
    return record ? Object.fromEntries(Object.entries(record).filter(([key]) => key !== "pattern" && key !== "format").map(([key, child]) => [key, strip(child)])) : value;
  };
  return strip(z.toJSONSchema(schema, { target: "draft-7" })) as Dict;
}

/** The complete supported FC management catalog. Discovery does not access credentials or the network. */
export const ALICLOUD_COMMANDS: readonly ProviderCommand[] = Object.keys(inputs).map((raw) => {
  const id = raw as CommandId;
  const action = id.split(".")[1];
  const inputSchema = commandSchema(inputs[id]);
  if (id === "volume.create") inputSchema.oneOf = ["oss_volume_config", "agentic_fs_volume_config", "agentic_bucket_volume_config"].map((key) => ({ properties: { [key]: {} }, required: [key] }));
  return {
    id, description: labels[id][0], description_zh: labels[id][1],
    input_schema: inputSchema,
    output_schema: commandSchema(outputFor(id)),
    effect: action === "get" || action === "list" ? "read" : action === "delete" ? "delete" : "write",
    idempotent: action !== "create" && action !== "reset",
  };
});

/** Wire aliases are explicit: no caller-supplied SDK method names or arbitrary payload fields. */
const aliases: Record<string, string> = {
  team_id: "teamID", volume_id: "volumeID", api_key_id: "apiKeyID", volume_name: "volumeName",
  max_results: "maxResults", next_token: "nextToken", page_number: "pageNumber", page_size: "pageSize",
  resource_group_id: "resourceGroupID", user_id: "userID", team_name: "teamName", api_key_name: "apiKeyName",
  expire_time: "expireTime", ip_whitelist: "ipWhitelist", ip_blacklist: "ipBlacklist", ip_address: "ipAddress",
  oss_volume_config: "ossVolumeConfig", agentic_fs_volume_config: "agenticFSVolumeConfig",
  agentic_bucket_volume_config: "agenticBucketVolumeConfig", bucket_name: "bucketName", bucket_path: "bucketPath",
  read_only: "readOnly", agentic_bucket: "agenticBucket", server_addr: "serverAddr", group_id: "groupID",
  mount_config: "mountConfig", vpc_config: "vpcConfig", vpc_id: "vpcId", security_group_id: "securityGroupId",
  v_switch_ids: "vSwitchIds", cpu_cores: "cpuCores", memory_gb: "memoryGB",
};

function wire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(wire);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [aliases[key] ?? key, wire(entry)]));
}

function validIp(raw: string): boolean {
  const [address, prefix, extra] = raw.split("/");
  const family = isIP(address);
  return Boolean(family) && extra === undefined && (prefix === undefined || (/^\d+$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128)));
}

function validateSemantics(id: CommandId, input: Dict): void {
  if (typeof input.secret_file === "string" && !path.isAbsolute(input.secret_file)) {
    throw new ProviderConfigError("secret_file must be an absolute path on the local engine host.");
  }
  for (const name of ["volume_name", "team_name", "api_key_name"]) {
    if (typeof input[name] === "string" && !(input[name] as string).trim()) throw new ProviderConfigError("Resource names must contain a non-whitespace character.");
  }
  if (id === "volume.create") {
    const storage = ["oss_volume_config", "agentic_fs_volume_config", "agentic_bucket_volume_config"].filter((key) => input[key] !== undefined);
    if (storage.length !== 1) throw new ProviderConfigError("Volume creation requires exactly one storage configuration.");
    for (const key of ["oss_volume_config", "agentic_bucket_volume_config"]) {
      const config = input[key] as Dict | undefined;
      if (config && ((config.bucket_path !== undefined && !String(config.bucket_path).startsWith("/")) || !/^https?:\/\//.test(String(config.endpoint)))) {
        throw new ProviderConfigError("Storage configuration requires an absolute bucket_path and an HTTP(S) endpoint.");
      }
    }
    if (input.agentic_bucket_volume_config && object(input.mount_config)?.vpc_config) throw new ProviderConfigError("AgenticBucket Volumes do not support VPC mount configuration.");
  }
  if ((id === "team.update" || id === "api-key.update") && Object.keys(input).length < 2) {
    throw new ProviderConfigError("An update requires at least one changed field.");
  }
  for (const key of ["ip_whitelist", "ip_blacklist"]) {
    if (Array.isArray(input[key]) && !(input[key] as Dict[]).every((item) => validIp(String(item.ip_address)))) {
      throw new ProviderConfigError("IP rules require valid IPv4/IPv6 addresses or CIDR ranges.");
    }
  }
}

function object(value: unknown): Dict | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Dict : null;
}

function snake(key: string): string {
  return key.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/** Only declared response fields are retained; generated secrets are replaced before projection. */
function project(schema: z.ZodType, raw: unknown, secrets: readonly string[]): unknown {
  const normalize = (value: unknown): unknown => {
    if (typeof value === "string") return secrets.reduce((text, secret) => text.split(secret).join("[REDACTED]"), value);
    if (Array.isArray(value)) return value.map(normalize);
    const record = object(value);
    if (!record) return value;
    return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [snake(key), snake(key) === "api_key_value" ? "[REDACTED]" : normalize(value)]));
  };
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-7" }) as Dict;
  const pick = (value: unknown, definition: Dict): unknown => {
    if (definition.type === "array" && Array.isArray(value)) return value.map((item) => pick(item, definition.items as Dict));
    const record = object(value);
    if (definition.type !== "object" || !record) return value;
    const properties = definition.properties as Record<string, Dict>;
    return Object.fromEntries(Object.entries(properties).filter(([key]) => key in record).map(([key, child]) => [key, pick(record[key], child)]));
  };
  const result = schema.safeParse(pick(normalize(raw), jsonSchema));
  if (!result.success) throw new ProviderProtocolError("The FC management service returned an invalid resource response.");
  return result.data;
}

function serviceError(id: string, error: unknown, secrets: readonly string[]): SandboxError {
  const record = object(error) ?? {};
  const data = object(record.data) ?? {};
  const code = String(record.code ?? data.Code ?? data.code ?? "UnknownError");
  const safeCode = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(code) && !secrets.some((secret) => code.includes(secret)) ? code : "ServiceError";
  const requestId = String(record.requestId ?? data.RequestId ?? data.requestId ?? "");
  const safeRequestId = /^[A-Za-z0-9-]{1,128}$/.test(requestId) && !secrets.some((secret) => requestId.includes(secret)) ? requestId : "";
  const status = Number(record.statusCode ?? data.statusCode);
  const message = `FC command '${id}' failed (${safeCode}${Number.isInteger(status) && status >= 100 && status <= 599 ? `; HTTP ${status}` : ""}${safeRequestId ? `; request ${safeRequestId}` : ""}).`;
  if (safeCode === "InvalidApiKeyStatus") return new ProviderConfigError(`${message} API keys must be inactive before deletion.`, {
    suggestion: "Run 'api-key.update' with status='inactive' for that key, then run 'api-key.delete'. No automatic status change or retry was made.",
  });
  if (status === 401 || status === 403 || /^(InvalidAccessKeyId|SignatureDoesNotMatch|Forbidden|Unauthorized)/.test(safeCode)) return new AuthenticationError(message);
  if (status === 404 || /NotFound$/.test(safeCode)) return new ProviderResourceNotFoundError(message);
  if (/Quota|LimitExceeded/.test(safeCode)) return new QuotaExceededError(message);
  return new SandboxError(message);
}

interface SecretDestination {
  fd: number;
  filename: string;
  identity: fs.Stats;
}

function reserveSecretFile(filename: string): SecretDestination {
  let fd: number | undefined;
  try {
    const resolved = path.resolve(filename);
    fd = fs.openSync(resolved, "wx", 0o600);
    fs.fchmodSync(fd, 0o600);
    return { fd, filename: resolved, identity: fs.fstatSync(fd) };
  } catch {
    if (fd !== undefined) {
      try {
        const identity = fs.fstatSync(fd);
        const current = fs.lstatSync(path.resolve(filename));
        if (identity.size === 0 && identity.ino === current.ino && identity.dev === current.dev) fs.unlinkSync(path.resolve(filename));
      } catch { /* Retain files whose ownership cannot be established. */ }
      fs.closeSync(fd);
    }
    throw new ProviderConfigError("Cannot exclusively create secret_file with mode 0600; use a new file in an existing writable directory.");
  }
}

/** Cleanup never removes an existing file, replacement path, or a partially written credential. */
function releaseSecretFile(destination: SecretDestination, removeEmpty: boolean): void {
  try {
    if (removeEmpty && fs.fstatSync(destination.fd).size === 0) {
      try {
        const current = fs.lstatSync(destination.filename);
        if (current.ino === destination.identity.ino && current.dev === destination.identity.dev) fs.unlinkSync(destination.filename);
      } catch { /* A caller may have already removed or replaced the reserved path. */ }
    }
  } finally {
    fs.closeSync(destination.fd);
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function request(sdk: FcManagementSdk, name: string, values: Dict): any {
  const Model = sdk.models[name];
  if (!Model) throw new ProviderConfigError(`The installed management SDK does not expose ${name}.`);
  return new Model(values);
}

/** Execute one validated FC management command using only this resolved configuration snapshot. */
export async function runAlicloudCommand(config: LayeredConfig, id: string, rawInput: Dict): Promise<unknown> {
  if (!Object.hasOwn(inputs, id)) throw new ProviderFeatureNotSupportedError("alicloud-express", id);
  const commandId = id as CommandId;
  const parsed = inputs[commandId].safeParse(rawInput);
  if (!parsed.success) throw new ProviderConfigError(`Invalid input for '${id}'; see the command input_schema.`);
  const input = parsed.data as Dict;
  validateSemantics(commandId, input);
  const { access_key_id: accessKeyId, access_key_secret: accessKeySecret, region, http_timeout: timeout } = config;
  if (!accessKeyId?.trim() || !accessKeySecret?.trim()) throw new AuthenticationError("FC management commands require both access_key_id and access_key_secret.", { suggestion: "Configure Alibaba Cloud AccessKey credentials for the selected provider." });
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(region)) throw new ProviderConfigError("Invalid FC management region.");
  const secrets = [accessKeyId, accessKeySecret];
  const sdk = _requireSdk();
  const milliseconds = Math.ceil(timeout * 1000);
  let client: any;
  try {
    client = new sdk.Client(new sdk.Config({
      accessKeyId, accessKeySecret, regionId: region, endpoint: `fcsandbox.${region}.aliyuncs.com`,
      readTimeout: milliseconds, connectTimeout: milliseconds, retryOptions: { retryable: false },
    }));
  } catch (error) {
    throw serviceError(id, error, secrets);
  }
  const runtime = { autoretry: false, maxAttempts: 1, readTimeout: milliseconds, connectTimeout: milliseconds };
  const { secret_file: _secretFile, ...sdkInput } = input;
  const body = wire(sdkInput) as Dict;
  const [group, action] = id.split(".") as [keyof typeof resourceOutputs, string];
  let method: string;
  let model: string;
  let args: unknown[];
  if (group === "volume") {
    method = `${action}Volume${action === "list" ? "s" : ""}WithOptions`;
    model = `${action[0].toUpperCase()}${action.slice(1)}Volume${action === "list" ? "s" : ""}Request`;
    if (action === "create") args = [request(sdk, model, { body: request(sdk, "CreateVolumeInput", body) })];
    else if (action === "update") args = [input.volume_id, request(sdk, model, { body: request(sdk, "UpdateVolumeInput", { teamID: input.team_id, status: input.status }) })];
    else if (action === "list") args = [request(sdk, model, body)];
    else args = [input.volume_id, request(sdk, model, { teamID: input.team_id })];
  } else if (group === "team") {
    method = `${action}Team${action === "list" ? "s" : ""}WithOptions`;
    model = `${action[0].toUpperCase()}${action.slice(1)}Team${action === "list" ? "s" : ""}Request`;
    const { teamID: _teamID, ...changes } = body;
    if (action === "create" || action === "update") {
      const req = request(sdk, model, { body: request(sdk, `${action === "create" ? "Create" : "Update"}TeamInput`, changes) });
      args = action === "create" ? [req] : [input.team_id, req];
    } else args = action === "list" ? [request(sdk, model, body)] : [input.team_id, request(sdk, model, {})];
  } else if (group === "api-key") {
    const verb = action === "get" ? "describe" : action;
    method = `${verb}ApiKey${action === "list" ? "s" : ""}WithOptions`;
    model = `${verb[0].toUpperCase()}${verb.slice(1)}ApiKey${action === "list" ? "s" : ""}Request`;
    const { apiKeyID: _apiKeyID, ...changes } = body;
    if (action === "create" || action === "update") {
      const req = request(sdk, model, { body: request(sdk, `${action === "create" ? "Create" : "Update"}ApiKeyInput`, changes) });
      args = action === "create" ? [req] : [input.api_key_id, req];
    } else args = action === "list" ? [request(sdk, model, body)] : [input.api_key_id, request(sdk, model, {})];
  } else {
    const verb = action === "get" ? "describe" : action;
    method = `${verb}QuotaWithOptions`;
    model = `${verb[0].toUpperCase()}${verb.slice(1)}QuotaRequest`;
    const { teamID: _teamID, ...fields } = body;
    if (action !== "list") fields.tagValue = input.team_id;
    args = [request(sdk, model, action === "update" ? { body: request(sdk, "Quota", fields) } : fields)];
  }
  if (typeof client[method] !== "function") throw new ProviderConfigError("The installed management SDK does not support this command.");
  const destination = typeof input.secret_file === "string" ? reserveSecretFile(input.secret_file) : null;
  let response: any;
  try {
    response = await client[method](...args, {}, runtime);
  } catch (error) {
    if (destination) releaseSecretFile(destination, true);
    throw serviceError(id, error, secrets);
  }
  const result = object(response?.body);
  if (!result) {
    if (destination) releaseSecretFile(destination, true);
    throw new ProviderProtocolError("The FC management service returned no response body; a remote mutation may have completed.");
  }
  if (result.code !== undefined && !["Success", "SUCCESS", "OK", "200", ""].includes(String(result.code))) {
    if (destination) releaseSecretFile(destination, true);
    throw serviceError(id, result, secrets);
  }
  if (destination) {
    const value = object(result.apiKey)?.apiKeyValue;
    if (typeof value !== "string" || !value) {
      releaseSecretFile(destination, true);
      throw new ProviderProtocolError("The API key was changed remotely, but no new secret was returned. Do not retry automatically; recover the key through the cloud console.");
    }
    secrets.push(value);
    try {
      const current = fs.lstatSync(destination.filename);
      if (current.ino !== destination.identity.ino || current.dev !== destination.identity.dev) throw new Error("Secret destination was replaced");
      fs.writeFileSync(destination.fd, `${value}\n`, { encoding: "utf8" });
      fs.fsyncSync(destination.fd);
      const written = fs.lstatSync(destination.filename);
      if (written.ino !== destination.identity.ino || written.dev !== destination.identity.dev) throw new Error("Secret destination was replaced");
    } catch {
      releaseSecretFile(destination, true);
      throw new ProviderProtocolError("The API key was changed remotely, but saving secret_file failed. Do not retry automatically; recover the key through the cloud console.");
    }
    releaseSecretFile(destination, false);
  }
  let data: unknown;
  if (action === "delete") data = { deleted: true };
  else if (action === "list") {
    const field = group === "api-key" ? "apiKeys" : `${group}s`;
    if (!Array.isArray(result[field])) throw new ProviderProtocolError("The FC management service returned no resource list.");
    data = group === "team" || group === "api-key" ? {
      [snake(field)]: project(z.array(resourceOutputs[group]), result[field], secrets),
      page_number: result.pageNumber ?? null, page_size: result.pageSize ?? null, total: result.total ?? null,
    } : {
      [snake(field)]: project(z.array(resourceOutputs[group]), result[field], secrets),
      max_results: result.maxResults ?? null, next_token: result.nextToken ?? null,
    };
  } else {
    const field = group === "api-key" ? "apiKey" : group;
    if (!object(result[field])) throw new ProviderProtocolError("The FC management service returned no resource.");
    data = project(resourceOutputs[group], result[field], secrets);
    if (destination) data = { ...data as Dict, secret_file: destination.filename };
  }
  const output = outputFor(commandId).safeParse({ request_id: typeof result.requestId === "string" ? secrets.reduce((value, secret) => value.split(secret).join("[REDACTED]"), result.requestId) : null, data });
  if (!output.success) throw new ProviderProtocolError("The FC management service returned invalid pagination or resource metadata.");
  return output.data;
}
