/**
 * Port of `click/types.py` (Click 8.5): parameter types and their exact error messages.
 *
 * Available: `STRING`, `INT`, `FLOAT`, `BOOL`, `UUID`, `UNPROCESSED`, `Choice`, `IntRange`, `FloatRange`, `Path`,
 * `Tuple`, `FuncParamType` and `convertType`. (`click.File` and `click.DateTime` are not ported, see
 * `parity/KNOWN-GAPS.md`.)
 *
 * Wherever Click takes `type=<python type>` the TypeScript API takes one of: a `ParamType` instance, the constants
 * above, the JS constructors `String` / `Boolean` / `Number` (`Number` means float; use `INT` for integers), a plain
 * function (becomes a `FuncParamType`; throw `ValueError` to reject) or an array of those (a `Tuple` type).
 */

import * as fs from "node:fs";
import * as nodePath from "node:path";
import type { Context, Parameter } from "./core.js";
import { BadParameter } from "./exceptions.js";
import {
  PyFloat,
  isDict,
  parseFloatStrict,
  parseIntStrict,
  pyFloatRepr,
  pyRepr,
  pyStr,
  pyStrRepr,
  splitWhitespace,
  title,
  casefold,
} from "./py.js";
import { formatFilename } from "./utils.js";

/** Python `ValueError`: thrown by `FuncParamType` callables to reject a value with a message. */
export class ValueError extends Error {
  constructor(message = "") {
    super(message);
    this.name = "ValueError";
  }
}

export interface ParamTypeInfoDict {
  param_type: string;
  name: string;
  [key: string]: unknown;
}

/** `click.ParamType`. */
export abstract class ParamType {
  is_composite = false;
  arity = 1;
  abstract name: string;
  envvar_list_splitter: string | null = null;

  toInfoDict(): ParamTypeInfoDict {
    let paramType = this.constructor.name.split("ParamType")[0] as string;
    paramType = paramType.split("ParameterType")[0] as string;
    const name = this.name ?? paramType;
    return { param_type: paramType, name };
  }

  /** `ParamType.__call__`. */
  call(value: unknown, param: Parameter | null = null, ctx: Context | null = null): unknown {
    if (value !== null && value !== undefined) return this.convert(value, param, ctx);
    return null;
  }

  getMetavar(_param: Parameter, _ctx: Context | null): string | null {
    return null;
  }

  getMissingMessage(_param: Parameter, _ctx: Context | null): string | null {
    return null;
  }

  convert(value: unknown, _param: Parameter | null, _ctx: Context | null): unknown {
    return value;
  }

  splitEnvvarValue(rv: string): string[] {
    const s = rv || "";
    if (this.envvar_list_splitter === null) return splitWhitespace(s);
    return s.split(this.envvar_list_splitter);
  }

  fail(message: string, param: Parameter | null = null, ctx: Context | null = null): never {
    throw new BadParameter(message, ctx, param);
  }
}

/** `click.types.FuncParamType`. */
export class FuncParamType extends ParamType {
  name: string;
  readonly func: (value: any) => unknown;

  constructor(func: (value: any) => unknown, name?: string) {
    super();
    this.name = name ?? (func.name || "<lambda>");
    this.func = func;
  }

  override toInfoDict(): ParamTypeInfoDict {
    return { func: this.func, ...super.toInfoDict() };
  }

  override convert(value: unknown, param: Parameter | null, ctx: Context | null): unknown {
    try {
      return this.func(value);
    } catch (exc) {
      if (exc instanceof ValueError) {
        let message = exc.message;
        if (!message) message = pyStr(value);
        return this.fail(message, param, ctx);
      }
      throw exc;
    }
  }
}

/** `click.types.UnprocessedParamType`. */
export class UnprocessedParamType extends ParamType {
  name = "text";
  override convert(value: unknown): unknown {
    return value;
  }
  toString(): string {
    return "UNPROCESSED";
  }
}

/** `click.types.StringParamType`. */
export class StringParamType extends ParamType {
  name = "text";
  override convert(value: unknown): string {
    if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
    return pyStr(value);
  }
  toString(): string {
    return "STRING";
  }
}

export interface ChoiceOptions {
  case_sensitive?: boolean;
}

/** `click.Choice(choices, case_sensitive=True)`. */
export class Choice extends ParamType {
  name = "choice";
  readonly choices: unknown[];
  readonly case_sensitive: boolean;

  constructor(choices: Iterable<unknown>, opts: ChoiceOptions | boolean = {}) {
    super();
    this.choices = [...choices];
    this.case_sensitive = typeof opts === "boolean" ? opts : (opts.case_sensitive ?? true);
  }

  override toInfoDict(): ParamTypeInfoDict {
    return { choices: this.choices, case_sensitive: this.case_sensitive, ...super.toInfoDict() };
  }

  /** `_normalized_mapping`: `[original, normalized]` pairs in declaration order. */
  normalizedMapping(ctx: Context | null = null): Array<[unknown, string]> {
    return this.choices.map((c) => [c, this.normalizeChoice(c, ctx)]);
  }

  normalizeChoice(choice: unknown, ctx: Context | null): string {
    let normed = pyStr(choice);
    if (ctx !== null && ctx.token_normalize_func !== null) normed = ctx.token_normalize_func(normed);
    if (!this.case_sensitive) normed = casefold(normed);
    return normed;
  }

  override getMetavar(param: Parameter, ctx: Context | null): string | null {
    let choicesStr: string;
    if (param.param_type_name === "option" && !(param as unknown as { show_choices: boolean }).show_choices) {
      const metavars = this.choices.map((c) => guessTypeOf(c).name.toUpperCase());
      choicesStr = [...new Set(metavars)].join("|");
    } else {
      choicesStr = this.normalizedMapping(ctx)
        .map(([, n]) => n)
        .join("|");
    }
    if (param.required && param.param_type_name === "argument") return `{${choicesStr}}`;
    return `[${choicesStr}]`;
  }

  override getMissingMessage(_param: Parameter, ctx: Context | null): string {
    return `Choose from:\n\t${this.normalizedMapping(ctx)
      .map(([, n]) => n)
      .join(",\n\t")}`;
  }

  override convert(value: unknown, param: Parameter | null, ctx: Context | null): unknown {
    const normedValue = this.normalizeChoice(value, ctx);
    for (const [original, normalized] of this.normalizedMapping(ctx)) {
      if (normalized === normedValue) return original;
    }
    return this.fail(this.getInvalidChoiceMessage(value, ctx), param, ctx);
  }

  getInvalidChoiceMessage(value: unknown, ctx: Context | null): string {
    const choicesStr = this.normalizedMapping(ctx)
      .map(([, n]) => pyStrRepr(n))
      .join(", ");
    if (this.choices.length === 1) return `${pyRepr(value)} is not ${choicesStr}.`;
    return `${pyRepr(value)} is not one of ${choicesStr}.`;
  }

  toString(): string {
    return `Choice(${pyRepr(this.choices)})`;
  }
}

/** Convert one scalar value or a string to the number class of a number type. */
abstract class NumberParamTypeBase extends ParamType {
  abstract numberClass(value: unknown): number | bigint | null;

  override convert(value: unknown, param: Parameter | null, ctx: Context | null): number | bigint {
    const rv = this.numberClass(value);
    if (rv === null) {
      return this.fail(`${pyRepr(value)} is not a valid ${this.name}.`, param, ctx);
    }
    return rv;
  }
}

export interface NumberRangeOptions {
  min?: number | PyFloat | null;
  max?: number | PyFloat | null;
  min_open?: boolean;
  max_open?: boolean;
  clamp?: boolean;
}

function num(v: number | PyFloat | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return v instanceof PyFloat ? v.value : v;
}

function numStr(v: number | PyFloat): string {
  return v instanceof PyFloat ? pyFloatRepr(v.value) : pyStr(v);
}

/** Shared behaviour of `IntRange` / `FloatRange` (`_NumberRangeBase`). */
export interface NumberRangeBase {
  readonly min: number | PyFloat | null;
  readonly max: number | PyFloat | null;
  readonly min_open: boolean;
  readonly max_open: boolean;
  readonly clamp: boolean;
  describeRange(): string;
}

function exactInt(n: number): number | bigint {
  return Number.isSafeInteger(n) ? (n === 0 ? 0 : n) : BigInt(n);
}

/** `click.IntParamType`. */
export class IntParamType extends NumberParamTypeBase {
  name = "integer";
  numberClass(value: unknown): number | bigint | null {
    if (typeof value === "bigint") return value;
    if (typeof value === "number") return Number.isFinite(value) ? exactInt(Math.trunc(value)) : null;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (value instanceof PyFloat) return Number.isFinite(value.value) ? exactInt(Math.trunc(value.value)) : null;
    if (typeof value === "string") return parseIntStrict(value);
    return null;
  }
  toString(): string {
    return "INT";
  }
}

/** `click.FloatParamType`. */
export class FloatParamType extends NumberParamTypeBase {
  name = "float";
  numberClass(value: unknown): number | null {
    if (typeof value === "number") return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (value instanceof PyFloat) return value.value;
    if (typeof value === "string") return parseFloatStrict(value);
    return null;
  }
  toString(): string {
    return "FLOAT";
  }
}

function describeRange(r: NumberRangeBase): string {
  if (r.min === null) {
    const op = r.max_open ? "<" : "<=";
    return `x${op}${numStr(r.max as number | PyFloat)}`;
  }
  if (r.max === null) {
    const op = r.min_open ? ">" : ">=";
    return `x${op}${numStr(r.min)}`;
  }
  const lop = r.min_open ? "<" : "<=";
  const rop = r.max_open ? "<" : "<=";
  return `${numStr(r.min)}${lop}x${rop}${numStr(r.max)}`;
}

function convertRange<T extends NumberParamTypeBase & NumberRangeBase>(
  self: T,
  value: unknown,
  param: Parameter | null,
  ctx: Context | null,
  isFloat: boolean,
  clampFn: (bound: number, dir: 1 | -1, open: boolean) => number,
): number {
  const rv = NumberParamTypeBase.prototype.convert.call(self, value, param, ctx) as number;
  const min = num(self.min);
  const max = num(self.max);
  const ltMin = min !== null && (self.min_open ? rv <= min : rv < min);
  const gtMax = max !== null && (self.max_open ? rv >= max : rv > max);

  if (self.clamp) {
    if (min !== null && ltMin) return clampFn(min, 1, self.min_open);
    if (max !== null && gtMax) return clampFn(max, -1, self.max_open);
  }
  if (ltMin || gtMax) {
    const shown = isFloat ? pyFloatRepr(rv) : pyStr(rv);
    return self.fail(`${shown} is not in the range ${self.describeRange()}.`, param, ctx);
  }
  return rv;
}

/** `click.IntRange(min=None, max=None, min_open=False, max_open=False, clamp=False)`. */
export class IntRange extends IntParamType implements NumberRangeBase {
  override name = "integer range";
  readonly min: number | null;
  readonly max: number | null;
  readonly min_open: boolean;
  readonly max_open: boolean;
  readonly clamp: boolean;

  constructor(min: number | null | NumberRangeOptions = null, max: number | null = null, rest: NumberRangeOptions = {}) {
    super();
    if (min !== null && typeof min === "object") {
      rest = min;
      min = rest.min === undefined ? null : (num(rest.min) as number | null);
      max = rest.max === undefined ? null : (num(rest.max) as number | null);
    }
    this.min = min;
    this.max = max;
    this.min_open = rest.min_open ?? false;
    this.max_open = rest.max_open ?? false;
    this.clamp = rest.clamp ?? false;
  }

  override toInfoDict(): ParamTypeInfoDict {
    return {
      min: this.min,
      max: this.max,
      min_open: this.min_open,
      max_open: this.max_open,
      clamp: this.clamp,
      ...super.toInfoDict(),
    };
  }

  describeRange(): string {
    return describeRange(this);
  }

  private clampBound(bound: number, dir: 1 | -1, open: boolean): number {
    return open ? bound + dir : bound;
  }

  override convert(value: unknown, param: Parameter | null, ctx: Context | null): number {
    return convertRange(this, value, param, ctx, false, (b, d, o) => this.clampBound(b, d, o));
  }

  override toString(): string {
    return `<IntRange ${this.describeRange()}${this.clamp ? " clamped" : ""}>`;
  }
}

/** `click.FloatRange(min=None, max=None, min_open=False, max_open=False, clamp=False)`. */
export class FloatRange extends FloatParamType implements NumberRangeBase {
  override name = "float range";
  readonly min: number | PyFloat | null;
  readonly max: number | PyFloat | null;
  readonly min_open: boolean;
  readonly max_open: boolean;
  readonly clamp: boolean;

  constructor(
    min: number | PyFloat | null | NumberRangeOptions = null,
    max: number | PyFloat | null = null,
    rest: NumberRangeOptions = {},
  ) {
    super();
    if (min !== null && typeof min === "object" && !(min instanceof PyFloat)) {
      rest = min;
      min = rest.min ?? null;
      max = rest.max ?? null;
    }
    this.min = min as number | PyFloat | null;
    this.max = max;
    this.min_open = rest.min_open ?? false;
    this.max_open = rest.max_open ?? false;
    this.clamp = rest.clamp ?? false;
    if ((this.min_open || this.max_open) && this.clamp) {
      throw new TypeError("Clamping is not supported for open bounds.");
    }
  }

  override toInfoDict(): ParamTypeInfoDict {
    return {
      min: this.min,
      max: this.max,
      min_open: this.min_open,
      max_open: this.max_open,
      clamp: this.clamp,
      ...super.toInfoDict(),
    };
  }

  describeRange(): string {
    return describeRange(this);
  }

  private clampBound(bound: number, _dir: 1 | -1, open: boolean): number {
    if (!open) return bound;
    throw new Error("Clamping is not supported for open bounds.");
  }

  override convert(value: unknown, param: Parameter | null, ctx: Context | null): number {
    return convertRange(this, value, param, ctx, true, (b, d, o) => this.clampBound(b, d, o));
  }

  override toString(): string {
    return `<FloatRange ${this.describeRange()}${this.clamp ? " clamped" : ""}>`;
  }
}

/** True for `IntRange` / `FloatRange` (isinstance `_NumberRangeBase`). */
export function isNumberRange(t: ParamType): t is ParamType & NumberRangeBase {
  return t instanceof IntRange || t instanceof FloatRange;
}

const BOOL_STATES: Record<string, boolean> = {
  "1": true,
  "0": false,
  yes: true,
  no: false,
  true: true,
  false: false,
  on: true,
  off: false,
  t: true,
  f: false,
  y: true,
  n: false,
  "": false,
};

/** `click.types.BoolParamType`. */
export class BoolParamType extends ParamType {
  name = "boolean";
  static readonly bool_states = BOOL_STATES;

  /** `str_to_bool`: `null` when the string is not a recognised boolean. */
  static strToBool(value: string | boolean): boolean | null {
    if (typeof value === "boolean") return value;
    const key = value.trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(BOOL_STATES, key) ? (BOOL_STATES[key] as boolean) : null;
  }

  override convert(value: unknown, param: Parameter | null, ctx: Context | null): boolean {
    const normalized = typeof value === "string" || typeof value === "boolean" ? BoolParamType.strToBool(value) : null;
    if (normalized === null) {
      const states = Object.keys(BOOL_STATES).sort().join(", ");
      return this.fail(`${pyRepr(value)} is not a valid boolean. Recognized values: ${states}`, param, ctx);
    }
    return normalized;
  }

  toString(): string {
    return "BOOL";
  }
}

const UUID_RE = /^(?:urn:uuid:)?\{?([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})\}?$/i;

/** `click.types.UUIDParameterType` (the value stays the canonical lower-case string). */
export class UUIDParameterType extends ParamType {
  name = "uuid";
  override convert(value: unknown, param: Parameter | null, ctx: Context | null): string {
    const v = String(value).trim();
    const m = UUID_RE.exec(v);
    if (!m) return this.fail(`${pyStrRepr(v)} is not a valid UUID.`, param, ctx);
    return `${m[1]}-${m[2]}-${m[3]}-${m[4]}-${m[5]}`.toLowerCase();
  }
  toString(): string {
    return "UUID";
  }
}

export interface PathOptions {
  exists?: boolean;
  file_okay?: boolean;
  dir_okay?: boolean;
  writable?: boolean;
  readable?: boolean;
  resolve_path?: boolean;
  allow_dash?: boolean;
  executable?: boolean;
}

/** `click.Path(...)`. Values stay strings. */
export class Path extends ParamType {
  name: string;
  readonly exists: boolean;
  readonly file_okay: boolean;
  readonly dir_okay: boolean;
  readonly readable: boolean;
  readonly writable: boolean;
  readonly executable: boolean;
  readonly resolve_path: boolean;
  readonly allow_dash: boolean;

  constructor(opts: PathOptions = {}) {
    super();
    this.exists = opts.exists ?? false;
    this.file_okay = opts.file_okay ?? true;
    this.dir_okay = opts.dir_okay ?? true;
    this.readable = opts.readable ?? true;
    this.writable = opts.writable ?? false;
    this.executable = opts.executable ?? false;
    this.resolve_path = opts.resolve_path ?? false;
    this.allow_dash = opts.allow_dash ?? false;
    this.envvar_list_splitter = nodePath.delimiter;
    if (this.file_okay && !this.dir_okay) this.name = "file";
    else if (this.dir_okay && !this.file_okay) this.name = "directory";
    else this.name = "path";
  }

  override toInfoDict(): ParamTypeInfoDict {
    return {
      exists: this.exists,
      file_okay: this.file_okay,
      dir_okay: this.dir_okay,
      writable: this.writable,
      readable: this.readable,
      allow_dash: this.allow_dash,
      ...super.toInfoDict(),
    };
  }

  override convert(value: unknown, param: Parameter | null, ctx: Context | null): string {
    let rv = String(value);
    const isDash = this.file_okay && this.allow_dash && rv === "-";
    if (!isDash) {
      if (this.resolve_path) {
        try {
          rv = fs.realpathSync.native(rv);
        } catch {
          rv = nodePath.resolve(rv);
        }
      }
      let st: fs.Stats;
      try {
        st = fs.statSync(rv);
      } catch {
        if (!this.exists) return rv;
        return this.fail(`${title(this.name)} ${pyStrRepr(formatFilename(String(value)))} does not exist.`, param, ctx);
      }
      const label = `${title(this.name)} ${pyStrRepr(formatFilename(String(value)))}`;
      if (!this.file_okay && st.isFile()) return this.fail(`${label} is a file.`, param, ctx);
      if (!this.dir_okay && st.isDirectory()) return this.fail(`${label} is a directory.`, param, ctx);
      if (this.readable && !access(rv, fs.constants.R_OK)) return this.fail(`${label} is not readable.`, param, ctx);
      if (this.writable && !access(rv, fs.constants.W_OK)) return this.fail(`${label} is not writable.`, param, ctx);
      if (this.executable && !access(String(value), fs.constants.X_OK)) {
        return this.fail(`${label} is not executable.`, param, ctx);
      }
    }
    return rv;
  }
}

function access(p: string, mode: number): boolean {
  try {
    fs.accessSync(p, mode);
    return true;
  } catch {
    return false;
  }
}

/** `click.Tuple([types])`. */
export class Tuple extends ParamType {
  override is_composite = true;
  readonly types: ParamType[];

  constructor(types: readonly unknown[]) {
    super();
    this.types = types.map((t) => convertType(t));
    this.arity = this.types.length;
  }

  get name(): string {
    return `<${this.types.map((t) => t.name).join(" ")}>`;
  }

  override toInfoDict(): ParamTypeInfoDict {
    return { types: this.types.map((t) => t.toInfoDict()), ...super.toInfoDict() };
  }

  override convert(value: unknown, param: Parameter | null, ctx: Context | null): unknown[] {
    const arr = value as unknown[];
    const lenType = this.types.length;
    const lenValue = arr.length;
    if (lenValue !== lenType) {
      const verb = lenValue === 1 ? "was" : "were";
      return this.fail(`${lenType} values are required, but ${lenValue} ${verb} given.`, param, ctx);
    }
    return this.types.map((ty, i) => ty.call(arr[i], param, ctx));
  }
}

function guessTypeOf(value: unknown): ParamType {
  if (typeof value === "boolean") return BOOL;
  if (typeof value === "number") return Number.isInteger(value) ? INT : FLOAT;
  if (value instanceof PyFloat) return FLOAT;
  if (typeof value === "string") return STRING;
  return STRING;
}

type TypeSpec = ParamType | ((value: any) => unknown) | readonly unknown[] | null | undefined;

function guessType(ty: unknown, deflt: unknown): unknown {
  if (ty !== null && ty !== undefined) return ty;
  if (deflt === null || deflt === undefined) return null;
  if (!Array.isArray(deflt)) return guessTypeOf(deflt);
  if (deflt.length === 0) return null;
  const item = deflt[0];
  if (Array.isArray(item)) return item.map(guessTypeOf);
  return guessTypeOf(item);
}

/** `click.types.convert_type(ty, default)`. */
export function convertType(ty: unknown = null, deflt: unknown = null): ParamType {
  const guessed = guessType(ty, deflt);
  const isGuessed = guessed !== ty && !(guessed === null && (ty === undefined || ty === null));
  if (Array.isArray(guessed)) return new Tuple(guessed);
  if (guessed instanceof ParamType) return guessed;
  if (guessed === null || guessed === undefined || guessed === String) return STRING;
  if (guessed === Number) return FLOAT;
  if (guessed === Boolean) return BOOL;
  if (typeof guessed === "string") {
    switch (guessed) {
      case "str":
        return STRING;
      case "int":
        return INT;
      case "float":
        return FLOAT;
      case "bool":
        return BOOL;
      default:
        throw new TypeError(`Unknown parameter type ${pyStrRepr(guessed)}.`);
    }
  }
  if (isGuessed) return STRING;
  if (typeof guessed === "function") return new FuncParamType(guessed as (value: unknown) => unknown);
  if (isDict(guessed)) throw new TypeError("Invalid parameter type.");
  throw new TypeError("Invalid parameter type.");
}

export const UNPROCESSED = new UnprocessedParamType();
export const STRING = new StringParamType();
export const INT = new IntParamType();
export const FLOAT = new FloatParamType();
export const BOOL = new BoolParamType();
export const UUID = new UUIDParameterType();

export type { TypeSpec };
