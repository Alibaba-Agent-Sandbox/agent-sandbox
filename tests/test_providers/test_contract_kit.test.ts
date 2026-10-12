/** The contract kit really collects and runs tests (port of `test_contract_kit.py`). */

import { describe, expect, it } from "vitest";

import { ProviderNotFoundError } from "../../src/providers/errors.js";
import * as installer from "../../src/providers/installer.js";
import { contractCases, defineProviderContractTests, parseOptions, runContractSuite, summarizeContract } from "../../src/providers/testing.js";
import { useIso } from "../_support/iso.js";
import { LOCAL_PROCESS, TEST_HOST_VERSION, pythonAvailable } from "../_support/plugins.js";

useIso();

describe("contract kit", () => {
  it("test_kit_has_the_documented_18_cases", () => {
    const names = contractCases().map((c) => c.name);
    expect(names).toHaveLength(18);
    expect(new Set(names).size).toBe(18);
    expect(names).toContain("test_undeclared_feature_fails_with_e8004");
    expect(names).toContain("test_secret_options_are_redacted_from_errors");
  });

  it("test_parse_options", () => {
    expect(parseOptions(["a=1", "b=x=y"])).toEqual({ a: "1", b: "x=y" });
    expect(() => parseOptions(["novalue"])).toThrow(/KEY=VALUE/);
    expect(() => parseOptions(["=x"])).toThrow(/KEY=VALUE/);
  });

  it("test_unknown_provider_fails_every_case_instead_of_passing", async () => {
    const results = await runContractSuite("nope-provider");
    expect(results).toHaveLength(18);
    expect(results.every((r) => r.outcome === "failed")).toBe(true);
    expect(results[0]?.detail).toContain("not installed");
    expect(ProviderNotFoundError).toBeDefined();
  });

  it.skipIf(!pythonAvailable())("test_run_contract_suite_against_the_reference_plugin", async () => {
    await installer.install(LOCAL_PROCESS, { yes: true, hostVersion: TEST_HOST_VERSION });
    const results = await runContractSuite("local-process");
    const counts = summarizeContract(results);
    expect(results.filter((r) => r.outcome === "failed").map((r) => `${r.name}: ${r.detail}`)).toEqual([]);
    expect(counts.passed).toBeGreaterThanOrEqual(12);
    expect(counts.failed).toBe(0);
    const skipped = results.filter((r) => r.outcome === "skipped").map((r) => r.name);
    expect(skipped).toEqual(expect.arrayContaining(["test_pause_resume", "test_ports_url", "test_process_list"]));
  }, 240_000);

  it.skipIf(!pythonAvailable())("test_defineProviderContractTests_registers_with_a_framework", async () => {
    await installer.install(LOCAL_PROCESS, { yes: true, hostVersion: TEST_HOST_VERSION });
    const registered: string[] = [];
    defineProviderContractTests("local-process", {
      describe: (_n, fn) => fn(),
      it: (name) => void registered.push(name),
    });
    expect(registered).toHaveLength(18);
  });
});
