import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { readProjectIntent, resolveProject, sandboxExecutionInput } from "../../src/template/project.js";
import { loadTemplateFromYaml } from "../../src/utils/registry.js";

const folders: string[] = [];
function write(value: unknown): { root: string; file: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "abx-project-v1-")); folders.push(root);
  const file = path.join(root, "template.yaml"); fs.writeFileSync(file, stringify(value)); return { root, file };
}
afterEach(() => { for (const root of folders.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const source = () => ({ specVersion: 1, name: "example", sandbox: { template: { source: { dockerfile: "Dockerfile" }, props: { cpu: 2, memory: 2048 } }, instance: { envs: { MODEL_KEY: "${env('ABX_TEST_STATIC_MISSING_KEY')}" } }, services: {} } });

describe("canonical template v1 consumer boundary", () => {
  it("loads source intent and Registry acquisition without requiring secrets or a Registry descriptor", () => {
    const { root, file } = write(source());
    expect(fs.existsSync(path.join(root, "registry.yaml"))).toBe(false);
    expect(readProjectIntent(file).sandbox?.provider).toBeUndefined();
    expect(loadTemplateFromYaml(file).name).toBe("example");
    expect(loadTemplateFromYaml(file).env.MODEL_KEY).toBe("${env('ABX_TEST_STATIC_MISSING_KEY')}");
  });

  it("uses the same owner schema and native resolution for actual instance input", () => {
    const document = source(), { file } = write(document);
    const value = resolveProject(file, { provider: "alicloud-express", environment: { ...process.env, ABX_TEST_STATIC_MISSING_KEY: "private-fixture" } });
    expect(value.compiled.provider).toBe("alicloud-express");
    expect(value.compiled.env).toEqual({ MODEL_KEY: "private-fixture" });
    expect(value.compiled.resources).toMatchObject({ cpu: 2, memory: 2048 });
    const bytes = fs.readFileSync(file, "utf8");
    expect(bytes).toContain("specVersion: 1");
    expect(bytes).not.toContain("private-fixture");
    expect(bytes).not.toContain("spec_version");
  });

  it("rejects old public formats and a v1 version spelling on old resource structure", () => {
    const old = write({ name: "old", spec_version: 5, provides: {} });
    expect(() => loadTemplateFromYaml(old.file)).toThrow("specVersion: 1");
    const renamed = write({ name: "old", specVersion: 1, provides: {} });
    expect(() => loadTemplateFromYaml(renamed.file)).toThrow("Template v1");
  });

  it("rejects a wrong stage or conflicting Provider before native resolution", () => {
    const wrong = source() as Record<string, unknown>; (wrong.sandbox as Record<string, unknown>).cpu = 2;
    expect(() => readProjectIntent(write(wrong).file)).toThrow("Template v1");
    const value = source() as Record<string, unknown>; (value.sandbox as Record<string, unknown>).provider = "opensandbox";
    expect(() => resolveProject(write(value).file, { provider: "alicloud-express" })).toThrow("conflicts");
  });

  it("keeps the locked executor adapter private and never rewrites the resource file", () => {
    const { file } = write(source()), before = fs.readFileSync(file, "utf8");
    const input = sandboxExecutionInput(readProjectIntent(file));
    expect(input).not.toHaveProperty("spec_version");
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("admits and compiles mixed resource intent without asserting a deployment lifecycle", () => {
    const value = { ...source(), deployment: {edition: "3.0.0", name: "native", resources: {api: {component: "fc3@0.1.26", props: {region: "cn-hangzhou"}}}} }, {file} = write(value);
    const result = resolveProject(file, {provider: "alicloud-express", environment: {...process.env, ABX_TEST_STATIC_MISSING_KEY: "fixture"}});
    expect(result.compiled.kind).toBe("serving"); expect(result.compiled.sandbox).toBeDefined(); expect(result.compiled.deployment?.resources.api).toBeDefined();
  });
});
