/** One public parser, with terminal input kept outside option parsing. */
import { describe, expect, it } from "vitest";
import { group, command, argument, option } from "../../src/cli/kit.js";
import { CliRunner } from "../helpers/cliRunner.js";

it("passes every word after the sandbox ID to the remote command", async () => {
  const values: unknown[] = [];
  const root = group("abx", { params: [option("--json", { is_flag: true })] });
  root.addCommand(command("exec", { passThroughOptions: true, params: [option("--user"), argument("id"), argument("argv", { nargs: -1, required: true })], callback: (_ctx, params) => { values.push(params); } }));
  const result = await new CliRunner().invoke(root, ["--json", "exec", "--user", "root", "sandbox-id", "tool", "--help", "--provider", "remote", "--native"]);
  expect(result.exit_code, result.output).toBe(0);
  expect(values).toEqual([{ user: "root", id: "sandbox-id", argv: ["tool", "--help", "--provider", "remote", "--native"] }]);
});

describe("callback-owned help", () => {
  it.each([[], ["demo"], ["exec", "report"], ["files", "list"]])("passes target-aware help to the callback for %j", async (...args) => {
    const values: unknown[] = [];
    const root = group("abx");
    root.addCommand(command("sandbox", {
      automaticHelp: false,
      params: [argument("target", { required: false }), argument("operation", { required: false }), option(["-h", "--help"], { is_flag: true })],
      callback: (_ctx, params) => { values.push(params); },
    }));
    const result = await new CliRunner().invoke(root, ["sandbox", ...args, "--help"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(values).toEqual([{ target: args[0] ?? null, operation: args[1] ?? null, help: true }]);
  });

  it("keeps automatic help as the default without invoking the callback", async () => {
    let called = false;
    const entry = command("normal", { params: [argument("required")], callback: () => { called = true; } });
    const result = await new CliRunner().invoke(entry, ["--help"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("REQUIRED");
    expect(called).toBe(false);
  });
});

describe("retired surface selector", () => {
  it("does not expose a second native entry", async () => {
    const { main } = await import("../../src/cli/main.js");
    expect(await main({ args: ["--native", "config", "get", "region"] })).toBe(2);
  });
});
