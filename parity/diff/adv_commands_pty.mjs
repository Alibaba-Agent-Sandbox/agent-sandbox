#!/usr/bin/env node
/**
 * ADV-commands: interactive (pseudo-terminal) behaviour of `abx connect` (REPL) and of Rich/Click output on a TTY:
 * line editing, history, Ctrl-C / Ctrl-D, long lines, bracketed paste, unicode, spinners / tables on a TTY, colour env
 * (NO_COLOR / FORCE_COLOR / TERM=dumb / CI), width via COLUMNS. Oracle vs Node.
 *   ORACLE_VENV=... node parity/diff/adv_commands_pty.mjs [--only substr] [--jobs N]
 */
import { argOf, requireOracle, runAll } from "./adv_commands_lib.mjs";
requireOracle();
const SB = "sbx-ev-001";
const cases = [];
const P = "abx:sbx-ev-0> ";
const pty = (name, argv, steps, extra = {}) => cases.push({ name, argv, keepAnsi: true, pty: { steps, timeout: 30 }, env: { TERM: "dumb", NO_COLOR: null, ...(extra.env ?? {}) }, ...extra, env2: undefined });
const replSteps = (...lines) => lines.flatMap((l) => [{ expect: P, send: l }]);
for (const term of ["dumb", "xterm-256color"]) {
  const env = { TERM: term, NO_COLOR: null };
  const t = (n) => `[${term}] ${n}`;
  pty(t("echo then exit"), ["connect", SB], [{ expect: P, send: "echo hi\r" }, { expect: P, send: "exit\r" }], { env });
  pty(t("ctrl-d at prompt"), ["connect", SB], [{ expect: P, send: "\x04" }], { env });
  pty(t("ctrl-c at prompt"), ["connect", SB], [{ expect: P, send: "\x03" }], { env });
  pty(t("ctrl-c twice"), ["connect", SB], [{ expect: P, send: "\x03" }, { expect: P, send: "\x03" }], { env });
  pty(t("ctrl-c then echo"), ["connect", SB], [{ expect: P, send: "\x03" }, { expect: P, send: "echo hi\r" }, { expect: P, send: "exit\r" }], { env });
  pty(t("ctrl-c with partial text"), ["connect", SB], [{ expect: P, send: "ech" }, { expect: "ech", send: "\x03" }, { expect: P, send: "exit\r" }], { env });
  pty(t("ctrl-d with partial text"), ["connect", SB], [{ expect: P, send: "ech" }, { expect: "ech", send: "\x04" }, { expect: "ech", send: "\x04" }], { env });
  pty(t("history up arrow"), ["connect", SB], [{ expect: P, send: "echo one\r" }, { expect: P, send: "echo two\r" }, { expect: P, send: "\x1b[A\x1b[A\r" }, { expect: P, send: "exit\r" }], { env });
  pty(t("history up then edit"), ["connect", SB], [{ expect: P, send: "echo one\r" }, { expect: P, send: "\x1b[A" }, { expect: "echo one", send: "\x7fX\r" }, { expect: P, send: "exit\r" }], { env });
  pty(t("ctrl-a ctrl-e ctrl-k ctrl-u"), ["connect", SB], [{ expect: P, send: "echo abc\x01\x0bXYZ\r" }, { expect: P, send: "echo def\x15echo ghi\r" }, { expect: P, send: "exit\r" }], { env });
  pty(t("ctrl-w ctrl-y"), ["connect", SB], [{ expect: P, send: "echo foo bar\x17\x19\x19\r" }, { expect: P, send: "exit\r" }], { env });
  pty(t("unicode + backspace"), ["connect", SB], [{ expect: P, send: "echo 日本語🎉\x7f\x7f\r" }, { expect: P, send: "exit\r" }], { env });
  pty(t("unicode cursor left"), ["connect", SB], [{ expect: P, send: "echo 日本語\x1b[D\x1b[DX\r" }, { expect: P, send: "exit\r" }], { env });
  pty(t("long line wrap"), ["connect", SB], [{ expect: P, send: `echo ${"abcdefghij".repeat(15)}\r` }, { expect: P, send: "exit\r" }], { env });
  pty(t("very long line"), ["connect", SB], [{ expect: P, send: `echo ${"x".repeat(5000)}\r` }, { expect: P, send: "exit\r" }], { env });
  pty(t("bracketed paste multiline"), ["connect", SB], [{ expect: P, send: "\x1b[200~echo a\necho b\n\x1b[201~\r" }, { expect: P, send: "exit\r" }], { env });
  pty(t("paste multiline raw"), ["connect", SB], [{ expect: P, send: "echo a\recho b\recho c\rexit\r" }], { env });
  pty(t("tab key"), ["connect", SB], [{ expect: P, send: "ec\t\t" }, { expect: "ec", send: "\x03" }, { expect: P, send: "exit\r" }], { env });
  pty(t("escape sequences unknown"), ["connect", SB], [{ expect: P, send: "\x1b[Z\x1b[5~\x1bOP echo q\r" }, { expect: P, send: "exit\r" }], { env });
  pty(t("ctrl-l"), ["connect", SB], [{ expect: P, send: "\x0c" }, { expect: P, send: "exit\r" }], { env });
  pty(t("empty enter"), ["connect", SB], [{ expect: P, send: "\r\r" }, { expect: P, send: "exit\r" }], { env });
  pty(t("ctrl-c during running command"), ["connect", SB], [{ expect: P, send: "sleep 100\r" }, { expect: "sleep 100", delay: 2, send: "\x03" }], { env });
  pty(t("nonexistent command"), ["connect", SB], [{ expect: P, send: "nonexistent-bin\r" }, { expect: P, send: "exit\r" }], { env });
  pty(t("json mode"), ["--json", "connect", SB], [{ expect: P, send: "echo hi\r" }, { expect: P, send: "exit\r" }], { env });
  pty(t("quiet mode"), ["--quiet", "connect", SB], [{ expect: P, send: "echo hi\r" }, { expect: P, send: "exit\r" }], { env });
  pty(t("404"), ["connect", "sbx-nope"], [], { env });
}
// Rich/Click output on a TTY under env permutations
const envs = [{ NO_COLOR: null }, { NO_COLOR: "1" }, { NO_COLOR: "" }, { FORCE_COLOR: "1", NO_COLOR: null }, { FORCE_COLOR: "0", NO_COLOR: null }, { FORCE_COLOR: "", NO_COLOR: null }, { CI: "true", NO_COLOR: null }, { CLICOLOR: "0", NO_COLOR: null }, { CLICOLOR_FORCE: "1", NO_COLOR: null }, { COLORTERM: "truecolor", NO_COLOR: null }, { TERM: "xterm-256color", NO_COLOR: null }, { TERM: "xterm-256color", COLORTERM: "truecolor", NO_COLOR: null }, { TERM: "linux", NO_COLOR: null }, { TERM: "", NO_COLOR: null }, { TERM: null, NO_COLOR: null }, { TERM: "dumb", NO_COLOR: null }, { COLUMNS: "40", NO_COLOR: null, TERM: "xterm" }, { COLUMNS: "300", NO_COLOR: null, TERM: "xterm" }, { COLUMNS: "10", NO_COLOR: null, TERM: "xterm" }, { LINES: "5", NO_COLOR: null, TERM: "xterm" }, { TTY_COMPATIBLE: "1", NO_COLOR: null, TERM: "xterm" }, { TERM_PROGRAM: "vscode", NO_COLOR: null, TERM: "xterm" }, { WT_SESSION: "x", NO_COLOR: null, TERM: "xterm" }, { JUPYTER_COLUMNS: "20", NO_COLOR: null }, { ABX_NO_COLOR: "1", NO_COLOR: null }];
for (const env of envs) {
  const nm = JSON.stringify(env);
  for (const argv of [["list"], ["info", SB], ["--help"], ["info", "sbx-nope"], ["exec", SB, "echo hi"], ["--no-color", "list"], ["--json", "list"], ["--quiet", "list"], ["--ci", "list"], ["--verbose", "list"], ["kill", SB], ["config", "list"], ["template", "list"], ["sandbox", "files", "list", SB], ["sandbox", "system", "info", SB]]) {
    const steps = argv[0] === "kill" ? [{ expect: "[y/N]", send: "y\r" }] : [];
    pty(`tty env ${nm} :: ${argv.join(" ")}`, argv, steps, { env });
  }
}
const diffs = await runAll(cases, { jobs: Number(argOf("--jobs") ?? 4), only: argOf("--only") });
process.exitCode = diffs.length ? 1 : 0;
