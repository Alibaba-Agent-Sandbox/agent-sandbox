/**
 * Remote template index client.
 *
 * The official and community template catalog lives in a **single source of truth** repository:
 * `alibaba-agent-sandbox/awesome-templates`.  Its root index file (`awesome-templates.yaml`) is what `abx template search`
 * queries and what `abx template install <name>` resolves bare template names against.
 *
 * Design notes
 * ------------
 * * The default index URL points at `raw.githubusercontent.com` — raw files are served by a CDN and are **not**
 *   subject to the 60 requests/hour anonymous limit of `api.github.com`.  A `GITHUB_TOKEN` is still honoured for
 *   private mirrors: prefer storing it once with `abx config set github_token`; `--token` remains a one-off override
 *   that may leak into shell history and process listings.
 * * The fetched index is cached under `~/.abx/index/` together with metadata (`fetched_at` / `etag`).  Within
 *   `INDEX_MAX_AGE_SECONDS` the cache is used without touching the network; `force=true` (`--refresh`) bypasses it,
 *   and a conditional request (`If-None-Match`) keeps refreshes cheap.
 * * Network failures degrade gracefully: when a cached copy exists it is served with `stale=true` plus a
 *   human-readable `notice`; without a cache the error is raised with explicit remediation steps.
 * * Schema evolution is explicit: the index must declare the supported `schema_version`. An unsupported version fails loudly
 *   instead of being misinterpreted.
 */

import { validateTemplateManifest } from "../template/launch_plan.mjs";
import * as os from "node:os";
import * as path from "node:path";
import { ValueError } from "../models/value_error.js";
import { GitHubRateLimitError, NetworkError, TemplateNotFoundError, TemplateParseError } from "../models/errors.js";
import { asyncWith, HTTPError, httpx } from "../transport/_httpx.js";
import { PyFloat, pyFloatParse, pyJsonDumps, pyRepr, pyStr, pyStrip, pyStripChars } from "./_pyformat.js";
import { AttributeError, OSError, PyTypeError, isFile, mkdirParents, pyExpandUser, pyJoin, pyTypeNameOf, readTextPy, writeTextPy } from "./_pyos.js";
import { loadYaml as safeLoad } from "./yaml_io.js";
import { rateLimitMessage, rateLimitSuggestion } from "./github_token.js";
import { getLogger } from "./logging.js";

const logger = getLogger("utils.template_index");

/** Canonical index location (single source of truth). */
export const DEFAULT_INDEX_URL =
  "https://raw.githubusercontent.com/alibaba-agent-sandbox/awesome-templates/main/awesome-templates.yaml";

/** Environment variable that overrides the index location. */
export const INDEX_URL_ENV = "ABX_TEMPLATE_INDEX_URL";

/**
 * Local cache location (kept outside `~/.abx/templates` so it is never mistaken for an installed template).
 */
export let INDEX_CACHE_DIR: string = path.join(os.homedir(), ".abx", "index");
export const INDEX_CACHE_FILE = "awesome-templates.yaml";
export const INDEX_META_FILE = "awesome-templates.meta.json";

/** Test seam for `patch("agent_sandbox.utils.template_index.INDEX_CACHE_DIR", dir)`. */
export function _setIndexCacheDir(dir: string): string {
  const prev = INDEX_CACHE_DIR;
  INDEX_CACHE_DIR = dir;
  return prev;
}

/** Index schema version understood by this client. */
export const INDEX_SCHEMA_VERSION = 2;

/** Cache freshness window for `search` / `install` (seconds). */
export const INDEX_MAX_AGE_SECONDS = 3600;

export const _FETCH_TIMEOUT = 20.0;

export const VALID_STATUSES = ["official", "community", "experimental"] as const;

export interface TemplateIndexEntryInit {
  name: string;
  repo: string;
  description?: string;
  path?: string | null;
  ref?: string | null;
  tags?: readonly string[];
  author?: string;
  manifest?: Record<string, unknown> | null;
  status?: string;
}

/** One entry of the remote template index (frozen, like the Python dataclass). */
export class TemplateIndexEntry {
  readonly name: string;
  readonly repo: string;
  readonly description: string;
  readonly path: string | null;
  readonly ref: string | null;
  readonly tags: readonly string[];
  readonly author: string;
  readonly manifest: Record<string, unknown> | null;
  readonly status: string;

  constructor(init: TemplateIndexEntryInit) {
    this.name = init.name;
    this.repo = init.repo;
    this.description = init.description ?? "";
    this.path = init.path ?? null;
    this.ref = init.ref ?? null;
    this.tags = Object.freeze([...(init.tags ?? [])]);
    this.author = init.author ?? "";
    this.manifest = init.manifest ?? null;
    this.status = init.status ?? "community";
    Object.freeze(this);
  }

  /** `owner/repo` part of `repo` (validated at parse time). */
  get github_slug(): string {
    return _parseRepoSlug(this.repo);
  }

  /** `owner/repo//path@ref` ref usable with `RegistryClient.resolve`. */
  get install_ref(): string {
    let ref = this.github_slug;
    if (this.path) {
      ref = `${ref}//${pyStripChars(this.path, "/")}`;
    }
    if (this.ref) {
      ref = `${ref}@${this.ref}`;
    }
    return ref;
  }
}

export interface TemplateIndexInit {
  entries?: TemplateIndexEntry[];
  source_url?: string;
  schema_version?: number;
  stale?: boolean;
  notice?: string;
  fetched_at?: number | null;
}

/** Parsed remote index plus provenance information. */
export class TemplateIndex {
  entries: TemplateIndexEntry[];
  source_url: string;
  schema_version: number;
  /** `true` when the data was served from a stale local cache. */
  stale: boolean;
  /** Human-readable explanation attached to degraded states (stale cache, rate limiting, …). Empty when fresh. */
  notice: string;
  fetched_at: number | null;

  constructor(init: TemplateIndexInit = {}) {
    this.entries = init.entries ?? [];
    this.source_url = init.source_url ?? DEFAULT_INDEX_URL;
    this.schema_version = init.schema_version ?? INDEX_SCHEMA_VERSION;
    this.stale = init.stale ?? false;
    this.notice = init.notice ?? "";
    this.fetched_at = init.fetched_at ?? null;
  }

  /** Exact (case-insensitive) lookup by template name. */
  find(name: string): TemplateIndexEntry | null {
    const wanted = pyStrip(name).toLowerCase();
    for (const entry of this.entries) {
      if (entry.name.toLowerCase() === wanted) {
        return entry;
      }
    }
    return null;
  }

  /** Substring search over name/description/tags/author + optional filters. */
  filter(query: string, opts: { tag?: string | null; status?: string | null } = {}): TemplateIndexEntry[] {
    const { tag = null, status = null } = opts;
    const query_lower = pyStrip(query).toLowerCase();
    const tag_lower = tag ? pyStrip(tag).toLowerCase() : null;
    const results: TemplateIndexEntry[] = [];
    for (const entry of this.entries) {
      if (status && entry.status !== status) continue;
      if (tag_lower && !entry.tags.map((t) => t.toLowerCase()).includes(tag_lower)) continue;
      if (
        query_lower &&
        !(
          entry.name.toLowerCase().includes(query_lower) ||
          entry.description.toLowerCase().includes(query_lower) ||
          entry.author.toLowerCase().includes(query_lower) ||
          entry.tags.some((t) => t.toLowerCase().includes(query_lower))
        )
      ) {
        continue;
      }
      results.push(entry);
    }
    return results;
  }
}

/** `urllib.parse.urlparse(value)` reduced to the `hostname` / `path` attributes. */
function urlparse(value: string): { hostname: string | null; path: string } {
  let rest = value;
  const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(rest);
  if (schemeMatch) rest = rest.slice(schemeMatch[0].length);
  let netloc = "";
  if (rest.startsWith("//")) {
    const end = rest.slice(2).search(/[/?#]/);
    netloc = end < 0 ? rest.slice(2) : rest.slice(2, 2 + end);
    rest = end < 0 ? "" : rest.slice(2 + end);
  }
  const cut = rest.search(/[?#]/);
  const pth = cut < 0 ? rest : rest.slice(0, cut);
  let hostPart = netloc.slice(netloc.lastIndexOf("@") + 1);
  let hostname: string | null;
  if (hostPart.startsWith("[")) {
    const close = hostPart.indexOf("]");
    hostname = close < 0 ? hostPart.slice(1) : hostPart.slice(1, close);
  } else {
    const colon = hostPart.indexOf(":");
    hostname = colon < 0 ? hostPart : hostPart.slice(0, colon);
  }
  hostPart = "";
  return { hostname: hostname === "" ? null : hostname.toLowerCase(), path: pth };
}

/**
 * Normalise `repo` to `owner/repo`.
 *
 * Accepts `owner/repo`, `https://github.com/owner/repo` and `git@github.com:owner/repo.git`.  Any other host is
 * rejected explicitly — this client only knows how to fetch from GitHub.
 */
export function _parseRepoSlug(repo: string): string {
  const value = pyStrip(repo);
  if (!value) {
    throw new TemplateParseError("Index entry has an empty 'repo' field.");
  }

  let slug: string;
  if (value.startsWith("git@")) {
    const i = value.indexOf(":");
    const host = i < 0 ? value : value.slice(0, i);
    const pth = i < 0 ? "" : value.slice(i + 1);
    if (!host.includes("github.com")) {
      throw new TemplateParseError(
        `Unsupported template host in index entry: ${pyRepr(repo)}. ` + "Only github.com repositories are supported.",
      );
    }
    slug = pth;
  } else if (value.includes("://")) {
    const parsed = urlparse(value);
    if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") {
      throw new TemplateParseError(
        `Unsupported template host in index entry: ${pyRepr(repo)}. ` + "Only github.com repositories are supported.",
      );
    }
    slug = parsed.path;
  } else {
    slug = value;
  }

  slug = pyStripChars(pyStrip(slug), "/");
  if (slug.endsWith(".git")) {
    slug = slug.slice(0, slug.length - ".git".length);
  }
  const parts = slug.split("/").filter((p) => p);
  if (parts.length < 2) {
    throw new TemplateParseError(
      `Index entry 'repo' must be 'owner/repo' or a GitHub URL, got ${pyRepr(repo)}.`,
    );
  }
  return `${parts[0]}/${parts[1]}`;
}

function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

function isDict(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function dget(d: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(d, key) ? d[key] : null;
}

export function _parseEntry(raw: unknown, index_url: string): TemplateIndexEntry {
  if (!isDict(raw)) {
    throw new TemplateParseError(`Index entry must be a mapping, got ${pyTypeNameOf(raw)} (${index_url}).`);
  }
  const nameRaw = dget(raw, "name");
  const name = pyStrip(truthy(nameRaw) ? pyStr(nameRaw) : "");
  if (!name) {
    throw new TemplateParseError(`Index entry is missing the required 'name' field (${index_url}).`);
  }
  const repoRaw = dget(raw, "repo");
  const repo = pyStrip(truthy(repoRaw) ? pyStr(repoRaw) : "");
  if (!repo && raw["template_id"] === undefined) {
    throw new TemplateParseError(`Index entry '${name}' is missing the required 'repo' field (${index_url}).`);
  }
  const pathRaw = dget(raw, "path");
  const refRaw = dget(raw, "ref");
  const tagsRaw = dget(raw, "tags");
  const tags: unknown = truthy(tagsRaw) ? tagsRaw : [];

  if (!Array.isArray(tags) || !tags.every((t) => typeof t === "string")) {
    throw new TemplateParseError(`Index entry '${name}': 'tags' must be a list of strings.`);
  }
  let manifest: Record<string, unknown> | null = null;
  for (const retired of ["capabilities", "tested_on", "providers"]) if (Object.hasOwn(raw, retired)) throw new TemplateParseError(`Index entry '${name}' uses retired field '${retired}'.`);
  // Source rows are locators. Their fetched template.yaml is the only manifest authority.
  if (raw["template_id"] !== undefined) {
    try { manifest = validateTemplateManifest(raw); } catch (error) { throw new TemplateParseError(`Managed entry '${name}' has an invalid manifest: ${String(error)}`); }
  }


  const descRaw = dget(raw, "description");
  const authorRaw = dget(raw, "author");
  const statusRaw = dget(raw, "status");
  const entry = new TemplateIndexEntry({
    name,
    repo,
    description: pyStr(truthy(descRaw) ? descRaw : ""),
    path: truthy(pathRaw) ? pyStripChars(pyStr(pathRaw), "/") || null : null,
    ref: truthy(refRaw) ? pyStrip(pyStr(refRaw)) || null : null,
    tags: [...(tags as string[])],
    author: pyStr(truthy(authorRaw) ? authorRaw : ""),
    manifest,
    status: pyStr(truthy(statusRaw) ? statusRaw : "community"),
  });
  // Fail fast on unusable repo references (also validates the host).
  if (repo) void entry.github_slug;
  return entry;
}

export interface ParseIndexOptions {
  source_url?: string;
  stale?: boolean;
  notice?: string;
  fetched_at?: number | null;
}

/**
 * Parse the raw YAML of the template index.
 *
 * Raises TemplateParseError: malformed YAML, missing `templates` list, duplicate names, unusable entries, or a
 * `schema_version` newer than this client supports.
 */
export function parseIndex(text: string, opts: ParseIndexOptions = {}): TemplateIndex {
  const { source_url = DEFAULT_INDEX_URL, stale = false, notice = "", fetched_at = null } = opts;
  let data: unknown;
  try {
    data = safeLoad(text);
  } catch (exc) {
    throw new TemplateParseError(`Template index is not valid YAML (${source_url}): ${(exc as Error).message}`);
  }

  if (!isDict(data)) {
    throw new TemplateParseError(`Template index must be a YAML mapping with a 'templates' list (${source_url}).`);
  }

  const schema_version: unknown = Object.prototype.hasOwnProperty.call(data, "schema_version")
    ? data["schema_version"]
    : null;
  if (typeof schema_version !== "number" || !Number.isInteger(schema_version)) {
    throw new TemplateParseError(
      "Template index declares a non-integer schema_version " + `(${pyRepr(schema_version)}) at ${source_url}.`,
    );
  }
  if (schema_version !== INDEX_SCHEMA_VERSION) {
    throw new TemplateParseError(
      `Template index schema_version ${schema_version} differs from supported ` +
        `schema_version ${INDEX_SCHEMA_VERSION}.`,
      { suggestion: "Upgrade abx using its source or binary installation guide: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/blob/main/docs/en/guide/binary-installation.md" },
    );
  }

  const raw_entries = dget(data, "templates");
  if (!Array.isArray(raw_entries)) {
    throw new TemplateParseError(`Template index has no 'templates' list (${source_url}).`);
  }

  const managed_entries = data["managed_templates"] ?? [];
  if (!Array.isArray(managed_entries)) {
    throw new TemplateParseError(`Template index 'managed_templates' must be a list (${source_url}).`);
  }
  for (const raw of managed_entries) {
    if (!isDict(raw) || !Object.hasOwn(raw, "template_id")) {
      throw new TemplateParseError(`Managed template entries require a native template_id (${source_url}).`);
    }
  }
  const entries: TemplateIndexEntry[] = [];
  const seen = new Set<string>();
  for (const raw of [...raw_entries, ...managed_entries]) {
    const entry = _parseEntry(raw, source_url);
    const key = entry.name.toLowerCase();
    if (seen.has(key)) {
      throw new TemplateParseError(
        `Template index contains duplicate entry '${entry.name}' (${source_url}); ` +
          "names must be unique for install-by-name resolution.",
      );
    }
    seen.add(key);
    entries.push(entry);
  }

  return new TemplateIndex({ entries, source_url, schema_version, stale, notice, fetched_at });
}

export function _cachePaths(cache_dir: string | null = null): [string, string] {
  const base = cache_dir || INDEX_CACHE_DIR;
  return [path.join(base, INDEX_CACHE_FILE), path.join(base, INDEX_META_FILE)];
}

function jsonLoadsMeta(text: string): unknown {
  return JSON.parse(text);
}

function pyFloatOf(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const n = pyFloatParse(v);
    if (n === null) throw new ValueError(`could not convert string to float: ${pyRepr(v)}`);
    return n;
  }
  throw new PyTypeError(
    `float() argument must be a string or a real number, not '${pyTypeNameOf(v)}'`,
  );
}

/** Load the cached index (if any) without touching the network. */
export function readCachedIndex(cache_dir: string | null = null): TemplateIndex | null {
  const [cache_file, meta_file] = _cachePaths(cache_dir);
  if (!isFile(cache_file)) {
    return null;
  }
  let meta: unknown = {};
  if (isFile(meta_file)) {
    try {
      meta = jsonLoadsMeta(readTextPy(meta_file));
    } catch (e) {
      if (e instanceof SyntaxError || e instanceof OSError) {
        meta = {};
      } else {
        throw e;
      }
    }
  }
  if (!isDict(meta)) {
    throw new AttributeError(`'${pyTypeNameOf(meta)}' object has no attribute 'get'`);
  }
  try {
    const srcRaw = dget(meta, "source_url");
    return parseIndex(readTextPy(cache_file), {
      source_url: pyStr(truthy(srcRaw) ? srcRaw : DEFAULT_INDEX_URL),
      fetched_at: Object.prototype.hasOwnProperty.call(meta, "fetched_at") ? pyFloatOf(meta["fetched_at"]) : null,
    });
  } catch (e) {
    if (e instanceof TemplateParseError) {
      logger.warning("Ignoring unreadable template index cache at %s", cache_file);
      return null;
    }
    throw e;
  }
}

function metaJson(source_url: string, etag: string | null, fetched_at: number): string {
  return pyJsonDumps({ source_url, etag, fetched_at: new PyFloat(fetched_at) }, { indent: 2 });
}

export function _writeCache(
  text: string,
  opts: { source_url: string; etag: string | null; fetched_at: number; cache_dir?: string | null },
): void {
  const [cache_file, meta_file] = _cachePaths(opts.cache_dir ?? null);
  try {
    mkdirParents(path.dirname(cache_file));
    writeTextPy(cache_file, text);
    writeTextPy(meta_file, metaJson(opts.source_url, opts.etag, opts.fetched_at));
  } catch (exc) {
    if (exc instanceof OSError) {
      logger.warning("Could not write template index cache: %s", pyStr(exc));
      return;
    }
    throw exc;
  }
}

/** Refresh the fetch timestamp/etag without rewriting the cached YAML. */
export function _touchCacheMeta(opts: {
  source_url: string;
  etag: string | null;
  fetched_at: number;
  cache_dir?: string | null;
}): void {
  const [, meta_file] = _cachePaths(opts.cache_dir ?? null);
  try {
    mkdirParents(path.dirname(meta_file));
    writeTextPy(meta_file, metaJson(opts.source_url, opts.etag, opts.fetched_at));
  } catch (exc) {
    if (exc instanceof OSError) {
      logger.warning("Could not update template index cache metadata: %s", pyStr(exc));
      return;
    }
    throw exc;
  }
}

export function _readCacheMeta(cache_dir: string | null = null): Record<string, unknown> {
  const [, meta_file] = _cachePaths(cache_dir);
  if (!isFile(meta_file)) {
    return {};
  }
  let data: unknown;
  try {
    data = jsonLoadsMeta(readTextPy(meta_file));
  } catch (e) {
    if (e instanceof SyntaxError || e instanceof OSError) {
      return {};
    }
    throw e;
  }
  // A meta file that is not a mapping is treated like a corrupt cache: discard.
  return isDict(data) ? data : {};
}

export function _indexUrlFromEnvOrDefault(index_url: string | null): string {
  if (index_url) {
    return index_url;
  }
  return process.env[INDEX_URL_ENV] || DEFAULT_INDEX_URL;
}

export function _staleFallback(
  cached: TemplateIndex | null,
  opts: {
    reason: string;
    index_url: string;
    suggestion: string;
    error_cls?: new (message: string, options?: { suggestion?: string }) => NetworkError;
  },
): TemplateIndex {
  const { reason, index_url, suggestion, error_cls = NetworkError } = opts;
  if (cached !== null) {
    cached.stale = true;
    cached.notice = `${reason} Serving the cached index (${cached.source_url}).`;
    logger.warning(cached.notice);
    return cached;
  }
  throw new error_cls(`${reason} No cached copy of the template index is available (${index_url}).`, { suggestion });
}

/**
 * Return the template index, using the cache when fresh.
 *
 * index_url: HTTP(S) URL of the index, or a local file path.  Defaults to `ABX_TEMPLATE_INDEX_URL` and then
 *   `DEFAULT_INDEX_URL`.
 * token: optional GitHub token (`GITHUB_TOKEN`) for private mirrors.
 * cache_dir: override for the cache directory (tests).
 * max_age: cache freshness window in seconds.
 * force: bypass the freshness window and re-fetch over the network.
 */
export async function fetchIndex(
  index_url: string | null = null,
  opts: { token?: string | null; cache_dir?: string | null; max_age?: number; force?: boolean } = {},
): Promise<TemplateIndex> {
  const { token = null, cache_dir = null, max_age = INDEX_MAX_AGE_SECONDS, force = false } = opts;
  const url = _indexUrlFromEnvOrDefault(index_url);

  // Local file path → read directly, no caching involved.
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    const pth = pyJoin(pyExpandUser(url));
    if (!isFile(pth)) {
      throw new TemplateNotFoundError(`Template index file not found: ${pth}`, {
        suggestion:
          "Check --index-url / ABX_TEMPLATE_INDEX_URL, or drop the " +
          "override to use the canonical remote index.",
      });
    }
    return parseIndex(readTextPy(pth), { source_url: pyJoin(pth) });
  }

  const cached = readCachedIndex(cache_dir);
  const meta = _readCacheMeta(cache_dir);
  const now = Date.now() / 1000;

  if (cached !== null && !force && cached.fetched_at !== null && now - cached.fetched_at < max_age) {
    return cached;
  }

  const headers: Record<string, string> = { Accept: "application/x-yaml, text/yaml, text/plain, */*" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (cached !== null && truthy(meta["etag"]) && !force) {
    headers["If-None-Match"] = pyStr(meta["etag"]);
  }

  const suggestion =
    "Check your network connection, or point at a mirror with " +
    `--index-url / ${INDEX_URL_ENV}. For GitHub rate limits, authenticate ` +
    "with 'abx config set github_token'. As a last resort install directly " +
    "with 'abx template install owner/repo//subdir[@ref]'.";

  let resp: InstanceType<typeof httpx.Response>;
  try {
    resp = await asyncWith(
      new httpx.AsyncClient({ follow_redirects: true, timeout: _FETCH_TIMEOUT }),
      async (client) => client.get(url, { headers }),
    );
  } catch (exc) {
    if (exc instanceof HTTPError) {
      return _staleFallback(cached, {
        reason: `Could not reach the template index at ${url} (${exc.constructor.name}).`,
        index_url: url,
        suggestion,
      });
    }
    throw exc;
  }

  if (resp.status_code === 304 && cached !== null) {
    cached.fetched_at = now;
    _touchCacheMeta({
      source_url: cached.source_url,
      etag: (dget(meta, "etag") as string | null) ?? null,
      fetched_at: now,
      cache_dir,
    });
    return cached;
  }

  if (resp.status_code === 403 || resp.status_code === 429) {
    const remaining = resp.headers.get("X-RateLimit-Remaining");
    let body_text: string;
    try {
      body_text = (resp.text || "").toLowerCase();
    } catch {
      body_text = "";
    }
    if (remaining === "0" || body_text.includes("rate limit") || resp.status_code === 429) {
      return _staleFallback(cached, {
        reason: rateLimitMessage({ operation: "fetching the template index" }),
        index_url: url,
        suggestion: rateLimitSuggestion({
          extra:
            "Alternatively wait for the window to reset, or point at " +
            `a mirror via --index-url / ${INDEX_URL_ENV}.`,
        }),
        error_cls: GitHubRateLimitError,
      });
    }
    return _staleFallback(cached, {
      reason: `Template index request was rejected with HTTP 403 (${url}).`,
      index_url: url,
      suggestion,
    });
  }

  if (resp.status_code === 404) {
    return _staleFallback(cached, {
      reason: `Template index not found at ${url} (HTTP 404).`,
      index_url: url,
      suggestion:
        "Verify the index URL (--index-url / ABX_TEMPLATE_INDEX_URL); the " +
        "repository, branch, or file may have moved.",
    });
  }

  if (resp.status_code >= 500) {
    return _staleFallback(cached, {
      reason: `Template index server error at ${url} (HTTP ${resp.status_code}).`,
      index_url: url,
      suggestion,
    });
  }

  if (resp.status_code !== 200) {
    return _staleFallback(cached, {
      reason: `Unexpected HTTP ${resp.status_code} while fetching ${url}.`,
      index_url: url,
      suggestion,
    });
  }

  const index = parseIndex(resp.text, { source_url: url, fetched_at: now });
  _writeCache(resp.text, {
    source_url: url,
    etag: resp.headers.get("ETag"),
    fetched_at: now,
    cache_dir,
  });
  return index;
}
