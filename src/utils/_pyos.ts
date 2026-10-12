/**
 * Python `OSError` / `pathlib` / text-IO stand-ins shared by `utils/*` and `transport/*`:
 *
 *  - {@link OSError} with Python's `[Errno N] strerror: 'path'` text
 *  - {@link readTextPy} / {@link writeTextPy}: `Path.read_text(encoding="utf-8")` (strict decoding + universal
 *    newlines) and `Path.write_text`
 *  - {@link pyResolve}: `Path.resolve()` (symlink aware, non strict)
 *  - {@link pyExpandUser}: `Path.expanduser()` for the `~` / `~/…` forms
 *  - {@link AttributeError}, {@link PyTypeError}: messages of the Python exceptions that propagate unchanged
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ValueError } from "../models/_pydantic.js";
import { PyFloat, pyStrRepr } from "./_pyformat.js";

const ERRNO_TABLE: Record<string, [number, string]> = {
  EPERM: [1, "Operation not permitted"],
  ENOENT: [2, "No such file or directory"],
  EIO: [5, "Input/output error"],
  EACCES: [13, "Permission denied"],
  EEXIST: [17, "File exists"],
  ENOTDIR: [20, "Not a directory"],
  EISDIR: [21, "Is a directory"],
  EINVAL: [22, "Invalid argument"],
  ENOSPC: [28, "No space left on device"],
  EROFS: [30, "Read-only file system"],
  ENAMETOOLONG: [36, "File name too long"],
  ENOTEMPTY: [39, "Directory not empty"],
  ELOOP: [40, "Too many levels of symbolic links"],
};

export class OSError extends Error {
  errno: number | null;
  strerror: string;
  filename: string | null;
  code: string;

  constructor(message: string, opts: { errno?: number | null; strerror?: string; filename?: string | null; code?: string } = {}) {
    super(message);
    this.name = "OSError";
    this.errno = opts.errno ?? null;
    this.strerror = opts.strerror ?? message;
    this.filename = opts.filename ?? null;
    this.code = opts.code ?? "";
  }

  override toString(): string {
    return this.message;
  }
}

export class FileNotFoundError extends OSError {
  constructor(message: string, opts: ConstructorParameters<typeof OSError>[1] = {}) {
    super(message, opts);
    this.name = "FileNotFoundError";
  }
}

/** Convert a Node fs error into the Python `OSError` that the same operation would have raised. */
export function toOSError(e: unknown, filename?: string | null): Error {
  const code = String((e as NodeJS.ErrnoException)?.code ?? "");
  const entry = ERRNO_TABLE[code];
  if (!entry) return e instanceof Error ? e : new Error(String(e));
  const [errno, strerror] = entry;
  const msg = filename ? `[Errno ${errno}] ${strerror}: '${filename}'` : `[Errno ${errno}] ${strerror}`;
  const opts = { errno, strerror, filename: filename ?? null, code };
  return code === "ENOENT" ? new FileNotFoundError(msg, opts) : new OSError(msg, opts);
}

export class UnicodeDecodeError extends ValueError {
  constructor(message: string) {
    super(message);
    this.name = "UnicodeDecodeError";
  }
}

/**
 * CPython's message for the first undecodable UTF-8 sequence of `buf`, or `null` when `buf` is valid
 * (`'utf-8' codec can't decode byte 0xff in position 1: invalid start byte`).
 */
export function _utf8DecodeError(buf: Uint8Array): string | null {
  const n = buf.length;
  let i = 0;
  const fail = (start: number, end: number, reason: string): string => {
    const where =
      end - start === 1
        ? `byte 0x${(buf[start] as number).toString(16).padStart(2, "0")} in position ${start}`
        : `bytes in position ${start}-${end - 1}`;
    return `'utf-8' codec can't decode ${where}: ${reason}`;
  };
  while (i < n) {
    const b = buf[i] as number;
    if (b < 0x80) {
      i += 1;
      continue;
    }
    let need: number;
    let lo = 0x80;
    let hi = 0xbf;
    if (b >= 0xc2 && b <= 0xdf) need = 1;
    else if (b >= 0xe0 && b <= 0xef) {
      need = 2;
      if (b === 0xe0) lo = 0xa0;
      else if (b === 0xed) hi = 0x9f;
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3;
      if (b === 0xf0) lo = 0x90;
      else if (b === 0xf4) hi = 0x8f;
    } else return fail(i, i + 1, "invalid start byte");
    let k = 1;
    for (; k <= need; k++) {
      if (i + k >= n) return fail(i, n, "unexpected end of data");
      const c = buf[i + k] as number;
      const min = k === 1 ? lo : 0x80;
      const max = k === 1 ? hi : 0xbf;
      if (c < min || c > max) return fail(i, i + k, "invalid continuation byte");
    }
    i += need + 1;
  }
  return null;
}

export class AttributeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttributeError";
  }
  override toString(): string {
    return this.message;
  }
}

export class PyTypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TypeError";
  }
  override toString(): string {
    return this.message;
  }
}

/** Python `Path.read_text(encoding="utf-8")`. */
export function readTextPy(file: string): string {
  let buf: Buffer;
  try {
    buf = fs.readFileSync(file);
  } catch (e) {
    throw toOSError(e, file);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf);
  } catch {
    throw new UnicodeDecodeError(_utf8DecodeError(buf) ?? "'utf-8' codec can't decode bytes");
  }
  return text.replace(/\r\n?/g, "\n");
}

/** Python `Path.write_text(text, encoding="utf-8")` (newline translation is a no-op on POSIX). */
export function writeTextPy(file: string, text: string): void {
  try {
    fs.writeFileSync(file, os.EOL === "\n" ? text : text.replace(/\n/g, os.EOL), "utf-8");
  } catch (e) {
    throw toOSError(e, file);
  }
}

/** Python `Path.mkdir(parents=True, exist_ok=True)`. */
export function mkdirParents(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    throw toOSError(e, dir);
  }
}

/** `pwd.getpwnam(name).pw_dir` from `/etc/passwd`, or `null` for an unknown user. */
function passwdHome(name: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync("/etc/passwd", "utf8");
  } catch {
    return null;
  }
  for (const line of text.split("\n")) {
    const f = line.split(":");
    if (f[0] === name && f.length >= 6) return f[5] as string;
  }
  return null;
}

/**
 * `Path.expanduser()` (Python 3.11): a first component starting with `~` is replaced through `os.path.expanduser`
 * (`$HOME` / the passwd entry for `~`, the passwd entry for `~user`); a name that cannot be expanded raises
 * `RuntimeError("Could not determine home directory.")`.
 */
export function pyExpandUser(p: string): string {
  if (p.startsWith("/")) return p;
  const comps = p.split("/").filter((c) => c !== "" && c !== ".");
  const first = comps[0];
  if (first === undefined || !first.startsWith("~")) return p;
  let home: string = first;
  if (first === "~") {
    const env = process.env["HOME"];
    home = env !== undefined ? env : os.userInfo().homedir;
  } else {
    const entry = passwdHome(first.slice(1));
    if (entry !== null) home = entry;
  }
  if (home !== first) home = home.replace(/\/+$/, "") || "/";
  if (home.startsWith("~")) throw new Error("Could not determine home directory.");
  return pyJoin(home, ...comps.slice(1));
}

/** `Path.is_file()`. */
export function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** `Path.is_dir()`. */
export function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** `Path.exists()` (follows symlinks). */
export function pathExists(p: string): boolean {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

/** `Path.resolve()` / `os.path.realpath(p)` (non strict: missing components are kept). */
export function pyResolve(p: string): string {
  const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  const root = path.parse(abs).root;
  const pending = abs.slice(root.length).split(path.sep).filter((c) => c !== "" && c !== ".");
  let resolved = root;
  let links = 0;
  while (pending.length) {
    const comp = pending.shift() as string;
    if (comp === "..") {
      resolved = path.dirname(resolved);
      continue;
    }
    const next = path.join(resolved, comp);
    let st: fs.Stats | null = null;
    try {
      st = fs.lstatSync(next);
    } catch {
      st = null;
    }
    if (st && st.isSymbolicLink()) {
      if (++links > 40) return path.join(next, ...pending);
      const target = fs.readlinkSync(next);
      if (path.isAbsolute(target)) {
        resolved = path.parse(target).root;
        pending.unshift(...target.slice(resolved.length).split(path.sep).filter((c) => c !== "" && c !== "."));
      } else {
        pending.unshift(...target.split(path.sep).filter((c) => c !== "" && c !== "."));
      }
      continue;
    }
    resolved = next;
  }
  return resolved;
}

/** Python `type(x).__name__` for JSON-like values. */
export function pyTypeNameOf(v: unknown): string {
  if (v === null || v === undefined) return "NoneType";
  if (Array.isArray(v)) return "list";
  if (typeof v === "string") return "str";
  if (typeof v === "boolean") return "bool";
  if (v instanceof PyFloat) return "float";
  if (typeof v === "number" || typeof v === "bigint") return Number.isInteger(v) || typeof v === "bigint" ? "int" : "float";
  return "dict";
}

/**
 * `pathlib.PurePosixPath(base, *parts)` rendering: later absolute parts reset the path, empty and `.` components and
 * repeated or trailing slashes are dropped, `..` is kept as is.
 */
export function pyJoin(base: string, ...parts: string[]): string {
  let current = base;
  for (const part of parts) {
    if (part.startsWith("/")) current = part;
    else current = current === "" ? part : `${current}/${part}`;
  }
  const absolute = current.startsWith("/");
  const doubleRoot = current.startsWith("//") && !current.startsWith("///");
  const comps = current.split("/").filter((c) => c !== "" && c !== ".");
  const body = comps.join("/");
  if (absolute) return (doubleRoot ? "//" : "/") + body;
  return body === "" ? "." : body;
}

type CopyErrors = Array<string | [string, string, string]>;

/** `shutil.Error`: `str()` is the repr of the collected `(src, dst, why)` tuples. */
export class ShutilError extends OSError {
  readonly errors: CopyErrors;

  constructor(errors: CopyErrors) {
    super(`[${errors.map((e) => (typeof e === "string" ? pyStrRepr(e) : `(${e.map(pyStrRepr).join(", ")})`)).join(", ")}]`);
    this.name = "Error";
    this.errors = errors;
  }
}

function osJoin(base: string, name: string): string {
  return base.endsWith("/") ? base + name : `${base}/${name}`;
}

function statOrNull(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function copystat(src: string, dst: string): void {
  let st: fs.BigIntStats;
  try {
    st = fs.statSync(src, { bigint: true });
  } catch (e) {
    throw toOSError(e, src);
  }
  try {
    fs.utimesSync(dst, Number(st.atimeNs) / 1e9, Number(st.mtimeNs) / 1e9);
    fs.chmodSync(dst, Number(st.mode & 0o7777n));
  } catch (e) {
    throw toOSError(e, dst);
  }
}

/** `shutil.copy2`: raises the exceptions of `copyfile` / `copystat`. */
function copy2(src: string, dst: string, srcRepr: string): void {
  const a = statOrNull(src);
  const b = statOrNull(dst);
  if (a !== null && b !== null && a.ino === b.ino && a.dev === b.dev) {
    // SameFileError is a shutil.Error whose single argument is a str; copytree then `errors.extend()`s its characters.
    throw new ShutilError([...`${srcRepr} and ${pyStrRepr(dst)} are the same file`]);
  }
  for (const [fn, st] of [[src, a], [dst, b]] as const) {
    if (st !== null && st.isFIFO()) throw new OSError(`\`${fn}\` is a named pipe`);
  }
  let inFd: number;
  try {
    inFd = fs.openSync(src, "r");
  } catch (e) {
    throw toOSError(e, src);
  }
  try {
    let outFd: number;
    try {
      outFd = fs.openSync(dst, "w");
    } catch (e) {
      throw toOSError(e, dst);
    }
    try {
      const buf = Buffer.allocUnsafe(1 << 20);
      for (;;) {
        const n = fs.readSync(inFd, buf, 0, buf.length, null);
        if (n === 0) break;
        let off = 0;
        while (off < n) off += fs.writeSync(outFd, buf, off, n - off);
      }
    } catch (e) {
      throw toOSError(e);
    } finally {
      fs.closeSync(outFd);
    }
  } finally {
    fs.closeSync(inFd);
  }
  copystat(src, dst);
}

function copytreeEntries(entries: fs.Dirent[], src: string, dst: string): void {
  try {
    fs.mkdirSync(dst, { recursive: true });
  } catch (e) {
    throw toOSError(e, dst);
  }
  const errors: CopyErrors = [];
  for (const entry of entries) {
    const srcname = osJoin(src, entry.name);
    const dstname = osJoin(dst, entry.name);
    try {
      let isDir = entry.isDirectory();
      if (entry.isSymbolicLink()) {
        try {
          fs.readlinkSync(srcname);
        } catch (e) {
          throw toOSError(e, srcname);
        }
        isDir = statOrNull(srcname)?.isDirectory() ?? false;
      }
      if (isDir) pyCopytree(srcname, dstname);
      else copy2(srcname, dstname, `<DirEntry ${pyStrRepr(entry.name)}>`);
    } catch (e) {
      if (e instanceof ShutilError) errors.push(...e.errors);
      else if (e instanceof OSError) errors.push([srcname, dstname, e.message]);
      else throw e;
    }
  }
  try {
    copystat(src, dst);
  } catch (e) {
    if (!(e instanceof OSError)) throw e;
    errors.push([src, dst, e.message]);
  }
  if (errors.length > 0) throw new ShutilError(errors);
}

/**
 * `shutil.copytree(src, dst, dirs_exist_ok=True)`: entries are snapshotted in `os.scandir` order before `dst` is created,
 * symlinks are followed, failures are collected per entry and raised together as {@link ShutilError}.
 */
export function pyCopytree(src: string, dst: string): void {
  let entries: fs.Dirent[];
  try {
    entries = scandirEntries(src);
  } catch (e) {
    throw toOSError(e, src);
  }
  copytreeEntries(entries, src, dst);
}

/** `os.scandir` entries in the raw `readdir` order of the filesystem (`fs.readdirSync` would sort them). */
export function scandirEntries(dir: string): fs.Dirent[] {
  const handle = fs.opendirSync(dir);
  const entries: fs.Dirent[] = [];
  try {
    for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) entries.push(entry);
  } finally {
    handle.closeSync();
  }
  return entries;
}

/** Names of {@link scandirEntries}. */
export function scandirNames(dir: string): string[] {
  return scandirEntries(dir).map((entry) => entry.name);
}

/**
 * `Path.rglob("*")` limited to the relative paths of its entries (Python 3.11 semantics): each directory yields its
 * entries in `os.scandir` order, then the sub-directories are descended depth-first in that same order; symlinks to
 * directories are listed but never followed.
 */
export function rglobAll(root: string): string[] {
  const found: string[] = [];
  const visit = (dir: string): void => {
    let names: string[];
    try {
      names = scandirNames(dir);
    } catch {
      return;
    }
    const subdirs: string[] = [];
    for (const entry of names) {
      const full = path.join(dir, entry);
      found.push(path.relative(root, full));
      try {
        if (fs.lstatSync(full).isDirectory()) subdirs.push(full);
      } catch {
        /* vanished entry */
      }
    }
    for (const sub of subdirs) visit(sub);
  };
  visit(root);
  return found;
}

/**
 * `Path.rglob(name)` for a literal file name (Python 3.11): the directory itself first, then each sub-directory
 * depth-first in `os.scandir` order (symlinked directories are not descended); every visited directory yields
 * `dir/name` when it exists.
 */
export function* rglobName(root: string, name: string): Generator<string> {
  const candidate = path.join(root, name);
  if (fs.existsSync(candidate)) yield candidate;
  let entries: fs.Dirent[];
  try {
    entries = scandirEntries(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    const isDir = entry.isDirectory() && !entry.isSymbolicLink();
    if (isDir) yield* rglobName(path.join(root, entry.name), name);
  }
}
