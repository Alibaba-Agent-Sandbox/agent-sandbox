#!/usr/bin/env node
/**
 * Adversarial differential for small pure helpers: `base64.b64decode`, `shlex.split/quote/join` + the
 * `_needs_shell_wrap` heuristic, `dotenv_values` (python-dotenv), `coerce`.
 *
 *   ORACLE_VENV=/path/to/venv node parity/diff/adv_core_helpers.mjs [--seed N] [--n N] [--only b64|shlex|dotenv] [--verbose]
 *
 * Exit 0 identical / 1 diffs / 2 oracle absent (skip).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(HERE, "..", "..");
const ORACLE_VENV = process.env.ORACLE_VENV;
if (!ORACLE_VENV || !existsSync(join(ORACLE_VENV, "bin", "python"))) {
  console.log("[adv_core_helpers] ORACLE_VENV not set / absent: skipping");
  process.exit(2);
}
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const SEED = Number(opt("--seed", 7));
const N = Number(opt("--n", 600));
const ONLY = opt("--only", null);
const VERBOSE = args.includes("--verbose");

let st = SEED >>> 0;
const rnd = () => {
  st = (st + 0x6d2b79f5) >>> 0;
  let t = st;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const gen = (alpha, max) => {
  let s = "";
  const n = Math.floor(rnd() * (max + 1));
  for (let i = 0; i < n; i++) s += pick(alpha);
  return s;
};

const B64A = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", "=", "=", "-", "_", " ", "\n", "\r", "\t", "!", "\u00e9", "\u0000"];
const SHA = [..."ab c", "'", '"', "\\", "|", "&", ";", "(", ")", "<", ">", "\n", "\t", "$", "#", "`", "\u00e9", "\u3000", "\u00a0", "{", "}", "*", "~", "=", "\u0000", "\x0b", "\x0c", "\r", "\u2028", "\ud83d\ude00"];
const DEA = [..."ABKXYZ_a09 ", "=", "=", "\n", "\n", '"', "'", "\\", "#", "$", "{", "}", ":", "-", "export ", "\r", "\t", "\u00e9", "\u0000", "`", "n", "\\n", " # c", "${A}", "${B:-d}", "${C-e}", "$A", "\\\"", "\x85", "\x1c", "\u2003"];

const cases = { b64: [], shlex: [], dotenv: [] };
const FIXED_B64 = ["", "=", "==", "A", "AA", "AAA", "AAAA", "AA==", "AA=", "AAA=", "A===", "AAAA=", "AAAA==", "AA==AA==", "AA=A", "A=A=", "Zm9v\nYmFy", "Zm9vYg==\n", "Zm9vYg=", "Zm9vYg===", "=Zg==", "Z=g=", "Zg==Zg==", "-_-_", "Zm9v YmFy", "\u00e9", "Zg\u00e9==", "Zm9v\u0000YmFy", "Z", "ZZZZZ", "ZZZZZZ", "ZZZZZZZ", "AAAAA===", "====", "AAAA====", "A==="];
for (const s of FIXED_B64) cases.b64.push(s);
for (let i = 0; i < N; i++) cases.b64.push(gen(B64A, 14));
const FIXED_SH = ["", " ", "a b", "'a b'", '"a b"', "a 'b", 'a "b', "a\\", "a\\ b", "echo $HOME", "a|b", "a | b", "a||b", "a&&b", "a;b", "(a)", "a>b", "a >> b", "a 2>&1", "echo 'a|b'", 'echo "a;b"', "a #c", "a#c", "'a'\"b\"", "a\\\nb", "ab\\", "\"a\\\"b\"", "\"a\\xb\"", "a\u00a0b", "a\u3000b", "a\x0bb", "a\x0cb", "a\u2028b", "a=1 b", "a\r\nb", "a\u0000b", "\u00e9 b", "echo `x`", "x&", "x &", "&", "&&", ";;", "<(", "a<<<b", "a|&b", "a&|b", "$(x)", "(", ")", "a(b", "'", '"', "\\", "''", '""', "a''b", "a \"\" b", "echo {a,b}", "x > 'a b'", "x\t|\ty", "x \\| y", "x '\\|' y", "x \"\\|\" y"];
for (const s of FIXED_SH) cases.shlex.push(s);
for (let i = 0; i < N; i++) cases.shlex.push(gen(SHA, 14));
const FIXED_DE = ["A=1", "A=1\nB=${A}", "export A=1", "A = 1", "A= 1", "A =1", "A='x y'", 'A="x y"', 'A="x\\ny"', "A='x\\ny'", 'A="x\ny"', "A=x # c", "A=x#c", "A='x'#c", 'A="x" # c', "# c\nA=1", "A", "A=", "=1", "A=1=2", "A=${B:-d}", "A=${B-d}", "B=1\nA=${B:-d}", "A=${A}", "A=$B", "A=\\n", 'A="\\""', "A='\\''", "A=\"it's\"", "A=x\r\nB=y", "A=x\rB=y", "\ufeffA=1", "A=1\u0000", "A=\u00e9", "\u00e9=1", "A.B=1", "A-B=1", "A B=1", "export\tA=1", "export  A=1", "exportA=1", "export A", "A='unterminated", 'A="unterminated', "A='x'\nB=\"y", "A=`x`", "A=\\\nB", "A=x\\\nB=y", "A=\"x\\\ny\"", "  A=1", "\tA=1", "A=1  ", "A=1\t#x", "A='' # x", "A=\"\" x", "A='x' y", "A=${}", "A=${", "A=${B", "A=${B:-${C:-d}}", "A=${B:-d\nB=1", "'A'=1", '"A"=1', "A=1\n\n\nB=2", "A==", "A=\\", "A=\\\\", 'A="\\\\"', "A='\\\\'", 'A="\\a"', "A=\\x"];
for (const s of FIXED_DE) cases.dotenv.push(s);
for (let i = 0; i < N; i++) cases.dotenv.push(gen(DEA, 18));

const PY = String.raw`
import sys, json, base64, shlex, binascii, os, tempfile, logging
logging.disable(logging.CRITICAL)
from dotenv import dotenv_values
cases = json.load(sys.stdin)
PUNCT = frozenset("();<>|&")
def needs(cmd):
    try:
        lex = shlex.shlex(cmd, posix=True, punctuation_chars=True)
        lex.whitespace_split = True
        for token in lex:
            if token and all(c in PUNCT for c in token): return True
    except ValueError: pass
    return False
out = {"b64": [], "shlex": [], "dotenv": []}
for s in cases["b64"]:
    try: out["b64"].append(["ok", base64.b64decode(s).hex()])
    except Exception as e: out["b64"].append(["err", type(e).__name__, str(e)])
for s in cases["shlex"]:
    r = []
    for name, fn in (("split", lambda: shlex.split(s)), ("splitc", lambda: shlex.split(s, comments=True)), ("quote", lambda: shlex.quote(s)), ("join", lambda: shlex.join([s, s + " x"])), ("needs", lambda: needs(s)),
                     ("punct", lambda: list(__import__("shlex").shlex(s, posix=True, punctuation_chars=True)))):
        try: r.append(fn())
        except Exception as e: r.append(["err", type(e).__name__, str(e)])
    out["shlex"].append(r)
d = tempfile.mkdtemp()
for s in cases["dotenv"]:
    p = os.path.join(d, ".env")
    with open(p, "wb") as f: f.write(s.encode("utf-8", "surrogatepass"))
    try: out["dotenv"].append(["ok", [[k, v] for k, v in dotenv_values(p).items()], [[k, v] for k, v in dotenv_values(p, interpolate=False).items()]])
    except Exception as e: out["dotenv"].append(["err", type(e).__name__, str(e)])
print(json.dumps(out, ensure_ascii=True))
`;

const TS = `
import { pyB64Decode } from "${join(CLI_ROOT, "src/protocol/_b64.ts")}";
import { shlexSplit, shlexQuote, shlexJoin, Shlex } from "${join(CLI_ROOT, "src/api/_shlex.ts")}";
import { _needsShellWrap } from "${join(CLI_ROOT, "src/api/commands.ts")}";
import { dotenvValues } from "${join(CLI_ROOT, "src/utils/_dotenv.ts")}";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const cases = JSON.parse(readFileSync(0, "utf8"));
const out = { b64: [], shlex: [], dotenv: [] };
const errName = (e) => (e && e.name) || "Error";
for (const s of cases.b64) {
  try { out.b64.push(["ok", pyB64Decode(s).toString("hex")]); }
  catch (e) { out.b64.push(["err", e.name === "Error" && e.constructor.name === "BinasciiError" ? "Error" : e.constructor.name, e.message]); }
}
for (const s of cases.shlex) {
  const r = [];
  const fns = [() => shlexSplit(s), () => shlexSplit(s, true), () => shlexQuote(s), () => shlexJoin([s, s + " x"]), () => _needsShellWrap(s),
    () => [...new Shlex(s, { posix: true, punctuation_chars: true })]];
  for (const fn of fns) {
    try { r.push(fn()); } catch (e) { r.push(["err", e.constructor.name === "Error" ? "ValueError" : e.constructor.name, e.message]); }
  }
  out.shlex.push(r);
}
const d = mkdtempSync(join(tmpdir(), "advh-"));
for (const s of cases.dotenv) {
  const p = join(d, ".env");
  writeFileSync(p, Buffer.from(s, "utf8"));
  try {
    const a = [...dotenvValues(p).entries()];
    const b = [...dotenvValues(p, { interpolate: false }).entries()];
    out.dotenv.push(["ok", a, b]);
  } catch (e) { out.dotenv.push(["err", e.constructor.name, e.message]); }
}
console.log(JSON.stringify(out).replace(/[^\\x00-\\x7f]/g, (c) => "\\\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")));
`;

const tmp = mkdtempSync(join(tmpdir(), "adv-helpers-"));
const tsFile = join(tmp, "r.mts");
writeFileSync(tsFile, TS);
const input = JSON.stringify(cases);
const py = spawnSync(join(ORACLE_VENV, "bin/python"), ["-c", PY], { input, encoding: "utf8", maxBuffer: 1 << 28 });
if (py.status !== 0) { console.error("oracle failed:", py.stderr.slice(-800)); process.exit(3); }
const ts = spawnSync(join(CLI_ROOT, "node_modules/.bin/tsx"), [tsFile], { input, encoding: "utf8", cwd: CLI_ROOT, maxBuffer: 1 << 28 });
if (ts.status !== 0) { console.error("ts runner failed:", ts.stderr.slice(-1200)); process.exit(3); }
const P = JSON.parse(py.stdout), T = JSON.parse(ts.stdout.trim().split("\n").pop());
rmSync(tmp, { recursive: true, force: true });

let diffs = 0;
const show = (s) => JSON.stringify(s).slice(0, 200);
for (const kind of ["b64", "shlex", "dotenv"]) {
  if (ONLY && ONLY !== kind) continue;
  let kd = 0;
  const seen = new Set();
  for (let i = 0; i < cases[kind].length; i++) {
    const norm = (x) => (kind === "b64" && x[0] === "err" ? [x[0], x[1] === "ValueError" ? "Error" : x[1], x[2]] : x);
    const a = JSON.stringify(norm(P[kind][i])), b = JSON.stringify(norm(T[kind][i]));
    if (a === b) continue;
    kd++;
    if (kind === "shlex") {
      const pa = P.shlex[i], tb = T.shlex[i];
      const idx = pa.findIndex((x, j) => JSON.stringify(x) !== JSON.stringify(tb[j]));
      const sig = `${["split", "splitc", "quote", "join", "needs", "punct"][idx]}`;
      if (!VERBOSE && seen.has(sig) && seen.size > 0 && kd > 12) continue;
      seen.add(sig);
      console.log(`DIFF ${kind}/${sig} input=${show(cases[kind][i])}\n   py ${show(pa[idx])}\n   ts ${show(tb[idx])}`);
    } else if (VERBOSE || kd <= 15) {
      console.log(`DIFF ${kind} input=${show(cases[kind][i])}\n   py ${show(P[kind][i])}\n   ts ${show(T[kind][i])}`);
    }
  }
  console.log(`[adv_core_helpers] ${kind}: cases=${cases[kind].length} diffs=${kd}`);
  diffs += kd;
}
process.exit(diffs ? 1 : 0);
