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
  override features = new Set(["templates.build", "sandbox.lifecycle"]);
  prepared: PreparedTemplate = { reference: "opaque-returned-id", status: "ready" };
  prepare = vi.fn(async (): Promise<PreparedTemplate> => this.prepared);
  close = vi.fn(async () => undefined);
  override async buildInfra(): Promise<never> { throw Error("must use selected provider via create seam"); }
  override buildTemplateManager = vi.fn(async (): Promise<ProviderTemplateManager> => ({ prepareProject: this.prepare, close: this.close }));
}
function setup(capabilities: string[] = []) {
  const directory = path.join(iso.root, "project"); fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "template.yaml"), `name: project\nbase: python:3.12-slim\ncapabilities: ${JSON.stringify(capabilities)}\n`);
  fs.writeFileSync(path.join(directory, "Dockerfile"), "FROM python:3.12-slim\nCOPY *.whl /tmp/\nRUN echo fallback\n");
  const provider = new ProjectProvider(); registerProvider(provider); setCliProvider(provider.id);
  const sandbox = { id: "owned-sandbox", close: vi.fn(async () => undefined), kill: vi.fn(async () => undefined),
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
      expect(JSON.parse(result.stdout)).toEqual({ sandbox_id: "owned-sandbox", provider: f.provider.id, template_reference: "opaque-returned-id" });
      expect(f.provider.close).toHaveBeenCalledOnce(); expect(f.sandbox.close).toHaveBeenCalledOnce();
    } finally { f.create.mockRestore(); }
  });
  it("rejects required PTY before constructing a factory or creating resources", async () => {
    const f = setup(["terminal"]);
    try { const result = await f.invoke(); expect(result.exit_code).not.toBe(0); expect(result.stdout).toContain("pty");
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
    const f = setup(); f.provider.prepared = { ...f.provider.prepared, startup_command: "python commands.py", ready_command: "healthcheck" };
    try { const result = await f.invoke(); expect(result.exit_code, result.output).toBe(0); expect(f.sandbox.commands.run).toHaveBeenCalledTimes(2);
      expect(f.sandbox.commands.run.mock.calls[0]?.[0]).toContain("nohup"); expect(f.sandbox.kill).not.toHaveBeenCalled(); }
    finally { f.create.mockRestore(); }
  });
  it("kills only its new sandbox when startup fails and closes the client", async () => {
    const f = setup(); f.provider.prepared.startup_command = "server"; f.sandbox.commands.run.mockRejectedValue(Error("private tool error"));
    try { const result = await f.invoke(); expect(result.exit_code).not.toBe(0); expect(result.output).not.toContain("private tool error");
      expect(f.sandbox.kill).toHaveBeenCalledOnce(); expect(f.sandbox.close).toHaveBeenCalledOnce(); }
    finally { f.create.mockRestore(); }
  });
});

describe("generic staged project primitives", () => {
  it("accepts fractional remaining deadlines without a floating point timer error", async () => {
    expect(await runTool(process.execPath, ["-e", "process.stdout.write('prepared')"], { timeout: 8.001 })).toBe("prepared");
  });
  it("stages immutably, handles explicitly optional build inputs and cleans temporary output", async () => {
    const directory = path.join(iso.root, "source"); fs.mkdirSync(directory);
    const original = "FROM unresolved:<tag>\nCOPY *.whl /tmp/\nRUN echo pinned-fallback\n";
    fs.writeFileSync(path.join(directory, "Dockerfile"), original); fs.writeFileSync(path.join(directory, ".env"), "do-not-upload");
    const stage = await stageProject(directory, { base_image: "python:3.12-slim", ensure_user: "user", optional_copy: ["*.whl"] });
    try { expect(fs.readFileSync(path.join(directory, "Dockerfile"), "utf8")).toBe(original);
      expect(fs.readFileSync(path.join(stage.directory, "Dockerfile"), "utf8")).toContain("pinned-fallback");
      expect(fs.readFileSync(path.join(stage.directory, "Dockerfile"), "utf8")).not.toContain("COPY *.whl");
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
      const options = { alias: "fixture", timeout: 30, template: { name: "fixture", capabilities: [], cpu: 2, memory: 2048, start_cmd: null, ready_cmd: null } };
      await expect(CLI_EXTENSION.prepareProject(source, options, ctx)).rejects.toThrow("build failed");
      expect(wait).toHaveBeenCalledWith("submitted-template", expect.objectContaining({ poll_interval: 2, timeout: expect.any(Number) }));
      wait.mockResolvedValue({ status: "Ready" });
      await expect(CLI_EXTENSION.prepareProject(source, options, ctx)).resolves.toEqual({ reference: "submitted-template", status: "ready" });
    } finally { deploy.mockRestore(); load.mockRestore(); wait.mockRestore(); }
  });
});
