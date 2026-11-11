/** Adapt existing optional template managers to the shared Provider command runner. */
import type { LayeredConfig } from "../transport/config_layers.js";
import type { Provider } from "./base.js";
import type { ProviderCommand, ProviderCommandRunner } from "./command_contract.js";
import { ProviderFeatureNotSupportedError } from "../models/provider_errors.js";
import type { TemplateInfo } from "../models/template.js";

const reference = { type: "string", minLength: 1 };
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const descriptors: ProviderCommand[] = [
  { id: "template.list", description: "List native templates using this Provider's optional template manager.", description_zh: "通过此 Provider 的可选模板管理器列出原生模板。", input_schema: schema({}), output_schema: schema({ templates: { type: "array", items: { type: "object" } } }, ["templates"]), effect: "read", idempotent: true },
  { id: "template.get", description: "Read a native template using this Provider's optional template manager.", description_zh: "通过此 Provider 的可选模板管理器读取原生模板。", input_schema: schema({ template_id: reference }, ["template_id"]), output_schema: schema({ template: { type: "object" } }, ["template"]), effect: "read", idempotent: true },
  { id: "template.create", description: "Create a native template from an image using this Provider's optional template manager. Options are Provider-specific; inspect its documentation.", description_zh: "通过此 Provider 的可选模板管理器从镜像创建模板；options 字段以 Provider 文档为准。", input_schema: schema({ image: reference, options: { type: "object" } }, ["image"]), output_schema: schema({ template: { type: "object" } }, ["template"]), effect: "write", idempotent: false },
  { id: "template.delete", description: "Delete a native template using this Provider's optional template manager.", description_zh: "通过此 Provider 的可选模板管理器删除原生模板。", input_schema: schema({ template_id: reference }, ["template_id"]), output_schema: schema({ template_id: reference, deleted: { const: true } }, ["template_id", "deleted"]), effect: "delete", idempotent: true },
];
export function templateManagerCommands(provider: Provider): ProviderCommand[] {
  const declared = new Set(provider.commands.map(entry => entry.id));
  return descriptors.filter(entry => !declared.has(entry.id) && provider.features.has(entry.effect === "read" ? "templates.read" : "templates.build"));
}
const serialize = (value: TemplateInfo) => typeof value.modelDump === "function" ? value.modelDump({ mode: "json" }) : value;
export async function templateManagerRunner(provider: Provider, config: LayeredConfig, command: ProviderCommand): Promise<ProviderCommandRunner> {
  const manager = await provider.buildTemplateManager(config, command.effect === "read" ? "templates.read" : "templates.build");
  return {
    close: () => manager.close?.() ?? Promise.resolve(),
    async run(id, raw) {
      const input = raw as { template_id: string; image: string; options?: Record<string, unknown> };
      const method = id.slice("template.".length) as "list" | "get" | "create" | "delete";
      if (typeof manager[method] !== "function") throw new ProviderFeatureNotSupportedError(provider.id, `template.${method}`, { suggestion: "This Provider advertises template management but its manager does not implement this operation." });
      if (method === "list") return { templates: (await manager.list!()).map(serialize) };
      if (method === "get") return { template: serialize(await manager.get!(input.template_id)) };
      if (method === "create") return { template: serialize(await manager.create!(input.image, input.options ?? {})) };
      await manager.delete!(input.template_id); return { template_id: input.template_id, deleted: true };
    },
  };
}
