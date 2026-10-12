/**
 * Minimal re-implementation of the pydantic v2 (lax mode) semantics used by the Python models.
 *
 * Not a mirror of a Python module. It exists so that `models/*.ts` can keep the Python behaviour exactly:
 *  - field defaults / default factories (defaults are NOT validated, like pydantic),
 *  - aliases + `populate_by_name`, `extra="ignore"`,
 *  - lax coercions (`"5"` -> 5, `"yes"` -> true, `1735689600` -> datetime, enum values, ...),
 *  - `ge` / `le` constraints, field validators (before/after),
 *  - `ValidationError` with pydantic's `errors()` structure and `str(exc)` text (version line `2.14`).
 *
 * API (Python name -> TS name): `Model(**kw)` -> `new Model(kw)`; `model_validate` -> `Model.modelValidate`;
 * `model_validate_json` -> `Model.modelValidateJson`; `model_dump` -> `modelDump`; `model_dump_json` ->
 * `modelDumpJson`; `ValidationError.errors()` -> `.errors()`.
 *
 * Number caveat: JS has one number type. A field declared `float` accepts ints (as pydantic does); when dumping to
 * JSON the float-typed fields are rendered with Python's float repr (`0.0`, `1.5`).
 */

import { PyFloat, pyEntries, pyFloatRepr, pyRepr, pyStrRepr, pySorted, setPyOrder } from "../utils/_pyformat.js";

export const PYDANTIC_DOCS_VERSION = "2.14";

export type LocItem = string | number;
export type Loc = LocItem[];

export interface ErrorDetails {
  type: string;
  loc: Loc;
  msg: string;
  input: unknown;
  ctx?: Record<string, unknown>;
}

/** Python `ValueError` raised inside validators. */
export class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueError";
  }
  __str__(): string {
    return this.message;
  }
}

export function pyTypeName(v: unknown): string {
  if (v === null || v === undefined) return "NoneType";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return Number.isInteger(v) && Math.abs(v) < 2 ** 63 ? "int" : "float";
  if (typeof v === "bigint") return "int";
  if (typeof v === "string") return "str";
  if (Array.isArray(v)) return "list";
  if (v instanceof PyDatetime) return "datetime";
  if (v instanceof Set) return "set";
  if (v instanceof PyFloat) return "float";
  if (v instanceof Uint8Array) return "bytes";
  const pytype = (v as { __pytype__?: unknown }).__pytype__;
  if (typeof pytype === "string") return pytype;
  if (v instanceof BaseModel) return v.constructor.name;
  if (v instanceof Date) return "datetime";
  if (typeof v === "object") return "dict";
  return typeof v;
}

/** pydantic-core `truncate_safe_repr`: byte-based `floor_char_boundary(25)` / `ceil_char_boundary(len - 24)`. */
function truncateRepr(s: string): string {
  const chars = [...s];
  const widths = chars.map((c) => {
    const cp = c.codePointAt(0) as number;
    return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  });
  const total = widths.reduce((a, b) => a + b, 0);
  if (total <= 50) return s;
  let acc = 0;
  let startIdx = 0;
  while (startIdx < chars.length && acc + widths[startIdx] <= 25) acc += widths[startIdx++];
  const endTarget = total - 24;
  let endAcc = 0;
  let endIdx = 0;
  while (endIdx < chars.length && endAcc < endTarget) endAcc += widths[endIdx++];
  return `${chars.slice(0, startIdx).join("")}...${chars.slice(endIdx).join("")}`;
}

/** pydantic_core.ValidationError. `message` equals Python's `str(exc)`. */
export class ValidationError extends Error {
  readonly title: string;
  private readonly _errors: ErrorDetails[];

  constructor(title: string, errors: ErrorDetails[]) {
    super(ValidationError.render(title, errors));
    this.name = "ValidationError";
    this.title = title;
    this._errors = errors;
  }

  static render(title: string, errors: ErrorDetails[]): string {
    const n = errors.length;
    const lines = [`${n} validation error${n === 1 ? "" : "s"} for ${title}`];
    for (const e of errors) {
      if (e.loc.length) lines.push(e.loc.map(String).join("."));
      lines.push(
        `  ${e.msg} [type=${e.type}, input_value=${truncateRepr(pyRepr(e.input))}, input_type=${pyTypeName(e.input)}]`,
      );
      lines.push(`    For further information visit https://errors.pydantic.dev/${PYDANTIC_DOCS_VERSION}/v/${e.type}`);
    }
    return lines.join("\n");
  }

  errors(): ErrorDetails[] {
    return this._errors.map((e) => ({ ...e, loc: [...e.loc] }));
  }

  errorCount(): number {
    return this._errors.length;
  }

  __str__(): string {
    return this.message;
  }
}

// ---------------------------------------------------------------------------
// datetime
// ---------------------------------------------------------------------------

/** Python `datetime` (naive or tz-aware) with microsecond precision. */
export class PyDatetime {
  /** Wall-clock milliseconds since epoch (UTC for aware values; "as if UTC" for naive values). */
  readonly wallMs: number;
  /** 0..999 extra microseconds below the millisecond. */
  readonly microOfMs: number;
  /** UTC offset in seconds, or `null` for a naive datetime. */
  readonly offsetSeconds: number | null;

  constructor(wallMs: number, microOfMs = 0, offsetSeconds: number | null = null) {
    this.wallMs = wallMs;
    this.microOfMs = microOfMs;
    this.offsetSeconds = offsetSeconds;
  }

  get microsecond(): number {
    return (((this.wallMs % 1000) + 1000) % 1000) * 1000 + this.microOfMs;
  }

  /** The absolute instant in epoch ms (naive values are interpreted as UTC). */
  valueOf(): number {
    return this.wallMs - (this.offsetSeconds ?? 0) * 1000;
  }

  toDate(): Date {
    return new Date(this.valueOf());
  }

  /** Seconds since epoch (float), like `datetime.timestamp()` (naive treated as UTC). */
  timestamp(): number {
    return this.valueOf() / 1000 + this.microOfMs / 1e6;
  }

  /** Python `datetime.isoformat()` style (`+00:00` for UTC). */
  isoformat(opts: { utcZ?: boolean } = {}): string {
    const d = new Date(this.wallMs);
    const p = (n: number, w = 2) => String(n).padStart(w, "0");
    let s = `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
    const micro = this.microsecond;
    if (micro) s += `.${p(micro, 6)}`;
    if (this.offsetSeconds !== null) {
      if (this.offsetSeconds === 0 && opts.utcZ) s += "Z";
      else {
        const off = Math.abs(this.offsetSeconds);
        s += `${this.offsetSeconds < 0 ? "-" : "+"}${p(Math.floor(off / 3600))}:${p(Math.floor((off % 3600) / 60))}`;
        if (off % 60) s += `:${p(off % 60)}`;
      }
    }
    return s;
  }

  /** pydantic's JSON form (`Z` for UTC). */
  toJSON(): string {
    return this.isoformat({ utcZ: true });
  }

  toString(): string {
    return this.isoformat().replace("T", " ");
  }

  __repr__(): string {
    return `datetime(${this.isoformat()})`;
  }

  static fromDate(d: Date): PyDatetime {
    return new PyDatetime(d.getTime(), 0, 0);
  }
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

type DtParse = { ok: true; value: PyDatetime } | { ok: false; error: string; type?: string };

function numberToDatetime(n: number): DtParse {
  // pydantic: |n| > 2e10 means milliseconds, otherwise seconds.
  const isMs = Math.abs(n) > 20_000_000_000;
  const seconds = isMs ? n / 1000 : n;
  if (seconds > 253402300799 || seconds < -62135596800) {
    return { ok: false, error: "dates after 9999 are not supported as unix timestamps", type: "datetime_parsing" };
  }
  const wholeMs = Math.floor(seconds * 1000 + (isMs ? 0 : 0));
  const micros = Math.round((seconds * 1000 - wholeMs) * 1000);
  return { ok: true, value: new PyDatetime(wholeMs, micros, 0) };
}

const EXTRA_CHARS = "unexpected extra characters at the end of the input";

/** speedate `Date::parse_bytes_partial` error for the first ten bytes, or `null` when they form a valid date. */
function dateError(s: string): string | null {
  if (s.length < 10) return "input is too short";
  if (!/^\d{4}/.test(s)) return "invalid character in year";
  if (s[4] !== "-") return "invalid date separator, expected `-`";
  if (!/^\d{2}/.test(s.slice(5, 7))) return "invalid character in month";
  if (s[7] !== "-") return "invalid date separator, expected `-`";
  if (!/^\d{2}/.test(s.slice(8, 10))) return "invalid character in day";
  const y = Number(s.slice(0, 4));
  const mo = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  if (mo < 1 || mo > 12) return "month value is outside expected range of 1-12";
  if (d < 1 || d > daysInMonth(y, mo)) return "day value is outside expected range";
  return null;
}

/** speedate RFC 3339 style datetime grammar (whole string must match). */
function parseStrictDatetime(s: string): PyDatetime | null {
  if (dateError(s) !== null) return null;
  const y = Number(s.slice(0, 4));
  const mo = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  let hh = 0;
  let mi = 0;
  let ss = 0;
  let micro = 0;
  let offset: number | null = null;
  if (s.length > 10) {
    if (!/^[Tt _]/.test(s.slice(10, 11))) return null;
    const m = /^(\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?/.exec(s.slice(11));
    if (!m) return null;
    hh = Number(m[1]);
    mi = Number(m[2]);
    ss = m[3] !== undefined ? Number(m[3]) : 0;
    if (hh > 23 || mi > 59 || ss > 59) return null;
    if (m[4] !== undefined) micro = Number(m[4].slice(0, 6).padEnd(6, "0"));
    const rest = s.slice(11 + m[0].length);
    if (rest.length) {
      if (rest === "Z" || rest === "z") offset = 0;
      else {
        const tz = /^([+\-\u2212])(\d{2})(?::?(\d{2}))$/.exec(rest);
        if (!tz) return null;
        const oh = Number(tz[2]);
        const om = Number(tz[3]);
        if (oh > 23 || om > 59) return null;
        offset = (tz[1] === "+" ? 1 : -1) * (oh * 3600 + om * 60);
      }
    }
  }
  const wall = Date.UTC(y, mo - 1, d, hh, mi, ss, Math.floor(micro / 1000));
  const dt = new Date(wall);
  if (y < 100) dt.setUTCFullYear(y, mo - 1, d);
  return new PyDatetime(y < 100 ? dt.getTime() : wall, micro % 1000, offset);
}

/** Parse the string forms pydantic (speedate) accepts: ISO 8601 date / datetime or a numeric unix timestamp. */
export function parseDatetimeString(raw: string): DtParse {
  const s = raw;
  const strict = parseStrictDatetime(s);
  if (strict) {
    if (Number(s.slice(0, 4)) === 0) return { ok: false, error: "year 0 is out of range", type: "datetime_parsing" };
    return { ok: true, value: strict };
  }
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(s)) return numberToDatetime(Number(s));
  const e = dateError(s);
  return { ok: false, error: e ?? EXTRA_CHARS };
}

// ---------------------------------------------------------------------------
// validators
// ---------------------------------------------------------------------------

const INVALID: unique symbol = Symbol("invalid");
export type Invalid = typeof INVALID;
export { INVALID };

export interface Ctx {
  json: boolean;
}

export interface Validator {
  kind: string;
  /** Wrapped validator for `nullable`. */
  inner?: Validator;
  validate(v: unknown, loc: Loc, errs: ErrorDetails[], ctx: Ctx): unknown;
  /** Serialise a validated value (pydantic `model_dump`). */
  dump(v: unknown, mode: "python" | "json", opts: DumpOptions): unknown;
}

export interface DumpOptions {
  by_alias?: boolean;
  exclude_none?: boolean;
}

function err(errs: ErrorDetails[], loc: Loc, type: string, msg: string, input: unknown, ctx?: Record<string, unknown>): typeof INVALID {
  const e: ErrorDetails = { type, loc: [...loc], msg, input };
  if (ctx) e.ctx = ctx;
  errs.push(e);
  return INVALID;
}

function plainDump(v: unknown, mode: "python" | "json", opts: DumpOptions): unknown {
  if (v instanceof BaseModel) return v.modelDump({ ...opts, mode });
  if (v instanceof PyDatetime) return mode === "json" ? v.toJSON() : v;
  if (Array.isArray(v)) return v.map((x) => plainDump(x, mode, opts));
  if (v instanceof Set) return [...v].map((x) => plainDump(x, mode, opts));
  if (v !== null && typeof v === "object" && !(v instanceof PyFloat)) {
    const o: Record<string, unknown> = {};
    const items = pyEntries(v as Record<string, unknown>);
    for (const [k, x] of items) o[k] = plainDump(x, mode, opts);
    return setPyOrder(o, items.map(([k]) => k));
  }
  return v;
}

const anyValidator: Validator = {
  kind: "any",
  validate: (v) => v,
  dump: plainDump,
};
export const any = (): Validator => anyValidator;

export const str = (): Validator => ({
  kind: "str",
  validate(v, loc, errs) {
    if (typeof v === "string") return v;
    if (v instanceof Uint8Array) {
      try {
        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(v);
      } catch {
        /* reported below */
      }
      return err(errs, loc, "string_unicode", "Input should be a valid string, unable to parse raw data as a unicode string", v);
    }
    return err(errs, loc, "string_type", "Input should be a valid string", v);
  },
  dump: (v) => v,
});

interface NumConstraints {
  ge?: number;
  le?: number;
  gt?: number;
  lt?: number;
}

function numToStr(n: number): string {
  return Number.isInteger(n) ? String(n) : pyFloatRepr(n);
}

function checkConstraints(n: number, c: NumConstraints, loc: Loc, errs: ErrorDetails[], input: unknown): unknown {
  if (c.ge !== undefined && !(n >= c.ge)) {
    return err(errs, loc, "greater_than_equal", `Input should be greater than or equal to ${numToStr(c.ge)}`, input, { ge: c.ge });
  }
  if (c.le !== undefined && !(n <= c.le)) {
    return err(errs, loc, "less_than_equal", `Input should be less than or equal to ${numToStr(c.le)}`, input, { le: c.le });
  }
  if (c.gt !== undefined && !(n > c.gt)) {
    return err(errs, loc, "greater_than", `Input should be greater than ${numToStr(c.gt)}`, input, { gt: c.gt });
  }
  if (c.lt !== undefined && !(n < c.lt)) {
    return err(errs, loc, "less_than", `Input should be less than ${numToStr(c.lt)}`, input, { lt: c.lt });
  }
  return n;
}

export const int = (c: NumConstraints = {}): Validator => ({
  kind: "int",
  validate(v, loc, errs) {
    let n: number;
    if (typeof v === "boolean") n = v ? 1 : 0;
    else if (typeof v === "bigint") n = Number(v);
    else if (typeof v === "number" || v instanceof PyFloat) {
      const x = typeof v === "number" ? v : v.value;
      if (!Number.isFinite(x)) {
        return err(errs, loc, "finite_number", "Input should be a finite number", v);
      }
      if (!Number.isInteger(x)) {
        return err(errs, loc, "int_from_float", "Input should be a valid integer, got a number with a fractional part", v);
      }
      if (x >= 2 ** 63 || x < -(2 ** 63)) {
        return err(errs, loc, "int_parsing_size", "Unable to parse input string as an integer, exceeded maximum size", v);
      }
      n = x;
    } else if (typeof v === "string") {
      const t = v.trim();
      if (!/^[+-]?\d+(?:_\d+)*(?:\.0+)?$/.test(t)) {
        return err(errs, loc, "int_parsing", "Input should be a valid integer, unable to parse string as an integer", v);
      }
      n = Number(t.replace(/_/g, ""));
    } else {
      return err(errs, loc, "int_type", "Input should be a valid integer", v);
    }
    return checkConstraints(n, c, loc, errs, v);
  },
  dump: (v) => v,
});

export const float = (c: NumConstraints = {}): Validator => ({
  kind: "float",
  validate(v, loc, errs) {
    let n: number;
    if (typeof v === "boolean") n = v ? 1 : 0;
    else if (typeof v === "number") n = v;
    else if (v instanceof PyFloat) n = v.value;
    else if (typeof v === "string") {
      let t = v.trim();
      if (t.includes("_")) {
        if (t.startsWith("_") || t.endsWith("_") || t.includes("__")) {
          return err(errs, loc, "float_parsing", "Input should be a valid number, unable to parse string as a number", v);
        }
        t = t.replace(/_/g, "");
      }
      if (!/^[+-]?(?:(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|inf(?:inity)?|nan)$/i.test(t)) {
        return err(errs, loc, "float_parsing", "Input should be a valid number, unable to parse string as a number", v);
      }
      const low = t.toLowerCase().replace(/^[+-]/, "");
      if (low.startsWith("inf")) n = t.startsWith("-") ? -Infinity : Infinity;
      else if (low === "nan") n = NaN;
      else n = Number(t);
    } else {
      return err(errs, loc, "float_type", "Input should be a valid number", v);
    }
    return checkConstraints(n, c, loc, errs, v);
  },
  dump: (v) => v,
});

const BOOL_TRUE = new Set(["1", "on", "t", "true", "y", "yes"]);
const BOOL_FALSE = new Set(["0", "off", "f", "false", "n", "no"]);

export const bool = (): Validator => ({
  kind: "bool",
  validate(v, loc, errs) {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") {
      if (v === 0) return false;
      if (v === 1) return true;
      if (!Number.isInteger(v) || Math.abs(v) >= 2 ** 63) return err(errs, loc, "bool_type", "Input should be a valid boolean", v);
      return err(errs, loc, "bool_parsing", "Input should be a valid boolean, unable to interpret input", v);
    }
    if (typeof v === "string") {
      const l = v.toLowerCase();
      if (BOOL_TRUE.has(l)) return true;
      if (BOOL_FALSE.has(l)) return false;
      return err(errs, loc, "bool_parsing", "Input should be a valid boolean, unable to interpret input", v);
    }
    return err(errs, loc, "bool_type", "Input should be a valid boolean", v);
  },
  dump: (v) => v,
});

export const datetime = (): Validator => ({
  kind: "datetime",
  validate(v, loc, errs) {
    if (v instanceof PyDatetime) return v;
    if (v instanceof Date) return PyDatetime.fromDate(v);
    let r: DtParse;
    if (typeof v === "string") {
      r = parseDatetimeString(v);
      if (!r.ok) {
        const type = r.type ?? "datetime_from_date_parsing";
        const prefix = r.type ? "Input should be a valid datetime" : "Input should be a valid datetime or date";
        return err(errs, loc, type, `${prefix}, ${r.error}`, v, { error: r.error });
      }
      return r.value;
    }
    if (typeof v === "number") {
      if (!Number.isFinite(v)) return err(errs, loc, "datetime_parsing", "Input should be a valid datetime, NaN or infinity is not supported", v);
      r = numberToDatetime(v);
      if (!r.ok) return err(errs, loc, r.type ?? "datetime_parsing", `Input should be a valid datetime, ${r.error}`, v, { error: r.error });
      return r.value;
    }
    return err(errs, loc, "datetime_type", "Input should be a valid datetime", v);
  },
  dump: (v, mode) => (mode === "json" && v instanceof PyDatetime ? v.toJSON() : v),
});

/** `X | None`. */
export const optional = (inner: Validator): Validator => ({
  kind: "nullable",
  inner,
  validate(v, loc, errs, ctx) {
    if (v === null || v === undefined) return null;
    return inner.validate(v, loc, errs, ctx);
  },
  dump: (v, mode, opts) => (v === null || v === undefined ? null : inner.dump(v, mode, opts)),
});

export const list = (item: Validator): Validator => ({
  kind: "list",
  validate(v, loc, errs, ctx) {
    let arr: unknown[];
    if (Array.isArray(v)) arr = v;
    else if (v instanceof Set) arr = [...v];
    else return err(errs, loc, "list_type", ctx.json ? "Input should be a valid array" : "Input should be a valid list", v);
    const out: unknown[] = [];
    let bad = false;
    arr.forEach((x, i) => {
      const r = item.validate(x, [...loc, i], errs, ctx);
      if (r === INVALID) bad = true;
      else out.push(r);
    });
    return bad ? INVALID : out;
  },
  dump: (v, mode, opts) => (v as unknown[]).map((x) => item.dump(x, mode, opts)),
});

/** Own data property even for `__proto__` (a plain assignment would hit the prototype setter and drop the key). */
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === "__proto__") Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  else target[key] = value;
}

export const dict = (key: Validator, value: Validator): Validator => ({
  kind: "dict",
  validate(v, loc, errs, ctx) {
    let entries: [unknown, unknown][];
    if (v instanceof Map) entries = [...v];
    else if (v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof BaseModel) && !(v instanceof PyDatetime) && !(v instanceof Set) && !(v instanceof PyFloat)) {
      entries = pyEntries(v);
    } else return err(errs, loc, "dict_type", ctx.json ? "Input should be an object" : "Input should be a valid dictionary", v);
    const out: Record<string, unknown> = {};
    let bad = false;
    for (const [k, x] of entries) {
      const kr = key.validate(k, [...loc, String(k), "[key]"], errs, ctx);
      const vr = value.validate(x, [...loc, String(k)], errs, ctx);
      if (kr === INVALID || vr === INVALID) bad = true;
      else setOwn(out, kr as string, vr);
    }
    return bad ? INVALID : setPyOrder(out, Object.keys(out).length > 1 ? entries.map(([k]) => String(k)).filter((k, i, a) => a.indexOf(k) === i) : []);
  },
  dump: (v, mode, opts) => {
    const o: Record<string, unknown> = {};
    const items = pyEntries(v as Record<string, unknown>);
    for (const [k, x] of items) setOwn(o, k, value.dump(x, mode, opts));
    return setPyOrder(o, items.map(([k]) => k));
  },
});

/** Python `enum.Enum` of string values (`class X(str, Enum)`), given as a `{NAME: value}` object. */
export const enumOf = (values: Record<string, string>): Validator => {
  const allowed = Object.values(values);
  const quoted = allowed.map((a) => pyStrRepr(a));
  const expected = quoted.length === 1 ? (quoted[0] as string) : `${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1]}`;
  return {
    kind: "enum",
    validate(v, loc, errs) {
      if (typeof v === "string" && allowed.includes(v)) return v;
      return err(errs, loc, "enum", `Input should be ${expected}`, v, { expected });
    },
    dump: (v) => v,
  };
};

/** `A | B` (smart mode, members tried in order). Error locs get the member label appended like pydantic. */
export const union = (members: [label: string, v: Validator][]): Validator => ({
  kind: "union",
  validate(v, loc, errs, ctx) {
    const all: ErrorDetails[] = [];
    for (const [label, m] of members) {
      const local: ErrorDetails[] = [];
      const r = m.validate(v, [...loc, label], local, ctx);
      if (r !== INVALID) return r;
      all.push(...local);
    }
    errs.push(...all);
    return INVALID;
  },
  dump: (v, mode, opts) => plainDump(v, mode, opts),
});

/** Nested model field (lazy class reference so definitions can be mutually recursive / ordered freely). */
export const modelOf = <T extends BaseModel>(cls: () => new (d?: ModelInput) => T): Validator => ({
  kind: "model",
  validate(v, loc, errs, ctx) {
    const C = cls();
    if (v instanceof C) return v;
    const out = BaseModel._validateFields(C as unknown as typeof BaseModel, v, loc, errs, ctx);
    if (out === INVALID) return INVALID;
    const inst = Object.create(C.prototype) as T;
    Object.assign(inst, out);
    return inst;
  },
  dump: (v, mode, opts) => (v as BaseModel).modelDump({ ...opts, mode }),
});

/** Custom hook. `before` runs on the raw input; `after` on the validated value (throw `ValueError` to reject). */
export const withValidators = (
  inner: Validator,
  hooks: { before?: (v: unknown) => unknown; after?: (v: unknown) => unknown },
): Validator => ({
  kind: inner.kind,
  validate(v, loc, errs, ctx) {
    let input = v;
    if (hooks.before) {
      try {
        input = hooks.before(v);
      } catch (e) {
        if (e instanceof ValueError) {
          return err(errs, loc, "value_error", `Value error, ${e.message}`, v, { error: e });
        }
        throw e;
      }
    }
    const r = inner.validate(input, loc, errs, ctx);
    if (r === INVALID || !hooks.after) return r;
    try {
      return hooks.after(r);
    } catch (e) {
      if (e instanceof ValueError) {
        return err(errs, loc, "value_error", `Value error, ${e.message}`, r, { error: e });
      }
      throw e;
    }
  },
  dump: inner.dump,
});

// ---------------------------------------------------------------------------
// fields & models
// ---------------------------------------------------------------------------

export interface FieldInfo {
  validator: Validator;
  alias?: string;
  /** Static default (cloned for objects/arrays) — mutually exclusive with `default_factory`. */
  default?: unknown;
  default_factory?: () => unknown;
  /** pydantic `Field(exclude=True)`: never part of `model_dump`. */
  exclude?: boolean;
  required: boolean;
}

export function field(
  validator: Validator,
  opts: { alias?: string; default?: unknown; default_factory?: () => unknown; exclude?: boolean } = {},
): FieldInfo {
  const has = "default" in opts || "default_factory" in opts;
  const f: FieldInfo = { validator, required: !has };
  if (opts.alias !== undefined) f.alias = opts.alias;
  if ("default" in opts) f.default = opts.default;
  if (opts.default_factory) f.default_factory = opts.default_factory;
  if (opts.exclude) f.exclude = true;
  return f;
}

export interface ModelConfig {
  populate_by_name?: boolean;
  extra?: "ignore" | "forbid" | "allow";
}

export type ModelInput = Record<string, unknown>;

export interface ModelDumpOptions extends DumpOptions {
  mode?: "python" | "json";
}

function isMapping(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Set) && !(v instanceof PyDatetime);
}

export abstract class BaseModel {
  static modelFields: Record<string, FieldInfo> = {};
  static modelConfig: ModelConfig = {};

  constructor(data: ModelInput = {}) {
    const ctor = this.constructor as typeof BaseModel;
    const errs: ErrorDetails[] = [];
    const out = BaseModel._validateFields(ctor, data, [], errs, { json: false });
    if (out === INVALID) throw new ValidationError(ctor.name, errs);
    Object.assign(this, out);
  }

  /** @internal */
  static _validateFields(ctor: typeof BaseModel, data: unknown, loc: Loc, errs: ErrorDetails[], ctx: Ctx): Record<string, unknown> | Invalid {
    if (!isMapping(data) || data instanceof BaseModel) {
      if (data instanceof BaseModel && data.constructor === ctor) return { ...(data as object) } as Record<string, unknown>;
      const msg = ctx.json ? "Input should be an object" : `Input should be a valid dictionary or instance of ${ctor.name}`;
      return err(errs, loc, "model_type", msg, data, { class_name: ctor.name });
    }
    const input = data as Record<string, unknown>;
    const cfg = ctor.modelConfig;
    const out: Record<string, unknown> = {};
    let bad = false;
    for (const [name, info] of Object.entries(ctor.modelFields)) {
      let key: string | undefined;
      if (info.alias !== undefined) {
        if (info.alias in input) key = info.alias;
        else if (cfg.populate_by_name && name in input) key = name;
      } else if (name in input) key = name;
      const shown = info.alias ?? name;
      if (key === undefined) {
        if (info.required) {
          err(errs, [...loc, shown], "missing", "Field required", input);
          bad = true;
        } else if (info.default_factory) out[name] = info.default_factory();
        else out[name] = cloneDefault(info.default);
        continue;
      }
      const r = info.validator.validate(input[key], [...loc, key], errs, ctx);
      if (r === INVALID) bad = true;
      else out[name] = r;
    }
    if (cfg.extra === "forbid") {
      const known = new Set<string>();
      for (const [name, info] of Object.entries(ctor.modelFields)) {
        known.add(name);
        if (info.alias) known.add(info.alias);
      }
      for (const k of Object.keys(input)) {
        if (!known.has(k)) {
          err(errs, [...loc, k], "extra_forbidden", "Extra inputs are not permitted", input[k]);
          bad = true;
        }
      }
    } else if (cfg.extra === "allow") {
      const known = new Set<string>();
      for (const [name, info] of Object.entries(ctor.modelFields)) {
        known.add(name);
        if (info.alias) known.add(info.alias);
      }
      for (const [k, v] of Object.entries(input)) if (!known.has(k)) out[k] = v;
    }
    return bad ? INVALID : out;
  }

  static modelValidate<T extends BaseModel>(this: new (d?: ModelInput) => T, data: unknown): T {
    const ctor = this as unknown as typeof BaseModel;
    if (data instanceof (this as unknown as abstract new (...a: never[]) => object)) return data as T;
    const errs: ErrorDetails[] = [];
    const out = BaseModel._validateFields(ctor, data, [], errs, { json: false });
    if (out === INVALID) throw new ValidationError(ctor.name, errs);
    const inst = Object.create((this as unknown as { prototype: object }).prototype) as T;
    Object.assign(inst, out);
    return inst;
  }

  static modelValidateJson<T extends BaseModel>(this: new (d?: ModelInput) => T, raw: string | Uint8Array): T {
    const ctor = this as unknown as typeof BaseModel;
    const text = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
    let data: unknown;
    try {
      data = jiterParse(text);
    } catch (e) {
      if (!(e instanceof JiterError)) throw e;
      throw new ValidationError(ctor.name, [
        { type: "json_invalid", loc: [], msg: `Invalid JSON: ${e.detail}`, input: text, ctx: { error: e.detail } },
      ]);
    }
    const errs: ErrorDetails[] = [];
    const out = BaseModel._validateFields(ctor, data, [], errs, { json: true });
    if (out === INVALID) throw new ValidationError(ctor.name, errs);
    const inst = Object.create((this as unknown as { prototype: object }).prototype) as T;
    Object.assign(inst, out);
    return inst;
  }

  modelDump(opts: ModelDumpOptions = {}): Record<string, unknown> {
    const ctor = this.constructor as typeof BaseModel;
    const mode = opts.mode ?? "python";
    const out: Record<string, unknown> = {};
    for (const [name, info] of Object.entries(ctor.modelFields)) {
      if (info.exclude) continue;
      const value = (this as unknown as Record<string, unknown>)[name];
      if (opts.exclude_none && (value === null || value === undefined)) continue;
      const key = opts.by_alias && info.alias ? info.alias : name;
      out[key] = info.validator.dump(value, mode, opts);
    }
    if (ctor.modelConfig.extra === "allow") {
      for (const [k, v] of Object.entries(this)) if (!(k in ctor.modelFields)) out[k] = plainDump(v, mode, opts);
    }
    return out;
  }

  /** pydantic `model_dump_json` (compact separators, float fields rendered like Python floats). */
  modelDumpJson(opts: DumpOptions & { indent?: number } = {}): string {
    const dumped = this.modelDump({ ...opts, mode: "json" });
    return pyJsonStringify(dumped, this.constructor as typeof BaseModel, !!opts.by_alias, opts.indent);
  }

  toJSON(): Record<string, unknown> {
    return this.modelDump({ mode: "json" });
  }

  __repr__(): string {
    const ctor = this.constructor as typeof BaseModel;
    const parts = Object.keys(ctor.modelFields).map((n) => `${n}=${pyRepr((this as unknown as Record<string, unknown>)[n])}`);
    return `${ctor.name}(${parts.join(", ")})`;
  }
}

function cloneDefault(v: unknown): unknown {
  if (Array.isArray(v)) return [...v];
  if (v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) return { ...(v as object) };
  return v;
}

export class JiterError extends Error {
  constructor(
    readonly detail: string,
    readonly position: number,
  ) {
    super(detail);
  }
}

/**
 * Strict JSON parser reproducing jiter's grammar (NaN / Infinity accepted, 201-level value depth limit) and its
 * error texts (`... at line L column C`, columns counted in UTF-8 bytes).
 */
export function jiterParse(text: string): unknown {
  const buf = Buffer.from(text, "utf8");
  const n = buf.length;
  let i = 0;
  const fail = (what: string, pos: number): never => {
    throw new JiterError(what, pos);
  };
  const eof = (what: string): never => fail(what, n);
  const skipWs = (): void => {
    while (i < n && (buf[i] === 0x20 || buf[i] === 0x09 || buf[i] === 0x0a || buf[i] === 0x0d)) i++;
  };
  const isDigit = (c: number): boolean => c >= 0x30 && c <= 0x39;
  const ident = (word: string, value: unknown): unknown => {
    for (let k = 0; k < word.length; k++) {
      if (i >= n) eof("EOF while parsing a value");
      if (buf[i] !== word.charCodeAt(k)) fail("expected ident", i + 1);
      i++;
    }
    return value;
  };
  const hex4 = (what: string): number => {
    if (n - i < 4) eof(what);
    let v = 0;
    for (let k = 0; k < 4; k++) {
      const c = buf[i++];
      const d = isDigit(c) ? c - 0x30 : c >= 0x61 && c <= 0x66 ? c - 0x57 : c >= 0x41 && c <= 0x46 ? c - 0x37 : -1;
      if (d < 0) fail("invalid escape", i);
      v = v * 16 + d;
    }
    return v;
  };
  const parseString = (): string => {
    i++;
    const parts: string[] = [];
    let start = i;
    for (;;) {
      if (i >= n) eof("EOF while parsing a string");
      const c = buf[i];
      if (c === 0x22) {
        parts.push(buf.toString("utf8", start, i));
        i++;
        return parts.join("");
      }
      if (c < 0x20) fail("control character (\\u0000-\\u001F) found while parsing a string", i + 1);
      if (c !== 0x5c) {
        i++;
        continue;
      }
      parts.push(buf.toString("utf8", start, i));
      i++;
      if (i >= n) eof("EOF while parsing a string");
      const e = buf[i++];
      const simple: Record<number, string> = { 0x22: '"', 0x5c: "\\", 0x2f: "/", 0x62: "\b", 0x66: "\f", 0x6e: "\n", 0x72: "\r", 0x74: "\t" };
      if (e in simple) parts.push(simple[e]);
      else if (e === 0x75) {
        const hi = hex4("EOF while parsing a string");
        if (hi >= 0xdc00 && hi <= 0xdfff) fail("lone leading surrogate in hex escape", i);
        if (hi >= 0xd800 && hi <= 0xdbff) {
          if (i >= n) eof("EOF while parsing a string");
          if (buf[i] !== 0x5c) fail("unexpected end of hex escape", i + 1);
          i++;
          if (i >= n) eof("EOF while parsing a string");
          if (buf[i] !== 0x75) fail("unexpected end of hex escape", i + 1);
          i++;
          const lo = hex4("EOF while parsing a string");
          if (lo < 0xdc00 || lo > 0xdfff) fail("lone leading surrogate in hex escape", i);
          parts.push(String.fromCharCode(hi, lo));
        } else parts.push(String.fromCharCode(hi));
      } else fail("invalid escape", i);
      start = i;
    }
  };
  const parseNumber = (): number => {
    const begin = i;
    if (buf[i] === 0x2d) {
      i++;
      if (i >= n) eof("EOF while parsing a value");
      if (buf[i] === 0x49) {
        ident("Infinity", 0);
        return -Infinity;
      }
    }
    if (i >= n) eof("EOF while parsing a value");
    if (!isDigit(buf[i])) fail("invalid number", i + 1);
    if (buf[i] === 0x30) {
      i++;
      if (i < n && isDigit(buf[i])) fail("invalid number", i + 1);
    } else while (i < n && isDigit(buf[i])) i++;
    if (i < n && buf[i] === 0x2e) {
      i++;
      if (i >= n) eof("EOF while parsing a value");
      if (!isDigit(buf[i])) fail("invalid number", i + 1);
      while (i < n && isDigit(buf[i])) i++;
    }
    if (i < n && (buf[i] === 0x65 || buf[i] === 0x45)) {
      i++;
      if (i < n && (buf[i] === 0x2b || buf[i] === 0x2d)) i++;
      if (i >= n) eof("EOF while parsing a value");
      if (!isDigit(buf[i])) fail("invalid number", i + 1);
      while (i < n && isDigit(buf[i])) i++;
    }
    return Number(buf.toString("ascii", begin, i));
  };
  const parseValue = (depth: number): unknown => {
    skipWs();
    if (i >= n) eof("EOF while parsing a value");
    if (depth > 201) fail("recursion limit exceeded", i + 1);
    const c = buf[i];
    if (c === 0x6e) return ident("null", null);
    if (c === 0x74) return ident("true", true);
    if (c === 0x66) return ident("false", false);
    if (c === 0x4e) return ident("NaN", NaN);
    if (c === 0x49) return ident("Infinity", Infinity);
    if (c === 0x2d || isDigit(c)) return parseNumber();
    if (c === 0x22) return parseString();
    if (c === 0x5b) {
      i++;
      const arr: unknown[] = [];
      skipWs();
      if (i >= n) eof("EOF while parsing a list");
      if (buf[i] === 0x5d) {
        i++;
        return arr;
      }
      for (;;) {
        arr.push(parseValue(depth + 1));
        skipWs();
        if (i >= n) eof("EOF while parsing a list");
        if (buf[i] === 0x2c) {
          i++;
          skipWs();
          if (i < n && buf[i] === 0x5d) fail("trailing comma", i + 1);
          continue;
        }
        if (buf[i] === 0x5d) {
          i++;
          return arr;
        }
        fail("expected `,` or `]`", i + 1);
      }
    }
    if (c === 0x7b) {
      i++;
      const obj: Record<string, unknown> = {};
      skipWs();
      if (i >= n) eof("EOF while parsing an object");
      if (buf[i] === 0x7d) {
        i++;
        return obj;
      }
      for (;;) {
        if (buf[i] !== 0x22) fail("key must be a string", i + 1);
        const key = parseString();
        skipWs();
        if (i >= n) eof("EOF while parsing an object");
        if (buf[i] !== 0x3a) fail("expected `:`", i + 1);
        i++;
        const val = parseValue(depth + 1);
        Object.defineProperty(obj, key, { value: val, enumerable: true, writable: true, configurable: true });
        skipWs();
        if (i >= n) eof("EOF while parsing an object");
        if (buf[i] === 0x2c) {
          i++;
          skipWs();
          if (i >= n) eof("EOF while parsing a value");
          if (buf[i] === 0x7d) fail("trailing comma", i + 1);
          continue;
        }
        if (buf[i] === 0x7d) {
          i++;
          return obj;
        }
        fail("expected `,` or `}`", i + 1);
      }
    }
    return fail("expected value", i + 1);
  };
  try {
    const v = parseValue(1);
    skipWs();
    if (i < n) fail("trailing characters", i + 1);
    return v;
  } catch (e) {
    if (!(e instanceof JiterError)) throw e;
    const prefix = buf.subarray(0, e.position);
    let line = 1;
    let lastNl = -1;
    for (let k = 0; k < prefix.length; k++) {
      if (prefix[k] === 0x0a) {
        line++;
        lastNl = k;
      }
    }
    throw new JiterError(`${e.detail} at line ${line} column ${e.position - (lastNl + 1)}`, e.position);
  }
}

/** JSON.stringify with compact separators, rendering numbers of float-typed fields as `1.0`. */
function pyJsonStringify(value: unknown, model: typeof BaseModel | null, byAlias: boolean, indent?: number): string {
  const floatKeys = new Set<string>();
  if (model) {
    for (const [name, info] of Object.entries(model.modelFields)) {
      if (info.validator.kind === "float" || (info.validator.kind === "nullable" && info.validator.inner?.kind === "float")) floatKeys.add(byAlias && info.alias ? info.alias : name);
    }
  }
  const render = (v: unknown, floatKey: boolean, depth: number): string => {
    if (typeof v === "number") return floatKey && Number.isInteger(v) ? pyFloatRepr(v) : JSON.stringify(v);
    if (v === null || v === undefined) return "null";
    if (typeof v !== "object") return JSON.stringify(v);
    const nl = indent ? `\n${" ".repeat(indent * (depth + 1))}` : "";
    const nlEnd = indent ? `\n${" ".repeat(indent * depth)}` : "";
    const sep = indent ? ": " : ":";
    if (Array.isArray(v)) {
      if (!v.length) return "[]";
      return `[${nl}${v.map((x) => render(x, false, depth + 1)).join(`,${nl}`)}${nlEnd}]`;
    }
    const entries = pyEntries(v as Record<string, unknown>);
    if (!entries.length) return "{}";
    const top = depth === 0;
    return `{${nl}${entries
      .map(([k, x]) => `${JSON.stringify(k)}${sep}${render(x, top && floatKeys.has(k), depth + 1)}`)
      .join(`,${nl}`)}${nlEnd}}`;
  };
  return render(value, false, 0);
}

export { pySorted };
