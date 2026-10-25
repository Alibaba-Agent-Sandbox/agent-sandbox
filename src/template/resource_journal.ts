/** Synced owned-resource recovery journal. It never contains credentials or endpoint URLs. */
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
    const journalDirectory = path.dirname(this.file);
    const firstCreated = await fs.mkdir(journalDirectory, { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.tmp`;
    const handle = await fs.open(temporary, "w", 0o600);
    try {
      await handle.writeFile(JSON.stringify({ version: 1, id: this.id, provider: this.provider, plan_digest: this.plan_digest, entries: this.entries }));
      await handle.sync();
    } finally { await handle.close(); }
    await fs.rename(temporary, this.file);
    // Windows supports file sync, but Node does not provide POSIX directory fsync there.
    // Keep write/sync/rename failures fatal; do not claim power-loss durability for its directory entries.
    if (process.platform === "win32") return;
    // On POSIX, persist directory entries before acknowledging the intent.
    const directories = [journalDirectory];
    if (firstCreated !== undefined) {
      // Persist every newly created directory entry, including the first entry in its existing parent.
      let createdDirectory = journalDirectory;
      for (;;) {
        const parent = path.dirname(createdDirectory);
        directories.push(parent);
        if (path.resolve(createdDirectory) === path.resolve(firstCreated)) break;
        if (parent === createdDirectory) throw new ProviderConfigError("Cannot establish journal directory durability.");
        createdDirectory = parent;
      }
    }
    for (const folder of directories) {
      const directory = await fs.open(folder, "r");
      try { await directory.sync(); } finally { await directory.close(); }
    }
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
