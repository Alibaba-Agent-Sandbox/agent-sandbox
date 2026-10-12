/**
 * Small CPython-compatibility helpers shared by the MCP runtime modules
 * (`mcp.ts`, `mcp_http.ts`, `tools.ts`).
 *
 * The Python MCP server serialises with `json.dumps` (spaced separators,
 * optional `ensure_ascii`), parses with `json.loads` (CPython error texts are
 * echoed to clients in `Parse error: ...`) and formats unknown values through
 * `str()` / `repr()`. Reproducing those byte for byte keeps the JSON-RPC wire
 * output identical to the original.
 */

export class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueError";
  }
}

/** Python `KeyError`: `str(KeyError("code"))` is `'code'`. */
export class KeyError extends Error {
  readonly key: unknown;
  constructor(key: unknown) {
    super(pyRepr(key));
    this.name = "KeyError";
    this.key = key;
  }
}

import { PyFloat, pyEntries } from "../utils/_pyformat.js";

export { JSONDecodeError, pyJsonLoads, pyJsonLoadsBytes } from "../utils/_pyjson.js";


// ---------------------------------------------------------------------------
// Python object model helpers
// ---------------------------------------------------------------------------

export type JsonObject = Record<string, unknown>;

export function isDict(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof PyFloat);
}

export { pyTruthy } from "../utils/_pyformat.js";

/** Python `type(value).__name__` for JSON values. */
export function pyTypeName(value: unknown): string {
  if (value === null || value === undefined) return "NoneType";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return Number.isInteger(value) && Math.abs(value) < 1e16 ? "int" : "float";
  if (typeof value === "bigint") return "int";
  if (value instanceof PyFloat) return "float";
  if (typeof value === "string") return "str";
  if (Array.isArray(value)) return "list";
  if (isDict(value)) return "dict";
  return "object";
}

function isUnhashable(value: unknown): boolean {
  return Array.isArray(value) || isDict(value);
}

/** Raise what `dict.get(value)` / `value in dict` raises for an unhashable key. */
export function assertHashable(value: unknown): void {
  if (isUnhashable(value)) {
    throw new Error(`unhashable type: '${pyTypeName(value)}'`);
  }
}

export function pyFloatRepr(n: number): string {
  if (Number.isNaN(n)) return "nan";
  if (n === Infinity) return "inf";
  if (n === -Infinity) return "-inf";
  if (Object.is(n, -0)) return "-0.0";
  if (Number.isInteger(n) && Math.abs(n) < 1e16) return `${n}.0`;
  const exp = n.toExponential();
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-])(\d+)$/.exec(exp);
  if (!m) return String(n);
  const sign = m[1] ?? "";
  const lead = m[2] ?? "0";
  const frac = m[3] ?? "";
  const expSign = m[4] ?? "+";
  const e10 = (expSign === "-" ? -1 : 1) * Number(m[5]);
  if (e10 < -4 || e10 >= 16) {
    const mant = frac ? `${lead}.${frac}` : lead;
    const absExp = String(Math.abs(e10)).padStart(2, "0");
    return `${sign}${mant}e${e10 < 0 ? "-" : "+"}${absExp}`;
  }
  const digits = lead + frac;
  if (e10 >= 0) {
    const intPart = digits.slice(0, e10 + 1).padEnd(e10 + 1, "0");
    const fracPart = digits.slice(e10 + 1) || "0";
    return `${sign}${intPart}.${fracPart}`;
  }
  return `${sign}0.${"0".repeat(-e10 - 1)}${digits}`;
}

function pyStringRepr(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (ch === quote || ch === "\\") out += `\\${ch}`;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (cp < 0x20 || cp === 0x7f) out += `\\x${cp.toString(16).padStart(2, "0")}`;
    else if (cp >= 0x80 && cp < 0xa0) out += `\\x${cp.toString(16).padStart(2, "0")}`;
    else if (cp >= 0xd800 && cp <= 0xdfff) out += `\\u${cp.toString(16).padStart(4, "0")}`;
    else out += ch;
  }
  return out + quote;
}

/** Python `repr()` of a JSON-shaped value. */
export function pyRepr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    return Number.isInteger(value) && Math.abs(value) < 1e16 ? String(value) : pyFloatRepr(value);
  }
  if (value instanceof PyFloat) return pyFloatRepr(value.value);
  if (typeof value === "string") return pyStringRepr(value);
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(", ")}]`;
  if (isDict(value)) {
    return `{${pyEntries(value)
      .map(([k, v]) => `${pyStringRepr(k)}: ${pyRepr(v)}`)
      .join(", ")}}`;
  }
  return String(value);
}

/** Python `str()` of a JSON-shaped value. */
export function pyStr(value: unknown): string {
  return typeof value === "string" ? value : pyRepr(value);
}

const PY_WHITESPACE =
  "\\t\\n\\u000b\\u000c\\r\\u001c-\\u001f \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const PY_STRIP_RE = new RegExp(`^[${PY_WHITESPACE}]+|[${PY_WHITESPACE}]+$`, "gu");

/** Python `str.strip()` (Unicode whitespace; unlike JS `\s`, U+FEFF is not stripped). */
export function pyStrip(text: string): string {
  return text.replace(PY_STRIP_RE, "");
}

// ---------------------------------------------------------------------------
// json.dumps
// ---------------------------------------------------------------------------

export interface DumpsOptions {
  /** `json.dumps(ensure_ascii=...)`; Python defaults to true. */
  ensureAscii?: boolean;
  /** `separators=(",", ":")` instead of the `", "` / `": "` defaults. */
  compact?: boolean;
  /** `allow_nan`; Python defaults to true. */
  allowNan?: boolean;
  /** `default=str` fallback for non-serialisable values. */
  defaultStr?: boolean;
}

function dumpString(text: string, ensureAscii: boolean): string {
  const out = JSON.stringify(text);
  if (!ensureAscii) return out;
  return out.replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Python `json.dumps(value, ...)`. */
export function pyJsonDumps(value: unknown, options: DumpsOptions = {}): string {
  const ensureAscii = options.ensureAscii ?? true;
  const itemSep = options.compact ? "," : ", ";
  const keySep = options.compact ? ":" : ": ";
  const allowNan = options.allowNan ?? true;
  const seen = new Set<object>();

  const encode = (v: unknown): string => {
    if (v === null || v === undefined) return "null";
    if (v === true) return "true";
    if (v === false) return "false";
    if (typeof v === "string") return dumpString(v, ensureAscii);
    if (typeof v === "bigint") return v.toString();
    if (v instanceof PyFloat) {
      const n = v.value;
      if (!Number.isFinite(n)) {
        if (!allowNan) {
          throw new ValueError(`Out of range float values are not JSON compliant: ${pyFloatRepr(n)}`);
        }
        return Number.isNaN(n) ? "NaN" : n > 0 ? "Infinity" : "-Infinity";
      }
      return pyFloatRepr(n);
    }
    if (typeof v === "number") {
      if (!Number.isFinite(v)) {
        if (!allowNan) {
          throw new ValueError(`Out of range float values are not JSON compliant: ${pyFloatRepr(v)}`);
        }
        return Number.isNaN(v) ? "NaN" : v > 0 ? "Infinity" : "-Infinity";
      }
      return Number.isInteger(v) && Math.abs(v) < 1e16 ? String(v) : pyFloatRepr(v);
    }
    if (typeof v === "object") {
      if (seen.has(v)) throw new ValueError("Circular reference detected");
      seen.add(v);
      try {
        if (Array.isArray(v)) return `[${v.map(encode).join(itemSep)}]`;
        const toJson = (v as { toJSON?: () => unknown }).toJSON;
        if (typeof toJson === "function" && !isDict(v)) return encode(toJson.call(v));
        if (isDict(v) || Object.getPrototypeOf(v) !== null) {
          return `{${pyEntries(v as JsonObject)
            .map(([k, item]) => `${dumpString(k, ensureAscii)}${keySep}${encode(item)}`)
            .join(itemSep)}}`;
        }
      } finally {
        seen.delete(v);
      }
    }
    if (options.defaultStr) return dumpString(String(v), ensureAscii);
    throw new TypeError(`Object of type ${typeof v} is not JSON serializable`);
  };
  return encode(value);
}

/** Python `asyncio.CancelledError` stand-in: never turned into a JSON-RPC error. */
export class CancelledError extends Error {
  constructor(message = "cancelled") {
    super(message);
    this.name = "CancelledError";
  }
}

/** `asyncio.Lock`: FIFO, non-reentrant. */
export class AsyncLock {
  private tail: Promise<void> = Promise.resolve();
  private holders = 0;

  /** `lock.locked()`: some caller is inside {@link runExclusive}. */
  get locked(): boolean {
    return this.holders > 0;
  }

  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    this.holders += 1;
    try {
      return await fn();
    } finally {
      this.holders -= 1;
      release();
    }
  }
}
