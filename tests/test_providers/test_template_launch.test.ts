import { manifestYaml } from "../helpers/workflowManifest.js";
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Provider } from "../../src/providers/base.js";
import type { PreparedTemplate, ProviderTemplateManager } from "../../src/providers/template_contract.js";
import { registerProvider } from "../../src/providers/registry.js";
import { setCliProvider, resetCliSelection } from "../../src/providers/selection.js";
import { launchSeams } from "../../src/cli/template_launch.js";
import { Sandbox } from "../../src/api/sandbox.js";
import { Context, command } from "../../src/cli/kit.js";
import { cli } from "../../src/cli/main.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { useIso } from "../_support/iso.js";
import { stageProject, runTool } from "../../src/providers/shared/project.js";

const iso = useIso();
beforeEach(resetCliSelection);
class ProjectProvider extends Provider {
  readonly id = "project-test";
  override features = new Set(["templates.build", "sandbox.lifecycle", "exec.run", "ports.url"]);
  override operations = { cli: ["template.prepare", "sandbox.create", "sandbox.delete", "exec.run", "ports.resolve"], python: [] };
  override workflow_inputs = ["source"];
  override startup_modes = ["exec", "none"];
  prepared: PreparedTemplate = { reference: "opaque-returned-id", status: "ready" };
  prepare = vi.fn(async (_directory: string, _options: import("../../src/providers/template_contract.js").ProjectTemplateOptions): Promise<PreparedTemplate> => this.prepared);
  close = vi.fn(async () => undefined);
  override async buildInfra(): Promise<never> { throw Error("must use selected provider via create seam"); }
  override buildTemplateManager = vi.fn(async (): Promise<ProviderTemplateManager> => ({ prepareProject: this.prepare, close: this.close }));
}
function setup(required_operations: string[] = []) {
  const directory = path.join(iso.root, "project"); fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "template.yaml"), JSON.stringify({name: "project", spec_version: 4, workflow_contract_version: 1,
    provides: {app: {protocol: "agent-sandbox-server",version: 2,port: 9000,operations: ["commands.run","commands.list"]}},
    default_workflow: "application", workflows: {application: {kind: "application",input: "source",service: "app",startup: "none",
      binding: {transport: "http",endpoint: "provider-port",caller: "host",authentication: "none"},operation: "commands.run",required_operations}}}));
  fs.writeFileSync(path.join(directory, "Dockerfile"), "FROM python:3.12-slim\nCOPY *.whl /tmp/\nRUN echo fallback\n");
  const provider = new ProjectProvider(); registerProvider(provider); setCliProvider(provider.id);
  const sandbox = { id: "owned-sandbox", listCommands: vi.fn(async () => []), isRunning: vi.fn(async () => false), close: vi.fn(async () => undefined), kill: vi.fn(async () => undefined),
    commands: { run: vi.fn(async (_command: string, _options?: unknown) => ({ exit_code: 0 })) } };
  const create = vi.spyOn(launchSeams, "create").mockResolvedValue(sandbox as unknown as Sandbox);
  return { directory, provider, sandbox, create, invoke: (extra: string[] = []) => new CliRunner().invoke(cli, ["--json", "template", "launch", directory, "-y", ...extra]) };
}

describe("provider-owned project launch", () => {
  it("hands the exact returned reference to the same provider, never requiring a user ID", async () => {
    const f = setup();
    try {
      const result = await f.invoke();
      expect(result.exit_code, result.output).toBe(0);
      expect(f.provider.prepare).toHaveBeenCalledOnce();
      expect(f.create).toHaveBeenCalledWith(expect.objectContaining({ provider: f.provider.id, template: "opaque-returned-id" }));
      expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({ sandbox_id: "owned-sandbox", provider: f.provider.id, template_reference: "opaque-returned-id", workflow_id: "application", source_digest: expect.stringMatching(/^[a-f0-9]{64}$/) }));
      expect(f.provider.close).toHaveBeenCalledOnce(); expect(f.sandbox.close).toHaveBeenCalledOnce();
    } finally { f.create.mockRestore(); }
  });
  it("rejects an explicit missing interpreter operation before any resources", async () => {
    const f = setup(["code.context.execute"]);
    try { const result = await f.invoke(); expect(result.exit_code).not.toBe(0); expect(result.stdout).toContain("code.context.execute");
      expect(f.provider.buildTemplateManager).not.toHaveBeenCalled(); expect(f.create).not.toHaveBeenCalled(); }
    finally { f.create.mockRestore(); }
  });
  it("requires explicit build/create consent before preparing", async () => {
    const f = setup();
    try { const result = await new CliRunner().invoke(cli, ["template", "launch", f.directory]); expect(result.exit_code).not.toBe(0);
      expect(f.provider.prepare).not.toHaveBeenCalled(); expect(f.create).not.toHaveBeenCalled(); }
    finally { f.create.mockRestore(); }
  });
  it.each([{ reference: "queued", status: "building" }, { reference: "bad\nreference", status: "ready" }])("rejects optimistic/invalid preparation: %j", async value => {
    const f = setup(); f.provider.prepared = value as PreparedTemplate;
    try { const result = await f.invoke(); expect(result.exit_code).not.toBe(0); expect(f.create).not.toHaveBeenCalled(); expect(f.provider.close).toHaveBeenCalledOnce(); }
    finally { f.create.mockRestore(); }
  });
  it("starts the adapter-selected service and waits for readiness without printing raw output", async () => {
    const f = setup();
    const manifest = JSON.parse(fs.readFileSync(path.join(f.directory, "template.yaml"), "utf8"));
    manifest.workflows.application.startup = "exec"; manifest.start_cmd = "python commands.py"; manifest.ready_cmd = "healthcheck";
    fs.writeFileSync(path.join(f.directory, "template.yaml"), JSON.stringify(manifest));
    try { const result = await f.invoke(); expect(result.exit_code, result.output).toBe(0); expect(f.sandbox.commands.run).toHaveBeenCalledTimes(2);
      expect(f.sandbox.commands.run.mock.calls[0]?.[0]).toContain("nohup"); expect(f.sandbox.kill).not.toHaveBeenCalled(); }
    finally { f.create.mockRestore(); }
  });
  it("kills only its new sandbox when startup fails and closes the client", async () => {
    const f = setup();
    const manifest = JSON.parse(fs.readFileSync(path.join(f.directory, "template.yaml"), "utf8"));
    manifest.workflows.application.startup = "exec"; manifest.start_cmd = "server";
    fs.writeFileSync(path.join(f.directory, "template.yaml"), JSON.stringify(manifest));
    f.sandbox.commands.run.mockRejectedValue(Error("private tool error"));
    try { const result = await f.invoke(); expect(result.exit_code).not.toBe(0); expect(result.output).not.toContain("private tool error");
      expect(f.sandbox.kill).toHaveBeenCalledOnce(); expect(f.sandbox.close).toHaveBeenCalledOnce(); }
    finally { f.create.mockRestore(); }
  });
});

describe("generic staged project primitives", () => {
  it("accepts fractional remaining deadlines without a floating point timer error", async () => {
    expect(await runTool(process.execPath, ["-e", "process.stdout.write('prepared')"], { timeout: 8.001 })).toBe("prepared");
  });
  it("stages exact build inputs, detects snapshot mutation and cleans temporary output", async () => {
    const directory = path.join(iso.root, "source"); fs.mkdirSync(directory);
    const original = "FROM python:3.12-slim\nCOPY *.whl /tmp/\nRUN echo pinned-fallback\n";
    fs.writeFileSync(path.join(directory, "Dockerfile"), original); fs.writeFileSync(path.join(directory, ".env"), "do-not-upload");
    const stage = await stageProject(directory);
    try { expect(fs.readFileSync(path.join(directory, "Dockerfile"), "utf8")).toBe(original);
      expect(fs.readFileSync(path.join(stage.directory, "Dockerfile"), "utf8")).toContain("pinned-fallback");
      expect(fs.readFileSync(path.join(stage.directory, "Dockerfile"), "utf8")).toBe(original);
      await stage.verify();
      fs.writeFileSync(path.join(stage.directory, "Dockerfile"), original + "RUN changed\n");
      await expect(stage.verify()).rejects.toThrow("snapshot changed");
      expect(fs.existsSync(path.join(stage.directory, ".env"))).toBe(false);
    } finally { await stage.close(); }
    expect(fs.existsSync(stage.directory)).toBe(false);
  });
  it("sanitizes actual failed subprocess output", async () => {
    await expect(runTool(process.execPath, ["-e", "process.stderr.write('private-fixture-value');process.exit(1)"])).rejects.not.toThrow("private-fixture-value");
  });
});

describe("Express preparation readiness", () => {
  it("waits for a submitted platform build before returning a usable reference", async () => {
    const { CLI_EXTENSION } = await import("../../src/providers/alicloud_express/cli/extension.js");
    const adapter = await import("../../src/providers/alicloud_express/cli/template.js");
    const fc = await import("../../src/providers/alicloud_express/fc_template.js");
    const deploy = vi.spyOn(adapter, "do_deploy").mockResolvedValue({ TemplateID: "submitted-template", Status: "submitted" });
    const source = path.join(iso.root, "readiness-project");
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, "template.yaml"), "name: fixture\nbase:\n  image: python:3.12-slim\nbuild:\n  run: ['true']\n");
    const ctx = new Context(command("launch")); ctx.params["yes"] = true;
    const load = vi.spyOn(adapter.templateSeams, "loadConfig").mockReturnValue({ access_key_id: "placeholder", access_key_secret: "placeholder", region: "cn-hangzhou" } as ReturnType<typeof adapter.templateSeams.loadConfig>);
    const wait = vi.spyOn(fc, "waitForTemplateReady").mockRejectedValue(new Error("build failed"));
    try {
      const options = { alias: "fixture", timeout: 30, template: { name: "fixture", cpu: 2, memory: 2048, start_cmd: null, ready_cmd: null } };
      await expect(CLI_EXTENSION.prepareProject(source, options, ctx)).rejects.toThrow("build failed");
      expect(wait).toHaveBeenCalledWith("submitted-template", expect.objectContaining({ poll_interval: 2, timeout: expect.any(Number) }));
      wait.mockResolvedValue({ status: "Ready" });
      await expect(CLI_EXTENSION.prepareProject(source, options, ctx)).resolves.toEqual({ reference: "submitted-template", status: "ready" });
    } finally { deploy.mockRestore(); load.mockRestore(); wait.mockRestore(); }
  });
});

describe("explicit workflow inputs and build profiles", () => {
  it("launches an explicitly owned managed reference without preparing source", async () => {
    const f=setup();f.provider.workflow_inputs=["source", "managed"];
    const file=path.join(f.directory,"template.yaml"), manifest=JSON.parse(fs.readFileSync(file,"utf8"));
    manifest.provider=f.provider.id;manifest.template_id="native-version-42";manifest.workflows.application.input="managed";
    fs.writeFileSync(file,JSON.stringify(manifest));fs.unlinkSync(path.join(f.directory,"Dockerfile"));
    try {const result=await f.invoke();expect(result.exit_code,result.output).toBe(0);expect(f.provider.prepare).not.toHaveBeenCalled();expect(f.create).toHaveBeenCalledWith(expect.objectContaining({template:"native-version-42"}));}
    finally {f.create.mockRestore();}
  });
  it("rejects a foreign managed reference before preparing or creating", async () => {
    const f=setup();f.provider.workflow_inputs=["managed"];
    const file=path.join(f.directory,"template.yaml"),manifest=JSON.parse(fs.readFileSync(file,"utf8"));manifest.provider="other-provider";manifest.template_id="foreign";manifest.workflows.application.input="managed";fs.writeFileSync(file,JSON.stringify(manifest));
    try {expect((await f.invoke()).exit_code).not.toBe(0);expect(f.provider.prepare).not.toHaveBeenCalled();expect(f.create).not.toHaveBeenCalled();}
    finally{f.create.mockRestore();}
  });
  it("selects a declared Dockerfile without changing the default input", async () => {
    const f=setup(),file=path.join(f.directory,"template.yaml"),manifest=JSON.parse(fs.readFileSync(file,"utf8"));manifest.build_profiles={portable:{dockerfile:"Dockerfile.portable",context:"."}};fs.writeFileSync(file,JSON.stringify(manifest));fs.writeFileSync(path.join(f.directory,"Dockerfile"),"FROM <platform-base>\n");fs.writeFileSync(path.join(f.directory,"Dockerfile.portable"),"FROM python:3.12-slim\n");
    try{const result=await f.invoke(["--build-profile","portable"]);expect(result.exit_code,result.output).toBe(0);expect(JSON.parse(result.stdout).build_profile).toBe("portable");expect(f.provider.prepare.mock.calls[0]?.length).toBeGreaterThan(0);expect(fs.readFileSync(path.join(f.directory,"Dockerfile"),"utf8")).toBe("FROM <platform-base>\n");}
    finally{f.create.mockRestore();}
  });
  it("launches a portable profile from actual YAML with a quoted root context", async () => {
    const f = setup();
    const yaml = manifestYaml("name: project\nbuild_profiles:\n  portable:\n    dockerfile: Dockerfile.portable\n    context: '.'\n");
    fs.writeFileSync(path.join(f.directory, "template.yaml"), yaml);
    const original = "FROM <platform-base>\n";
    fs.writeFileSync(path.join(f.directory, "Dockerfile"), original);
    fs.writeFileSync(path.join(f.directory, "Dockerfile.portable"), "FROM python:3.12-slim\n");
    try {
      const result = await f.invoke(["--build-profile", "portable"]);
      expect(result.exit_code, result.output).toBe(0);
      expect(f.provider.prepare.mock.calls[0]?.[1].build_profile).toEqual({ id: "portable", dockerfile: "Dockerfile.portable", context: "." });
      expect(JSON.parse(result.stdout)).toMatchObject({ build_profile: "portable", source_digest: expect.stringMatching(/^[a-f0-9]{64}$/) });
      expect(fs.readFileSync(path.join(f.directory, "Dockerfile"), "utf8")).toBe(original);
      expect(fs.readFileSync(path.join(f.directory, "template.yaml"), "utf8")).toBe(yaml);
    } finally { f.create.mockRestore(); }
  });
  it("rejects an unknown build profile before side effects",async()=>{const f=setup();try{expect((await f.invoke(["--build-profile","missing"])).exit_code).not.toBe(0);expect(f.provider.prepare).not.toHaveBeenCalled();expect(f.create).not.toHaveBeenCalled();}finally{f.create.mockRestore();}});
});

it("snapshots eligible local untracked inputs while excluding Git-ignored files", async()=>{
  const {execFileSync}=await import("node:child_process");const directory=path.join(iso.root,"git-source");fs.mkdirSync(directory);execFileSync("git",["init","-q"],{cwd:directory});
  fs.writeFileSync(path.join(directory,".gitignore"),"ignored.txt\n");fs.writeFileSync(path.join(directory,"ignored.txt"),"ignored-input");fs.writeFileSync(path.join(directory,"local.txt"),"local-untracked-input");fs.writeFileSync(path.join(directory,"Dockerfile"),"FROM python:3.12-slim\n");
  const snapshot=await stageProject(directory);try{expect(fs.existsSync(path.join(snapshot.directory,"ignored.txt"))).toBe(false);expect(fs.readFileSync(path.join(snapshot.directory,"local.txt"),"utf8")).toBe("local-untracked-input");await snapshot.verify();}finally{await snapshot.close();}
});
