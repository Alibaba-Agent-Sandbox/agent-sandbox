/** Provider-neutral template tool routing and runtime acceptance. */
import { z } from "zod";
import type { SandboxManager } from "./mcp.js";
import type { JsonObject } from "./_py.js";
import { handleOperation } from "./operations.js";
import { providerTemplateExtension, type ProviderTemplateExtension } from "./provider_template_extensions.js";
import { ProviderFeatureNotSupportedError } from "../providers/errors.js";
import { resolveProviderId } from "../providers/registry.js";
import { cliProvider } from "../providers/selection.js";
const validationInput = z.strictObject({ template_id: z.string().min(1), region: z.string().optional() });
const validationSchema = { name: "validate_template", description: "Create a temporary sandbox through the selected provider, verify its runtime, and verify owned cleanup separately.",
  inputSchema: z.toJSONSchema(validationInput, { io: "input" }) as JsonObject };
export function templateSchemas(): Array<ProviderTemplateExtension["schemas"][number]> { return [...(providerTemplateExtension()?.schemas ?? []), validationSchema]; }
export async function handleTemplateOperation(name: string, raw: JsonObject, manager: SandboxManager): Promise<JsonObject> {
  const p = name === "validate_template" ? validationInput.parse(raw) as Record<string, unknown> : raw;
  if (name === "validate_template") {
    const previousDefault = manager._default_sandbox;
    const sandbox = await manager.createSandbox({ template: p.template_id as string, region: p.region as string | undefined, timeout: 120 });
    const id = manager.reference(sandbox);
    let validation: JsonObject = {};
    let cleanupError: string | null = null;
    try { validation = await handleOperation("verify_sandbox", { sandbox_id: id }, manager); }
    catch (error) { validation = { verified: false, error: error instanceof Error ? error.message : String(error) }; }
    finally {
      try { await manager.killSandbox(id); }
      catch (error) { cleanupError = error instanceof Error ? error.message : String(error); }
      manager._default_sandbox = previousDefault;
    }
    let cleanupVerified = false;
    try { await manager.observeSandbox(id); }
    catch (error) {
      if ((error as { code?: string }).code === "E2009") cleanupVerified = true;
      else cleanupError = error instanceof Error ? error.message : String(error);
    }
    return { template_id: p.template_id, ...validation, cleanup_verified: cleanupVerified, ...(cleanupError ? { cleanup_error: cleanupError } : {}) };
  }

  const extension = providerTemplateExtension();
  if (!extension?.schemas.some((schema) => schema.name === name)) throw new ProviderFeatureNotSupportedError(resolveProviderId(cliProvider()), "templates.management");
  return extension.run(name, raw, manager);
}
