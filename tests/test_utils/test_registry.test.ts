import { manifestYaml } from "../helpers/templateManifest.js";
/** Tests for RegistryClient. */

import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ValueError } from "../../src/models/value_error.js";
import { GitHubRateLimitError, NetworkError, TemplateNotFoundError } from "../../src/models/errors.js";
import { TemplateRef } from "../../src/models/template.js";
import { Request, Response } from "../../src/transport/_httpx.js";
import { FINE_GRAINED_PAT_URL } from "../../src/utils/github_token.js";
import { BUILTIN_TEMPLATES, RegistryClient, TEMPLATE_CACHE_DIR, _setTemplateCacheDir, loadTemplateFromYaml } from "../../src/utils/registry.js";
import { useIsolatedEnv } from "../_support/env.js";
import { patchHttpxAsyncClient, patchedAsyncClient, restoreHttpx } from "../_support/patch.js";
import { makeTarGz } from "../_support/tar.js";

const iso = useIsolatedEnv();
let originalCacheDir = "";

beforeEach(() => {
  originalCacheDir = TEMPLATE_CACHE_DIR;
});

afterEach(() => {
  restoreHttpx();
  _setTemplateCacheDir(originalCacheDir);
});

/** 构造一个内存中的 .tar.gz，模拟 GitHub tarball（顶层单目录）。 */
function _make_tarball(files: Record<string, string>, prefix = "owner-repo-abc123"): Buffer {
  return makeTarGz(files, prefix);
}

/** 模拟 tarball 下载响应（带 .content 与 raise_for_status）。 */
function _fake_tarball_response(tarball: Buffer) {
  return { content: tarball, raiseForStatus: () => {} };
}

const _patched_async_client = patchedAsyncClient;

function lastGetCall(patched: ReturnType<typeof patchedAsyncClient>): { args: unknown[]; headers: Record<string, string> } {
  const call = patched.get.mock.calls.at(-1) as unknown[];
  return { args: call, headers: (call[1] as { headers: Record<string, string> }).headers };
}

describe("TestRegistryClientResolve", () => {
  // Tests for RegistryClient.resolve().

  it("test_resolve_builtin", async () => {
    const client = new RegistryClient();
    const ref = await client.resolve("base");
    expect(ref.is_builtin).toBe(true);
    expect(ref.tag).toBe("base");
  });

  it("test_resolve_builtin_code_interpreter", async () => {
    const client = new RegistryClient();
    const ref = await client.resolve("code-interpreter-v1");
    expect(ref.is_builtin).toBe(true);
    expect(ref.tag).toBe("code-interpreter-v1");
  });

  it("test_resolve_unknown_single_name", async () => {
    // Single name without slash → treated as builtin.
    const client = new RegistryClient();
    const ref = await client.resolve("my-custom");
    expect(ref.is_builtin).toBe(true);
    expect(ref.tag).toBe("my-custom");
  });

  it("test_resolve_github_latest", async () => {
    const client = new RegistryClient();
    const ref = await client.resolve("owner/repo");
    expect(ref.is_builtin).toBe(false);
    expect(ref.owner).toBe("owner");
    expect(ref.repo).toBe("repo");
    expect(ref.tag).toBeNull();
  });

  it("test_resolve_github_tagged", async () => {
    const client = new RegistryClient();
    const ref = await client.resolve("owner/repo@v1.0");
    expect(ref.is_builtin).toBe(false);
    expect(ref.owner).toBe("owner");
    expect(ref.repo).toBe("repo");
    expect(ref.tag).toBe("v1.0");
  });

  it("test_resolve_custom_registry", async () => {
    const client = new RegistryClient("https://git.example.com");
    const ref = await client.resolve("org/templates");
    expect(ref.registry_url).toBe("https://git.example.com");
  });

  it("test_resolve_subdir_latest", async () => {
    // owner/repo//subdir → 子目录 latest
    const client = new RegistryClient();
    const ref = await client.resolve("owner/repo//path/to/subdir");
    expect(ref.is_builtin).toBe(false);
    expect(ref.owner).toBe("owner");
    expect(ref.repo).toBe("repo");
    expect(ref.path).toBe("path/to/subdir");
    expect(ref.tag).toBeNull();
  });

  it("test_resolve_subdir_tagged", async () => {
    // owner/repo//subdir@v1.0 → 子目录 + 版本
    const client = new RegistryClient();
    const ref = await client.resolve("owner/repo//templates/python@v2.0");
    expect(ref.is_builtin).toBe(false);
    expect(ref.owner).toBe("owner");
    expect(ref.repo).toBe("repo");
    expect(ref.path).toBe("templates/python");
    expect(ref.tag).toBe("v2.0");
  });

  it("test_resolve_subdir_single_level", async () => {
    // owner/repo//subdir → 单层子目录
    const client = new RegistryClient();
    const ref = await client.resolve("owner/repo//vpc");
    expect(ref.is_builtin).toBe(false);
    expect(ref.owner).toBe("owner");
    expect(ref.repo).toBe("repo");
    expect(ref.path).toBe("vpc");
    expect(ref.tag).toBeNull();
  });

  it("test_resolve_subdir_trailing_slash_stripped", async () => {
    // 子目录路径尾部斜杠应被清理。
    const client = new RegistryClient();
    const ref = await client.resolve("owner/repo//subdir/");
    expect(ref.path).toBe("subdir");
  });

  it("test_resolve_no_path_without_double_slash", async () => {
    // 普通 owner/repo 不应解析出 path。
    const client = new RegistryClient();
    const ref = await client.resolve("owner/repo");
    expect(ref.path).toBeNull();
  });

  it("test_resolve_no_path_with_tag_only", async () => {
    // owner/repo@v1.0 不应解析出 path。
    const client = new RegistryClient();
    const ref = await client.resolve("owner/repo@v1.0");
    expect(ref.path).toBeNull();
  });

  it("test_resolve_subdir", async () => {
    // 解析 owner/repo//subdir 格式。
    const client = new RegistryClient();
    const ref = await client.resolve("demo/demo//templates/python-data");
    expect(ref.is_builtin).toBe(false);
    expect(ref.owner).toBe("demo");
    expect(ref.repo).toBe("demo");
    expect(ref.path).toBe("templates/python-data");
    expect(ref.tag).toBeNull();
  });

  it("test_resolve_subdir_with_tag", async () => {
    // 解析 owner/repo//subdir@v1.0 格式。
    const client = new RegistryClient();
    const ref = await client.resolve("demo/demo//templates/node-web@v1.0");
    expect(ref.is_builtin).toBe(false);
    expect(ref.owner).toBe("demo");
    expect(ref.repo).toBe("demo");
    expect(ref.path).toBe("templates/node-web");
    expect(ref.tag).toBe("v1.0");
  });

  it("test_resolve_subdir_trailing_slash", async () => {
    // 子目录尾部 / 应被移除。
    const client = new RegistryClient();
    const ref = await client.resolve("demo/demo//templates/python-data/");
    expect(ref.path).toBe("templates/python-data");
  });

  it("test_resolve_no_subdir_has_none_path", async () => {
    // 不包含子目录时 path 为 None。
    const client = new RegistryClient();
    const ref = await client.resolve("owner/repo@v2.0");
    expect(ref.path).toBeNull();
    expect(ref.tag).toBe("v2.0");
  });

  // --- 本地路径解析测试 ---

  it("test_resolve_local_relative_path", async () => {
    // 相对路径 ./ 开头应解析为本地模板。
    const tmp_path = iso.tmp_path;
    const local_dir = path.join(tmp_path, "my-template");
    fs.mkdirSync(local_dir);
    fs.writeFileSync(path.join(local_dir, "template.yaml"), manifestYaml("name: test\n"));

    const old_cwd = process.cwd();
    try {
      process.chdir(tmp_path);
      const client = new RegistryClient();
      const ref = await client.resolve("./my-template");
      expect(ref.registry_type).toBe("local");
      expect(ref.local_path).toBe(local_dir);
      expect(ref.is_builtin).toBe(false);
    } finally {
      process.chdir(old_cwd);
    }
  });

  it("test_resolve_local_absolute_path", async () => {
    // 绝对路径应解析为本地模板。
    const local_dir = path.join(iso.tmp_path, "abs-template");
    fs.mkdirSync(local_dir);
    fs.writeFileSync(path.join(local_dir, "Dockerfile"), "FROM ubuntu:22.04\n");

    const client = new RegistryClient();
    const ref = await client.resolve(local_dir);
    expect(ref.registry_type).toBe("local");
    expect(ref.local_path).toBe(local_dir);
    expect(ref.is_builtin).toBe(false);
  });

  it("test_resolve_local_explicit_registry_type", async () => {
    // 显式指定 registry_type='local' 应强制本地解析。
    const local_dir = path.join(iso.tmp_path, "explicit-local");
    fs.mkdirSync(local_dir);

    const client = new RegistryClient();
    const ref = await client.resolve(local_dir, "local");
    expect(ref.registry_type).toBe("local");
    expect(ref.local_path).toBe(local_dir);
  });

  it("test_resolve_local_nonexistent_raises", async () => {
    // 本地路径不存在时应报错。
    const client = new RegistryClient();
    await expect(client.resolve("/nonexistent/path/to/template")).rejects.toThrow(ValueError);
    await expect(client.resolve("/nonexistent/path/to/template")).rejects.toThrow(/Local template directory not found/);
  });

  it("test_resolve_local_relative_nonexistent_raises", async () => {
    // 不存在的相对路径应报错。
    const client = new RegistryClient();
    await expect(client.resolve("./nonexistent-template-dir-xyz")).rejects.toThrow(ValueError);
    await expect(client.resolve("./nonexistent-template-dir-xyz")).rejects.toThrow(/Local template directory not found/);
  });

  it("test_resolve_github_still_works_after_local_support", async () => {
    // 回归测试：添加本地支持后 GitHub 格式仍正常工作。
    const client = new RegistryClient();
    const ref = await client.resolve("myorg/myrepo//templates/node@v3.0");
    expect(ref.is_builtin).toBe(false);
    expect(ref.owner).toBe("myorg");
    expect(ref.repo).toBe("myrepo");
    expect(ref.path).toBe("templates/node");
    expect(ref.tag).toBe("v3.0");
    expect(ref.registry_type).toBe("github");
  });
});

describe("TestRegistryClientFetch", () => {
  // Tests for RegistryClient.fetch().

  it("test_fetch_builtin_raises", async () => {
    const client = new RegistryClient();
    const ref = new TemplateRef({ is_builtin: true, tag: "base" });
    await expect(client.fetch(ref)).rejects.toThrow(ValueError);
    await expect(client.fetch(ref)).rejects.toThrow(/Built-in template/);
  });

  it("test_fetch_no_owner_raises", async () => {
    const client = new RegistryClient();
    const ref = new TemplateRef({ is_builtin: false, owner: null, repo: "test" });
    await expect(client.fetch(ref)).rejects.toThrow(ValueError);
    await expect(client.fetch(ref)).rejects.toThrow(/must have owner and repo/);
  });

  // --- 本地 fetch 测试 ---

  it("test_fetch_local_with_yaml", async () => {
    // 本地目录包含 template.yaml 应成功返回。
    const tmp_path = iso.tmp_path;
    const client = new RegistryClient();
    fs.writeFileSync(path.join(tmp_path, "template.yaml"), manifestYaml("name: test\n"));

    const ref = new TemplateRef({ registry_type: "local", local_path: tmp_path, is_builtin: false });
    const result = await client.fetch(ref);
    expect(result).toBe(tmp_path);
  });

  it("test_fetch_local_with_dockerfile", async () => {
    // 本地目录仅包含 Dockerfile 也应成功。
    const tmp_path = iso.tmp_path;
    const client = new RegistryClient();
    fs.writeFileSync(path.join(tmp_path, "Dockerfile"), "FROM ubuntu:22.04\n");

    const ref = new TemplateRef({ registry_type: "local", local_path: tmp_path, is_builtin: false });
    const result = await client.fetch(ref);
    expect(result).toBe(tmp_path);
  });

  it("test_fetch_local_with_both_files", async () => {
    // 本地目录包含两个文件都应成功。
    const tmp_path = iso.tmp_path;
    const client = new RegistryClient();
    fs.writeFileSync(path.join(tmp_path, "template.yaml"), manifestYaml("name: test\n"));
    fs.writeFileSync(path.join(tmp_path, "Dockerfile"), "FROM ubuntu:22.04\n");

    const ref = new TemplateRef({ registry_type: "local", local_path: tmp_path, is_builtin: false });
    const result = await client.fetch(ref);
    expect(result).toBe(tmp_path);
  });

  it("test_fetch_local_missing_required_files_raises", async () => {
    // 本地目录缺少必要文件应报错。
    const client = new RegistryClient();
    // 空目录，没有 yaml 也没有 Dockerfile
    const ref = new TemplateRef({ registry_type: "local", local_path: iso.tmp_path, is_builtin: false });
    await expect(client.fetch(ref)).rejects.toThrow(ValueError);
    await expect(client.fetch(ref)).rejects.toThrow(/must contain/);
  });

  // --- GitHub fetch 测试（tarball API） ---

  it("test_fetch_subdir_extracts_correctly", async () => {
    // 带 path 的 fetch 应只提取子目录内容（tar.gz）。
    const tmp_path = iso.tmp_path;
    const client = new RegistryClient();

    // 构造一个内存中的 tar.gz，模拟 GitHub tarball
    const tarball = _make_tarball({
      "README.md": "root readme",
      "templates/python-data/template.yaml": "name: python-data\n",
      "templates/python-data/main.py": "print('hello')\n",
      "templates/node-web/package.json": '{"name": "node-web"}\n',
    });
    const mock_resp = _fake_tarball_response(tarball);

    const ref = new TemplateRef({ owner: "owner", repo: "repo", tag: "v1.0", path: "templates/python-data" });

    _setTemplateCacheDir(tmp_path);
    patchHttpxAsyncClient(_patched_async_client(mock_resp));
    const result = await client.fetch(ref);

    // 应只包含子目录内容
    expect(fs.existsSync(path.join(result, "template.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(result, "main.py"))).toBe(true);
    // 不包含根目录的 README 和其他子目录
    expect(fs.existsSync(path.join(result, "README.md"))).toBe(false);
    expect(fs.existsSync(path.join(result, "package.json"))).toBe(false);
    // 缓存落盘位置：<owner>/<repo>/<ref>/<subdir>
    expect(result).toBe(path.join(tmp_path, "owner", "repo", "v1.0", "templates/python-data"));
  });

  it("test_fetch_subdir_not_found_raises", async () => {
    // 子目录不存在时应抛出异常。
    const tmp_path = iso.tmp_path;
    const client = new RegistryClient();

    const tarball = _make_tarball({ "README.md": "root readme" });
    const mock_resp = _fake_tarball_response(tarball);

    const ref = new TemplateRef({ owner: "owner", repo: "repo", tag: "v1.0", path: "nonexistent/dir" });

    _setTemplateCacheDir(tmp_path);
    patchHttpxAsyncClient(_patched_async_client(mock_resp));
    await expect(client.fetch(ref)).rejects.toThrow(ValueError);
    await expect(client.fetch(ref)).rejects.toThrow(/Subdirectory.*not found/);
  });

  it("test_fetch_whole_repo_still_works", async () => {
    // path=None 时提取整个仓库（剥离顶层目录）。
    const tmp_path = iso.tmp_path;
    const client = new RegistryClient();

    const tarball = _make_tarball({ "template.yaml": "name: test\n", "src/main.py": "pass\n" });
    const mock_resp = _fake_tarball_response(tarball);

    const ref = new TemplateRef({ owner: "owner", repo: "repo", tag: "v2.0" });

    _setTemplateCacheDir(tmp_path);
    patchHttpxAsyncClient(_patched_async_client(mock_resp));
    const result = await client.fetch(ref);

    expect(fs.existsSync(path.join(result, "template.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(result, "src", "main.py"))).toBe(true);
  });

  it("test_fetch_no_ref_uses_default_cache_key", async () => {
    // 无 ref 时默认分支 tarball 成功，缓存 key 为 'default'。
    const tmp_path = iso.tmp_path;
    const client = new RegistryClient();

    const tarball = _make_tarball({ "template.yaml": "name: test\n" });
    const mock_resp = _fake_tarball_response(tarball);

    const ref = new TemplateRef({ owner: "owner", repo: "repo", tag: null });

    const patched = _patched_async_client(mock_resp);
    _setTemplateCacheDir(tmp_path);
    patchHttpxAsyncClient(patched);
    const result = await client.fetch(ref);

    expect(result).toBe(path.join(tmp_path, "owner", "repo", "default"));
    expect(fs.existsSync(path.join(result, "template.yaml"))).toBe(true);
    // 无 ref 时应命中不带 ref 的 tarball 端点
    const called_url = lastGetCall(patched).args[0] as string;
    expect(called_url.endsWith("/repos/owner/repo/tarball")).toBe(true);
  });

  it("test_fetch_with_ref_hits_ref_tarball_and_cache", async () => {
    // 带 ref 时命中 /tarball/{ref}；二次安装命中缓存不再下载。
    const tmp_path = iso.tmp_path;
    const client = new RegistryClient();

    const tarball = _make_tarball({ "template.yaml": "name: test\n" });
    const mock_resp = _fake_tarball_response(tarball);
    const ref = new TemplateRef({ owner: "owner", repo: "repo", tag: "v1.1.0" });

    const patched = _patched_async_client(mock_resp);
    _setTemplateCacheDir(tmp_path);
    patchHttpxAsyncClient(patched);
    const first = await client.fetch(ref);
    const second = await client.fetch(ref);

    expect(first).toBe(second);
    expect(second).toBe(path.join(tmp_path, "owner", "repo", "v1.1.0"));
    const called_url = lastGetCall(patched).args[0] as string;
    expect(called_url.endsWith("/repos/owner/repo/tarball/v1.1.0")).toBe(true);
    // 第二次命中缓存 → 只下载了一次
    expect(patched.get.mock.calls.length).toBe(1);
  });

  it("test_fetch_with_branch_ref_cache_key_is_branch", async () => {
    // branch 作为 ref：命中 /tarball/<branch>，cache_key 为该 branch。
    const tmp_path = iso.tmp_path;
    const client = new RegistryClient();

    const tarball = _make_tarball({ "template.yaml": "name: test\n" });
    const mock_resp = _fake_tarball_response(tarball);
    const ref = new TemplateRef({ owner: "owner", repo: "repo", tag: "main" });

    const patched = _patched_async_client(mock_resp);
    _setTemplateCacheDir(tmp_path);
    patchHttpxAsyncClient(patched);
    const result = await client.fetch(ref);

    expect(result).toBe(path.join(tmp_path, "owner", "repo", "main"));
    const called_url = lastGetCall(patched).args[0] as string;
    expect(called_url.endsWith("/repos/owner/repo/tarball/main")).toBe(true);
  });

  it("test_fetch_with_sha_ref_cache_key_is_sha", async () => {
    // sha 作为 ref：命中 /tarball/<sha>，cache_key 为该 sha。
    const tmp_path = iso.tmp_path;
    const client = new RegistryClient();

    const tarball = _make_tarball({ "template.yaml": "name: test\n" });
    const mock_resp = _fake_tarball_response(tarball);
    const sha = "abc1234def5678";
    const ref = new TemplateRef({ owner: "owner", repo: "repo", tag: sha });

    const patched = _patched_async_client(mock_resp);
    _setTemplateCacheDir(tmp_path);
    patchHttpxAsyncClient(patched);
    const result = await client.fetch(ref);

    expect(result).toBe(path.join(tmp_path, "owner", "repo", sha));
    const called_url = lastGetCall(patched).args[0] as string;
    expect(called_url.endsWith(`/repos/owner/repo/tarball/${sha}`)).toBe(true);
  });

  it("test_fetch_private_repo_injects_token", async () => {
    // 私有仓库：--token 应以 Bearer 形式注入 Authorization 头。
    const tmp_path = iso.tmp_path;
    const client = new RegistryClient("https://github.com", "test-placeholder-token");

    const tarball = _make_tarball({ "template.yaml": "name: test\n" });
    const mock_resp = _fake_tarball_response(tarball);
    const ref = new TemplateRef({ owner: "owner", repo: "repo", tag: "v1.0" });

    const patched = _patched_async_client(mock_resp);
    _setTemplateCacheDir(tmp_path);
    patchHttpxAsyncClient(patched);
    await client.fetch(ref);

    const headers = lastGetCall(patched).headers;
    expect(headers["Authorization"]).toBe("Bearer test-placeholder-token");
  });
});

describe("TestRegistryClientCache", () => {
  // Tests for cache-related methods.

  it("test_check_cache_miss", () => {
    const client = new RegistryClient();
    const result = client._checkCache("nonexistent-owner", "nonexistent-repo", "v999");
    expect(result).toBeNull();
  });

  it("test_check_cache_hit", () => {
    const tmp_path = iso.tmp_path;
    const client = new RegistryClient();
    // Patch TEMPLATE_CACHE_DIR to use tmp_path
    const cache_dir = path.join(tmp_path, "owner", "repo", "v1.0");
    fs.mkdirSync(cache_dir, { recursive: true });
    fs.writeFileSync(path.join(cache_dir, "template.yaml"), manifestYaml("name: test\n"));

    _setTemplateCacheDir(tmp_path);
    const result = client._checkCache("owner", "repo", "v1.0");
    expect(result).toBe(cache_dir);
  });

  it("test_check_cache_hit_with_path", () => {
    // 带 path 的缓存查找。
    const tmp_path = iso.tmp_path;
    const client = new RegistryClient();
    const cache_dir = path.join(tmp_path, "owner", "repo", "v1.0", "templates", "py");
    fs.mkdirSync(cache_dir, { recursive: true });
    fs.writeFileSync(path.join(cache_dir, "template.yaml"), manifestYaml("name: test\n"));

    _setTemplateCacheDir(tmp_path);
    const result = client._checkCache("owner", "repo", "v1.0", "templates/py");
    expect(result).toBe(cache_dir);
  });

  it("test_check_cache_miss_with_path", () => {
    // 子目录缓存未命中。
    const tmp_path = iso.tmp_path;
    const client = new RegistryClient();
    // 仅创建根目录缓存，子目录未缓存
    const cache_dir = path.join(tmp_path, "owner", "repo", "v1.0");
    fs.mkdirSync(cache_dir, { recursive: true });
    fs.writeFileSync(path.join(cache_dir, "template.yaml"), manifestYaml("name: test\n"));

    _setTemplateCacheDir(tmp_path);
    const result = client._checkCache("owner", "repo", "v1.0", "templates/py");
    expect(result).toBeNull();
  });

  it("test_clear_cache", () => {
    const tmp_path = iso.tmp_path;
    // Create some cache entries
    fs.mkdirSync(path.join(tmp_path, "owner1"));
    fs.mkdirSync(path.join(tmp_path, "owner2"));

    _setTemplateCacheDir(tmp_path);
    const client = new RegistryClient();
    const count = client.clearCache();
    expect(count).toBe(2);
  });
});

describe("TestTarballFetchErrors", () => {
  // Friendly error handling for the GitHub tarball fetch (_download_and_extract).

  const _patched_client = patchedAsyncClient;

  function response(status_code: number, json: unknown, headers?: Record<string, string>): Response {
    const init: Record<string, unknown> = { json, request: new Request("GET", "https://api.github.com/x") };
    if (headers) init["headers"] = headers;
    return new Response(status_code, init);
  }

  it("test_tarball_rate_limited", async () => {
    // 403 + X-RateLimit-Remaining:0 → GitHubRateLimitError (task 206).
    const tmp_path = iso.tmp_path;
    const client = new RegistryClient();
    const resp = response(403, { message: "API rate limit exceeded for 1.2.3.4" }, { "X-RateLimit-Remaining": "0" });
    patchHttpxAsyncClient(_patched_client(resp));
    let caught: unknown;
    try {
      await client._downloadAndExtract("https://api.github.com/repos/owner/repo/tarball", tmp_path, {
        owner: "owner",
        repo: "repo",
        gh_ref: null,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GitHubRateLimitError);
    const err = caught as GitHubRateLimitError;
    // Still a plain E5000 NetworkError for existing callers…
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.code).toBe("E5000");
    expect(String(err).toLowerCase()).toContain("rate limit");
    expect(String(err)).toContain("60/hour");
    // The user-facing ref shape is preserved on the rate-limit message too.
    expect(String(err)).toContain("owner/repo");
    // …while the suggestion recommends the persistent config flow first.
    expect(err.suggestion).toContain("abx config set github_token");
    expect(err.suggestion).toContain(FINE_GRAINED_PAT_URL);
    expect(err.suggestion).toContain("public repositories need no extra permissions");
    // The --token flag stays documented, explicitly marked as leak-prone.
    expect(err.suggestion).toContain("--token");
    expect(err.suggestion).toContain("may leak");
  });

  it("test_tarball_rate_limit_detected_by_message", async () => {
    // 403 whose body says "rate limit" → same onboarding error.
    const tmp_path = iso.tmp_path;
    const client = new RegistryClient();
    const resp = response(403, { message: "API rate limit exceeded for 1.2.3.4" });
    patchHttpxAsyncClient(_patched_client(resp));
    let caught: unknown;
    try {
      await client._downloadAndExtract(
        "https://api.github.com/repos/alibaba-agent-sandbox/awesome-templates/tarball/v1.0",
        tmp_path,
        { subdir: "codex-agent-api", owner: "alibaba-agent-sandbox", repo: "awesome-templates", gh_ref: "v1.0" },
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GitHubRateLimitError);
    // The original owner/repo//subdir@ref shape stays visible in the message.
    expect(String(caught)).toContain("alibaba-agent-sandbox/awesome-templates//codex-agent-api@v1.0");
  });

  it("test_tarball_403_private_repo", async () => {
    // 403 without a rate-limit signal → private-repo hint.
    const tmp_path = iso.tmp_path;
    const client = new RegistryClient();
    const resp = response(403, { message: "Forbidden" });
    patchHttpxAsyncClient(_patched_client(resp));
    let caught: unknown;
    try {
      await client._downloadAndExtract(
        "https://api.github.com/repos/alibaba-agent-sandbox/awesome-templates/tarball/v1.0",
        tmp_path,
        { subdir: "codex-agent-api", owner: "alibaba-agent-sandbox", repo: "awesome-templates", gh_ref: "v1.0" },
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NetworkError);
    const err = caught as NetworkError;
    expect(String(err)).toContain("403");
    // The original owner/repo//subdir@ref shape is preserved verbatim.
    expect(String(err)).toContain("alibaba-agent-sandbox/awesome-templates//codex-agent-api@v1.0");
    // Persistent config is the recommendation; --token is the leaky fallback.
    expect(err.suggestion).toContain("abx config set github_token");
    expect(err.suggestion).toContain("--token");
    expect(err.suggestion).toContain("may leak");
  });

  it("test_tarball_401_rejected_token", async () => {
    // 401 → token rejected hint with create/clear commands (no token echo).
    const tmp_path = iso.tmp_path;
    const client = new RegistryClient("https://github.com", "ghp-secret-value");
    const resp = response(401, { message: "Bad credentials" });
    patchHttpxAsyncClient(_patched_client(resp));
    let caught: unknown;
    try {
      await client._downloadAndExtract(
        "https://api.github.com/repos/alibaba-agent-sandbox/awesome-templates/tarball/v1.0",
        tmp_path,
        { subdir: "codex-agent-api", owner: "alibaba-agent-sandbox", repo: "awesome-templates", gh_ref: "v1.0" },
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NetworkError);
    const err = caught as NetworkError;
    expect(String(err)).toContain("401");
    expect(String(err)).toContain("alibaba-agent-sandbox/awesome-templates//codex-agent-api@v1.0");
    expect(err.suggestion).toContain(FINE_GRAINED_PAT_URL);
    expect(err.suggestion).toContain("abx config set github_token");
    // Clearing the stored value is offered and the token is never echoed.
    expect(err.suggestion).toContain('github_token ""');
    expect(String(err) + err.suggestion).not.toContain("ghp-secret-value");
  });

  it("test_tarball_not_found_is_template_not_found", async () => {
    // 404 → TemplateNotFoundError 提示校验 ref，不再提 Release。
    const tmp_path = iso.tmp_path;
    const client = new RegistryClient();
    const resp = response(404, { message: "Not Found" });
    patchHttpxAsyncClient(_patched_client(resp));
    let caught: unknown;
    try {
      await client._downloadAndExtract("https://api.github.com/repos/owner/repo/tarball/v9.9", tmp_path, {
        owner: "owner",
        repo: "repo",
        gh_ref: "v9.9",
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TemplateNotFoundError);
    const err = caught as TemplateNotFoundError;
    expect(String(err)).toContain("owner/repo@v9.9");
    // 文案应提示 ref 存在性，不再要求创建 Release
    expect(err.suggestion).toContain("tag/branch/sha");
    expect(err.suggestion).toContain("no Release is");
  });

  it("test_tarball_server_error", async () => {
    // 5xx → NetworkError with status code and target.
    const tmp_path = iso.tmp_path;
    const client = new RegistryClient();
    const resp = response(500, { message: "boom" });
    patchHttpxAsyncClient(_patched_client(resp));
    let caught: unknown;
    try {
      await client._downloadAndExtract("https://api.github.com/repos/owner/repo/tarball/v2.0", tmp_path, {
        owner: "owner",
        repo: "repo",
        gh_ref: "v2.0",
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NetworkError);
    expect(String(caught)).toContain("500");
    expect(String(caught)).toContain("owner/repo@v2.0");
  });

  it("test_empty_tarball_is_template_not_found", async () => {
    // 空包（tarball 无任何成员）→ TemplateNotFoundError，不静默返回空目录。
    const tmp_path = iso.tmp_path;
    const client = new RegistryClient();
    const tarball = _make_tarball({}); // 没有任何成员
    const mock_resp = _fake_tarball_response(tarball);
    const dest = path.join(tmp_path, "owner", "repo", "default");

    patchHttpxAsyncClient(_patched_async_client(mock_resp));
    let caught: unknown;
    try {
      await client._downloadAndExtract("https://api.github.com/repos/owner/repo/tarball", dest, {
        owner: "owner",
        repo: "repo",
        gh_ref: null,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TemplateNotFoundError);
    const err = caught as TemplateNotFoundError;
    expect(String(err).toLowerCase()).toContain("empty");
    expect(err.suggestion).toContain("template.yaml/Dockerfile");
    // 不应静默落盘任何文件
    expect(fs.existsSync(dest) ? fs.readdirSync(dest).length === 0 : true).toBe(true);
  });

  it("test_empty_tarball_with_subdir_is_template_not_found", async () => {
    // 空包：即使指定 subdir 也应抛 TemplateNotFoundError（而非 subdir not found）。
    const tmp_path = iso.tmp_path;
    const client = new RegistryClient();
    const tarball = _make_tarball({});
    const mock_resp = _fake_tarball_response(tarball);
    const dest = path.join(tmp_path, "owner", "repo", "default", "sub");

    patchHttpxAsyncClient(_patched_async_client(mock_resp));
    let caught: unknown;
    try {
      await client._downloadAndExtract("https://api.github.com/repos/owner/repo/tarball", dest, {
        subdir: "templates/foo",
        owner: "owner",
        repo: "repo",
        gh_ref: null,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TemplateNotFoundError);
    expect(String(caught).toLowerCase()).toContain("empty");
  });
});

describe("TestTarballUrl", () => {
  // _tarball_url 对 tag/branch/sha 统一走 /tarball/<ref> 端点。

  it("test_tarball_url_no_ref_is_default_branch", () => {
    const client = new RegistryClient();
    const url = client._tarballUrl("owner", "repo", null);
    expect(url.endsWith("/repos/owner/repo/tarball")).toBe(true);
  });

  it("test_tarball_url_branch_ref", () => {
    const client = new RegistryClient();
    const url = client._tarballUrl("owner", "repo", "main");
    expect(url.endsWith("/repos/owner/repo/tarball/main")).toBe(true);
  });

  it("test_tarball_url_sha_ref", () => {
    const client = new RegistryClient();
    const sha = "abc1234def5678";
    const url = client._tarballUrl("owner", "repo", sha);
    expect(url.endsWith(`/repos/owner/repo/tarball/${sha}`)).toBe(true);
  });
});

describe("TestTarballPathTraversal", () => {
  // 解压时必须拒绝逃逸目标目录的成员路径。

  it("test_path_traversal_member_rejected", async () => {
    // tarball 内含 ../ 逃逸路径时应报错，且不写出目标目录外。
    const tmp_path = iso.tmp_path;
    const client = new RegistryClient();

    // 顶层目录内嵌入一个 "../evil.txt" 成员（仍以顶层前缀开头）
    const tarball = _make_tarball({ "template.yaml": "name: test\n", "../evil.txt": "pwned" });
    const mock_resp = _fake_tarball_response(tarball);
    const dest = path.join(tmp_path, "cache", "dest");

    patchHttpxAsyncClient(_patched_async_client(mock_resp));
    const call = () =>
      client._downloadAndExtract("https://api.github.com/repos/owner/repo/tarball", dest, {
        owner: "owner",
        repo: "repo",
        gh_ref: null,
      });
    await expect(call()).rejects.toThrow(ValueError);
    await expect(call()).rejects.toThrow(/Unsafe path/);

    // evil.txt 不应写到 dest 的父目录
    expect(fs.existsSync(path.join(tmp_path, "cache", "evil.txt"))).toBe(false);
  });
});

describe("TestBuiltinTemplates", () => {
  // Verify built-in template set.

  it("test_base_in_builtins", () => {
    expect(BUILTIN_TEMPLATES.has("base")).toBe(true);
  });

  it("test_code_interpreter_in_builtins", () => {
    expect(BUILTIN_TEMPLATES.has("code-interpreter-v1")).toBe(true);
  });
});


describe("obsolete manifest recovery", () => {
  const oldManifest = "name: old\nspec_version: 4\nworkflow_contract_version: 1\ndefault_workflow: application\nworkflows: {}\n";

  it("rejects an obsolete local source with its path and source revision guidance", () => {
    const file = path.join(iso.tmp_path, "template.yaml");
    fs.writeFileSync(file, oldManifest);
    expect(() => loadTemplateFromYaml(file)).toThrow(file);
    expect(() => loadTemplateFromYaml(file)).toThrow("spec_version 4; this CLI requires spec_version: 5");
    expect(() => loadTemplateFromYaml(file)).toThrow("Use a source revision");
    try { loadTemplateFromYaml(file); } catch (error) {
      expect(String(error)).not.toContain("expected never");
      expect(String(error)).not.toContain("capabilities are NOT granted");
      expect(error).toHaveProperty("suggestion", "");
      expect(String(error)).not.toContain("cached template directory");
    }
    expect(fs.readFileSync(file, "utf8")).toBe(oldManifest);
  });

  it("identifies only the stale template cache without deleting files or suggesting index refresh", () => {
    const cache = path.join(iso.tmp_path, "cache");
    _setTemplateCacheDir(cache);
    const directory = path.join(cache, "owner", "repo", "old-ref", "example");
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, "template.yaml");
    fs.writeFileSync(file, oldManifest);
    expect(() => loadTemplateFromYaml(file)).toThrow(`cached template directory (${directory})`);
    expect(() => loadTemplateFromYaml(file)).toThrow("Index refresh does not refresh source files");
    expect(fs.readFileSync(file, "utf8")).toBe(oldManifest);
  });

  it("does not label a neighbouring local directory as source cache", () => {
    const cache = path.join(iso.tmp_path, "cache");
    _setTemplateCacheDir(cache);
    const directory = `${cache}-local`;
    fs.mkdirSync(directory);
    const file = path.join(directory, "template.yaml");
    fs.writeFileSync(file, oldManifest);
    try { loadTemplateFromYaml(file); } catch (error) {
      expect(String(error)).not.toContain("cached template directory");
    }
  });

  it("continues to load the current manifest", () => {
    const file = path.join(iso.tmp_path, "template.yaml");
    fs.writeFileSync(file, manifestYaml("name: current\n"));
    expect(loadTemplateFromYaml(file).name).toBe("current");
  });
});
