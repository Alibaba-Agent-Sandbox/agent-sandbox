import fs from "node:fs";
import { describe, expect, it } from "vitest";
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
