#!/usr/bin/env node
/**
 * ADV-commands: process-level behaviour: closed / full / broken stdout & stderr, SIGPIPE, big output, stdin variants,
 * signals (SIGINT/SIGTERM/SIGHUP) during a hanging request, REPL (`connect`) driven through pipes, locale/encoding.
 * Oracle vs Node (exit code incl. signal, stdout, stderr, wire).
 *   ORACLE_VENV=... node parity/diff/adv_commands_proc.mjs [--only substr] [--jobs N]
 */
import { argOf, requireOracle, runAll } from "./adv_commands_lib.mjs";
requireOracle();
const SB = "sbx-ev-001";
const cases = [];
const sh = (name, shell, extra = {}) => cases.push({ name, argv: [], shell, ...extra });
const bigWorld = () => {
  const sandboxes = {};
  for (let i = 0; i < 400; i++) sandboxes[`sbx-${i}`] = { sandboxID: `sbx-${i}`, templateID: "base", state: "running", cpuCount: 2, memoryMB: 2048, startedAt: "2026-01-02T03:04:05Z", endAt: "2026-01-02T03:09:05Z", envdVersion: "0.5.2", metadata: {} };
  return { sandboxes };
};
for (const cmd of [`list`, `--json list`, `--json info ${SB}`, `info ${SB}`, `exec ${SB} 'echo hi'`, `--json exec ${SB} 'echo hi'`, `--quiet list`, `config list`, `--help`, `list --limit 1000`, `kill ${SB} --yes`, `info sbx-nope`, `bogus`]) {
  const w = bigWorld();
  const base = { world: w };
  sh(`stdout closed: ${cmd}`, `eval "$EBX ${cmd}" >&-; echo "rc=$?" >&2`, base);
  sh(`stderr closed: ${cmd}`, `eval "$EBX ${cmd}" 2>&-; echo "rc=$?"`, base);
  sh(`both closed: ${cmd}`, `eval "$EBX ${cmd}" >&- 2>&-; echo "rc=$?" > /dev/tty 2>/dev/null || echo rc=$? >> rc.txt; cat rc.txt`, base);
  sh(`stdout full: ${cmd}`, `eval "$EBX ${cmd}" >/dev/full; echo "rc=$?"`, base);
  sh(`stderr full: ${cmd}`, `eval "$EBX ${cmd}" 2>/dev/full; echo "rc=$?"`, base);
  sh(`stdout pipe head -c1: ${cmd}`, `eval "$EBX ${cmd}" | head -c1 >/dev/null; echo "rc=\${PIPESTATUS[0]}"`, base);
  sh(`stdout pipe head -n1: ${cmd}`, `eval "$EBX ${cmd}" | head -n1; echo "rc=\${PIPESTATUS[0]}"`, base);
  sh(`stderr pipe closed early: ${cmd}`, `eval "$EBX ${cmd}" 2>&1 >/dev/null | head -c1; echo "rc=\${PIPESTATUS[0]}"`, base);
  sh(`stdin closed: ${cmd}`, `eval "$EBX ${cmd}" <&-; echo "rc=$?"`, base);
  sh(`stdin /dev/null: ${cmd}`, `eval "$EBX ${cmd}" </dev/null; echo "rc=$?"`, base);
  sh(`stdin dir: ${cmd}`, `eval "$EBX ${cmd}" <.; echo "rc=$?"`, base);
}
// big output
sh("exec 100KB arg", `eval "$EBX exec ${SB} 'echo $(head -c 100000 /dev/zero | tr '\\0' a)'" | wc -c`);
sh("exec unicode out", `$(echo true); eval "$EBX exec ${SB} 'echo 日本語🎉 é'"`);
// locale / encoding
for (const env of [{ LANG: "C", LC_ALL: "C" }, { LANG: "POSIX", LC_ALL: "POSIX" }, { LC_ALL: "en_US.ISO-8859-1" }, { PYTHONIOENCODING: "ascii" }, { PYTHONUTF8: "0", LC_ALL: "C" }, { LANG: "zh_CN.GBK", LC_ALL: "zh_CN.GBK" }, { LC_ALL: "" , LANG: ""}]) {
  for (const argv of [["exec", SB, "echo 日本語🎉 é"], ["--json", "exec", SB, "echo 日本語🎉 é"], ["list"], ["--help"], ["info", "sbx-é"], ["config", "list"], ["template", "list"]]) cases.push({ name: `locale ${JSON.stringify(env)} ${argv.join(" ")}`, argv, env });
}
// args with invalid UTF-8 / surrogate-escapes
sh("invalid utf8 argv", `eval "$EBX info $'sbx-\\xff\\xfe'"; echo rc=$?`);
sh("invalid utf8 exec", `eval "$EBX exec ${SB} $'echo \\xff'"; echo rc=$?`);
// stdin variants for exec (stdin never forwarded)
sh("exec stdin piped data", `printf 'abc\\n' | eval "$EBX exec ${SB} 'echo hi'"; echo rc=$?`);
// signals during hanging request
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT", "SIGUSR1"]) {
  for (const [label, argv] of [["exec", ["exec", SB, "sleep 100"]], ["json exec", ["--json", "exec", SB, "sleep 100"]], ["list-hang", ["list"]]]) {
    cases.push({
      name: `signal ${sig} during ${label}`, argv, timeoutMs: 40000,
      world: label === "list-hang" ? { faults: {} } : {},
      onSpawn: (child) => setTimeout(() => child.kill(sig), 4500),
    });
  }
}
// REPL through pipes
const SBN = SB;
const repl = (name, stdin, extra = {}) => cases.push({ name: `repl ${name}`, argv: ["connect", SBN], stdin, ...extra });
repl("eof immediately", "");
repl("exit", "exit\n");
repl("quit", "quit\n");
repl("exit no newline", "exit");
repl("echo", "echo hi\nexit\n");
repl("echo no exit", "echo hi\n");
repl("blank lines", "\n\n   \necho hi\n\n");
repl("unicode", "echo 日本語🎉\n");
repl("long line", `echo ${"a".repeat(60000)}\n`);
repl("crlf", "echo hi\r\nexit\r\n");
repl("multi-line paste", "echo a\necho b\necho c\n");
repl("exit with spaces", "  exit  \n");
repl("EXIT upper", "EXIT\n");
repl("nonexistent cmd", "nonexistent-bin\necho after\n");
repl("exit code cmd", "exit 3\necho after\n");
repl("false", "false\n");
repl("ls", "ls\n");
repl("tab/escape chars", "echo \x1b[31mred\x1b[0m\n");
repl("NUL char", "echo a\x00b\n");
repl("invalid utf8 stdin", Buffer.from("echo \xff\xfe\n", "latin1").toString("latin1"));
repl("json mode", "echo hi\n", { argv: ["--json", "connect", SBN] });
repl("quiet mode", "echo hi\n", { argv: ["--quiet", "connect", SBN] });
repl("sandbox 404", "echo hi\n", { argv: ["connect", "sbx-nope"] });
repl("long sandbox id prompt", "echo hi\n", { argv: ["connect", "sbx-ev-001"] });
repl("verbose", "echo hi\n", { argv: ["--verbose", "connect", SBN] });
const diffs = await runAll(cases, { jobs: Number(argOf("--jobs") ?? 4), only: argOf("--only") });
process.exitCode = diffs.length ? 1 : 0;
