/**
 * `orjson.dumps(data, option=orjson.OPT_INDENT_2).decode()` (orjson 3.13) for the CLI's `--json` output.
 *
 * The Python CLI prefers `orjson` and falls back to `json.dumps(indent=2, default=str)` only when it is not installed;
 * this port mirrors the orjson branch byte for byte, including its failures:
 *
 *  - `NaN` / `Infinity` / `-Infinity` serialise as `null`;
 *  - floats use the shortest round-trip digits, decimal notation for 1e-5 <= |x| < 1e16 (always with a `.0` or fraction)
 *    and `1e-7` / `1.5e+16` style (no exponent padding, an explicit `+`) otherwise; `-0.0` keeps its sign;
 *  - integers outside `[-2**63, 2**64 - 1]` raise `TypeError("Integer exceeds 64-bit range")`;
 *  - strings escape only `"`, `\`, `\b \f \n \r \t` and the remaining C0 controls as lower-case `\u00xx`; DEL, U+2028 and
 *    all other non-ASCII stay raw; a lone surrogate raises `TypeError("str is not valid UTF-8: surrogates not allowed")`;
 *  - a `Map` with a non-string key raises `TypeError("Dict key must be str")`;
 *  - a `Set` (or any function / symbol) raises `TypeError("Type is not JSON serializable: <type>")`;
 *  - nesting of more than 254 containers raises `TypeError("Recursion limit reached")`.
 *
 * Number convention (JS has one number type): an integral `number` within the safe-integer range is a Python `int`; a
 * non-integral `number` or a {@link PyFloat} is a Python `float`; a `bigint` is an `int`; an integral `number` beyond the
 * safe-integer range has already lost its integer exactness and is rendered as a float. Pass a `bigint` for exact
 * 64-bit integers.
 */

import { PyFloat, pyEntries } from "../utils/_pyformat.js";

const MAX_DEPTH = 254;
const INT_MIN = -(2n ** 63n);
const INT_MAX = 2n ** 64n - 1n;

const _ESCAPES: Record<string, string> = {
  '"': '\\"',
  "\\": "\\\\",
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
};

/** orjson's float text (`NaN` and the infinities are handled by the caller: they become `null`). */
export function orjsonFloat(x: number): string {
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(x.toExponential());
  if (!m) return String(x);
  const sign = m[1] ?? "";
  const digits = (m[2] ?? "") + (m[3] ?? "");
  const e = Number(m[4]);
  if (e >= -5 && e < 16) {
    if (e >= 0) {
      if (digits.length > e + 1) return `${sign}${digits.slice(0, e + 1)}.${digits.slice(e + 1)}`;
      return `${sign}${digits.padEnd(e + 1, "0")}.0`;
    }
    return `${sign}0.${"0".repeat(-e - 1)}${digits}`;
  }
  const mantissa = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
  return `${sign}${mantissa}e${e < 0 ? "-" : "+"}${Math.abs(e)}`;
}

function orjsonString(s: string): string {
  let out = '"';
  let start = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdfff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (c <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        i += 1;
        continue;
      }
      throw new TypeError("str is not valid UTF-8: surrogates not allowed");
    }
    if (c >= 0x20 && c !== 0x22 && c !== 0x5c) continue;
    out += s.slice(start, i);
    const ch = s[i] as string;
    out += _ESCAPES[ch] ?? `\\u${c.toString(16).padStart(4, "0")}`;
    start = i + 1;
  }
  return `${out}${s.slice(start)}"`;
}

function typeName(v: unknown): string {
  if (typeof v === "function") return "function";
  if (typeof v === "symbol") return "symbol";
  if (v instanceof Set) return "set";
  if (typeof v === "object" && v !== null && v.constructor && v.constructor.name) return v.constructor.name;
  return typeof v;
}

function intText(v: bigint): string {
  if (v < INT_MIN || v > INT_MAX) throw new TypeError("Integer exceeds 64-bit range");
  return v.toString();
}

export interface OrjsonOptions {
  /** `OPT_INDENT_2` (default `true`); `false` gives the compact form of a bare `orjson.dumps(data)`. */
  indent?: boolean;
}

/** `orjson.dumps(value, option=OPT_INDENT_2).decode()`. */
export function orjsonDumps(value: unknown, opts: OrjsonOptions = {}): string {
  const indent = opts.indent ?? true;
  const keySep = indent ? ": " : ":";

  const render = (v: unknown, depth: number): string => {
    if (v === null || v === undefined) return "null";
    switch (typeof v) {
      case "boolean":
        return v ? "true" : "false";
      case "string":
        return orjsonString(v);
      case "bigint":
        return intText(v);
      case "number":
        if (!Number.isFinite(v)) return "null";
        if (Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER) return String(v);
        return orjsonFloat(v);
      case "object":
        break;
      default:
        throw new TypeError(`Type is not JSON serializable: ${typeName(v)}`);
    }
    if (v instanceof PyFloat) return Number.isFinite(v.value) ? orjsonFloat(v.value) : "null";
    if (v instanceof Set) throw new TypeError("Type is not JSON serializable: set");

    const custom = (v as { toJSON?: () => unknown }).toJSON;
    if (!(v instanceof Map) && !Array.isArray(v) && typeof custom === "function") return render(custom.call(v), depth);

    if (depth + 1 > MAX_DEPTH) throw new TypeError("Recursion limit reached");
    const nl = indent ? `\n${"  ".repeat(depth + 1)}` : "";
    const nlEnd = indent ? `\n${"  ".repeat(depth)}` : "";
    if (Array.isArray(v)) {
      if (!v.length) return "[]";
      const parts: string[] = [];
      for (const x of v) parts.push(render(x, depth + 1));
      return `[${nl}${parts.join(`,${nl}`)}${nlEnd}]`;
    }
    const entries: Array<[unknown, unknown]> = v instanceof Map ? [...v] : pyEntries(v as object);
    if (!entries.length) return "{}";
    const parts: string[] = [];
    for (const [k, x] of entries) {
      if (typeof k !== "string") throw new TypeError("Dict key must be str");
      parts.push(`${orjsonString(k)}${keySep}${render(x, depth + 1)}`);
    }
    return `{${nl}${parts.join(`,${nl}`)}${nlEnd}}`;
  };
  return render(value, 0);
}
