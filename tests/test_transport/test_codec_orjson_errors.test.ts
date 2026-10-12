/**
 * `json_decode` error text must match `orjson.JSONDecodeError` (orjson 3.13, the decoder the original codec uses).
 *
 * Expected strings were captured from the Python oracle (and the table was extended by a 44k-case mutation fuzz that is
 * not committed). They surface to users verbatim, e.g. in MCP tool errors when envd answers with a malformed body.
 */

import { describe, expect, it } from "vitest";

import { PyFloat } from "../../src/utils/_pyformat.js";
import { JSONDecodeError, json_decode } from "../../src/transport/codec.js";

const CASES: Array<[string, string]> = [
  ["", "Input is a zero-length, empty document: line 1 column 1 (char 0)"],
  ["  ", "input data is empty: line 1 column 1 (char 0)"],
  ["not json at all", "invalid literal, expected 'null': line 1 column 1 (char 0)"],
  ["nul", "unexpected end of data: line 1 column 4 (char 3)"],
  ["falsy", "invalid literal, expected 'false': line 1 column 1 (char 0)"],
  ["truex", "unexpected content after document: line 1 column 5 (char 4)"],
  ["{", "unexpected end of data: line 1 column 2 (char 1)"],
  ['{"a":', "unexpected end of data: line 1 column 6 (char 5)"],
  ["[1 2]", "unexpected character, expected ',' or ']': line 1 column 4 (char 3)"],
  ['{"a" 1}', "unexpected character, expected ':' after key: line 1 column 6 (char 5)"],
  ["{a:1}", "unexpected character, expected a string key: line 1 column 2 (char 1)"],
  ['{"a":1 x}', "unexpected character, expected ',' or '}': line 1 column 8 (char 7)"],
  ['"a\nb"', "unexpected control character in string: line 1 column 3 (char 2)"],
  ['"\\x"', "invalid escaped sequence in string: line 1 column 2 (char 1)"],
  ['"\\ud800"', "no low surrogate in string: line 1 column 2 (char 1)"],
  ['"\\udc00"', "invalid high surrogate in string: line 1 column 2 (char 1)"],
  ['"\\udc00', "unexpected end of data: line 1 column 8 (char 7)"],
  ['"\\ud800\\u0041"', "invalid low surrogate in string: line 1 column 2 (char 1)"],
  ['"\\ud800\\u12"', "invalid escape in string: line 1 column 2 (char 1)"],
  ['"\\ud800\\ude', "unexpected end of data: line 1 column 12 (char 11)"],
  ["01", "number with leading zero is not allowed: line 1 column 1 (char 0)"],
  ["-01", "number with leading zero is not allowed: line 1 column 2 (char 1)"],
  ["-", "unexpected end of data: line 1 column 2 (char 1)"],
  ["-x", "no digit after sign: line 1 column 2 (char 1)"],
  [".5", "no digit after sign: line 1 column 1 (char 0)"],
  ["1.x", "no digit after decimal point: line 1 column 3 (char 2)"],
  ["1ex", "no digit after exponent sign: line 1 column 3 (char 2)"],
  ["1e999", "number is infinity when parsed as double: line 1 column 1 (char 0)"],
  ["[1e999,", "number is infinity when parsed as double: line 1 column 2 (char 1)"],
  ["[1,]", "trailing comma is not allowed: line 1 column 3 (char 2)"],
  ['{"a":1,}', "trailing comma is not allowed: line 1 column 7 (char 6)"],
  ["NaN", "unexpected character, expected a JSON value: line 1 column 1 (char 0)"],
  ["<html>", "unexpected character, expected a JSON value: line 1 column 1 (char 0)"],
  ["\n\nx", "unexpected character, expected a JSON value: line 3 column 1 (char 2)"],
  ['{"a":\n  x}', "unexpected character, expected a JSON value: line 2 column 3 (char 8)"],
  ['["é", x]', "unexpected character, expected a JSON value: line 1 column 7 (char 6)"],
  ['["😀", x]', "unexpected character, expected a JSON value: line 1 column 7 (char 6)"],
  ["\n[\n1,\n2,\n]", "trailing comma is not allowed: line 4 column 2 (char 7)"],
  ["\ufeff{}", "UTF-8 byte order mark (BOM) is not supported: line 1 column 1 (char 0)"],
];

describe("TestOrjsonDecodeErrors", () => {
  for (const [text, expected] of CASES) {
    it(`reports ${JSON.stringify(text)}`, () => {
      expect(() => json_decode(text)).toThrow(JSONDecodeError);
      expect(() => json_decode(text)).toThrow(expected);
      expect(() => json_decode(Buffer.from(text, "utf8"))).toThrow(expected);
    });
  }

  it("keeps the UTF-8 error text for invalid bytes", () => {
    expect(() => json_decode(Buffer.from([0xff]))).toThrow(
      "str is not valid UTF-8: surrogates not allowed: line 1 column 1 (char 0)",
    );
  });

  it("still accepts what orjson accepts", () => {
    // orjson: `-0` is the int 0, `1E5` the float 100000.0, ints beyond 64 bits become floats.
    expect(json_decode(' \t\r\n{"a":[1,-0,1E5,"\\ud83d\\ude00","\\u0000"]}\n')).toEqual({
      a: [1, 0, new PyFloat(100000), "😀", "\0"],
    });
    expect(json_decode("123456789012345678901234567890")).toEqual(new PyFloat(1.2345678901234568e29));
    expect(json_decode("1e-999")).toEqual(new PyFloat(0));
  });
});
