import fs from "node:fs";
import path from "node:path";
import {afterEach, expect, it, vi} from "vitest";
import {useIso} from "../_support/iso.js";
import {deployResourceProject, deleteResourceProject, observeResourceProject, type ResourceServices} from "../../src/template/resource_executor.js";
import {resourceServices} from "../../src/template/resource_executor.js";
import {deployedTemplateSelection} from "../../src/cli/resource_deployment.js";
import {readDeployment, saveDeployment, type Deployment} from "../../src/cli/deployment_store.js";
import {cli} from "../../src/cli/main.js";
import {CliRunner} from "../helpers/cliRunner.js";
import {setCliProvider} from "../../src/providers/selection.js";
const iso = useIso();
afterEach(() => {vi.restoreAllMocks();setCliProvider(null);});
function fixture(reference?: string) {
  const file = path.join(iso.root, "template.yaml"), receipt = path.join(iso.home, "resources.json");
  fs.writeFileSync(file, JSON.stringify({specVersion: 1, name: "demo", sandbox: {agent: {provider: "alicloud-express", template: {region: "cn-hangzhou", ...(reference ? {reference} : {image: "example.test/base:v1"})}}}}));
  let present = true;
  const actual = {templateID: reference ?? "tpl-test", teamID: "team-test", status: {state: "ready"}};
  const call = vi.fn(async (action: string) => {
    if (action === "CreateTemplate") return {templateID: "tpl-test"};
    if (action === "DeleteTemplate") {present = false; return {};}
    if (action === "GetTemplate" && !present) throw {statusCode: 404, code: "TemplateNotFound"};
    return actual;
  });
  const credentials = vi.fn(async () => ({AccountID: "123", AccessKeyID: "placeholder", AccessKeySecret: "placeholder"}));
  const express = vi.fn(() => ({call, team: vi.fn(async () => "team-test"), ready: vi.fn(async () => actual)}));
  const services = {credentials, express, component: vi.fn(), fc: vi.fn(), docker: {build: vi.fn(), tag: vi.fn(), push: vi.fn()}, run: vi.fn()} as unknown as ResourceServices;
  return {file, receipt, services, call, credentials, express};
}
it("deploy registers a static template, never creates a Sandbox instance, and deletes only its own identity", async () => {
  const f = fixture(); const result = await deployResourceProject(f.file, f.receipt, {services: f.services});
  expect(result.status).toBe("ready");expect(f.call.mock.calls.map(([action]) => action)).toEqual(["CreateTemplate"]);
  expect(result.resources).toMatchObject([{name: "agent", kind: "template", id: "tpl-test", owned: true}]);
  await deleteResourceProject(f.receipt, f.services);expect(f.call.mock.calls.map(([action]) => action)).toEqual(["CreateTemplate", "DeleteTemplate", "GetTemplate"]);
});
it("a borrowed reference is queried for readiness, but never created or removed", async () => {
  const f = fixture("borrowed");await deployResourceProject(f.file, f.receipt, {services: f.services});await deleteResourceProject(f.receipt, f.services);
  expect(f.call).not.toHaveBeenCalled();expect(f.express.mock.results[0].value.ready).toHaveBeenCalledWith("template", "borrowed", "team-test", 600);
});
it("reports typed absence without changing recorded readiness or deleting ownership history", async () => {
  const f = fixture();await deployResourceProject(f.file, f.receipt, {services: f.services});const before=fs.readFileSync(f.receipt,"utf8");
  f.call.mockRejectedValue({statusCode: 404, code: "TemplateNotFound"});
  expect(await observeResourceProject(f.receipt, f.services)).toMatchObject({status: "missing", recorded_status: "ready", resources: [{status: "missing", observation: "not_found"}]});
  expect(fs.readFileSync(f.receipt,"utf8")).toBe(before);
});
it.each([401,403,500])("does not treat API error %s as absence", async statusCode => {
  const f = fixture();await deployResourceProject(f.file,f.receipt,{services:f.services});f.call.mockRejectedValue({statusCode,code:"ServiceError"});
  await expect(observeResourceProject(f.receipt,f.services)).rejects.toMatchObject({statusCode});
});
it("preserves pending ownership on failed readiness and refuses blind re-submission", async () => {
  const f=fixture();f.express.mockReturnValue({call:f.call,team:vi.fn(async()=>"team-test"),ready:vi.fn().mockRejectedValue(new Error("not ready"))});
  await expect(deployResourceProject(f.file,f.receipt,{services:f.services})).rejects.toThrow("not ready");
  const saved=JSON.parse(fs.readFileSync(f.receipt,"utf8"));expect(saved).toMatchObject({status:"requires_recovery",resources:[{id:"tpl-test",status:"created"}]});
  // A known created resource can be observed/retried, but is never submitted again.
  await expect(deployResourceProject(f.file,f.receipt,{services:f.services})).rejects.toThrow("not ready");
  expect(f.call.mock.calls.filter(([action])=>action==="CreateTemplate")).toHaveLength(1);
});
it("requires a resource selector when several templates exist and pins native ID, region, account and endpoint", async () => {
  const f=fixture();await deployResourceProject(f.file,f.receipt,{services:f.services});
  const saved=JSON.parse(fs.readFileSync(f.receipt,"utf8"));saved.resources.push({...saved.resources[0],name:"second",id:"tpl-second"});fs.writeFileSync(f.receipt,JSON.stringify(saved));
  const target={provider:"alicloud-express",region:"cn-hangzhou",team:"team-test",providerOptions:{region:"cn-hangzhou"},connection:{api_url:"https://custom.example.test",domain:"custom.example.test"}};
  saveDeployment({version:1,name:"demo",kind:"resources",provider:"alicloud-express",status:"ready",createdAt:"now",updatedAt:"now",receipt:f.receipt,resourceTargets:{agent:target,second:target}} as Deployment);
  vi.spyOn(resourceServices,"credentials").mockImplementation(f.credentials);vi.spyOn(resourceServices,"express").mockImplementation(f.express);
  await expect(deployedTemplateSelection("demo")).rejects.toThrow("agent, second");
  expect(await deployedTemplateSelection("demo","agent")).toEqual({template:"tpl-test",provider:"alicloud-express",provider_options:{region:"cn-hangzhou",team_id:"team-test"},api_url:"https://custom.example.test",domain:"custom.example.test"});
  f.credentials.mockResolvedValue({AccountID:"456",AccessKeyID:"placeholder",AccessKeySecret:"placeholder"});await expect(deployedTemplateSelection("demo","agent")).rejects.toThrow("account differs");
  setCliProvider("opensandbox");await expect(deployedTemplateSelection("demo","agent")).rejects.toThrow("Provider differs");
});

// Presence alone never establishes an FC image/update is ready.
it.each([
  [{state:"Active",lastUpdateStatus:"Successful"},"ready"],
  [{state:"Failed",lastUpdateStatus:"Successful"},"failed"],
  [{state:"Active",lastUpdateStatus:"Failed"},"failed"],
  [{state:"Pending",lastUpdateStatus:"InProgress"},"preparing"],
  [{state:"Active",lastUpdateStatus:"InProgress"},"preparing"],
  [{state:"Active"},"unknown"],
  [{},"unknown"],
])("reports observed FC readiness %j", async (state, status) => {
  const f=fixture();fs.writeFileSync(f.receipt,JSON.stringify({kind:"ResourceDeployment",version:1,name:"demo",accountId:"123",source:iso.root,status:"ready",resources:[{name:"api",kind:"serving",provider:"alicloud-express",region:"cn-hangzhou",id:"acs:fc:cn-hangzhou:123:functions/demo",nativeName:"demo",owned:true,status:"ready",configDigest:"fixture",identity:{functionId:"owned",createdTime:"now"}}]}));
  f.services.fc=vi.fn().mockReturnValue({describeFunction:vi.fn().mockResolvedValue({functionId:"owned",createdTime:"now",...state})});
  expect(await observeResourceProject(f.receipt,f.services)).toMatchObject({status,resources:[{status}]});
});

it("does not mark an observable but failed FC function ready and retains its exact identity", async () => {
  const f=fixture();
  fs.writeFileSync(f.file,JSON.stringify({specVersion:1,name:"demo",serving:{api:{component:"serverless-devs/fc3@0.1.26",props:{region:"cn-hangzhou",functionName:"demo",runtime:"nodejs20"}}}}));
  const describe=vi.fn().mockResolvedValueOnce(undefined).mockResolvedValue({functionArn:"acs:fc:cn-hangzhou:123:functions/demo",functionId:"owned",createdTime:"now",state:"Active",lastUpdateStatus:"Failed"});
  vi.mocked(f.services.component).mockImplementation(async input => {describe.mockResolvedValue({functionArn:"acs:fc:cn-hangzhou:123:functions/demo",functionId:"owned",createdTime:"now",tags:input.props.tags,state:"Active",lastUpdateStatus:"Failed"});});
  f.services.fc=vi.fn().mockReturnValue({describeFunction:describe});
  await expect(deployResourceProject(f.file,f.receipt,{services:f.services})).rejects.toThrow("successful update");
  expect(JSON.parse(fs.readFileSync(f.receipt,"utf8"))).toMatchObject({status:"requires_recovery",resources:[{kind:"serving",status:"created",id:"acs:fc:cn-hangzhou:123:functions/demo",identity:{functionId:"owned",createdTime:"now"}}]});
});

function servingFixture(state: Record<string, unknown> = {}) {
  const f=fixture();
  fs.writeFileSync(f.file,JSON.stringify({specVersion:1,name:"demo",serving:{api:{component:"serverless-devs/fc3@0.1.26",props:{region:"cn-hangzhou",functionName:"demo",runtime:"custom.debian12"}}}}));
  let actual: Record<string, unknown> | null = null;
  const describe=vi.fn(async()=>actual);
  vi.mocked(f.services.component).mockImplementation(async input=>{
    if(input.command==="remove")actual=null;
    else actual={functionArn:"acs:fc:cn-hangzhou:123:functions/demo",functionId:"owned",createdTime:"now",runtime:"custom.debian12",tags:input.props.tags,...state};
    return {};
  });
  f.services.fc=vi.fn().mockReturnValue({describeFunction:describe});
  return {...f,describe};
}
it("records completed publication with omitted runtime state as deployed and preserves unknown observation through CLI status and deletion", async()=>{
  // Actual read-only GetFunction for an existing custom.debian12 function omitted
  // both optional state fields. This fixture does not claim to reproduce the earlier failed nodejs20 deployment.
  const f=servingFixture();
  for(const key of ["credentials","fc","component"] as const)vi.spyOn(resourceServices,key).mockImplementation(f.services[key] as never);
  const runner=new CliRunner();
  const deployed=await runner.invoke(cli,["--json","deploy",iso.root,"--name","demo","--yes"]);
  expect(deployed.exit_code,deployed.output).toBe(0);expect(JSON.parse(deployed.stdout)).toMatchObject({status:"deployed",resources:[{status:"created",owned:true}]});
  expect(readDeployment("demo")?.status).toBe("deployed");
  const observed=await runner.invoke(cli,["--json","status","demo"]);
  expect(observed.exit_code,observed.output).toBe(0);expect(JSON.parse(observed.stdout)).toMatchObject({status:"unknown",recorded_status:"deployed",recovery_required:false});
  const removed=await runner.invoke(cli,["--json","delete","demo","--yes"]);
  expect(removed.exit_code,removed.output).toBe(0);expect(JSON.parse(removed.stdout)).toMatchObject({status:"deleted"});
  expect(readDeployment("demo")?.status).toBe("deleted");
  expect(vi.mocked(f.services.component).mock.calls.map(([input])=>input.command)).toEqual(["deploy","remove"]);
});
it.each([{state:"Active"},{lastUpdateStatus:"Successful"},{state:null,lastUpdateStatus:null}])("allows omitted optional readiness fields after confirmed publication %j",async state=>{
  const f=servingFixture(state);expect((await deployResourceProject(f.file,f.receipt,{services:f.services})).status).toBe("deployed");
});
it.each([{state:"Inactive"},{state:"Unexpected"},{state:"Active",lastUpdateStatus:"Unexpected"},{state:"Failed"},{state:"Pending",lastUpdateStatus:"Failed"}])("does not reinterpret a non-ready explicit native state as deployed %j",async state=>{
  const f=servingFixture(state);await expect(deployResourceProject(f.file,f.receipt,{services:f.services})).rejects.toThrow(/retained for recovery/);
  expect(JSON.parse(fs.readFileSync(f.receipt,"utf8"))).toMatchObject({status:"requires_recovery",resources:[{status:"created"}]});
});
it("keeps pending readiness bounded without resubmitting the component",async()=>{
  const f=servingFixture({state:"Pending",lastUpdateStatus:"InProgress"});
  await expect(deployResourceProject(f.file,f.receipt,{services:f.services,timeoutSeconds:0.001})).rejects.toThrow("remains incomplete");
  expect(f.services.component).toHaveBeenCalledOnce();
});
it.each([{tags:[]},{tags:[{key:"abx-resource-owner",value:"someone-else"}]}])("requires the expected ownership tag before classifying a new function %j",async state=>{
  const f=servingFixture(state);await expect(deployResourceProject(f.file,f.receipt,{services:f.services})).rejects.toThrow("ownership tag");
  expect(JSON.parse(fs.readFileSync(f.receipt,"utf8"))).toMatchObject({status:"requires_recovery",resources:[{status:"pending"}]});
});
it.each([401,403,503])("does not accept post-publication inspection failure %s as deployed",async statusCode=>{
  const f=servingFixture();f.describe.mockResolvedValueOnce(null).mockRejectedValue({statusCode,code:"InspectionFailure"});
  await expect(deployResourceProject(f.file,f.receipt,{services:f.services})).rejects.toMatchObject({statusCode});
  expect(JSON.parse(fs.readFileSync(f.receipt,"utf8"))).toMatchObject({status:"requires_recovery",resources:[{status:"pending"}]});
});
it("does not reinterpret an uncertain component failure or replay its create",async()=>{
  const f=servingFixture();vi.mocked(f.services.component).mockRejectedValue(new Error("component timed out"));
  await expect(deployResourceProject(f.file,f.receipt,{services:f.services})).rejects.toThrow("timed out");
  await expect(deployResourceProject(f.file,f.receipt,{services:f.services})).rejects.toThrow("unresolved");
  expect(f.services.component).toHaveBeenCalledOnce();
});
it("uses a ready Sandbox template when another resource is deployed with unknown readiness",async()=>{
  const f=fixture();await deployResourceProject(f.file,f.receipt,{services:f.services});
  const saved=JSON.parse(fs.readFileSync(f.receipt,"utf8"));saved.status="deployed";
  saved.resources.push({name:"api",kind:"serving",provider:"alicloud-express",region:"cn-hangzhou",id:"acs:fc:cn-hangzhou:123:functions/demo",nativeName:"demo",owned:true,status:"created",configDigest:"fixture",identity:{functionId:"owned",createdTime:"now"}});
  fs.writeFileSync(f.receipt,JSON.stringify(saved));
  saveDeployment({version:1,name:"demo",kind:"resources",provider:"alicloud-express",status:"deployed",createdAt:"now",updatedAt:"now",receipt:f.receipt,resourceTargets:{agent:{provider:"alicloud-express",region:"cn-hangzhou",team:"team-test",providerOptions:{region:"cn-hangzhou"}}}});
  vi.spyOn(resourceServices,"credentials").mockImplementation(f.credentials);vi.spyOn(resourceServices,"express").mockImplementation(f.express);
  expect(await deployedTemplateSelection("demo")).toMatchObject({template:"tpl-test",provider:"alicloud-express"});
});
it("does not adopt a replacement function returned after an owned update",async()=>{
  const f=servingFixture();await deployResourceProject(f.file,f.receipt,{services:f.services});
  f.describe.mockResolvedValueOnce({functionId:"owned",createdTime:"now"}).mockResolvedValue({functionId:"replacement",createdTime:"later"});
  await expect(deployResourceProject(f.file,f.receipt,{services:f.services})).rejects.toThrow("identity");
  const saved=JSON.parse(fs.readFileSync(f.receipt,"utf8"));expect(saved).toMatchObject({status:"requires_recovery",resources:[{status:"pending",identity:{functionId:"owned",createdTime:"now"}}]});
  await expect(deployResourceProject(f.file,f.receipt,{services:f.services})).rejects.toThrow("unresolved");
  expect(f.services.component).toHaveBeenCalledTimes(2);
});

it("keeps a failed image publication unresolved and does not replay cloud writes or actions", async () => {
  const f=fixture(); fs.writeFileSync(path.join(iso.root,"Dockerfile"),"FROM scratch\n");
  fs.writeFileSync(f.file,JSON.stringify({specVersion:1,name:"demo",sandbox:{agent:{provider:"alicloud-express",template:{region:"cn-hangzhou",image:"example.test/image:v1",buildConfig:{dockerfile:"Dockerfile"}}}}}));
  f.services.run=vi.fn().mockResolvedValue(`sha256:${"c".repeat(64)}`);
  vi.mocked(f.services.docker.push).mockRejectedValue(new Error("push failed"));
  await expect(deployResourceProject(f.file,f.receipt,{services:f.services})).rejects.toThrow("push failed");
  expect(JSON.parse(fs.readFileSync(f.receipt,"utf8"))).toMatchObject({status:"requires_recovery",resources:[{kind:"image",status:"pending",owned:false,retain:true}]});
  await expect(deployResourceProject(f.file,f.receipt,{services:f.services})).rejects.toThrow(/recover|reconcile|unresolved/i);
  expect(f.services.docker.push).toHaveBeenCalledOnce(); expect(f.call).not.toHaveBeenCalled();
});
