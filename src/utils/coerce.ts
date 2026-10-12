/**
 * Shared scalar type coercion for command arguments (port of `utils/coerce.py`).
 *
 * Both the **server** layer and the **declarative** layer need identical coerce-and-validate logic. This module
 * provides the single canonical implementation so the two paths can never drift.
 *
 * The functions accept any arg object exposing `.name`, `.type`, `.required`, and `.default` attributes — covering
 * both the server `CommandArg` and `models/template.CustomCommandArg`.
 *
 * Error classes: Python raised `ValueError` / `TypeError`; here they are the JS `Error` subclasses
 * {@link PyValueError} (name `ValueError`) and the built-in `TypeError`.
 *
 * Number caveat: `parse_scalar(v, "integer")` of a JS number accepts integral values; `float` always returns a number.
 */

import { pyRepr, pyStr, pySorted, PyFloat } from "./_pyformat.js";

export const __all__ = ["parse_scalar", "coerce_kwargs"] as const;

/** Python `ValueError`. */
export class PyValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueError";
  }
}

/** Python `OverflowError`. */
export class PyOverflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OverflowError";
  }
}

// ---------------------------------------------------------------------------
// Boolean whitelist
// ---------------------------------------------------------------------------

export const _BOOL_TRUE: ReadonlySet<string> = new Set(["true", "yes", "1"]);
export const _BOOL_FALSE: ReadonlySet<string> = new Set(["false", "no", "0"]);

/** Python `int(str)` parsing rules (whitespace stripped, sign, underscores between digits). */
function pyIntFromString(value: string): number | bigint {
  const t = value.trim();
  if (!/^[+-]?\d+(?:_\d+)*$/.test(t)) {
    throw new PyValueError(`invalid literal for int() with base 10: ${pyRepr(value)}`);
  }
  const n = Number(t.replace(/_/g, ""));
  return Number.isSafeInteger(n) ? n : BigInt(t.replace(/_/g, ""));
}

/** Python `float(int)` for an int beyond 2**53 (`OverflowError` past the double range). */
function pyFloatFromBigint(value: bigint): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new PyOverflowError("int too large to convert to float");
  return n;
}

/** Python `float(str)` parsing rules. */
function pyFloatFromString(value: string): number {
  const t = value.trim();
  if (!/^[+-]?(?:(?:\d+(?:_\d+)*\.?(?:\d+(?:_\d+)*)?|\.\d+(?:_\d+)*)(?:[eE][+-]?\d+(?:_\d+)*)?|inf(?:inity)?|nan)$/i.test(t)) {
    throw new PyValueError(`could not convert string to float: ${pyRepr(value)}`);
  }
  const low = t.toLowerCase().replace(/^[+-]/, "");
  if (low.startsWith("inf")) return t.startsWith("-") ? -Infinity : Infinity;
  if (low === "nan") return NaN;
  return Number(t.replace(/_/g, ""));
}

/** Python's builtin `float(value)` for JSON-like input (`ValueError` / `TypeError` texts verbatim). */
export function pyFloat(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return pyFloatFromBigint(value);
  if (value instanceof PyFloat) return value.value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") return pyFloatFromString(value);
  const kind =
    value === null || value === undefined ? "NoneType" : Array.isArray(value) ? "list" : typeof value === "object" ? "dict" : typeof value;
  throw new TypeError(`float() argument must be a string or a real number, not '${kind}'`);
}

// ---------------------------------------------------------------------------
// Scalar parsing
// ---------------------------------------------------------------------------

/**
 * Parse / coerce `value` according to its declared `type_str`.
 *
 * Supported `type_str` values: `"string"`, `"integer"`, `"float"`, `"boolean"`.
 *
 * Bool parsing uses a whitelist (`true/false/yes/no/1/0`) to avoid the `bool("False") == True` pitfall.
 *
 * @throws ValueError if `value` cannot be converted or `type_str` is unrecognised.
 */
export function parse_scalar(value: unknown, type_str: string): unknown {
  if (type_str === "string") return pyStr(value);

  if (type_str === "integer") {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isInteger(value)) return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "string") return pyIntFromString(value);
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new PyValueError(Number.isNaN(value) ? "cannot convert float NaN to integer" : "cannot convert float infinity to integer");
      }
      return Math.trunc(value);
    }
    if (value instanceof PyFloat) return Math.trunc(value.value);
    throw new TypeError(
      `int() argument must be a string, a bytes-like object or a real number, not '${value === null || value === undefined ? "NoneType" : typeof value === "object" ? (Array.isArray(value) ? "list" : "dict") : typeof value}'`,
    );
  }

  if (type_str === "float") {
    if (typeof value === "number") return value;
    if (typeof value === "bigint") return pyFloatFromBigint(value);
    if (value instanceof PyFloat) return value.value;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "string") return pyFloatFromString(value);
    throw new TypeError(
      `float() argument must be a string or a real number, not '${value === null || value === undefined ? "NoneType" : Array.isArray(value) ? "list" : typeof value === "object" ? "dict" : typeof value}'`,
    );
  }

  if (type_str === "boolean") {
    if (typeof value === "boolean") return value;
    const s = pyStr(value).toLowerCase();
    if (_BOOL_TRUE.has(s)) return true;
    if (_BOOL_FALSE.has(s)) return false;
    throw new PyValueError(`Cannot parse ${pyRepr(value)} as boolean; accepted values: true/false/yes/no/1/0`);
  }

  throw new PyValueError(`Unknown type: ${pyRepr(type_str)}`);
}

// ---------------------------------------------------------------------------
// Arg-like protocol
// ---------------------------------------------------------------------------

/** Minimal interface shared by `CommandArg` and `CustomCommandArg`. */
export interface ArgLike {
  name: string;
  type: string;
  required: boolean;
  default: string | null;
}

// ---------------------------------------------------------------------------
// Kwargs coercion / validation
// ---------------------------------------------------------------------------

/**
 * Coerce and validate `raw` kwargs against `args` definitions.
 *
 * @param args Ordered list of arg descriptors (anything with `.name`, `.type`, `.required`, `.default`).
 * @param raw Raw keyword arguments from the caller / JSON body.
 * @returns A new object with values converted to the declared types.
 * @throws ValueError if a required argument is missing or an undeclared argument is provided.
 * @throws TypeError if a value cannot be converted to the declared type.
 */
export function coerce_kwargs(args: ArgLike[], raw: Record<string, unknown>): Record<string, unknown> {
  const declaredNames = new Set(args.map((arg) => arg.name));

  // --- Reject undeclared arguments early (fail-fast) ---
  const undeclared = pySorted(Object.keys(raw).filter((k) => !declaredNames.has(k)));
  if (undeclared.length) {
    const declared = pySorted(declaredNames);
    throw new PyValueError(
      `Unexpected argument(s): ${pyRepr(undeclared)}; declared: ${declared.length ? pyRepr(declared) : "(none)"}`,
    );
  }

  // --- Coerce declared arguments ---
  const coerced: Record<string, unknown> = {};
  for (const arg of args) {
    if (Object.prototype.hasOwnProperty.call(raw, arg.name)) {
      try {
        coerced[arg.name] = parse_scalar(raw[arg.name], arg.type);
      } catch (exc) {
        if (exc instanceof PyValueError || exc instanceof TypeError) {
          const te = new TypeError(`Cannot convert argument ${pyRepr(arg.name)} to ${arg.type}: ${exc.message}`);
          (te as { cause?: unknown }).cause = exc;
          throw te;
        }
        throw exc;
      }
    } else if (arg.required) {
      throw new PyValueError(`Required argument ${pyRepr(arg.name)} missing`);
    } else if (arg.default !== null && arg.default !== undefined) {
      // Best-effort coercion of the default; fall back to the raw string if conversion fails (e.g. a placeholder
      // like "N/A").
      try {
        coerced[arg.name] = parse_scalar(arg.default, arg.type);
      } catch (exc) {
        if (exc instanceof PyValueError || exc instanceof TypeError) coerced[arg.name] = arg.default;
        else throw exc;
      }
    }
  }

  return coerced;
}

export { parse_scalar as parseScalar, coerce_kwargs as coerceKwargs };
