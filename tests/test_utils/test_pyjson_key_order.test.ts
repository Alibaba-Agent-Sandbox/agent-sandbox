/**
 * Integer-like object keys keep their JSON insertion order through parse -> repr / json.dumps / orjson.dumps
 * (JS objects would otherwise iterate them numerically). Expected strings were produced by CPython json / orjson.
 */

import { describe, expect, it } from "vitest";

import { orjsonDumps } from "../../src/cli/_orjson.js";
import { pyJsonDumps, pyRepr } from "../../src/utils/_pyformat.js";
import { pyJsonLoads } from "../../src/utils/_pyjson.js";

const CASES: Array<[string, string, string, string]> = [
  [
    '{"2":1,"1":2,"b":3,"0":{"9":1,"10":2}}',
    '{"2": 1, "1": 2, "b": 3, "0": {"9": 1, "10": 2}}',
    "{'2': 1, '1': 2, 'b': 3, '0': {'9': 1, '10': 2}}",
    '{"2":1,"1":2,"b":3,"0":{"9":1,"10":2}}',
  ],
  ['{"a":1,"1":2,"a":3}', '{"a": 3, "1": 2}', "{'a': 3, '1': 2}", '{"a":3,"1":2}'],
  [
    '{"4294967295":1,"4294967294":2}',
    '{"4294967295": 1, "4294967294": 2}',
    "{'4294967295': 1, '4294967294': 2}",
    '{"4294967295":1,"4294967294":2}',
  ],
];

describe("integer-like key order", () => {
  for (const mode of ["number", "py"] as const) {
    it.each(CASES)(`${mode}: %s`, (src, dumps, repr, orjson) => {
      const v = pyJsonLoads(src, { floats: mode });
      expect(pyJsonDumps(v)).toBe(dumps);
      expect(pyRepr(v)).toBe(repr);
      expect(orjsonDumps(v, { indent: false })).toBe(orjson);
    });
  }
});
