/**
 * Small CPython-compatibility helpers (string whitespace rules, code-point lengths, strict number parsing) used by
 * the command modules.
 */

/** Characters `str.split()` / `str.strip()` treat as whitespace in CPython. */
export const PY_WHITESPACE =
  "\t\n\u000b\u000c\r\u001c\u001d\u001e\u001f \u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000";

const WS_CLASS = `[${PY_WHITESPACE}]`;
const LSTRIP_RE = new RegExp(`^${WS_CLASS}+`);
const RSTRIP_RE = new RegExp(`${WS_CLASS}+$`);
const SPLIT_RE = new RegExp(`${WS_CLASS}+`);

/** `str.lstrip()` (whitespace only). */
export function lstrip(s: string): string {
  return s.replace(LSTRIP_RE, "");
}

/** `str.rstrip()` (whitespace only). */
export function rstrip(s: string): string {
  return s.replace(RSTRIP_RE, "");
}

/** `str.strip()` (whitespace only). */
export function strip(s: string): string {
  return rstrip(lstrip(s));
}

/** `str.split()` with no arguments. */
export function splitWhitespace(s: string): string[] {
  return s.split(SPLIT_RE).filter((p) => p !== "");
}

/** `len(str)`: number of Unicode code points (JS `.length` counts UTF-16 units). */
export function len(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    n++;
  }
  return n;
}

/** `s[start:end]` by code points (non-negative, already clamped indices). */
export function cpSlice(s: string, start: number, end?: number): string {
  if (!/[\ud800-\udfff]/.test(s)) return s.slice(start, end);
  return Array.from(s).slice(start, end).join("");
}

/** `str.expandtabs(tabsize)`. */
export function expandTabs(s: string, tabsize = 8): string {
  let out = "";
  let col = 0;
  for (const ch of s) {
    if (ch === "\t") {
      if (tabsize > 0) {
        const n = tabsize - (col % tabsize);
        out += " ".repeat(n);
        col += n;
      }
    } else if (ch === "\n" || ch === "\r") {
      out += ch;
      col = 0;
    } else {
      out += ch;
      col += 1;
    }
  }
  return out;
}

/** `str.splitlines()` (without keepends); splits on every boundary CPython knows. */
export function splitlines(s: string): string[] {
  if (s === "") return [];
  const parts = s.split(/\r\n|[\n\r\u000b\u000c\u001c\u001d\u001e\u0085\u2028\u2029]/);
  if (parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/** `inspect.cleandoc`. */
export function cleandoc(doc: string): string {
  const lines = expandTabs(doc).split("\n");
  let margin = Number.MAX_SAFE_INTEGER;
  for (const line of lines.slice(1)) {
    const content = lstrip(line).length;
    if (content) {
      const indent = line.length - content;
      margin = Math.min(margin, indent);
    }
  }
  if (lines.length) lines[0] = lstrip(lines[0] as string);
  if (margin < Number.MAX_SAFE_INTEGER) {
    for (let i = 1; i < lines.length; i++) lines[i] = (lines[i] as string).slice(margin);
  }
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  while (lines.length && !lines[0]) lines.shift();
  return lines.join("\n");
}

const NONPRINTABLE_RE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;

/** `repr(str)`. */
export function pyStrRepr(s: string): string {
  let quote = "'";
  if (s.includes("'") && !s.includes('"')) quote = '"';
  let out = quote;
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if (ch === quote || ch === "\\") out += `\\${ch}`;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch !== " " && NONPRINTABLE_RE.test(ch)) {
      if (cp < 0x100) out += `\\x${cp.toString(16).padStart(2, "0")}`;
      else if (cp < 0x10000) out += `\\u${cp.toString(16).padStart(4, "0")}`;
      else out += `\\U${cp.toString(16).padStart(8, "0")}`;
    } else out += ch;
  }
  return out + quote;
}

import { PyFloat, pyFloatRepr } from "./_pyformat.js";

export { PyFloat, pyFloatRepr };

/** `str(value)` for the value kinds that occur in option defaults/values. */
export function pyStr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "string") return value;
  if (value instanceof PyFloat) return pyFloatRepr(value.value);
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : pyFloatRepr(value);
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(", ")}]`;
  return String(value);
}

/** `repr(value)` for JSON-like values. */
export function pyRepr(value: unknown): string {
  if (typeof value === "string") return pyStrRepr(value);
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(", ")}]`;
  return pyStr(value);
}

const ID_RE = /^[\p{XID_Start}_][\p{XID_Continue}]*$/u;

/** `str.isidentifier()`. */
export function isIdentifier(s: string): boolean {
  return ID_RE.test(s.normalize("NFKC"));
}

const ALNUM_RE = /^[\p{L}\p{N}]+$/u;

/** `str.isalnum()`. */
export function isAlnum(s: string): boolean {
  return ALNUM_RE.test(s);
}

/** `str.casefold()` (close approximation: lower-case with the common special cases). */
export function casefold(s: string): string {
  return s.toLowerCase().replace(/ß/g, "ss").replace(/ς/g, "σ");
}

/** `str.title()` for the ASCII words used by Click (`path` -> `Path`). */
export function title(s: string): string {
  return s.replace(/[\p{L}]+/gu, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/** `str.capitalize()`. */
export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** `str.ljust(width)` counting code points. */
export function ljust(s: string, width: number): string {
  const n = len(s);
  return n >= width ? s : s + " ".repeat(width - n);
}

/** `str.rjust(width)` counting code points (this is `f"{s:>{width}}"`). */
export function rjust(s: string, width: number): string {
  const n = len(s);
  return n >= width ? s : " ".repeat(width - n) + s;
}

/** First code points of every Unicode decimal-digit block (`Nd`) known to CPython 3.11's `unicodedata.decimal`. */
const DECIMAL_BLOCK_STARTS = [
  0x30, 0x660, 0x6f0, 0x7c0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66, 0xde6, 0xe50, 0xed0, 0xf20,
  0x1040, 0x1090, 0x17e0, 0x1810, 0x1946, 0x19d0, 0x1a80, 0x1a90, 0x1b50, 0x1bb0, 0x1c40, 0x1c50, 0xa620, 0xa8d0,
  0xa900, 0xa9d0, 0xa9f0, 0xaa50, 0xabf0, 0xff10, 0x104a0, 0x10d30, 0x11066, 0x110f0, 0x11136, 0x111d0, 0x112f0,
  0x11450, 0x114d0, 0x11650, 0x116c0, 0x11730, 0x118e0, 0x11950, 0x11c50, 0x11d50, 0x11da0, 0x16a60, 0x16ac0, 0x16b50,
  0x1d7ce, 0x1d7d8, 0x1d7e2, 0x1d7ec, 0x1d7f6, 0x1e140, 0x1e2f0, 0x1e950, 0x1fbf0,
];

/** What `int()` strips: the `str.strip()` set without the ASCII separators U+001C..U+001F. */
const INT_STRIP_RE = new RegExp(
  `^[${PY_WHITESPACE.replace(/[\u001c-\u001f]/g, "")}]+|[${PY_WHITESPACE.replace(/[\u001c-\u001f]/g, "")}]+$`,
  "g",
);

/** Decimal value of a Unicode `Nd` code point (what `int()` accepts), or -1. */
function decimalValue(cp: number): number {
  if (cp < 0x80) return cp >= 0x30 && cp <= 0x39 ? cp - 0x30 : -1;
  let lo = 0;
  let hi = DECIMAL_BLOCK_STARTS.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const start = DECIMAL_BLOCK_STARTS[mid] as number;
    if (cp < start) hi = mid - 1;
    else if (cp >= start + 10) lo = mid + 1;
    else return cp - start;
  }
  return -1;
}

/**
 * Python `int(str)` parsing; returns `null` for strings `int()` rejects. Like CPython: surrounding whitespace (Unicode whitespace, except U+001C..U+001F) is ignored, an optional sign, Unicode decimal digits (`١`, fullwidth, ...) and single
 * underscores between digits are accepted, and more than 4300 digits is a `ValueError`. Magnitudes above 2**53 - 1 come back
 * as an exact `bigint` (Python ints are unbounded); everything else is a plain `number`.
 */
export function parseIntStrict(text: string): number | bigint | null {
  const s = text.replace(INT_STRIP_RE, "");
  let i = 0;
  let sign = 1;
  if (s[0] === "-" || s[0] === "+") {
    sign = s[0] === "-" ? -1 : 1;
    i = 1;
  }
  let digits = "";
  let prevUnderscore = true;
  let count = 0;
  for (const ch of s.slice(i)) {
    if (ch === "_") {
      if (prevUnderscore) return null;
      prevUnderscore = true;
      continue;
    }
    const d = decimalValue(ch.codePointAt(0) as number);
    if (d < 0) return null;
    digits += String(d);
    count += 1;
    prevUnderscore = false;
  }
  if (count === 0 || prevUnderscore || count > 4300) return null;
  const n = Number(digits);
  if (n > Number.MAX_SAFE_INTEGER) {
    const big = BigInt(digits);
    return sign < 0 ? -big : big;
  }
  return sign * n === 0 ? 0 : sign * n;
}

/** Python `float(str)` parsing; returns `null` for strings `float()` rejects. */
export function parseFloatStrict(text: string): number | null {
  const s = strip(text);
  const m = /^([+-]?)(?:(inf(?:inity)?)|(nan)|((?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?))$/i.exec(s);
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  if (m[2]) return sign * Infinity;
  if (m[3]) return Number.NaN;
  return sign * Number((m[4] as string).replace(/_/g, ""));
}

/** True for plain `{}`-style objects (what Python calls a `dict` here). */
export function isDict(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Comparator ordering strings by code point like Python's `str` comparison (JS default compares UTF-16 units). */
export function cmpStr(a: string, b: string): number {
  const ai = a[Symbol.iterator]();
  const bi = b[Symbol.iterator]();
  for (;;) {
    const x = ai.next();
    const y = bi.next();
    if (x.done && y.done) return 0;
    if (x.done) return -1;
    if (y.done) return 1;
    const cx = (x.value as string).codePointAt(0) as number;
    const cy = (y.value as string).codePointAt(0) as number;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
}

/** `sorted(strings)`. */
export function sortedStrings(items: Iterable<string>): string[] {
  return [...items].sort(cmpStr);
}
