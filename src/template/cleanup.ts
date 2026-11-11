/** Retry deletion only for confirmed owned identities, preserving uncertain creation intents. */
import fs from "node:fs";
import { Sandbox } from "../api/sandbox.js";
import { SandboxNotFoundError, TemplateNotFoundError } from "../models/errors.js";
import { getProvider } from "../providers/registry.js";
import { loadLayeredConfig } from "../transport/config_layers.js";
import { ApplicationError, writeJson } from "../application/config.js";
export interface CleanupTarget { provider: string; providerOptions?: Record<string, unknown>; connection?: {api_url?: string; domain?: string} }
export async function cleanupResourceJournal(file: string, target: CleanupTarget): Promise<{ complete: boolean; failures: string[]; retained: unknown[] }> {
  const journal = JSON.parse(fs.readFileSync(file, "utf8"));
  if (journal.version !== 1 || journal.provider !== target.provider || !Array.isArray(journal.entries)) throw new ApplicationError("Resource journal does not match the selected target.");
  const entries = journal.entries as Array<{kind: string; id?: string; state: string; cleanup: string}>;
  const failures: string[] = [];
  const options = { provider: target.provider, provider_options: target.providerOptions, ...target.connection };
  const save = () => writeJson(file, journal);
  const absent = async (id: string) => { try { await Sandbox.getInfoById(id, options); return false; } catch (error) { if (error instanceof SandboxNotFoundError) return true; throw error; } };
  for (const item of entries.filter(item => item.kind === "sandbox" && item.state !== "deleted")) {
    if (!item.id) { failures.push("sandbox creation outcome unknown"); continue; }
    try { if (!await absent(item.id)) await Sandbox.killById(item.id, options); if (!await absent(item.id)) throw new ApplicationError("Sandbox still present."); item.state = "deleted"; }
    catch { failures.push(`sandbox ${item.id}`); }
    save();
  }
  if (!failures.length) {
    const templates = entries.filter(item => item.kind === "template" && item.state !== "deleted");
    if (templates.length) {
      const provider = getProvider(target.provider), manager = await provider.buildTemplateManager(loadLayeredConfig({ provider: target.provider, provider_options: target.providerOptions, sandbox_base_url: target.connection?.api_url, sandbox_domain: target.connection?.domain }));
      try {
        for (const item of templates) {
          if (!item.id || item.cleanup !== "template.delete" || !manager.delete || !manager.get) { failures.push("template ownership or inspection unavailable"); continue; }
          try {
            let absent = false;
            try { await manager.get(item.id); } catch (error) { if (error instanceof TemplateNotFoundError) absent = true; else throw error; }
            if (!absent) { await manager.delete(item.id); try { await manager.get(item.id); throw new ApplicationError("Template still present."); } catch (error) { if (!(error instanceof TemplateNotFoundError)) throw error; } }
            item.state = "deleted";
          } catch { failures.push(`template ${item.id}`); }
          save();
        }
      } finally { await manager.close?.(); }
    }
  }
  if (entries.some(item => !item.id && item.state !== "deleted")) failures.push("unconfirmed resource creation");
  return { complete: failures.length === 0, failures, retained: entries.filter(item => item.kind === "image" && item.state !== "deleted") };
}
