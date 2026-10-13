/**
 * Python-compatible value formatting helpers (`repr`, `str`, `%`-formatting, float repr).
 *
 * Not a mirror of a Python module: this is the shared seam that lets the ported modules reproduce Python's
 * user-visible text exactly (`{name!r}`, `%s`/`%d` logging arguments, `sorted([...])` lists in error messages, ...).
 *
 * Conventions (JS has a single number type):
 *  - a `number` that is an integer is rendered as a Python `int` (`300`); non-integers as `float` (`0.5`);
 *  - use {@link PyFloat} (or {@link pyFloatRepr}) to force float rendering of an integral value (`30.0`);
 *  - `null`/`undefined` render as `None`, booleans as `True`/`False`, `Array` as list, `Set` as `{..}`,
 *    plain objects / `Map` as dict, `bigint` as int.
 */

/** Wrapper that forces Python `float` rendering for an integral number (e.g. `new PyFloat(30)` -> `30.0`). */
export class PyFloat {
  constructor(public readonly value: number) {}
  valueOf(): number {
    return this.value;
  }
  toString(): string {
    return pyFloatRepr(this.value);
  }
}

/** Hidden insertion-order record of a parsed JSON object whose integer-like keys JS would iterate first. */
export const PY_KEY_ORDER: unique symbol = Symbol.for("abx.pyKeyOrder") as never;

/**
 * `dict.items()` of a plain-object dict in Python (insertion) order. JS objects iterate integer-like keys first;
 * parsers that see such keys record the true order under {@link PY_KEY_ORDER}, which this honours.
 */
export function pyEntries(o: object): Array<[string, unknown]> {
  const order = (o as { [PY_KEY_ORDER]?: string[] })[PY_KEY_ORDER];
  const rec = o as Record<string, unknown>;
  if (order === undefined) return Object.entries(rec);
  const seen = new Set<string>();
  const out: Array<[string, unknown]> = [];
  for (const k of order) {
    if (Object.hasOwn(rec, k)) {
      seen.add(k);
      out.push([k, rec[k]]);
    }
  }
  for (const k of Object.keys(rec)) if (!seen.has(k)) out.push([k, rec[k]]);
  return out;
}

/** Record `keys` (insertion order) on `o` when JS would iterate `o` differently (integer-like keys). */
export function setPyOrder<T extends object>(o: T, keys: string[]): T {
  if (keys.length > 1 && Object.keys(o).some((k, i) => k !== keys[i])) {
    Object.defineProperty(o, PY_KEY_ORDER, { value: keys, enumerable: false, configurable: true, writable: true });
  }
  return o;
}

/** Python truthiness (`bool(x)`) for JSON-like values: `0.0`, `""`, `[]`, `{}`, `None`, `False` are falsy. */
export function pyTruthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "bigint") return value !== 0n;
  if (value instanceof PyFloat) return value.value !== 0;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof Map || value instanceof Set) return value.size > 0;
  if (typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return Object.keys(value).length > 0;
  }
  return true;
}

/** Python `repr(float)`. */
export function pyFloatRepr(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (x === Infinity) return "inf";
  if (x === -Infinity) return "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const exp = x.toExponential(); // shortest round-trip digits, e.g. "1.2345e+2"
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(exp);
  if (!m) return String(x);
  const sign = m[1] ?? "";
  const digits = (m[2] ?? "") + (m[3] ?? "");
  const e = Number(m[4]);
  if (e >= -4 && e < 16) {
    if (e >= 0) {
      const intPart = digits.length > e + 1 ? digits.slice(0, e + 1) : digits.padEnd(e + 1, "0");
      const frac = digits.length > e + 1 ? digits.slice(e + 1) : "0";
      return `${sign}${intPart}.${frac}`;
    }
    return `${sign}0.${"0".repeat(-e - 1)}${digits}`;
  }
  const mant = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
  const es = Math.abs(e).toString().padStart(2, "0");
  return `${sign}${mant}e${e < 0 ? "-" : "+"}${es}`;
}

/** Python `repr(str)` (quote selection and escapes identical to CPython). */
/** `not str.isprintable()` for a single code point (Unicode categories C* and Z* except the ASCII space). */
const NON_PRINTABLE = /^[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]$/u;

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
    else if (cp < 0x20 || cp === 0x7f) out += `\\x${cp.toString(16).padStart(2, "0")}`;
    else if (cp >= 0x80 && cp < 0xa0) out += `\\x${cp.toString(16).padStart(2, "0")}`;
    else if (cp >= 0x80 && NON_PRINTABLE.test(ch)) {
      out += cp < 0x100 ? `\\x${cp.toString(16).padStart(2, "0")}` : cp < 0x10000 ? `\\u${cp.toString(16).padStart(4, "0")}` : `\\U${cp.toString(16).padStart(8, "0")}`;
    } else out += ch;
  }
  return out + quote;
}

/** Python `repr(bytes)`. */
function pyBytesRepr(b: Uint8Array): string {
  const hasSingle = b.includes(0x27);
  const quote = hasSingle && !b.includes(0x22) ? '"' : "'";
  let out = `b${quote}`;
  for (const c of b) {
    const ch = String.fromCharCode(c);
    if (ch === quote || ch === "\\") out += `\\${ch}`;
    else if (c === 0x0a) out += "\\n";
    else if (c === 0x0d) out += "\\r";
    else if (c === 0x09) out += "\\t";
    else if (c < 0x20 || c >= 0x7f) out += `\\x${c.toString(16).padStart(2, "0")}`;
    else out += ch;
  }
  return out + quote;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Python `repr(value)` for JSON-like JS values. */
export function pyRepr(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : pyFloatRepr(v);
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string") return pyStrRepr(v);
  if (v instanceof PyFloat) return pyFloatRepr(v.value);
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(", ")}]`;
  if (v instanceof Set) return v.size ? `{${[...v].map(pyRepr).join(", ")}}` : "set()";
  if (v instanceof Map) return `{${[...v].map(([k, x]) => `${pyRepr(k)}: ${pyRepr(x)}`).join(", ")}}`;
  if (v instanceof Uint8Array) return pyBytesRepr(v);
  if (v instanceof Date) return `datetime(${v.toISOString()})`;
  if (v instanceof Error) return `${v.constructor.name}(${pyStrRepr(v.message)})`;
  if (isPlainObject(v)) {
    return `{${pyEntries(v)
      .map(([k, x]) => `${pyStrRepr(k)}: ${pyRepr(x)}`)
      .join(", ")}}`;
  }
  if (typeof v === "function") return `<function ${(v as { name?: string }).name ?? ""}>`;
  const custom = (v as { __repr__?: () => string }).__repr__;
  if (typeof custom === "function") return custom.call(v);
  return String(v);
}

/** Python `str(value)`. */
export function pyStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Error) {
    const s = (v as { __str__?: () => string }).__str__;
    return typeof s === "function" ? s.call(v) : String(v.message);
  }
  if (v !== null && typeof v === "object" && !Array.isArray(v) && !isPlainObject(v)) {
    const custom = (v as { __str__?: () => string }).__str__;
    if (typeof custom === "function") return custom.call(v);
    if (v instanceof PyFloat || v instanceof Date) return v instanceof Date ? v.toISOString() : pyRepr(v);
    if (v instanceof Set || v instanceof Map) return pyRepr(v);
    return String(v);
  }
  return pyRepr(v);
}

/** Python `ascii(value)` (non-ASCII escaped). */
export function pyAscii(v: unknown): string {
  return pyRepr(v).replace(/[^\x00-\x7f]/gu, (c) => {
    const cp = c.codePointAt(0) as number;
    if (cp <= 0xff) return `\\x${cp.toString(16).padStart(2, "0")}`;
    if (cp <= 0xffff) return `\\u${cp.toString(16).padStart(4, "0")}`;
    return `\\U${cp.toString(16).padStart(8, "0")}`;
  });
}

const SPEC_RE = /%(?:\(([^)]*)\))?([#0\- +]*)(\*|\d+)?(?:\.(\*|\d+))?([hlL]?)([diouxXeEfFgGcrsa%])/g;

function pad(s: string, width: number | undefined, flags: string, numeric: boolean): string {
  if (width === undefined || s.length >= width) return s;
  if (flags.includes("-")) return s.padEnd(width, " ");
  if (numeric && flags.includes("0")) {
    const m = /^([+\- ]?)(.*)$/s.exec(s) as RegExpExecArray;
    return (m[1] ?? "") + (m[2] ?? "").padStart(width - (m[1] ?? "").length, "0");
  }
  return s.padStart(width, " ");
}

function toNumber(v: unknown): number {
  if (v instanceof PyFloat) return v.value;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  throw new TypeError(`must be real number, not ${v === null || v === undefined ? "NoneType" : typeof v}`);
}

function formatFloatSpec(n: number, type: string, precision: number | undefined, flags: string): string {
  let s: string;
  const p = precision ?? 6;
  if (!Number.isFinite(n)) s = Number.isNaN(n) ? "nan" : n < 0 ? "-inf" : "inf";
  else if (type === "f" || type === "F") s = n.toFixed(p);
  else if (type === "e" || type === "E") {
    s = n.toExponential(p).replace(/e([+-])(\d)$/, "e$10$2");
  } else {
    const prec = p === 0 ? 1 : p;
    const exp = n === 0 ? 0 : Math.floor(Math.log10(Math.abs(n)));
    if (exp < -4 || exp >= prec) {
      s = n.toExponential(prec - 1).replace(/e([+-])(\d)$/, "e$10$2");
      if (!flags.includes("#")) s = s.replace(/\.?0+e/, "e");
    } else {
      s = n.toFixed(Math.max(0, prec - 1 - exp));
      if (!flags.includes("#") && s.includes(".")) s = s.replace(/\.?0+$/, "");
    }
  }
  if (type === "E" || type === "G" || type === "F") s = s.toUpperCase();
  if (flags.includes("+") && !s.startsWith("-")) s = `+${s}`;
  else if (flags.includes(" ") && !s.startsWith("-")) s = ` ${s}`;
  return s;
}

/**
 * Python `fmt % args` (printf style). `args` is the positional tuple, or a single mapping for `%(name)s` keys.
 * Throws `TypeError` like Python on arity / type mismatch.
 */
export function pyFormat(fmt: string, args: unknown[] | Record<string, unknown> = []): string {
  const mapping = !Array.isArray(args) ? args : undefined;
  const list = Array.isArray(args) ? args : [];
  let idx = 0;
  let mappingConsumed = false;
  const out = fmt.replace(SPEC_RE, (_m, key: string | undefined, flags: string, widthRaw: string | undefined, precRaw: string | undefined, _len: string, type: string) => {
    if (type === "%") return "%";
    let width: number | undefined;
    let precision: number | undefined;
    if (widthRaw === "*") width = toNumber(list[idx++]);
    else if (widthRaw !== undefined) width = Number(widthRaw);
    if (precRaw === "*") precision = toNumber(list[idx++]);
    else if (precRaw !== undefined) precision = Number(precRaw);
    let value: unknown;
    if (key !== undefined) {
      if (!mapping && !(list.length === 1 && isPlainObject(list[0]))) throw new TypeError("format requires a mapping");
      const src = (mapping ?? list[0]) as Record<string, unknown>;
      if (!(key in src)) throw new Error(`KeyError: '${key}'`);
      value = src[key];
    } else if (mapping) {
      // `"%s" % {...}`: a non-tuple mapping operand is also the single positional argument.
      if (mappingConsumed) throw new TypeError("not enough arguments for format string");
      mappingConsumed = true;
      value = mapping;
    } else {
      if (idx >= list.length) throw new TypeError("not enough arguments for format string");
      value = list[idx++];
    }
    let s: string;
    switch (type) {
      case "s":
        s = pyStr(value);
        if (precision !== undefined) s = s.slice(0, precision);
        return pad(s, width, flags, false);
      case "r":
        s = pyRepr(value);
        if (precision !== undefined) s = s.slice(0, precision);
        return pad(s, width, flags, false);
      case "a":
        s = pyAscii(value);
        if (precision !== undefined) s = s.slice(0, precision);
        return pad(s, width, flags, false);
      case "c":
        s = typeof value === "string" ? value : String.fromCodePoint(toNumber(value));
        return pad(s, width, flags, false);
      case "d":
      case "i":
      case "u": {
        const n = Math.trunc(toNumber(value));
        s = String(n);
        if (flags.includes("+") && n >= 0) s = `+${s}`;
        else if (flags.includes(" ") && n >= 0) s = ` ${s}`;
        return pad(s, width, flags, true);
      }
      case "x":
      case "X":
      case "o": {
        const n = Math.trunc(toNumber(value));
        const base = type === "o" ? 8 : 16;
        s = Math.abs(n).toString(base);
        if (type === "X") s = s.toUpperCase();
        if (flags.includes("#")) s = (type === "o" ? "0o" : type === "x" ? "0x" : "0X") + s;
        if (n < 0) s = `-${s}`;
        return pad(s, width, flags, true);
      }
      default:
        s = formatFloatSpec(toNumber(value), type, precision, flags);
        return pad(s, width, flags, true);
    }
  });
  if (!mapping && idx < list.length && !(list.length === 1 && isPlainObject(list[0]))) {
    throw new TypeError("not all arguments converted during string formatting");
  }
  return out;
}

/** Python `", ".join(...)`-friendly `sorted()` for strings (code-point order, like CPython). */
export function pySorted(values: Iterable<string>): string[] {
  return [...values].sort((a, b) => {
    const ia = [...a];
    const ib = [...b];
    const n = Math.min(ia.length, ib.length);
    for (let i = 0; i < n; i++) {
      const ca = (ia[i] as string).codePointAt(0) as number;
      const cb = (ib[i] as string).codePointAt(0) as number;
      if (ca !== cb) return ca - cb;
    }
    return ia.length - ib.length;
  });
}

// ---------------------------------------------------------------------------
// str helpers with CPython semantics
// ---------------------------------------------------------------------------

const PY_WS = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const PY_STRIP_RE = new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, "g");
const PY_LSTRIP_RE = new RegExp(`^[${PY_WS}]+`);
const PY_RSTRIP_RE = new RegExp(`[${PY_WS}]+$`);

/** Python `str.strip()` (no argument): strips Unicode whitespace as defined by `str.isspace`. */
export function pyStrip(s: string): string {
  return s.replace(PY_STRIP_RE, "");
}
export function pyLstrip(s: string): string {
  return s.replace(PY_LSTRIP_RE, "");
}
export function pyRstrip(s: string): string {
  return s.replace(PY_RSTRIP_RE, "");
}

/** Python `str.splitlines()` (without keepends). */
export function pySplitlines(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    if (c === "\r") {
      out.push(cur);
      cur = "";
      if (s[i + 1] === "\n") i++;
    } else if ("\n\v\f\x1c\x1d\x1e\x85\u2028\u2029".includes(c)) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur !== "") out.push(cur);
  return out;
}

// ---------------------------------------------------------------------------
// json.dumps
// ---------------------------------------------------------------------------

export interface PyJsonOptions {
  indent?: number | null;
  /** Default `true` (Python's default): escape every non-ASCII character as `\\uXXXX`. */
  ensure_ascii?: boolean;
  sort_keys?: boolean;
  /** Custom `default=` hook for unserialisable objects. */
  default?: (o: unknown) => unknown;
  /** Python `separators=(item_sep, key_sep)`. */
  separators?: [string, string];
  /** orjson float rendering (`1e-7`, `1e+16`) and `null` for NaN / infinity instead of `NaN` / `Infinity`. */
  orjson?: boolean;
}

/** orjson (ryu) float formatting: fixed notation for 1e-5 <= |x| < 1e16, otherwise `d.ddde[+-]N` without padding. */
export function orjsonFloatRepr(x: number): string {
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(x.toExponential());
  if (!m) return String(x);
  const sign = m[1] ?? "";
  const digits = (m[2] ?? "") + (m[3] ?? "");
  const e = Number(m[4]);
  if (e >= -5 && e < 16) return pyFloatRepr(x).includes("e") ? fixedFromDigits(sign, digits, e) : pyFloatRepr(x);
  const mant = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
  return `${sign}${mant}e${e < 0 ? "-" : "+"}${Math.abs(e)}`;
}

function fixedFromDigits(sign: string, digits: string, e: number): string {
  if (e >= 0) {
    const intPart = digits.length > e + 1 ? digits.slice(0, e + 1) : digits.padEnd(e + 1, "0");
    const frac = digits.length > e + 1 ? digits.slice(e + 1) : "0";
    return `${sign}${intPart}.${frac}`;
  }
  return `${sign}0.${"0".repeat(-e - 1)}${digits}`;
}

function jsonString(s: string, ensureAscii: boolean): string {
  let out = JSON.stringify(s);
  // JSON.stringify leaves DEL and lone-surrogate-free non-ASCII untouched.
  if (ensureAscii) {
    out = out.replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  }
  return out;
}

/**
 * Python `json.dumps(value, ...)`: default separators `", "`/`": "` (or `","`/`": "` with indent), `ensure_ascii=True`,
 * floats rendered with Python's float repr (`1.0`) when wrapped in {@link PyFloat}.
 */
export function pyJsonDumps(value: unknown, opts: PyJsonOptions = {}): string {
  const ensureAscii = opts.ensure_ascii ?? true;
  const indent = opts.indent ?? null;
  const itemSep = opts.separators ? opts.separators[0] : indent === null ? ", " : ",";
  const keySep = opts.separators ? opts.separators[1] : ": ";
  const render = (v: unknown, depth: number): string => {
    if (v === null || v === undefined) return "null";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (v instanceof PyFloat) {
      if (opts.orjson) return Number.isFinite(v.value) ? orjsonFloatRepr(v.value) : "null";
      if (Number.isNaN(v.value)) return "NaN";
      if (!Number.isFinite(v.value)) return v.value > 0 ? "Infinity" : "-Infinity";
      return pyFloatRepr(v.value);
    }
    if (typeof v === "number") {
      if (opts.orjson && !Number.isFinite(v)) return "null";
      if (Number.isNaN(v)) return "NaN";
      if (!Number.isFinite(v)) return v > 0 ? "Infinity" : "-Infinity";
      if (opts.orjson && !Number.isInteger(v)) return orjsonFloatRepr(v);
      return Number.isInteger(v) ? String(v) : pyFloatRepr(v);
    }
    if (typeof v === "bigint") {
      if (opts.orjson && (v < -(2n ** 63n) || v > 2n ** 64n - 1n)) throw new TypeError("Integer exceeds 64-bit range");
      return v.toString();
    }
    if (typeof v === "string") return jsonString(v, ensureAscii);
    const nl = indent === null ? "" : `\n${" ".repeat(indent * (depth + 1))}`;
    const nlEnd = indent === null ? "" : `\n${" ".repeat(indent * depth)}`;
    if (Array.isArray(v) || v instanceof Set) {
      const arr = [...v];
      if (!arr.length) return "[]";
      return `[${nl}${arr.map((x) => render(x, depth + 1)).join(itemSep + nl)}${nlEnd}]`;
    }
    if (v instanceof Map || (typeof v === "object" && v !== null)) {
      const custom = (v as { toJSON?: () => unknown }).toJSON;
      if (!(v instanceof Map) && typeof custom === "function") return render(custom.call(v), depth);
      let entries: [string, unknown][] = v instanceof Map ? [...v].map(([k, x]) => [String(k), x]) : pyEntries(v as object);
      if (opts.sort_keys) entries = entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      if (!entries.length) return "{}";
      return `{${nl}${entries.map(([k, x]) => `${jsonString(k, ensureAscii)}${keySep}${render(x, depth + 1)}`).join(itemSep + nl)}${nlEnd}}`;
    }
    if (opts.default) return render(opts.default(v), depth);
    throw new TypeError(`Object of type ${typeof v} is not JSON serializable`);
  };
  return render(value, 0);
}

/** Python `s[:n]` (by code point). */
export function pyTruncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return Array.from(s).slice(0, n).join("");
}

/** Python `s.strip(chars)` / `lstrip(chars)` / `rstrip(chars)` with an explicit character set. */
export function pyStripChars(s: string, chars: string, side: "both" | "left" | "right" = "both"): string {
  const set = new Set(Array.from(chars));
  const cps = Array.from(s);
  let a = 0;
  let b = cps.length;
  if (side !== "right") while (a < b && set.has(cps[a] as string)) a++;
  if (side !== "left") while (b > a && set.has(cps[b - 1] as string)) b--;
  return cps.slice(a, b).join("");
}

const PY_FLOAT_RE =
  /^(?:[+-]?(?:(?:\d+(?:_\d+)*)(?:\.(?:\d+(?:_\d+)*)?)?|\.\d+(?:_\d+)*)(?:[eE][+-]?\d+(?:_\d+)*)?|[+-]?(?:inf|infinity|nan))$/i;

/** Python `float(text)` for a string; `null` where Python raises `ValueError`.  Surrounding whitespace is allowed. */
export function pyFloatParse(text: string): number | null {
  const t = pyStrip(text);
  if (!PY_FLOAT_RE.test(t)) return null;
  const low = t.toLowerCase().replace(/^[+-]/, "");
  if (low === "nan") return NaN;
  if (low === "inf" || low === "infinity") return t.startsWith("-") ? -Infinity : Infinity;
  return Number(t.replace(/_/g, ""));
}
