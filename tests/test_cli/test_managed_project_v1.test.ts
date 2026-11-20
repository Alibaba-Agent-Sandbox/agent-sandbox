import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { afterEach, expect, it } from "vitest";
import { readManagedProject, writeJson } from "../../src/application/config.js";
import { readProjectIntent } from "../../src/template/project.js";

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) fs.rmSync(dir, {recursive:true,force:true}); });
function source(value: unknown): string {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"abx-resource-admission-")); directories.push(dir);
  const file=path.join(dir,"template.yaml"); fs.writeFileSync(file,stringify(value)); return file;
}
it("rejects retired public managed recipes instead of silently interpreting them as named resources", () => {
  const file=source({specVersion:1,name:"example",application:{type:"agents-api"},deployment:{resources:{}},sandbox:{template:{source:{dockerfile:"Dockerfile"}}}});
  expect(()=>readProjectIntent(file)).toThrow("Template v1");
});
it("keeps the retired private managed manifest adapter out of the new deployment path", () => {
  const file=source({specVersion:1,name:"example",sandbox:{agent:{provider:"alicloud-express",template:{reference:"existing"}}}});
  expect(()=>readManagedProject(file)).toThrow("named sandbox/serving");
});
it("retains credential rejection for internal saved receipts", () => {
  const file=source({});
  expect(()=>writeJson(file,{password:"fixture-private-value"})).toThrow("Credential literals");
});
