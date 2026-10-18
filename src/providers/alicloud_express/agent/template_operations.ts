import { templateInputs } from "./template_metadata.js";
/** Alibaba template adapter: submission, readiness and runtime acceptance are separate states. */
import { createOfficialTemplate, getTemplate, listOfficialTemplates } from "../fc_template.js";
import { loadConfig } from "../../../transport/config.js";
import { resolveProviderId } from "../../registry.js";
import { cliProvider } from "../../selection.js";
import type { SandboxManager } from "../../../agent/mcp.js";
import type { JsonObject } from "../../../agent/_py.js";

/** Execute an explicitly scoped template operation. */
export async function handleTemplateOperation(name: keyof typeof templateInputs, raw: JsonObject, _manager: SandboxManager): Promise<JsonObject> {
  const p = templateInputs[name].parse(raw) as Record<string, unknown>;
  if (resolveProviderId(cliProvider()) !== "alicloud-express") throw new Error("This template adapter only supports alicloud-express; use the selected provider's documented template operation");
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
