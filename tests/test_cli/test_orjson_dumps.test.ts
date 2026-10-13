/**
 * `orjson.dumps(data, option=OPT_INDENT_2)` fidelity of the CLI's JSON output (`formatters._printJson`,
 * `OutputManager._json`): NaN/Infinity, float notation, 64-bit integer limits, string escaping, error behaviour.
 *
 * The fuzz test compares against `parity/diff/orjson_cases.json`, produced by the oracle's own orjson with
 * `parity/diff/orjson_gen.py` (regenerate: `HOME=$(mktemp -d) <oracle-venv>/bin/python parity/diff/orjson_gen.py`).
 */

import "../_support/isolatedHome.js";

import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { orjsonDumps } from "../../src/cli/_orjson.js";
import { OutputFormatter } from "../../src/cli/formatters.js";
import { OutputManager } from "../../src/cli/output.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { PyFloat } from "../../src/utils/_pyformat.js";
import { command } from "../../src/cli/kit.js";
import { echo } from "../../src/cli/io.js";
import { useCapsys } from "./conftest.js";

type Tagged = null | boolean | string | Tagged[] | { i: string } | { f: string } | { d: [Tagged, Tagged][] } | { x: string };

/** Rebuild the JS value (the number convention of `_orjson.ts`) from the generator's tagged encoding. */
function build(t: Tagged): unknown {
  if (t === null || typeof t === "boolean" || typeof t === "string") return t;
  if (Array.isArray(t)) return t.map(build);
  if ("i" in t) return BigInt(t.i);
  if ("f" in t) return new PyFloat(Buffer.from(t.f, "hex").readDoubleBE(0));
  if ("d" in t) return new Map(t.d.map(([k, v]) => [build(k), build(v)]));
  return new Set([1, 2]);
}

function run(v: unknown, indent: boolean): { ok: string } | { err: string } {
  try {
    return { ok: orjsonDumps(v, { indent }) };
  } catch (exc) {
    return { err: `${(exc as Error).name}: ${(exc as Error).message}` };
  }
}

const CASES = fileURLToPath(new URL("../../parity/diff/orjson_cases.json", import.meta.url));

describe("orjson fuzz comparison", () => {
  it.skipIf(!fs.existsSync(CASES))("matches the oracle's orjson output and errors for every generated case", () => {
    const data = JSON.parse(fs.readFileSync(CASES, "utf8")) as {
      cases: Array<{ value: Tagged; indent: object; compact: object }>;
    };
    expect(data.cases.length).toBeGreaterThan(1000);
    const bad: string[] = [];
    data.cases.forEach((c, i) => {
      const v = build(c.value);
      for (const [mode, indent] of [["indent", true], ["compact", false]] as const) {
        const got = run(v, indent);
        const want = c[mode];
        if (JSON.stringify(got) !== JSON.stringify(want)) {
          bad.push(`#${i} ${mode}\n  want ${JSON.stringify(want).slice(0, 300)}\n  got  ${JSON.stringify(got).slice(0, 300)}`);
        }
      }
    });
    expect(bad.slice(0, 5).join("\n")).toBe("");
    expect(bad.length).toBe(0);
  });
});

describe("orjson behaviours", () => {
  const dumps = (v: unknown): string => orjsonDumps(v);

  it("non-finite floats become null", () => {
    expect(dumps(Number.NaN)).toBe("null");
    expect(dumps(Number.POSITIVE_INFINITY)).toBe("null");
    expect(dumps(new PyFloat(Number.NEGATIVE_INFINITY))).toBe("null");
    expect(dumps({ a: [Number.NaN] })).toBe('{\n  "a": [\n    null\n  ]\n}');
  });

  it("float notation", () => {
    const f = (x: number): string => dumps(new PyFloat(x));
    expect(f(1)).toBe("1.0");
    expect(f(-0)).toBe("-0.0");
    expect(f(1e15)).toBe("1000000000000000.0");
    expect(f(1e16)).toBe("1e+16");
    expect(f(1.5e22)).toBe("1.5e+22");
    expect(f(1e-5)).toBe("0.00001");
    expect(f(1e-6)).toBe("1e-6");
    expect(f(1.5e-7)).toBe("1.5e-7");
    expect(f(5e-324)).toBe("5e-324");
    expect(f(1.7976931348623157e308)).toBe("1.7976931348623157e+308");
    expect(dumps(0.1)).toBe("0.1");
  });

  it("integers: 64-bit range and bigint", () => {
    expect(dumps(2n ** 64n - 1n)).toBe("18446744073709551615");
    expect(dumps(-(2n ** 63n))).toBe("-9223372036854775808");
    expect(() => dumps(2n ** 64n)).toThrow(new TypeError("Integer exceeds 64-bit range"));
    expect(() => dumps(-(2n ** 63n) - 1n)).toThrow(new TypeError("Integer exceeds 64-bit range"));
    expect(dumps(Number.MAX_SAFE_INTEGER)).toBe("9007199254740991");
  });

  it("string escaping and surrogates", () => {
    expect(dumps('a\u2028b\x7f\x00\x1f"\\/\b\f\n\r\t\x0b')).toBe('"a\u2028b\x7f\\u0000\\u001f\\"\\\\/\\b\\f\\n\\r\\t\\u000b"');
    expect(dumps("é😀")).toBe('"é😀"');
    expect(() => dumps("\ud800")).toThrow(new TypeError("str is not valid UTF-8: surrogates not allowed"));
    expect(() => dumps({ "\udfff": 1 })).toThrow(TypeError);
  });

  it("unsupported values and keys", () => {
    expect(() => dumps(new Map([[1, 2]]))).toThrow(new TypeError("Dict key must be str"));
    expect(() => dumps(new Set([1]))).toThrow(new TypeError("Type is not JSON serializable: set"));
    expect(() => dumps(() => 1)).toThrow(new TypeError("Type is not JSON serializable: function"));
  });

  it("recursion limit: 254 nested containers are fine, 255 raise", () => {
    const nest = (n: number): unknown => {
      let v: unknown = 1;
      for (let i = 0; i < n; i += 1) v = [v];
      return v;
    };
    expect(() => dumps(nest(254))).not.toThrow();
    expect(() => dumps(nest(255))).toThrow(new TypeError("Recursion limit reached"));
    const circular: unknown[] = [];
    circular.push(circular);
    expect(() => dumps(circular)).toThrow(new TypeError("Recursion limit reached"));
  });

  it("empty containers, key order, insertion-ordered Map", () => {
    expect(dumps({})).toBe("{}");
    expect(dumps([])).toBe("[]");
    expect(dumps({ b: {}, a: [] })).toBe('{\n  "b": {},\n  "a": []\n}');
    expect(dumps(new Map([["z", 1], ["a", 2]]))).toBe('{\n  "z": 1,\n  "a": 2\n}');
  });
});

describe("formatter and OutputManager use orjson semantics", () => {
  const capsys = useCapsys();

  it("OutputFormatter.printData prints null for NaN and raises for oversized ints", () => {
    const fmt = new OutputFormatter({ use_json: true });
    fmt.printData({ x: Number.NaN, y: new PyFloat(1e16) });
    expect(capsys.readouterr().out).toBe('{\n  "x": null,\n  "y": 1e+16\n}\n');
    expect(() => fmt.printData({ big: 2n ** 70n })).toThrow(new TypeError("Integer exceeds 64-bit range"));
    expect(capsys.readouterr().out).toBe("");
  });

  it("OutputManager.data in JSON mode", async () => {
    const out = new OutputManager({ jsonMode: true });
    out.data({ n: Number.POSITIVE_INFINITY, e: 1e-7 });
    expect(capsys.readouterr().out).toBe('{\n  "n": null,\n  "e": 1e-7\n}\n');
  });
});

// keep the unused-import linter honest: `command`/`echo`/`CliRunner` document the CLI path covered by test_formatters.
void [command, echo, CliRunner];
