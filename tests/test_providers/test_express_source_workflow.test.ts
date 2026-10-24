import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { useIso } from "../_support/iso.js";
import { CLI_EXTENSION } from "../../src/providers/alicloud_express/cli/extension.js";
import { templateSeams } from "../../src/providers/alicloud_express/cli/template.js";
import * as projectTools from "../../src/providers/shared/project.js";
import * as fc from "../../src/providers/alicloud_express/fc_template.js";
import { Context, command } from "../../src/cli/kit.js";
import { ResourceJournal } from "../../src/template/resource_journal.js";
import type { ProjectTemplateOptions } from "../../src/providers/template_contract.js";
import { planWorkflow } from "../../src/template/workflow_plan.mjs";
import operations from "../../src/providers/alicloud_express/workflow-operations.json" with { type: "json" };

const iso = useIso();
function fixture() {
  const directory = path.join(iso.root, "project"); fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "template.yaml"), JSON.stringify({ name: "fixture", generation: 2, base: "base:fixed", build: { mode: "steps", steps: [{type:"RUN",args:["true"]}, {type:"ENV",args:["WORKFLOW_TEST","value"]}] }, start_cmd: "serve", ready_cmd: "ready" }));
  const ctx = new Context(command("launch")); ctx.params["yes"] = true;
  const journal = new ResourceJournal("alicloud-express", "fixture");
  const options: ProjectTemplateOptions = {alias:"fixture-unique",timeout:30,journal,workflow:{input:"source",startup:"exec"},template:{name:"fixture",cpu:2,memory:2048,start_cmd:"serve",ready_cmd:"ready"}};
  vi.spyOn(templateSeams, "loadConfig").mockReturnValue({access_key_id:"placeholder",access_key_secret:"placeholder",region:"cn-hangzhou"} as ReturnType<typeof templateSeams.loadConfig>);
  return {directory,ctx,journal,options};
}

describe("Express source workflow", () => {
  it("journals registration before submission and retains its exact ID even when readiness fails", async () => {
    const f=fixture();
    const create=vi.spyOn(fc,"createOfficialTemplate").mockImplementation(async opts=>{
      expect(f.journal.entries).toMatchObject([{kind:"template",state:"intent",correlation_key:"fixture-unique"}]);
      expect(JSON.parse(fs.readFileSync(f.journal.file,"utf8")).entries[0].state).toBe("intent");
      expect(opts).toMatchObject({name:"fixture-unique",update_existing:false,start_command:null,ready_command:null,cpu:2,memory_size:2048});
      return {templateID:"exact-template-id"};
    });
    const wait=vi.spyOn(fc,"waitForTemplateReady").mockRejectedValue(new Error("readiness failed"));
    await expect(CLI_EXTENSION.prepareProject(f.directory,f.options,f.ctx)).rejects.toThrow("readiness failed");
    expect(create).toHaveBeenCalledOnce();expect(wait).toHaveBeenCalledWith("exact-template-id",expect.anything());
    expect(f.journal.entries).toMatchObject([{kind:"template",state:"created",id:"exact-template-id",cleanup:"template.delete"}]);
  });
  it("returns owned identities and preserves native step environment for post-create service startup", async()=>{
    const f=fixture();vi.spyOn(fc,"createOfficialTemplate").mockResolvedValue({templateID:"exact-template-id"});
    vi.spyOn(fc,"waitForTemplateReady").mockResolvedValue({status:"ready"});
    const prepared=await CLI_EXTENSION.prepareProject(f.directory,f.options,f.ctx);
    expect(prepared).toMatchObject({reference:"exact-template-id",identity:{native_version:"exact-template-id"},owned_resources:[{kind:"template",id:"exact-template-id",owned:true}]});
    expect(prepared.startup_command).toContain("'WORKFLOW_TEST=value'");expect(prepared.startup_command).toContain("'serve'");
    expect(prepared.ready_command).toContain("'ready'");
  });
  it("submits nothing when intent persistence fails", async()=>{
    const f=fixture();const create=vi.spyOn(fc,"createOfficialTemplate");
    vi.spyOn(f.journal,"intent").mockRejectedValue(new Error("disk full"));
    await expect(CLI_EXTENSION.prepareProject(f.directory,f.options,f.ctx)).rejects.toThrow("disk full");expect(create).not.toHaveBeenCalled();
  });
  it("does not replay an uncertain template submission", async()=>{
    const f=fixture();const create=vi.spyOn(fc,"createOfficialTemplate").mockRejectedValue(new Error("network timeout"));
    await expect(CLI_EXTENSION.prepareProject(f.directory,f.options,f.ctx)).rejects.toThrow("network timeout");
    expect(create).toHaveBeenCalledOnce();expect(f.journal.entries).toMatchObject([{state:"intent",correlation_key:"fixture-unique"}]);
  });
  it("snapshots explicit native steps without requiring a Dockerfile",async()=>{
    const f=fixture();const stage=await CLI_EXTENSION.stageProject(f.directory,f.options);
    try {expect(fs.existsSync(path.join(stage.directory,"template.yaml"))).toBe(true);await stage.verify();}finally{await stage.close();}
  });
  it("resolves native base placeholders only in the execution snapshot and honors a selected profile",async()=>{
    const f=fixture();fs.writeFileSync(path.join(f.directory,"Dockerfile"),"FROM fc-e2b-registry.<region>.cr.aliyuncs.com/runtime/base:<tag>\n");
    f.options.build_profile={id:"native",dockerfile:"Dockerfile",context:"."};
    const stage=await CLI_EXTENSION.stageProject(f.directory,f.options);
    try {expect(fs.readFileSync(path.join(stage.directory,"Dockerfile"),"utf8")).not.toContain("<region>");expect(fs.readFileSync(path.join(f.directory,"Dockerfile"),"utf8")).toContain("<region>");await stage.verify();}finally{await stage.close();}
    fs.writeFileSync(path.join(f.directory,"Dockerfile.portable"),"FROM python:3.12-slim\n");f.options.build_profile={id:"portable",dockerfile:"Dockerfile.portable",context:"."};
    const portable=await CLI_EXTENSION.stageProject(f.directory,f.options);try{expect(fs.readFileSync(path.join(portable.directory,"Dockerfile.portable"),"utf8")).toBe("FROM python:3.12-slim\n");}finally{await portable.close();}
  });
  it("journals Docker build, immutable publication and envd copy while preserving the selected profile", async()=>{
    const f=fixture();vi.stubEnv("ACR_NAMESPACE","fixture-namespace");
    fs.writeFileSync(path.join(f.directory,"Dockerfile.portable"),"FROM python:3.12-slim\n");
    f.options.build_profile={id:"portable",dockerfile:"Dockerfile.portable",context:"."};
    const build=vi.spyOn(templateSeams,"_buildImage").mockImplementation(async (_dir,options)=>{
      expect(f.journal.entries[0]).toMatchObject({kind:"image",state:"intent"});
      expect(options.dockerfile).toBe(path.join(f.directory,"Dockerfile.portable"));
      return `fixture:${options.tag}`;
    });
    const ref="registry.cn-hangzhou.aliyuncs.com/fixture-namespace/fixture:fixture-unique";
    const immutable=ref.slice(0,ref.lastIndexOf(":"))+"@sha256:"+"a".repeat(64);
    vi.spyOn(templateSeams,"_pushImage").mockImplementation(async ()=>{
      expect(f.journal.entries[1]).toMatchObject({kind:"image",state:"intent",correlation_key:ref});
      return [ref,{tempUserName:"placeholder",authorizationToken:"placeholder"}];
    });
    vi.spyOn(projectTools,"runTool").mockResolvedValue(JSON.stringify([immutable]));
    const create=vi.spyOn(fc,"createOfficialTemplate").mockImplementation(async options=>{
      expect(options).toMatchObject({image:ref,update_existing:false,envd_inject:true,target_image:ref+"-envd",start_command:null,ready_command:null});
      expect(f.journal.entries.at(-1)).toMatchObject({kind:"template",state:"intent"});
      return {templateID:"exact-template-id"};
    });
    vi.spyOn(fc,"waitForTemplateReady").mockResolvedValue({status:{state:"ready"}});
    const result=await CLI_EXTENSION.prepareProject(f.directory,f.options,f.ctx);
    expect(build).toHaveBeenCalledOnce();expect(create).toHaveBeenCalledOnce();
    expect(result.reference).toBe("exact-template-id");expect(result.owned_resources).toHaveLength(4);
    expect(result.owned_resources).toContainEqual(expect.objectContaining({kind:"image",id:immutable}));
    expect(f.journal.entries.every(e=>e.state==="created")).toBe(true);
  });
  it("supports source application planning without claiming Python source preparation or foreign references",()=>{
    const manifest={spec_version:4,workflow_contract_version:1,provides:{app:{protocol:"agent-sandbox-server",version:2,port:9000,operations:["commands.run"]}},default_workflow:"application",start_cmd:"serve",ready_cmd:"ready",workflows:{application:{kind:"application",input:"source",startup:"exec",service:"app",binding:{transport:"http",endpoint:"provider-port",caller:"host",authentication:"service-token"},operation:"commands.run",required_operations:[]}}};
    const provider={...operations,id:"alicloud-express",operation_contract_version:1 as const};
    expect(planWorkflow(manifest,provider,undefined,"cli").state).toBe("T");
    expect(planWorkflow(manifest,provider,undefined,"python-provider").state).toBe("F");
    expect(operations.operations.python).not.toContain("template.prepare");
  });
});
