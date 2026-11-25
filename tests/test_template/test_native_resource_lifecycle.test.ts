import fs from "node:fs";
import path from "node:path";
import {afterEach, expect, it, vi} from "vitest";
import {useIso} from "../_support/iso.js";
import {deployResourceProject, deleteResourceProject, observeResourceProject, type ResourceServices} from "../../src/template/resource_executor.js";
import {resourceServices} from "../../src/template/resource_executor.js";
import {deployedTemplateSelection} from "../../src/cli/resource_deployment.js";
import {saveDeployment, type Deployment} from "../../src/cli/deployment_store.js";
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
  f.services.fc=vi.fn().mockReturnValue({describeFunction:describe});
  await expect(deployResourceProject(f.file,f.receipt,{services:f.services})).rejects.toThrow("successful update");
  expect(JSON.parse(fs.readFileSync(f.receipt,"utf8"))).toMatchObject({status:"requires_recovery",resources:[{kind:"serving",status:"created",id:"acs:fc:cn-hangzhou:123:functions/demo",identity:{functionId:"owned",createdTime:"now"}}]});
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
