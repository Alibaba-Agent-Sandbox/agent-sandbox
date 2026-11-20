import {describe, expect, it} from "vitest";
import {planTemplateLaunch, type LaunchProvider} from "../../src/template/launch_plan.mjs";
const provider: LaunchProvider = {id:"alicloud-express",operation_contract_version:1,operations:{cli:["template.prepare","volume.create"],python:["template.prepare"]}};
const manifest = {specVersion:1,name:"example",sandbox:{agent:{provider:"alicloud-express",template:{image:"registry.example.test/base:v1"}}}};
describe("named resource preparation", () => {
  it("requires template preparation without dynamic instance operations or services",()=>{
    expect(planTemplateLaunch(manifest,provider,"cli")).toEqual({supported:true,required_operations:["template.prepare"],missing_operations:[],resources:["agent"]});
  });
  it("does not require template creation for a borrowed reference",()=>{
    expect(planTemplateLaunch({...manifest,sandbox:{agent:{provider:"alicloud-express",template:{reference:"existing"}}}},provider,"cli").required_operations).toEqual([]);
  });
  it("rejects selected provider mismatches",()=>{
    expect(planTemplateLaunch(manifest,{...provider,id:"opensandbox"},"cli").reason).toBe("provider-mismatch");
  });
  it("rejects retired single resource and instance declarations",()=>{
    expect(()=>planTemplateLaunch({specVersion:1,name:"example",sandbox:{template:{source:{dockerfile:"Dockerfile"}},instance:{timeout:300}}},provider,"cli")).toThrow();
  });
});
