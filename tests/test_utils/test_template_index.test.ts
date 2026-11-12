/**
 * Unit tests for the remote template index client (`utils/template_index`).
 *
 * Everything runs offline: HTTP is intercepted by the `httpx_mock` helper (pytest-httpx equivalent) and the cache lives
 * in `tmp_path`. Covered behaviour:
 *
 * - parsing / schema_version validation / duplicate + malformed entries
 * - `install_ref` construction (`owner/repo//subdir@ref`)
 * - cache lifecycle (fresh hit, TTL, ETag revalidation, corruption tolerance)
 * - degraded modes: stale-cache fallback on network errors / rate limits, explicit errors without a cache, and
 *   remediation suggestions
 */

import fs from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";

import { describe, expect, it } from "vitest";

import {
  GitHubRateLimitError,
  NetworkError,
  TemplateNotFoundError,
  TemplateParseError,
} from "../../src/models/errors.js";
import { ConnectError } from "../../src/transport/_httpx.js";
import { FINE_GRAINED_PAT_URL } from "../../src/utils/github_token.js";
import {
  INDEX_META_FILE,
  INDEX_SCHEMA_VERSION,
  fetchIndex as fetch_index,
  parseIndex as parse_index,
  readCachedIndex as read_cached_index,
} from "../../src/utils/template_index.js";
import { useIsolatedEnv } from "../_support/env.js";
import { useHttpxMock } from "../helpers/httpxMock.js";

const iso = useIsolatedEnv();
const httpx_mock = useHttpxMock();
const metadata = (name: string) => ({ specVersion: 1, name, version: "1.0.0", description: { en: "Test template", zh: "测试模板" }, author: "test", license: "Apache-2.0", readme: { en: "README.md", zh: "README.zh-CN.md" } });

const INDEX_URL =
  "https://registry.agent-sandbox.cn/templates/index.json";

const INDEX_YAML = `\
schema_version: 3
templates:
  - name: qwen-code
    repo: https://github.com/alibaba-agent-sandbox/awesome-templates
    path: qwen-code
    status: official
    metadata:
      specVersion: 1
      name: qwen-code
      version: 1.0.0
      description:
        en: Qwen Code agent harness
        zh: 测试模板
      author: alibaba-agent-sandbox
      license: Apache-2.0
      tags:
        - qwen
        - ai-agent
      readme:
        en: README.md
        zh: README.zh-CN.md
  - name: node-web
    repo: https://github.com/alibaba-agent-sandbox/awesome-templates
    path: node-web
    status: official
    metadata:
      specVersion: 1
      name: node-web
      version: 1.0.0
      description:
        en: Node.js web service
        zh: 测试模板
      author: alibaba-agent-sandbox
      license: Apache-2.0
      tags:
        - nodejs
        - web
        - deploy
      readme:
        en: README.md
        zh: README.zh-CN.md
`;

/** Write an index cache file + metadata as a previous fetch would. */
function _seed_cache(
  cache_dir: string,
  opts: { text?: string; age?: number; etag?: string | null } = {},
): void {
  const { text = INDEX_YAML, age = 0.0, etag = null } = opts;
  fs.mkdirSync(cache_dir, { recursive: true });
  fs.writeFileSync(path.join(cache_dir, "awesome-templates.yaml"), text, "utf-8");
  fs.writeFileSync(
    path.join(cache_dir, INDEX_META_FILE),
    JSON.stringify({
      source_url: INDEX_URL,
      etag,
      fetched_at: Date.now() / 1000 - age,
    }),
    "utf-8",
  );
}

async function catchError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error("DID NOT RAISE");
}

// =========================================================================
// parse_index
// =========================================================================

describe("TestParseIndex", () => {
  // Pure parsing / validation of the index document.

  it("test_parses_entries_and_provenance", () => {
    const index = parse_index(INDEX_YAML, { source_url: INDEX_URL });

    expect(index.schema_version).toBe(INDEX_SCHEMA_VERSION);
    expect(index.source_url).toBe(INDEX_URL);
    expect(index.stale).toBe(false);
    expect(index.notice).toBe("");
    const names = index.entries.map((e) => e.name);
    expect(names).toEqual(["qwen-code", "node-web"]);
    const qwen = index.entries[0]!;
    expect(qwen.description).toBe("Qwen Code agent harness");
    expect(qwen.tags).toEqual(["qwen", "ai-agent"]);
    expect(qwen.author).toBe("alibaba-agent-sandbox");
    expect(qwen.manifest).toBeNull();
    expect(qwen.status).toBe("official");
  });

  it("test_missing_schema_version_is_rejected", () => {
    const text = INDEX_YAML.replace("schema_version: 3\n", "");
    expect(() => parse_index(text)).toThrow(TemplateParseError);
  });

  it("test_newer_schema_version_is_rejected", () => {
    const text = INDEX_YAML.replace("schema_version: 3", "schema_version: 99");
    let err: unknown;
    try {
      parse_index(text);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TemplateParseError);
    expect(String(err)).toContain("differs from supported");
    expect((err as TemplateParseError).suggestion || "").toContain("Upgrade abx");
    expect((err as TemplateParseError).suggestion || "").toContain("binary-installation.md");
  });

  it("test_non_integer_schema_version_is_rejected", () => {
    const text = INDEX_YAML.replace("schema_version: 3", 'schema_version: "one"');
    expect(() => parse_index(text)).toThrow(TemplateParseError);
    expect(() => parse_index(text)).toThrow(/non-integer schema_version/);
  });

  it("test_duplicate_names_are_rejected", () => {
    const entry = `\
  - name: dup
    repo: alibaba-agent-sandbox/awesome-templates
    path: dup
    metadata: ${JSON.stringify(metadata("dup"))}
`;
    const text = `schema_version: 3\ntemplates:\n${entry}${entry}`;
    expect(() => parse_index(text)).toThrow(TemplateParseError);
    expect(() => parse_index(text)).toThrow(/duplicate entry/);
  });

  it("test_missing_name_is_rejected", () => {
    const text = "schema_version: 3\ntemplates:\n  - repo: alibaba-agent-sandbox/awesome-templates\n";
    expect(() => parse_index(text)).toThrow(TemplateParseError);
    expect(() => parse_index(text)).toThrow(/missing the required 'name'/);
  });

  it("test_missing_repo_is_rejected", () => {
    const text = "schema_version: 3\ntemplates:\n  - name: x\n";
    expect(() => parse_index(text)).toThrow(TemplateParseError);
    expect(() => parse_index(text)).toThrow(/missing the required 'repo'/);
  });

  it("test_unsupported_host_is_rejected", () => {
    const text =
      "schema_version: 3\ntemplates:\n" + "  - name: x\n    repo: https://gitlab.com/owner/repo\n    path: x\n";
    expect(() => parse_index(text)).toThrow(TemplateParseError);
    expect(() => parse_index(text)).toThrow(/Unsupported template host/);
  });

  it("test_tags_must_be_a_string_list", () => {
    const text =
      "schema_version: 3\ntemplates:\n" +
      "  - name: x\n    repo: alibaba-agent-sandbox/awesome-templates\n" +
      "    path: x\n    tags: [1, 2]\n";
    expect(() => parse_index(text)).toThrow(TemplateParseError);
    expect(() => parse_index(text)).toThrow(/Registry v1 metadata/);
  });

  it("test_invalid_yaml_is_rejected", () => {
    expect(() => parse_index("templates: [unclosed")).toThrow(TemplateParseError);
    expect(() => parse_index("templates: [unclosed")).toThrow(/not valid YAML/);
  });

  it("test_missing_templates_list_is_rejected", () => {
    expect(() => parse_index("schema_version: 3\n")).toThrow(TemplateParseError);
    expect(() => parse_index("schema_version: 3\n")).toThrow(/no 'templates' list/);
  });

  it("rejects a remote locator-only catalog instead of losing description and tag search", () => {
    const value = { schema_version: 3, templates: [{name: "example", repo: "owner/repo", path: "example", registry: "example/registry.yaml"}] };
    expect(() => parse_index(stringify(value), {source_url: INDEX_URL})).toThrow("generated /templates/index.json");
  });

  it("reads contained local registry metadata without evaluating expressions or requiring runtime input", async () => {
    const root = iso.tmp_path, folder = path.join(root, "example"), file = path.join(root, "catalog.yaml"); fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, "registry.yaml"), stringify({...metadata("example"), tags: ["agents-api"], questions: []}));
    fs.writeFileSync(file, stringify({schema_version: 3, templates: [{name: "example", repo: "owner/repo", path: "example", registry: "example/registry.yaml"}]}));
    const value = await fetch_index(file);
    expect(value.filter("agents-api")[0].description).toBe("Test template");
    expect(fs.existsSync(path.join(folder, "template.yaml"))).toBe(false);
    const raw = parse(fs.readFileSync(file, "utf8")); raw.templates[0].registry = "../private.yaml";
    expect(() => parse_index(stringify(raw), {source_url: file})).toThrow("contained registry.yaml");
  });
});

describe("TestInstallRef", () => {
  // `install_ref` → the exact reference handed to the registry client.

  const _entry = (yaml_fragment: string) => {
    const text = `schema_version: 3\ntemplates:\n${yaml_fragment}`;
    const value = parse(text); value.templates[0].metadata = metadata(value.templates[0].name);
    return parse_index(stringify(value)).entries[0]!;
  };

  it("test_with_path", () => {
    const entry = _entry("  - name: x\n    repo: alibaba-agent-sandbox/awesome-templates\n    path: x\n");
    expect(entry.install_ref).toBe("alibaba-agent-sandbox/awesome-templates//x");
  });

  it("test_without_path", () => {
    const entry = _entry("  - name: x\n    repo: alibaba-agent-sandbox/awesome-templates\n");
    expect(entry.install_ref).toBe("alibaba-agent-sandbox/awesome-templates");
  });

  it("test_with_ref_pin", () => {
    const entry = _entry("  - name: x\n    repo: alibaba-agent-sandbox/awesome-templates\n    path: x\n    ref: v1.2.0\n");
    expect(entry.install_ref).toBe("alibaba-agent-sandbox/awesome-templates//x@v1.2.0");
  });

  it("test_github_url_repo_is_normalised", () => {
    const entry = _entry("  - name: x\n    repo: https://github.com/owner/repo.git\n    path: x\n");
    expect(entry.install_ref).toBe("owner/repo//x");
  });
});

describe("TestLookup", () => {
  // `find` / `filter` semantics used by search and install-by-name.

  it("test_find_is_case_insensitive", () => {
    const index = parse_index(INDEX_YAML);
    expect(index.find("QWEN-CODE")).not.toBeNull();
    expect(index.find("qwen")).toBeNull();
  });

  it("test_filter_matches_name_description_tags_and_author", () => {
    const index = parse_index(INDEX_YAML);
    expect(index.filter("web").map((e) => e.name)).toEqual(["node-web"]);
    expect(index.filter("qwen").map((e) => e.name)).toEqual(["qwen-code"]);
    expect(index.filter("agent-sandbox").map((e) => e.name)).toEqual(["qwen-code", "node-web"]);
  });

  it("test_filter_by_tag_and_status", () => {
    const index = parse_index(INDEX_YAML);
    expect(index.filter("", { tag: "deploy" }).map((e) => e.name)).toEqual(["node-web"]);
    expect(index.filter("", { status: "community" })).toEqual([]);
    expect(index.filter("", { status: "official" }).map((e) => e.name)).toEqual(["qwen-code", "node-web"]);
  });
});

// =========================================================================
// fetch_index — local files, cache lifecycle, degraded modes
// =========================================================================

describe("TestFetchIndexLocal", () => {
  // Local-file indexes bypass both network and cache.

  it("test_local_path_direct_read", async () => {
    const tmp_path = iso.tmp_path;
    const local = path.join(tmp_path, "index.yaml");
    fs.writeFileSync(local, INDEX_YAML, "utf-8");

    const index = await fetch_index(local, { cache_dir: path.join(tmp_path, "cache") });

    expect(index.entries.map((e) => e.name)).toEqual(["qwen-code", "node-web"]);
    expect(index.source_url).toBe(local);
    expect(fs.existsSync(path.join(tmp_path, "cache"))).toBe(false);
  });

  it("test_local_path_missing_raises_template_not_found", async () => {
    const tmp_path = iso.tmp_path;
    const call = () => fetch_index(path.join(tmp_path, "nope.yaml"), { cache_dir: path.join(tmp_path, "cache") });
    await expect(call()).rejects.toThrow(TemplateNotFoundError);
    await expect(call()).rejects.toThrow(/index file not found/);
  });
});

describe("TestFetchIndexNetwork", () => {
  // Network fetch, cache writes and conditional requests (httpx mocked).

  it("test_success_writes_cache_and_metadata", async () => {
    const tmp_path = iso.tmp_path;
    httpx_mock.add_response({ url: INDEX_URL, text: INDEX_YAML, headers: { ETag: '"abc123"' } });
    const cache_dir = path.join(tmp_path, "cache");

    const index = await fetch_index(INDEX_URL, { cache_dir });

    expect(index.entries.map((e) => e.name)).toEqual(["qwen-code", "node-web"]);
    expect(index.fetched_at).not.toBeNull();
    expect(fs.statSync(path.join(cache_dir, "awesome-templates.yaml")).isFile()).toBe(true);
    const meta = JSON.parse(fs.readFileSync(path.join(cache_dir, INDEX_META_FILE), "utf-8"));
    expect(meta["etag"]).toBe('"abc123"');
    expect(meta["source_url"]).toBe(INDEX_URL);

    // The cache round-trips through the same parser.
    const cached = read_cached_index(cache_dir);
    expect(cached).not.toBeNull();
    expect(cached!.entries.map((e) => e.name)).toEqual(["qwen-code", "node-web"]);
  });

  it("test_utf8_bom_is_cached_verbatim", async () => {
    const tmp_path = iso.tmp_path;
    const raw = Buffer.from(
      "\uFEFF" + stringify({ schema_version: 3, templates: [{ name: "x1", repo: "o/r", metadata: metadata("x1") }] }),
      "utf8",
    );
    httpx_mock.add_response({ url: INDEX_URL, content: raw });
    const cache_dir = path.join(tmp_path, "bom-cache");

    const index = await fetch_index(INDEX_URL, { cache_dir });

    expect(index.find("x1")).not.toBeNull();
    const cached = fs.readFileSync(path.join(cache_dir, "awesome-templates.yaml"));
    expect(cached.length).toBe(raw.length);
    expect(cached.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it("test_fresh_cache_short_circuits_network", async () => {
    const tmp_path = iso.tmp_path;
    _seed_cache(tmp_path, { age: 10.0 });

    const index = await fetch_index(INDEX_URL, { cache_dir: tmp_path });

    expect(index.stale).toBe(false);
    expect(httpx_mock.get_requests().length, "fresh cache must not hit the network").toBe(0);
  });

  it("test_force_bypasses_fresh_cache", async () => {
    const tmp_path = iso.tmp_path;
    _seed_cache(tmp_path, { age: 10.0 });
    httpx_mock.add_response({ url: INDEX_URL, text: INDEX_YAML.replaceAll("qwen-code", "qwen-code-v2") });

    const index = await fetch_index(INDEX_URL, { cache_dir: tmp_path, force: true });

    expect(index.entries.map((e) => e.name)).toEqual(["qwen-code-v2", "node-web"]);
    // The refreshed body replaced the cached one.
    expect(fs.readFileSync(path.join(tmp_path, "awesome-templates.yaml"), "utf-8")).toContain("qwen-code-v2");
  });

  it("test_expired_cache_sends_conditional_request", async () => {
    const tmp_path = iso.tmp_path;
    _seed_cache(tmp_path, { age: 99999.0, etag: '"v1"' });
    httpx_mock.add_response({ url: INDEX_URL, status_code: 304 });

    const index = await fetch_index(INDEX_URL, { cache_dir: tmp_path });

    const request = httpx_mock.get_request();
    expect(request).not.toBeNull();
    expect(request.headers.get("if-none-match")).toBe('"v1"');
    expect(index.stale).toBe(false);
    const meta = JSON.parse(fs.readFileSync(path.join(tmp_path, INDEX_META_FILE), "utf-8"));
    expect(meta["fetched_at"]).toBeGreaterThan(Date.now() / 1000 - 60); // metadata refreshed
  });

  it("does not forward GitHub credentials to the public Registry index", async () => {
    const tmp_path = iso.tmp_path;
    httpx_mock.add_response({ url: INDEX_URL, text: INDEX_YAML });

    await fetch_index(INDEX_URL, { token: "secret-token", cache_dir: path.join(tmp_path, "cache") });

    const request = httpx_mock.get_request();
    expect(request).not.toBeNull();
    expect(request.headers.get("authorization")).toBeNull();
  });
  it("sends a supplied token only to an explicitly selected private mirror", async () => {
    const url = "https://raw.githubusercontent.com/private/templates/main/index.json";
    httpx_mock.add_response({url, text: INDEX_YAML});
    await fetch_index(url, {token: "fixture-mirror-token", cache_dir: iso.tmp_path});
    expect(httpx_mock.get_request().headers.get("authorization")).toBe("Bearer fixture-mirror-token");
  });

  it("test_env_var_overrides_default_url", async () => {
    const tmp_path = iso.tmp_path;
    const local = path.join(tmp_path, "env-index.yaml");
    fs.writeFileSync(local, INDEX_YAML, "utf-8");
    iso.monkeypatch.setenv("ABX_TEMPLATE_INDEX_URL", local);

    const index = await fetch_index(null, { cache_dir: path.join(tmp_path, "cache") });

    expect(index.source_url).toBe(local);
  });

  it("test_newer_schema_from_network_fails_loudly", async () => {
    const tmp_path = iso.tmp_path;
    httpx_mock.add_response({ url: INDEX_URL, text: "schema_version: 99\ntemplates: []\n" });
    const err = await catchError(() => fetch_index(INDEX_URL, { cache_dir: path.join(tmp_path, "cache") }));
    expect(err).toBeInstanceOf(TemplateParseError);
    expect(String(err)).toMatch(/differs from supported/);
  });
});

describe("TestFetchIndexDegradedModes", () => {
  // Network failures / rate limits / bad URLs degrade explicitly.

  it("test_network_error_without_cache_raises", async () => {
    const tmp_path = iso.tmp_path;
    httpx_mock.add_exception(new ConnectError("connection refused"));

    const exc = await catchError(() => fetch_index(INDEX_URL, { cache_dir: path.join(tmp_path, "cache") }));
    expect(exc).toBeInstanceOf(NetworkError);
    expect(String(exc)).toMatch(/Could not reach the template index/);
    // The persistent config flow is the recommended remedy (task 206).
    expect((exc as NetworkError).suggestion || "").toContain("abx config set github_token");
  });

  it("test_network_error_with_cache_serves_stale", async () => {
    const tmp_path = iso.tmp_path;
    _seed_cache(tmp_path, { age: 99999.0 });
    httpx_mock.add_exception(new ConnectError("connection refused"));

    const index = await fetch_index(INDEX_URL, { cache_dir: tmp_path });

    expect(index.stale).toBe(true);
    expect(index.notice.toLowerCase()).toContain("cached index");
    expect(index.entries.map((e) => e.name)).toEqual(["qwen-code", "node-web"]);
  });

  it("test_rate_limit_with_cache_serves_stale_with_hint", async () => {
    const tmp_path = iso.tmp_path;
    _seed_cache(tmp_path, { age: 99999.0 });
    httpx_mock.add_response({
      url: INDEX_URL,
      status_code: 403,
      headers: { "X-RateLimit-Remaining": "0" },
      text: "API rate limit exceeded",
    });

    const index = await fetch_index(INDEX_URL, { cache_dir: tmp_path });

    expect(index.stale).toBe(true);
    // The unified rate-limit wording (task 206) drives the notice.
    expect(index.notice.toLowerCase()).toContain("rate limit");
    expect(index.notice).toContain("60/hour");
    expect(index.notice.toLowerCase()).toContain("cached index");
  });

  it("test_rate_limit_without_cache_raises_onboarding_error", async () => {
    const tmp_path = iso.tmp_path;
    httpx_mock.add_response({ url: INDEX_URL, status_code: 429 });

    const exc = await catchError(() => fetch_index(INDEX_URL, { cache_dir: path.join(tmp_path, "cache") }));
    expect(exc).toBeInstanceOf(GitHubRateLimitError);

    expect(String(exc).toLowerCase()).toContain("rate limit");
    expect(String(exc)).toContain("while fetching the template index");
    const suggestion = (exc as GitHubRateLimitError).suggestion || "";
    // Persistent, masked config first; leak-prone --token stays documented.
    expect(suggestion).toContain("abx config set github_token");
    expect(suggestion).toContain(FINE_GRAINED_PAT_URL);
    expect(suggestion).toContain("may leak");
    // CI sessions are pointed at secret injection…
    expect(suggestion).toContain("GITHUB_TOKEN");
    expect(suggestion.toLowerCase()).toContain("secret");
    // …plus the index-specific mirror alternative (kept as last sentence).
    expect(suggestion).not.toContain("install directly with");
    expect(suggestion).toContain("--index-url");
  });

  it("test_404_without_cache_mentions_url_check", async () => {
    const tmp_path = iso.tmp_path;
    httpx_mock.add_response({ url: INDEX_URL, status_code: 404 });

    const exc = await catchError(() => fetch_index(INDEX_URL, { cache_dir: path.join(tmp_path, "cache") }));
    expect(exc).toBeInstanceOf(NetworkError);
    expect(String(exc)).toMatch(/HTTP 404/);
    expect((exc as NetworkError).suggestion || "").toContain("Verify the index URL");
  });

  it("test_server_error_with_cache_serves_stale", async () => {
    const tmp_path = iso.tmp_path;
    _seed_cache(tmp_path, { age: 99999.0 });
    httpx_mock.add_response({ url: INDEX_URL, status_code: 503 });

    const index = await fetch_index(INDEX_URL, { cache_dir: tmp_path });

    expect(index.stale).toBe(true);
    expect(index.notice.toLowerCase()).toContain("server error");
  });

  it("test_unexpected_status_degrades_explicitly", async () => {
    const tmp_path = iso.tmp_path;
    httpx_mock.add_response({ url: INDEX_URL, status_code: 418 });

    const exc = await catchError(() => fetch_index(INDEX_URL, { cache_dir: path.join(tmp_path, "cache") }));
    expect(exc).toBeInstanceOf(NetworkError);
    expect(String(exc)).toMatch(/Unexpected HTTP 418/);
  });

  it("test_corrupt_cache_is_ignored", async () => {
    const tmp_path = iso.tmp_path;
    _seed_cache(tmp_path, { text: "not: [valid", age: 10.0 });

    // The corrupt cache is discarded → a network fetch happens instead of serving garbage (marked stale or otherwise).
    httpx_mock.add_response({ url: INDEX_URL, text: INDEX_YAML });
    const index = await fetch_index(INDEX_URL, { cache_dir: tmp_path });

    expect(index.stale).toBeFalsy();
    expect(index.entries.map((e) => e.name)).toEqual(["qwen-code", "node-web"]);
    expect(httpx_mock.get_requests().length).toBe(1);
  });
});


describe("public source and managed catalog", () => {
  const published = fs.readFileSync(new URL("../fixtures/catalog/awesome-templates.yaml", import.meta.url), "utf8");
  it("preserves all four native identities alongside 46 source locators", () => {
    const index = parse_index(published);
    expect(index.entries).toHaveLength(50);
    for (const [name, provider, template_id] of [
      ["base", "alicloud-express", "base"],
      ["code-interpreter-v1", "alicloud-express", "code-interpreter-v1"],
      ["desktop", "e2b", "desktop"],
      ["opensandbox-code-interpreter", "opensandbox", "opensandbox/code-interpreter:v1.1.0"],
    ]) {
      const entry = index.entries.find(item => item.name === name)!;
      expect(entry.manifest).toMatchObject({specVersion: 1, sandbox: {provider, template: {reference: template_id}, services: {}}});
      expect(entry.repo).toBe("");
      expect(entry.path).toBeNull();
    }
    expect(index.entries.find(item => item.name === "qwen-code")!.install_ref).toBe("alibaba-agent-sandbox/awesome-templates//qwen-code");
  });
  it("reads managed entries from an existing raw-YAML cache without a network refresh", () => {
    const directory = path.join(iso.tmp_path, "old-version-cache");
    _seed_cache(directory, {text: published});
    expect(read_cached_index(directory)!.find("base")!.manifest).toMatchObject({sandbox: {provider: "alicloud-express", template: {reference: "base"}}});
    expect(read_cached_index(directory)!.entries).toHaveLength(50);
  });
  it("rejects malformed managed rows and cross-list duplicate names", () => {
    expect(() => parse_index(INDEX_YAML + "managed_templates: {}\n")).toThrow(/managed_templates.*list/);
    expect(() => parse_index(INDEX_YAML + "managed_templates:\n  - name: missing-native\n")).toThrow(/v1 native resource/);
    const duplicate = {name: "qwen-code", metadata: metadata("qwen-code"), resource: {specVersion: 1, name: "qwen-code", sandbox: {provider: "alicloud-express", template: {reference: "base"}, services: {}}}};
    expect(() => parse_index(INDEX_YAML + stringify({managed_templates: [duplicate]}))).toThrow(/uplicate/);
  });
});
