/** The named resource selector must reach the existing HTTP create payload unchanged. */
import fs from "node:fs";
import path from "node:path";
import {afterEach, expect, it, vi} from "vitest";
import {cli} from "../../src/cli/main.js";
import {saveDeployment, readDeployment, type Deployment} from "../../src/cli/deployment_store.js";
import {resourceServices} from "../../src/template/resource_executor.js";
import {CliRunner} from "../helpers/cliRunner.js";
import {useHttpxMock} from "../helpers/httpxMock.js";
import {useIso} from "../_support/iso.js";
import {SandboxInfo} from "../../src/models/sandbox.js";
const iso=useIso(), http=useHttpxMock(), base="https://sandbox-fixture.example.test";
afterEach(()=>vi.restoreAllMocks());
it.each([
  ["named",{templateID:"native-template"},"native-template"],
  ["named",{templateID:"reported-template-name"},"reported-template-name"],
  ["named",{},""],
  ["native",{templateID:"native-template"},"native-template"],
  ["native",{templateID:"reported-template-name"},"reported-template-name"],
  ["native",{},""],
] as const)("keeps %s create selection separate from reported metadata %j",async(mode,reported,expected)=>{
  iso.setenv("ABX_SANDBOX_API_KEY","fixture-runtime-key");
  iso.setenv("ABX_SANDBOX_BASE_URL",base);
  const receipt=path.join(iso.root,"resources.json");
  fs.writeFileSync(receipt,JSON.stringify({kind:"ResourceDeployment",version:1,name:"project",accountId:"fixture-account",source:iso.root,status:"ready",resources:[{
    name:"agent",kind:"template",provider:"alicloud-express",region:"cn-hangzhou",team:"fixture-team",id:"native-template",nativeName:"native-template",owned:false,status:"ready",configDigest:"fixture",
  }]}));
  const target={provider:"alicloud-express",region:"cn-hangzhou",team:"fixture-team",providerOptions:{region:"cn-hangzhou",team_id:"fixture-team"},connection:{api_url:base}};
  saveDeployment({version:1,name:"project",kind:"resources",provider:"alicloud-express",status:"ready",createdAt:"now",updatedAt:"now",receipt,resourceTargets:{agent:target}} as Deployment);
  vi.spyOn(resourceServices,"credentials").mockResolvedValue({AccountID:"fixture-account",AccessKeyID:"fixture",AccessKeySecret:"fixture"});
  vi.spyOn(resourceServices,"express").mockReturnValue({call:vi.fn(),team:vi.fn(),ready:vi.fn().mockResolvedValue({templateID:"native-template",teamID:"fixture-team",status:{state:"ready"}})});
  http.add_response({method:"POST",url:`${base}/sandboxes`,status_code:201,json:{sandboxID:"owned-sandbox",state:"running",...reported}});
  const args=mode==="named"?["--template","project","--resource","agent"]:["--template","native-template"];
  const result=await new CliRunner().invoke(cli,["--json","create",...args,"--name","instance","--timeout","120","--yes"]);
  expect(result.exit_code,result.output).toBe(0);
  const request=http.get_request();
  expect(request.method).toBe("POST");
  expect(JSON.parse(Buffer.from(request.content).toString())).toMatchObject({templateID:"native-template",timeout:120});
  expect(JSON.parse(result.stdout)).toMatchObject({sandbox_id:"owned-sandbox",template:expected,status:"running"});
  expect(readDeployment("instance")?.sandboxId).toBe("owned-sandbox");
});
it("uses the existing model's native wire-field precedence when both response spellings exist",()=>{
  expect(SandboxInfo.modelValidate({sandboxID:"id",template:"explicit-field",templateID:"alias-field"}).template).toBe("alias-field");
});
