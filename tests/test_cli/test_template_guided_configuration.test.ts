import { ResourceJournal } from "../../src/template/resource_journal.js";
import { TemplateBuildTimeoutError } from "../../src/models/errors.js";
import { manifestYaml } from "../helpers/templateManifest.js";
import "../_support/isolatedHome.js";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Context, command } from "../../src/cli/kit.js";
import { cli } from "../../src/cli/main.js";
import { guidanceSeams } from "../../src/cli/config_guidance.js";
import * as guidance from "../../src/cli/config_guidance.js";
import { getOperationConfig } from "../../src/utils/operation_config.js";
import * as fcTemplate from "../../src/providers/alicloud_express/fc_template.js";
import { CLI_EXTENSION } from "../../src/providers/alicloud_express/cli/extension.js";
import { _buildImage, templateSeams, withDeployConfiguration } from "../../src/providers/alicloud_express/cli/template.js";
import { templateSeams as catalogSeams } from "../../src/cli/template_catalog.js";
import { prepareTemplateBuildInputs } from "../../src/cli/template_project.js";
import { launchTemplate } from "../../src/cli/template_launch.js";
import { RegistryClient } from "../../src/utils/registry.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { fakeConfig, patchLoadConfig, useMockBuilder, useTmpPath, writeText } from "../helpers/templateSupport.js";

import { useIso } from "../_support/iso.js";
import { configSeams } from "../../src/cli/commands/config_cmd.js";
import { storagePatch } from "../helpers/configSupport.js";
const iso=useIso();
let restoreConfiguration:()=>void;
beforeEach(()=>{const old={...configSeams};Object.assign(configSeams,storagePatch(iso.home,{env:true}));restoreConfiguration=()=>Object.assign(configSeams,old);});
afterEach(()=>restoreConfiguration());
const tmpPath = useTmpPath();
const mockBuilder = useMockBuilder();
afterEach(() => vi.restoreAllMocks());
const context = (): Context => new Context(command("deploy"));
function project(steps = false): string {
  const directory = path.join(tmpPath(), "app");
  writeText(path.join(directory, "template.yaml"), manifestYaml(steps ? "name: app\ngeneration: 2\nbase:\n  image: python:3.12-slim\nbuild:\n  run: ['echo ready']\n" : "name: app\n"));
  if (!steps) writeText(path.join(directory, "Dockerfile"), "FROM python:3.12-slim\n");
  return directory;
}

function preparation(alias = "generated", timeout = 60, cpu = 2) {
  return { alias, timeout, journal: new ResourceJournal("alicloud-express", "fixture"),
    template: { name: alias, cpu, memory: 512, start_cmd: null, ready_cmd: null } };
}

describe("Operation-specific template guidance", () => {
  it.each(["missing directory", "file", "missing template"])("validates known local launch input before asking for credentials: %s", async kind => {
    const source = path.join(tmpPath(), "invalid-source");
    if (kind === "file") fs.writeFileSync(source, "file");
    if (kind === "missing template") fs.mkdirSync(source);
    const expected = kind === "file" ? "not a directory" : kind === "missing template" ? "no template.yaml" : "does not exist";
    await expect(launchTemplate(context(), { yes: true, template_ref: source })).rejects.toThrow(expected);
  });

  it("rechecks Docker after a manual fix without repeating a build", async () => {
    const builder = mockBuilder();
    builder.builder.checkDocker.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    vi.spyOn(guidance, "canGuideConfiguration").mockReturnValue(true);
    const holder = command("build", { callback: async () => {
      await _buildImage(project(), { tag: "latest", repo: "app", platform: "linux/amd64", dockerfile: null, on_progress: () => {} });
    } });
    const result = await new CliRunner().invoke(holder, [], { input: "y\n" });
    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("check again");
    expect(builder.builder.checkDocker).toHaveBeenCalledTimes(2);
    expect(builder.builder.build).toHaveBeenCalledOnce();
  });

  it("does not ask to repair Docker in batch mode", async () => {
    const builder = mockBuilder();
    builder.builder.checkDocker.mockResolvedValue(false);
    const holder = command("build", { callback: async ctx => {
      ctx.params["yes"] = true;
      await _buildImage(project(), { tag: "latest", repo: "app", platform: "linux/amd64", dockerfile: null, on_progress: () => {} });
    } });
    const result = await new CliRunner().invoke(holder, []);
    expect(result.exit_code).toBe(1);
    expect((result.exception as { suggestion?: string }).suggestion).toContain("docker info");
    expect(result.output).not.toContain("check again?");
    expect(builder.builder.build).not.toHaveBeenCalled();
  });

  it.each(["missing", "unavailable"])("checks Docker %s before registering a build intent", async reason => {
    const builder = mockBuilder(); builder.builder.checkDocker.mockResolvedValue(false);
    patchLoadConfig(); vi.stubEnv("ACR_NAMESPACE", "fixture-namespace");
    const pycompat = await import("../../src/agent/_pycompat.js");
    vi.spyOn(pycompat, "which").mockReturnValue(reason === "missing" ? null : "/mock/docker");
    const journal = new ResourceJournal("alicloud-express", "fixture");
    const intent = vi.spyOn(journal, "intent");
    const create = vi.spyOn(fcTemplate, "createOfficialTemplate");
    const ctx = context(); ctx.params = { yes: true };
    await expect(CLI_EXTENSION.prepareProject(project(), { alias: "preflight", timeout: 60, journal,
      template: { name: "preflight", cpu: 2, memory: 2048, start_cmd: null, ready_cmd: null } }, ctx))
      .rejects.toThrow(reason === "missing" ? "Docker CLI was not found" : "daemon or selected context is not accessible");
    expect(intent).not.toHaveBeenCalled(); expect(journal.recoverySummary()).toEqual([]);
    expect(builder.builder.build).not.toHaveBeenCalled(); expect(builder.builder.push).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it.each([["deploy"], ["template", "deploy"], ["template", "build"]])("reports the complete official build requirements before Docker: %s", async (...prefix) => {
    patchLoadConfig(fakeConfig({ access_key_id: null, access_key_secret: null, api_key: "" }));
    const deploy = vi.spyOn(templateSeams, "_doDeploy");
    const build = vi.spyOn(templateSeams, "_buildImage");
    const result = await new CliRunner().invoke(cli, [...prefix, project(), "-y", "--acr-username", "push-user", "--acr-password", "placeholder"]);
    expect(result.exit_code, result.output).toBe(1);
    for (const key of ["acr_namespace", "access_key_id", "access_key_secret"]) expect(result.output).toContain(key);
    expect(result.output).not.toContain("sandbox_api_key");
    expect(deploy).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
  });

  it("saves collected credentials by default and restores the surrounding operation", async () => {
    patchLoadConfig(fakeConfig({ access_key_id: null, access_key_secret: null, api_key: "" }));
    vi.spyOn(guidanceSeams, "interactive").mockReturnValue(true);
    const answers = ["placeholder-ak", "placeholder-sk", "my-namespace"];
    vi.spyOn(guidanceSeams, "ask").mockImplementation(async () => answers.shift() ?? "");
    const before = { ...process.env };
    const result = await withDeployConfiguration(project(), { ctx: context() }, async () => {
      const config = getOperationConfig();
      expect(config).toMatchObject({ access_key_id: "placeholder-ak", access_key_secret: "placeholder-sk", acr_namespace: "my-namespace" });
      return "continued";
    });
    expect(result).toBe("continued");
    expect(answers).toHaveLength(0);
    expect(getOperationConfig()).toBeUndefined();
    expect(process.env).toEqual(before);
    expect(fs.readdirSync(tmpPath())).toEqual(["app"]);
  });

  it("shared steps preparation forwards supported options without resolving ACR", async () => {
    patchLoadConfig();
    const deploy = vi.spyOn(templateSeams, "_doDeploy").mockResolvedValue({ TemplateID: "steps-reference", Status: "ready" });
    const ctx = context(); ctx.params = { yes: true, region: "cn-shanghai" };
    await CLI_EXTENSION.prepareProject(project(true), preparation("kept", 78, 3), ctx);
    expect(deploy).toHaveBeenCalledOnce();
    expect(deploy.mock.calls[0]![1]).toMatchObject({ region: "cn-shanghai", alias: "kept", build: "steps", timeout: 78, cpu: 3, yes: true });
    expect(deploy.mock.calls[0]![1].acr_namespace).toBeUndefined();
  });

  it("waits for a generated submitted template before returning its reference", async () => {
    patchLoadConfig();
    vi.spyOn(templateSeams, "_doDeploy").mockResolvedValue({ TemplateID: "pending-generated", Status: "submitted" });
    let finish!: () => void;
    const waiting = vi.spyOn(fcTemplate, "waitForTemplateReady").mockImplementation(() => new Promise(resolve => { finish = () => resolve({ status: { state: "ready" } } as never); }));
    const ctx = context(); ctx.params = { yes: true };
    let returned = false;
    const result = CLI_EXTENSION.prepareProject(project(true), preparation(), ctx).then(value => { returned = true; return value; });
    await vi.waitFor(() => expect(waiting).toHaveBeenCalledOnce());
    expect(returned).toBe(false);
    expect(waiting.mock.calls[0]![0]).toBe("pending-generated");
    finish();
    expect(await result).toMatchObject({ reference: "pending-generated", status: "ready" });
  });

  it("preserves a timed-out remote build identity and gives actionable inspection guidance", async () => {
    patchLoadConfig();
    vi.spyOn(templateSeams, "_doDeploy").mockResolvedValue({ TemplateID: "pending-timeout", Status: "submitted" });
    const error = new TemplateBuildTimeoutError("still building");
    vi.spyOn(fcTemplate, "waitForTemplateReady").mockRejectedValue(error);
    const ctx = context(); ctx.params = { yes: true };
    await expect(CLI_EXTENSION.prepareProject(project(true), preparation(), ctx)).rejects.toBe(error);
    expect(error.suggestion).toContain("abx template info pending-timeout");
    expect(error.suggestion).not.toContain("Increase the build timeout");
  });

  it("propagates failed generated build readiness without replaying deployment", async () => {
    patchLoadConfig();
    const deploy = vi.spyOn(templateSeams, "_doDeploy").mockResolvedValue({ TemplateID: "failed-generated", Status: "submitted" });
    vi.spyOn(fcTemplate, "waitForTemplateReady").mockRejectedValue(new Error("platform build failed"));
    const ctx = context(); ctx.params = { yes: true };
    await expect(CLI_EXTENSION.prepareProject(project(true), preparation(), ctx)).rejects.toThrow("platform build failed");
    expect(deploy).toHaveBeenCalledOnce();
  });

  it("launch preparation accepts platform steps with no namespace", async () => {
    patchLoadConfig();
    const deploy = vi.spyOn(templateSeams, "_doDeploy").mockResolvedValue({ TemplateID: "steps-reference", Status: "ready" });
    const ctx = context(); ctx.params = { yes: true };
    const result = await CLI_EXTENSION.prepareProject(project(true), { alias: "launch", timeout: 60, journal: new ResourceJournal("alicloud-express", "fixture"), template: { name: "launch", cpu: 2, memory: 512, start_cmd: null, ready_cmd: null } }, ctx);
    expect(result).toMatchObject({ reference: "steps-reference", status: "ready", identity: { native_version: "steps-reference" } });
    expect(deploy).toHaveBeenCalledOnce();
    expect(deploy.mock.calls[0]![1].acr_namespace).toBeUndefined();
  });

  it("does not replay a cloud operation after failure", async () => {
    patchLoadConfig();
    const action = vi.fn(async () => { throw new Error("submitted operation timed out"); });
    await expect(withDeployConfiguration(project(true), { ctx: context(), yes: true }, action)).rejects.toThrow("submitted operation timed out");
    expect(action).toHaveBeenCalledOnce();
  });

  it("checks launch creation identity before downloading remote source", async () => {
    const fetch = vi.spyOn(RegistryClient.prototype, "fetch");
    await expect(launchTemplate(context(), { yes: true, template_ref: "owner/repo" })).rejects.toThrow("sandbox_api_key");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("push does not request a Sandbox API key or platform registration identity", async () => {
    patchLoadConfig(fakeConfig({ api_key: "", access_key_id: null, access_key_secret: null }));
    const push = vi.spyOn(templateSeams, "_pushImage").mockResolvedValue(["registry/ns/local:latest", []]);
    const result = await new CliRunner().invoke(cli, ["template", "push", "local:latest", "--acr-namespace", "ns", "--acr-username", "push-user", "--acr-password", "placeholder"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(push).toHaveBeenCalledOnce();
  });

  it("keeps a downloaded template when configuration is missing", async () => {
    patchLoadConfig(fakeConfig({ access_key_id: null, access_key_secret: null }));
    const source = project();
    const destination = path.join(tmpPath(), "downloaded");
    const result = await new CliRunner().invoke(cli, ["template", "install", source, "--dir", destination, "-y"]);
    expect(result.exit_code).toBe(1);
    expect(fs.existsSync(path.join(destination, "template.yaml"))).toBe(true);
    expect(result.output).toContain("access_key_id");
  });

  it("offers initialization for an existing project while retaining business files", async () => {
    const directory = path.join(tmpPath(), "existing");
    writeText(path.join(directory, "business.py"), "print('retained')\n");
    vi.spyOn(guidance, "canGuideConfiguration").mockReturnValue(true);
    vi.spyOn(catalogSeams, "_tryArrowCasePicker").mockResolvedValue("python");
    const holder = command("prepare", { callback: async ctx => {
      const prepared = await prepareTemplateBuildInputs(ctx, directory, false, {});
      expect(prepared).toBe(directory);
    } });
    const result = await new CliRunner().invoke(holder, [], { input: "1\n" });
    expect(result.exit_code, result.output).toBe(0);
    expect(fs.readFileSync(path.join(directory, "business.py"), "utf8")).toContain("retained");
    expect(fs.existsSync(path.join(directory, "Dockerfile"))).toBe(true);
  });

  it.each(["malformed", "explicit dockerfile"])("does not offer scaffold over %s inputs", async kind => {
    const directory = project();
    if (kind === "malformed") writeText(path.join(directory, "template.yaml"), "build: [\n");
    const options = kind === "explicit dockerfile" ? { dockerfile: path.join(directory, "absent") } : {};
    const ask = vi.spyOn(guidanceSeams, "ask");
    const original = fs.readFileSync(path.join(directory, "template.yaml"), "utf8");
    await expect(prepareTemplateBuildInputs(context(), directory, false, options)).rejects.toThrow();
    expect(ask).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(directory, "template.yaml"), "utf8")).toBe(original);
  });
});
