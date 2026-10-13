/**
 * End-to-end `abx template install` tests for the template catalog (port of `tests/test_templates/test_local_install.py`).
 *
 * Drives the real CLI, the real reference resolver, the real fetch/cache logic and the real `loadTemplateFromYaml`
 * pipeline. Only one boundary is mocked: the GitHub archive download (`httpx.AsyncClient`). A tripwire on
 * `dns.lookup` / `net.connect` fails loudly if anything ever tries to reach the network.
 */

import "../_support/isolatedHome.js";

import dns from "node:dns";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cli } from "../../src/cli/main.js";
import { TEMPLATE_CACHE_DIR, _setTemplateCacheDir, loadTemplateFromYaml } from "../../src/utils/registry.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { useTmpPath } from "../helpers/templateSupport.js";
import { patchHttpxAsyncClient, patchedAsyncClient, restoreHttpx } from "../_support/patch.js";
import { tarArchive, tarEntry } from "../_support/tar.js";
import { TEMPLATES_DIR, discoverTemplateDirs, useSuppressCiDetection } from "./conftest.js";

const GITHUB_OWNER = "alibaba-agent-sandbox";
const GITHUB_REPO = "awesome-templates";
const GITHUB_TAG = "v1.0.0";
const GITHUB_REF = `${GITHUB_OWNER}/${GITHUB_REPO}`;
const GITHUB_URL = "https://github.com";

/** GitHub tarballs always wrap everything in a single `owner-repo-sha/` folder. */
const _ARCHIVE_PREFIX = `${GITHUB_OWNER}-${GITHUB_REPO}-9f8e7d6`;

const tmpPath = useTmpPath();
useSuppressCiDetection();

let originalCacheDir = "";
const blockedCalls: unknown[][] = [];

/** Tripwire: any DNS resolution / TCP connect attempt fails the test. */
function _blocked(...args: unknown[]): never {
  blockedCalls.push(args);
  throw new Error(`network access attempted during an offline template test (args=${JSON.stringify(args)})`);
}

beforeEach(() => {
  originalCacheDir = TEMPLATE_CACHE_DIR;
  blockedCalls.length = 0;
  vi.spyOn(dns, "lookup").mockImplementation(_blocked as never);
  vi.spyOn(net, "connect").mockImplementation(_blocked as never);
  vi.spyOn(net, "createConnection").mockImplementation(_blocked as never);
});

afterEach(() => {
  restoreHttpx();
  _setTemplateCacheDir(originalCacheDir);
  expect(blockedCalls, "network access attempted during an offline template test").toEqual([]);
});

const runner = (): CliRunner => new CliRunner();

describe("TestOfflineGuard", () => {
  // The tripwire itself must work, otherwise 'offline' is just a comment.
  it("test_dns_resolution_is_blocked", () => {
    expect(() => dns.lookup("github.com", () => {})).toThrow(/network access attempted/);
    blockedCalls.length = 0;
  });

  it("test_tcp_connect_is_blocked", () => {
    expect(() => net.createConnection(443, "github.com")).toThrow(/network access attempted/);
    blockedCalls.length = 0;
  });
});

/** stdout + stderr + exception text (non-`SandboxError` exceptions are parked on `result.exception`). */
function _combined_output(result: { output: string; stderr: string; exception: unknown }): string {
  const exception = result.exception as (Error & { constructor: { name: string } }) | null;
  const excText = exception ? `${exception.constructor.name}: ${exception.message ?? String(exception)}` : "";
  return `${result.output}\n${result.stderr || ""}\n${excText}`;
}

/** Decode every concatenated JSON object in `--json` CLI output. */
function _json_objects(output: string): Array<Record<string, unknown>> {
  const text = output.trim();
  const objects: Array<Record<string, unknown>> = [];
  let index = 0;
  while (index < text.length) {
    const brace = text.indexOf("{", index);
    if (brace === -1) break;
    let depth = 0;
    let inString = false;
    let end = -1;
    for (let i = brace; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (ch === "\\") i++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    if (end === -1) {
      index = brace + 1;
      continue;
    }
    try {
      const value: unknown = JSON.parse(text.slice(brace, end));
      if (value !== null && typeof value === "object" && !Array.isArray(value)) objects.push(value as Record<string, unknown>);
      index = end;
    } catch {
      index = brace + 1;
    }
  }
  return objects;
}

function _install_payload(output: string): Record<string, unknown> {
  for (const obj of _json_objects(output)) if (obj["Status"] === "installed-locally") return obj;
  throw new Error(`no install payload in --json output:\n${output}`);
}

const isDir = (p: string): boolean => fs.existsSync(p) && fs.statSync(p).isDirectory();
const isFile = (p: string): boolean => fs.existsSync(p) && fs.statSync(p).isFile();
const baseName = (p: string): string => path.basename(p);
const templateDirs = discoverTemplateDirs();
const cacheDirIn = (): string => path.join(tmpPath(), "abx-cache");

const INSTALL_LOCAL = ["--registry-type", "local", "--download-only"];

describe("TestLocalInstall", () => {
  // `abx template install <path> --registry-type local` for every catalog template (never builds or pushes an image).
  it.each(templateDirs)("test_local_install_succeeds [%s]", async (template_dir) => {
    const expected = loadTemplateFromYaml(path.join(template_dir, "template.yaml"));
    const cache_dir = cacheDirIn();
    _setTemplateCacheDir(cache_dir);

    const result = await runner().invoke(cli, ["template", "install", template_dir, ...INSTALL_LOCAL]);

    expect(result.exit_code, _combined_output(result)).toBe(0);
    expect(result.output).toContain("Using local template from");
    const cached = path.join(cache_dir, expected.name);
    expect(isDir(cached), `template not cached at ${cached}`).toBe(true);
    expect(isFile(path.join(cached, "template.yaml"))).toBe(true);
  });

  it.each(templateDirs)("test_local_install_caches_template_files [%s]", async (template_dir) => {
    // Cached template must contain the essential files from the source.
    const expected = loadTemplateFromYaml(path.join(template_dir, "template.yaml"));
    const cache_dir = cacheDirIn();
    _setTemplateCacheDir(cache_dir);

    const result = await runner().invoke(cli, ["template", "install", template_dir, ...INSTALL_LOCAL]);

    expect(result.exit_code, _combined_output(result)).toBe(0);
    const cached = path.join(cache_dir, expected.name);
    const cached_tmpl = loadTemplateFromYaml(path.join(cached, "template.yaml"));
    expect(cached_tmpl.name).toBe(expected.name);
    expect(cached_tmpl.description).toBe(expected.description);
  });

  it.each(templateDirs)("test_local_install_relative_path_autodetected [%s]", async (template_dir) => {
    // A `./`-prefixed ref is local even without `--registry-type`.
    const rel = path.relative(process.cwd(), template_dir);
    const underCwd = rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
    const relative = underCwd ? `./${rel.split(path.sep).join("/")}` : template_dir;
    _setTemplateCacheDir(cacheDirIn());

    const result = await runner().invoke(cli, ["template", "install", relative, "--download-only"]);

    expect(result.exit_code, _combined_output(result)).toBe(0);
    expect(result.output).toContain("Using local template from");
  });

  it.each(templateDirs)("test_local_install_alias_override [%s]", async (template_dir) => {
    const cache_dir = cacheDirIn();
    _setTemplateCacheDir(cache_dir);
    const alias = `custom-${baseName(template_dir)}`;

    const result = await runner().invoke(cli, ["template", "install", template_dir, "--registry-type", "local", "--alias", alias, "--download-only"]);

    expect(result.exit_code, _combined_output(result)).toBe(0);
    expect(result.output).toContain(alias);
    const cached = path.join(cache_dir, alias);
    expect(isDir(cached), `template not cached under alias at ${cached}`).toBe(true);
  });

  it.each(templateDirs)("test_local_install_long_form_equivalent [%s]", async (template_dir) => {
    // `abx template install` and `abx install` behave identically.
    _setTemplateCacheDir(cacheDirIn());
    const shortcut = await runner().invoke(cli, ["template", "install", template_dir, ...INSTALL_LOCAL]);
    _setTemplateCacheDir(path.join(tmpPath(), "abx-cache-2"));
    const long_form = await runner().invoke(cli, ["template", "install", template_dir, ...INSTALL_LOCAL]);

    expect(shortcut.exit_code, _combined_output(shortcut)).toBe(0);
    expect(long_form.exit_code, _combined_output(long_form)).toBe(0);
  });

  it.each(templateDirs)("test_local_install_json_output [%s]", async (template_dir) => {
    const expected = loadTemplateFromYaml(path.join(template_dir, "template.yaml"));
    _setTemplateCacheDir(cacheDirIn());

    const result = await runner().invoke(cli, ["--json", "template", "install", template_dir, ...INSTALL_LOCAL]);

    expect(result.exit_code, _combined_output(result)).toBe(0);
    const payload = _install_payload(result.output);
    expect(payload["Alias"]).toBe(expected.name);
    expect(payload["Status"]).toBe("installed-locally");
    expect("Cached" in payload).toBe(true);
    expect("Source" in payload).toBe(true);
  });
});

describe("TestLocalInstallFailures", () => {
  // Negative paths must fail loudly rather than silently proceeding.
  const mentionsYaml = (combined: string): boolean =>
    combined.includes("template.yaml") || combined.includes("sandbox-template.yaml") || combined.includes("sandbox.yaml");

  it("test_missing_directory", async () => {
    const missing = path.join(tmpPath(), "does-not-exist");
    const result = await runner().invoke(cli, ["template", "install", missing, "--registry-type", "local"]);
    expect(result.exit_code).not.toBe(0);
  });

  it("test_directory_without_yaml_or_dockerfile", async () => {
    const empty = path.join(tmpPath(), "empty-template");
    fs.mkdirSync(empty);
    const result = await runner().invoke(cli, ["template", "install", empty, "--registry-type", "local"]);
    expect(result.exit_code).not.toBe(0);
    expect(mentionsYaml(_combined_output(result))).toBe(true);
  });

  it("test_dockerfile_only_is_accepted_but_has_no_yaml", async () => {
    // A bare Dockerfile passes fetch() but install still needs the YAML.
    const folder = path.join(tmpPath(), "dockerfile-only");
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, "Dockerfile"), "FROM ubuntu:22.04\n", "utf-8");

    const result = await runner().invoke(cli, ["template", "install", folder, "--registry-type", "local"]);

    expect(result.exit_code).not.toBe(0);
    expect(mentionsYaml(_combined_output(result))).toBe(true);
  });

  it("test_invalid_yaml_is_rejected", async () => {
    const folder = path.join(tmpPath(), "broken");
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, "template.yaml"), "name: broken\ncapabilities:\n  - not-a-real-capability\n", "utf-8");
    const result = await runner().invoke(cli, ["template", "install", folder, "--registry-type", "local"]);
    expect(result.exit_code).not.toBe(0);
    expect(_combined_output(result).toLowerCase()).toContain("capability");
  });
});

/**
 * Build an in-memory GitHub-style tarball (.tar.gz) of the fixtures: `<prefix>/README.md` plus every template folder.
 * Local dev artifacts (`__pycache__`, `*.pyc`, dotfiles) are excluded, like real GitHub archives.
 */
function build_repo_tarball(templates_dir: string): Buffer {
  const skip = (rel: string[]): boolean => rel.some((part) => part === "__pycache__" || part.startsWith(".")) || rel[rel.length - 1]!.endsWith(".pyc");
  const walk = (dir: string, rel: string[]): string[][] =>
    fs
      .readdirSync(dir)
      .sort()
      .flatMap((name) => {
        const full = path.join(dir, name);
        return fs.statSync(full).isDirectory() ? walk(full, [...rel, name]) : [[...rel, name]];
      });

  const entries: Buffer[] = [];
  const mtime = Math.floor(Date.now() / 1000);
  const readme = path.join(templates_dir, "README.md");
  if (isFile(readme)) entries.push(tarEntry(`${_ARCHIVE_PREFIX}/README.md`, fs.readFileSync(readme), mtime));
  for (const folder of fs.readdirSync(templates_dir).sort()) {
    const folderPath = path.join(templates_dir, folder);
    if (!isDir(folderPath) || folder.startsWith(".")) continue;
    for (const rel of walk(folderPath, [])) {
      if (skip(rel)) continue;
      entries.push(tarEntry(`${_ARCHIVE_PREFIX}/${folder}/${rel.join("/")}`, fs.readFileSync(path.join(folderPath, ...rel)), mtime));
    }
  }
  return gzipSync(tarArchive(entries));
}

/** Names stored in a ustar archive (regular entries only; our own builder never emits long-name extensions). */
function tarNames(gz: Buffer): string[] {
  const raw = gunzipSync(gz);
  const names: string[] = [];
  for (let off = 0; off + 512 <= raw.length; ) {
    const header = raw.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString("utf-8").replace(/\0.*$/s, "");
    const size = parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/s, "").trim() || "0", 8);
    names.push(name);
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}

/** Patch the GitHub boundary: only the tarball archive bytes (`_downloadAndExtract` stays real). */
function mockedGithub(tarball: Buffer, cache_dir: string): ReturnType<typeof patchedAsyncClient> {
  const client = patchedAsyncClient({ content: tarball, raiseForStatus: () => {} });
  patchHttpxAsyncClient(client);
  _setTemplateCacheDir(cache_dir);
  return client;
}

const anySubdir = (dir: string): boolean => fs.readdirSync(dir).some((n) => isDir(path.join(dir, n)));

describe("TestMockedGithubInstall", () => {
  // `abx install owner/repo//<template> --registry-type github` offline.
  it.each(templateDirs)("test_github_install_subdir [%s]", async (template_dir) => {
    const tarball = build_repo_tarball(TEMPLATES_DIR);
    const cache_dir = cacheDirIn();
    const ref = `${GITHUB_REF}//${baseName(template_dir)}@${GITHUB_TAG}`;
    const expected = loadTemplateFromYaml(path.join(template_dir, "template.yaml"));

    const downloader = mockedGithub(tarball, cache_dir);
    const result = await runner().invoke(cli, ["template", "install", ref, "--registry-type", "github", "--registry-url", GITHUB_URL, "--download-only"]);

    expect(result.exit_code, _combined_output(result)).toBe(0);
    expect(result.output).toContain(`Fetching template from ${GITHUB_REF}`);
    expect(downloader.get).toHaveBeenCalledTimes(1);

    // real cache layout: ~/.abx/templates/<owner>/<repo>/<ref>/<subdir>
    const cached = path.join(cache_dir, GITHUB_OWNER, GITHUB_REPO, GITHUB_TAG, baseName(template_dir));
    expect(isFile(path.join(cached, "template.yaml")), `template was not cached at ${cached}`).toBe(true);
    expect(isFile(path.join(cached, "Dockerfile"))).toBe(true);
    expect(isFile(path.join(cached, "README.md"))).toBe(true);
    // sibling templates must NOT leak into this cache entry
    expect(anySubdir(cached), "subdir extraction pulled in unrelated folders").toBe(false);

    const cached_tmpl = loadTemplateFromYaml(path.join(cached, "template.yaml"));
    expect(cached_tmpl.name).toBe(expected.name);
  });

  it.each(templateDirs)("test_github_install_uses_cache_on_second_run [%s]", async (template_dir) => {
    const tarball = build_repo_tarball(TEMPLATES_DIR);
    const ref = `${GITHUB_REF}//${baseName(template_dir)}@${GITHUB_TAG}`;

    const downloader = mockedGithub(tarball, cacheDirIn());
    const first = await runner().invoke(cli, ["template", "install", ref, "--registry-type", "github", "--download-only"]);
    const second = await runner().invoke(cli, ["template", "install", ref, "--registry-type", "github", "--download-only"]);

    expect(first.exit_code, _combined_output(first)).toBe(0);
    expect(second.exit_code, _combined_output(second)).toBe(0);
    // second run is served from cache -> no extra tarball download
    expect(downloader.get).toHaveBeenCalledTimes(1);
  });

  it.each(templateDirs)("test_github_install_default_branch_no_ref [%s]", async (template_dir) => {
    // A ref without `@ref` fetches the default-branch tarball, cached as 'default'.
    const tarball = build_repo_tarball(TEMPLATES_DIR);
    const cache_dir = cacheDirIn();
    const ref = `${GITHUB_REF}//${baseName(template_dir)}`;

    const downloader = mockedGithub(tarball, cache_dir);
    const result = await runner().invoke(cli, ["template", "install", ref, "--registry-type", "github", "--download-only"]);

    expect(result.exit_code, _combined_output(result)).toBe(0);
    expect(downloader.get).toHaveBeenCalledTimes(1);
    const called_url = String(downloader.get.mock.calls[0]![0]);
    expect(called_url.endsWith(`/repos/${GITHUB_REF}/tarball`), called_url).toBe(true);
    const cached = path.join(cache_dir, GITHUB_OWNER, GITHUB_REPO, "default", baseName(template_dir));
    expect(isFile(path.join(cached, "template.yaml"))).toBe(true);
  });

  it.each(templateDirs)("test_github_install_alias_override [%s]", async (template_dir) => {
    const tarball = build_repo_tarball(TEMPLATES_DIR);
    const ref = `${GITHUB_REF}//${baseName(template_dir)}@${GITHUB_TAG}`;

    mockedGithub(tarball, cacheDirIn());
    const result = await runner().invoke(cli, ["template", "install", ref, "--registry-type", "github", "--alias", "gh-alias", "--download-only"]);

    expect(result.exit_code, _combined_output(result)).toBe(0);
    expect(result.output).toContain("gh-alias");
  });

  it("test_github_install_whole_repo_without_subdir_fails", async () => {
    // This catalog is multi-template: the repo root has no YAML of its own.
    const tarball = build_repo_tarball(TEMPLATES_DIR);

    mockedGithub(tarball, cacheDirIn());
    const result = await runner().invoke(cli, ["template", "install", `${GITHUB_REF}@${GITHUB_TAG}`, "--registry-type", "github"]);

    expect(result.exit_code).not.toBe(0);
    const combined = _combined_output(result);
    expect(combined.includes("template.yaml") || combined.includes("sandbox-template.yaml") || combined.includes("sandbox.yaml")).toBe(true);
  });
});

describe("TestSandboxYamlAliasInstall", () => {
  // Templates using sandbox.yaml (not template.yaml) install.
  it("test_local_install_sandbox_yaml_only", async () => {
    // A directory with only sandbox.yaml should install successfully.
    const tmpl_dir = path.join(tmpPath(), "alias-template");
    fs.mkdirSync(tmpl_dir);
    fs.writeFileSync(
      path.join(tmpl_dir, "sandbox.yaml"),
      "name: alias-template\n" +
        "version: '1.0.0'\n" +
        "description: Template using sandbox.yaml alias\n" +
        "base: ubuntu:22.04\n" +
        "author: test\n" +
        "tags:\n  - test\n" +
        "capabilities:\n  - shell\n  - files\n  - code\n",
      "utf-8",
    );
    fs.writeFileSync(path.join(tmpl_dir, "Dockerfile"), "FROM ubuntu:22.04\n", "utf-8");
    fs.writeFileSync(path.join(tmpl_dir, "README.md"), "# Alias template\n", "utf-8");
    const cache_dir = cacheDirIn();
    _setTemplateCacheDir(cache_dir);

    const result = await runner().invoke(cli, ["template", "install", tmpl_dir, ...INSTALL_LOCAL]);

    expect(result.exit_code, _combined_output(result)).toBe(0);
    expect(result.output).toContain("Using local template from");
    expect(isDir(path.join(cache_dir, "alias-template"))).toBe(true);
  });

  it("test_template_yaml_preferred_over_sandbox_yaml", async () => {
    // When both files exist, template.yaml takes priority.
    const tmpl_dir = path.join(tmpPath(), "both-yamls");
    fs.mkdirSync(tmpl_dir);
    fs.writeFileSync(
      path.join(tmpl_dir, "template.yaml"),
      "name: both-yamls\n" +
        "version: '1.0.0'\n" +
        "description: Canonical file\n" +
        "base: python:3.11-slim\n" +
        "author: test\n" +
        "tags:\n  - test\n" +
        "capabilities:\n  - shell\n  - files\n  - code\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmpl_dir, "sandbox.yaml"),
      "name: both-yamls-alt\n" +
        "version: '2.0.0'\n" +
        "description: Alias file - should not be used\n" +
        "base: node:20-slim\n" +
        "author: test\n" +
        "tags:\n  - test\n" +
        "capabilities:\n  - shell\n  - files\n  - code\n",
      "utf-8",
    );
    fs.writeFileSync(path.join(tmpl_dir, "Dockerfile"), "FROM python:3.11-slim\n", "utf-8");
    const cache_dir = cacheDirIn();
    _setTemplateCacheDir(cache_dir);

    const result = await runner().invoke(cli, ["template", "install", tmpl_dir, ...INSTALL_LOCAL]);

    expect(result.exit_code, _combined_output(result)).toBe(0);
    // The canonical template.yaml name should be used (both-yamls, not both-yamls-alt)
    expect(result.output).toContain("both-yamls");
    expect(isDir(path.join(cache_dir, "both-yamls"))).toBe(true);
  });
});

describe("TestMockedGithubInstallFailures", () => {
  it("test_github_install_missing_subdir_fails", async () => {
    const tarball = build_repo_tarball(TEMPLATES_DIR);

    mockedGithub(tarball, cacheDirIn());
    const result = await runner().invoke(cli, ["template", "install", `${GITHUB_REF}//no-such-template@${GITHUB_TAG}`, "--registry-type", "github"]);

    expect(result.exit_code).not.toBe(0);
  });
});

describe("TestTarballFixture", () => {
  // The offline GitHub fixture must faithfully represent the fixture folder.
  it("test_tarball_contains_every_fixture_template", () => {
    const tarball = build_repo_tarball(TEMPLATES_DIR);
    const names = tarNames(tarball);

    expect(names.length, "tarball fixture is empty").toBeGreaterThan(0);
    expect(names.every((n) => n.startsWith(`${_ARCHIVE_PREFIX}/`))).toBe(true);

    for (const folder of discoverTemplateDirs()) {
      for (const filename of ["template.yaml", "Dockerfile", "README.md"]) {
        const expected = `${_ARCHIVE_PREFIX}/${baseName(folder)}/${filename}`;
        expect(names, `tarball fixture is missing ${expected}`).toContain(expected);
      }
    }
  });

  it("test_tarball_extracts_to_loadable_templates", async () => {
    // Round-trip: extract the fixture and load every template from it.
    const tarball = build_repo_tarball(TEMPLATES_DIR);
    const dest = path.join(tmpPath(), "extract");
    const names = tarNames(tarball);
    const raw = gunzipSync(tarball);
    for (let off = 0, i = 0; i < names.length; i++) {
      const header = raw.subarray(off, off + 512);
      const size = parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/s, "").trim() || "0", 8);
      const target = path.join(dest, names[i]!);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, raw.subarray(off + 512, off + 512 + size));
      off += 512 + Math.ceil(size / 512) * 512;
    }

    const root = path.join(dest, _ARCHIVE_PREFIX);
    for (const folder of discoverTemplateDirs()) {
      const extracted = path.join(root, baseName(folder), "template.yaml");
      expect(isFile(extracted)).toBe(true);
      const tmpl = loadTemplateFromYaml(extracted);
      expect(tmpl.name).toBe(baseName(folder));
    }
  });
});
