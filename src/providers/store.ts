/** On-disk provider store (`~/.ebx/providers`): layout, tree digest, receipts, locking (port of `providers/store.py`). */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { paths } from "../transport/config_layers.js";
import { validateProviderId } from "../utils/config_keys.js";
import { ProviderInstallError, ProviderIntegrityError, ProviderNotFoundError } from "./errors.js";

export const RECEIPT_NAME = ".ebx-install.json";
export const RECEIPT_VERSION = 1;

export const MAX_FILES = 2000;
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const EXCLUDED_TOP = new Set([".git", RECEIPT_NAME]);
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Root of the store; follows the (patchable) location of `config.toml`. */
export function providersDir(): string {
  return path.join(path.dirname(paths.configFile), "providers");
}

export function providerDir(providerId: string): string {
  return path.join(providersDir(), providerId);
}

export function dataDir(providerId: string): string {
  const dir = path.join(providerDir(providerId), "data");
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* best effort */
  }
  return dir;
}

/** One regular file of a plugin tree. */
export interface FileEntry {
  /** POSIX, relative. */
  path: string;
  executable: boolean;
  data: Buffer;
}

export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

// ---------------------------------------------------------------- digest

/**
 * Tree digest from `(path, executable, file_sha256_hex)` triples: SHA-256 over, for each file sorted by UTF-8 path
 * bytes, `path \0 ("x"|"-") \0 file_sha256_hex \n`. `.git/` and the receipt are excluded by the callers.
 */
export function digestFromEntries(entries: ReadonlyArray<readonly [string, boolean, string]>): string {
  const h = createHash("sha256");
  const sorted = [...entries].sort((a, b) => Buffer.compare(Buffer.from(a[0], "utf-8"), Buffer.from(b[0], "utf-8")));
  for (const [p, executable, fileHash] of sorted) {
    h.update(Buffer.from(p, "utf-8"));
    h.update(Buffer.from([0]));
    h.update(Buffer.from(executable ? "x" : "-"));
    h.update(Buffer.from([0]));
    h.update(Buffer.from(fileHash, "ascii"));
    h.update(Buffer.from("\n"));
  }
  return h.digest("hex");
}

export function digestFiles(entries: readonly FileEntry[]): string {
  return digestFromEntries(entries.map((e) => [e.path, e.executable, sha256Hex(e.data)] as const));
}

/** Regular files of an installed directory, `.git/`, the receipt and the top-level `data/` excluded. */
function* walkRegular(root: string, rel = ""): Generator<string> {
  const dir = rel ? path.join(root, rel) : root;
  const names = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const ent of names) {
    if (!rel && (EXCLUDED_TOP.has(ent.name) || ent.name === "data")) continue;
    const child = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) yield* walkRegular(root, child);
    else yield child;
  }
}

/** Digest of an installed directory (re-computed from disk). */
export function digestDir(root: string): string {
  const triples: Array<[string, boolean, string]> = [];
  for (const rel of walkRegular(root)) {
    const full = path.join(root, ...rel.split("/"));
    const data = fs.readFileSync(full);
    triples.push([rel, (fs.statSync(full).mode & 0o100) !== 0, sha256Hex(data)]);
  }
  return digestFromEntries(triples);
}

// ---------------------------------------------------------------- path safety

/** Reject traversal, absolute/drive/NUL/backslash paths and reserved Windows names. */
export function validateRelPath(p: string): void {
  const unsafe = (): ProviderInstallError => new ProviderInstallError(`Unsafe entry '${p}' in provider source.`);
  if (!p || p.includes("\0") || p.includes("\\")) throw unsafe();
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) throw unsafe();
  const norm = path.posix.normalize(p);
  if (norm !== p || norm === ".." || norm.startsWith("../") || norm.startsWith("./")) throw unsafe();
  for (const part of p.split("/")) {
    if (part === "" || part === "." || part === ".." || WIN_RESERVED.test(part) || part.endsWith(".") || part.endsWith(" ")) throw unsafe();
  }
}

/** File-count/size limits and case-fold collisions. */
export function checkLimits(entries: readonly FileEntry[]): void {
  if (entries.length > MAX_FILES) throw new ProviderInstallError(`Provider source has more than ${MAX_FILES} files.`);
  let total = 0;
  const seen = new Map<string, string>();
  for (const e of entries) {
    validateRelPath(e.path);
    if ((e.path.split("/")[0] as string) === "data") {
      throw new ProviderInstallError("The top-level 'data/' directory is reserved for plugin state.");
    }
    if (e.data.length > MAX_FILE_BYTES) throw new ProviderInstallError(`Unsafe entry '${e.path}' in provider source (file too large).`);
    total += e.data.length;
    const folded = e.path.toLowerCase();
    const prev = seen.get(folded);
    if (prev !== undefined && prev !== e.path) throw new ProviderInstallError(`Unsafe entry '${e.path}' in provider source (case collision).`);
    seen.set(folded, e.path);
  }
  if (total > MAX_TOTAL_BYTES) throw new ProviderInstallError("Provider source exceeds the 50 MiB limit.");
}

/** Read a local plugin directory with the install safety rules (no symlinks/hardlinks/special files). */
export function collectLocalDir(src: string): FileEntry[] {
  let st: fs.Stats;
  try {
    st = fs.statSync(src);
  } catch {
    throw new ProviderInstallError(`Cannot fetch provider source: '${path.basename(src)}' is not a directory.`);
  }
  if (!st.isDirectory()) throw new ProviderInstallError(`Cannot fetch provider source: '${path.basename(src)}' is not a directory.`);
  const entries: FileEntry[] = [];
  let total = 0;
  const walk = (rel: string): void => {
    const dir = rel ? path.join(src, ...rel.split("/")) : src;
    const dirents = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const ent of dirents) {
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (!rel && EXCLUDED_TOP.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      const lst = fs.lstatSync(full);
      if (lst.isDirectory()) {
        walk(childRel);
        continue;
      }
      if (lst.isSymbolicLink() || !lst.isFile() || lst.nlink > 1) throw new ProviderInstallError(`Unsafe entry '${childRel}' in provider source.`);
      if (lst.size > MAX_FILE_BYTES) throw new ProviderInstallError(`Unsafe entry '${childRel}' in provider source (file too large).`);
      total += lst.size;
      if (total > MAX_TOTAL_BYTES || entries.length >= MAX_FILES) throw new ProviderInstallError("Provider source exceeds the size/file-count limits.");
      entries.push({ path: childRel, executable: (lst.mode & 0o100) !== 0, data: fs.readFileSync(full) });
    }
  };
  walk("");
  checkLimits(entries);
  return entries;
}

function chmodQuiet(p: string, mode: number): void {
  try {
    fs.chmodSync(p, mode);
  } catch {
    /* best effort */
  }
}

/** Write validated entries under `dest` (dirs 0700, files 0600, +x only where set; never overwrites). */
export function writeEntries(entries: readonly FileEntry[], dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  chmodQuiet(dest, 0o700);
  const dirs = new Set<string>();
  for (const e of entries) {
    const target = path.join(dest, ...e.path.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    let d = path.dirname(target);
    while (d.length > dest.length) {
      dirs.add(d);
      d = path.dirname(d);
    }
    const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, e.executable ? 0o700 : 0o600);
    try {
      fs.writeSync(fd, e.data);
    } finally {
      fs.closeSync(fd);
    }
    chmodQuiet(target, e.executable ? 0o700 : 0o600);
  }
  for (const d of dirs) chmodQuiet(d, 0o700);
}

// ---------------------------------------------------------------- receipt

export type Receipt = Record<string, unknown>;

export function readReceipt(providerId: string): Receipt | null {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(path.join(providerDir(providerId), RECEIPT_NAME), "utf-8"));
    return typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Receipt) : null;
  } catch {
    return null;
  }
}

function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (typeof v === "object" && v !== null) {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, sortKeysDeep((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

export function writeReceipt(directory: string, receipt: Receipt): void {
  const file = path.join(directory, RECEIPT_NAME);
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC, 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify(sortKeysDeep(receipt), null, 2)}\n`);
  } finally {
    fs.closeSync(fd);
  }
}

/** Drop any userinfo from a URL for receipts and logs. */
export function redactUrl(url: string): string {
  return url.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/@]*@/, "$1");
}

/**
 * Check the installed tree against its receipt; returns the receipt. Skipped for development links (trust `link`).
 * Throws `ProviderIntegrityError` when files changed since install, `ProviderNotFoundError` when not installed.
 */
export function verifyIntegrity(providerId: string): Receipt {
  const directory = providerDir(providerId);
  const receipt = readReceipt(providerId);
  if (receipt === null || !fs.existsSync(directory)) throw new ProviderNotFoundError(`Provider '${providerId}' is not installed.`);
  if (receipt["trust"] === "link") return receipt;
  const actual = digestDir(fs.realpathSync(directory));
  if (actual !== receipt["tree_sha256"]) {
    throw new ProviderIntegrityError(`Provider '${providerId}': files changed since install.`, {
      suggestion: `Reinstall or run 'ebx provider update ${providerId}'.`,
    });
  }
  return receipt;
}

export function listInstalledIds(): string[] {
  const root = providersDir();
  let names: fs.Dirent[];
  try {
    names = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const ids: string[] = [];
  for (const ent of names.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (ent.name.startsWith(".") || !(ent.isDirectory() || ent.isSymbolicLink())) continue;
    if (validateProviderId(ent.name) === null && fs.existsSync(path.join(root, ent.name, RECEIPT_NAME))) ids.push(ent.name);
  }
  return ids;
}

// ---------------------------------------------------------------- lock

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Exclusive install/update/uninstall lock (`O_EXCL` file with stale detection). */
export async function withStoreLock<T>(fn: () => Promise<T> | T, opts: { timeout?: number; staleAfter?: number } = {}): Promise<T> {
  const timeout = opts.timeout ?? 10;
  const staleAfter = opts.staleAfter ?? 300;
  const root = providersDir();
  fs.mkdirSync(root, { recursive: true });
  chmodQuiet(root, 0o700);
  const lock = path.join(root, ".lock");
  const deadline = Date.now() + timeout * 1000;
  for (;;) {
    try {
      const fd = fs.openSync(lock, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      break;
    } catch (exc) {
      if ((exc as NodeJS.ErrnoException).code !== "EEXIST") throw exc;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > staleAfter * 1000) {
          fs.unlinkSync(lock);
          continue;
        }
      } catch {
        /* lock vanished or unreadable: retry */
      }
      if (Date.now() >= deadline) {
        throw new ProviderInstallError("Another provider install/update is in progress.", {
          suggestion: `If none is running, remove ${path.join("providers", ".lock")} from your ebx directory.`,
        });
      }
      await sleep(50);
    }
  }
  try {
    return await fn();
  } finally {
    try {
      fs.unlinkSync(lock);
    } catch {
      /* already gone */
    }
  }
}

export function stagingDir(): string {
  const dir = path.join(providersDir(), ".staging");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function trashDir(): string {
  const dir = path.join(providersDir(), ".trash");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function removeTree(p: string): void {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(p);
  } catch {
    return;
  }
  if (st.isSymbolicLink()) fs.unlinkSync(p);
  else fs.rmSync(p, { recursive: true, force: true });
}
