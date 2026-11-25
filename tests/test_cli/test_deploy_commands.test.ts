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
import { templateSeams } from "../../src/providers/alicloud_express/cli/template.js";
import { readApiBinding, credentialFingerprint } from "../../src/cli/api_binding.js";
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
  vi.spyOn(deploymentSeams, "checkPrerequisites").mockResolvedValue();
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
  it("creates a named instance with explicit lifecycle and keeps that identity for cleanup", async () => {
    const create=vi.spyOn(Sandbox,"create").mockResolvedValue({id:"sandbox-created",provider:"alicloud-express",status:"running",info:{template:"base"},url:"https://example.test",close:vi.fn()} as never);
    const result=await run(["--json","create","--template","base","--name","created","--on-timeout","pause","--auto-resume","--yes"]);
    expect(result.exit_code,result.output).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({name:"created",sandbox_id:"sandbox-created",status:"running"});
    expect(create.mock.calls[0][0]).toMatchObject({template:"base",lifecycle:{onTimeout:"pause",autoResume:true}});
    const saved=readDeployment("created")!; expect(saved).toMatchObject({sandboxId:"sandbox-created",status:"ready"});
    expect(JSON.parse(fs.readFileSync(saved.journal!,"utf8")).entries).toMatchObject([{id:"sandbox-created",state:"created"}]);
  });
  it("rejects an invalid lifetime combination and retired raw deploy before creation", async () => {
    const create=vi.spyOn(Sandbox,"create");
    expect((await run(["create","--auto-resume","--yes"])).exit_code).not.toBe(0);
    expect((await run(["deploy","--template-id","base","--yes"])).exit_code).not.toBe(0);
    expect(create).not.toHaveBeenCalled();
  });
  it("previews a valid Sandbox without invoking creation, building or writing a deployment", async () => {
    const source = project(), launch = fakeLaunch();
    const result = await run(["--json","deploy",source,"--name","demo","--plan"]);
    expect(result.exit_code,result.output).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({name:"demo",kind:"sandbox",builds_or_cloud_changes:false});
    expect(launch).not.toHaveBeenCalled(); expect(readDeployment("demo")).toBeUndefined();
  });
  it("rejects unavailable Docker before creating a source deployment record", async () => {
    const source = project();
    const docker = vi.spyOn(templateSeams.DockerBuilder.prototype, "checkDocker").mockResolvedValue(false);
    const launch = vi.spyOn(deploymentSeams, "launch");
    const result = await run(["--json", "deploy", source, "--name", "missing-docker", "--yes"]);
    expect(result.exit_code).not.toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ code: "E7020" });
    expect(docker).toHaveBeenCalledOnce();
    expect(launch).not.toHaveBeenCalled();
    expect(readDeployment("missing-docker")).toBeUndefined();
  });

  it("allows a corrected source deployment to reuse a name after preparation recorded no resource intent", async () => {
    const source = project();
    const launch = fakeLaunch();
    launch.mockImplementationOnce(async (_ctx, _params, options) => {
      const journal = new ResourceJournal("alicloud-express", "test");
      await journal.initialize();
      options?.onJournal?.(journal);
      throw new Error("no intent");
    });
    expect((await run(["deploy", source, "--name", "source-retry", "--yes"])).exit_code).not.toBe(0);
    expect(readDeployment("source-retry")).toMatchObject({ effectsStarted: false, status: "deleted" });
    expect((await run(["deploy", source, "--name", "source-retry", "--yes"])).exit_code).toBe(0);
  });

  it("binds the deployed source contract and retains offline help after source removal", async () => {
    const source=project(); fakeLaunch();
    fs.copyFileSync(new URL("../../docs/examples/sandbox-api/registry.yaml",import.meta.url),path.join(source,"registry.yaml"));
    fs.copyFileSync(new URL("../../docs/examples/sandbox-api/openapi.yaml",import.meta.url),path.join(source,"openapi.yaml"));
    const result=await run(["deploy",source,"--name","api-demo","--yes"]);
    expect(result.exit_code,result.output).toBe(0); fs.rmSync(source,{recursive:true,force:true});
    const help=await run(["sandbox","api-demo","--help"]);
    expect(help.exit_code,help.output).toBe(0); expect(help.output).toContain("report_totals");
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
    const result=await run(["create","--template","base","--name","uncertain","--yes"]);
    expect(result.exit_code).not.toBe(0);expect(create).toHaveBeenCalledTimes(1);
    const saved=readDeployment("uncertain")!;expect(saved.status).toBe("requires_recovery");
    const journal=JSON.parse(fs.readFileSync(saved.journal!,"utf8"));expect(journal.entries).toEqual([expect.objectContaining({kind:"sandbox",state:"intent",cleanup:"sandbox.delete"})]);
    expect(create.mock.calls[0][0]).toMatchObject({metadata:{"abx.launch":journal.id,"abx.intent":journal.entries[0].intent_id}});
    expect((await run(["create","--template","base","--name","uncertain","--yes"])).exit_code).not.toBe(0);expect(create).toHaveBeenCalledTimes(1);
  });
  it("retains the known identity when service startup fails", async () => {
    const source=project();
    vi.spyOn(deploymentSeams, "checkPrerequisites").mockResolvedValue();
    vi.spyOn(deploymentSeams,"launch").mockImplementation(async(_ctx,_params,options={})=>{await options.onCreated?.("known-owned");throw new Error("startup");});
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
  it("rejects retired build-file handoff before native admission", async () => {
    const launch = vi.spyOn(deploymentSeams, "launch");
    const result = await run(["deploy", "--build", "private-file", "--name", "rejected", "--yes"]);
    expect(result.exit_code).toBe(2);expect(result.output).toContain("No such option");expect(launch).not.toHaveBeenCalled();expect(readDeployment("rejected")).toBeUndefined();
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

it("Docker scenario passes source directly without any build-file handoff", async () => {
  const module = "../../e2e/scenarios/40-docker-deploy.mjs";
  const {default: docker} = await import(module);
  const source = project(), abx = vi.fn().mockResolvedValueOnce({code: 0, rawJson: () => ({sandbox_id: "sbx-owned", template: "tpl-owned"})}).mockResolvedValueOnce({code: 0, stdout: "deployed-ok"});
  const ctx = {state: {name: "docker-source", source}, abx, beginCreateAttempt: () => "attempt", track: vi.fn(), resolveCreateAttempt: vi.fn(), check: vi.fn(), fail: (message: string) => {throw new Error(message);}};
  await docker.scenarios[1].run(ctx);
  expect(abx.mock.calls[0][0]).toEqual(["--json", "deploy", source, "--name", "docker-source", "--sandbox-timeout", "600", "--yes"]);
});

it("auto-binds only the verified service token source without storing its value in the deployment", async () => {
  const source=project();
  for (const [name,content] of renderScaffold("python","example","alicloud-express")) fs.writeFileSync(path.join(source,name),content);
  const launch=fakeLaunch();
  launch.mockImplementationOnce(async (_ctx,_params,options={}) => {
    await options.onCreated?.("sandbox-test");
    options.onVerifiedApplication?.({port:9000,token:"deployment-private-token"});
    return {receipt:{sandbox_id:"sandbox-test",provider:"alicloud-express",services:{}},creation:{}};
  });
  const result=await new CliRunner().invoke(cli,["--json","deploy",source,"--name","bound-app","--yes"],{env:{ABX_SANDBOX_API_KEY:"test-key",ABX_REGION:"cn-hangzhou",ABX_SERVER_TOKEN:"deployment-private-token"}});
  expect(result.exit_code,result.output).toBe(0);
  expect(readApiBinding("bound-app").credentials).toEqual({"app.token":"config:server_token"});
  expect(readApiBinding("bound-app").credentialFingerprints).toEqual({"app.token":credentialFingerprint("deployment-private-token")});
  expect(JSON.stringify(readDeployment("bound-app"))).not.toContain("deployment-private-token");
  expect(result.output).not.toContain("deployment-private-token");
});
