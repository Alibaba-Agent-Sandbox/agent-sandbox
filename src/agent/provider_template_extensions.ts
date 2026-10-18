/** Agent composition root for provider-owned template operations. */
import { TEMPLATE_SCHEMAS } from "../providers/alicloud_express/agent/template_metadata.js";
import { CONFIG_METADATA } from "../providers/alicloud_express/metadata.js";
import { resolveProviderId } from "../providers/registry.js";
import { cliProvider } from "../providers/selection.js";
import type { JsonObject } from "./_py.js";
import type { SandboxManager } from "./mcp.js";
export interface ProviderTemplateExtension {
  id: string;
  schemas: readonly { name: string; description: string; inputSchema: JsonObject }[];
  run(name: string, params: JsonObject, manager: SandboxManager): Promise<JsonObject>;
}
const extensions = new Map<string, ProviderTemplateExtension>([[CONFIG_METADATA.id, {
  id: CONFIG_METADATA.id, schemas: TEMPLATE_SCHEMAS,
  async run(name, params, manager) {
    const adapter = await import("../providers/alicloud_express/agent/template_operations.js");
    return adapter.handleTemplateOperation(name as Parameters<typeof adapter.handleTemplateOperation>[0], params, manager);
  },
}]]);
export function registerProviderTemplateExtension(extension: ProviderTemplateExtension): void { extensions.set(extension.id, extension); }
export function providerTemplateExtension(): ProviderTemplateExtension | undefined { return extensions.get(resolveProviderId(cliProvider())); }
