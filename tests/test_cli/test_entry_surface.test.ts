/** One public parser, with terminal input kept outside option parsing. */
import { describe, expect, it } from "vitest";
import { group, command, argument, option } from "../../src/cli/kit.js";
import { CliRunner } from "../helpers/cliRunner.js";

it("passes every word after the sandbox ID to the remote command", async () => {
  const values: unknown[] = [];
  const root = group("abx", { params: [option("--json", { is_flag: true })] });
  const sandbox = group("sandbox"); root.addCommand(sandbox);
  sandbox.addCommand(command("exec", { passThroughOptions: true, params: [option("--user"), argument("id"), argument("argv", { nargs: -1, required: true })], callback: (_ctx, params) => { values.push(params); } }));
  const result = await new CliRunner().invoke(root, ["--json", "sandbox", "exec", "--user", "root", "sandbox-id", "tool", "--help", "--provider", "remote", "--native"]);
  expect(result.exit_code, result.output).toBe(0);
  expect(values).toEqual([{ user: "root", id: "sandbox-id", argv: ["tool", "--help", "--provider", "remote", "--native"] }]);
});

describe("retired surface selector", () => {
  it("does not expose a second native entry", async () => {
    const { main } = await import("../../src/cli/main.js");
    expect(await main({ args: ["--native", "config", "get", "region"] })).toBe(2);
  });
});
