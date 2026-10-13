/**
 * Python-compatible numeric coercion helpers (`float(value)` semantics, `ValueError` / `OverflowError` classes).
 */

import { pyRepr, PyFloat } from "./_pyformat.js";

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
