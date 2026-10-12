/**
 * Task 191 -- `-h` alias for every reachable command path.
 *
 * The alias is configured exactly once, on the root group in `cli/main.ts`
 * (`context_settings: { help_option_names: ["-h", "--help"] }`). Click propagates `help_option_names` from the parent
 * Context down the entire command tree -- including lazily loaded groups (`LazyGroup`) and nested sub-groups
 * (`sandbox files` / `sandbox process` / `sandbox system`) -- so no per-command wiring is required.
 *
 * These tests lock the behaviour in:
 *
 *  - walking every reachable path (the root plus all subcommands, including lazily registered ones) and asserting
 *    `-h` / `--help` both exit 0 with identical output;
 *  - asserting the target command's callback never runs on a help path, so no command side effects (filesystem,
 *    network) are triggered;
 *  - guarding against a future command defining a `-h` parameter of its own -- Click would then silently drop the alias
 *    for that command, so the guard makes the conflict explicit and deliberate;
 *  - covering the `ebx run` passthrough command: before this task, `ebx run <id> <cmd> -h` failed with "Unexpected
 *    positional argument" (`-h` was never a passthrough token there); it now shows help without dialling the sandbox,
 *    and the `--key value` extra-arg contract is unchanged.
 *
 * The walk needs every command module (`cli/commands/*`); until they all exist the parametrised tests are skipped
 * (BLOCKED-ON: cli/commands/*) and switch on by themselves afterwards.
 */

import "../_support/isolatedHome.js";

import { describe, expect, it, vi } from "vitest";

import { Sandbox } from "../../src/api/sandbox.js";
import { cli } from "../../src/cli/main.js";
import { type Command, Context, Group } from "../../src/framework/index.js";
import { CliRunner, type Result } from "../helpers/cliRunner.js";
import { ALL_COMMANDS } from "./conftest.js";

/**
 * Yield `[path, command]` for every command reachable from *cmd*.
 *
 * Resolution goes through `Group.getCommand` -- the same entry point argument parsing uses -- so lazily registered
 * subcommands are loaded and included exactly as they are at runtime.
 */
async function iterCommands(cmd: Command, path: string[] = []): Promise<Array<[string[], Command]>> {
  const out: Array<[string[], Command]> = [];
  if (!(cmd instanceof Group)) return out;
  const ctx = new Context(cmd);
  for (const name of await cmd.listCommands(ctx)) {
    const sub = await cmd.getCommand(ctx, name);
    if (sub === null) continue; // defensive (broken lazy import)
    const subpath = [...path, name];
    out.push([subpath, sub]);
    out.push(...(await iterCommands(sub, subpath)));
  }
  return out;
}

/** Root plus every reachable command, keyed by its path. */
const COMMANDS = new Map<string, [string[], Command]>([["", [[], cli]]]);
if (ALL_COMMANDS) {
  await cli.whenReady();
  for (const [p, c] of await iterCommands(cli)) COMMANDS.set(p.join("\u0000"), [p, c]);
}
const PATHS: string[][] = [...COMMANDS.values()].map(([p]) => p).sort((a, b) => a.join("\u0000").localeCompare(b.join("\u0000")));
const CASES: Array<[string, string[]]> = PATHS.map((p) => [p.join(" ") || "<root>", p]);
const target = (p: string[]): Command => (COMMANDS.get(p.join("\u0000")) as [string[], Command])[1];

/** Invoke `<path> -h` and `<path> --help` and return both results. */
async function invokePair(runner: CliRunner, path: string[]): Promise<[Result, Result]> {
  const short = await runner.invoke(cli, [...path, "-h"]);
  const long = await runner.invoke(cli, [...path, "--help"]);
  return [short, long];
}

// BLOCKED-ON: cli/commands/* (every command module)
it.skipIf(!ALL_COMMANDS).each(CASES)("test_dash_h_matches_double_dash_help [%s]", async (_id, path) => {
  // Both spellings exit 0 and print identical help for every command.
  const [short, long] = await invokePair(new CliRunner(), path);

  expect(short.exit_code, `\`ebx ${path.join(" ")} -h\` exited ${short.exit_code}: ${JSON.stringify(short.output)}`).toBe(0);
  expect(long.exit_code, `\`ebx ${path.join(" ")} --help\` exited ${long.exit_code}: ${JSON.stringify(long.output)}`).toBe(0);
  expect(short.output).toBe(long.output);
  expect(short.output.startsWith("Usage:")).toBe(true);
});

it.skipIf(!ALL_COMMANDS).each(CASES)("test_help_never_runs_the_target_callback [%s]", async (_id, path) => {
  // Showing help must not execute the target command (no side effects). Ancestor group callbacks may run -- that is
  // Click's standard resolution flow and they are side-effect-free context initialisers. The *target* command itself
  // must never be invoked.
  const tgt = target(path);
  const calls: string[][] = [];
  const original = tgt.callback;

  tgt.callback = async (...args: Parameters<NonNullable<typeof original>>) => {
    calls.push(path);
    if (original !== null) return original(...args);
    return null;
  };
  let short: Result;
  let long: Result;
  try {
    [short, long] = await invokePair(new CliRunner(), path);
  } finally {
    tgt.callback = original;
  }

  expect(short.exit_code).toBe(0);
  expect(long.exit_code).toBe(0);
  expect(calls, `help executed the callback of \`ebx ${path.join(" ")}\``).toEqual([]);
});

// BLOCKED-ON: cli/commands/* (every command module)
it.skipIf(!ALL_COMMANDS)("test_no_command_reserves_dash_h_for_itself", () => {
  // Guard: a user-facing `-h` parameter would drop the alias.
  //
  // Click protects the user parameter (help keeps only `--help` for that command), which is safe but subtle -- this
  // test makes the conflict loud so the decision is explicit rather than silent.
  const offenders: string[] = [];
  for (const [path, cmd] of [...COMMANDS.values()].sort((a, b) => a[0].join(" ").localeCompare(b[0].join(" ")))) {
    for (const param of cmd.params) {
      const names = [...param.opts, ...param.secondary_opts];
      if (names.includes("-h")) offenders.push(`\`ebx ${path.join(" ") || "<root>"}\` parameter ${JSON.stringify(param.name)}`);
    }
  }
  expect(offenders, "Commands reserving '-h' (the help alias would be dropped there): " + offenders.join(", ")).toEqual([]);
});

// BLOCKED-ON: cli/commands/* (every command module)
it.skipIf(!ALL_COMMANDS)("test_every_lazy_subcommand_is_covered", () => {
  // Every lazily registered top-level name resolves and is tested above.
  const lazy = new Set(cli._lazy_subcommands.keys());
  const topLevel = new Set(PATHS.filter((p) => p.length === 1).map((p) => p[0] as string));
  for (const name of lazy) expect(topLevel.has(name), name).toBe(true);
});

describe("TestRunPassthroughCompatibility", () => {
  // `ebx run` keeps its extra-arg contract while gaining `-h`.
  //
  // Before task 191, `ebx run <id> <cmd> -h` was rejected with "Unexpected positional argument" -- `-h` was never
  // forwarded to the remote command. It now shows help, and the sandbox is not dialled on the help path.

  it("test_dash_h_shows_help_without_connecting", async () => {
    const connect = vi.spyOn(Sandbox, "connect").mockImplementation((async () => undefined) as never);
    const result = await new CliRunner().invoke(cli, ["run", "sbx-1", "build", "-h"]);

    expect(result.exit_code).toBe(0);
    expect(result.output.startsWith("Usage: cli run")).toBe(true);
    expect(connect).not.toHaveBeenCalled();
    connect.mockRestore();
  });

  it("test_double_dash_help_also_skips_connect", async () => {
    const connect = vi.spyOn(Sandbox, "connect").mockImplementation((async () => undefined) as never);
    const result = await new CliRunner().invoke(cli, ["run", "sbx-1", "build", "--help"]);

    expect(result.exit_code).toBe(0);
    expect(result.output.startsWith("Usage: cli run")).toBe(true);
    expect(connect).not.toHaveBeenCalled();
    connect.mockRestore();
  });

  it("test_extra_args_still_forwarded", async () => {
    // `--key value` extra args keep working after the alias change.
    const mockResult = { value: "deployed", stdout: "deployed\n", stderr: "", exit_code: 0, execution_time: 1.0, source: "template" };
    const custom = vi.fn(async () => mockResult);
    const mockSandbox = { custom };
    const connect = vi.spyOn(Sandbox, "connect").mockImplementation((async () => mockSandbox) as never);

    const result = await new CliRunner().invoke(cli, ["run", "sbx-1", "deploy", "--target", "staging"]);

    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("deployed");
    expect(custom).toHaveBeenCalledTimes(1);
    const call = custom.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(call[0]).toBe("deploy");
    expect(call[1]["target"]).toBe("staging");
    connect.mockRestore();
  });
});
