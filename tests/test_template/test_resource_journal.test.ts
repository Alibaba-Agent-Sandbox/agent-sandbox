import fs from "node:fs";
import path from "node:path";
import promises from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {paths, _setPaths} from "../../src/transport/config_layers.js";
import { ResourceJournal } from "../../src/template/resource_journal.js";
import { useIso } from "../_support/iso.js";
useIso();
describe("resource recovery journal",()=>{
  it("durably records intent before a resource exists and retains uncertain recovery identity",async()=>{
    const journal=new ResourceJournal("opensandbox","plan-digest");const id=await journal.intent({kind:"sandbox",correlation_key:"launch-123",cleanup:"sandbox.delete"});
    expect(JSON.parse(fs.readFileSync(journal.file,"utf8")).entries).toEqual([expect.objectContaining({intent_id:id,state:"intent"})]);
    await journal.mark(id,"uncertain");expect(journal.recoverySummary()).toEqual([expect.objectContaining({state:"uncertain",kind:"sandbox"})]);
    expect(fs.readFileSync(journal.file,"utf8")).not.toContain("https://");
  });
  it("keeps owned resource identity through confirmed cleanup",async()=>{const journal=new ResourceJournal("opensandbox","plan-digest");const id=await journal.intent({kind:"sandbox",correlation_key:"launch-123",cleanup:"sandbox.delete"});await journal.created(id,"sandbox-123");await journal.mark(id,"deleted");expect(journal.recoverySummary()).toEqual([]);expect(JSON.parse(fs.readFileSync(journal.file,"utf8")).entries[0].id).toBe("sandbox-123");});
});

it("syncs the actual file before rename and its directory before acknowledging intent", async () => {
  const events: string[] = []; const syncedDirectories: string[] = []; const open = promises.open.bind(promises); const rename = promises.rename.bind(promises);
  const opened = vi.spyOn(promises, "open").mockImplementation(async (...args) => {
    const handle = await open(...args); const sync = handle.sync.bind(handle);
    vi.spyOn(handle, "sync").mockImplementation(async () => { events.push(String(args[0]).endsWith(".tmp") ? "file-sync" : "directory-sync"); if (!String(args[0]).endsWith(".tmp")) syncedDirectories.push(String(args[0])); await sync(); });
    return handle;
  });
  const renamed = vi.spyOn(promises, "rename").mockImplementation(async (...args) => { events.push("rename"); await rename(...args); });
  try {
    const journal = new ResourceJournal("opensandbox", "plan"); await journal.intent({kind: "sandbox", correlation_key: "owned", cleanup: "sandbox.delete"});
    expect(events).toEqual(["file-sync", "rename", "directory-sync", "directory-sync"]);
    expect(syncedDirectories).toEqual([path.dirname(journal.file), path.dirname(path.dirname(journal.file))]);
    events.length = 0; syncedDirectories.length = 0;
    await journal.intent({kind: "sandbox", correlation_key: "second-owned", cleanup: "sandbox.delete"});
    expect(events).toEqual(["file-sync", "rename", "directory-sync"]);
    expect(syncedDirectories).toEqual([path.dirname(journal.file)]);
    expect(fs.statSync(journal.file).mode & 0o777).toBe(0o600);
    expect(fs.existsSync(`${journal.file}.tmp`)).toBe(false);
  } finally { opened.mockRestore(); renamed.mockRestore(); }
});

it("syncs every first-created ancestor entry through the first existing parent", async () => {
  const existingRoot = paths.abxDir; const newRoot = path.join(existingRoot, "nested", "new-abx");
  _setPaths({abxDir: newRoot});
  const open = promises.open.bind(promises); const synced: string[] = [];
  const opened = vi.spyOn(promises, "open").mockImplementation(async (...args) => {
    const handle = await open(...args); const sync = handle.sync.bind(handle);
    vi.spyOn(handle, "sync").mockImplementation(async () => {if (!String(args[0]).endsWith(".tmp")) synced.push(String(args[0])); await sync();});
    return handle;
  });
  try {
    const journal = new ResourceJournal("opensandbox", "plan"); await journal.intent({kind: "sandbox", correlation_key: "owned", cleanup: "sandbox.delete"});
    expect(synced).toEqual([path.join(newRoot, "resource-journal"), newRoot, path.dirname(newRoot), existingRoot]);
  } finally { opened.mockRestore(); _setPaths({abxDir: existingRoot}); }
});
