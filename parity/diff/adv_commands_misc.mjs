#!/usr/bin/env node
/**
 * ADV-commands: hand-picked adversarial cases (timeouts, huge ints, signals-free scenarios, env precedence,
 * stdin handling, output channel discipline x output-mode matrix). Oracle vs Node.
 *   ORACLE_VENV=... node parity/diff/adv_commands_misc.mjs [--only substr] [--jobs N]
 */
import { argOf, requireOracle, runAll } from "./adv_commands_lib.mjs";
requireOracle();
const cases = [];
const add = (name, argv, extra = {}) => cases.push({ name, argv, ...extra });
const SB = "sbx-ev-001";

for (const t of ["-1", "-4", "-5", "-6", "-65", "-100", "0", "1", "99999", "2147483648", "4294967296"]) {
  add(`exec timeout ${t}`, ["exec", SB, "echo hi", "--timeout", t]);
  add(`process start timeout ${t}`, ["sandbox", "process", "start", SB, "--command", "echo hi", "--timeout", t]);
  add(`shell-stream timeout ${t}`, ["sandbox", "shell-stream", SB, "--command", "echo hi", "--timeout", t]);
}
for (const t of ["-1", "0", "1", "99999999999", "9007199254740993", "99999999999999999999"]) {
  add(`list limit ${t}`, ["list", "--limit", t]);
  add(`root timeout ${t} list`, ["--timeout", t, "list"]);
  add(`files search max-depth ${t}`, ["sandbox", "files", "search", SB, "--path", "/home/user", "--pattern", "*", "--max-depth", t]);
  add(`process signal ${t}`, ["sandbox", "process", "signal", SB, "1", "--signal", t]);
  add(`process info pid ${t}`, ["sandbox", "process", "info", SB, t]);
  add(`create timeout ${t}`, ["create", "--template", "base", "--timeout", t, "-y"]);
  add(`create request-timeout ${t}`, ["create", "--template", "base", "--request-timeout", t, "-y"]);
}
const diffs = await runAll(cases, { jobs: Number(argOf("--jobs") ?? 6), only: argOf("--only") });
process.exitCode = diffs.length ? 1 : 0;
