/** Public resource deployment and separate explicit native instance lifecycle. */
import "../_support/isolatedHome.js";
import fs from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliRunner } from "../helpers/cliRunner.js";
import { useTmpPath } from "../helpers/templateSupport.js";
import { cli } from "../../src/cli/main.js";
import { deploymentSeams } from "../../src/cli/commands/deploy.js";
import { readDeployment, saveDeployment } from "../../src/cli/deployment_store.js";
import { renderScaffold } from "../../src/cli/scaffold.js";
import { paths, _setPaths } from "../../src/transport/config_layers.js";
import { Sandbox } from "../../src/api/sandbox.js";
import { sourceDigest } from "../../src/application/config.js";
import { QwenCodeBackend } from "../../src/agent/coding_agent.js";
import { resourceServices } from "../../src/template/resource_executor.js";
const tmp=useTmpPath(),oldPaths={...paths};
const run=(args:string[])=>new CliRunner().invoke(cli,args,{env:{ABX_SANDBOX_API_KEY:"test-key",ABX_REGION:"cn-hangzhou"}});
beforeEach(()=>_setPaths({abxDir:path.join(tmp(),"home")}));
afterEach(()=>{vi.restoreAllMocks();_setPaths(oldPaths);});
function project():string {
  const folder=path.join(tmp(),"project");fs.mkdirSync(folder);
  for(const [name,content] of renderScaffold("minimal","example","alicloud-express"))fs.writeFileSync(path.join(folder,name),content);
  const file=path.join(folder,"template.yaml"),value=parse(fs.readFileSync(file,"utf8"));value.sandbox.agent.template={region:"cn-hangzhou",image:"example.com/test:v1"};fs.writeFileSync(file,stringify(value));return folder;
}
function native() {
  const call=vi.fn(async(action:string)=>action==="CreateTemplate"?{templateID:"tpl-test"}:{}),ready=vi.fn(async()=>({status:{state:"ready"}}));
  const credentials=vi.spyOn(resourceServices,"credentials").mockResolvedValue({AccountID:"123",AccessKeyID:"placeholder",AccessKeySecret:"placeholder"});
  vi.spyOn(resourceServices,"express").mockReturnValue({call,ready,team:async()=>"team-test"} as never);
  return {call,ready,credentials};
}
describe("named resource admission",()=>{
  it.each([false,true])("rejects retired deployment declarations before effects (plan=%s)",async preview=>{
    const folder=project(),file=path.join(folder,"template.yaml"),value=parse(fs.readFileSync(file,"utf8"));value.deployment={resources:{}};fs.writeFileSync(file,stringify(value));
    const f=native();const result=await run(["deploy",folder,"--name","mixed",...(preview?["--plan"]:["--yes"])]);
    expect(result.exit_code).not.toBe(0);expect(result.output).toContain("schema validation");expect(f.credentials).not.toHaveBeenCalled();expect(f.call).not.toHaveBeenCalled();
  });
  it("previews templates without building, creating instances or writing deployment state",async()=>{
    const source=project(),f=native(),create=vi.spyOn(Sandbox,"create");const result=await run(["--json","deploy",source,"--name","demo","--plan"]);
    expect(result.exit_code,result.output).toBe(0);expect(JSON.parse(result.stdout)).toMatchObject({name:"demo",status:"preview",createsDynamicInstances:false,resources:[{name:"agent",kind:"sandbox"}]});
    expect(f.credentials).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();expect(readDeployment("demo")).toBeUndefined();
  });
  it("rejects a missing manifest with template init guidance", async () => {
    const source = project(), f = native(); fs.unlinkSync(path.join(source, "template.yaml"));
    const result = await run(["deploy", source, "--yes"]);
    expect(result.exit_code).not.toBe(0); expect(result.output).toContain("template.yaml"); expect(result.output).toContain("template init");
    expect(f.credentials).not.toHaveBeenCalled(); expect(f.call).not.toHaveBeenCalled();
  });
  it("rejects a nonexistent local source before cloud effects", async () => {
    const source = path.join(tmp(), "missing", "project"), f = native();
    const result = await run(["deploy", source, "--yes"]);
    expect(result.exit_code).not.toBe(0); expect(fs.existsSync(source)).toBe(false);
    expect(f.credentials).not.toHaveBeenCalled(); expect(f.call).not.toHaveBeenCalled();
  });
  it("uses the current directory when source is omitted", async () => {
    const source = project(), cwd = process.cwd(), f = native();
    try {
      process.chdir(source);
      const result = await run(["--json", "deploy", "--name", "current", "--yes"]);
      expect(result.exit_code, result.output).toBe(0); expect(readDeployment("current")?.source).toBe(fs.realpathSync(source));
      expect(JSON.parse(result.stdout)).toMatchObject({name: "current", status: "ready"}); expect(f.call).toHaveBeenCalled();
    } finally {process.chdir(cwd);}
  });
  it("accepts verbose during resource preparation", async () => {
    const source = project(), f = native();
    const result = await run(["--verbose", "deploy", source, "--name", "verbose", "--yes"]);
    expect(result.exit_code, result.output).toBe(0); expect(readDeployment("verbose")?.status).toBe("ready"); expect(f.call).toHaveBeenCalled();
  });
  it("prepares resources without invoking coding agents or model credentials", async () => {
    const source = project(), f = native();
    const modelCredentials = vi.spyOn(QwenCodeBackend.prototype, "resolveCredentials"), generate = vi.spyOn(QwenCodeBackend.prototype, "generate"), research = vi.spyOn(QwenCodeBackend.prototype, "research");
    const result = await run(["deploy", source, "--name", "no-ai", "--yes"]);
    expect(result.exit_code, result.output).toBe(0); expect(f.call).toHaveBeenCalled();
    expect(modelCredentials).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled(); expect(research).not.toHaveBeenCalled();
  });
  it("rejects invalid manifests during preview",async()=>{const source=project();fs.writeFileSync(path.join(source,"template.yaml"),"name: example\nspec_version: 999\n");expect((await run(["deploy",source,"--plan"])).exit_code).not.toBe(0);});
  it("prepares a named template, records ownership and reuses its unchanged identity",async()=>{
    const source=project(),before=sourceDigest(source);fs.writeFileSync(path.join(source,".env"),"PRIVATE=do-not-copy\n");const f=native(),create=vi.spyOn(Sandbox,"create");
    const result=await run(["--json","deploy",source,"--name","demo","--yes"]);expect(result.exit_code,result.output).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({name:"demo",status:"ready",resources:[{name:"agent",id:"tpl-test",kind:"template",owned:true}]});
    expect(sourceDigest(source)).toBe(before);expect(create).not.toHaveBeenCalled();const saved=readDeployment("demo")!;expect(saved.kind).toBe("resources");expect(fs.readFileSync(saved.receipt!,"utf8")).not.toContain("do-not-copy");
    expect((await run(["deploy",source,"--name","demo","--yes"])).exit_code).toBe(0);expect(f.call.mock.calls.filter(([action])=>action==="CreateTemplate")).toHaveLength(1);
  });
  it("exposes no retired instance or managed deployment options",async()=>{
    const result=await run(["deploy","--help"]);expect(result.exit_code).toBe(0);
    for(const flag of ["--template-id","--sandbox-timeout","--bindings","--build-profile","--env","--volume-mount"]) expect(result.output).not.toContain(flag);
    const create=vi.spyOn(Sandbox,"create");expect((await run(["deploy","--template-id","base","--yes"])).exit_code).not.toBe(0);expect(create).not.toHaveBeenCalled();
  });
  it("retains a known template ID when native readiness fails",async()=>{
    const source=project(),f=native();f.ready.mockRejectedValue(new Error("readiness-failed"));expect((await run(["deploy",source,"--name","failed","--yes"])).exit_code).not.toBe(0);
    const saved=readDeployment("failed")!;expect(saved.status).toBe("requires_recovery");expect(JSON.parse(fs.readFileSync(saved.receipt!,"utf8"))).toMatchObject({resources:[{id:"tpl-test",kind:"template"}]});
  });
  it("rejects unfinished build artifacts and source drift before effects",async()=>{
    const source=project(),file=path.join(tmp(),"build.json"),f=native();
    for(const artifact of [{kind:"ResourceDeployment",status:"preparing",buildOnly:true,source,sourceDigest:sourceDigest(source)},{kind:"ResourceDeployment",status:"ready",buildOnly:true,source,sourceDigest:"changed"}]){
      fs.writeFileSync(file,JSON.stringify(artifact));expect((await run(["deploy","--build",file,"--yes"])).exit_code).not.toBe(0);
    }expect(f.credentials).not.toHaveBeenCalled();
  });
  it.each(["build-to-build", "source-to-build", "build-to-source"])("rejects active deployment build changes before effects (%s)", async mode => {
    const source = project(), f = native();
    const oldBuild = path.join(tmp(), "old-build.json"), nextBuild = path.join(tmp(), "next-build.json");
    const artifact = {kind: "ResourceDeployment", version: 1, name: "example", accountId: "123", status: "ready", buildOnly: true, source, sourceDigest: sourceDigest(source), resources: []};
    fs.writeFileSync(oldBuild, JSON.stringify({...artifact, consumers: ["active"]}));
    fs.writeFileSync(nextBuild, JSON.stringify({...artifact, consumers: []}));
    saveDeployment({version: 1, name: "active", kind: "resources", provider: "alicloud-express", status: "ready", source,
      ...(mode === "source-to-build" ? {} : {borrowedBuild: fs.realpathSync(oldBuild)}), createdAt: "now", updatedAt: "now"});
    const before = readDeployment("active"), oldBytes = fs.readFileSync(oldBuild, "utf8"), nextBytes = fs.readFileSync(nextBuild, "utf8");
    const hostAction = vi.spyOn(resourceServices, "run"), component = vi.spyOn(resourceServices, "component");
    const result = await run(["deploy", ...(mode === "build-to-source" ? [source] : ["--build", nextBuild]), "--name", "active", "--yes"]);
    expect(result.exit_code).not.toBe(0); expect(result.output).toContain("different build");
    expect(f.credentials).not.toHaveBeenCalled(); expect(f.call).not.toHaveBeenCalled();
    expect(hostAction).not.toHaveBeenCalled(); expect(component).not.toHaveBeenCalled();
    expect(readDeployment("active")).toEqual(before);
    expect(fs.readFileSync(oldBuild, "utf8")).toBe(oldBytes); expect(fs.readFileSync(nextBuild, "utf8")).toBe(nextBytes);
  });
  it("rejects deployment receipts used as build artifacts",async()=>{
    const source=project(),file=path.join(tmp(),"build.json"),f=native();fs.writeFileSync(file,JSON.stringify({kind:"ResourceDeployment",status:"ready",source,sourceDigest:sourceDigest(source)}));
    const result=await run(["deploy","--build",file,"--name","rejected","--yes"]);expect(result.exit_code).not.toBe(0);expect(result.output).toContain("not ready");expect(f.call).not.toHaveBeenCalled();expect(readDeployment("rejected")).toBeUndefined();
  });
  it("rejects duplicate mounts, absent uploads and resource instance overrides before admission",async()=>{
    const source=project(),f=native();for(const args of [["--volume-mount","/data=one","--volume-mount","/data=two"],["--upload",path.join(tmp(),"missing")],["--env","TOKEN=private"]]){
      expect((await run(["deploy",source,"--name","invalid","--yes",...args])).exit_code).not.toBe(0);expect(readDeployment("invalid")).toBeUndefined();
    }expect(f.credentials).not.toHaveBeenCalled();
    saveDeployment({version:1,name:"unknown",kind:"sandbox",provider:"alicloud-express",status:"requires_recovery",createdAt:"now",updatedAt:"now"});expect((await run(["delete","unknown","--yes"])).exit_code).not.toBe(0);expect(readDeployment("unknown")?.status).toBe("requires_recovery");
  });
});
it("keeps the retired source instance-launch adapter unreachable",async()=>{
  const source=project(),launch=vi.spyOn(deploymentSeams,"launch"),f=native();const result=await run(["deploy",source,"--name","prepared","--yes"]);expect(result.exit_code,result.output).toBe(0);expect(launch).not.toHaveBeenCalled();expect(f.call).toHaveBeenCalled();
});


it("exposes explicit sandbox create and delete without resource deployment state", async () => {
  const create = vi.spyOn(Sandbox, "create").mockResolvedValue({id:"sbx-explicit",status:"running",url:"https://example.test",info:{sandbox_id:"sbx-explicit"}} as unknown as Sandbox);
  const kill = vi.spyOn(Sandbox, "killById").mockResolvedValue(undefined);
  const made = await run(["--json","sandbox","create","--template","tpl-test","--timeout","600","--yes"]);
  expect(made.exit_code,made.output).toBe(0);expect(JSON.parse(made.stdout)).toMatchObject({ID:"sbx-explicit"});
  expect(create.mock.calls[0][0]).toMatchObject({template:"tpl-test",timeout:600});
  expect(readDeployment("sbx-explicit")).toBeUndefined();
  const removed=await run(["sandbox","delete","sbx-explicit","--yes"]);expect(removed.exit_code,removed.output).toBe(0);expect(kill).toHaveBeenCalledWith("sbx-explicit");
});
