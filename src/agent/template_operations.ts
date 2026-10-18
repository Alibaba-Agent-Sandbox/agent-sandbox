/** Alibaba template adapter: submission, readiness and runtime acceptance are separate states. */
import { z } from "zod";
import { createOfficialTemplate, getTemplate, listOfficialTemplates } from "../api/fc_template.js";
import { loadConfig } from "../transport/config.js";
import { resolveProviderId } from "../providers/registry.js";
import { cliProvider } from "../providers/selection.js";
import type { SandboxManager } from "./mcp.js";
import type { JsonObject } from "./_py.js";
import { handleOperation } from "./operations.js";

const scope = { team_id: z.string().min(1), region: z.string().min(1).optional() };
export const templateInputs = {
  submit_template_build: z.strictObject({ ...scope, name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), image: z.string().min(1), generation: z.union([z.literal(1), z.literal(2)]).default(2), cpu: z.number().positive().default(2), memory: z.number().int().min(128).default(2048), start_command: z.string().optional(), ready_command: z.string().optional(), envd_inject: z.boolean().default(true) }),
  get_template_build: z.strictObject({ ...scope, template_id: z.string().min(1) }),
  validate_template: z.strictObject({ template_id: z.string().min(1), region: z.string().optional() }),
};
export const TEMPLATE_SCHEMAS = Object.entries(templateInputs).map(([name, schema]) => ({ name,
  description: name === "submit_template_build" ? "Submit a new, uniquely named OCI template through the Alibaba AK/SK adapter. Submission is not readiness. Existing names are refused to preserve rollback. Other providers require their own adapter."
    : name === "get_template_build" ? "Query Alibaba template build state; even ready needs runtime validation. Requires AK/SK and explicit Team."
    : "Create a temporary test sandbox, run command and binary acceptance, then verify cleanup separately. Template readiness alone is not runtime acceptance.",
  inputSchema: z.toJSONSchema(schema, { io: "input" }) as JsonObject,
}));

/** Execute an explicitly scoped template operation. */
export async function handleTemplateOperation(name: keyof typeof templateInputs, raw: JsonObject, manager: SandboxManager): Promise<JsonObject> {
  const p = templateInputs[name].parse(raw) as Record<string, unknown>;
  if (resolveProviderId(cliProvider()) !== "alicloud-express") throw new Error("This template adapter only supports alicloud-express; use the selected provider's documented template operation");
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
  const cfg = loadConfig();
  if (!cfg.access_key_id || !cfg.access_key_secret) throw new Error("Template adapter requires configured AK/SK; runtime API key is insufficient");
  const auth = { access_key_id: cfg.access_key_id, access_key_secret: cfg.access_key_secret, team_id: p.team_id as string, region: (p.region as string | undefined) ?? cfg.region };
  if (name === "get_template_build") {
    const result = await getTemplate(p.template_id as string, auth);
    return { template_id: p.template_id, status: result.status ?? result.state ?? null, code: result.code ?? null, runtime_verified: false };
  }
  if (p.generation === 1 && (p.start_command || p.ready_command)) throw new Error("start_command and ready_command require generation 2; use generation: 2");
  const templates = await listOfficialTemplates(auth);
  if (templates.some(t => t.name === p.name || t.templateName === p.name)) throw new Error("Template name already exists; select a unique version name to preserve rollback");
  const result = await createOfficialTemplate({ ...auth, update_existing: false, name: p.name as string, image: p.image as string, generation: p.generation as number, cpu: p.cpu as number, memory_size: p.memory as number,
    start_command: p.start_command as string | undefined, ready_command: p.ready_command as string | undefined, envd_inject: p.envd_inject as boolean });
  return { template_id: result.templateID, request_id: result.requestId ?? null, state: "submitted", runtime_verified: false };
}
