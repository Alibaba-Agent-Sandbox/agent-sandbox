/**
 * The MCP runtime must emit and parse JSON exactly like CPython's `json`
 * module (spaced separators, `ensure_ascii`, `JSONDecodeError` texts that are
 * echoed to clients). Expected strings were produced by Python 3.11.
 */

import { describe, expect, it } from "vitest";

import {
  JSONDecodeError,
  pyJsonDumps,
  pyJsonLoads,
  pyJsonLoadsBytes,
  pyRepr,
  pyStr,
  pyStrip,
} from "../../src/agent/_py.js";

describe("TestPyJsonDumps", () => {
  it("uses Python default separators", () => {
    expect(pyJsonDumps({ a: 1, b: [1, 2, { c: null }], d: true })).toBe(
      '{"a": 1, "b": [1, 2, {"c": null}], "d": true}',
    );
  });

  it("compact mode matches Starlette JSONResponse", () => {
    expect(pyJsonDumps({ a: 1, b: [1, 2] }, { compact: true, ensureAscii: false })).toBe('{"a":1,"b":[1,2]}');
  });

  it("escapes non-ASCII by default and keeps it with ensure_ascii=False", () => {
    expect(pyJsonDumps({ error: "Unknown tool: é😀" })).toBe('{"error": "Unknown tool: \\u00e9\\ud83d\\ude00"}');
    expect(pyJsonDumps({ error: "é😀日本" }, { ensureAscii: false })).toBe('{"error": "é😀日本"}');
  });

  it("escapes control characters like Python", () => {
    expect(pyJsonDumps("a\u0001\n\t\"\\\u007f")).toBe('"a\\u0001\\n\\t\\"\\\\\u007f"');
  });

  it("serialises bigint and float values like Python", () => {
    expect(pyJsonDumps([123456789012345678901234567890n, 1.5, 1e-7, 1e22])).toBe(
      "[123456789012345678901234567890, 1.5, 1e-07, 1e+22]",
    );
  });

  it("refuses NaN when allow_nan is false", () => {
    expect(() => pyJsonDumps(Number.NaN, { allowNan: false })).toThrow(/not JSON compliant/);
    expect(pyJsonDumps(Number.NaN)).toBe("NaN");
  });
});

describe("TestPyJsonLoads", () => {
  it.each([
    ["", "Expecting value: line 1 column 1 (char 0)"],
    [" ", "Expecting value: line 1 column 2 (char 1)"],
    ["{", "Expecting property name enclosed in double quotes: line 1 column 2 (char 1)"],
    ["[", "Expecting value: line 1 column 2 (char 1)"],
    ['{"a":1', "Expecting ',' delimiter: line 1 column 7 (char 6)"],
    ['{"a":1,}', "Expecting property name enclosed in double quotes: line 1 column 8 (char 7)"],
    ["[1,]", "Expecting value: line 1 column 4 (char 3)"],
    ['"abc', "Unterminated string starting at: line 1 column 1 (char 0)"],
    ['"a\\qb"', "Invalid \\escape: line 1 column 3 (char 2)"],
    ['"a\nb"', "Invalid control character at: line 1 column 3 (char 2)"],
    ['"\\u12"', "Invalid \\uXXXX escape: line 1 column 3 (char 2)"],
    ["{1:2}", "Expecting property name enclosed in double quotes: line 1 column 2 (char 1)"],
    ['{"a" 1}', "Expecting ':' delimiter: line 1 column 6 (char 5)"],
    ["[1 2]", "Expecting ',' delimiter: line 1 column 4 (char 3)"],
    ["1 2", "Extra data: line 1 column 3 (char 2)"],
    ["01", "Extra data: line 1 column 2 (char 1)"],
    ["\ufeff{}", "Unexpected UTF-8 BOM (decode using utf-8-sig): line 1 column 1 (char 0)"],
    ['{"a":}', "Expecting value: line 1 column 6 (char 5)"],
    ["\n\n  x", "Expecting value: line 3 column 3 (char 4)"],
    ['"😀', "Unterminated string starting at: line 1 column 1 (char 0)"],
    ['😀 x', "Expecting value: line 1 column 1 (char 0)"],
    ['{"😀": 1 x', "Expecting ',' delimiter: line 1 column 9 (char 8)"],
  ])("raises the CPython message for %j", (text, message) => {
    expect(() => pyJsonLoads(text)).toThrow(JSONDecodeError);
    expect(() => pyJsonLoads(text)).toThrow(message);
  });

  it("accepts the same non-standard constants as Python", () => {
    expect(pyJsonLoads("NaN")).toBeNaN();
    expect(pyJsonLoads("-Infinity")).toBe(-Infinity);
    expect(pyJsonLoads("Infinity")).toBe(Infinity);
  });

  it("keeps integers beyond 2**53 exact", () => {
    expect(pyJsonLoads("123456789012345678901234567890")).toBe(123456789012345678901234567890n);
    expect(pyJsonLoads("9007199254740993")).toBe(9007199254740993n);
    expect(pyJsonLoads("12")).toBe(12);
  });

  it("does not pollute prototypes through __proto__ keys", () => {
    const parsed = pyJsonLoads('{"__proto__": {"polluted": true}}') as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["__proto__"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("decodes request bodies like json.loads(bytes)", () => {
    expect(pyJsonLoadsBytes(Buffer.from('{"a": "é"}'))).toEqual({ a: "é" });
    expect(pyJsonLoadsBytes(Buffer.from('\ufeff{"a": 1}'))).toEqual({ a: 1 });
    expect(pyJsonLoadsBytes(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{"a": 1}', "utf16le")]))).toEqual({
      a: 1,
    });
    expect(() => pyJsonLoadsBytes(Buffer.from([0xff, 0xff, 0xff]))).toThrow();
  });
});

describe("TestPyText", () => {
  it("str() and repr() follow Python", () => {
    expect(pyStr(5)).toBe("5");
    expect(pyStr(null)).toBe("None");
    expect(pyStr(true)).toBe("True");
    expect(pyStr(["a", 1, { b: null }])).toBe("['a', 1, {'b': None}]");
    expect(pyRepr("it's")).toBe('"it\'s"');
    expect(pyRepr("a\nb")).toBe("'a\\nb'");
  });

  it("strip() uses Python's whitespace set (U+FEFF is not whitespace)", () => {
    expect(pyStrip("\u001c x \u3000")).toBe("x");
    expect(pyStrip("\ufeffx")).toBe("\ufeffx");
  });
});
