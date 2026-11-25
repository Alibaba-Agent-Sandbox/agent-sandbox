/** Remote source copying and execution validation are separate boundaries. */
import fs from "node:fs";
import path from "node:path";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {useIso} from "../_support/iso.js";
import {cli} from "../../src/cli/main.js";
import {CliRunner} from "../helpers/cliRunner.js";
import {RegistryClient, _setTemplateCacheDir} from "../../src/utils/registry.js";
import {TemplateIndex, TemplateIndexEntry} from "../../src/utils/template_index.js";
import * as index from "../../src/utils/template_index.js";
import {resourceServices} from "../../src/template/resource_executor.js";
import {resourceDeploymentSeams} from "../../src/cli/resource_deployment.js";
import {readDeployment} from "../../src/cli/deployment_store.js";

const iso=useIso(), revision="a".repeat(40), source=`example/native//agent@${revision}`;
let previousCache:string;
beforeEach(()=>{previousCache=_setTemplateCacheDir(path.join(iso.home,"templates"));});
afterEach(()=>{vi.restoreAllMocks();_setTemplateCacheDir(previousCache);});
function remoteSource(invalid=false) {
  const document={specVersion:1,name:"remote-demo",sandbox:{agent:{provider:"alicloud-express",template:{region:"cn-hangzhou",image:"registry.example.test/base:v1",...(invalid?{unrecognizedSetting:true}:{})}}}};
  const downloaded=vi.spyOn(RegistryClient.prototype,"_downloadAndExtract").mockImplementation(async(_url,destination)=>{
    fs.mkdirSync(destination,{recursive:true});fs.writeFileSync(path.join(destination,"template.yaml"),JSON.stringify(document));
  });
  vi.spyOn(index,"fetchIndex").mockResolvedValue(new TemplateIndex({entries:[new TemplateIndexEntry({name:"remote-demo",repo:"https://github.com/example/native",path:"agent",ref:revision})]}));
  return downloaded;
}

it.each([source,"remote-demo"])("previews resource v1 acquired through %s without credentials or cloud writes",async reference=>{
  const download=remoteSource(), credentials=vi.spyOn(resourceServices,"credentials"), deploy=vi.spyOn(resourceDeploymentSeams,"deploy");
  const result=await new CliRunner().invoke(cli,["--json","deploy",reference,"--name","preview","--plan"]);
  expect(result.exit_code,result.output).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({name:"preview",createsDynamicInstances:false,builds_or_cloud_changes:false,resources:[{name:"agent",kind:"sandbox"}]});
  expect(download).toHaveBeenCalledOnce();expect(download.mock.calls[0][0]).toContain(`/tarball/${revision}`);
  expect(credentials).not.toHaveBeenCalled();expect(deploy).not.toHaveBeenCalled();expect(readDeployment("preview")).toBeUndefined();
});

it("deploys a catalog resource through the same strict resource executor without creating an instance",async()=>{
  remoteSource();
  vi.spyOn(resourceServices,"credentials").mockResolvedValue({AccountID:"123",AccessKeyID:"fixture",AccessKeySecret:"fixture"});
  const call=vi.fn().mockResolvedValue({templateID:"tpl-remote"});
  vi.spyOn(resourceServices,"express").mockReturnValue({call,team:async()=>"team-remote",ready:async()=>({templateID:"tpl-remote",teamID:"team-remote",status:{state:"ready"}})} as never);
  const result=await new CliRunner().invoke(cli,["--json","deploy","remote-demo","--name","deployed","--yes"]);
  expect(result.exit_code,result.output).toBe(0);
  expect(call.mock.calls.map(([action])=>action)).toEqual(["CreateTemplate"]);
  expect(JSON.parse(result.stdout)).toMatchObject({name:"deployed",kind:"resources",creates_instances:false,resources:[{id:"tpl-remote",kind:"template"}]});
  expect(readDeployment("deployed")).toMatchObject({status:"ready",resourceTargets:{agent:{region:"cn-hangzhou",team:"team-remote"}}});
});

it.each([["deploy",source,"--yes"],["template","build",source]])("rejects an invalid downloaded resource before any credential or build action: %j",async (...args)=>{
  remoteSource(true);const credentials=vi.spyOn(resourceServices,"credentials"), cloud=vi.spyOn(resourceServices,"express");
  const result=await new CliRunner().invoke(cli,args);
  expect(result.exit_code).not.toBe(0);expect(result.output).toMatch(/Template v1 \/sandbox\/agent\/template:.*additionalProperties/);
  expect(credentials).not.toHaveBeenCalled();expect(cloud).not.toHaveBeenCalled();expect(readDeployment("remote-demo")).toBeUndefined();
});
