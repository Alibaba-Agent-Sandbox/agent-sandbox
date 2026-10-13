/** `parseIntStrict` vs CPython `int(str)` (`parity/diff/int_parse_cases.json`, regenerate with `int_parse_gen.py`). */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseIntStrict } from "../../src/utils/_py.js";

const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../parity/diff/int_parse_cases.json"), "utf8"),
) as { cases: Array<[string, string | null]> };

describe("parseIntStrict", () => {
  it("accepts and rejects exactly what int() does", () => {
    const bad: string[] = [];
    for (const [text, want] of fixture.cases) {
      const got = parseIntStrict(text);
      if (want === null ? got !== null : got === null || String(got) !== want) {
        bad.push(`${JSON.stringify(text)} py=${want} node=${got}`);
      }
    }
    expect(bad.slice(0, 30)).toEqual([]);
    expect(fixture.cases.length).toBeGreaterThan(3000);
  });

  it("handles Unicode digits, underscores and Unicode whitespace", () => {
    expect(parseIntStrict("\u0661\u0662")).toBe(12);
    expect(parseIntStrict("\u00a0-\uff11_0\u3000")).toBe(-10);
    expect(parseIntStrict("1__0")).toBeNull();
    expect(parseIntStrict("\u00b2")).toBeNull();
    expect(parseIntStrict("-0")).toBe(0);
  });

  it("is exact beyond 2**53 (bigint) and plain number inside the safe range", () => {
    expect(parseIntStrict("9007199254740991")).toBe(9007199254740991);
    expect(parseIntStrict("9007199254740993")).toBe(9007199254740993n);
    expect(parseIntStrict("-99999999999999999999")).toBe(-99999999999999999999n);
    expect(parseIntStrict(`${"9".repeat(4300)}`)).toBe(10n ** 4300n - 1n);
    expect(parseIntStrict("9".repeat(4301))).toBeNull();
  });
});
