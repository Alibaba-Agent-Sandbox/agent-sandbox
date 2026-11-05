/** Private preparation child: reuse the actual Express journal and create-only adapter. */
import fs from "node:fs";
import { Context, command } from "../../../cli/kit.js";
import { CLI_EXTENSION } from "../cli/extension.js";
import { ResourceJournal } from "../../../template/resource_journal.js";
import { _setPaths } from "../../../transport/config_layers.js";
import type { ApplicationPlan } from "../../../application/types.js";
function emit(value: unknown): void { fs.writeSync(3, JSON.stringify(value) + "\n"); }
export async function runPreparation(): Promise<void> {
  const raw = fs.readFileSync(0, "utf8"), input = JSON.parse(raw) as { plan: ApplicationPlan; journalRoot: string };
  // Keep the actual recovery journal in durable user storage, while HOME/config stay isolated.
  _setPaths({ abxDir: input.journalRoot, envFiles: [] });
  const { plan } = input, template = plan.template;
  const journal = new ResourceJournal(template.application.sandbox.provider, plan.id);
  const snapshot = () => {
    const resources = journal.recoverySummary(), created = resources.filter(item => item.kind === "template" && item.state === "created" && item.id);
    return { provider: journal.provider, reference: created.length === 1 ? created[0].id! : "", journalId: journal.id, resources };
  };
  const progress = (): void => emit({ type: "progress", sandbox: snapshot() });
  const callbacks = { async intent(value: Parameters<ResourceJournal["intent"]>[0]): Promise<string> { const id = await journal.intent(value); progress(); return id; },
    async created(id: string, native: string): Promise<void> { await journal.created(id, native); progress(); } };
  progress();
  const ctx = new Context(command("managed-prepare")); ctx.params = { yes: true, region: template.application.deployment.region };
  try {
    const prepared = await CLI_EXTENSION.prepareProject(plan.projectRoot, { alias: `${template.name.slice(0, 35)}-${plan.revision.slice(4)}`, timeout: 1800, journal: callbacks,
      template: { name: template.name, cpu: template.resources.cpu, memory: template.resources.memory, start_cmd: template.start_cmd, ready_cmd: template.ready_cmd } }, ctx);
    const confirmed = snapshot();
    if (confirmed.reference !== prepared.reference) throw new Error("Preparation reference differs from its native creation journal");
    emit({ type: "result", sandbox: confirmed });
  } catch {
    emit({ type: "failed", sandbox: snapshot() }); process.exitCode = 1;
  }
}
