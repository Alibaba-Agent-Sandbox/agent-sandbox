import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDevsProject } from "../../src/template/devs_project.js";
import { resourcePlan } from "../../src/template/resource_plan.js";
import type { TemplateV1 } from "../../src/template/contract-v1/normalize.mjs";

const folders: string[] = [];
function project(): { root: string; file: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "abx-devs-test-")); folders.push(root);
  const file = path.join(root, "template.yaml"); fs.writeFileSync(file, "specVersion: 1\n");
  return { root, file };
}
const api = (props: Record<string,unknown>) => ({component:"serverless-devs/fc3@0.1.26",props});
afterEach(() => { for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true }); });

describe("official native Devs project resolution", () => {
  it("preserves string scalars and multiline content through the actual native parser", () => {
    const { file } = project();
    const literals = { FLAG: "on", WHEN: "2026-11-12", LEADING_ZERO: "0123", MULTILINE: "first line\nsecond line\n" };
    const value = resolveDevsProject({ specVersion: 1, name: "scalars", vars: {memory:4096}, serving: {api:api({memorySize:"${vars.memory}",environmentVariables:{...literals, FROM_ENV:"${env('ABX_TEST_WIRE_STRING')}"}})} }, file, { ...process.env, ABX_TEST_WIRE_STRING: "2026-11-12" });
    expect(value.document.serving).toEqual({api:api({memorySize:4096,environmentVariables:{...literals,FROM_ENV:"2026-11-12"}})});
  });
  it("resolves native vars and private values without renaming FC props", () => {
    const { file } = project();
    const value = resolveDevsProject({specVersion:1,name:"test",vars:{model:"fixture-model"},serving:{api:api({memorySize:4096,environmentVariables:{MODEL:"${vars.model}",API_KEY:"${env('ABX_TEST_MODEL_KEY')}"}})}},file,{...process.env,ABX_TEST_MODEL_KEY:"private-fixture-value"});
    expect(value.document.serving).toEqual({api:api({memorySize:4096,environmentVariables:{MODEL:"fixture-model",API_KEY:"private-fixture-value"}})});
  });
  it("preserves output references for the resource planner dependency order", () => {
    const { file } = project();
    const value=resolveDevsProject({specVersion:1,name:"test",serving:{domain:{component:"serverless-devs/fc3-domain@0.0.29",props:{target:"${resources.api.output.endpoint}"}},api:api({memorySize:4096})}},file);
    expect(resourcePlan(value.document as unknown as TemplateV1).map(step=>step.name)).toEqual(["api","domain"]);
    expect(value.document.serving).toMatchObject({domain:{props:{target:"${resources.api.output.endpoint}"}}});
  });
  it("resolves relative native file references from the actual project directory", () => {
    const { root, file }=project();fs.writeFileSync(path.join(root,"values.json"),JSON.stringify({model:"relative-fixture"}));
    const value=resolveDevsProject({specVersion:1,name:"test",vars:{model:"${json(file('./values.json')).model}"},serving:{api:api({environmentVariables:{MODEL:"${vars.model}"}})}},file);
    expect(value.document.serving).toEqual({api:api({environmentVariables:{MODEL:"relative-fixture"}})});
  });
  it("contains dotenv changes in the child instead of modifying the CLI environment", () => {
    const {root,file}=project(),key="ABX_TEST_DEVS_DOTENV",before=process.env[key];fs.writeFileSync(path.join(root,".env"),`${key}=child-only\n`);
    const value=resolveDevsProject({specVersion:1,name:"test",vars:{value:"${env('ABX_TEST_DEVS_DOTENV')}"}},file);
    expect(value.document.vars).toEqual({value:"child-only"});expect(process.env[key]).toBe(before);
  });
  it("resolves private configuration from its original source after a secret-free snapshot", () => {
    const original=project(),snapshot=project();fs.writeFileSync(path.join(original.root,".env"),"ABX_TEST_SNAPSHOT_MODEL_KEY=private-snapshot-fixture\n");
    const document={specVersion:1,name:"test",serving:{api:api({environmentVariables:{API_KEY:"${env('ABX_TEST_SNAPSHOT_MODEL_KEY')}"}})}};
    fs.copyFileSync(original.file,snapshot.file);expect(fs.existsSync(path.join(snapshot.root,".env"))).toBe(false);
    const value=resolveDevsProject(document,snapshot.file,process.env,{configurationSource:original.root});
    expect(value.document.serving).toEqual({api:api({environmentVariables:{API_KEY:"private-snapshot-fixture"}})});
    expect(fs.readFileSync(snapshot.file,"utf8")).not.toContain("private-snapshot-fixture");expect(process.env.ABX_TEST_SNAPSHOT_MODEL_KEY).toBeUndefined();
  });
  it("reports a missing environment name and field path without exposing resolved values", () => {
    const {file}=project(),environment={...process.env};delete environment.ABX_TEST_MISSING_MODEL;
    const raw={specVersion:1,name:"test",serving:{api:api({environmentVariables:{API_KEY:"${env('ABX_TEST_MISSING_MODEL')}",OTHER:"private-fixture-value"}})}};
    let message="";try{resolveDevsProject(raw,file,environment);}catch(error){message=(error as Error).message;}
    expect(message).toContain("ABX_TEST_MISSING_MODEL");expect(message).toContain("/serving/api/props/environmentVariables/API_KEY");expect(message).not.toContain("private-fixture-value");
  });
  it("lists resource actions and never executes them while parsing", () => {
    const {root,file}=project(),marker=path.join(root,"must-not-exist"),actions={"pre-deploy":[{run:`touch ${marker}`}]};
    const value=resolveDevsProject({specVersion:1,name:"test",serving:{api:{...api({}),actions}}},file);
    expect(value.actions).toEqual([{scope:"resource",resource:"api",definition:actions}]);expect(fs.existsSync(marker)).toBe(false);
  });
});
