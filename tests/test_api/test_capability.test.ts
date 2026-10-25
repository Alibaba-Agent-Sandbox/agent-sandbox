/** Template software does not authorize provider operations. */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ResolvedCapabilities, _seams, resolveCapabilities, cacheDeployedTemplate } from "../../src/api/capability.js";
import { TemplateParseError } from "../../src/models/errors.js";
import { SandboxTemplate } from "../../src/models/template.js";
import vectors from "../test_template/fixtures/launch-vectors.json" with {type:"json"};
const original = _seams.TEMPLATE_CACHE_DIR;
const roots: string[] = [];
function fixture(extra: Record<string, unknown> = {}) { return {...structuredClone(vectors.cases[0].input.manifest), name: "template", ...extra}; }
function directory(): string { const root=mkdtempSync(join(tmpdir(),"abx-manifest-"));roots.push(root);return root; }
afterEach(()=>{_seams.TEMPLATE_CACHE_DIR=original;for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
describe("strict template discovery",()=>{
  it("requires the current template schema",()=>{expect(()=>new SandboxTemplate({name:"old"})).toThrow();});
  it.each(["capabilities","tested_on","providers"])("rejects retired field %s",field=>{expect(()=>new SandboxTemplate(fixture({[field]:[]}))).toThrow();});
  it("accepts a complete current manifest",()=>{expect(new SandboxTemplate(fixture()).spec_version).toBe(5);});
  it("does not infer operations when no template matches",async()=>{_seams.TEMPLATE_CACHE_DIR=directory();expect((await resolveCapabilities("missing")).capabilities.size).toBe(0);});
  it("does not grant operations from valid software metadata",async()=>{const root=directory(),file=join(root,"template.yaml");writeFileSync(file,JSON.stringify(fixture()));expect((await resolveCapabilities(null,{local_yaml_path:file})).capabilities.size).toBe(0);});
  it("rejects matched invalid manifests rather than granting defaults",async()=>{const root=directory();mkdirSync(join(root,"selected"));writeFileSync(join(root,"selected","template.yaml"),JSON.stringify({name:"selected",capabilities:["code"]}));_seams.TEMPLATE_CACHE_DIR=root;await expect(resolveCapabilities("selected")).rejects.toBeInstanceOf(TemplateParseError);});
  it("rejects an explicitly selected invalid manifest",async()=>{const file=join(directory(),"template.yaml");writeFileSync(file,JSON.stringify({name:"old"}));await expect(resolveCapabilities(null,{local_yaml_path:file})).rejects.toBeInstanceOf(TemplateParseError);});
  it("preserves a validated cache entry without authorizing its commands",async()=>{const root=directory(),file=join(root,"template.yaml");writeFileSync(file,JSON.stringify(fixture()));_seams.TEMPLATE_CACHE_DIR=join(root,"cache");cacheDeployedTemplate(file,"native-id");expect((await resolveCapabilities("native-id")).capabilities.size).toBe(0);});
  it("uses an empty discovery set by default",()=>{expect(new ResolvedCapabilities().capabilities.size).toBe(0);});
});
