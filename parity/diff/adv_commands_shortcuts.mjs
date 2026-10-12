#!/usr/bin/env node
/**
 * ADV-commands: [shortcuts] handling in ~/.ebx/config.toml (aliases, collisions, invalid targets, odd TOML shapes,
 * cycles/recursion attempts, reserved names, unicode, whitespace, non-string values) and root-group edge behaviours
 * (no args, unknown command hints, abbreviations of commands, help listing). Oracle vs Node.
 *   ORACLE_VENV=... node parity/diff/adv_commands_shortcuts.mjs [--only substr] [--jobs N]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argOf, requireOracle, runAll } from "./adv_commands_lib.mjs";
requireOracle();
const cases = [];
const cfg = (toml) => (home) => { mkdirSync(join(home, ".ebx"), { recursive: true }); writeFileSync(join(home, ".ebx", "config.toml"), toml); };
const T = {
  default: null,
  empty: "",
  emptySection: "[shortcuts]\n",
  remap: '[shortcuts]\nls = "sandbox list"\nl = "list"\n',
  remapInfo: '[shortcuts]\ninfo = "sandbox list"\n',
  reserved: '[shortcuts]\nsandbox = "sandbox list"\nconfig = "sandbox list"\nmcp = "template list"\ntemplate = "sandbox list"\n',
  invalid: '[shortcuts]\nfoo = "nonexistent cmd"\nbar = "ebx template init"\nbaz = "ebx"\nqux = "ebx nothing"\n',
  upper: '[shortcuts]\nLS = "sandbox list"\nLs = "SANDBOX LIST"\n',
  spaces: '[shortcuts]\nls = "  sandbox   list  "\nls2 = "sandbox\\tlist"\n',
  unicode: '[shortcuts]\n"列表" = "sandbox list"\n"🚀" = "sandbox info"\n',
  emptyAlias: '[shortcuts]\n"" = "sandbox list"\n',
  dashAlias: '[shortcuts]\n"--json" = "sandbox list"\n"-x" = "sandbox list"\n"a b" = "sandbox list"\n',
  nonStr: "[shortcuts]\nn1 = 5\nn2 = true\nn3 = [\"sandbox list\"]\nn4 = { a = 1 }\nn5 = 1.5\n",
  list: 'shortcuts = ["a"]\n',
  strSection: 'shortcuts = "sandbox list"\n',
  dotted: 'shortcuts.ls = "sandbox list"\n',
  inlineTable: 'shortcuts = { ls = "sandbox list", ll = "list" }\n',
  helpAlias: '[shortcuts]\nhelp = "sandbox list"\nversion = "sandbox list"\n',
  selfRef: '[shortcuts]\nls = "ls"\nlist = "list"\ninfo = "info"\n',
  cycle: '[shortcuts]\na = "b"\nb = "a"\n',
  allTargets: '[shortcuts]\nfl = "sandbox files list"\npl = "process list"\nsi = "sandbox system info"\ntb = "template build"\nts = "template search"\nsl = "sandbox list"\npl2 = "sandbox process list"\n',
  corrupt: "[shortcuts\nls = 1\n",
  corrupt2: "\x00\x01garbage",
  badUtf8: null,
  dup: '[shortcuts]\nls = "sandbox list"\nls = "sandbox info"\n',
  longTarget: '[shortcuts]\nls = "' + "sandbox list ".repeat(500) + '"\n',
  bom: "\ufeff[shortcuts]\nls = \"sandbox list\"\n",
  crlf: '[shortcuts]\r\nls = "sandbox list"\r\n',
};
for (const [n, toml] of Object.entries(T)) {
  const setup = n === "badUtf8" ? (home) => { mkdirSync(join(home, ".ebx"), { recursive: true }); writeFileSync(join(home, ".ebx", "config.toml"), Buffer.from([0xff, 0xfe, 0x5b, 0x73, 0x80])); } : toml === null ? undefined : cfg(toml);
  const base = { setup, tree: true };
  for (const argv of [[], ["--help"], ["ls"], ["l"], ["LS"], ["列表"], ["🚀", "sbx-ev-001"], ["a"], ["b"], ["help"], ["version"], ["fl", "sbx-ev-001"], ["pl", "sbx-ev-001"], ["si", "sbx-ev-001"], ["tb", "--help"], ["sl"], ["sandbox", "--help"], ["info", "sbx-ev-001"], ["list"], ["--json", "list"], ["config", "list"], ["config", "get", "shortcuts"], ["a b"], ["-x"], ["foo"], ["bar"], ["--", "ls"]]) {
    cases.push({ name: `${n} :: ${JSON.stringify(argv)}`, argv, ...base });
  }
}
// root unknown-command hints and prefix behaviours
for (const w of ["lst", "lis", "listt", "crete", "sandbx", "tempalte", "conf", "confg", "mcpp", "exe", "exec1", "kil", "inf", "INFO", "List", "dep", "deplo", "sandbox-", "s", "x", "abcdefghijklmnopqrstuvwxyz", "list ", " list", "list\n", "上传", "up", "downlod", "runn", "conect", "templat", "tem", "ini", "instal", "ebx", "ebx list", "sandbox list", "help", "--help", "-h", "?", "/", "."]) {
  cases.push({ name: `unknown ${JSON.stringify(w)}`, argv: [w] });
  cases.push({ name: `unknown ${JSON.stringify(w)} json`, argv: ["--json", w] });
  cases.push({ name: `unknown ${JSON.stringify(w)} args`, argv: [w, "x", "--y"] });
}
for (const w of ["sandbox", "config", "mcp", "template", "sandbox files", "sandbox process", "sandbox system"]) {
  for (const x of ["lst", "lis", "bogus", "LIST", "l", "-x", "--json", "-h", "help", "", "--", "list "]) cases.push({ name: `sub ${w} ${JSON.stringify(x)}`, argv: [...w.split(" "), x] });
}
const diffs = await runAll(cases, { jobs: Number(argOf("--jobs") ?? 8), only: argOf("--only") });
process.exitCode = diffs.length ? 1 : 0;
