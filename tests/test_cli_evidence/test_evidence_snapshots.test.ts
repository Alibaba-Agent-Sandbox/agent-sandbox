/**
 * Golden-file snapshot tests for CLI evidence cases (port of `tests/test_cli_evidence/test_evidence_snapshots.py`).
 *
 * Iterates the offline-deterministic cases of the shared registry (`evidence_cases.ts`), invokes the Node CLI through
 * `CliRunner`, normalises the output and compares it byte for byte against the committed golden files in
 * `tests/test_cli_evidence/golden/<case>.txt` (copied unchanged from the Python repository).
 *
 * Set `ABX_UPDATE_EVIDENCE=1` to **write** (seed / refresh) golden files instead of asserting against them.
 */

import "../_support/isolatedHome.js";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it } from "vitest";

import { delenv } from "../helpers/templateSupport.js";
import { _CI_ENV_VARS } from "../_support/env.js";
import { REGISTRY, eligibleCases, formatResult, normalize, runCase } from "./evidence_cases.js";

const GOLDEN_DIR = fileURLToPath(new URL("./golden/convergence-20261018/", import.meta.url));
const UPDATE = process.env["ABX_UPDATE_EVIDENCE"] === "1";

/** `_suppress_ci_detection`: the CLI must never auto-enable JSON mode. */
beforeEach(() => {
  for (const v of _CI_ENV_VARS) delenv(v);
});

const cases = eligibleCases();

describe("evidence registry", () => {
  it("registry_has_no_duplicate_golden_names", () => {
    const names = REGISTRY.map((c) => c.output_file);
    expect(new Set(names).size).toBe(names.length);
  });
});

it.each(cases.map((c) => [c.output_file, c] as const))("test_evidence_snapshot [%s]", async (_name, testCase) => {
  // Compare normalised CLI output against committed golden file.
  // `stdout` only (not the interleaved `output`): the stdout/stderr split is what the evidence must prove.
  const { stdout, stderr, exit_code } = await runCase(testCase);
  const actual = normalize(formatResult(stdout, stderr, exit_code));

  const goldenPath = path.join(GOLDEN_DIR, `${testCase.output_file}.txt`);
  if (UPDATE) {
    fs.mkdirSync(path.dirname(goldenPath), { recursive: true });
    fs.writeFileSync(goldenPath, actual);
    return;
  }
  expect(
    fs.existsSync(goldenPath),
    `Golden file missing: ${goldenPath}\nRegenerate with: ABX_UPDATE_EVIDENCE=1 npx vitest run tests/test_cli_evidence`,
  ).toBe(true);
  const expected = fs.readFileSync(goldenPath, "utf8");
  expect(actual, `Output mismatch for ${testCase.output_file}`).toBe(expected);
});
