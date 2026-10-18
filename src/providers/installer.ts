/**
 * Install, update and uninstall provider plugins. Nothing from a plugin is ever executed here (port of
 * `providers/installer.py`, including the `data/`-preserving rollback and `--allow-insecure-transport` on update).
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { paths, loadTomlFile } from "../transport/config_layers.js";
import { BUILTIN_PROVIDER_ID } from "../utils/config_keys.js";
import { hostVersion } from "./host.js";
import {
  ProviderConflictError,
  ProviderInstallError,
  ProviderIntegrityError,
  ProviderNotFoundError,
  ProviderTrustError,
} from "./errors.js";
import { MANIFEST_NAME, checkRequires, loadManifest, manifestSummary, missingManifestError, parseManifest, type Manifest } from "./manifest.js";
import { purgeProviderSettings, setDefaultProvider } from "./settings.js";
import * as store from "./store.js";

const SHA40 = /^[0-9a-f]{40}$/;
const SCP_URL = /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:(?!\/\/).+$/;
const GIT_TIMEOUT_MS = 120_000;
const GIT_OUTPUT_CAP = 160 * 1024 * 1024;

/** Manifest aspects whose change forces a new consent on update. */
export const RISK_ASPECTS = ["runtime", "security", "features", "inherit", "fields", "commands"] as const;

/** Test seam: the single place a directory is atomically swapped into the store. */
export const fsHooks = {
  rename: (from: string, to: string): void => fs.renameSync(from, to),
};

export type Receipt = store.Receipt;

export interface SourceInfo {
  type: "local" | "git" | "link" | "catalog";
  path?: string;
  url?: string;
  ref?: string;
  commit?: string;
  subdir?: string;
  id?: string;
  registry?: string;
}

/** Everything the consent screen shows. */
export class InstallPlan {
  previous: Receipt | null = null;
  changes: string[] = [];

  constructor(
    public manifest: Manifest,
    public source: SourceInfo,
    public tree_sha256: string,
    public trust: "local" | "pinned" | "unpinned" | "link",
  ) {}

  summary(): Record<string, unknown> {
    const m = this.manifest;
    return {
      id: m.id,
      name: m.name,
      name_zh: m.name_zh,
      version: m.version,
      source: this.source,
      tree_sha256: this.tree_sha256,
      trust: this.trust,
      runtime: m.kind === "exec" ? [...m.command] : m.kind === "node" ? ["node", m.entry] : ["rest", String(m.endpoint["base_url"] ?? "")],
      kind: m.kind,
      features: [...m.features].sort(),
      commands: [...m.commands],
      security: m.security,
      fields: m.fields.map((f) => ({ key: f.key, secret: Boolean(f.secret) })),
      inherit: [...m.inherit].sort(),
      changes: [...this.changes],
    };
  }
}

export type ConfirmFn = (plan: InstallPlan) => boolean | Promise<boolean>;
export type VerifyFn = (providerId: string) => void | Promise<void>;

// ---------------------------------------------------------------- git

interface UrlParts {
  scheme: string;
  netloc: string;
}

function splitUrl(url: string): UrlParts {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):(?:\/\/([^/?#]*))?/.exec(url);
  return m ? { scheme: (m[1] as string).toLowerCase(), netloc: m[2] ?? "" } : { scheme: "", netloc: "" };
}

function expandUser(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** `("local", path)` or `("git", clean_url)`; rejects unsafe git URLs. */
const SLUG_PART = /^[A-Za-z0-9_.-]+$/;

/**
 * Turn `owner/repo//subdir[@ref]` into a GitHub URL plus subdir and ref.
 *
 * Same grammar as `abx template install`: `//` is the directory inside the
 * repository, `@` after that is the git ref. A full git URL, an scp-style
 * `git@host:path`, or a local path is returned unchanged. `--ref` and
 * `--subdir` still work; giving both forms with different values is an error.
 */
export function expandCatalogRef(
  source: string,
  ref?: string | null,
  subdir?: string | null,
): { source: string; ref: string | null; subdir: string | null } {
  const raw = source.trim();
  const unchanged = { source, ref: ref ?? null, subdir: subdir ?? null };
  if (
    !raw ||
    raw.includes("://") ||
    raw.startsWith("git@") ||
    raw.startsWith("./") ||
    raw.startsWith("/") ||
    raw.startsWith("~") ||
    (raw.length >= 3 && raw[1] === ":") ||
    fs.existsSync(raw)
  ) {
    return unchanged;
  }
  let body = raw;
  let embeddedRef: string | null = null;
  const at = body.lastIndexOf("@");
  if (at >= 0) {
    embeddedRef = body.slice(at + 1);
    body = body.slice(0, at);
  }
  let embeddedSubdir: string | null = null;
  const slash = body.indexOf("//");
  if (slash >= 0) {
    embeddedSubdir = body.slice(slash + 2).replace(/^\/+|\/+$/g, "") || null;
    body = body.slice(0, slash);
  }
  const parts = body.split("/");
  if (parts.length !== 2 || !parts.every((part) => SLUG_PART.test(part))) return unchanged;
  if (subdir && embeddedSubdir && subdir.replace(/^\/+|\/+$/g, "") !== embeddedSubdir) {
    throw new ProviderInstallError("Subdirectory given both in SOURCE (after //) and as --subdir.", {
      suggestion: "Use one of them: owner/repo//subdir, or a git URL with --subdir.",
    });
  }
  if (ref && embeddedRef && ref !== embeddedRef) {
    throw new ProviderInstallError("Ref given both in SOURCE (after @) and as --ref.", {
      suggestion: "Use one of them: owner/repo//subdir@ref, or --ref.",
    });
  }
  const repo = parts[1].endsWith(".git") ? parts[1].slice(0, -4) : parts[1];
  return {
    source: `https://github.com/${parts[0]}/${repo}.git`,
    ref: ref || embeddedRef,
    subdir: (subdir ? subdir.replace(/^\/+|\/+$/g, "") : null) || embeddedSubdir,
  };
}

export function classifySource(source: string, opts: { allowInsecure?: boolean } = {}): ["local" | "git", string] {
  const local = expandUser(source);
  if (fs.existsSync(local)) return ["local", local];
  const url = source.startsWith("git+") ? source.slice(4) : source;
  if (SCP_URL.test(url)) return ["git", url];
  const { scheme, netloc } = splitUrl(url);
  const insecure = (): ProviderTrustError =>
    new ProviderTrustError(`Insecure provider source '${source}'.`, {
      suggestion: "Use https:// or ssh:// (or --allow-insecure-transport for testing).",
    });
  if (!scheme && !url.startsWith("ext::")) {
    throw new ProviderInstallError(`Cannot fetch provider source: '${source}' is not a directory or a git URL.`, {
      suggestion: "Pass a local directory, owner/repo//subdir[@ref], or an https://, ssh:// or git@host:path URL.",
    });
  }
  if (url.startsWith("ext::") || !["https", "ssh", "http", "git", "file"].includes(scheme)) throw insecure();
  if (["http", "git", "file"].includes(scheme) && !opts.allowInsecure) throw insecure();
  if (scheme !== "file" && netloc.includes("@")) {
    const userinfo = netloc.slice(0, netloc.lastIndexOf("@"));
    if (scheme !== "ssh" || userinfo.includes(":")) {
      throw new ProviderTrustError("Insecure provider source: credentials in URLs are not accepted.", {
        suggestion: "Use an SSH agent or a git credential helper (clone it yourself and install the directory).",
      });
    }
  }
  return ["git", url];
}

function gitEnv(url: string, allowInsecure: boolean, scratch: string): NodeJS.ProcessEnv {
  const emptyCfg = path.join(scratch, "gitconfig");
  fs.writeFileSync(emptyCfg, "", "utf-8");
  const env: NodeJS.ProcessEnv = {
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ALLOW_PROTOCOL: `https:ssh${allowInsecure ? ":file:http:git" : ""}`,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: emptyCfg,
    HOME: scratch,
    XDG_CONFIG_HOME: scratch,
    LC_ALL: "C",
  };
  if (url.startsWith("ssh://") || SCP_URL.test(url)) {
    for (const name of ["HOME", "SSH_AUTH_SOCK", "SSH_AGENT_PID"]) {
      const v = process.env[name];
      if (v !== undefined) env[name] = v;
    }
  }
  if (process.platform === "win32") env["SYSTEMROOT"] = process.env["SYSTEMROOT"] ?? "";
  return env;
}

interface GitResult {
  code: number | null;
  stdout: Buffer;
  stderr: string;
}

function runGit(args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; stdin?: Buffer }): Promise<GitResult> {
  const hooks = path.join(opts.cwd, ".empty-hooks");
  fs.mkdirSync(hooks, { recursive: true });
  const argv = [
    "-c",
    `core.hooksPath=${hooks}`,
    "-c",
    "core.fsmonitor=false",
    "-c",
    "http.followRedirects=false",
    "-c",
    "protocol.ext.allow=never",
    "-c",
    "credential.helper=",
    ...args,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("git", argv, { cwd: opts.cwd, env: opts.env, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new ProviderInstallError("Cannot fetch provider source: git timed out.")));
    }, GIT_TIMEOUT_MS);
    child.stdout.on("data", (b: Buffer) => {
      size += b.length;
      if (size > GIT_OUTPUT_CAP) {
        child.kill("SIGKILL");
        finish(() => reject(new ProviderInstallError("Provider source exceeds the size/file-count limits.")));
        return;
      }
      out.push(b);
    });
    child.stderr.on("data", (b: Buffer) => {
      if (err.reduce((n, x) => n + x.length, 0) < 64 * 1024) err.push(b);
    });
    child.on("error", (exc: NodeJS.ErrnoException) => {
      finish(() => {
        if (exc.code === "ENOENT") {
          reject(
            new ProviderInstallError("Cannot fetch provider source: git is not installed.", {
              suggestion: "Install git or install the plugin from a local directory.",
            }),
          );
        } else reject(new ProviderInstallError(`Cannot fetch provider source: ${exc.message}.`));
      });
    });
    child.on("close", (code) => finish(() => resolve({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString("utf-8") })));
    child.stdin.on("error", () => undefined);
    child.stdin.end(opts.stdin);
  });
}

async function git(args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; stdin?: Buffer }): Promise<Buffer> {
  const res = await runGit(args, opts);
  if (res.code !== 0) {
    const lines = res.stderr.trim().split(/\r?\n/).filter(Boolean);
    const tail = lines.length > 0 ? (lines[lines.length - 1] as string) : "git failed";
    throw new ProviderInstallError(`Cannot fetch provider source: ${store.redactUrl(tail)}.`);
  }
  return res.stdout;
}

interface TreeRecord {
  mode: string;
  oid: string;
  size: number;
  path: string;
}

/** Parse `git ls-tree -r -z -l`; only regular blobs pass (no symlinks, submodules or odd modes). */
function parseLsTree(raw: Buffer): TreeRecord[] {
  const out: TreeRecord[] = [];
  let start = 0;
  while (start < raw.length) {
    let end = raw.indexOf(0, start);
    if (end < 0) end = raw.length;
    const record = raw.subarray(start, end);
    start = end + 1;
    if (record.length === 0) continue;
    const tab = record.indexOf(9);
    const meta = (tab < 0 ? record : record.subarray(0, tab)).toString("ascii");
    const pathBytes = tab < 0 ? Buffer.alloc(0) : record.subarray(tab + 1);
    const parts = meta.split(/\s+/).filter(Boolean);
    if (parts.length !== 4) throw new ProviderInstallError("Unsafe entry in provider source (unparsable tree).");
    const [mode, typ, oid, size] = parts as [string, string, string, string];
    const p = pathBytes.toString("utf-8");
    if (!Buffer.from(p, "utf-8").equals(pathBytes) || typ !== "blob" || (mode !== "100644" && mode !== "100755")) {
      throw new ProviderInstallError(`Unsafe entry '${p}' in provider source.`);
    }
    out.push({ mode, oid, size: /^\d+$/.test(size) ? Number(size) : 0, path: p });
  }
  return out;
}

export function validateSubdir(subdir: string): void {
  const s = subdir.replace(/^\/+|\/+$/g, "");
  if (!s || s.split("/").includes("..") || s.startsWith("/") || s.startsWith("-") || s.includes("\\") || s.includes("\0")) {
    throw new ProviderInstallError(`Unsafe --subdir '${subdir}'.`);
  }
}

async function readBlobs(records: TreeRecord[], opts: { repo: string; env: NodeJS.ProcessEnv }): Promise<store.FileEntry[]> {
  if (records.length === 0) return [];
  const request = Buffer.from(`${records.map((r) => r.oid).join("\n")}\n`, "ascii");
  const raw = await git(["cat-file", "--batch"], { cwd: opts.repo, env: opts.env, stdin: request });
  let pos = 0;
  const entries: store.FileEntry[] = [];
  for (const rec of records) {
    const eol = raw.indexOf(10, pos);
    const header = eol < 0 ? [] : raw.subarray(pos, eol).toString("ascii").split(/\s+/);
    if (header.length !== 3 || header[0] !== rec.oid || header[1] !== "blob") {
      throw new ProviderInstallError(`Cannot fetch provider source: missing object for '${rec.path}'.`);
    }
    const size = Number(header[2]);
    if (!Number.isInteger(size) || size < 0 || size > store.MAX_FILE_BYTES) {
      throw new ProviderInstallError(`Unsafe entry '${rec.path}' in provider source (file too large).`);
    }
    entries.push({ path: rec.path, executable: rec.mode === "100755", data: Buffer.from(raw.subarray(eol + 1, eol + 1 + size)) });
    pos = eol + 1 + size + 1;
  }
  return entries;
}

/** Fetch a git source *without checking anything out*; returns `{ entries, commit }`. */
export async function fetchGit(
  url: string,
  opts: { ref?: string | null; subdir?: string | null; allowInsecure?: boolean },
): Promise<{ entries: store.FileEntry[]; commit: string }> {
  const scratch = fs.mkdtempSync(path.join(store.stagingDir(), "git-"));
  try {
    const repo = path.join(scratch, "repo.git");
    fs.mkdirSync(repo);
    const env = gitEnv(url, Boolean(opts.allowInsecure), scratch);
    await git(["init", "--bare", "--quiet", "--template="], { cwd: repo, env });
    const target = opts.ref || "HEAD";
    const fetch = ["fetch", "--quiet", "--no-tags", "--no-recurse-submodules", "--filter=blob:limit=10m"];
    try {
      await git([...fetch, "--depth", "1", url, target], { cwd: repo, env });
    } catch (exc) {
      if (!(exc instanceof ProviderInstallError)) throw exc;
      await git([...fetch, url, target], { cwd: repo, env });
    }
    const commit = (await git(["rev-parse", "--verify", "FETCH_HEAD^{commit}"], { cwd: repo, env })).toString("utf-8").trim();
    if (opts.ref && SHA40.test(opts.ref) && commit !== opts.ref) {
      throw new ProviderInstallError("Cannot fetch provider source: the server returned a different commit.");
    }
    if (opts.subdir) validateSubdir(opts.subdir);
    const spec = opts.subdir ? `${commit}:${opts.subdir.replace(/^\/+|\/+$/g, "")}` : commit;
    const listing = await git(["ls-tree", "-r", "-z", "-l", spec], { cwd: repo, env });
    const records = parseLsTree(listing);
    if (records.length > store.MAX_FILES) throw new ProviderInstallError(`Provider source has more than ${store.MAX_FILES} files.`);
    let total = 0;
    for (const rec of records) {
      store.validateRelPath(rec.path);
      if (rec.size > store.MAX_FILE_BYTES) throw new ProviderInstallError(`Unsafe entry '${rec.path}' in provider source (file too large).`);
      total += rec.size;
    }
    if (total > store.MAX_TOTAL_BYTES) throw new ProviderInstallError("Provider source exceeds the 50 MiB limit.");
    const entries = await readBlobs(records, { repo, env });
    store.checkLimits(entries);
    return { entries, commit };
  } finally {
    store.removeTree(scratch);
  }
}

// ---------------------------------------------------------------- install

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function manifestFromEntries(entries: readonly store.FileEntry[]): Manifest {
  const found = entries.find((e) => e.path === MANIFEST_NAME);
  if (!found) throw missingManifestError();
  return parseManifest(found.data);
}

function sameJson(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === "object") {
      const record = value as Record<string, unknown>;
      return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonical(record[key])]));
    }
    return value;
  };
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/** Which risk aspects of `new` differ from what the user consented to in `old`. */
export function diffAspects(old: Receipt, next: Manifest): string[] {
  const consented = (old["consented"] ?? {}) as Record<string, unknown>;
  const summary = manifestSummary(next);
  const changed: string[] = [];
  if (!sameJson(consented["runtime"], summary.runtime)) changed.push("runtime");
  if (!sameJson(sortedSecurity(consented["security"]), sortedSecurity(summary.security))) changed.push("security");
  if (!sameJson(consented["features"], summary.features)) changed.push("features");
  const had = new Set((consented["inherit"] as string[] | undefined) ?? []);
  if (!summary.inherit.every((k) => had.has(k))) changed.push("inherit");
  if (!sameJson(consented["fields"], summary.fields)) changed.push("fields");
  if (!sameJson(consented["commands"] ?? [], summary.commands)) changed.push("commands");
  return changed;
}

function sortedSecurity(v: unknown): unknown {
  if (typeof v !== "object" || v === null) return v;
  const rec = v as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(rec)
      .sort()
      .map((k) => [k, rec[k]]),
  );
}

function makeReceipt(plan: InstallPlan, installedBy: Record<string, string> | null | undefined, manifestSha: string, version: string): Receipt {
  const m = plan.manifest;
  return {
    receipt_version: store.RECEIPT_VERSION,
    id: m.id,
    version: m.version,
    source: plan.source,
    tree_sha256: plan.tree_sha256,
    manifest_sha256: manifestSha,
    trust: plan.trust,
    consented: manifestSummary(m),
    installed_at: nowIso(),
    installed_by: installedBy ?? { name: "abx", version },
  };
}

export interface PrepareOptions {
  ref?: string | null;
  subdir?: string | null;
  sha256?: string | null;
  link?: boolean;
  allowInsecureTransport?: boolean;
}

/** Fetch and validate a source; nothing is written to the store. */
export async function prepare(source: string, opts: PrepareOptions = {}): Promise<{ plan: InstallPlan; entries: store.FileEntry[] }> {
  const expanded = expandCatalogRef(source, opts.ref, opts.subdir);
  source = expanded.source;
  opts = { ...opts, ref: expanded.ref, subdir: expanded.subdir };
  const [kind, location] = classifySource(source, { allowInsecure: opts.allowInsecureTransport });
  if (opts.link) {
    if (kind !== "local") throw new ProviderInstallError("--link needs a local directory.");
    if (process.platform === "win32") throw new ProviderTrustError("--link is not supported on Windows.");
    const root = fs.realpathSync(location);
    const manifest = loadManifest(root);
    return { plan: new InstallPlan(manifest, { type: "link", path: root }, "", "link"), entries: [] };
  }
  let entries: store.FileEntry[];
  let src: SourceInfo;
  let trust: InstallPlan["trust"];
  if (kind === "local") {
    let root = fs.realpathSync(location);
    if (opts.subdir) {
      validateSubdir(opts.subdir);
      root = path.join(root, opts.subdir.replace(/^\/+|\/+$/g, ""));
    }
    entries = store.collectLocalDir(root);
    src = { type: "local", path: root };
    trust = "local";
  } else {
    const fetched = await fetchGit(location, { ref: opts.ref, subdir: opts.subdir, allowInsecure: opts.allowInsecureTransport });
    entries = fetched.entries;
    src = { type: "git", url: store.redactUrl(location), ref: opts.ref || "HEAD", commit: fetched.commit, subdir: opts.subdir || "" };
    trust = opts.ref && SHA40.test(opts.ref) ? "pinned" : "unpinned";
  }
  const manifest = manifestFromEntries(entries);
  const digest = store.digestFiles(entries);
  if (opts.sha256) {
    if (opts.sha256.toLowerCase() !== digest) {
      throw new ProviderIntegrityError(`Tree digest mismatch: expected ${opts.sha256.toLowerCase()}, got ${digest}.`, {
        suggestion: "Review the plugin source and pass the digest you verified.",
      });
    }
    trust = "pinned";
  }
  return { plan: new InstallPlan(manifest, src, digest, trust), entries };
}

export interface InstallOptions extends PrepareOptions {
  force?: boolean;
  allowUnpinned?: boolean;
  yes?: boolean;
  confirm?: ConfirmFn;
  interactive?: boolean;
  /** Runs after the swap and may throw to roll back (used to run the plugin's `initialize`). */
  verify?: VerifyFn;
  installedBy?: Record<string, string>;
  /** Host (CLI) version checked against `compat.requires.cli`; defaults to this package's version. */
  hostVersion?: string;
}

/**
 * A tag or branch moves, so what was reviewed may not be what runs. An unpinned git source is accepted only when the user
 * reviews it on the consent screen (interactive and no `--yes`) or says so explicitly with `--allow-unpinned`.
 * `--yes` alone confirms a reviewed, pinned install; it never accepts a moving ref.
 */
function refuseUnpinned(plan: InstallPlan, how: { interactive: boolean; yes?: boolean | undefined; allowUnpinned?: boolean | undefined }): void {
  if (plan.trust !== "unpinned" || how.allowUnpinned) return;
  if (how.interactive && !how.yes) return;
  const commit = plan.source.commit;
  throw new ProviderTrustError(`Refusing an unpinned git source without review${how.yes ? " (--yes does not accept a moving ref)" : " in non-interactive mode"}.`, {
    suggestion: `Pin it: --ref ${commit ?? "<40-hex commit>"} (or --sha256 <digest>); or pass --allow-unpinned to accept the current head.`,
  });
}

/** Install a provider from a directory or git URL and return its receipt. */
export async function install(source: string, opts: InstallOptions = {}): Promise<Receipt> {
  const interactive = opts.interactive ?? opts.confirm !== undefined;
  const { plan, entries } = await prepare(source, opts);
  const manifest = plan.manifest;
  const host = opts.hostVersion ?? hostVersion();
  checkRequires(manifest, { component: "cli", host_version: host });

  if (plan.trust === "link" && !opts.yes) {
    throw new ProviderTrustError("--link requires --yes (the linked code is not pinned).", {
      suggestion: "Re-run with --yes after reviewing the directory.",
    });
  }
  refuseUnpinned(plan, { interactive, yes: opts.yes, allowUnpinned: opts.allowUnpinned });

  const existing = store.readReceipt(manifest.id);
  if (manifest.id === BUILTIN_PROVIDER_ID) throw new ProviderConflictError("The built-in provider id is reserved.");
  if (existing !== null && !opts.force) {
    throw new ProviderConflictError(`Provider id '${manifest.id}' is already installed.`, { suggestion: "Re-run with --force to replace it." });
  }
  if (existing !== null) {
    plan.previous = existing;
    plan.changes = diffAspects(existing, manifest);
  }

  if (!opts.yes) {
    if (!opts.confirm) {
      const commit = plan.source.commit;
      const subdir = plan.source.subdir;
      throw new ProviderTrustError("Installing a provider requires confirmation.", {
        suggestion: `Re-run with --yes after reviewing: abx provider install ${source}${subdir ? ` --subdir ${subdir}` : ""}${commit ? ` --ref ${commit}` : ""}`,
      });
    }
    if (!(await opts.confirm(plan))) throw new ProviderTrustError("Installation cancelled.");
  }

  const receipt = makeReceipt(plan, opts.installedBy, manifest.sha256, host);
  await store.withStoreLock(() => swapIn(manifest.id, entries, receipt, { link: plan.trust === "link", verify: opts.verify }));
  return receipt;
}

function moveDir(src: string, dest: string): void {
  try {
    fs.renameSync(src, dest);
  } catch (exc) {
    if ((exc as NodeJS.ErrnoException).code !== "EXDEV") throw exc;
    fs.cpSync(src, dest, { recursive: true, preserveTimestamps: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
}

/** Move a plugin's `data/` back where it came from (rollback); never throws. */
function returnData(src: string, dest: string): void {
  if (!fs.existsSync(src) || fs.existsSync(dest)) return;
  try {
    moveDir(src, dest);
  } catch {
    /* best effort */
  }
}

async function swapIn(
  providerId: string,
  entries: readonly store.FileEntry[],
  receipt: Receipt,
  opts: { link: boolean; verify?: VerifyFn | undefined },
): Promise<void> {
  const final = store.providerDir(providerId);
  const stage = path.join(store.stagingDir(), `${providerId}-${randomBytes(4).toString("hex")}`);
  let trash: string | null = null;
  try {
    if (opts.link) {
      fs.mkdirSync(stage, { recursive: true });
      try {
        fs.chmodSync(stage, 0o700);
      } catch {
        /* best effort */
      }
    } else {
      store.writeEntries(entries, stage);
    }
    store.writeReceipt(stage, receipt);
    if (fs.existsSync(final)) {
      trash = path.join(store.trashDir(), `${providerId}-${randomBytes(4).toString("hex")}`);
      try {
        fsHooks.rename(final, trash);
      } catch (exc) {
        const e = exc as NodeJS.ErrnoException;
        throw new ProviderInstallError(`Provider '${providerId}' is in use (${e.code ?? e.message}).`, {
          suggestion: "Close programs using it and retry.",
        });
      }
      if (fs.existsSync(path.join(trash, "data"))) moveDir(path.join(trash, "data"), path.join(stage, "data"));
    }
    fsHooks.rename(stage, final);
  } catch (exc) {
    if (trash !== null && fs.existsSync(trash) && !fs.existsSync(final)) {
      returnData(path.join(stage, "data"), path.join(trash, "data"));
      try {
        fs.renameSync(trash, final);
      } catch {
        /* best effort */
      }
    }
    store.removeTree(stage);
    throw exc;
  }
  if (opts.verify) {
    try {
      await opts.verify(providerId);
    } catch (exc) {
      if (trash !== null && fs.existsSync(trash)) {
        returnData(path.join(final, "data"), path.join(trash, "data"));
        store.removeTree(final);
        fs.renameSync(trash, final);
      } else {
        store.removeTree(final);
      }
      throw exc;
    }
  }
  if (trash !== null) store.removeTree(trash);
}

// ---------------------------------------------------------------- update / uninstall

export interface UpdateOptions {
  ref?: string | null;
  check?: boolean;
  yes?: boolean;
  confirm?: ConfirmFn;
  allowUnpinned?: boolean;
  allowInsecureTransport?: boolean;
  verify?: VerifyFn;
  hostVersion?: string;
}

export interface UpdateResult {
  id: string;
  status: "up-to-date" | "pinned" | "available" | "updated" | "bundled" | "manual";
  installed: string | null;
  available: string | null;
  changes: string[];
  message?: string;
}

/** Update one installed provider from its recorded git source. `local`/`link` installs throw `ProviderInstallError`. A catalog receipt is reinstalled with the CLI git spelling. */
export async function update(providerId: string, opts: UpdateOptions = {}): Promise<UpdateResult> {
  if (providerId === BUILTIN_PROVIDER_ID) {
    if (opts.ref) throw new ProviderInstallError("The bundled provider cannot use --ref. Select an abx release using the installation method that installed abx.");
    return {
      id: providerId, status: "bundled", installed: hostVersion(), available: null, changes: [],
      message: "This provider ships with abx. Upgrade abx using its original installation method, then restart your owned Node engine. This operation does not check the latest host release or change installed software.",
    };
  }
  const receipt = store.readReceipt(providerId);
  if (receipt === null) throw new ProviderNotFoundError(`Provider '${providerId}' is not installed.`);
  const src = (receipt["source"] ?? {}) as SourceInfo;
  if (src.type === "catalog") {
    const catalogId = typeof src.id === "string" && src.id !== "" ? src.id : providerId;
    throw new ProviderInstallError(
      `Provider '${providerId}' was installed from the catalog. Reinstall it with 'abx provider install alibaba-agent-sandbox/awesome-providers//${catalogId} --force'.`,
    );
  }
  if (src.type !== "git") {
    throw new ProviderInstallError(
      `Provider '${providerId}' was installed from a local directory; reinstall it with 'abx provider install --force <path>'.`,
    );
  }
  if (receipt["trust"] === "pinned" && !opts.ref) {
    return { id: providerId, status: "pinned", installed: src.commit ?? null, available: null, changes: [] };
  }
  const useRef = opts.ref || src.ref || "HEAD";
  const { plan, entries } = await prepare(src.url as string, {
    ref: useRef,
    subdir: src.subdir || null,
    allowInsecureTransport: opts.allowInsecureTransport,
  });
  if (plan.manifest.id !== providerId) {
    throw new ProviderInstallError(`Provider id changed from '${providerId}' to '${plan.manifest.id}'; refusing to update.`);
  }
  plan.changes = diffAspects(receipt, plan.manifest);
  plan.previous = receipt;
  const same = plan.tree_sha256 === receipt["tree_sha256"];
  const base = { id: providerId, installed: src.commit ?? null, available: plan.source.commit ?? null, changes: plan.changes };
  if (same) return { ...base, status: "up-to-date" };
  if (opts.check) return { ...base, status: "available" };
  refuseUnpinned(plan, { interactive: opts.confirm !== undefined, yes: opts.yes, allowUnpinned: opts.allowUnpinned });
  const host = opts.hostVersion ?? hostVersion();
  checkRequires(plan.manifest, { component: "cli", host_version: host });
  if (!opts.yes) {
    if (!opts.confirm) {
      throw new ProviderTrustError("Installing a provider requires confirmation.", {
        suggestion: `Re-run with --yes after reviewing: abx provider update ${providerId}`,
      });
    }
    if (!(await opts.confirm(plan))) throw new ProviderTrustError("Update cancelled.");
  }
  const installedBy = receipt["installed_by"] as Record<string, string> | undefined;
  const newReceipt = makeReceipt(plan, installedBy, plan.manifest.sha256, host);
  await store.withStoreLock(() => swapIn(providerId, entries, newReceipt, { link: false, verify: opts.verify }));
  return { ...base, status: "updated" };
}

export interface UninstallResult {
  id: string;
  removed: boolean;
  purged: boolean;
  default_reset: boolean;
}

/** Remove an installed provider. Resets the default when it pointed at it. */
export async function uninstall(providerId: string, opts: { purge?: boolean } = {}): Promise<UninstallResult> {
  const purge = Boolean(opts.purge);
  if (providerId === BUILTIN_PROVIDER_ID) throw new ProviderConflictError("The built-in provider cannot be removed.");
  if (store.readReceipt(providerId) === null && !fs.existsSync(store.providerDir(providerId))) {
    throw new ProviderNotFoundError(`Provider '${providerId}' is not installed.`);
  }
  const core = loadTomlFile(paths.configFile)["core"];
  const wasDefault = typeof core === "object" && core !== null && (core as Record<string, unknown>)["provider"] === providerId;
  await store.withStoreLock(() => {
    const directory = store.providerDir(providerId);
    if (purge) {
      store.removeTree(directory);
      return;
    }
    const data = path.join(directory, "data");
    if (!fs.existsSync(data)) {
      store.removeTree(directory);
      return;
    }
    const keep = path.join(store.trashDir(), `${providerId}-data-${randomBytes(4).toString("hex")}`);
    moveDir(data, keep);
    store.removeTree(directory);
    fs.mkdirSync(directory, { recursive: true });
    moveDir(keep, path.join(directory, "data"));
  });
  if (purge) purgeProviderSettings(providerId);
  let resetDefault = false;
  if (wasDefault) {
    setDefaultProvider(null);
    resetDefault = true;
  }
  const registry = await import("./registry.js");
  registry.forget(providerId);
  return { id: providerId, removed: true, purged: purge, default_reset: resetDefault };
}
