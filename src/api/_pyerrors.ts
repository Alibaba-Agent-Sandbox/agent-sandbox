/**
 * Python built-in exception stand-ins used by ported SDK code that raises/catches `ValueError`,
 * `RuntimeError` and `NotImplementedError` (their messages are user-visible in places).
 */

import { PyFloat } from "../utils/_pyformat.js";
import { AttributeError } from "../utils/_pyos.js";

export { ValueError } from "../models/_pydantic.js";

export class RuntimeError extends Error {
  constructor(message = "") {
    super(message);
    this.name = "RuntimeError";
  }
}

export class NotImplementedError extends Error {
  constructor(message = "") {
    super(message);
    this.name = "NotImplementedError";
  }
}

/**
 * Python `str(exc)`: for plain exceptions the message; for exceptions that define `__str__`-style `toString()`
 * (the `SandboxError` family) that rendering.
 */
export function pyExcStr(e: unknown): string {
  if (e instanceof Error) {
    return e.toString !== Error.prototype.toString ? e.toString() : e.message;
  }
  return String(e);
}

/**
 * Python `d.get(key, default)` for plain-object dicts (a present key holding `null` yields `null`). Anything that is not
 * a dict raises the `AttributeError` Python raises (`'list' object has no attribute 'get'`).
 */
export function dictGet(d: unknown, key: string, dflt: unknown = null): any {
  if (d === null || typeof d !== "object" || Array.isArray(d) || d instanceof PyFloat || d instanceof Uint8Array) {
    throw new AttributeError(`'${pyTypeName(d)}' object has no attribute 'get'`);
  }
  if (Object.prototype.hasOwnProperty.call(d, key)) return (d as Record<string, unknown>)[key];
  return dflt;
}

/** Python `repr(bytes)`. */
export function pyBytesRepr(buf: Uint8Array): string {
  const hasSingle = buf.includes(0x27);
  const hasDouble = buf.includes(0x22);
  const quote = hasSingle && !hasDouble ? '"' : "'";
  let out = "";
  for (const b of buf) {
    if (b === 0x5c) out += "\\\\";
    else if (b === quote.charCodeAt(0)) out += `\\${quote}`;
    else if (b === 0x09) out += "\\t";
    else if (b === 0x0a) out += "\\n";
    else if (b === 0x0d) out += "\\r";
    else if (b < 0x20 || b >= 0x7f) out += `\\x${b.toString(16).padStart(2, "0")}`;
    else out += String.fromCharCode(b);
  }
  return `b${quote}${out}${quote}`;
}

/** Python `bytes.strip()` truthiness helper: `content and content.strip()`. */
export function hasBodyContent(content: Uint8Array | null | undefined): boolean {
  if (!content || content.length === 0) return false;
  for (const b of content) {
    if (!(b === 0x20 || (b >= 0x09 && b <= 0x0d))) return true;
  }
  return false;
}

/** Python `type(value).__name__` for JSON-like values. */
export function pyTypeName(value: unknown): string {
  if (value === null || value === undefined) return "NoneType";
  if (Array.isArray(value)) return "list";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "float";
  if (typeof value === "bigint") return "int";
  if (value instanceof PyFloat) return "float";
  if (typeof value === "string") return "str";
  if (value instanceof Uint8Array) return "bytes";
  return "dict";
}

/** Python `value.encode()` (UTF-8) for a `str`; other types raise Python's `AttributeError` text. */
export function pyEncodeUtf8(value: unknown): Buffer {
  if (typeof value !== "string") throw new TypeError(`'${pyTypeName(value)}' object has no attribute 'encode'`);
  return Buffer.from(value, "utf8");
}
