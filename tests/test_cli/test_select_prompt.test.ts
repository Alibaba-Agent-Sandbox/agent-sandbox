import { spawnSync } from "node:child_process";
import { TERMINAL_DRIVER } from "../../scripts/terminal-driver.mjs";
import { describe, expect, it } from "vitest";
import { command } from "../../src/cli/kit.js";
import { echo } from "../../src/cli/io.js";
import { select } from "../../src/cli/prompts.js";
import { CliRunner } from "../helpers/cliRunner.js";

const choices = [
  { name: "Only this command", value: "temporary" },
  { name: "Save for future commands", value: "save" },
  { name: "Cancel", value: "cancel" },
];
const picker = command("pick", { callback: async () => {
  echo(await select("Configuration scope", { choices, default: "temporary", err: true }));
} });

describe("scripted finite selections", () => {
  it("accepts a number and keeps the menu on stderr", async () => {
    const result = await new CliRunner().invoke(picker, [], { input: "2\n" });
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toBe("save\n");
    expect(result.stderr).toContain("2. Save for future commands");
  });
  it("uses the safe default on Enter", async () => {
    const result = await new CliRunner().invoke(picker, [], { input: "\n" });
    expect(result.stdout).toBe("temporary\n");
  });
  it("repeats invalid input and returns the actual selected value", async () => {
    const result = await new CliRunner().invoke(picker, [], { input: "abc\n0\n4\n3\n" });
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toBe("cancel\n");
    expect(result.stderr).toContain("Choose a number from 1 to 3.");
  });
  it("aborts on closed input", async () => {
    const result = await new CliRunner().invoke(picker, []);
    expect(result.exit_code).not.toBe(0);
    expect(result.stdout).toBe("");
  });
});

const prompts = new URL("../../src/cli/prompts.ts", import.meta.url).href;
const python = spawnSync("python3", ["-c", "import pty, fcntl, termios"], { encoding: "utf8" });
const ptyTest = it.skipIf(process.platform === "win32" || python.status !== 0);
const script = `import { select } from ${JSON.stringify(prompts)};
try {
  const result = await select("Configuration scope", ${JSON.stringify({ choices, default: "temporary", err: true })});
  console.log("RESULT:" + result);
} catch (e) { console.log("RESULT:" + e.constructor.name); }`;

ptyTest.each([
  ["Down and Enter", "\x1b[B\r", "save"],
  ["Down then Up and Enter", "\x1b[B\x1b[A\r", "temporary"],
  ["Enter", "\r", "temporary"],
  ["cancel choice", "\x1b[B\x1b[B\r", "cancel"],
  ["Ctrl+C", "\x03", "Abort"],
])("real terminal selection: %s", (_label, keys, expected) => {
  const result = spawnSync("python3", ["-c", TERMINAL_DRIVER, JSON.stringify({
    argv: [process.execPath, "--import", import.meta.resolve("tsx"), "--input-type=module", "-e", script],
    steps: [{ wait_for: "Save for future commands", keys }],
  })], { encoding: "utf8", timeout: 55000 });
  expect(result.status, result.stderr).toBe(0);
  const terminal = JSON.parse(result.stdout) as { status: number; timed_out: boolean; stdout: string; stderr: string };
  expect(terminal.timed_out, terminal.stderr).toBe(false);
  expect(terminal.status).toBe(0);
  expect(terminal.stdout.trim()).toBe(`RESULT:${expected}`);
  expect(terminal.stderr).toContain("Configuration scope");
}, 60000);
