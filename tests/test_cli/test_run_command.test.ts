/** Removed named-command wrappers never connect to a Provider or execute a remote command. */
import "../_support/isolatedHome.js";

import { afterEach, describe, expect, it, vi } from "vitest";
import { Sandbox } from "../../src/api/sandbox.js";
import { cli } from "../../src/cli/main.js";
import { CliRunner } from "../helpers/cliRunner.js";

afterEach(() => vi.restoreAllMocks());

describe("retired business-command wrappers", () => {
  it.each([
    ["run", "sandbox-id", "report"],
    ["registry-command", "sandbox-id", "list"],
    ["sandbox", "command", "list", "sandbox-id"],
    ["sandbox", "command", "run", "sandbox-id", "report"],
    ["sandbox", "command", "run", "sandbox-id", "report", "--json-args", "{}"],
  ])("rejects %j before connecting", async (...args) => {
    const connect = vi.spyOn(Sandbox, "connect").mockRejectedValue(new Error("must not connect"));
    const commands = vi.spyOn(Sandbox.prototype, "runCommand").mockRejectedValue(new Error("must not run"));
    const list = vi.spyOn(Sandbox.prototype, "listCommands").mockRejectedValue(new Error("must not discover"));
    const result = await new CliRunner().invoke(cli, args);
    expect(result.exit_code, result.output).toBe(2);
    expect(connect).not.toHaveBeenCalled();
    expect(commands).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });
});
