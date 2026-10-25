/** GitHub / 本地目录 模板 Registry 客户端。 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { GitHubRateLimitError, NetworkError, SandboxError, TemplateNotFoundError, TemplateParseError } from "../models/errors.js";
import { ValueError } from "../models/value_error.js";
import { SandboxTemplate, TemplateRef } from "../models/template.js";
import { asyncWith, HTTPStatusError, httpx } from "../transport/_httpx.js";
import { PyFloat, pyStripChars } from "./_pyformat.js";
import { AttributeError, PyTypeError, isDir, mkdirParents, pathExists, pyJoin, pyResolve, pyTypeNameOf, readTextPy, toOSError } from "./_pyos.js";
import { openTarGz } from "./_tar.js";
import { isMapping, loadYaml } from "./yaml_io.js";
import { FINE_GRAINED_PAT_URL, rateLimitMessage, rateLimitSuggestion } from "./github_token.js";
import { getLogger } from "./logging.js";

const logger = getLogger("utils.registry");

export let TEMPLATE_CACHE_DIR: string = path.join(os.homedir(), ".abx", "templates");

/** Test seam for `patch("agent_sandbox.utils.registry.TEMPLATE_CACHE_DIR", tmp_path)`. */
export function _setTemplateCacheDir(dir: string): string {
  const prev = TEMPLATE_CACHE_DIR;
  TEMPLATE_CACHE_DIR = dir;
  return prev;
}

// 内置模板列表
export const BUILTIN_TEMPLATES: Set<string> = new Set(["base", "code-interpreter-v1"]);

/** 从 GitHub 拉取模板的客户端。 */
export class RegistryClient {
  _registry_url: string;
  _api_url: string;
  _token: string | null;

  constructor(registry_url = "https://github.com", token: string | null = null) {
    this._registry_url = registry_url.replace(/\/+$/, "");
    this._api_url = this._registry_url.split("github.com").join("api.github.com");
    this._token = token;
  }

  /**
   * 解析模板引用。
   *
   * 支持格式（Terraform 双斜杠规范）：
   * - "./my-template"                   → 本地目录
   * - "/absolute/path/to/template"      → 本地目录
   * - "base"                            → 内置模板
   * - "owner/repo"                      → GitHub 整个仓库默认分支
   * - "owner/repo@v1.0"                 → 整个仓库 + ref(tag/branch/sha)
   * - "owner/repo//path/to/subdir"      → 子目录（默认分支）
   * - "owner/repo//path/to/subdir@v1.0" → 子目录 + ref(tag/branch/sha)
   *
   * 解析顺序：
   * 1. 检测本地路径（显式指定或自动识别）
   * 2. 内置模板检查
   * 3. 先 rsplit('@') 提取 tag
   * 4. 按 '//' 分割子目录路径
   * 5. 按 '/' 分割 owner/repo
   */
  async resolve(ref: string, registry_type: string | null = null): Promise<TemplateRef> {
    // 1. 本地目录检测
    if (registry_type === "local" || ref.startsWith("./") || ref.startsWith("/") || pathExists(ref)) {
      const abs_path = path.resolve(ref);
      if (!isDir(abs_path)) {
        throw new ValueError(`Local template directory not found: ${abs_path}`);
      }
      return new TemplateRef({
        registry_type: "local",
        local_path: abs_path,
        is_builtin: false,
      });
    }

    // 2. 检查内置模板
    if (BUILTIN_TEMPLATES.has(ref) || !ref.includes("/")) {
      return new TemplateRef({ is_builtin: true, tag: ref });
    }

    // 1) 先提取 @tag（从最右侧拆分，避免与路径中的 @ 冲突）
    let tag: string | null = null;
    if (ref.includes("@")) {
      const i = ref.lastIndexOf("@");
      tag = ref.slice(i + 1);
      ref = ref.slice(0, i);
    }

    // 2) 按 '//' 分割子目录路径
    let subpath: string | null = null;
    if (ref.includes("//")) {
      const i = ref.indexOf("//");
      subpath = ref.slice(i + 2);
      ref = ref.slice(0, i);
      // 规范化：去除前后 /
      subpath = pyStripChars(subpath, "/") || null;
    }

    // 3. 解析 owner/repo（GitHub 格式）
    const i = ref.indexOf("/");
    const parts = i < 0 ? [ref] : [ref.slice(0, i), ref.slice(i + 1)];
    if (parts.length !== 2) {
      return new TemplateRef({ is_builtin: true, tag: ref });
    }

    const [owner, repo] = parts as [string, string];
    return new TemplateRef({
      owner,
      repo,
      tag,
      path: subpath,
      is_builtin: false,
      registry_url: this._registry_url,
    });
  }

  /**
   * 拉取模板到本地缓存。
   *
   * 对于本地模板，直接返回本地路径（验证必要文件）。
   * 对于 GitHub 模板：
   * 1. 检查本地缓存
   * 2. 通过 GitHub tarball API 按 tag/branch/sha 拉取源码（无需 Release）
   * 3. 下载并解压到 ~/.abx/templates/owner/repo/ref/[path/]
   * 4. 如果指定了 path，只提取子目录内容
   * 5. 返回本地路径
   */
  async fetch(ref: TemplateRef): Promise<string> {
    if (ref.registry_type === "local") {
      return this._fetchLocal(ref);
    }
    return this._fetchGithub(ref);
  }

  /** 从本地目录加载模板。 */
  _fetchLocal(ref: TemplateRef): string {
    const local_path = pyJoin(ref.local_path as string);

    // 验证必要文件存在（template.yaml 或 Dockerfile）
    const yaml_path = path.join(local_path, "template.yaml");
    const dockerfile_path = path.join(local_path, "Dockerfile");

    if (
      !pathExists(yaml_path) &&
      !pathExists(dockerfile_path)
    ) {
      throw new ValueError(
        `Local template at ${local_path} must contain ` +
          "template.yaml or Dockerfile",
      );
    }

    logger.info("Using local template: %s", local_path);
    return local_path;
  }

  /** 从 GitHub 拉取模板（按 tag/branch/sha 走 tarball API，无需 Release）。 */
  async _fetchGithub(ref: TemplateRef): Promise<string> {
    if (ref.is_builtin) {
      throw new ValueError(`Built-in template '${ref.tag}' does not need to be fetched.`);
    }

    if (!ref.owner || !ref.repo) {
      throw new ValueError("TemplateRef must have owner and repo for fetching.");
    }

    // 缓存 key：有 ref 用 ref(tag/branch/sha)，无 ref 用稳定占位符 "default"
    const cache_key = ref.tag || "default";
    const cached = this._checkCache(ref.owner, ref.repo, cache_key, ref.path);
    if (cached !== null) {
      logger.info("Using cached template: %s/%s@%s", ref.owner, ref.repo, cache_key);
      return cached;
    }

    // 构造 tarball 下载地址（GitHub 会 302 到 codeload 的 .tar.gz）
    const tarball_url = this._tarballUrl(ref.owner, ref.repo, ref.tag);

    const dest = RegistryClient._cachePath(ref.owner, ref.repo, cache_key, ref.path);
    await this._downloadAndExtract(tarball_url, dest, {
      subdir: ref.path,
      owner: ref.owner,
      repo: ref.repo,
      gh_ref: ref.tag,
    });

    logger.info("Fetched template: %s/%s@%s → %s", ref.owner, ref.repo, cache_key, dest);
    return dest;
  }

  /**
   * 构造 GitHub tarball API 地址。
   *
   * - 有 ref：`/repos/{owner}/{repo}/tarball/{ref}`（ref 可为 tag/branch/sha）；
   * - 无 ref：`/repos/{owner}/{repo}/tarball` → 返回默认分支的 tarball。
   */
  _tarballUrl(owner: string, repo: string, gh_ref: string | null): string {
    const base = `${this._api_url}/repos/${owner}/${repo}/tarball`;
    if (gh_ref) {
      return `${base}/${gh_ref}`;
    }
    return base;
  }

  /**
   * 将 GitHub tarball API 的 HTTP 错误转换为用户友好的 SDK 异常。
   *
   * tarball 端点会先命中 api.github.com，再 302 到 codeload；两阶段共用同一套映射（follow_redirects 后返回的最终响应）：
   * - 403 且触发速率限制 → GitHubRateLimitError（统一引导文案，含官方 fine-grained PAT 预填 URL；CLI 据此可触发一次性交互配置）；
   * - 403 其它 → 提示可能为私有仓库（推荐持久化 github_token）；
   * - 401 → 提示 token 无效/过期（含创建与清除命令）；
   * - 404 → TemplateNotFoundError（提示校验 owner/repo//subdir[@ref] 与 ref 存在性）；
   * - 5xx/其它 → NetworkError。
   */
  static _translateTarballError(
    exc: HTTPStatusError,
    owner: string | null,
    repo: string | null,
    gh_ref: string | null,
    subdir: string | null = null,
  ): SandboxError {
    const resp = exc.response;
    const status = resp.status_code;
    let target: string;
    if (owner && repo) {
      // Preserve the full user-facing ref shape: owner/repo//subdir@ref
      target = `${owner}/${repo}`;
      if (subdir) {
        target += `//${pyStripChars(subdir, "/")}`;
      }
      if (gh_ref) {
        target += `@${gh_ref}`;
      }
    } else {
      target = "the template archive";
    }

    if (status === 403) {
      const remaining = resp.headers.get("X-RateLimit-Remaining");
      let body_text: string;
      try {
        body_text = resp.text || "";
      } catch {
        body_text = "";
      }
      if (remaining === "0" || body_text.toLowerCase().includes("rate limit")) {
        return new GitHubRateLimitError(rateLimitMessage({ operation: `fetching ${target}` }), {
          suggestion: rateLimitSuggestion(),
        });
      }
      return new NetworkError(`GitHub API returned 403 Forbidden for '${target}'.`, {
        suggestion:
          "The repository may be private. Store a token that can read it " +
          "with 'abx config set github_token' (masked input), or pass " +
          "--token <value> as a one-off override - note that --token may " +
          "leak into shell history and process listings.",
      });
    }

    if (status === 401) {
      return new NetworkError(`GitHub rejected the configured token (HTTP 401) for '${target}'.`, {
        suggestion:
          "The token may be invalid, expired, or malformed. Create a " +
          "fine-grained token with contents:read " +
          `(${FINE_GRAINED_PAT_URL}) and store it with ` +
          "'abx config set github_token', or clear the stored value " +
          "with 'abx config set github_token \"\"'.",
      });
    }

    if (status === 404) {
      return new TemplateNotFoundError(`GitHub template not found for '${target}'.`, {
        suggestion:
          "Check that owner/repo//subdir[@ref] is correct and that the " +
          "ref (tag/branch/sha) exists. Templates are fetched by " +
          "tag/branch/sha via the GitHub tarball API — no Release is " +
          "required.",
      });
    }

    return new NetworkError(`GitHub tarball request failed with HTTP ${status} for '${target}'.`, {
      suggestion: "Check the repository reference and your network connection.",
    });
  }

  /**
   * 下载并解压模板 tarball（.tar.gz）。
   *
   * GitHub tarball 顶层是单个目录（形如 `{owner}-{repo}-{sha}/`），需要剥离；解压时校验成员路径不逃逸目标目录，防止路径穿越。
   *
   * url: tarball 下载地址（GitHub 会 302 到 codeload 的 .tar.gz）
   * dest: 本地目标目录
   * subdir: 可选，仅提取 archive 中的指定子目录
   * owner/repo/gh_ref: 可选，仅用于下载失败时构造友好错误上下文
   */
  async _downloadAndExtract(
    url: string,
    dest: string,
    opts: { subdir?: string | null; owner?: string | null; repo?: string | null; gh_ref?: string | null } = {},
  ): Promise<void> {
    const { subdir = null, owner = null, repo = null, gh_ref = null } = opts;
    const headers: Record<string, string> = {};
    if (this._token) {
      headers["Authorization"] = `Bearer ${this._token}`;
    }

    const resp = await asyncWith(new httpx.AsyncClient({ follow_redirects: true }), async (client) => {
      const r = await client.get(url, { headers });
      try {
        r.raiseForStatus();
      } catch (exc) {
        if (exc instanceof HTTPStatusError) {
          throw RegistryClient._translateTarballError(exc, owner, repo, gh_ref, subdir);
        }
        throw exc;
      }
      return r;
    });

    const tmp_path = path.join(os.tmpdir(), `tmp${randomBytes(4).toString("hex")}.tar.gz`);
    try {
      fs.writeFileSync(tmp_path, resp.content, { flag: "wx", mode: 0o600 });
    } catch (e) {
      throw toOSError(e, tmp_path);
    }

    try {
      mkdirParents(dest);
      const dest_root = pyResolve(dest);
      const tf = openTarGz(fs.readFileSync(tmp_path));
      const members = tf.getmembers();
      if (members.length) {
        // GitHub tarball 包含一个顶层目录，需要剥离
        const prefix = (members[0] as { name: string }).name.split("/")[0] + "/";

        // 如果指定了子目录，在前缀后追加子目录路径
        const extract_prefix = subdir ? prefix + pyStripChars(subdir, "/") + "/" : prefix;

        let found_any = false;
        for (const member of members) {
          // 仅提取普通文件，跳过目录/符号链接等（安全）
          if (!member.isfile()) continue;
          const name = member.name;
          if (!name.startsWith(extract_prefix)) continue;
          const relative = name.slice(extract_prefix.length);
          if (!relative) continue;
          const target = pyResolve(pyJoin(dest, relative));
          // 路径穿越防护：目标必须严格位于 dest 目录内
          if (!_isStrictParent(dest_root, target)) {
            throw new ValueError(`Unsafe path in archive rejected: ${name}`);
          }
          found_any = true;
          mkdirParents(path.dirname(target));
          const src = tf.extractfile(member);
          if (src === null) continue;
          try {
            fs.writeFileSync(target, src);
          } catch (e) {
            throw toOSError(e, target);
          }
        }

        if (subdir && !found_any) {
          throw new ValueError(`Subdirectory '${subdir}' not found in the archive.`);
        }
      } else {
        // 空包（无任何成员）：无论是否指定 subdir 都视为无效模板，不静默返回空目录，避免下游误以为拉取成功。
        throw new TemplateNotFoundError("Downloaded template archive is empty (no members).", {
          suggestion:
            "Check that the repo/ref contains a valid template " +
            "directory (with template.yaml/Dockerfile). Templates " +
            "are fetched by tag/branch/sha via the GitHub tarball " +
            "API — no Release is required.",
        });
      }
    } finally {
      fs.rmSync(tmp_path, { force: true });
    }
  }

  /** 构建缓存路径：~/.abx/templates/owner/repo/tag[/path]。 */
  static _cachePath(owner: string, repo: string, tag: string, subpath: string | null = null): string {
    const base = pyJoin(TEMPLATE_CACHE_DIR, owner, repo, tag);
    if (subpath) {
      return pyJoin(base, subpath);
    }
    return base;
  }

  /** 检查本地缓存。 */
  _checkCache(owner: string, repo: string, tag: string, subpath: string | null = null): string | null {
    const cache_path = RegistryClient._cachePath(owner, repo, tag, subpath);
    if (
      pathExists(cache_path) &&
      pathExists(path.join(cache_path, "template.yaml"))
    ) {
      return cache_path;
    }
    return null;
  }

  /** 清理本地模板缓存。返回清理的文件数。 */
  clearCache(): number {
    let count = 0;
    if (pathExists(TEMPLATE_CACHE_DIR)) {
      for (const name of fs.readdirSync(TEMPLATE_CACHE_DIR)) {
        const item = path.join(TEMPLATE_CACHE_DIR, name);
        if (isDir(item)) {
          if (fs.lstatSync(item).isSymbolicLink()) {
            throw toOSError(Object.assign(new Error("Cannot call rmtree on a symbolic link"), { code: "" }), null);
          }
          fs.rmSync(item, { recursive: true, force: false });
          count += 1;
        } else {
          fs.unlinkSync(item);
          count += 1;
        }
      }
    }
    return count;
  }
}

function _isStrictParent(parent: string, child: string): boolean {
  if (child === parent) return false;
  const withSep = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return child.startsWith(withSep);
}

/** Reject obsolete source manifests with recovery scoped to their own cache directory. */
export function validateTemplateSourceVersion(data: Record<string, unknown>, file: string, cacheDirectory: string | null = TEMPLATE_CACHE_DIR): void {
  if (Object.hasOwn(data, "spec_version") && data["spec_version"] !== 5) {
    const declared = typeof data["spec_version"] === "number" ? String(data["spec_version"]) : "invalid";
    const relative = cacheDirectory === null ? "" : path.relative(path.resolve(cacheDirectory), path.resolve(file));
    const cached = relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    const recovery = "Use a source revision containing spec_version: 5; updating the version number alone does not migrate an old manifest." +
      (cached ? ` If this is a downloaded copy and its remote source has already been updated, remove only its cached template directory (${path.dirname(file)}) and retry. Index refresh does not refresh source files.` : "");
    throw new TemplateParseError(`${file}: unsupported template spec_version ${declared}; this CLI requires spec_version: 5. ${recovery}`, { suggestion: "" });
  }
}

/** 从 YAML 文件加载模板定义。 */
export function loadTemplateFromYaml(file: string): SandboxTemplate {
  const data = loadYaml(readTextPy(file));
  if (!isMapping(data)) {
    throw new ValueError(`${file} must be a YAML mapping`);
  }
  validateTemplateSourceVersion(data, file);
  // 映射 resources 嵌套结构到扁平字段
  const { resources, ...rest } = data;
  const flat: Record<string, unknown> = rest;
  if (resources !== null && typeof resources === "object" && !Array.isArray(resources)) {
    const res = resources as Record<string, unknown>;
    if ("cpu" in res && !("cpu_count" in flat)) flat["cpu_count"] = res["cpu"];
    if ("memory" in res && !("memory_mb" in flat)) flat["memory_mb"] = res["memory"];
  }
  return SandboxTemplate.modelValidate(flat);
}
