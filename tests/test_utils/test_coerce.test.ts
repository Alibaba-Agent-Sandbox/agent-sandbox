/**
 * Unit tests for the shared `utils/coerce` module.
 *
 * Covers `parse_scalar` and `coerce_kwargs` with both `CommandArg` (server) and `CustomCommandArg` (declarative) arg
 * types to guarantee identical behaviour after the dedup refactor.
 *
 * `CommandArg` lives in the Python server SDK (`easy_sandbox.server.registry`, not part of the CLI); it is a plain
 * dataclass, reproduced below with the same field defaults and `__post_init__` validation.
 */

import { describe, expect, it } from "vitest";

import { CustomCommandArg } from "../../src/models/template.js";
import { PyValueError, coerce_kwargs, parse_scalar } from "../../src/utils/coerce.js";

class CommandArg {
  name: string;
  type: string;
  required: boolean;
  default: string | null;
  description: string;

  constructor(o: { name: string; type?: string; required?: boolean; default?: string | null; description?: string }) {
    this.name = o.name;
    this.type = o.type ?? "string";
    this.required = o.required ?? false;
    this.default = o.default ?? null;
    this.description = o.description ?? "";
    if (!["boolean", "float", "integer", "string"].includes(this.type)) {
      throw new PyValueError(`Invalid arg type '${this.type}'`);
    }
  }
}

// ---------------------------------------------------------------------------
// parse_scalar
// ---------------------------------------------------------------------------

describe("TestParseScalar", () => {
  // Type coercion for scalar values.

  // ---- string ----
  it("test_string_passthrough", () => {
    expect(parse_scalar("hello", "string")).toBe("hello");
  });

  it("test_string_from_int", () => {
    expect(parse_scalar(42, "string")).toBe("42");
  });

  // ---- integer ----
  it("test_integer_passthrough", () => {
    expect(parse_scalar(7, "integer")).toBe(7);
  });

  it("test_integer_from_str", () => {
    expect(parse_scalar("123", "integer")).toBe(123);
  });

  it("test_integer_rejects_float_str", () => {
    expect(() => parse_scalar("3.14", "integer")).toThrow(PyValueError);
  });

  // ---- float ----
  it("test_float_passthrough", () => {
    expect(parse_scalar(3.14, "float")).toBe(3.14);
  });

  it("test_float_from_str", () => {
    expect(parse_scalar("2.5", "float")).toBe(2.5);
  });

  it("test_float_from_int", () => {
    expect(parse_scalar(3, "float")).toBe(3.0);
  });

  // ---- boolean ----
  it("test_bool_true_passthrough", () => {
    expect(parse_scalar(true, "boolean")).toBe(true);
  });

  it("test_bool_false_passthrough", () => {
    expect(parse_scalar(false, "boolean")).toBe(false);
  });

  for (const val of ["true", "True", "TRUE", "yes", "Yes", "1"]) {
    it(`test_bool_truthy_strings [${val}]`, () => {
      expect(parse_scalar(val, "boolean")).toBe(true);
    });
  }

  for (const val of ["false", "False", "FALSE", "no", "No", "0"]) {
    it(`test_bool_falsy_strings [${val}]`, () => {
      expect(parse_scalar(val, "boolean")).toBe(false);
    });
  }

  it("test_bool_invalid_raises", () => {
    expect(() => parse_scalar("maybe", "boolean")).toThrow(PyValueError);
    expect(() => parse_scalar("maybe", "boolean")).toThrow(/Cannot parse.*as boolean/);
  });

  it("test_bool_false_string_not_truthy", () => {
    // Critical: `bool('False') == True`, but parse_scalar must return False.
    expect(parse_scalar("False", "boolean")).toBe(false);
  });

  // ---- unknown type ----
  it("test_unknown_type_raises", () => {
    expect(() => parse_scalar("x", "complex")).toThrow(PyValueError);
    expect(() => parse_scalar("x", "complex")).toThrow(/Unknown type/);
  });
});

// ---------------------------------------------------------------------------
// coerce_kwargs with CommandArg (server dataclass)
// ---------------------------------------------------------------------------

describe("TestCoerceKwargsCommandArg", () => {
  // `coerce_kwargs` with CommandArg (server layer).

  const _args = () => [
    new CommandArg({ name: "x", type: "integer", required: true }),
    new CommandArg({ name: "y", type: "string", required: false, default: "hi" }),
  ];

  it("test_full_kwargs", () => {
    const result = coerce_kwargs(_args(), { x: "5", y: "world" });
    expect(result).toEqual({ x: 5, y: "world" });
  });

  it("test_default_applied", () => {
    const result = coerce_kwargs(_args(), { x: 3 });
    expect(result).toEqual({ x: 3, y: "hi" });
  });

  it("test_missing_required_raises", () => {
    expect(() => coerce_kwargs(_args(), {})).toThrow(PyValueError);
    expect(() => coerce_kwargs(_args(), {})).toThrow(/Required argument/);
  });

  it("test_undeclared_raises", () => {
    expect(() => coerce_kwargs(_args(), { x: 1, z: "nope" })).toThrow(PyValueError);
    expect(() => coerce_kwargs(_args(), { x: 1, z: "nope" })).toThrow(/Unexpected argument/);
  });

  it("test_type_error_on_bad_conversion", () => {
    expect(() => coerce_kwargs(_args(), { x: "not_a_number" })).toThrow(TypeError);
    expect(() => coerce_kwargs(_args(), { x: "not_a_number" })).toThrow(/Cannot convert/);
  });
});

// ---------------------------------------------------------------------------
// coerce_kwargs with CustomCommandArg (declarative Pydantic model)
// ---------------------------------------------------------------------------

describe("TestCoerceKwargsCustomCommandArg", () => {
  // `coerce_kwargs` with CustomCommandArg (declarative layer).

  const _args = () => [
    new CustomCommandArg({ name: "a", type: "integer", required: true }),
    new CustomCommandArg({ name: "b", type: "float", required: false, default: "1.5" }),
  ];

  it("test_full_kwargs", () => {
    const result = coerce_kwargs(_args(), { a: "3", b: "2.5" });
    expect(result).toEqual({ a: 3, b: 2.5 });
  });

  it("test_default_applied", () => {
    const result = coerce_kwargs(_args(), { a: 7 });
    expect(result).toEqual({ a: 7, b: 1.5 });
  });

  it("test_missing_required_raises", () => {
    expect(() => coerce_kwargs(_args(), {})).toThrow(PyValueError);
    expect(() => coerce_kwargs(_args(), {})).toThrow(/Required argument/);
  });

  it("test_undeclared_raises", () => {
    expect(() => coerce_kwargs(_args(), { a: 1, c: "nope" })).toThrow(PyValueError);
    expect(() => coerce_kwargs(_args(), { a: 1, c: "nope" })).toThrow(/Unexpected argument/);
  });
});

// ---------------------------------------------------------------------------
// Boolean arg coercion with defaults
// ---------------------------------------------------------------------------

describe("TestCoerceBooleanDefaults", () => {
  // Boolean default coercion edge cases.

  it("test_bool_default_true_string", () => {
    const args = [new CommandArg({ name: "flag", type: "boolean", required: false, default: "true" })];
    const result = coerce_kwargs(args, {});
    expect(result).toEqual({ flag: true });
  });

  it("test_bool_default_false_string", () => {
    const args = [new CommandArg({ name: "flag", type: "boolean", required: false, default: "false" })];
    const result = coerce_kwargs(args, {});
    expect(result).toEqual({ flag: false });
  });

  it("test_bool_default_invalid_falls_back", () => {
    // An invalid boolean default should fall back to the raw string.
    const args = [new CommandArg({ name: "flag", type: "boolean", required: false, default: "maybe" })];
    const result = coerce_kwargs(args, {});
    expect(result).toEqual({ flag: "maybe" });
  });
});
