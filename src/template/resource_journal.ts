/** Durable owned-resource recovery journal. It never contains credentials or endpoint URLs. */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { paths } from "../transport/config_layers.js";
import { ProviderConfigError } from "../models/provider_errors.js";
export interface ResourceIntent { kind: "image" | "template" | "sandbox"; correlation_key: string; cleanup: "manual" | "template.delete" | "sandbox.delete" }
export interface ResourceJournalCallbacks {
  intent(input: ResourceIntent): Promise<string>;
  created(intentId: string, id: string): Promise<void>;
}
interface Entry extends ResourceIntent { intent_id: string; state: "intent" | "created" | "uncertain" | "deleted" | "retained"; id?: string }
/** Persist intent before requests; unresolved intents remain uncertain and are never blindly retried. */
export class ResourceJournal implements ResourceJournalCallbacks {
  readonly id = randomUUID();
  readonly entries: Entry[] = [];
  readonly file: string;
  constructor(readonly provider: string, readonly plan_digest: string) {
    this.file = path.join(paths.abxDir, "resource-journal", `${this.id}.json`);
  }
  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.tmp`;
    await fs.writeFile(temporary, JSON.stringify({ version: 1, id: this.id, provider: this.provider, plan_digest: this.plan_digest, entries: this.entries }), { mode: 0o600 });
    await fs.rename(temporary, this.file);
  }
  async intent(input: ResourceIntent): Promise<string> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,1023}$/.test(input.correlation_key)) throw new ProviderConfigError("Resource correlation key must not contain credentials or endpoint URLs.");
    const entry: Entry = { ...input, intent_id: randomUUID(), state: "intent" };
    this.entries.push(entry); await this.save(); return entry.intent_id;
  }
  async created(intentId: string, id: string): Promise<void> {
    const entry = this.entries.find(value => value.intent_id === intentId);
    if (!entry || entry.state !== "intent" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,1023}$/.test(id)) throw new ProviderConfigError("Invalid owned-resource receipt.");
    entry.id = id; entry.state = "created"; await this.save();
  }
  async mark(intentId: string, state: "uncertain" | "deleted" | "retained"): Promise<void> {
    const entry = this.entries.find(value => value.intent_id === intentId);
    if (!entry) throw new ProviderConfigError("Unknown owned-resource intent.");
    entry.state = state; await this.save();
  }
  /** Report only recovery identity, never authorization data. */
  recoverySummary(): Array<{ intent_id: string; kind: string; id?: string; state: string; cleanup: string }> {
    return this.entries.filter(e => e.state !== "deleted" && e.state !== "retained").map(({ intent_id, kind, id, state, cleanup }) => ({ intent_id, kind, id, state, cleanup }));
  }
}
