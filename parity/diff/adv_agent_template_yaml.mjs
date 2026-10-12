#!/usr/bin/env node
/**
 * Adversarial differential: PyYAML `safe_load` (oracle venv) versus the two YAML loaders of the port
 * (`src/utils/_yaml.ts` used by template install/search/build, `src/agent/_pyyaml.ts` used by codegen/adopt/sandbox).
 * Compares accept/reject (=> exit code and message prefix of every command that reads a manifest) and the loaded value.
 *
 *   ORACLE_VENV=/path/to/venv node --import tsx parity/diff/adv_agent_template_yaml.mjs [--verbose] [--seed N] [--n 1500]
 *
 * Exit 0 = no accept/reject divergence (or oracle absent), 1 = divergences. Value divergences are reported separately and
 * do not fail the run (they are classified in cli/parity/review/agent-template.md).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORACLE_VENV = process.env.ORACLE_VENV;
if (!ORACLE_VENV || !existsSync(join(ORACLE_VENV, "bin", "python"))) {
  console.error("ORACLE_VENV not set; skipping.");
  process.exit(0);
}
const args = process.argv.slice(2);
const argOf = (k, d) => (args.includes(k) ? Number(args[args.indexOf(k) + 1]) : d);
const seed0 = argOf("--seed", 7);
const N = argOf("--n", 1500);
const verbose = args.includes("--verbose");
const dumpAt = args.includes("--dump-corpus") ? args[args.indexOf("--dump-corpus") + 1] : null;

const thin = await import(join(ROOT, "src/utils/_yaml.ts"));
const rich = await import(join(ROOT, "src/agent/_pyyaml.ts"));

let s = seed0 >>> 0;
const rnd = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];

const scalars = [
  "x", "", "~", "null", "Null", "NULL", "true", "True", "TRUE", "false", "yes", "Yes", "YES", "no", "No", "on", "On", "ON", "off", "Off", "y", "Y", "n", "N",
  "0", "1", "-1", "+1", "010", "0o10", "0x1F", "0X1f", "0b101", "0b1_0", "1_000", "1__0", "_1", "1_", "1:30", "1:30:15", "-1:30", "190:20:30", "1:61",
  "1.0", "1.", ".5", "-.5", "+.5", "1e3", "1E3", "1e+3", "1.5e3", "1.5e+3", "1.5E-3", "1e", "e3", "+1e3", "-1e3", "1_0.5", "1.5_5", ".inf", ".Inf", ".INF", "-.inf", "+.inf", "inf", "Infinity", ".nan", ".NaN", ".NAN", "nan", "NaN",
  "1,000", "0.0", "-0", "00", "08", "09", "0_8", "0x", "0xg", "99999999999999999999", "-99999999999999999999", "1e400", "0.1e-400",
  "2026-01-01", "2026-1-1", "2026-01-01 10:00:00", "2026-01-01T10:00:00Z", "2026-01-01T10:00:00+08:00", "2026-01-01 10:00:00.123456", "2026-01-01 10:00:00 +8", "2026-13-01", "2026-02-30", "0000-00-00", "2026-01-01t10:00:00z",
  "=", "<<", "!!str 5", "!!int '5'", "!!int 5", "!!float 5", "!!bool true", "!!null ''", "!!binary aGk=", "!!set {a}", "!!omap [a: 1]", "!!pairs [a: 1]", "!!timestamp 2026-01-01", "!!seq [1]", "!!map {a: 1}", "!!python/none ''", "!!python/tuple [1]", "!custom 5", "!<tag:yaml.org,2002:str> 5", "!!merge x", "!!value x", "!!yaml x",
  "'quoted'", '"dq"', "'it''s'", '"a\\tb"', '"\\x41"', '"\\u00e9"', '"\\U0001F600"', '"\\e"', '"\\N"', '"\\_"', '"\\L"', '"\\P"', '"\\0"', '"\\a\\b\\f\\v\\r"', '"\\/"', '"\\ "', '"\\\n"', '"\\q"', '"\\xZZ"', '"\\ud83d"', '"\\U00110000"', '"a\nb"', "'a\nb'", "'a\n\nb'", '"unterminated', "'unterminated",
  "a b", "a: b", "a #c", "a#c", "#c", "a:b", "a :b", "- a", "-a", "? a", "?a", "[a", "a]", "{a", "a}", "a,b", "[a,b]", "{a: b}", "{a: b, c}", "{a, b}", "{a: }", "[ ]", "{ }", "[,]", "[a,,b]", "{,}", "[a, b,]", "{a: 1,}",
  "|", "|\n  a\n  b", ">\n  a\n  b", "|-\n  a", "|+\n  a\n\n", ">2\n   a", "|0\n a", "|10\n a", "|1\n a", "|-1\n a",
  "&a x", "*a", "&a", "&a &b x", "*a *b", "&a !!str x", "!!str &a x", "& a", "* a", "&a: x",
  "@a", "`a", "%a", "!", "!!", "!x", "|a", ">a", "%", "@", "`", "\\", "a\\b", "a\tb", "\ta", "a\t", "\u00a0a", "a\u00a0", "\u2028", "a\u2028b", "\u0085", "\ufeffa", "a\u0000b", "\u0001", "\u007f", "\u0080", "\u009f", "\ud7ff", "\ue000", "\ufffe", "\uffff", "😀", "𠀀", "模板", "ａ", "é", "e\u0301",
  "---", "...", "--- x", "... x", "-- x", "a ---", "a ...", "%YAML 1.1", "%TAG ! tag:x,2000:", "---\nx", "x\n...\n", "x\n---\ny", "\n\n", "  ", "# only comment", "#c\n#d",
];

const structural = [
  "a: 1\nb: 2\n", "a:\n  b:\n    c: 1\n", "a:\n- 1\n- 2\n", "a:\n  - 1\n  - 2\n", "- a\n- b\n", "- a:\n    b: 1\n", "-\n  - a\n", "- - a\n  - b\n- - c\n", "a: [1, 2,\n  3]\n", "a: {b: 1,\n  c: 2}\n",
  "a: 1\na: 2\n", "a: 1\n a: 2\n", " a: 1\nb: 2\n", "a: 1\n  b: 2\n", "a:\n    b: 1\n  c: 2\n", "a: b: c\n", "a: - b\n", "- a: b\n  c\n", "a:\tb\n", "a:\t b\n", "a: \tb\n", "\ta: b\n", "a:\n\tb: 1\n", "a:\n  b:\t1\n", "a\t: b\n", "a: b\t# c\n", "a: b #c\n", "a: b#c\n", "a:b\n", "a: 'b'c\n", "a: \"b\"c\n", "a: 'b' # c\n",
  "? a\n: b\n", "? [a, b]\n: c\n", "? {a: b}\n: c\n", "? - a\n  - b\n: c\n", "[a, b]: c\n", "{a: b}: c\n", "? a\n", "? a\n? b\n", ": b\n", "? \n: b\n", "!!str : b\n", "- ? a\n  : b\n",
  "a: &x\n  b: 1\nc: *x\n", "a: &x [1, 2]\nc: *x\n", "a: &x 1\nb: &x 2\nc: *x\n", "a: *x\n", "a: &x\n  <<: *x\n", "base: &b {x: 1}\nd:\n  <<: *b\n  y: 2\n", "base: &b {x: 1}\nd:\n  <<: [*b]\n", "base: &b {x: 1}\nd:\n  <<: [*b, {y: 2}]\n", "d:\n  <<: 5\n", "d:\n  <<: [5]\n", "d:\n  <<: [[1]]\n", "d:\n  <<: {x: 1}\n  x: 2\n", "d:\n  x: 2\n  <<: {x: 1}\n", "<<: {a: 1}\n", "a:\n  <<:\n    b: 1\n", "d: {<<: {a: 1}, b: 2}\n", "d: {<<: 1}\n", "? <<\n: {a: 1}\n", "'<<': {a: 1}\n", "\"<<\": 1\n",
  "a: |\n  x\n  y\nb: 1\n", "a: >\n  x\n  y\n\n  z\nb: 1\n", "a: |\nb: 1\n", "a: |\n\n\n", "a: |2\n    x\n", "a: |\n x\n  y\n   z\n", "a: |\n  x\n y\n", "a: >-\n  x\n  y\n", "a: >+\n  x\n\n\n", "a: |  # c\n  x\n", "a: | x\n  y\n",
  "a: 'x\n  y'\n", "a: \"x\n  y\"\n", "a: x\n  y\n", "a: x\n y\n", "a: x\n\n y\n", "a: x\n# c\n y\n", "a: [x\n# c\n y]\n", "a: \"x\\\n  y\"\n", "a: \"x \\\n  y\"\n",
  "a: !!str\nb: 1\n", "a: !!str 1\n", "a: !!int x\n", "a: !!int 1.5\n", "a: !!float x\n", "a: !!bool maybe\n", "a: !!bool 'true'\n", "a: !!null x\n", "a: !!str [a]\n", "a: !!seq {a: b}\n", "a: !!map [a]\n", "a: !!int\n", "a: !!float 1\n", "a: !!float .inf\n", "a: !!timestamp x\n", "a: !!binary '!!'\n", "a: !!binary ab\n", "a: !!binary |\n  aGVsbG8=\n", "a: !!set\n  ? x\n  ? y\n", "a: !!set {x, y}\n", "a: !!set [x]\n", "a: !!omap\n  - x: 1\n  - y: 2\n", "a: !!omap [x]\n", "a: !!omap {x: 1}\n", "a: !!omap\n  - x: 1\n    z: 2\n", "a: !!pairs\n  - x: 1\n  - x: 2\n", "a: !<!foo> 1\n", "a: !foo 1\n", "a: !foo [1]\n", "a: !foo {x: 1}\n", "!!map\na: 1\n", "!!seq\n- 1\n", "%TAG !e! tag:e.com,2000:\n---\na: !e!foo 1\n", "%TAG !e! tag:yaml.org,2002:\n---\na: !e!str 1\n", "%YAML 1.2\n---\na: 1\n", "%YAML 1.1\n---\na: 1\n", "%YAML 2.0\n---\na: 1\n", "%YAML 1.1\n%YAML 1.1\n---\na: 1\n", "%FOO bar\n---\na: 1\n", "%YAML 1.1\na: 1\n", "---\n- a\n---\n- b\n", "--- a\n--- b\n", "a: 1\n...\n", "a: 1\n...\n---\nb: 2\n", "---\n---\n", "...\n", "--- >\n x\n", "--- |\n x\n", "---a\n", "--- !!str\n", "- a\n...\n- b\n", "a: 1\n---\n", "\n---\na: 1\n",
  "a: \"\\x4\"\n", "a: \"\\u00\"\n", "a: \"\\U0000004\"\n", "'a\\n'", "a: 'a\\n'\n", "a: \"tab\\there\"\n",
  `a: ${"[".repeat(120)}${"]".repeat(120)}\n`, `a: ${"{a: ".repeat(60)}1${"}".repeat(60)}\n`, `${"- ".repeat(80)}x\n`, `a: ${"x".repeat(5000)}\n`, `${"k: v\n".repeat(2000)}`, `${Array.from({ length: 400 }, (_, i) => `k${i}: v${i}`).join("\n")}\n`, `a: &a [*a]\n`, `a: &a {b: *a}\n`,
  "a: 1\r\nb: 2\r\n", "a: 1\rb: 2\r", "a: |\r\n  x\r\n  y\r\n", "a: \"x\r\ny\"\n", "a: 'x\ry'\n", "\r\n", "a: 1\n\u2028b: 2\n", "a:\u00a0b\n", "a:\u2003b\n", "\u00a0a: b\n", "a: b\u00a0# c\n",
  "name: 模板\ndescription: 数据\n", "名字: x\n", "😀: x\n", "a: 😀\n", "\"\\ud83d\\ude00\": x\n", "a: \"\\ud83d\\ude00\"\n", "a: \"\\U0001F600\"\n", "a: \"\ud83d\"\n",
  "1: a\n2: b\n", "1.5: a\n", "true: a\n", "null: a\n", "~: a\n", "2026-01-01: a\n", "[1]: a\n", "1: a\n1.0: b\n", "'1': a\n1: b\n", "0x10: a\n0o20: b\n", "on: a\noff: b\n", "y: 1\nn: 2\n", "=: 1\n", "<<: 1\n",
  "a: !!python/object:x.y {}\n", "a: !!python/name:os.system ''\n", "a: !!python/object/apply:os.getcwd []\n", "a: !!python/module:os ''\n", "!!python/tuple [1]\n",
  "key: value # comment\n# full\n  # indented comment\nother: 1\n", "a: b\n#c\n", "a: b\n #c\n", "#c\na: b\n", "a: #c\n  b\n", "a:\n  #c\n  b: 1\n", "a: [ # c\n  1]\n", "[a, # c\n b]\n", "{a: 1, # c\n b: 2}\n",
  "? |\n  x\n: 1\n", "? >\n  x\n: 1\n", "a: ? b\n", "a: ? b\n  : c\n", "- ? a\n- b\n", "{? a : b}\n", "{? a}\n", "[? a]\n", "[? a : b]\n", "[a: b]\n", "[a: b, c: d]\n", "[a: ]\n", "[: a]\n", "{: a}\n", "[\"a\": b]\n", "['a': b]\n", "[a: b: c]\n", "{a: b: c}\n", "[a, b: c, d]\n", "{\"a\":b}\n", "{\"a\": b}\n", "[\"a\":b]\n", "{a:b}\n", "{a:b: c}\n", "[a:b]\n", "{a: b,\n c: d}\n", "{a: b\n, c: d}\n", "[a\n, b]\n", "[\n]\n", "{\n}\n", "[a b, c]\n", "[a, b c]\n", "[a: b c]\n", "{'a' : b}\n", "{'a':b}\n", "{ 'a' : b }\n",
  "- a\n b\n", "- a\n  b\n", "-\ta\n", "-\n\ta\n", "- \ta\n", "-a\n", "- - -\n", "- -\n", "- - \n", "-\n-\n", "- \n- \n", "-\n  a\n", "-  a\n-   b\n", "- a: 1\n  b: 2\n- c: 3\n", "- a: 1\n b: 2\n", "- a\n- b: c\n  d: e\n- [f]\n- {g: h}\n", "- |\n  x\n- >\n  y\n", "- &a x\n- *a\n", "- !!str x\n", "- !!int 5\n",
  "a:\n- b\n- c\nd: e\n", "a:\n- b\n  - c\n", "a:\n  - b\n - c\n", "a:\n - b\n  - c\n", "a:\n- b: 1\n  c: 2\n", "a:\n- b: 1\n c: 2\n", "a:\n -\n  b\n",
  "key: \"value\n  continues\"\nk2: 1\n", "key: 'value\n\n  continues'\nk2: 1\n", "key: \"value\n continues\"\nk2: 1\n", "key: \"value\ncontinues\"\nk2: 1\n", "key: 'value\ncontinues'\nk2: 1\n", "key: [a,\nb]\nk2: 1\n", "key: {a: 1,\nb: 2}\nk2: 1\n", "key: [a,\n  b]\nk2: 1\n",
  "'multi\nline': 1\n", "\"multi\nline\": 1\n", "? 'x\n  y'\n: 1\n", "long key long key long key long key long key long key long key long key long key long key long key: 1\n", `${"k".repeat(2000)}: 1\n`, "a:\n  ? b\n  : c\n", "a: b\n? c\n: d\n", "? a: 1\n: b\n", "? a: 1\n  b: 2\n: c\n", "- ? a: 1\n  : b\n",
];

const alphabet = [":", "-", "?", "[", "]", "{", "}", ",", "#", "&", "*", "!", "|", ">", "'", '"', "%", "@", "`", "\t", " ", "  ", "\n", "\n  ", "\n- ", "\n? ", "a", "1", "~", "<<", "...", "---", ": ", "\\", "\u00a0", "\r", "\u2028", "\u0085", "\ufeff", "\u0000", "\u0001", "\u007f", "\ud800", "&x ", "*x", "!!str ", "!!int ", "!!binary ", "!x ", "%YAML 1.1\n", "%TAG ! tag:x:\n"];
const base = [...structural];
function mutate(seedText) {
  let t = seedText;
  const k = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < k; i += 1) {
    const op = rnd();
    const pos = Math.floor(rnd() * (t.length + 1));
    if (op < 0.45) t = t.slice(0, pos) + pick(alphabet) + t.slice(pos);
    else if (op < 0.7) t = t.slice(0, pos) + t.slice(pos + 1 + Math.floor(rnd() * 3));
    else if (op < 0.85) {
      const lines = t.split("\n");
      const li = Math.floor(rnd() * lines.length);
      lines.splice(li, 0, lines[li] ?? "");
      t = lines.join("\n");
    } else {
      const lines = t.split("\n");
      const li = Math.floor(rnd() * lines.length);
      lines[li] = pick(["", " ", "  ", "\t"]) + (lines[li] ?? "");
      t = lines.join("\n");
    }
  }
  return t;
}

const corpus = [];
for (const sc of scalars) {
  corpus.push(`k: ${sc}\n`, `${sc}\n`, `- ${sc}\n`, `[${sc}]\n`, `{k: ${sc}}\n`, `k:\n  - ${sc}\n`, `? ${sc}\n: v\n`);
}
corpus.push(...structural);
for (let i = 0; i < N; i += 1) corpus.push(mutate(pick(base)));

if (dumpAt) {
  (await import("node:fs")).writeFileSync(dumpAt, JSON.stringify([...new Set(corpus)]));
  console.log(`corpus written to ${dumpAt} (${new Set(corpus).size} unique documents)`);
  process.exit(0);
}

const sentinel = (fn, text) => {
  try {
    return { ok: true, v: fn(text) };
  } catch (e) {
    return { ok: false, err: e?.constructor?.name ?? "Error", msg: String(e?.message ?? e).split("\n")[0].slice(0, 100), full: String(e?.message ?? e) };
  }
};

function canon(v, depth = 0) {
  if (depth > 40) return ["rec"];
  if (v === null || v === undefined) return ["n"];
  if (typeof v === "boolean") return ["b", v];
  if (typeof v === "bigint") return ["num", v.toString()];
  if (typeof v === "number") {
    if (Number.isNaN(v)) return ["num", "nan"];
    if (!Number.isFinite(v)) return ["num", v > 0 ? "inf" : "-inf"];
    return ["num", Number.isInteger(v) && Math.abs(v) < 2 ** 53 ? `${v}.0` : String(v)];
  }
  if (typeof v === "string") return ["s", v];
  if (v instanceof Date) return ["t", "?"];
  if (v instanceof Uint8Array) return ["x", Buffer.from(v).toString("hex")];
  if (v instanceof Set) return ["set", [...v].map((i) => JSON.stringify(canon(i, depth + 1))).sort()];
  if (Array.isArray(v)) return ["l", v.map((i) => canon(i, depth + 1))];
  if (v instanceof Map) return ["d", [...v.entries()].map(([k, x]) => [canon(k, depth + 1), canon(x, depth + 1)])];
  if (v && typeof v === "object") {
    if ("value" in v && typeof v.value === "number" && v.constructor?.name === "PyFloat") return canon(v.value);
    if (v.constructor?.name === "PyDate") return ["t", v.text];
    return ["d", Object.entries(v).map(([k, x]) => [["s", k], canon(x, depth + 1)])];
  }
  return ["?", typeof v];
}

const py = JSON.parse(
  spawnSync(join(ORACLE_VENV, "bin", "python"), [join(ROOT, "parity/diff/adv_agent_template_yaml_oracle.py")], { input: JSON.stringify(corpus), maxBuffer: 1 << 28 }).stdout.toString(),
);

const loaders = { thin: thin.safeLoad, rich: (t) => rich.safeLoadRich(t) };
let acceptDiffs = 0;
let valueDiffs = 0;
let messageDiffs = 0;
const tag = (v) => (v[0] === "num" ? "num" : v[0]);
const looseEq = (a, b) => {
  if (a[0] === "t" && b[0] === "t") return a[1] === "?" || b[1] === "?" || a[1] === b[1];
  if (a[0] !== b[0]) return false;
  if (a[0] === "l") return a[1].length === b[1].length && a[1].every((x, i) => looseEq(x, b[1][i]));
  if (a[0] === "d") return a[1].length === b[1].length && a[1].every(([k, x], i) => keyEq(k, b[1][i][0]) && looseEq(x, b[1][i][1]));
  return JSON.stringify(a) === JSON.stringify(b);
};
const keyEq = (a, b) => {
  const flat = (k) => (k[0] === "s" ? k[1] : k[0] === "num" ? k[1].replace(/\.0$/, "") : k[0] === "b" ? String(k[1]) : k[0] === "n" ? "null" : JSON.stringify(k));
  return flat(a) === flat(b);
};
const seen = new Set();
for (const [name, fn] of Object.entries(loaders)) {
  corpus.forEach((text, i) => {
    const ora = py[i];
    const got = sentinel(fn, text);
    const key = `${name}|${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (ora.ok !== got.ok) {
      acceptDiffs += 1;
      console.log(`ACCEPT[${name}] ${JSON.stringify(text.length > 160 ? `${text.slice(0, 160)}...` : text)}  py=${ora.ok ? "ok" : `ERR ${ora.err}`} node=${got.ok ? "ok" : `ERR ${got.msg}`}`);
    } else if (!ora.ok && !got.ok && ora.msg !== got.full && name === "rich") {
      messageDiffs += 1;
      if (verbose || messageDiffs <= 20) console.log(`MESSAGE[${name}] ${JSON.stringify(text.length > 100 ? `${text.slice(0, 100)}...` : text)}\n   py=${ora.err}: ${JSON.stringify(ora.msg)}\n   js=${got.err}: ${JSON.stringify(got.full)}`);
    } else if (ora.ok && !looseEq(ora.v, canon(got.v))) {
      valueDiffs += 1;
      if (verbose || valueDiffs <= 60) console.log(`VALUE[${name}] ${JSON.stringify(text.length > 120 ? `${text.slice(0, 120)}...` : text)}\n   py=${JSON.stringify(ora.v).slice(0, 200)}\n   js=${JSON.stringify(canon(got.v)).slice(0, 200)}`);
    }
  });
}
console.log(`corpus=${corpus.length} accept/reject divergences=${acceptDiffs} value divergences=${valueDiffs} error-text divergences (rich)=${messageDiffs}`);
process.exit(acceptDiffs === 0 ? 0 : 1);
