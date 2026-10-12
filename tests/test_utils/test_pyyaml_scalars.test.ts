/**
 * PyYAML `safe_load` scalar resolution differential: `parity/diff/yaml_scalars_cases.json` holds curated + seeded random
 * documents and what the oracle's PyYAML produced (regenerate with `parity/diff/yaml_scalars_gen.py`).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { safeLoad as apiSafeLoad } from "../../src/api/_yaml.js";
import { safeLoad as utilsSafeLoad } from "../../src/utils/_yaml.js";
import { PyDate, PyFloat, PyTuple, pyDateToDate, safeLoadRich, safeLoadValue } from "../../src/utils/_pyyaml.js";
import { pyFloatRepr } from "../../src/utils/_pyformat.js";

type Enc = Record<string, unknown>;

const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../parity/diff/yaml_scalars_cases.json"), "utf8"),
) as { cases: Array<{ doc: string; expect: Enc }> };

function encode(v: unknown): Enc {
  if (v === null || v === undefined) return { n: null };
  if (typeof v === "boolean") return { b: v };
  if (typeof v === "string") return { s: v };
  if (typeof v === "number" || typeof v === "bigint") return { i: String(v) };
  if (v instanceof PyFloat) return { f: pyFloatRepr(v.value) };
  if (v instanceof PyDate) {
    const d = pyDateToDate(v);
    return { t: d instanceof Date ? d.getTime() : `unparsed:${v.text}` };
  }
  if (v instanceof Uint8Array) return { x: `bytes:${Buffer.from(v).toString("hex")}` };
  if (v instanceof Set) return { x: `set:[${[...v].map((i) => JSON.stringify(String(i))).sort().join(", ")}]` };
  if (v instanceof PyTuple) return { x: "tuple" };
  if (Array.isArray(v)) return { l: v.map(encode) };
  if (v instanceof Map) return { d: [...v.entries()].map(([k, x]) => [encode(k), encode(x)]) };
  return { x: typeof v };
}

function load(doc: string): Enc {
  try {
    return encode(safeLoadRich(doc));
  } catch {
    return { err: "error" };
  }
}

function normalise(e: Enc): Enc {
  // The exception class is not compared, only that loading fails.
  return "err" in e ? { err: "error" } : e;
}

describe("PyYAML scalar resolution", () => {
  it("fixture covers the interesting scalars", () => {
    expect(fixture.cases.length).toBeGreaterThan(2000);
  });

  it("matches PyYAML on every curated and random document", () => {
    const mismatches: string[] = [];
    for (const { doc, expect: want } of fixture.cases) {
      const got = load(doc);
      const same = JSON.stringify(got) === JSON.stringify(normalise(want));
      if (!same) {
        mismatches.push(`${JSON.stringify(doc)}\n   py:   ${JSON.stringify(want)}\n   node: ${JSON.stringify(got)}`);
      }
    }
    expect(mismatches.slice(0, 40).join("\n")).toBe("");
  });

  it("bare y / n are strings, only yes/no/true/false/on/off (PyYAML casings) are booleans", () => {
    expect(safeLoadValue("[y, n, Y, N, yes, no, on, off, True, tRue]")).toEqual([
      "y",
      "n",
      "Y",
      "N",
      true,
      false,
      true,
      false,
      true,
      "tRue",
    ]);
  });

  it("api and utils loaders share the PyYAML implementation", () => {
    const text = "a: 2.0\nb: 0x10\nc: y\nd: 2001-12-14\n";
    expect(apiSafeLoad(text)).toEqual(safeLoadValue(text));
    expect(utilsSafeLoad(text)).toEqual(safeLoadValue(text));
    const loaded = safeLoadValue(text) as Record<string, unknown>;
    expect(loaded["a"]).toBeInstanceOf(PyFloat);
    expect(loaded["b"]).toBe(16);
    expect(loaded["c"]).toBe("y");
    expect(loaded["d"]).toBeInstanceOf(Date);
  });
});
