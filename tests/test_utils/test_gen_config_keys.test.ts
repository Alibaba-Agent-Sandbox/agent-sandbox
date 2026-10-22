/** `src/utils/config_keys.ts` is generated from the shared fixture; fixture copies are byte-identical. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SOURCE_JSON, TARGET_TS, renderConfigKeys } from "../../scripts/gen-config-keys.mjs";
import { exportSchema } from "../../src/utils/config_keys.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const FIXTURE_NAMES = [
  "config-keys.json",
  "config-resolution-vectors.json",
  "tree-digest-vectors.json",
  "epp-error-mapping.json",
  "epp-methods.json",
];
const DESIGN = path.join(root, "docs", "design", "fixtures");
const TESTS = path.join(root, "tests", "fixtures");
const PY_SDK = path.resolve(root, "..", "python-sdk", "client-sdk", "tests", "fixtures");

describe("generated config_keys.ts", () => {
  it("is up to date with docs/design/fixtures/config-keys.json (drift test)", () => {
    const json = JSON.parse(fs.readFileSync(SOURCE_JSON, "utf-8"));
    expect(fs.readFileSync(TARGET_TS, "utf-8")).toBe(renderConfigKeys(json));
  });

  it("exports the same schema as the fixture", () => {
    const json = JSON.parse(fs.readFileSync(SOURCE_JSON, "utf-8"));
    expect(exportSchema()).toEqual(json);
  });
});

describe("fixture copies", () => {
  it.each(FIXTURE_NAMES)("tests/fixtures/%s is identical to docs/design/fixtures", (name) => {
    expect(fs.readFileSync(path.join(TESTS, name)).equals(fs.readFileSync(path.join(DESIGN, name)))).toBe(true);
  });

  it.each(FIXTURE_NAMES)("%s is identical to the python-sdk copy when it is checked out", (name) => {
    const py = path.join(PY_SDK, name);
    if (!fs.existsSync(py)) return;
    expect(fs.readFileSync(py).equals(fs.readFileSync(path.join(DESIGN, name)))).toBe(true);
  });
});
