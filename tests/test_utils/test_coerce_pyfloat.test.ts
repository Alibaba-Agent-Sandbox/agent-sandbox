/** `pyFloat` = Python's builtin `float(value)` for JSON-like values (error texts checked against CPython). */

import { describe, expect, it } from "vitest";

import { pyFloat } from "../../src/utils/coerce.js";

describe("TestPyFloat", () => {
  it("converts numbers, bools and numeric strings", () => {
    expect(pyFloat(30)).toBe(30);
    expect(pyFloat(1.5)).toBe(1.5);
    expect(pyFloat(true)).toBe(1);
    expect(pyFloat(" 7 ")).toBe(7);
    expect(pyFloat("1e1")).toBe(10);
    expect(pyFloat("1_0")).toBe(10);
    expect(pyFloat("-inf")).toBe(-Infinity);
  });

  it("raises ValueError text for malformed strings", () => {
    expect(() => pyFloat("soon")).toThrow("could not convert string to float: 'soon'");
    expect(() => pyFloat("")).toThrow("could not convert string to float: ''");
  });

  it("raises TypeError text for other types", () => {
    expect(() => pyFloat(null)).toThrow("float() argument must be a string or a real number, not 'NoneType'");
    expect(() => pyFloat([1])).toThrow("float() argument must be a string or a real number, not 'list'");
    expect(() => pyFloat({})).toThrow("float() argument must be a string or a real number, not 'dict'");
  });
});
