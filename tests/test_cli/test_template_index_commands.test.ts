/**
 * CLI integration tests for the remote template index.
 *
 * `abx template search` queries the index and `abx template install <name>` resolves bare, non-builtin names through
 * it. Both commands are exercised fully offline: `fetchIndex` is mocked, so nothing here touches the network (or
 * GitHub rate limits).
 */

import "../_support/isolatedHome.js";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { cli } from "../../src/cli/main.js";
import { TemplateRef } from "../../src/models/template.js";
import * as registryMod from "../../src/utils/registry.js";
import * as templateIndexMod from "../../src/utils/template_index.js";
import { TemplateIndex, parseIndex } from "../../src/utils/template_index.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { setenv, spyAny, useTmpPath } from "../helpers/templateSupport.js";
import { vi } from "vitest";

const runner = (): CliRunner => new CliRunner();
const tmpPath = useTmpPath();

const INDEX_YAML = `\
schema_version: 2
templates:
  - name: qwen-code
    description: "Qwen Code agent harness"
    repo: https://github.com/alibaba-agent-sandbox/awesome-templates
    path: qwen-code
    tags: [qwen, ai-agent]
    author: alibaba-agent-sandbox
    status: official
  - name: node-web
    description: "Node.js web service"
    repo: https://github.com/alibaba-agent-sandbox/awesome-templates
    path: node-web
    tags: [nodejs, web, deploy]
    author: alibaba-agent-sandbox
    status: official
`;

const INDEX_URL = "https://example.test/awesome-templates.yaml";
const SOURCE_OF_TRUTH_REPO = "alibaba-agent-sandbox/awesome-templates";

const index = (): TemplateIndex => parseIndex(INDEX_YAML, { source_url: INDEX_URL });

function _patchIndex(idx: TemplateIndex) {
  return spyAny(templateIndexMod, "fetchIndex").mockResolvedValue(idx);
}

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "templates", "python-hello");

/** Copy the python-hello fixture so `install` can load a real template. */
function _fetchedCopy(): string {
  const dst = path.join(tmpPath(), "fetched", "qwen-code");
  fs.cpSync(FIXTURE, dst, { recursive: true });
  return dst;
}

/** Collect every JSON object/array element from JSON-mode CLI output. */
function _jsonEntries(output: string): Array<Record<string, unknown>> {
  const values: unknown[] = [];
  let text = output.trim();
  while (text.length) {
    let end = -1;
    for (let i = 1; i <= text.length; i++) {
      try {
        JSON.parse(text.slice(0, i));
        end = i;
        break;
      } catch {
        /* keep growing */
      }
    }
    if (end < 0) break;
    values.push(JSON.parse(text.slice(0, end)));
    text = text.slice(end).trim();
  }
  const entries: Array<Record<string, unknown>> = [];
  for (const value of values) {
    if (Array.isArray(value)) entries.push(...value.filter((v) => v !== null && typeof v === "object" && !Array.isArray(v)));
    else if (value !== null && typeof value === "object") entries.push(value as Record<string, unknown>);
  }
  return entries;
}

describe("TestSearchCommand", () => {
  it("test_search_lists_matching_entries", async () => {
    _patchIndex(index());
    const result = await runner().invoke(cli, ["template", "search", "qwen"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("qwen-code");
    expect(result.output).not.toContain("node-web");
  });

  it("test_search_matches_tags_and_descriptions", async () => {
    _patchIndex(index());
    const result = await runner().invoke(cli, ["template", "search", "web"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("node-web");
    expect(result.output).not.toContain("qwen-code");
  });

  it("test_search_tag_filter", async () => {
    _patchIndex(index());
    const result = await runner().invoke(cli, ["template", "search", "ai-agent", "--tag", "qwen"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("qwen-code");
  });

  it("test_search_status_filter", async () => {
    _patchIndex(index());
    const result = await runner().invoke(cli, ["template", "search", "qwen", "--status", "community"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("No templates matching");
  });

  it("test_search_no_match_message", async () => {
    _patchIndex(index());
    const result = await runner().invoke(cli, ["template", "search", "zzz-not-there"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("No templates matching");
  });

  it("test_search_prints_launch_hint_with_index_source", async () => {
    _patchIndex(index());
    const result = await runner().invoke(cli, ["template", "search", "qwen"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("template launch <name>");
    expect(result.output).toContain(INDEX_URL);
  });

  it("test_search_json_output", async () => {
    _patchIndex(index());
    const result = await runner().invoke(cli, ["-j", "template", "search", "qwen"]);
    expect(result.exit_code, result.output).toBe(0);
    const entries = _jsonEntries(result.output);
    const names = entries.map((e) => e["name"]).filter(Boolean);
    expect(names).toContain("qwen-code");
  });

  it("test_search_forwards_index_url_token_and_refresh", async () => {
    const mocked = _patchIndex(index());
    const result = await runner().invoke(cli, [
      "template", "search", "qwen", "--index-url", "https://mirror.test/idx.yaml", "--token", "gh-token-123", "--refresh",
    ]);
    expect(result.exit_code, result.output).toBe(0);
    const [url, kwargs] = mocked.mock.calls[0]! as [string, Record<string, unknown>];
    expect(url).toBe("https://mirror.test/idx.yaml");
    expect(kwargs["token"]).toBe("gh-token-123");
    expect(kwargs["force"]).toBe(true);
  });

  it("test_search_index_url_env_override", async () => {
    setenv("ABX_TEMPLATE_INDEX_URL", "https://mirror.test/from-env.yaml");
    const mocked = _patchIndex(index());
    const result = await runner().invoke(cli, ["template", "search", "qwen"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(mocked.mock.calls[0]![0]).toBe("https://mirror.test/from-env.yaml");
  });

  it("test_search_shows_stale_cache_notice", async () => {
    const idx = index();
    idx.stale = true;
    idx.notice = "GitHub rate limit exceeded while fetching the template index.";
    _patchIndex(idx);

    const result = await runner().invoke(cli, ["template", "search", "qwen"]);

    expect(result.exit_code, result.output).toBe(0);
    const combined = result.output + (result.stderr || "");
    expect(combined.toLowerCase()).toContain("rate limit");
  });
});

/** A RegistryClient whose *second* resolve (the index ref) is pinned. */
function _mockRegistryClient(opts: { resolved: TemplateRef; fetched: string }) {
  const resolve = vi
    .fn()
    .mockResolvedValueOnce(new TemplateRef({ is_builtin: true, tag: "qwen-code" }))
    .mockResolvedValueOnce(opts.resolved);
  const fetch = vi.fn(async () => opts.fetched);
  const client = { resolve, fetch };
  spyAny(registryMod, "RegistryClient").mockImplementation(function () {
    return client;
  });
  return client;
}

const qwenRef = (extra: Record<string, unknown> = {}): TemplateRef =>
  new TemplateRef({ owner: "alibaba-agent-sandbox", repo: "awesome-templates", path: "qwen-code", registry_type: "github", ...extra });

describe("TestInstallBareNameResolution", () => {
  it("test_install_bare_name_resolves_via_index", async () => {
    const fetched = _fetchedCopy();
    const client = _mockRegistryClient({ resolved: qwenRef(), fetched });
    _patchIndex(index());

    const result = await runner().invoke(cli, ["template", "install", "qwen-code", "--download-only"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("Resolved 'qwen-code' via the template index");
    expect(client.resolve.mock.calls[1]![0]).toBe(`${SOURCE_OF_TRUTH_REPO}//qwen-code`);
    const fetchedRef = (client.fetch.mock.calls[0] as unknown as [TemplateRef])[0];
    expect(fetchedRef.path).toBe("qwen-code");
    expect(fetchedRef.owner).toBe("alibaba-agent-sandbox");
  });

  it("test_install_honours_pinned_ref_from_index", async () => {
    const pinnedYaml = INDEX_YAML.replace("    path: qwen-code\n", "    path: qwen-code\n    ref: v1.2.0\n");
    const pinnedIndex = parseIndex(pinnedYaml, { source_url: INDEX_URL });
    const fetched = _fetchedCopy();
    const client = _mockRegistryClient({ resolved: qwenRef({ tag: "v1.2.0" }), fetched });
    _patchIndex(pinnedIndex);

    const result = await runner().invoke(cli, ["template", "install", "qwen-code", "--download-only"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(client.resolve.mock.calls[1]![0]).toBe(`${SOURCE_OF_TRUTH_REPO}//qwen-code@v1.2.0`);
  });

  it("test_install_builtin_name_does_not_touch_index", async () => {
    const mocked = _patchIndex(index());
    const result = await runner().invoke(cli, ["template", "install", "base"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(result.output.toLowerCase()).toContain("built-in");
    expect(mocked).not.toHaveBeenCalled();
  });

  it("test_install_unknown_bare_name_raises_friendly_not_found", async () => {
    const mocked = _patchIndex(index());
    const result = await runner().invoke(cli, ["template", "install", "no-such-template"]);
    expect(result.exit_code).not.toBe(0);
    const combined = result.output + (result.stderr || "");
    expect(combined).toContain("not found in the template index");
    expect(combined).toContain("abx template search");
    expect(((mocked.mock.calls.at(-1) as unknown[])[1] as Record<string, unknown>)["force"]).toBe(true);
  });

  it("test_install_shortcut_bare_name_resolves_via_index", async () => {
    const fetched = _fetchedCopy();
    const client = _mockRegistryClient({ resolved: qwenRef(), fetched });
    _patchIndex(index());

    const result = await runner().invoke(cli, ["template", "install", "qwen-code", "--download-only"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(client.resolve.mock.calls[1]![0]).toBe(`${SOURCE_OF_TRUTH_REPO}//qwen-code`);
  });
});


describe("published managed catalog commands", () => {
  const published = fs.readFileSync(new URL("../fixtures/catalog/awesome-templates.yaml", import.meta.url), "utf8");
  it.each(["base", "code-interpreter-v1", "desktop", "opensandbox-code-interpreter"])("search returns native identity for %s", async name => {
    const idx = parseIndex(published); _patchIndex(idx);
    const result = await runner().invoke(cli, ["--json", "template", "search", name]);
    expect(result.exit_code, result.output).toBe(0);
    expect(_jsonEntries(result.stdout).find(entry => entry.name === name)?.manifest).toEqual(idx.find(name)!.manifest);
  });
  it("redirects source installation of managed catalog entries to launch", async () => {
    _patchIndex(parseIndex(published));
    const fetch = vi.spyOn(registryMod.RegistryClient.prototype, "fetch");
    const result = await runner().invoke(cli, ["template", "install", "desktop"]);
    expect(result.exit_code).not.toBe(0);
    expect(result.output).toContain("template launch desktop");
    expect(fetch).not.toHaveBeenCalled();
  });
});
