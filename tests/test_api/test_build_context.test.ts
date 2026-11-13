import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withPrivateBuildContext, privateBuildFingerprint } from "../../src/providers/alicloud_express/build_context.js";
import { DockerBuilder } from "../../src/providers/alicloud_express/docker_builder.js";

const roots: string[] = [];
function root(): string { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abx-build-test-")); roots.push(dir); return dir; }
afterEach(() => { for (const dir of roots.splice(0)) fs.rmSync(dir, {recursive: true, force: true}); });

describe("private Docker context", () => {
  it("preserves recipe, ignore negations, executable inputs and internal links while removing private names", async () => {
    const source = root(); fs.mkdirSync(path.join(source, "nested"));
    fs.writeFileSync(path.join(source, "Dockerfile"), "FROM scratch\nCOPY . /app\n");
    fs.writeFileSync(path.join(source, ".dockerignore"), "*.tmp\n!important.tmp\n!.env\n");
    fs.writeFileSync(path.join(source, "Dockerfile.dockerignore"), "*.log\n!.env\n");
    fs.writeFileSync(path.join(source, "script"), "echo result\n", {mode: 0o755}); fs.chmodSync(path.join(source, "script"), 0o755);
    fs.symlinkSync("script", path.join(source, "linked"));
    for (const name of [".env", ".env.local", ".sandbox-session.json", "nested/.env"]) fs.writeFileSync(path.join(source, name), "private-canary");
    for (const name of [".git", ".abx", ".agents"]) {fs.mkdirSync(path.join(source, name)); fs.writeFileSync(path.join(source, name, "secret"), "private-canary");}
    let staged = "";
    await withPrivateBuildContext(source, path.join(source, "Dockerfile"), async value => {
      staged = value.context;
      expect(fs.readFileSync(value.dockerfile, "utf8")).toBe(fs.readFileSync(path.join(source, "Dockerfile"), "utf8"));
      expect(fs.readFileSync(path.join(staged, ".dockerignore"), "utf8")).toBe("*.tmp\n!important.tmp\n!.env\n");
      expect(fs.readFileSync(`${value.dockerfile}.dockerignore`, "utf8")).toBe("*.log\n!.env\n");
      expect(fs.statSync(path.join(staged, "script")).mode & 0o777).toBe(0o755);
      expect(fs.readlinkSync(path.join(staged, "linked"))).toBe("script");
      expect(fs.statSync(path.dirname(staged)).mode & 0o777).toBe(0o700);
      for (const name of [".env", ".env.local", ".sandbox-session.json", "nested/.env", ".abx", ".git", ".agents"]) expect(fs.existsSync(path.join(staged, name))).toBe(false);
    });
    expect(fs.existsSync(staged)).toBe(false); expect(fs.readFileSync(path.join(source, ".env"), "utf8")).toBe("private-canary");
  });
  it("keeps an external Dockerfile and its ignore file outside COPY context; removes staging on failure", async () => {
    const source = root(), context = path.join(source, "app"); fs.mkdirSync(context);
    fs.writeFileSync(path.join(context, "file"), "content");
    const recipe = path.join(source, "custom.Dockerfile"); fs.writeFileSync(recipe, "FROM scratch\nCOPY file /file\n"); fs.writeFileSync(`${recipe}.dockerignore`, "ignored\n");
    let staged = "";
    await expect(withPrivateBuildContext(context, recipe, async value => {
      staged = value.context; expect(value.dockerfile.startsWith(value.context + path.sep)).toBe(false);
      expect(fs.readFileSync(`${value.dockerfile}.dockerignore`, "utf8")).toBe("ignored\n");
      expect(fs.existsSync(path.join(value.context, "custom.Dockerfile"))).toBe(false);
      throw new Error("build failed");
    })).rejects.toThrow("build failed");
    expect(fs.existsSync(staged)).toBe(false);
  });
  it("keeps Dockerfile-specific ignore precedence when base placeholders are materialized", async () => {
    const source = root(), result = path.join(source, "observed-ignore");
    const recipe = path.join(source, "chosen.Dockerfile");
    fs.writeFileSync(recipe, "FROM fc-e2b-registry.<region>.cr.aliyuncs.com/runtime/base:<tag>\nCOPY . /app\n");
    fs.writeFileSync(`${recipe}.dockerignore`, "specific-only\n!.env\n");
    fs.writeFileSync(path.join(source, ".dockerignore"), "root-only\n");
    const docker = path.join(source, "docker");
    fs.writeFileSync(docker, `#!/bin/sh\nif [ "$1" = buildx ]; then exit 0; fi\nwhile [ "$#" -gt 0 ]; do\n if [ "$1" = -f ]; then shift; cat "$1.dockerignore" > '${result}'; exit 0; fi\n shift\ndone\nexit 3\n`, {mode: 0o700});
    await withPrivateBuildContext(source, recipe, async value => {
      await new DockerBuilder(docker).build(value.context, "fixture/image:1", {dockerfile: value.dockerfile, timeout: 2});
      expect(fs.existsSync(path.join(value.context, "Dockerfile.abx-build"))).toBe(false);
      expect(fs.existsSync(path.join(value.context, "Dockerfile.abx-build.dockerignore"))).toBe(false);
    });
    expect(fs.readFileSync(result, "utf8")).toBe("specific-only\n!.env\n");
    expect(fs.readFileSync(recipe, "utf8")).toContain("<region>");
  });

  it("fingerprints dependencies, modes and symlink targets but excludes private files", () => {
    const source = root(), recipe = path.join(source, "Dockerfile");
    fs.writeFileSync(recipe, "FROM scratch\nCOPY . /app\n");
    fs.mkdirSync(path.join(source, "node_modules"));
    const dependency = path.join(source, "node_modules", "dep"); fs.writeFileSync(dependency, "version-one");
    fs.writeFileSync(path.join(source, ".env"), "first-private-fixture");
    const first = privateBuildFingerprint(source, recipe);
    fs.writeFileSync(path.join(source, ".env"), "second-private-fixture");
    expect(privateBuildFingerprint(source, recipe)).toBe(first);
    fs.writeFileSync(dependency, "version-two");
    const second = privateBuildFingerprint(source, recipe); expect(second).not.toBe(first);
    fs.chmodSync(dependency, 0o755);
    const third = privateBuildFingerprint(source, recipe); expect(third).not.toBe(second);
    fs.symlinkSync("node_modules/dep", path.join(source, "link"));
    const fourth = privateBuildFingerprint(source, recipe); expect(fourth).not.toBe(third);
    fs.unlinkSync(path.join(source, "link")); fs.symlinkSync("Dockerfile", path.join(source, "link"));
    expect(privateBuildFingerprint(source, recipe)).not.toBe(fourth);
  });

  it("rejects escaping symlinks instead of reading private external data", async () => {
    const source = root(); fs.writeFileSync(path.join(source, "Dockerfile"), "FROM scratch\n");
    fs.symlinkSync("../outside-private", path.join(source, "escape"));
    await expect(withPrivateBuildContext(source, path.join(source, "Dockerfile"), async () => {throw new Error("must not build");})).rejects.toThrow("inside the context");
  });
});

function fakeDocker(source: string, mode: "build" | "push" | "probe"): {docker: string; marker: string} {
  const marker = path.join(source, "escaped-descendant"), docker = path.join(source, "docker");
  fs.writeFileSync(docker, `#!/bin/sh\nif [ "$1" = buildx ]; then\n  ${mode === "probe" ? "sleep 10" : "exit 0"}\nfi\n(sleep 0.8; echo escaped > '${marker}') &\nwait\n`, {mode: 0o755});
  return {docker, marker};
}
describe("bounded Docker subprocesses", () => {
  it.each(["build", "push", "probe"] as const)("kills the actual %s child process group at deadline", async mode => {
    const source = root(), {docker, marker} = fakeDocker(source, mode); fs.writeFileSync(path.join(source, "Dockerfile"), "FROM scratch\n");
    const builder = new DockerBuilder(docker), before = Date.now();
    const action = mode === "push" ? builder.push("fixture/image:1", {timeout: 0.1}) : builder.build(source, "fixture/image:1", {timeout: 0.1});
    await expect(action).rejects.toThrow("deadline");
    expect(Date.now() - before).toBeLessThan(1500);
    await new Promise(resolve => setTimeout(resolve, 1000));
    expect(fs.existsSync(marker)).toBe(false);
  });
});
