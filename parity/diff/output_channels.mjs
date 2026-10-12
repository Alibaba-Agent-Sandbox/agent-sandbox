#!/usr/bin/env node
/**
 * Differential test of `OutputManager` (info / success / warning / error / debug / data / progress and the stdlib logging
 * bridge) and `OutputFormatter` against the original Python implementation, across the mode matrix
 * (plain / --json / --quiet / --verbose / --ci / --no-color / --log-level, TTY vs pipe on each stream) and values of every
 * JSON-representable shape. stdout and stderr are compared separately, in-process on both sides.
 *
 *   ORACLE_VENV=/path/to/venv node parity/diff/output_channels.mjs [--verbose]
 *
 * Exit code 0 = identical, 1 = differences, 2 = oracle missing.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORACLE_VENV = process.env.ORACLE_VENV;
const verbose = process.argv.includes("--verbose");

if (!ORACLE_VENV || !existsSync(join(ORACLE_VENV, "bin", "python"))) {
  console.error("ORACLE_VENV must point to a venv with the original easy-sandbox installed (see docs/PORTING.md).");
  process.exit(2);
}

const MODES = [
  {},
  { json_mode: true },
  { quiet: true },
  { verbose: true },
  { ci: true },
  { no_color: true },
  { log_level: "debug" },
  { log_level: "INFO" },
  { log_level: "nonsense" },
  { json_mode: true, quiet: true },
  { json_mode: true, verbose: true },
  { quiet: true, verbose: true },
];
const VALUES = [
  null, "plain string", "", "multi\nline", "日本語", { a: 1, bb: "x", ccc: null }, {}, [], ["a", "b"], [1, 2, null, true], [[1], { k: "v" }],
  { nested: { list: [1, "two", null, false], s: "é" }, n: 0.5, big: 12345678901234, neg: -3 }, 42, 0.25, true, false, "[bold]markup[/bold]", { "key with space": "v", k2: ["x"] },
  { a: [], b: {}, c: "" }, { "日本": "語" }, ["\u001b[31mred\u001b[0m"],
];
const MESSAGES = ["hello", "", "multi\nline", "日本語 message", "[bold]not markup[/bold]", "100% done %s %d", "tab\there", "\u001b[31mansi\u001b[0m"];

const cases = [];
for (const mode of MODES) {
  for (const ttyOut of [false, true]) {
    for (const ttyErr of [false, true]) {
      cases.push({ mode, ttyOut, ttyErr });
    }
  }
}

const PY = String.raw`
import io, json, logging, os, sys
from easy_sandbox.cli.output import OutputManager
from easy_sandbox.cli.formatters import OutputFormatter

class Buf(io.StringIO):
    def __init__(self, tty): super().__init__(); self._tty = tty
    def isatty(self): return self._tty

spec = json.load(open(sys.argv[1]))
VALUES, MESSAGES = spec["values"], spec["messages"]
res = []
for c in spec["cases"]:
    out, err = Buf(c["ttyOut"]), Buf(c["ttyErr"])
    so, se = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = out, err
    steps = []
    try:
        om = OutputManager(**c["mode"])
        def step(name, fn):
            try:
                fn()
            except Exception as e:
                steps.append(name + " raised " + type(e).__name__ + ": " + str(e))
        for m in MESSAGES:
            step("info", lambda: om.info(m))
            step("success", lambda: om.success(m))
            step("warning", lambda: om.warning(m))
            step("error", lambda: om.error(m))
            step("error+", lambda: om.error(m, code="E1234", suggestion="try " + m))
            step("debug", lambda: om.debug(m))
            step("progress", lambda: om.progress(m))
        for v in VALUES:
            step("data", lambda: om.data(v))
        step("table", lambda: om.table(["A", "B"], [["1", "x"], ["22", "日本"]]))
        for name in ("easy_sandbox.transport.http", "other.lib"):
            lg = logging.getLogger(name)
            for lvl in ("debug", "info", "warning", "error", "critical"):
                step("log-" + lvl, lambda: getattr(lg, lvl)("record %s %d", "arg", 7))
        om.set_verbose(True)
        step("debug-after-verbose", lambda: om.debug("after verbose"))
        step("log-after-verbose", lambda: logging.getLogger("easy_sandbox.x").debug("dbg after verbose"))
        om.set_verbose(False)
        step("log-after-unverbose", lambda: logging.getLogger("easy_sandbox.x").info("info after unverbose"))
        fm = OutputFormatter(use_json=c["mode"].get("json_mode", False), quiet=c["mode"].get("quiet", False), no_color=c["mode"].get("no_color", False))
        for m in MESSAGES:
            step("f.success", lambda: fm.print_success(m))
            step("f.error", lambda: fm.print_error(m))
            step("f.error+", lambda: fm.print_error(m, suggestion="s " + m, code="E9"))
        for v in VALUES:
            if isinstance(v, dict):
                step("f.dict", lambda: fm.print_dict(v))
            step("f.data", lambda: fm.print_data(v))
    finally:
        sys.stdout, sys.stderr = so, se
        for h in list(logging.getLogger().handlers):
            logging.getLogger().removeHandler(h)
    res.append({"out": out.getvalue(), "err": err.getvalue(), "steps": steps})
json.dump(res, sys.stdout)
`;

const TS = `
import { readFileSync } from "node:fs";
import { OutputFormatter } from ${JSON.stringify(pathToFileURL(join(CLI_ROOT, "src/cli/formatters.ts")).href)};
import { OutputManager } from ${JSON.stringify(pathToFileURL(join(CLI_ROOT, "src/cli/output.ts")).href)};
import { sys } from ${JSON.stringify(pathToFileURL(join(CLI_ROOT, "src/framework/io.ts")).href)};
import { logging } from ${JSON.stringify(pathToFileURL(join(CLI_ROOT, "src/utils/logging.ts")).href)};

class Buf { chunks = []; constructor(tty) { this.tty = tty; } write(t) { this.chunks.push(t); } flush() {} isatty() { return this.tty; } getvalue() { return this.chunks.join(""); } }
const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
const { values: VALUES, messages: MESSAGES } = spec;
const res = [];
const ename = (e) => (e && e.constructor && e.constructor.name) || "Error";
for (const c of spec.cases) {
  const out = new Buf(c.ttyOut), err = new Buf(c.ttyErr);
  const so = sys.stdout, se = sys.stderr;
  sys.stdout = out; sys.stderr = err;
  const steps = [];
  try {
    const m = c.mode;
    const om = new OutputManager({ verbose: m.verbose ?? false, quiet: m.quiet ?? false, json_mode: m.json_mode ?? false, no_color: m.no_color ?? false, ci: m.ci ?? false, log_level: m.log_level ?? null });
    const step = (name, fn) => { try { fn(); } catch (e) { steps.push(name + " raised " + ename(e) + ": " + e.message); } };
    for (const msg of MESSAGES) {
      step("info", () => om.info(msg));
      step("success", () => om.success(msg));
      step("warning", () => om.warning(msg));
      step("error", () => om.error(msg));
      step("error+", () => om.error(msg, { code: "E1234", suggestion: "try " + msg }));
      step("debug", () => om.debug(msg));
      step("progress", () => om.progress(msg));
    }
    for (const v of VALUES) step("data", () => om.data(v));
    step("table", () => om.table(["A", "B"], [["1", "x"], ["22", "日本"]]));
    for (const name of ["easy_sandbox.transport.http", "other.lib"]) {
      const lg = logging.getLogger(name);
      for (const lvl of ["debug", "info", "warning", "error", "critical"]) step("log-" + lvl, () => lg[lvl]("record %s %d", "arg", 7));
    }
    om.setVerbose(true);
    step("debug-after-verbose", () => om.debug("after verbose"));
    step("log-after-verbose", () => logging.getLogger("easy_sandbox.x").debug("dbg after verbose"));
    om.setVerbose(false);
    step("log-after-unverbose", () => logging.getLogger("easy_sandbox.x").info("info after unverbose"));
    const fm = new OutputFormatter({ use_json: m.json_mode ?? false, quiet: m.quiet ?? false, no_color: m.no_color ?? false });
    for (const msg of MESSAGES) {
      step("f.success", () => fm.printSuccess(msg));
      step("f.error", () => fm.printError(msg));
      step("f.error+", () => fm.printError(msg, { suggestion: "s " + msg, code: "E9" }));
    }
    for (const v of VALUES) {
      if (v !== null && typeof v === "object" && !Array.isArray(v)) step("f.dict", () => fm.printDict(v));
      step("f.data", () => fm.printData(v));
    }
  } finally {
    sys.stdout = so; sys.stderr = se;
    const root = logging.getLogger();
    for (const h of [...root.handlers]) root.removeHandler(h);
  }
  res.push({ out: out.getvalue(), err: err.getvalue(), steps });
}
process.stdout.write(JSON.stringify(res));
`;

const scratch = mkdtempSync(join(tmpdir(), "ebx-out-"));
let failed = 0;
try {
  const specFile = join(scratch, "spec.json");
  writeFileSync(specFile, JSON.stringify({ cases, values: VALUES, messages: MESSAGES }));
  const tsFile = join(scratch, "run.mts");
  writeFileSync(tsFile, TS);
  const tsx = pathToFileURL(join(CLI_ROOT, "node_modules", "tsx", "dist", "esm", "index.mjs")).href;
  const env = { PATH: process.env.PATH, HOME: scratch, EBX_NO_KEYCHAIN: "1", TERM: "xterm-256color", LANG: "C.UTF-8", COLUMNS: "80" };
  const py = spawnSync(join(ORACLE_VENV, "bin", "python"), ["-c", PY, specFile], { env, cwd: scratch, encoding: "utf8", maxBuffer: 1 << 28 });
  if (py.status !== 0) throw new Error(`oracle failed: ${py.stderr}`);
  const node = spawnSync(process.execPath, ["--import", tsx, tsFile, specFile], { env, cwd: CLI_ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
  if (node.status !== 0) throw new Error(`node failed: ${node.stderr}`);
  const a = JSON.parse(py.stdout);
  if (verbose) console.log(`sample sizes: out=${a[0].out.length} err=${a[0].err.length}, json-mode err=${a[1].err.length}, steps=${a.map((x) => x.steps.length).join(",")}`);
  const b = JSON.parse(node.stdout);
  cases.forEach((c, i) => {
    for (const key of ["out", "err", "steps"]) {
      if (JSON.stringify(a[i][key]) !== JSON.stringify(b[i][key])) {
        failed += 1;
        if (failed <= 8) {
          const pa = key === "steps" ? a[i][key] : a[i][key].split("\n");
          const pb = key === "steps" ? b[i][key] : b[i][key].split("\n");
          let k = 0;
          while (k < Math.max(pa.length, pb.length) && JSON.stringify(pa[k]) === JSON.stringify(pb[k])) k += 1;
          console.log(`DIFF ${key} mode=${JSON.stringify(c.mode)} ttyOut=${c.ttyOut} ttyErr=${c.ttyErr} first differing line #${k}\\n  py:   ${JSON.stringify(pa[k])}\\n  node: ${JSON.stringify(pb[k])}`);
        }
      } else if (verbose) console.log(`ok ${key} ${JSON.stringify(c)}`);
    }
  });
  console.log(`${failed === 0 ? "IDENTICAL" : "DIFFERENCES"}: ${failed} differing stream(s) of ${cases.length * 3} (${cases.length} mode/tty combinations)`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(failed === 0 ? 0 : 1);
