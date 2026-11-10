/** Provider-native cloud template management; source authoring remains in template init/build/publish. */
import { z } from "zod";
import { collectSources, type LayeredConfig } from "../../transport/config_layers.js";
import { AuthenticationError, SandboxError } from "../../models/errors.js";
import { ProviderConfigError, ProviderFeatureNotSupportedError, ProviderTimeoutError } from "../../models/provider_errors.js";
import type { ProviderCommand } from "../command_contract.js";
import { commandSchema } from "./command_schema.js";
import { getKey } from "../../utils/config_keys.js";
import { resolveKey } from "../../utils/config_resolver.js";
import { getOperationConfig } from "../../utils/operation_config.js";
import * as templates from "./fc_template.js";

type Dict = Record<string, unknown>;
const text = z.string().min(1).max(4096);
const id = z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const inputs = {
  "template.list": z.strictObject({ team_id: id.optional(), max_results: z.number().int().min(1).max(100).optional() }),
  "template.get": z.strictObject({ team_id: id.optional(), template_id: id }),
  "template.create": z.strictObject({
    team_id: id.optional(), name: id, image: text, cpu: z.number().positive().optional(), memory_size: z.number().int().positive().optional(), disk_size: z.number().int().positive().optional(),
    internet_access: z.boolean().optional(), generation: z.union([z.literal(1), z.literal(2)]).optional(), start_command: text.optional(), ready_command: text.optional(), envd_inject: z.boolean().optional(),
    registry_type: text.optional(), acr_instance_id: id.optional(), registry_username: text.optional(), registry_password: text.optional(),
    registry_vpc_id: id.optional(), registry_vswitch_id: id.optional(), registry_security_group_id: id.optional(), target_image: text.optional(),
    steps: z.array(z.strictObject({ type: text, args: z.array(z.string()) })).optional(),
  }),
  "template.delete": z.strictObject({ team_id: id.optional(), template_id: id }),
} as const;
type Id = keyof typeof inputs;
const object = z.record(z.string(), z.unknown());
const outputs = {
  "template.list": z.strictObject({ templates: z.array(object) }),
  "template.get": z.strictObject({ template: object }),
  "template.create": z.strictObject({ template: object }),
  "template.delete": z.strictObject({ template_id: id, deleted: z.literal(true) }),
};
const descriptionsZh: Record<Id, string> = {
  "template.list": "列出指定 Team 的原生云模板（全部分页）。",
  "template.get": "查看原生云模板及实际构建状态。",
  "template.create": "从镜像或构建步骤注册模板；重名时拒绝，提交不代表就绪。私有仓库凭据请使用 --input-file。",
  "template.delete": "删除指定 Team 的原生云模板；Sandbox 实例属于独立资源。",
};
const descriptions: Record<Id, string> = {
  "template.list": "List native cloud templates in the configured Team (or the first Team returned for the same AK/SK) (all pages).",
  "template.get": "Read a native cloud template and its actual build status.",
  "template.create": "Register a native template from an image or build steps; rejects existing names. Submission does not mean ready. Use --input-file for private registry credentials.",
  "template.delete": "Delete the selected Team's native cloud template; Sandbox instances are separate resources.",
};
export const TEMPLATE_COMMANDS: readonly ProviderCommand[] = (Object.keys(inputs) as Id[]).map(command => ({
  id: command, description: descriptions[command], description_zh: descriptionsZh[command], input_schema: commandSchema(inputs[command]), output_schema: commandSchema(outputs[command]),
  effect: command === "template.create" ? "write" : command === "template.delete" ? "delete" : "read", idempotent: command !== "template.create",
}));
export function isTemplateCommand(command: string): command is Id { return Object.hasOwn(inputs, command); }
function redact(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") return secrets.reduce((current, secret) => secret ? current.split(secret).join("[REDACTED]") : current, value);
  if (Array.isArray(value)) return value.map(item => redact(item, secrets));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, /password|secret|token|access.?key|authConfig/i.test(key) ? "[REDACTED]" : redact(item, secrets)]));
  return value;
}
export async function runTemplateCommand(config: LayeredConfig, command: string, raw: Dict, signal: AbortSignal): Promise<unknown> {
  if (!isTemplateCommand(command)) throw new ProviderFeatureNotSupportedError("alicloud-express", command);
  const parsed = inputs[command].safeParse(raw);
  if (!parsed.success) throw new ProviderConfigError(`Invalid input for '${command}'; use its published input schema.`);
  if (signal.aborted) throw new ProviderTimeoutError("Template operation cancelled before a cloud request was sent.");
  if (!config.access_key_id || !config.access_key_secret) throw new AuthenticationError("Cloud template management requires access_key_id and access_key_secret; a Sandbox API key does not replace them.");
  const input = parsed.data;
  const configuredTeam = input.team_id ?? config.provider_options["team_id"] ?? getOperationConfig()?.["team_id"] ?? resolveKey(getKey("team_id", "alicloud-express")!, collectSources())?.value;
  const team = configuredTeam === undefined || configuredTeam === null ? undefined : id.parse(configuredTeam);
  const credentials = { access_key_id: config.access_key_id, access_key_secret: config.access_key_secret, region: config.region, team_id: team };
  const secrets = [config.access_key_id, config.access_key_secret, config.sandbox_api_key ?? "", "registry_password" in input ? input.registry_password ?? "" : ""];
  try {
    if (command === "template.list") return { templates: redact(await templates.listOfficialTemplates({ ...(parsed.data as z.infer<typeof inputs["template.list"]>), ...credentials }), secrets) };
    if (command === "template.get") return { template: redact(await templates.getTemplate((input as z.infer<typeof inputs["template.get"]>).template_id, credentials), secrets) };
    if (command === "template.delete") { const template = input as z.infer<typeof inputs["template.delete"]>; await templates.deleteTemplate(template.template_id, credentials); return { template_id: template.template_id, deleted: true }; }
    const result = await templates.createOfficialTemplate({ ...(input as z.infer<typeof inputs["template.create"]>), ...credentials, update_existing: false, force: false });
    return { template: redact(result, secrets) };
  } catch (error) {
    // The older SDK adapter can include response details; retain codes while removing configured secrets.
    if (error instanceof SandboxError) { error.message = String(redact(error.message, secrets)); if (error.suggestion) error.suggestion = String(redact(error.suggestion, secrets)); throw error; }
    throw new SandboxError(`Template operation '${command}' failed. A submitted write may have completed; inspect its Team/template before retrying.`);
  }
}
