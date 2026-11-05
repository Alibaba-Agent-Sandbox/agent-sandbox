/** Complete native template inputs, distinct from standard E2B template build recipes. */
import { z } from "zod";
import type { LayeredConfig } from "../../transport/config_layers.js";
import type { ProviderCommand } from "../command_contract.js";
import { AuthenticationError, QuotaExceededError, SandboxError } from "../../models/errors.js";
import { ProviderConfigError, ProviderConflictError, ProviderFeatureNotSupportedError, ProviderProtocolError, ProviderResourceNotFoundError, ProviderTimeoutError } from "../../models/provider_errors.js";
import { commandSchema } from "./command_schema.js";
import { managementIdentifier as identifier, managementInputSecrets, managementVpcConfig, managementVpcMetadata, toManagementWire } from "./management_schema.js";
import { callOfficialTemplateApi } from "./fc_template.js";

type Dict = Record<string, unknown>;
const text = z.string().min(1).max(16384);
const registryNetwork = z.strictObject({ vpc_id: identifier, v_switch_id: identifier, security_group_id: identifier });
const registry = z.strictObject({
  auth_config: z.strictObject({ user_name: text, password: text }).optional(),
  cert_config: z.strictObject({ insecure: z.boolean() }).optional(), network_config: registryNetwork.optional(),
});
const steps = z.array(z.strictObject({ type: z.string().min(1).max(32), args: z.array(z.string().max(16384)).max(512) })).max(256);
const sandbox = z.strictObject({
  image: text.optional(), generation: z.union([z.literal(1), z.literal(2)]).optional(), os_type: z.string().min(1).max(128).optional(),
  registry_type: z.string().min(1).max(64).optional(), acr_instance_id: identifier.optional(), registry_config: registry.optional(),
  start_command: z.string().max(16384).optional(), ready_command: z.string().max(16384).optional(), steps: steps.optional(),
});
const runtime = z.strictObject({
  cpu: z.number().positive().optional(), memory_size: z.number().int().positive().optional(), disk_size: z.number().int().positive().optional(),
  internet_access: z.boolean().optional(), log_config: z.strictObject({ project: text, logstore: text }).optional(),
  vpc_config: managementVpcConfig.extend({ role: text.optional() }).optional(), sandbox_config: sandbox.optional(),
});
const copy = z.strictObject({ enabled: z.boolean(), image: text.optional(), registry_type: text.optional(), acr_instance_id: identifier.optional(), registry_config: registry.optional() });
const build = z.strictObject({ copy: copy.optional(), envd_inject: z.strictObject({ enabled: z.boolean() }).optional(), install_storage_clients: z.boolean().optional() });
const scope = { team_id: identifier };
const reference = { ...scope, template_id: identifier };
const inputs = {
  "template.create": z.strictObject({ ...scope, name: z.string().min(1).max(256), runtime_config: runtime, build_config: build.optional() }),
  "template.get": z.strictObject(reference),
  "template.list": z.strictObject({ ...scope, max_results: z.number().int().min(1).max(100).optional(), next_token: z.string().min(1).max(4096).optional() }),
  "template.update": z.strictObject({ ...reference, runtime_config: runtime.optional(), build_config: build.optional(), plan: z.string().min(1).max(64).optional() }),
  "template.delete": z.strictObject(reference),
};
type Id = keyof typeof inputs;
const publicSandbox = sandbox.omit({ registry_config: true }).extend({ registry_config: z.strictObject({ network_config: registryNetwork.partial().optional() }).optional() });
const publicTemplate = z.strictObject({
  template_id: z.string(), name: z.string().optional(), team_id: z.string().optional(), team_name: z.string().optional(), resource_group_id: z.string().optional(), created_time: z.string().optional(),
  resource_tags: z.array(z.strictObject({ tag_key: z.string().optional(), tag_value: z.string().optional() })).optional(),
  runtime_config: runtime.omit({ sandbox_config: true, vpc_config: true, log_config: true }).extend({
    sandbox_config: publicSandbox.optional(), vpc_config: managementVpcMetadata.extend({ role: z.string().optional() }).optional(),
    log_config: z.strictObject({ project: z.string().optional(), logstore: z.string().optional() }).optional(),
  }).optional(),
  status: z.strictObject({ state: z.string().optional(), finished_at: z.string().optional(), reason: z.strictObject({ step: z.string().optional(), message: z.string().optional() }).optional() }).optional(),
});
const outputs = {
  "template.create": z.strictObject({ template_id: z.string() }),
  "template.get": publicTemplate,
  "template.list": z.strictObject({ templates: z.array(publicTemplate), max_results: z.number().nullable(), next_token: z.string().nullable() }),
  "template.update": z.strictObject({ template_id: z.string() }),
  "template.delete": z.strictObject({ deleted: z.boolean() }),
};
// The generic discovery dialect bounds descriptor nesting. Runtime projection below
// still validates the full native allowlist; the list descriptor treats each
// already-projected runtime configuration as JSON metadata rather than expanding it again.
const listedTemplate = publicTemplate.extend({ runtime_config: z.record(z.string(), z.unknown()).optional() });
const listDescriptorOutput = z.strictObject({ templates: z.array(listedTemplate), max_results: z.number().nullable(), next_token: z.string().nullable() });
const labels: Record<Id, readonly [string, string]> = {
  "template.create": ["Submit a native template with structured runtime and build settings; name conflicts fail without replacement.", "以结构化运行时与构建配置提交原生模板；名称冲突时拒绝替换。"],
  "template.get": ["Get a Team-scoped native template and actual build state.", "查询指定 Team 的原生模板和实际构建状态。"],
  "template.list": ["List one native template page and return its opaque continuation token.", "分页查询原生模板，返回原始续页令牌。"],
  "template.update": ["Update only supplied native template fields; steps=[] explicitly clears build steps.", "仅更新显式提供的原生模板字段；steps=[] 清空构建步骤。"],
  "template.delete": ["Delete a Team-scoped template; existing sandboxes are separate resources.", "删除指定 Team 的模板；已有沙箱是独立资源。"],
};
export const TEMPLATE_COMMANDS: readonly ProviderCommand[] = (Object.keys(inputs) as Id[]).map(id => ({
  id, description: labels[id][0], description_zh: labels[id][1], input_schema: commandSchema(inputs[id]),
  output_schema: commandSchema(z.strictObject({ request_id: z.string().nullable(), data: id === "template.list" ? listDescriptorOutput : outputs[id] })),
  effect: id === "template.get" || id === "template.list" ? "read" : id === "template.delete" ? "delete" : "write", idempotent: id !== "template.create",
}));
export function isTemplateCommand(id: string): id is Id { return Object.hasOwn(inputs, id); }

function object(raw: unknown): Dict | null { return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw as Dict : null; }
function snake(key: string): string { return key.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase(); }
function normalize(raw: unknown, secrets: string[]): unknown {
  if (typeof raw === "string") return secrets.reduce((text, secret) => text.split(secret).join("[REDACTED]"), raw);
  if (Array.isArray(raw)) return raw.map(item => normalize(item, secrets));
  const value = object(raw);
  if (!value) return raw;
  return Object.fromEntries(Object.entries(value).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [snake(key), normalize(value, secrets)]));
}
function project(schema: z.ZodType, raw: unknown, secrets: string[]): unknown {
  const pick = (value: unknown, schema: Dict): unknown => {
    if (schema.type === "array" && Array.isArray(value)) return value.map(item => pick(item, schema.items as Dict));
    const record = object(value);
    if (schema.type !== "object" || !record) return value;
    return Object.fromEntries(Object.entries(schema.properties as Dict).filter(([key]) => key in record).map(([key, child]) => [key, pick(record[key], child as Dict)]));
  };
  const parsed = schema.safeParse(pick(normalize(raw, secrets), z.toJSONSchema(schema, { target: "draft-7" }) as Dict));
  if (!parsed.success) throw new ProviderProtocolError("The native template API returned invalid metadata; a submitted mutation may have completed.");
  return parsed.data;
}

function templateError(id: Id, error: unknown, secrets: string[]): SandboxError {
  const record = object(error) ?? {}, data = object(record.data) ?? {};
  const rawCode = String(record.code ?? data.Code ?? data.code ?? "ServiceError");
  const code = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(rawCode) && !secrets.some(secret => rawCode.includes(secret)) ? rawCode : "ServiceError";
  const rawRequest = String(record.requestId ?? data.RequestId ?? data.requestId ?? "");
  const request = /^[A-Za-z0-9-]{1,128}$/.test(rawRequest) && !secrets.some(secret => rawRequest.includes(secret)) ? rawRequest : "";
  const status = Number(record.statusCode ?? data.statusCode);
  const message = `Native template command '${id}' failed (${code}${status >= 100 && status <= 599 ? `; HTTP ${status}` : ""}${request ? `; request ${request}` : ""}); no automatic retry or replacement was made.`;
  if (status === 401 || status === 403 || /^(Forbidden|Unauthorized|InvalidAccessKeyId|SignatureDoesNotMatch)/.test(code)) return new AuthenticationError(message);
  if (status === 404 || /NotFound$/.test(code)) return new ProviderResourceNotFoundError(message);
  if (status === 409 || /AlreadyExists|Conflict/.test(code)) return new ProviderConflictError(message);
  if (status === 429 || /Quota|LimitExceeded/.test(code)) return new QuotaExceededError(message);
  if (/Timeout|ETIMEDOUT|ECONNABORTED/i.test(code)) return new ProviderTimeoutError(message);
  return new SandboxError(message);
}

/** One exact native operation; no hidden template replacement, retry or account preparation. */
export async function runTemplateCommand(config: LayeredConfig, id: string, raw: Dict): Promise<unknown> {
  if (!isTemplateCommand(id)) throw new ProviderFeatureNotSupportedError("alicloud-express", id);
  const parsed = inputs[id].safeParse(raw);
  if (!parsed.success) throw new ProviderConfigError(`Invalid input for '${id}'; see its input_schema.`);
  const input = parsed.data as Dict;
  if (id === "template.update" && !["runtime_config", "build_config", "plan"].some(key => input[key] !== undefined)) throw new ProviderConfigError("Template update requires at least one changed configuration field.");
  if (id === "template.create" && !object(object(input.runtime_config)?.sandbox_config)?.image) throw new ProviderConfigError("Template creation requires runtime_config.sandbox_config.image.");
  if (!config.access_key_id || !config.access_key_secret) throw new AuthenticationError("Native template management requires AccessKey ID and Secret; a Sandbox API key does not replace them.");
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(config.region)) throw new ProviderConfigError("Invalid native management region.");
  const secrets = [config.access_key_id, config.access_key_secret, config.security_token ?? "", ...managementInputSecrets(input)].filter(Boolean);
  const action = id.split(".")[1] as "create" | "get" | "list" | "update" | "delete";
  let response: Dict;
  try {
    response = await callOfficialTemplateApi(action, toManagementWire(input) as Dict, {
      access_key_id: config.access_key_id, access_key_secret: config.access_key_secret, security_token: config.security_token,
      region: config.region, http_timeout: config.http_timeout,
    });
  } catch (error) {
    throw templateError(id, error, secrets);
  }
  if (response.code !== undefined && response.code !== null && !["200", "Success", "SUCCESS", "OK", ""].includes(String(response.code))) throw templateError(id, response, secrets);
  const request_id = typeof response.requestId === "string" ? normalize(response.requestId, secrets) : null;
  if (action === "list") {
    if (!Array.isArray(response.templates)) throw new ProviderProtocolError("The native template API returned no template list.");
    const data = outputs["template.list"].safeParse({ templates: response.templates.map(item => project(publicTemplate, item, secrets)), max_results: response.maxResults ?? null,
      next_token: response.nextToken === "" || response.nextToken === undefined || response.nextToken === null ? null : normalize(response.nextToken, secrets) });
    if (!data.success) throw new ProviderProtocolError("The native template API returned invalid pagination metadata.");
    return { request_id, data: data.data };
  }
  const data = action === "delete" ? { deleted: true } : action === "create" || action === "update" ? { template_id: response.templateID ?? input.template_id }
    : response;
  return { request_id, data: project(outputs[id], data, secrets) };
}
