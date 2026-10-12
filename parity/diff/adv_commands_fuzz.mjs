#!/usr/bin/env node
/**
 * ADV-commands: auto-generated option-parsing fuzz. Walks the oracle's full command/option metadata
 * (adv_commands_meta_dump.py) and, for every command and every option, builds argv variants (missing value, `--o=v`,
 * invalid typed values, abbreviations, clusters, `--`, duplicates, env vars) and diffs oracle vs Node
 * (exit code, stdout, stderr, stub wire log).
 *
 *   ORACLE_VENV=... node parity/diff/adv_commands_fuzz.mjs [--only substr] [--jobs N] [--limit N]
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ORACLE_VENV, argOf, requireOracle, runAll } from "./adv_commands_lib.mjs";

requireOracle();
const HERE = dirname(fileURLToPath(import.meta.url));
const home0 = mkdtempSync(join(tmpdir(), "ebx-advmeta-"));
const dump = spawnSync(join(ORACLE_VENV, "bin", "python"), [join(HERE, "adv_commands_meta_dump.py")], {
  env: { PATH: process.env.PATH, HOME: home0, EBX_NO_KEYCHAIN: "1" }, encoding: "utf8", maxBuffer: 1 << 28,
});
const tree = JSON.parse(dump.stdout);

// commands that block, prompt forever, call docker/ACR, or write into the real world are skipped
const SKIP = new Set(["connect", "sandbox connect", "mcp start", "deploy", "template build", "template deploy", "template push", "template install", "install", "mcp deploy", "init", "template init", "create", "sandbox create", "config init"]);
const BAD_INT = ["abc", "-5", "1.5", "99999999999999999999", " 7 ", "0x10", "1_0", "٣", "+3", "", "0", "1e3"];
const BAD_FLOAT = ["abc", "nan", "inf", "-1", "1_0.5", "1e400"];

const cases = [];
const add = (name, argv, extra = {}) => cases.push({ name, argv, ...extra });
const flat = [];
(function walk(c, p) { flat.push([p, c]); for (const [n, s] of Object.entries(c.commands ?? {})) walk(s, [...p, n]); })(tree, []);

const sample = (q) => {
  if (q.type.name === "choice") return q.type.choices[0];
  if (q.type.name === "integer") return "3";
  if (q.type.name === "float") return "2.5";
  if (q.type.name === "path") return "somefile";
  return q.name === "sandbox_id" ? "sbx-ev-001" : "val";
};
const positional = (c) => c.params.filter((q) => q.param_type_name === "argument");
const baseArgs = (c) => positional(c).filter((q) => q.required).map(sample);

for (const [p, c] of flat) {
  const key = p.join(" ");
  if (SKIP.has(key) || p.length === 0) continue;
  const pre = p;
  const opts = c.params.filter((q) => q.param_type_name === "option" && q.opts.length && q.name !== "help");
  const base = baseArgs(c);
  add(`${key}: base`, [...pre, ...base]);
  add(`${key}: no args`, [...pre]);
  add(`${key}: extra positional`, [...pre, ...base, "EXTRA"]);
  add(`${key}: -- separator`, [...pre, "--", ...base]);
  add(`${key}: -- then opt-like`, [...pre, ...base, "--", "--json"]);
  add(`${key}: -h after args`, [...pre, ...base, "-h"]);
  add(`${key}: --help=x`, [...pre, "--help=x"]);
  add(`${key}: --hel (abbrev)`, [...pre, "--hel"]);
  add(`${key}: -hh`, [...pre, "-hh"]);
  add(`${key}: global opt after cmd`, [...pre, ...base, "--json"]);
  add(`${key}: global opt --timeout after cmd`, [...pre, ...base, "--timeout", "5"]);
  add(`${key}: unknown opt`, [...pre, ...base, "--nonexistent"]);
  add(`${key}: unknown short`, [...pre, ...base, "-Z"]);
  add(`${key}: unknown opt=v`, [...pre, ...base, "--nonexistent=1"]);
  add(`${key}: lone dash arg`, [...pre, "-", ...base.slice(1)]);
  add(`${key}: empty-string arg`, [...pre, "", ...base.slice(1)]);
  add(`${key}: unicode arg`, [...pre, "日本語🎉", ...base.slice(1)]);
  add(`${key}: negative number arg`, [...pre, "-1", ...base.slice(1)]);
  add(`${key}: negative number arg2`, [...pre, ...base.slice(0, 1), "-1", ...base.slice(2)]);
  for (const q of opts) {
    const o = q.opts.find((x) => x.startsWith("--")) ?? q.opts[0];
    const shorts = q.opts.filter((x) => /^-[^-]$/.test(x));
    const isFlag = q.is_flag;
    const tag = `${key}: ${o}`;
    if (isFlag) {
      add(`${tag} flag`, [...pre, ...base, o]);
      add(`${tag} flag twice`, [...pre, ...base, o, o]);
      add(`${tag} flag =v`, [...pre, ...base, `${o}=1`]);
      add(`${tag} flag =`, [...pre, ...base, `${o}=`]);
      if (q.secondary_opts.length) add(`${tag} secondary`, [...pre, ...base, q.secondary_opts[0]]);
      for (const s of shorts) { add(`${tag} short ${s}`, [...pre, ...base, s]); add(`${tag} short cluster ${s}${s}`, [...pre, ...base, `${s}${s}`]); add(`${tag} short ${s}x`, [...pre, ...base, `${s}x`]); }
    } else {
      add(`${tag} missing value`, [...pre, ...base, o]);
      add(`${tag} =empty`, [...pre, ...base, `${o}=`]);
      add(`${tag} space ok`, [...pre, ...base, o, sample(q)]);
      add(`${tag} =ok`, [...pre, ...base, `${o}=${sample(q)}`]);
      add(`${tag} value looks like option`, [...pre, ...base, o, "--json"]);
      add(`${tag} value looks like short`, [...pre, ...base, o, "-x"]);
      add(`${tag} value is --`, [...pre, ...base, o, "--"]);
      add(`${tag} twice`, [...pre, ...base, o, sample(q), o, sample(q)]);
      add(`${tag} abbreviation`, [...pre, ...base, o.slice(0, Math.max(3, o.length - 2)), sample(q)]);
      add(`${tag} uppercase`, [...pre, ...base, o.toUpperCase(), sample(q)]);
      add(`${tag} unicode`, [...pre, ...base, o, "日本語🎉"]);
      add(`${tag} value with spaces`, [...pre, ...base, o, "a b  c"]);
      if (q.type.name === "integer") for (const v of BAD_INT) add(`${tag} int ${JSON.stringify(v)}`, [...pre, ...base, o, v]);
      if (q.type.name === "float") for (const v of BAD_FLOAT.concat(BAD_INT)) add(`${tag} float ${JSON.stringify(v)}`, [...pre, ...base, o, v]);
      if (q.type.name === "choice") for (const v of [q.type.choices[0].toUpperCase(), "bogus", q.type.choices[0].slice(0, 2), " " + q.type.choices[0]]) add(`${tag} choice ${JSON.stringify(v)}`, [...pre, ...base, o, v]);
      for (const s of shorts) { add(`${tag} short ${s} v`, [...pre, ...base, s, sample(q)]); add(`${tag} short ${s}v`, [...pre, ...base, `${s}${sample(q)}`]); add(`${tag} short ${s}=v`, [...pre, ...base, `${s}=${sample(q)}`]); }
      if (q.envvar) {
        const envs = Array.isArray(q.envvar) ? q.envvar : [q.envvar];
        for (const e of envs) {
          add(`${tag} env ${e}`, [...pre, ...base], { env: { [e]: sample(q) } });
          add(`${tag} env empty ${e}`, [...pre, ...base], { env: { [e]: "" } });
          if (q.type.name === "integer") add(`${tag} env bad int ${e}`, [...pre, ...base], { env: { [e]: "xyz" } });
        }
      }
    }
  }
  // required options missing in combinations
  const req = opts.filter((q) => q.required);
  if (req.length) add(`${key}: only first required`, [...pre, ...base, req[0].opts[0], sample(req[0])]);
  if (req.length > 1) add(`${key}: all required`, [...pre, ...base, ...req.flatMap((q) => [q.opts[0], sample(q)])]);
}
// Root-level global option combinations
const G = [["--json"], ["-j"], ["--quiet"], ["-q"], ["--verbose"], ["-V"], ["--no-color"], ["--ci"], ["--log-level", "debug"], ["--log-level", "DEBUG"], ["--log-level=info"], ["--log-level"], ["--timeout", "0"], ["--timeout", "-1"], ["--timeout=5"], ["--timeout", "abc"], ["--timeout", "1.5"], ["--profile", "x"], ["--profile"], ["--profile="], ["--version"], ["--vers"], ["--jso"], ["-jq"], ["-jqV"], ["-qj"], ["-jx"], ["-jtimeout"], ["--json", "--json"], ["--json=1"], ["--help"], ["-h"], ["-h", "list"], ["--json", "--help"], ["--"], ["--", "list"], ["-"], [""], ["list", "--"], ["--timeout", "--json"], ["--timeout=--json"], ["--profile", "--json", "list"], ["-j", "-q", "-V", "--ci", "--no-color", "list"]];
for (const g of G) {
  add(`root: ${JSON.stringify(g)}`, [...g]);
  add(`root: ${JSON.stringify(g)} list`, [...g, "list"]);
  add(`root: ${JSON.stringify(g)} info`, [...g, "info", "sbx-ev-001"]);
}
for (const e of [{ CI: "true" }, { CI: "" }, { CI: "0" }, { EBX_CI: "1" }, { EBX_JSON: "1" }, { EBX_QUIET: "1" }, { NO_COLOR: "" }, { FORCE_COLOR: "1" }, { EBX_LOG_LEVEL: "DEBUG" }, { EBX_TIMEOUT: "3" }, { EBX_PROFILE: "p" }, { GITHUB_ACTIONS: "true" }, { TERM: "xterm" }, { COLUMNS: "20" }, { COLUMNS: "abc" }, { COLUMNS: "0" }, { LANG: "C", LC_ALL: "C" }]) {
  for (const a of [["list"], ["--json", "list"], ["info", "sbx-nope"], ["--help"], ["info", "sbx-ev-001"]]) add(`env ${JSON.stringify(e)} ${a.join(" ")}`, a, { env: e });
}
const lim = Number(argOf("--limit") ?? 1e9);
const diffs = await runAll(cases.slice(0, lim), { jobs: Number(argOf("--jobs") ?? 6), only: argOf("--only") });
process.exitCode = diffs.length ? 1 : 0;
