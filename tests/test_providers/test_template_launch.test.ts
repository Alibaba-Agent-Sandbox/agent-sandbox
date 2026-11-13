/** Template preparation and explicit runtime creation have separate lifecycles. */
import fs from "node:fs";
import path from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {executeTemplateLaunch, launchSeams} from "../../src/cli/template_launch.js";
import {Context, command} from "../../src/cli/kit.js";
import {ResourceJournal} from "../../src/template/resource_journal.js";
import {stageProject, runTool} from "../../src/providers/shared/project.js";
import {useIso} from "../_support/iso.js";
const iso=useIso();
afterEach(()=>vi.restoreAllMocks());
it("does not implicitly create an instance from a resource deployment",async()=>{
  const create=vi.spyOn(launchSeams,"create");
  await expect(executeTemplateLaunch(new Context(command("prepare")),{template_ref:"project"})).rejects.toThrow("does not create dynamic Sandbox instances");
  expect(create).not.toHaveBeenCalled();
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

it("snapshots eligible local untracked inputs while excluding Git-ignored files", async()=>{
  const {execFileSync}=await import("node:child_process");const directory=path.join(iso.root,"git-source");fs.mkdirSync(directory);execFileSync("git",["init","-q"],{cwd:directory});
  fs.writeFileSync(path.join(directory,".gitignore"),"ignored.txt\n");fs.writeFileSync(path.join(directory,"ignored.txt"),"ignored-input");fs.writeFileSync(path.join(directory,"local.txt"),"local-untracked-input");fs.writeFileSync(path.join(directory,"Dockerfile"),"FROM python:3.12-slim\n");
  const snapshot=await stageProject(directory);try{expect(fs.existsSync(path.join(snapshot.directory,"ignored.txt"))).toBe(false);expect(fs.readFileSync(path.join(snapshot.directory,"local.txt"),"utf8")).toBe("local-untracked-input");await snapshot.verify();}finally{await snapshot.close();}
});
