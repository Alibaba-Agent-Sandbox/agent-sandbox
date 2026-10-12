/**
 * `yaml.safe_load` gate parity: `parity/diff/yaml_gate_cases.json` records PyYAML 6.0.x's outcome (accept + loaded value, or
 * the exception class and full `str(exc)` including the context/problem marks and snippets) for ~3 450 documents: the
 * adversarial agent-template corpus (tags such as `!!python/object/apply`, NUL and other non-printable characters, TAB rules,
 * anchors, flow-context oddities, implicit-key length, `!!binary` / `!!omap` / `!!pairs` / `!!set` / `!!timestamp`, merge
 * keys, block scalars, directives, ...). Regenerate with `parity/diff/yaml_gate_gen.py`.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { pyFloatRepr } from "../../src/utils/_pyformat.js";
import {
  PyDate,
  PyFloat,
  PyTuple,
  PyLoadError,
  safeLoadRich,
} from "../../src/utils/_pyyaml.js";

type Enc = Record<string, unknown>;

const fixture = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../../parity/diff/yaml_gate_cases.json",
    ),
    "utf8",
  ),
) as { cases: Array<{ doc: string; expect: Enc; stream: Enc | null }> };

function encode(v: unknown, depth = 0): Enc {
  if (depth > 30) return { rec: 1 };
  if (v === null || v === undefined) return { n: null };
  if (typeof v === "boolean") return { b: v };
  if (typeof v === "string") return { s: v };
  if (typeof v === "number" || typeof v === "bigint") return { i: String(v) };
  if (v instanceof PyFloat) return { f: pyFloatRepr(v.value) };
  if (v instanceof PyDate) return { t: v.text };
  if (v instanceof Uint8Array) return { x: Buffer.from(v).toString("hex") };
  if (v instanceof Set)
    return {
      set: [...v]
        .map((i) => JSON.stringify(sortKeys(encode(i, depth + 1))))
        .sort(),
    };
  if (v instanceof PyTuple) return { tup: v.map((i) => encode(i, depth + 1)) };
  if (Array.isArray(v)) return { l: v.map((i) => encode(i, depth + 1)) };
  if (v instanceof Map)
    return {
      d: [...v.entries()].map(([k, x]) => [
        encode(k, depth + 1),
        encode(x, depth + 1),
      ]),
    };
  return { "?": typeof v };
}

function sortKeys(e: unknown): unknown {
  if (Array.isArray(e)) return e.map(sortKeys);
  if (e && typeof e === "object") {
    return Object.fromEntries(
      Object.entries(e as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, sortKeys(x)]),
    );
  }
  return e;
}

const STREAM_NAME = "/T/template.yaml";

/** `yaml.safe_load(open(path))`: universal newlines, file name in the marks, no snippets, chunked validation. */
function load(doc: string, stream = false): Enc {
  try {
    return encode(
      stream
        ? safeLoadRich(doc.replace(/\r\n?/g, "\n"), STREAM_NAME)
        : safeLoadRich(doc),
    );
  } catch (exc) {
    if (exc instanceof RangeError) return { err: "RecursionError", msg: "" };
    const err =
      exc instanceof PyLoadError ? exc.pyType : (exc as Error).constructor.name;
    return { err, msg: (exc as Error).message };
  }
}

describe("PyYAML safe_load gate corpus", () => {
  it("fixture covers the adversarial corpus", () => {
    expect(fixture.cases.length).toBeGreaterThan(3000);
  });

  it("accepts and rejects exactly like PyYAML, with the same exception class and message", () => {
    const mismatches: string[] = [];
    for (const { doc, expect: want } of fixture.cases) {
      const got = load(doc);
      const norm = (e: Enc): string => JSON.stringify(sortKeys(e));
      if (norm(got) !== norm(want)) {
        mismatches.push(
          `${JSON.stringify(doc.slice(0, 160))}\n   py:   ${norm(want).slice(0, 300)}\n   node: ${norm(got).slice(0, 300)}`,
        );
      }
    }
    expect(mismatches.slice(0, 20).join("\n")).toBe("");
  });

  it("behaves like PyYAML on a file stream (file name in the marks, no snippets, 4096-character chunks)", () => {
    const mismatches: string[] = [];
    let streamed = 0;
    for (const { doc, stream: want } of fixture.cases) {
      if (want === null) continue;
      streamed += 1;
      const got = load(doc, true);
      const norm = (e: Enc): string => JSON.stringify(sortKeys(e));
      if (norm(got) !== norm(want)) {
        mismatches.push(
          `${JSON.stringify(doc.slice(0, 120))}\n   py:   ${norm(want).slice(0, 300)}\n   node: ${norm(got).slice(0, 300)}`,
        );
      }
    }
    expect(streamed).toBeGreaterThan(3000);
    expect(mismatches.slice(0, 20).join("\n")).toBe("");
  });

  it("rejects python tags and NUL, accepts binary/omap/pairs/set/timestamp tags", () => {
    expect(() =>
      safeLoadRich("a: !!python/object/apply:os.system [echo pwn]\n"),
    ).toThrow(/could not determine a constructor/);
    expect(() => safeLoadRich("name: demo\0\n")).toThrow(
      /unacceptable character #x0000: special characters are not allowed/,
    );
    expect(safeLoadRich("x: !!binary aGVsbG8=\n")).toEqual(
      new Map([["x", new Uint8Array(Buffer.from("hello"))]]),
    );
    expect(
      (safeLoadRich("x: !!omap [a: 1, b: 2]\n") as Map<string, unknown[]>).get(
        "x",
      ),
    ).toHaveLength(2);
    expect(
      (safeLoadRich("x: !!set {a, b}\n") as Map<string, Set<string>>).get("x"),
    ).toEqual(new Set(["a", "b"]));
  });
});
