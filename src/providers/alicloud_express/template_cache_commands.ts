/** Express Template Cache CRUD through the verified 2026-08-20 management API. */
import { createRequire } from "node:module";
import { z } from "zod";
import { AuthenticationError, QuotaExceededError, SandboxError } from "../../models/errors.js";
import { ProviderConfigError, ProviderConflictError, ProviderFeatureNotSupportedError, ProviderProtocolError, ProviderResourceNotFoundError, ProviderTimeoutError } from "../../models/provider_errors.js";
import type { LayeredConfig } from "../../transport/config_layers.js";
import type { ProviderCommand } from "../command_contract.js";
import { commandSchema } from "./command_schema.js";

type Dict = Record<string, unknown>;
/* eslint-disable @typescript-eslint/no-explicit-any */
/** Lazy generated SDK boundary; the test seam replaces clients, not request models. */
export interface TemplateCacheSdk {
  models: Record<"CreateTemplateCacheRequest" | "CreateTemplateCacheInput" | "DescribeTemplateCacheRequest" | "ListTemplateCacheRequest" | "DeleteTemplateCacheRequest", new (input?: Record<string, any>) => any>;
  Client: new (config: any) => any;
  Config: new (input: Dict) => any;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
const nodeRequire = createRequire(import.meta.url);
function loadSdk(): TemplateCacheSdk {
  // Literal requires retain the dependency in SEA while keeping help/discovery offline.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Required for lazy SEA bundling.
  const models = typeof require === "function" ? require("@alicloud/sandbox20260820") : nodeRequire("@alicloud/sandbox20260820");
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Required for lazy SEA bundling.
  const core = typeof require === "function" ? require("@alicloud/openapi-core") : nodeRequire("@alicloud/openapi-core");
  const Client = models.default ?? models.Client;
  const Config = core.$OpenApiUtil?.Config ?? core.OpenApiUtil?.Config;
  if (typeof Client !== "function" || typeof Config !== "function") throw new Error("Invalid Template Cache SDK exports");
  return { models, Client, Config };
}
/** Private implementation seam; not re-exported from a public package entry. */
export const _templateCacheSdkLoader: { load: () => TemplateCacheSdk } = { load: loadSdk };

const identifier = z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const text = z.string().min(1).max(4096);
const reference = { team_id: identifier, template_id: identifier };
const inputs = {
  "template-cache.create": z.strictObject(reference),
  "template-cache.get": z.strictObject(reference),
  "template-cache.list": z.strictObject({ team_id: identifier, template_id: identifier.optional(), status: z.string().min(1).max(128).optional(),
    max_results: z.number().int().min(1).max(100).optional(), next_token: text.optional() }),
  "template-cache.delete": z.strictObject(reference),
} as const;
type Id = keyof typeof inputs;
const cache = z.strictObject({
  team_id: identifier, template_id: identifier,
  status: z.string().min(1).max(128).optional(), status_reason: z.string().max(16384).optional(),
  progress: z.number().min(0).max(100).optional(), image_size_mb: z.number().nonnegative().optional(),
  image_digest: z.string().max(4096).optional(), created_time: z.string().max(256).optional(), ready_time: z.string().max(256).optional(),
});
const outputs = {
  "template-cache.create": cache,
  "template-cache.get": cache,
  "template-cache.list": z.strictObject({ template_caches: z.array(cache), max_results: z.number().int().nonnegative().nullable(), next_token: z.string().nullable() }),
  "template-cache.delete": z.strictObject({ deleted: z.boolean() }),
};
const labels: Record<Id, readonly [string, string]> = {
  "template-cache.create": ["Submit an explicit Team/template image-cache request; inspect status before reporting ready.", "为指定 Team 和模板提交镜像缓存请求；查询状态后再确认可用。"],
  "template-cache.get": ["Get actual Template Cache status, progress and image size.", "查询模板缓存的实际状态、进度和镜像大小。"],
  "template-cache.list": ["List one Team-scoped Template Cache page; return the opaque next token.", "分页查询指定 Team 的模板缓存，返回原始续页令牌。"],
  "template-cache.delete": ["Delete an explicit Team/template cache; underlying template is retained.", "删除指定 Team 和模板的缓存，保留底层模板。"],
};
/** Pure metadata discovery; no credential lookup, SDK load or cloud request. */
export const TEMPLATE_CACHE_COMMANDS: readonly ProviderCommand[] = (Object.keys(inputs) as Id[]).map(id => ({
  id, description: labels[id][0], description_zh: labels[id][1], input_schema: commandSchema(inputs[id]),
  output_schema: commandSchema(z.strictObject({ request_id: z.string().nullable(), data: outputs[id] })),
  effect: id === "template-cache.get" || id === "template-cache.list" ? "read" : id === "template-cache.delete" ? "delete" : "write",
  idempotent: id !== "template-cache.create",
}));
/** Exact operation routing; arbitrary SDK method names are never accepted. */
export function isTemplateCacheCommand(id: string): id is Id { return Object.hasOwn(inputs, id); }

function object(value: unknown): Dict | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Dict : null;
}
function redact(text: string, secrets: readonly string[]): string {
  return secrets.reduce((value, secret) => secret ? value.split(secret).join("[REDACTED]") : value, text);
}
function serviceError(id: Id, error: unknown, secrets: readonly string[]): SandboxError {
  const record = object(error) ?? {}; const data = object(record.data) ?? {};
  const rawCode = String(record.code ?? data.Code ?? data.code ?? record.name ?? "ServiceError");
  const code = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(rawCode) && !secrets.some(secret => secret && rawCode.includes(secret)) ? rawCode : "ServiceError";
  const rawRequest = String(record.requestId ?? data.RequestId ?? data.requestId ?? "");
  const request = /^[A-Za-z0-9-]{1,128}$/.test(rawRequest) && !secrets.some(secret => secret && rawRequest.includes(secret)) ? rawRequest : "";
  const status = Number(record.statusCode ?? data.statusCode);
  const message = `Template Cache command '${id}' failed (${code}${Number.isInteger(status) && status >= 100 && status <= 599 ? `; HTTP ${status}` : ""}${request ? `; request ${request}` : ""}).`;
  const suggestion = "No automatic retry was made. Inspect template-cache.get/list for this exact Team/template before repeating a write; a timed-out mutation may have completed.";
  if (status === 401 || status === 403 || /^(Forbidden|Unauthorized|InvalidAccessKeyId|SignatureDoesNotMatch)/.test(code)) return new AuthenticationError(message, { suggestion });
  if (status === 404 || /NotFound$/.test(code)) return new ProviderResourceNotFoundError(message, { suggestion });
  if (status === 409 || /AlreadyExists|Conflict/.test(code)) return new ProviderConflictError(message, { suggestion });
  if (status === 429 || /Quota|LimitExceeded/.test(code)) return new QuotaExceededError(message, { suggestion });
  if (/Timeout|ETIMEDOUT|ECONNABORTED/i.test(code)) return new ProviderTimeoutError(message, { suggestion });
  return new SandboxError(message, { suggestion });
}
const wireFields: ReadonlyArray<readonly [string, string]> = [
  ["teamID", "team_id"], ["templateID", "template_id"], ["status", "status"], ["statusReason", "status_reason"], ["progress", "progress"],
  ["imageSizeMB", "image_size_mb"], ["imageDigest", "image_digest"], ["createdTime", "created_time"], ["readyTime", "ready_time"],
];
function projectCache(raw: unknown, secrets: readonly string[]): z.infer<typeof cache> {
  const body = object(raw);
  if (!body) throw new ProviderProtocolError("Template Cache returned no cache metadata; a remote write may have completed.");
  const projected = Object.fromEntries(wireFields.filter(([key]) => body[key] !== undefined && body[key] !== null)
    .map(([key, name]) => [name, typeof body[key] === "string" ? redact(body[key] as string, secrets) : body[key]]));
  const parsed = cache.safeParse(projected);
  if (!parsed.success) throw new ProviderProtocolError("Template Cache returned invalid cache metadata; do not assume the cache is ready or repeat a write automatically.");
  return parsed.data;
}

/** Perform exactly one validated official API request using the resolved provider configuration. */
export async function runTemplateCacheCommand(config: LayeredConfig, id: string, raw: Dict, signal: AbortSignal): Promise<unknown> {
  if (!isTemplateCacheCommand(id)) throw new ProviderFeatureNotSupportedError("alicloud-express", id);
  const parsed = inputs[id].safeParse(raw);
  if (!parsed.success) throw new ProviderConfigError(`Invalid input for '${id}'; explicit team_id and the published input schema are required.`);
  if (signal.aborted) throw new ProviderTimeoutError("Template Cache command was cancelled before a request was sent.");
  const { access_key_id: accessKeyId, access_key_secret: accessKeySecret, region, http_timeout: timeout } = config;
  if (!accessKeyId?.trim() || !accessKeySecret?.trim()) throw new AuthenticationError("Template Cache management requires both access_key_id and access_key_secret; a sandbox API key does not replace them.");
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(region)) throw new ProviderConfigError("Invalid Template Cache management region.");
  if (!Number.isFinite(timeout) || timeout <= 0) throw new ProviderConfigError("Template Cache request timeout must be positive and finite.");
  const secrets = [accessKeyId, accessKeySecret, config.sandbox_api_key ?? ""].filter(Boolean);
  let sdk: TemplateCacheSdk;
  try { sdk = _templateCacheSdkLoader.load(); }
  catch { throw new ProviderConfigError("The official Template Cache management SDK could not be loaded.", { suggestion: "Reinstall the CLI with its lockfile dependencies." }); }
  const input = parsed.data;
  const milliseconds = Math.ceil(timeout * 1000);
  const runtime = { autoretry: false, maxAttempts: 1, readTimeout: milliseconds, connectTimeout: milliseconds };
  let response: unknown;
  try {
    const client = new sdk.Client(new sdk.Config({ accessKeyId, accessKeySecret, regionId: region, endpoint: `sandbox.${region}.aliyuncs.com`,
      readTimeout: milliseconds, connectTimeout: milliseconds, retryOptions: { retryable: false } }));
    if (id === "template-cache.create") {
      response = await client.createTemplateCacheWithOptions(new sdk.models.CreateTemplateCacheRequest({
        body: new sdk.models.CreateTemplateCacheInput({ teamID: input.team_id, templateID: input.template_id }),
      }), {}, runtime);
    } else if (id === "template-cache.get") {
      response = await client.describeTemplateCacheWithOptions(input.template_id, new sdk.models.DescribeTemplateCacheRequest({ teamID: input.team_id }), {}, runtime);
    } else if (id === "template-cache.delete") {
      response = await client.deleteTemplateCacheWithOptions(input.template_id, new sdk.models.DeleteTemplateCacheRequest({ teamID: input.team_id }), {}, runtime);
    } else {
      const page = parsed.data as z.infer<typeof inputs["template-cache.list"]>;
      response = await client.listTemplateCacheWithOptions(new sdk.models.ListTemplateCacheRequest({
        teamID: page.team_id, templateID: page.template_id, status: page.status, maxResults: page.max_results, nextToken: page.next_token,
      }), {}, runtime);
    }
  } catch (error) {
    const translated = serviceError(id, error, secrets);
    if (id === "template-cache.delete" && translated instanceof ProviderResourceNotFoundError) return { request_id: null, data: { deleted: false } };
    throw translated;
  }
  const body = object(object(response)?.body);
  if (!body) throw new ProviderProtocolError("Template Cache returned no response body; a remote write may have completed.");
  if (body.code !== undefined && body.code !== null && !/^(Success|SUCCESS|OK|2\d\d|)$/.test(String(body.code))) throw serviceError(id, body, secrets);
  const requestId = typeof body.requestId === "string" ? redact(body.requestId, secrets) : null;
  if (id === "template-cache.delete") return { request_id: requestId, data: { deleted: true } };
  const scopedCache = (value: unknown): z.infer<typeof cache> => {
    const result = projectCache(value, secrets);
    if (result.team_id !== input.team_id || (input.template_id !== undefined && result.template_id !== input.template_id)) {
      throw new ProviderProtocolError("Template Cache returned metadata for a different Team/template; do not repeat a write automatically.");
    }
    return result;
  };
  if (id !== "template-cache.list") return { request_id: requestId, data: scopedCache(body.templateCache) };
  if (!Array.isArray(body.templateCaches)) throw new ProviderProtocolError("Template Cache returned no resource list.");
  const result = outputs["template-cache.list"].safeParse({ template_caches: body.templateCaches.map(scopedCache),
    max_results: body.maxResults ?? null, next_token: body.nextToken === "" || body.nextToken === undefined || body.nextToken === null ? null : typeof body.nextToken === "string" ? redact(body.nextToken, secrets) : body.nextToken });
  if (!result.success) throw new ProviderProtocolError("Template Cache returned invalid pagination metadata.");
  return { request_id: requestId, data: result.data };
}
