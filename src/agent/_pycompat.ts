/**
 * CPython-behaviour helpers used by the natural-language / coding-agent slice
 * (`qwen_code.ts`, `clarify.ts`, `codegen.ts`, `adopt.ts`, ...).
 *
 * Everything here exists so the TypeScript port can reproduce the exact
 * semantics of the Python standard-library calls the original relies on
 * (`float()`, `str.split()`, `os.walk`, `shutil.which`, ``"{:.0f}".format``,
 * text-mode pipes with universal newlines, ...).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { StringDecoder } from "node:string_decoder";

import { UnicodeDecodeError, _utf8DecodeError } from "../utils/_pyos.js";

/** Python's `KeyboardInterrupt` (a `BaseException`: never swallowed by `except Exception`). */
export class KeyboardInterrupt extends Error {
  constructor(message = "") {
    super(message);
    this.name = "KeyboardInterrupt";
  }
}

/** Python's `subprocess.TimeoutExpired`. */
export class TimeoutExpired extends Error {
  readonly cmd: string;
  readonly timeout: number;
  constructor(cmd: string, timeout: number) {
    super(`Command '${cmd}' timed out after ${timeout} seconds`);
    this.name = "TimeoutExpired";
    this.cmd = cmd;
    this.timeout = timeout;
  }
}

// ---------------------------------------------------------------------------
// Numbers / formatting
// ---------------------------------------------------------------------------

const FLOAT_RE = /^[+-]?(?:(?:\d+(?:_\d+)*)(?:\.(?:\d+(?:_\d+)*)?)?|\.\d+(?:_\d+)*)(?:[eE][+-]?\d+(?:_\d+)*)?$/;
const FLOAT_SPECIAL_RE = /^[+-]?(?:inf|infinity|nan)$/i;

/** Python `float(text)`; returns `null` where Python raises `ValueError`. */
export function parsePyFloat(text: string): number | null {
  const stripped = pyStrip(text);
  if (FLOAT_SPECIAL_RE.test(stripped)) {
    const lower = stripped.toLowerCase();
    if (lower.endsWith("nan")) return Number.NaN;
    return lower.startsWith("-") ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  }
  if (!FLOAT_RE.test(stripped)) return null;
  return Number(stripped.replace(/_/g, ""));
}

/** Python `format(value, ".0f")` (round-half-to-even on exact halves). */
export function formatFixed0(value: number): string {
  if (Number.isNaN(value)) return "nan";
  if (!Number.isFinite(value)) return value > 0 ? "inf" : "-inf";
  const floor = Math.floor(value);
  const diff = value - floor;
  let rounded: number;
  if (diff === 0.5) rounded = floor % 2 === 0 ? floor : floor + 1;
  else rounded = Math.round(value);
  if (Object.is(rounded, -0) || (rounded === 0 && value < 0)) return "-0";
  return rounded.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 0 });
}

// ---------------------------------------------------------------------------
// Strings
// ---------------------------------------------------------------------------

/** Characters for which Python's `str.isspace()` is true. */
export const PY_WHITESPACE = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const WS_RE = new RegExp(`[${PY_WHITESPACE}]+`, "u");
const WS_TRIM_RE = new RegExp(`^[${PY_WHITESPACE}]+|[${PY_WHITESPACE}]+$`, "gu");

/** Python `str.strip()`. */
export function pyStrip(text: string): string {
  return text.replace(WS_TRIM_RE, "");
}

const WS_LTRIM_RE = new RegExp(`^[${PY_WHITESPACE}]+`, "u");
const WS_RTRIM_RE = new RegExp(`[${PY_WHITESPACE}]+$`, "u");

/** Python `str.lstrip()`. */
export function pyLstrip(text: string): string {
  return text.replace(WS_LTRIM_RE, "");
}

/** Python `str.rstrip()`. */
export function pyRstrip(text: string): string {
  return text.replace(WS_RTRIM_RE, "");
}

/** Python `str.split()` (no arguments). */
export function pySplitWhitespace(text: string): string[] {
  return text.split(WS_RE).filter((part) => part.length > 0);
}

/** Python `str.splitlines()`. */
export function pySplitLines(text: string): string[] {
  if (text === "") return [];
  const parts = text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/u);
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/** Python `str.strip(chars)` for a set of single characters. */
export function stripChars(text: string, chars: string): string {
  const set = new Set([...chars]);
  const cps = [...text];
  let start = 0;
  let end = cps.length;
  while (start < end && set.has(cps[start] as string)) start += 1;
  while (end > start && set.has(cps[end - 1] as string)) end -= 1;
  return cps.slice(start, end).join("");
}

/** Slice by Unicode code points (Python string slicing). */
export function cpSlice(text: string, start?: number, end?: number): string {
  return [...text].slice(start, end).join("");
}

export function cpLength(text: string): number {
  let n = 0;
  for (const _ of text) n += 1;
  return n;
}

/** Python string ordering (by code point) as an `Array.prototype.sort` comparator. */
export function cmpCodePoint(a: string, b: string): number {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const ra = ia.next();
    const rb = ib.next();
    if (ra.done && rb.done) return 0;
    if (ra.done) return -1;
    if (rb.done) return 1;
    const ca = (ra.value as string).codePointAt(0) as number;
    const cb = (rb.value as string).codePointAt(0) as number;
    if (ca !== cb) return ca < cb ? -1 : 1;
  }
}

/** Python `bytes.decode("utf-8", errors="ignore")`. */
export function decodeUtf8Ignore(data: Uint8Array): string {
  // Invalid sequences decode to U+FFFD; "ignore" drops them instead.
  return new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(data).replace(/\uFFFD/g, "");
}

/** Universal-newline translation of text-mode reads: `\r\n` and lone `\r` become `\n`. */
export function universalNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Python `Path.read_text(encoding="utf-8", errors="replace")` (a BOM is kept as U+FEFF; universal newlines). */
export function readTextReplace(file: string): string {
  return universalNewlines(new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(fs.readFileSync(file)));
}

/** Python `Path.read_text(encoding="utf-8")`: strict decoding (throws on invalid UTF-8), universal newlines. */
export function readTextStrict(file: string): string {
  const buf = fs.readFileSync(file);
  const problem = _utf8DecodeError(buf);
  if (problem !== null) throw new UnicodeDecodeError(problem);
  return universalNewlines(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf));
}

/** Strict UTF-8 decode (Python `read_text(encoding="utf-8")`); throws on invalid input. */
export function decodeUtf8Strict(data: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
}

/**
 * Incremental decoder for text-mode pipes: UTF-8 with `errors="replace"` and
 * universal newlines (`\r\n` and lone `\r` become `\n`), like
 * `subprocess.Popen(text=True, encoding="utf-8", errors="replace")`.
 */
export class TextPipeDecoder {
  private readonly decoder = new StringDecoder("utf8");
  private pendingCr = false;

  write(chunk: Buffer): string {
    return this.translate(this.decoder.write(chunk), false);
  }

  end(): string {
    return this.translate(this.decoder.end(), true);
  }

  private translate(text: string, final: boolean): string {
    let input = text;
    if (this.pendingCr) {
      input = `\r${input}`;
      this.pendingCr = false;
    }
    if (!final && input.endsWith("\r")) {
      this.pendingCr = true;
      input = input.slice(0, -1);
    }
    return input.replace(/\r\n?/g, "\n");
  }
}

// ---------------------------------------------------------------------------
// Filesystem
// ---------------------------------------------------------------------------

export function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Python `Path.exists()` (follows symlinks). */
export function pathExists(p: string): boolean {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Python `Path.expanduser()` for the current user. */
export function expandUser(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || (path.sep === "\\" && p.startsWith("~\\"))) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/** `Path.home()`. */
export function homeDir(): string {
  return os.homedir();
}

/** Python `os.walk(top, followlinks=False)` (top-down; consumers may prune `dirs` in place). */
export function* osWalk(top: string): Generator<[string, string[], string[]]> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(top, { withFileTypes: true });
  } catch {
    return;
  }
  const dirs: string[] = [];
  const files: string[] = [];
  for (const entry of entries) {
    let isDirectory = entry.isDirectory();
    if (!isDirectory && entry.isSymbolicLink()) isDirectory = isDir(path.join(top, entry.name));
    if (isDirectory) dirs.push(entry.name);
    else files.push(entry.name);
  }
  yield [top, dirs, files];
  for (const dirname of dirs) {
    const child = path.join(top, dirname);
    if (isSymlink(child)) continue;
    yield* osWalk(child);
  }
}

/** Python `shutil.which(cmd)` (POSIX and Windows `PATHEXT` semantics). */
export function which(cmd: string): string | null {
  const isWin = process.platform === "win32";
  const accessible = (file: string): boolean => {
    try {
      if (!fs.statSync(file).isFile()) return false;
      if (isWin) return true;
      fs.accessSync(file, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (path.dirname(cmd) !== ".") {
    return accessible(cmd) ? cmd : null;
  }
  const pathEnv = process.env.PATH ?? "";
  const dirs = pathEnv.split(path.delimiter).filter((d) => d.length > 0);
  if (isWin) dirs.unshift(process.cwd());
  let files = [cmd];
  if (isWin) {
    const pathext = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(path.delimiter).filter(Boolean);
    files = pathext.some((ext) => cmd.toLowerCase().endsWith(ext.toLowerCase()))
      ? [cmd]
      : pathext.map((ext) => cmd + ext);
  }
  const seen = new Set<string>();
  for (const dir of dirs) {
    const normdir = path.normalize(dir);
    const key = isWin ? normdir.toLowerCase() : normdir;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const file of files) {
      const candidate = path.join(dir, file);
      if (accessible(candidate)) return candidate;
    }
  }
  return null;
}

/** Python `time.strftime("%Y%m%d-%H%M%S")` in local time. */
export function timestampNow(now: Date = new Date()): string {
  const p2 = (n: number): string => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-` +
    `${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`
  );
}

// ---------------------------------------------------------------------------
// Async queue (Python `queue.Queue.get(timeout=...)`)
// ---------------------------------------------------------------------------

export const QUEUE_EMPTY: unique symbol = Symbol("queue-empty");

export class AsyncQueue<T> {
  private readonly items: T[] = [];
  private waiter: ((value: T | typeof QUEUE_EMPTY) => void) | null = null;

  put(item: T): void {
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve(item);
    } else {
      this.items.push(item);
    }
  }

  /** Next item, or `QUEUE_EMPTY` after `timeoutMs` of silence. */
  get(timeoutMs: number): Promise<T | typeof QUEUE_EMPTY> {
    if (this.items.length > 0) return Promise.resolve(this.items.shift() as T);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        resolve(QUEUE_EMPTY);
      }, Math.max(timeoutMs, 0));
      this.waiter = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Paths and text-mode writes
// ---------------------------------------------------------------------------

/**
 * `str(Path(p))`: collapses repeated separators and `.` segments and drops a trailing separator (`..` is kept).
 * Only the POSIX flavour is emulated; on Windows the platform normaliser is used.
 */
export function pyPathStr(p: string): string {
  if (path.sep !== "/") return path.normalize(p).replace(/(?<=.)[\\/]+$/, "");
  if (p === "") return ".";
  const leading = p.startsWith("//") && !p.startsWith("///") ? "//" : p.startsWith("/") ? "/" : "";
  const parts = p.split("/").filter((part) => part !== "" && part !== ".");
  const joined = parts.join("/");
  return leading + joined || (leading ? leading : ".");
}

/**
 * Python `Path.write_text(content, encoding="utf-8")`: text mode translates `\n` to `os.linesep`
 * (a no-op everywhere except Windows).
 */
export function writeTextUtf8(file: string, content: string): void {
  fs.writeFileSync(file, os.EOL === "\n" ? content : content.replace(/\n/g, os.EOL), { encoding: "utf-8" });
}
