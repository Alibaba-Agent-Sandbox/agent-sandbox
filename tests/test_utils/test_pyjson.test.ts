/** `json.loads` fidelity for server data: float vs int, big ints, error texts, `str()`/`repr()` rendering. */

import { describe, expect, it } from "vitest";

import { json_decode } from "../../src/transport/codec.js";
import { Response } from "../../src/transport/_httpx.js";
import { JSONDecodeError, pyJsonLoads, pyJsonLoadsBytes } from "../../src/utils/_pyjson.js";
import { PyFloat, pyRepr, pyJsonDumps } from "../../src/utils/_pyformat.js";
import { UnicodeDecodeError } from "../../src/utils/_pyos.js";

const py = (t: string): unknown => pyJsonLoads(t, { floats: "py" });

describe("pyJsonLoads floats=py", () => {
  it("keeps whole-number floats as floats", () => {
    const v = py('{"a": 2.0, "b": 2, "c": 1e3, "d": 0.5, "e": -0.0, "f": 1E-2}') as Record<string, unknown>;
    expect(v["a"]).toBeInstanceOf(PyFloat);
    expect(v["b"]).toBe(2);
    expect(v["c"]).toBeInstanceOf(PyFloat);
    expect(v["d"]).toBe(0.5);
    expect(Object.is((v["e"] as PyFloat).value, -0)).toBe(true);
    expect(v["f"]).toBe(0.01);
    expect(pyRepr(v)).toBe("{'a': 2.0, 'b': 2, 'c': 1000.0, 'd': 0.5, 'e': -0.0, 'f': 0.01}");
  });

  it("keeps big ints exact and NaN/Infinity as floats", () => {
    const v = py('[12345678901234567890, -9007199254740993, 1e400, NaN, Infinity, -Infinity]') as unknown[];
    expect(v[0]).toBe(12345678901234567890n);
    expect(v[1]).toBe(-9007199254740993n);
    expect(pyRepr(v)).toBe("[12345678901234567890, -9007199254740993, inf, nan, inf, -inf]");
    expect(pyJsonDumps(v)).toBe("[12345678901234567890, -9007199254740993, Infinity, NaN, Infinity, -Infinity]");
  });

  it("returns ordinary objects (own `__proto__` key stays data)", () => {
    const v = py('{"__proto__": 1, "a": {"b": []}}') as Record<string, unknown>;
    expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
    expect(Object.keys(v)).toEqual(["__proto__", "a"]);
  });

  it("raises CPython's error texts", () => {
    for (const [text, msg] of [
      ["", "Expecting value: line 1 column 1 (char 0)"],
      ["{", "Expecting property name enclosed in double quotes: line 1 column 2 (char 1)"],
      ["[1,]", "Expecting value: line 1 column 4 (char 3)"],
      ["{} x", "Extra data: line 1 column 4 (char 3)"],
      ["[1 2]", "Expecting ',' delimiter: line 1 column 4 (char 3)"],
      ['"a', "Unterminated string starting at: line 1 column 1 (char 0)"],
      ["\n\n  nope", "Expecting value: line 3 column 3 (char 4)"],
    ] as const) {
      expect(() => py(text)).toThrow(JSONDecodeError);
      expect(() => py(text)).toThrow(msg);
    }
  });

  it("rejects undecodable bytes like json.loads(bytes)", () => {
    expect(() => pyJsonLoadsBytes(Buffer.from([0x5b, 0xff, 0x5d]))).toThrow(UnicodeDecodeError);
    expect(() => pyJsonLoadsBytes(Buffer.from([0x5b, 0xff, 0x5d]))).toThrow(
      "'utf-8' codec can't decode byte 0xff in position 1: invalid start byte",
    );
  });
});

describe("httpx Response.json()", () => {
  it("parses with Python's number model", () => {
    const r = new Response(200, { content: Buffer.from('{"result": 2.0, "big": 12345678901234567890, "n": 3}') });
    const body = r.json();
    expect(pyRepr(body)).toBe("{'result': 2.0, 'big': 12345678901234567890, 'n': 3}");
  });

  it("raises json.JSONDecodeError with the CPython text", () => {
    const r = new Response(200, { content: Buffer.from("<html>") });
    expect(() => r.json()).toThrow(JSONDecodeError);
    expect(() => r.json()).toThrow("Expecting value: line 1 column 1 (char 0)");
  });
});

describe("Connect codec json_decode (orjson number model)", () => {
  it("keeps floats, exact 64-bit ints and float fallbacks", () => {
    const v = json_decode('[2.0, 1E2, -0, -0.0, 12345678901234567890, 123456789012345678901234567890, 5, 0.25]') as unknown[];
    expect(pyRepr(v)).toBe("[2.0, 100.0, 0, -0.0, 12345678901234567890, 1.2345678901234568e+29, 5, 0.25]");
  });
});
