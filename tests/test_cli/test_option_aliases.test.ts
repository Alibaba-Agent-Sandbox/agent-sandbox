import { describe, expect, it } from "vitest";

import { buildCommand, command, option, type Option, type Params } from "../../src/cli/kit.js";
import { Choice, INT } from "../../src/cli/types.js";

async function parse(param: Option, argv: string[]): Promise<Params> {
  let result: Params = {};
  const cmd = buildCommand(command("probe", {
    params: [param], callback: (_ctx, values) => { result = values; },
  })).configureOutput({ writeErr: () => {}, writeOut: () => {} });
  await cmd.parseAsync(argv, { from: "user" });
  return result;
}

const values = (): Option => option(["--opt", "--option", "-o", "opt"], { multiple: true, metavar: "KEY=VALUE" });

describe("option aliases", () => {
  it("accumulates mixed value aliases into the callback in command-line order", async () => {
    expect(await parse(values(), ["--option", "x=y", "-o", "a=b", "--opt", "c=d", "--option=e=f"]))
      .toEqual({ opt: ["x=y", "a=b", "c=d", "e=f"] });
  });

  it("shares integer conversion and scalar last-value precedence", async () => {
    const param = option(["--count", "--number", "count"], { type: INT });
    expect(await parse(param, ["--count", "1", "--number", "2"])).toEqual({ count: 2 });
    expect(await parse(param, ["--number", "2", "--count", "1"])).toEqual({ count: 1 });
    await expect(parse(param, ["--number", "invalid"])).rejects.toThrow();
  });

  it("validates choices and missing alias values", async () => {
    const param = option(["--mode", "--kind", "mode"], { type: new Choice(["fast", "slow"]) });
    expect(await parse(param, ["--kind", "fast"])).toEqual({ mode: "fast" });
    await expect(parse(param, ["--kind", "other"])).rejects.toThrow();
    await expect(parse(values(), ["--option"])).rejects.toThrow();
  });

  it("renders value syntax and the same description for long aliases", () => {
    const cmd = buildCommand(command("probe", { params: [option(["--opt", "--option", "-o", "opt"], { multiple: true, metavar: "KEY=VALUE", help: "Provider option" })] }));
    const help = cmd.helpInformation();
    expect(help).toContain("--option <KEY=VALUE>");
    expect(help).not.toContain("Opposite of --opt");
  });

  it.each([false, true])("preserves boolean pair defaults and last flag wins (default %s)", async (defaultValue) => {
    const param = option(["--enabled/--disabled", "enabled"], { default: defaultValue });
    expect(await parse(param, [])).toEqual({ enabled: defaultValue });
    expect(await parse(param, ["--enabled", "--disabled"])).toEqual({ enabled: false });
    expect(await parse(param, ["--disabled", "--enabled"])).toEqual({ enabled: true });
  });

  it.each([false, true])("preserves --no-* pair defaults and both orders (default %s)", async (defaultValue) => {
    const param = option(["--inject/--no-inject", "inject"], { default: defaultValue });
    expect(await parse(param, [])).toEqual({ inject: defaultValue });
    expect(await parse(param, ["--inject", "--no-inject"])).toEqual({ inject: false });
    expect(await parse(param, ["--no-inject", "--inject"])).toEqual({ inject: true });
  });

  it("keeps a standalone --no-* flag affirmative and ordinary flag aliases equivalent", async () => {
    expect(await parse(option(["--no-color"], { is_flag: true }), [])).toEqual({ no_color: false });
    expect(await parse(option(["--no-color"], { is_flag: true }), ["--no-color"])).toEqual({ no_color: true });
    expect(await parse(option(["--verbose", "--chatty", "verbose"], { is_flag: true }), ["--chatty"])).toEqual({ verbose: true });
  });

  it("retains declared defaults and environment fallback across aliases", async () => {
    const param = option(["--count", "--number", "count"], { type: INT, default: 3, envvar: "ABX_TEST_ALIAS_COUNT" });
    const previous = process.env["ABX_TEST_ALIAS_COUNT"];
    try {
      process.env["ABX_TEST_ALIAS_COUNT"] = "4";
      expect(await parse(param, [])).toEqual({ count: 4 });
      expect(await parse(param, ["--number", "5"])).toEqual({ count: 5 });
      delete process.env["ABX_TEST_ALIAS_COUNT"];
      expect(await parse(param, [])).toEqual({ count: 3 });
    } finally {
      if (previous === undefined) delete process.env["ABX_TEST_ALIAS_COUNT"];
      else process.env["ABX_TEST_ALIAS_COUNT"] = previous;
    }
  });
});
