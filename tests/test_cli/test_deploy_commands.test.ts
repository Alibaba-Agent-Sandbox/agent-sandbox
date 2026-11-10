/** Public deployment behavior, including durable identity before uncertain cloud results. */
import "../_support/isolatedHome.js";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliRunner } from "../helpers/cliRunner.js";
import { useTmpPath } from "../helpers/templateSupport.js";
import { cli } from "../../src/cli/main.js";
import { deploymentSeams } from "../../src/cli/commands/deploy.js";
import { readDeployment, saveDeployment, sandboxTarget } from "../../src/cli/deployment_store.js";
import { renderScaffold } from "../../src/cli/scaffold.js";
import { paths, _setPaths } from "../../src/transport/config_layers.js";
import { ResourceJournal } from "../../src/template/resource_journal.js";
import { Sandbox } from "../../src/api/sandbox.js";
import { sourceDigest } from "../../src/application/config.js";
const tmp = useTmpPath();
const run = (args: string[]) => new CliRunner().invoke(cli, args, {env: {ABX_SANDBOX_API_KEY: "test-key", ABX_REGION: "cn-hangzhou"}});
const oldPaths = {...paths};
beforeEach(() => _setPaths({abxDir: path.join(tmp(), "home")}));
afterEach(() => { vi.restoreAllMocks(); _setPaths(oldPaths); });
function project(): string {
  const folder = path.join(tmp(), "project"); fs.mkdirSync(folder);
  for (const [name, content] of renderScaffold("minimal", "example", "alicloud-express")) fs.writeFileSync(path.join(folder, name), content);
  return folder;
}
function fakeLaunch() {
  return vi.spyOn(deploymentSeams, "launch").mockImplementation(async (_ctx, params, options = {}) => {
    expect(fs.existsSync(String(params.template_ref))).toBe(true);
    options.onTarget?.({provider:"alicloud-express",providerOptions:{region:"cn-hangzhou"},connection:{api_url:"https://example.test",domain:"example.test"}});
    const journal = new ResourceJournal("alicloud-express", "test"); options.onJournal?.(journal);
    const intent = await journal.intent({kind:"sandbox",correlation_key:"demo-test",cleanup:"sandbox.delete"});
    await journal.created(intent, "sandbox-test"); await options.onCreated?.("sandbox-test");
    return {receipt:{sandbox_id:"sandbox-test",provider:"alicloud-express",services:{}},creation:{}};
  });
}
describe("unified deploy", () => {
  it("previews a valid Sandbox without invoking creation, building or writing a deployment", async () => {
    const source = project(), launch = fakeLaunch();
    const result = await run(["--json","deploy",source,"--name","demo","--plan"]);
    expect(result.exit_code,result.output).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({name:"demo",kind:"sandbox",builds_or_cloud_changes:false});
    expect(launch).not.toHaveBeenCalled(); expect(readDeployment("demo")).toBeUndefined();
  });
  it("rejects an invalid manifest during preview", async () => {
    const source=project(); fs.writeFileSync(path.join(source,"template.yaml"),"name: example\nspec_version: 999\n");
    expect((await run(["deploy",source,"--plan"])).exit_code).not.toBe(0);
  });
  it("creates one named Sandbox, pins the resolved connection and preserves user source", async () => {
    const source=project(), before=sourceDigest(source); fs.writeFileSync(path.join(source,".env"),"PRIVATE=do-not-copy\n");
    const launch=fakeLaunch(); const result=await run(["--json","deploy",source,"--name","demo","--yes"]);
    expect(result.exit_code,result.output).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({name:"demo",sandbox_id:"sandbox-test",status:"ready"});
    expect(launch).toHaveBeenCalledTimes(1); expect(sourceDigest(source)).toBe(before);
    const saved=readDeployment("demo")!; expect(fs.existsSync(path.join(saved.source!,".env"))).toBe(false);
    expect(sandboxTarget("demo")).toMatchObject({id:"sandbox-test",api_url:"https://example.test",provider_options:{region:"cn-hangzhou"}});
    expect((await run(["deploy",source,"--name","demo","--yes"])).exit_code).not.toBe(0); expect(launch).toHaveBeenCalledTimes(1);
    saved.status="deleted";saveDeployment(saved);
    expect((await run(["deploy",source,"--name","demo","--yes"])).exit_code).toBe(0); expect(launch).toHaveBeenCalledTimes(2);
  });
  it("keeps an uncertain native create intent without retrying the cloud operation", async () => {
    const create=vi.spyOn(Sandbox,"create").mockRejectedValue(new Error("unknown-result"));
    const result=await run(["deploy","--template-id","base","--name","uncertain","--yes"]);
    expect(result.exit_code).not.toBe(0);expect(create).toHaveBeenCalledTimes(1);
    const saved=readDeployment("uncertain")!;expect(saved.status).toBe("requires_recovery");
    const journal=JSON.parse(fs.readFileSync(saved.journal!,"utf8"));expect(journal.entries).toEqual([expect.objectContaining({kind:"sandbox",state:"intent",cleanup:"sandbox.delete"})]);
    expect(create.mock.calls[0][0]).toMatchObject({metadata:{"abx.launch":journal.id,"abx.intent":journal.entries[0].intent_id}});
    expect((await run(["deploy","--template-id","base","--name","uncertain","--yes"])).exit_code).not.toBe(0);expect(create).toHaveBeenCalledTimes(1);
  });
  it("retains the known identity when service startup fails", async () => {
    const source=project();vi.spyOn(deploymentSeams,"launch").mockImplementation(async(_ctx,_params,options={})=>{await options.onCreated?.("known-owned");throw new Error("startup");});
    expect((await run(["deploy",source,"--name","failed","--yes"])).exit_code).not.toBe(0);
    expect(readDeployment("failed")).toMatchObject({sandboxId:"known-owned",status:"requires_recovery"});
  });
  it("rejects non-ready build artifacts and source drift before deployment", async () => {
    const source=project(),file=path.join(tmp(),"build.json"), launch=fakeLaunch();
    fs.writeFileSync(file,JSON.stringify({kind:"SandboxTemplateBuild",status:"building",projectRoot:source,sourceDigest:sourceDigest(source)}));
    expect((await run(["deploy","--build",file,"--yes"])).exit_code).not.toBe(0);expect(launch).not.toHaveBeenCalled();
    fs.writeFileSync(file,JSON.stringify({kind:"SandboxTemplateBuild",status:"ready",prepared:{},projectRoot:source,sourceDigest:"changed"}));
    expect((await run(["deploy","--build",file,"--yes"])).exit_code).not.toBe(0);expect(launch).not.toHaveBeenCalled();
  });
  it("releases a borrowed build after real admission rejects its Provider identity before resource requests", async () => {
    const source = project(), file = path.join(tmp(), "build.json");
    fs.writeFileSync(file, JSON.stringify({kind:"SandboxTemplateBuild",version:1,status:"ready",provider:"alicloud-express",projectRoot:source,sourceDigest:sourceDigest(source),prepared:{reference:"base",status:"ready"},target:{provider:"alicloud-express",providerOptions:{},connection:{},provider_digest:"different-code"}}));
    const result = await run(["deploy", "--build", file, "--name", "rejected", "--yes"]);
    expect(result.exit_code).not.toBe(0);
    expect(result.output).toContain("Build target or Provider implementation differs");
    expect(readDeployment("rejected")).toMatchObject({effectsStarted:false,status:"requires_recovery"});
    expect(JSON.parse(fs.readFileSync(file,"utf8")).consumers).toHaveLength(1);
    const removed = await run(["delete", "rejected", "--yes"]);
    expect(removed.exit_code,removed.output).toBe(0);
    expect(readDeployment("rejected")?.status).toBe("deleted");
    expect(JSON.parse(fs.readFileSync(file,"utf8")).consumers).toEqual([]);
  });
  it("keeps unknown records and rejects duplicate mounts or missing upload before admission", async () => {
    const source = project(), launch = fakeLaunch();
    for (const args of [["--volume-mount","/data=one","--volume-mount","/data=two"],["--upload",path.join(tmp(),"missing")]]) {
      expect((await run(["deploy",source,"--name","invalid","--yes",...args])).exit_code).not.toBe(0);
      expect(readDeployment("invalid")).toBeUndefined();
    }
    expect(launch).not.toHaveBeenCalled();
    saveDeployment({version:1,name:"unknown",kind:"sandbox",provider:"alicloud-express",status:"requires_recovery",createdAt:"now",updatedAt:"now"});
    expect((await run(["delete","unknown","--yes"])).exit_code).not.toBe(0);
    expect(readDeployment("unknown")?.status).toBe("requires_recovery");
  });
});

// Exercise the actual Docker harness argv through the public parser and build admission.
it("Docker scenario reaches borrowed-build Provider admission without a redundant source", async () => {
  const module = "../../e2e/scenarios/40-docker-deploy.mjs";
  const { default: docker } = await import(module);
  const source = project(), file = path.join(tmp(), "docker-build.json");
  fs.writeFileSync(file, JSON.stringify({kind:"SandboxTemplateBuild",version:1,status:"ready",provider:"alicloud-express",projectRoot:source,sourceDigest:sourceDigest(source),prepared:{reference:"base",status:"ready"},target:{provider:"alicloud-express",providerOptions:{},connection:{},provider_digest:"different-code"}}));
  let output = "";
  const abx = vi.fn(async (argv: string[]) => {
    const response = await run(argv); output = response.output;
    return {code:response.exit_code,out:response.output,rawJson:()=>JSON.parse(response.stdout)};
  });
  const ctx = {state:{name:"docker-admission",source,build:file},abx,beginCreateAttempt:()=>"attempt",track:vi.fn(),resolveCreateAttempt:vi.fn(),fail:(message:string)=>{throw new Error(message);}};
  await expect(docker.scenarios[1].run(ctx)).rejects.toThrow("create exit");
  expect(abx).toHaveBeenCalledOnce();
  expect(output, output).toContain("Build target or Provider implementation differs");
  expect(output).not.toContain("omit SOURCE");
  expect(readDeployment("docker-admission")).toMatchObject({effectsStarted:false,status:"requires_recovery"});
});
