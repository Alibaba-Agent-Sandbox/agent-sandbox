import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {resourcePlan, resourceValues} from "../../src/template/resource_plan.js";
import {deployResourceProject, deleteResourceProject, loadResourceProject, previewResourceProject, type ResourceServices} from "../../src/template/resource_executor.js";
import {templateRequest} from "../../src/providers/alicloud_express/resource_api.js";
const roots: string[] = [];
afterEach(() => {for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true});});
function project(value: unknown) {const root = fs.mkdtempSync(path.join(os.tmpdir(), "abx-resource-test-")); roots.push(root);const file = path.join(root, "template.yaml");fs.writeFileSync(file, JSON.stringify(value));return {root, file, receipt: path.join(root, "receipt.json")};}
const sandbox = {provider: "alicloud-express", template: {region: "cn-hangzhou", image: "example.com/base:v1", generation: 2}};
function services() {
  let present = true;
  const call = vi.fn(async (action: string) => {
    if (action === "CreateTemplate") return {templateID: "tpl-test"};
    if (action === "DeleteTemplate") {present = false; return {};}
    if (action === "GetTemplate" && !present) throw {statusCode: 404, code: "TemplateNotFound"};
    return {templateID: "tpl-test", status: {state: "ready"}};
  });
  const result = {credentials: vi.fn(async () => ({AccountID: "123", AccessKeyID: "placeholder", AccessKeySecret: "placeholder"})), express: vi.fn(() => ({call, team: vi.fn(async () => "team-test"), ready: vi.fn(async () => ({}))})),
    component: vi.fn(async (_input: Parameters<ResourceServices["component"]>[0]) => ({})), fc: vi.fn(), docker: {build: vi.fn(), push: vi.fn()}, run: vi.fn(async (_input: {argv: string[]}) => "")};
  return {services: result as unknown as ResourceServices, call, mocks: result};
}
describe("named-resource execution", () => {
  it("keeps omitted native properties omitted and maps steps without native buildConfig", () => {
    expect(templateRequest({...sandbox.template, buildConfig: {steps: [{type: "RUN", args: ["true"]}]}, resourceTags: [{key: "project", value: "demo"}]}, "name", "team")).toEqual({name: "name", teamID: "team", resourceTags: [{key: "project", value: "demo"}], runtimeConfig: {sandboxConfig: {image: sandbox.template.image, generation: 2, steps: [{type: "RUN", args: ["true"]}]}}});
  });
  it("uses actual native vars/env parsing and leaves output references deferred", () => {
    const p = project({specVersion: 1, name: "demo", vars: {zone: "cn-hangzhou", image: "${env('TEST_RESOURCE_IMAGE')}"}, sandbox: {agent: {...sandbox, template: {...sandbox.template, region: "${vars.zone}", image: "${vars.image}"}}}, serving: {api: {component: "serverless-devs/fc3@0.1.26", props: {region: "${vars.zone}", functionName: "api", runtime: "nodejs20", environmentVariables: {TEMPLATE: "${resources.agent.output.templateId}"}}}}});
    const result = loadResourceProject(p.file, {...process.env, TEST_RESOURCE_IMAGE: "example.com/from-env:v1"});
    expect(result.sandbox!.agent.template.image).toBe("example.com/from-env:v1");
    expect(resourcePlan(result).map(value => value.name)).toEqual(["agent", "api"]);
    expect(resourceValues(result.serving!.api.props, {agent: {templateId: "ready-id"}}).environmentVariables).toEqual({TEMPLATE: "ready-id"});
  });
  it("preserves whole output types and never evaluates output strings as expressions", () => {
    expect(resourceValues("${resources.agent.output.value}", {agent: {value: {literal: "${env('DO_NOT_READ')}"}}})).toEqual({literal: "${env('DO_NOT_READ')}"});
  });
  it("rejects absent producers and dependency cycles", () => {
    expect(() => resourcePlan({specVersion: 1, name: "demo", sandbox: {agent: {...sandbox, template: {...sandbox.template, image: "${resources.missing.output.image}"}}}})).toThrow("Unknown resource");
    expect(() => resourcePlan({specVersion: 1, name: "demo", sandbox: {agent: {...sandbox, template: {...sandbox.template, image: "${resources.agent.output.image}"}}}})).toThrow("cycle");
  });
  it("previews resource preparation without reading missing environment variables", () => {
    const p = project({specVersion: 1, name: "demo", sandbox: {agent: {...sandbox, template: {...sandbox.template, image: "${env('UNSET_RESOURCE_IMAGE')}"}}}});
    expect(previewResourceProject(p.file).createsDynamicInstances).toBe(false);
  });
  it("registers then waits before success action and deletes only owned templates", async () => {
    const p = project({specVersion: 1, name: "demo", sandbox: {agent: {...sandbox, actions: {"success-deploy": [{run: "echo ${resources.agent.output.templateId}"}]}}}});
    const f = services();
    const receipt = await deployResourceProject(p.file, p.receipt, {services: f.services});
    expect(receipt.status).toBe("ready");
    expect(f.mocks.run.mock.calls[0][0].argv.at(-1)).toBe("echo tpl-test");
    expect(f.call.mock.calls.map(value => value[0])).toEqual(["CreateTemplate"]);
    expect((await deleteResourceProject(p.receipt, f.services)).status).toBe("deleted");
  });
  it("does not create, update or delete a borrowed template", async () => {
    const p = project({specVersion: 1, name: "demo", sandbox: {agent: {provider: "alicloud-express", template: {region: "cn-hangzhou", reference: "borrowed-id"}}}});
    const f = services();await deployResourceProject(p.file, p.receipt, {services: f.services});await deleteResourceProject(p.receipt, f.services);
    expect(f.call).not.toHaveBeenCalled();
  });
  it("retains submitted identity when readiness fails and always runs completion", async () => {
    const p = project({specVersion: 1, name: "demo", sandbox: {agent: {...sandbox, actions: {"fail-deploy": [{run: "false"}], "complete-deploy": [{run: "true"}]}}}});
    const f = services();f.mocks.express.mockImplementation(() => ({call: f.call, team: vi.fn(async () => "team-test"), ready: vi.fn(async () => {throw new Error("original readiness failure");})}));
    f.mocks.run.mockRejectedValueOnce(new Error("secondary failure"));
    await expect(deployResourceProject(p.file, p.receipt, {services: f.services})).rejects.toThrow("original readiness failure");
    const receipt = JSON.parse(fs.readFileSync(p.receipt, "utf8"));expect(receipt.resources[0].id).toBe("tpl-test");expect(receipt.status).toBe("requires_recovery");expect(f.mocks.run).toHaveBeenCalledTimes(2);
  });
  it("rejects all unsupported adapters before any resource action", async () => {
    const p = project({specVersion: 1, name: "demo", sandbox: {agent: {...sandbox, provider: "other-provider"}}});const f = services();
    await expect(deployResourceProject(p.file, p.receipt, {services: f.services})).rejects.toThrow();expect(f.mocks.credentials).not.toHaveBeenCalled();
  });
  it("refreshes dotenv written by a preceding action before deploying dependent Serving", async () => {
    const p = project({specVersion: 1, name: "demo", sandbox: {agent: {...sandbox, actions: {"pre-deploy": [{run: "prepare-private-config"}]}}}, serving: {api: {component: "serverless-devs/fc3@0.1.26", props: {region: "cn-hangzhou", functionName: "demo-api", runtime: "nodejs20", environmentVariables: {REVISION: "${env('RESOURCE_TEST_REVISION', 'pending')}", TEMPLATE: "${resources.agent.output.templateId}"}}}}});
    const f = services(); let actual: Record<string, unknown> | null = null;
    f.mocks.run.mockImplementation(async () => {fs.writeFileSync(path.join(p.root, ".env"), "RESOURCE_TEST_REVISION=prepared-revision\n"); return "";});
    f.mocks.fc.mockReturnValue({describeFunction: async () => actual});
    f.mocks.component.mockImplementation(async (input) => {expect(input.props.environmentVariables).toEqual({REVISION: "prepared-revision", TEMPLATE: "tpl-test"}); expect(input.functionCreationGuard).toEqual({endpoint: "https://fcv3.cn-hangzhou.aliyuncs.com", functionName: "demo-api"}); actual = {functionArn: "acs:fc:cn-hangzhou:123:functions/demo-api", functionId: "native-1", createdTime: "2026-01-01"}; return {};});
    expect((await deployResourceProject(p.file, p.receipt, {services: f.services})).status).toBe("ready");
    expect(process.env.RESOURCE_TEST_REVISION).toBeUndefined();
  });
  it.each([
    {buildOnly: true, buildFails: false}, {buildOnly: true, buildFails: true},
    {buildOnly: false, buildFails: false}, {buildOnly: false, buildFails: true},
  ])("separates Serving build from deploy hooks (buildOnly=$buildOnly, buildFails=$buildFails)", async ({buildOnly, buildFails}) => {
    const p = project({specVersion: 1, name: "demo", serving: {api: {
      component: "serverless-devs/fc3@0.1.26",
      props: {region: "cn-hangzhou", functionName: "demo-api", runtime: "nodejs20"},
      actions: {"pre-deploy": [{component: "serverless-devs/fc3@0.1.26 build"}],
        "success-deploy": [{run: "success-hook"}], "fail-deploy": [{run: "failure-hook"}], "complete-deploy": [{run: "completion-hook"}]},
    }}}), f = services();
    let actual: Record<string, unknown> | null = null;
    f.mocks.fc.mockReturnValue({describeFunction: async () => actual});
    f.mocks.component.mockImplementation(async input => {
      if (input.command === "build") {
        if (buildFails) throw new Error("original build failure");
        return {};
      }
      actual = {functionArn: "acs:fc:cn-hangzhou:123:functions/demo-api", functionId: "native-1", createdTime: "2026-01-01"};
      return {};
    });
    if (buildOnly) f.mocks.run.mockRejectedValue(new Error("deployment hook must not run during build"));
    const operation = deployResourceProject(p.file, p.receipt, {services: f.services, buildOnly});
    if (buildFails) await expect(operation).rejects.toThrow("original build failure");
    else expect((await operation).status).toBe("ready");
    expect(f.mocks.component.mock.calls.map(([input]) => input.command)).toEqual(buildOnly || buildFails ? ["build"] : ["build", "deploy"]);
    expect(f.mocks.run.mock.calls.map(([input]) => input.argv.at(-1))).toEqual(buildOnly ? [] : [buildFails ? "failure-hook" : "success-hook", "completion-hook"]);
    expect(JSON.parse(fs.readFileSync(p.receipt, "utf8")).status).toBe(buildFails ? "requires_recovery" : "ready");
    if (buildOnly) expect(f.mocks.fc).not.toHaveBeenCalled();
  });
  it("borrows a prepared template and prevents cleanup while it has a consumer", async () => {
    const p = project({specVersion: 1, name: "demo", sandbox: {agent: sandbox}}), f = services();
    const buildFile = path.join(p.root, ".abx", "build.json"), useFile = path.join(p.root, ".abx", "use.json");
    const build = await deployResourceProject(p.file, buildFile, {services: f.services, buildOnly: true});
    expect(build.buildOnly).toBe(true);
    const deployed = await deployResourceProject(p.file, useFile, {services: f.services, buildReceipt: buildFile, name: "consumer"});
    expect(deployed.resources[0].owned).toBe(false);
    expect(f.call.mock.calls.filter(([action]) => action === "CreateTemplate")).toHaveLength(1);
    build.consumers = ["consumer"]; fs.writeFileSync(buildFile, JSON.stringify(build));
    await expect(deleteResourceProject(buildFile, f.services)).rejects.toThrow("used by a deployment");
    await deleteResourceProject(useFile, f.services);
    expect(f.call.mock.calls.filter(([action]) => action === "DeleteTemplate")).toHaveLength(0);
    const retired = JSON.parse(fs.readFileSync(useFile, "utf8")); retired.resources.forEach((entry: {name: string}) => {entry.name = `previous.${entry.name}`;}); fs.writeFileSync(useFile, JSON.stringify(retired));
    const reused = await deployResourceProject(p.file, useFile, {services: f.services, buildReceipt: buildFile, name: "consumer"});
    expect(reused.resources.find(entry => entry.name === "agent")?.owned).toBe(false);
    expect(f.call.mock.calls.filter(([action]) => action === "CreateTemplate")).toHaveLength(1);
    await deleteResourceProject(useFile, f.services);
    build.consumers = []; fs.writeFileSync(buildFile, JSON.stringify(build)); await deleteResourceProject(buildFile, f.services);
    expect(f.call.mock.calls.filter(([action]) => action === "DeleteTemplate")).toHaveLength(1);
  });
  it("rejects changed sources before borrowing an old build", async () => {
    const p = project({specVersion: 1, name: "demo", sandbox: {agent: sandbox}}), f = services();
    const buildFile = path.join(p.root, ".abx", "build.json");
    await deployResourceProject(p.file, buildFile, {services: f.services, buildOnly: true});
    fs.writeFileSync(path.join(p.root, "source.py"), "print('changed')");
    await expect(deployResourceProject(p.file, p.receipt, {services: f.services, buildReceipt: buildFile})).rejects.toThrow("Build source changed");
    expect(f.call.mock.calls.filter(([action]) => action === "CreateTemplate")).toHaveLength(1);
  });
  it("records FC auto dependencies as retained and removes a function without its original source", async () => {
    const p = project({specVersion: 1, name: "demo", serving: {api: {component: "serverless-devs/fc3@0.1.26", props: {region: "cn-hangzhou", functionName: "demo-api", runtime: "nodejs20", logConfig: "auto"}}}}), f = services();
    let actual: Record<string, unknown> | null = null;
    f.mocks.fc.mockReturnValue({describeFunction: async () => actual});
    f.mocks.component.mockImplementation(async (input) => {actual = input.command === "remove" ? null : {functionArn: "acs:fc:cn-hangzhou:123:functions/demo-api", functionId: "native-1", createdTime: "2026-01-01", logConfig: {project: "auto-project", logstore: "auto-logstore"}}; return {};});
    const result = await deployResourceProject(p.file, p.receipt, {services: f.services});
    expect(result.retainedComponentResources).toEqual([{resource: "api", nativeName: "demo-api", field: "logConfig", status: "observed", references: ["auto-project", "auto-logstore"]}]);
    const retained = project({}); fs.copyFileSync(p.receipt, retained.receipt); fs.rmSync(p.root, {recursive: true});
    expect((await deleteResourceProject(retained.receipt, f.services)).status).toBe("deleted");
    expect(f.mocks.component.mock.calls.at(-1)![0].cwd).toBe(retained.root);
  });

  it("builds the staged public context and detects dependency changes before reusing a tag", async () => {
    const p = project({specVersion: 1, name: "demo", sandbox: {agent: {...sandbox, template: {...sandbox.template, image: "example.com/app:immutable", buildConfig: {dockerfile: "Dockerfile"}}}}}), f = services();
    fs.writeFileSync(path.join(p.root, "Dockerfile"), "FROM scratch\nCOPY . /app\n");
    fs.writeFileSync(path.join(p.root, ".env"), "SECRET_SENTINEL=not-for-build\n");
    fs.mkdirSync(path.join(p.root, "node_modules")); fs.writeFileSync(path.join(p.root, "node_modules", "dependency.txt"), "first");
    f.mocks.docker.build.mockImplementation(async (context: string) => {
      expect(fs.existsSync(path.join(context, ".env"))).toBe(false);
      expect(fs.existsSync(path.join(context, ".abx"))).toBe(false);
      expect(fs.readFileSync(path.join(context, "node_modules", "dependency.txt"), "utf8")).toBe("first");
    });
    const receipt = path.join(p.root, ".abx", "resources.json");
    await deployResourceProject(p.file, receipt, {services: f.services});
    expect(f.mocks.docker.build).toHaveBeenCalledTimes(1); expect(f.mocks.docker.push).toHaveBeenCalledTimes(1);
    fs.writeFileSync(path.join(p.root, "node_modules", "dependency.txt"), "changed");
    await expect(deployResourceProject(p.file, receipt, {services: f.services})).rejects.toThrow("new template.image tag");
    expect(f.mocks.docker.build).toHaveBeenCalledTimes(1);
  });

});
