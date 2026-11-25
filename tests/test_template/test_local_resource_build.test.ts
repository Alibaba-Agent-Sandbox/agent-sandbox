import fs from "node:fs";
import path from "node:path";
import {afterEach, expect, it, vi} from "vitest";
import {useIso} from "../_support/iso.js";
import {buildLocalProject, cachedLocalImage, localBuildRecipe, type LocalBuildServices} from "../../src/template/local_build.js";
import {deployResourceProject, resourceServices, type ResourceServices} from "../../src/template/resource_executor.js";
import {cli} from "../../src/cli/main.js";
import {CliRunner} from "../helpers/cliRunner.js";
const iso = useIso();
afterEach(() => vi.restoreAllMocks());
const id = `sha256:${"a".repeat(64)}`;
function fixture(extra: Record<string, unknown> = {}) {
  const file = path.join(iso.root, "template.yaml");
  fs.mkdirSync(path.join(iso.root, "guest"));
  fs.writeFileSync(path.join(iso.root, "guest", "Dockerfile"), "FROM scratch\nCOPY data /data\n");
  fs.writeFileSync(path.join(iso.root, "guest", "data"), "hello");
  fs.writeFileSync(file, JSON.stringify({specVersion: 1, name: "demo", vars: {unused: "${env('MISSING_RUNTIME_SECRET')}"}, sandbox: {agent: {provider: "alicloud-express", actions: {"pre-deploy": [{run: "never-build-hook"}]}, template: {region: "cn-hangzhou", image: "registry.example.test/app:v1", buildConfig: {dockerfile: "guest/Dockerfile"}}}}, ...extra}));
  const build = vi.fn(async () => "local-tag"), tag = vi.fn(async () => {}), run = vi.fn(async (_input: Parameters<LocalBuildServices["run"]>[0]) => id);
  return {file, services: {docker: {build, tag}, run} as LocalBuildServices, build, tag, run};
}
it("builds only a local image without credentials, runtime-env resolution, hooks or cloud API", async () => {
  const f = fixture(), credentials = vi.spyOn(resourceServices, "credentials").mockRejectedValue(new Error("must not read credentials"));
  const cloud = vi.spyOn(resourceServices, "express");
  const result = await buildLocalProject(f.file, {services: f.services});
  expect(result).toMatchObject({status: "built", images: [{resource: "agent", image_id: id, cached: false}]});
  expect(credentials).not.toHaveBeenCalled(); expect(cloud).not.toHaveBeenCalled();
  expect(f.build).toHaveBeenCalledOnce();
  const [context, , options] = f.build.mock.calls[0] as unknown as [string, string, {dockerfile: string}];
  expect(path.dirname(options.dockerfile)).toBe(context);
  expect(fs.existsSync(context)).toBe(false);
  expect(f.run.mock.calls.every(([input]) => (input as unknown as {argv: string[]}).argv.slice(0,3).join(" ") === "docker image inspect")).toBe(true);
});
it("reuses an immutable image only with matching source and verified actual Docker image ID", async () => {
  const f = fixture(); await buildLocalProject(f.file, {services: f.services});
  expect(await buildLocalProject(f.file, {services: f.services})).toMatchObject({images: [{cached: true}]});
  expect(f.build).toHaveBeenCalledOnce();
  fs.writeFileSync(path.join(iso.root, "guest", "data"), "changed");
  await buildLocalProject(f.file, {services: f.services}); expect(f.build).toHaveBeenCalledTimes(2);
  f.run.mockResolvedValue(`sha256:${"b".repeat(64)}`);
  expect(await cachedLocalImage(localBuildRecipe(iso.root, "agent", "guest/Dockerfile"), f.services)).toBeUndefined();
});
it("rejects escaped build context before executing Docker", async () => {
  const f = fixture(); const value = JSON.parse(fs.readFileSync(f.file, "utf8")); value.sandbox.agent.template.buildConfig.context = "..";fs.writeFileSync(f.file, JSON.stringify(value));
  await expect(buildLocalProject(f.file, {services: f.services})).rejects.toThrow("contained in the template directory");expect(f.build).not.toHaveBeenCalled();
});
it("reports Steps and Serving deferred without claiming they were built", async () => {
  const f = fixture({sandbox: {agent: {provider: "alicloud-express", template: {image: "example.test/base:v1", buildConfig: {steps: [{type: "RUN", args: ["true"]}]}}}}, serving: {api: {component: "serverless-devs/fc3@0.1.26", props: {region: "cn-hangzhou", functionName: "demo", runtime: "nodejs20"}, actions: {"pre-deploy": [{run: "must-not-run"}]}}}});
  const result = await buildLocalProject(f.file, {services: f.services}); expect(result).toMatchObject({status: "no_local_build", images: [], deferred: [{resource: "agent"}, {resource: "api"}]});
  expect(f.build).not.toHaveBeenCalled();expect(f.run).not.toHaveBeenCalled();
});
it("supports the existing v5 Dockerfile source without publishing its template", async () => {
  const f = fixture({specVersion: undefined, spec_version: 5, name: "legacy", provides: {}}); fs.copyFileSync(path.join(iso.root, "guest", "Dockerfile"), path.join(iso.root, "Dockerfile"));
  expect(await buildLocalProject(f.file, {services: f.services})).toMatchObject({status: "built", images: [{resource: "legacy"}]});
});
it("refuses unsupported OpenSandbox resource deployment before parsing secrets or obtaining credentials", async () => {
  const f = fixture({sandbox: {agent: {provider: "opensandbox", template: {reference: "base"}}}});
  const credentials = vi.fn().mockRejectedValue(new Error("credentials were read"));
  await expect(deployResourceProject(f.file, path.join(iso.home, "owned.json"), {services: {...resourceServices, credentials} as ResourceServices})).rejects.toThrow("no named-resource adapter");
  expect(credentials).not.toHaveBeenCalled();expect(fs.existsSync(path.join(iso.home, "owned.json"))).toBe(false);
});
it.each([["template", "build", "--help"], ["deploy", "--help"]])("hides internal build/plan/receipt handoff in public help (%j)", async (...args) => {
  const result = await new CliRunner().invoke(cli, args as string[]); expect(result.exit_code, result.output).toBe(0);
  expect(result.output).not.toMatch(/--out\b|--clean\b|--build\s/);expect(result.output).not.toContain("build.json");
});
