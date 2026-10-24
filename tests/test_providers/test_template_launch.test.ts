import { manifestYaml } from "../helpers/workflowManifest.js";
import fs from "node:fs";
import promises from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Provider } from "../../src/providers/base.js";
import type { PreparedTemplate, ProviderTemplateManager } from "../../src/providers/template_contract.js";
import { registerProvider } from "../../src/providers/registry.js";
import { setCliProvider, resetCliSelection } from "../../src/providers/selection.js";
import {applicationHttpSeams} from "../../src/transport/application_http.js";
import { ResourceJournal } from "../../src/template/resource_journal.js";
import { launchSeams } from "../../src/cli/template_launch.js";
import { Sandbox } from "../../src/api/sandbox.js";
import { Context, command } from "../../src/cli/kit.js";
import { cli } from "../../src/cli/main.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { useIso } from "../_support/iso.js";
import { ProjectToolError, stageProject, runTool } from "../../src/providers/shared/project.js";

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
  const sandbox = { id: "owned-sandbox", verifyApplicationOperation: vi.fn(async () => undefined), listCommands: vi.fn(async () => []), isRunning: vi.fn(async () => false), close: vi.fn(async () => undefined), kill: vi.fn(async () => undefined),
    commands: { run: vi.fn(async (_command: string, _options?: unknown) => ({ exit_code: 0 })) } };
  const create = vi.spyOn(launchSeams, "create").mockResolvedValue(sandbox as unknown as Sandbox);
  return { directory, provider, sandbox, create, invoke: (extra: string[] = []) => new CliRunner().invoke(cli, ["--json", "template", "launch", directory, "-y", ...extra]) };
}

describe("provider-owned project launch", () => {
  it("hands the materialized official recipe to source preparation through the public launch path", async () => {
    const f = setup();
    const original = 'FROM fc-e2b-registry.<region>.cr.aliyuncs.com/runtime/base:<tag>\nCOPY *.whl /tmp/\nRUN pip install "https://github.com/Alibaba-Agent-Sandbox/python-sdk/archive/e2cb27e24fde0a67112f82b8d44af463445a5d1a.tar.gz#subdirectory=server-sdk"\nUSER user\n';
    fs.writeFileSync(path.join(f.directory, "Dockerfile"), original);
    let effective = "";
    f.provider.prepare.mockImplementation(async directory => {
      effective = fs.readFileSync(path.join(directory, "Dockerfile"), "utf8");
      return f.provider.prepared;
    });
    try {
      const result = await f.invoke();
      expect(result.exit_code, result.output).toBe(0);
      expect(effective).toContain("COPY --from=abx-server-wheel /abx-wheels/*.whl /tmp/");
      expect(effective).not.toContain("<region>");
      expect(effective).toContain("USER user\n");
      expect(fs.readFileSync(path.join(f.directory, "Dockerfile"), "utf8")).toBe(original);
    } finally { f.create.mockRestore(); }
  });
  it("keeps the safe failed Docker phase and recovery journal visible without exposing raw output", async () => {
    const f = setup();
    f.provider.prepare.mockRejectedValue(new ProjectToolError("docker", "push", { killed: true }));
    try {
      const result = await f.invoke();
      expect(result.exit_code).not.toBe(0);
      expect(result.output).toContain("Docker push exceeded its time limit");
      expect(result.output).toContain("recovery journal");
      expect(f.create).not.toHaveBeenCalled();
    } finally { f.create.mockRestore(); }
  });
  it("hands the exact returned reference to the same provider, never requiring a user ID", async () => {
    const f = setup();
    try {
      const result = await f.invoke();
      expect(result.exit_code, result.output).toBe(0);
      expect(f.provider.prepare).toHaveBeenCalledOnce();
      expect(f.create).toHaveBeenCalledWith(expect.objectContaining({ provider: f.provider.id, template: "opaque-returned-id" }));
      expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({ sandbox_id: "owned-sandbox", provider: f.provider.id, template_reference: "opaque-returned-id", workflow_id: "application", source_digest: expect.stringMatching(/^[a-f0-9]{64}$/) }));
      expect(f.provider.close).toHaveBeenCalledOnce(); expect(f.sandbox.close).toHaveBeenCalledOnce();
      expect(f.sandbox.verifyApplicationOperation).toHaveBeenCalledWith("commands.run", expect.objectContaining({server_port: 9000}));
      expect(f.sandbox.listCommands).not.toHaveBeenCalled();
    } finally { f.create.mockRestore(); }
  });
  it("rejects an explicit missing interpreter operation before any resources", async () => {
    const f = setup(["code.context.execute"]);
    try { const result = await f.invoke(); expect(result.exit_code).not.toBe(0); expect(result.stdout).toContain("code.context.execute");
      expect(f.provider.buildTemplateManager).not.toHaveBeenCalled(); expect(f.create).not.toHaveBeenCalled(); }
    finally { f.create.mockRestore(); }
  });
  it("refuses creation when the filesystem cannot durably sync its journal directory", async () => {
    const f = setup(); const open = promises.open.bind(promises);
    const opened = vi.spyOn(promises, "open").mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (String(args[0]).endsWith("resource-journal")) vi.spyOn(handle, "sync").mockRejectedValue(new Error("directory sync unsupported"));
      return handle;
    });
    try { expect((await f.invoke()).exit_code).not.toBe(0); expect(f.create).not.toHaveBeenCalled(); }
    finally { opened.mockRestore(); f.create.mockRestore(); }
  });
  it("still deletes and closes the known sandbox after an actual receipt directory-sync failure", async () => {
    const f = setup(); const open = promises.open.bind(promises); let directorySyncs = 0;
    const opened = vi.spyOn(promises, "open").mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (String(args[0]).endsWith("resource-journal") && ++directorySyncs === 2) vi.spyOn(handle, "sync").mockRejectedValue(new Error("receipt sync failed"));
      return handle;
    });
    try {
      const result = await f.invoke(); expect(result.exit_code).not.toBe(0); expect(result.output).toContain("owned-sandbox");
      expect(f.sandbox.kill).toHaveBeenCalledOnce(); expect(f.sandbox.close).toHaveBeenCalledOnce();
    } finally { opened.mockRestore(); f.create.mockRestore(); }
  });
  it("does not replay a create whose native ID is unknown", async () => {
    const f = setup(); f.create.mockRejectedValue(new Error("create timeout"));
    try {
      const result = await f.invoke(); expect(result.exit_code).not.toBe(0); expect(result.output).toContain("uncertain outcome");
      expect(f.create).toHaveBeenCalledOnce(); expect(f.sandbox.kill).not.toHaveBeenCalled();
    } finally { f.create.mockRestore(); }
  });
  it("retains the native ID from the early callback when session binding cannot be cleaned", async () => {
    const f = setup();
    f.create.mockImplementation(async options => {
      if (!options || typeof options !== "object") throw new Error("expected create options");
      await options.on_created?.("native-known-id");
      throw Object.assign(new Error("session failed"), {owned_sandbox_id: "native-known-id", cleanup_complete: false});
    });
    try {
      const result = await f.invoke(); expect(result.exit_code).not.toBe(0); expect(result.output).toContain("native-known-id"); expect(result.output).toContain("must be reconciled");
      const journalDir = path.join(iso.home, "resource-journal");
      const persisted = JSON.parse(fs.readFileSync(path.join(journalDir, fs.readdirSync(journalDir)[0]), "utf8"));
      expect(persisted.entries.at(-1)).toMatchObject({id: "native-known-id", state: "uncertain"});
    } finally { f.create.mockRestore(); }
  });
  it("cleans and closes a known sandbox when persisting its ID fails", async () => {
    const f = setup();
    const journal = vi.spyOn(ResourceJournal.prototype, "created").mockRejectedValue(new Error("disk full"));
    try {
      const result = await f.invoke();
      expect(result.exit_code).not.toBe(0);
      expect(result.output).toContain("owned-sandbox");
      expect(result.output).toContain("cleanup completed");
      expect(f.sandbox.kill).toHaveBeenCalledOnce();
      expect(f.sandbox.close).toHaveBeenCalledOnce();
      expect(f.sandbox.listCommands).not.toHaveBeenCalled();
    } finally { journal.mockRestore(); f.create.mockRestore(); }
  });
  it("keeps a confirmed native cleanup deleted instead of marking it uncertain", async () => {
    const f = setup();
    f.create.mockRejectedValue(Object.assign(new Error("session binding failed"), {owned_sandbox_id: "native-known-id", cleanup_complete: true}));
    try {
      const result = await f.invoke();
      expect(result.exit_code).not.toBe(0); expect(result.output).toContain("native-known-id"); expect(result.output).toContain("cleanup completed");
      const journalDir = path.join(iso.home, "resource-journal");
      const persisted = JSON.parse(fs.readFileSync(path.join(journalDir, fs.readdirSync(journalDir)[0]), "utf8"));
      expect(persisted.entries.at(-1).state).toBe("deleted");
    } finally { f.create.mockRestore(); }
  });
  it("reports known cleanup residuals even when journal and close both fail", async () => {
    const f = setup();
    const journal = vi.spyOn(ResourceJournal.prototype, "created").mockRejectedValue(new Error("disk full"));
    const mark = vi.spyOn(ResourceJournal.prototype, "mark").mockRejectedValue(new Error("disk full"));
    f.sandbox.kill.mockRejectedValue(new Error("delete failed"));
    f.sandbox.close.mockRejectedValue(new Error("close failed"));
    try {
      const result = await f.invoke();
      expect(result.exit_code).not.toBe(0);
      expect(result.output).toContain("owned sandbox owned-sandbox");
      expect(result.output).toContain("must be reconciled");
      expect(f.sandbox.kill).toHaveBeenCalledOnce();
      expect(f.sandbox.close).toHaveBeenCalledOnce();
    } finally { journal.mockRestore(); mark.mockRestore(); f.create.mockRestore(); }
  });
  it("checks a health workflow without requiring the command catalog", async () => {
    const f = setup(); const file = path.join(f.directory, "template.yaml"), manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    manifest.provides.app.operations = ["health"]; manifest.workflows.application.operation = "health"; fs.writeFileSync(file, JSON.stringify(manifest));
    try {
      const result = await f.invoke(); expect(result.exit_code, result.output).toBe(0);
      expect(f.sandbox.verifyApplicationOperation).toHaveBeenCalledWith("health", expect.objectContaining({server_port: 9000}));
      expect(f.sandbox.listCommands).not.toHaveBeenCalled();
    } finally { f.create.mockRestore(); }
  });
  it("uses the strict catalog path only for a selected commands.list workflow", async () => {
    const f = setup(); const file = path.join(f.directory, "template.yaml"), manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    manifest.workflows.application.operation = "commands.list"; fs.writeFileSync(file, JSON.stringify(manifest));
    f.sandbox.listCommands.mockRejectedValue(new Error("invalid catalog"));
    try { expect((await f.invoke()).exit_code).not.toBe(0); expect(f.sandbox.verifyApplicationOperation).not.toHaveBeenCalled(); expect(f.sandbox.kill).toHaveBeenCalledOnce(); }
    finally { f.create.mockRestore(); }
  });
  it("checks the selected run operation before retaining a launched application", async () => {
    const f = setup(); f.sandbox.verifyApplicationOperation.mockRejectedValue(new Error("run denied"));
    try {
      expect((await f.invoke()).exit_code).not.toBe(0);
      expect(f.sandbox.verifyApplicationOperation).toHaveBeenCalledWith("commands.run", expect.objectContaining({server_port: 9000}));
      expect(f.sandbox.kill).toHaveBeenCalledOnce();
      expect(f.sandbox.listCommands).not.toHaveBeenCalled();
    } finally { f.create.mockRestore(); }
  });
  it("rejects a missing required service token before preparing or creating resources", async () => {
    const f = setup(); const file = path.join(f.directory, "template.yaml"), manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    manifest.workflows.application.binding.authentication = "service-token"; fs.writeFileSync(file, JSON.stringify(manifest));
    try {
      const result = await f.invoke(); expect(result.exit_code).not.toBe(0); expect(result.output).toContain("ABX_SERVER_TOKEN");
      expect(f.provider.prepare).not.toHaveBeenCalled(); expect(f.create).not.toHaveBeenCalled();
    } finally { f.create.mockRestore(); }
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
      const options = { alias: "fixture", timeout: 30, journal: new ResourceJournal("alicloud-express", "fixture"), template: { name: "fixture", cpu: 2, memory: 2048, start_cmd: null, ready_cmd: null } };
      await expect(CLI_EXTENSION.prepareProject(source, options, ctx)).rejects.toThrow("build failed");
      expect(wait).toHaveBeenCalledWith("submitted-template", expect.objectContaining({ poll_interval: 2, timeout: expect.any(Number) }));
      wait.mockResolvedValue({ status: "Ready" });
      await expect(CLI_EXTENSION.prepareProject(source, options, ctx)).resolves.toMatchObject({ reference: "submitted-template", status: "ready", identity: { native_version: "submitted-template" } });
    } finally { deploy.mockRestore(); load.mockRestore(); wait.mockRestore(); }
  });
});

describe("explicit workflow inputs and build profiles", () => {
  it.each(["commands.run", "commands.list", "health"])("checks only the selected external service operation %s", async operation => {
    const f = setup(); f.provider.workflow_inputs = ["service"];
    const file = path.join(f.directory, "template.yaml"), manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    manifest.workflows.application.input = "service"; manifest.workflows.application.binding.endpoint = "explicit-url";
    manifest.workflows.application.operation = operation; manifest.provides.app.operations = [operation]; fs.writeFileSync(file, JSON.stringify(manifest));
    const names = {"commands.run": "run_command", "commands.list": "list_commands", health: "health"} as const;
    const endpoint = names[operation as keyof typeof names];
    const fetch = vi.spyOn(applicationHttpSeams, "fetch").mockImplementation(async url => {
      const value = String(url).endsWith("/capabilities") ? {api_version: 2, endpoints: {[endpoint]: {enabled: true, allowed: true}}} : operation === "health" ? {status: "ok"} : {commands: []};
      return new Response(JSON.stringify(value), {status: 200});
    });
    try {
      const result = await f.invoke(["--service-url", "http://127.0.0.1:9000"]); expect(result.exit_code, result.output).toBe(0);
      expect(f.create).not.toHaveBeenCalled(); expect(f.provider.prepare).not.toHaveBeenCalled();
      expect(fetch.mock.calls.map(call => new URL(String(call[0])).pathname)).toEqual(operation === "commands.run" ? ["/capabilities"] : ["/capabilities", operation === "health" ? "/health" : "/commands"]);
    } finally {fetch.mockRestore(); f.create.mockRestore();}
  });
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
