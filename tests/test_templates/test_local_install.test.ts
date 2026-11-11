/** Source acquisition uses the real resolver/extractor; only archive download is stubbed. */
import "../_support/isolatedHome.js";
import dns from "node:dns";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cli } from "../../src/cli/main.js";
import { TEMPLATE_CACHE_DIR, _setTemplateCacheDir } from "../../src/utils/registry.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { useTmpPath } from "../helpers/templateSupport.js";
import { patchHttpxAsyncClient, patchedAsyncClient, restoreHttpx } from "../_support/patch.js";
import { tarArchive, tarEntry } from "../_support/tar.js";
import { discoverTemplateDirs, useSuppressCiDetection } from "./conftest.js";

const tmp = useTmpPath();
useSuppressCiDetection();
let cache = "";
const blockedCalls: unknown[][] = [];
function blocked(...args: unknown[]): never { blockedCalls.push(args); throw new Error("network access attempted during offline source acquisition"); }
beforeEach(() => {
  cache = TEMPLATE_CACHE_DIR; blockedCalls.length = 0;
  vi.spyOn(dns, "lookup").mockImplementation(blocked as never);
  vi.spyOn(net, "connect").mockImplementation(blocked as never);
  vi.spyOn(net, "createConnection").mockImplementation(blocked as never);
  _setTemplateCacheDir(path.join(tmp(), "cache"));
});
afterEach(() => { restoreHttpx(); _setTemplateCacheDir(cache); expect(blockedCalls).toEqual([]); });
const run = (args: string[]) => new CliRunner().invoke(cli, args);

function archive(directory: string): Buffer {
  const entries: Buffer[] = [];
  const walk = (relative: string): void => {
    for (const name of fs.readdirSync(path.join(directory, relative))) {
      const file = path.join(relative, name), full = path.join(directory, file);
      if (fs.statSync(full).isDirectory()) walk(file);
      else entries.push(tarEntry(`owner-repo-sha/template/${file}`, fs.readFileSync(full)));
    }
  };
  walk(""); return gzipSync(tarArchive(entries));
}

describe("template init source acquisition", () => {
  it("keeps the offline network tripwire active", () => {
    expect(() => dns.lookup("github.com", () => {})).toThrow(/network access/);
    expect(() => net.createConnection(443, "github.com")).toThrow(/network access/);
    blockedCalls.length = 0;
  });

  it.each(discoverTemplateDirs().map(source => [path.basename(source), source]))("copies local source byte-for-byte [%s]", async (_name, source) => {
    const target = path.join(tmp(), "copy");
    const result = await run(["--json", "template", "init", target, "--from", source, "--registry-type", "local"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(JSON.parse(result.stdout).directory).toBe(target);
    for (const name of ["template.yaml", "Dockerfile", "commands.py"])
      expect(fs.readFileSync(path.join(target, name))).toEqual(fs.readFileSync(path.join(source, name)));
  });

  it.each(discoverTemplateDirs().map(source => [path.basename(source), source]))("extracts a pinned GitHub subdirectory without cloud work [%s]", async (_name, source) => {
    patchHttpxAsyncClient(patchedAsyncClient({ content: archive(source), raiseForStatus: () => {} }));
    const target = path.join(tmp(), "copy");
    const result = await run(["template", "init", target, "--from", "owner/repo//template@v1.0.0"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(fs.readFileSync(path.join(target, "template.yaml"))).toEqual(fs.readFileSync(path.join(source, "template.yaml")));
  });

  it("refuses a missing local path without writing output", async () => {
    const target = path.join(tmp(), "copy");
    const result = await run(["template", "init", target, "--from", path.join(tmp(), "missing")]);
    expect(result.exit_code).not.toBe(0); expect(fs.existsSync(target)).toBe(false);
  });

  it("requires template.yaml for a local source and preserves the original", async () => {
    const source = path.join(tmp(), "source"), target = path.join(tmp(), "copy");
    fs.mkdirSync(source); fs.writeFileSync(path.join(source, "sandbox.yaml"), "name: retired\n");
    const result = await run(["template", "init", target, "--from", source]);
    expect(result.exit_code).not.toBe(0); expect(result.output).toContain("must contain template.yaml");
    expect(fs.existsSync(target)).toBe(false); expect(fs.existsSync(path.join(source, "sandbox.yaml"))).toBe(true);
  });

  it("copies malformed source for editing without executing YAML tags", async () => {
    const source = path.join(tmp(), "source"), target = path.join(tmp(), "copy");
    fs.mkdirSync(source); const text = "name: !!python/object/apply:os.system [echo invalid]\nspec_version: 999\n";
    fs.writeFileSync(path.join(source, "template.yaml"), text);
    const result = await run(["template", "init", target, "--from", source]);
    expect(result.exit_code, result.output).toBe(0);
    expect(fs.readFileSync(path.join(target, "template.yaml"), "utf8")).toBe(text);
  });

  it("rejects an invalid registry type before source acquisition", async () => {
    const target = path.join(tmp(), "invalid-kind");
    const result = await run(["template", "init", target, "--from", "owner/repo", "--registry-type", "invented"]);
    expect(result.exit_code).toBe(2);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("directs Dockerfile-only projects to adoption without copying source", async () => {
    const source = path.join(tmp(), "dockerfile-source"), target = path.join(tmp(), "copy");
    fs.mkdirSync(source); fs.writeFileSync(path.join(source, "Dockerfile"), "FROM python:3.12-slim\n");
    const result = await run(["template", "init", target, "--from", source]);
    expect(result.exit_code).not.toBe(0);
    expect(result.output).toContain("abx template init --adopt");
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.readFileSync(path.join(source, "Dockerfile"), "utf8")).toBe("FROM python:3.12-slim\n");
  });

  it("rejects a missing Git subdirectory without copying output", async () => {
    patchHttpxAsyncClient(patchedAsyncClient({ content: archive(discoverTemplateDirs()[0]!), raiseForStatus: () => {} }));
    const target = path.join(tmp(), "copy");
    const result = await run(["template", "init", target, "--from", "owner/repo//missing@v1.0.0"]);
    expect(result.exit_code).not.toBe(0);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("does not replace existing source without --force", async () => {
    const source = discoverTemplateDirs()[0], target = path.join(tmp(), "copy");
    fs.mkdirSync(target); fs.writeFileSync(path.join(target, "template.yaml"), "keep\n");
    const result = await run(["template", "init", target, "--from", source, "--yes"]);
    expect(result.exit_code).not.toBe(0); expect(result.output).toContain("--force");
    expect(fs.readFileSync(path.join(target, "template.yaml"), "utf8")).toBe("keep\n");
  });
});
