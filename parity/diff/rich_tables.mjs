#!/usr/bin/env node
/**
 * Differential test of the Rich table rendering behind `OutputFormatter.print_table` and `OutputManager.table`
 * (headers/rows containing markup, emoji codes, CJK / emoji / combining / zero-width text, control characters, ragged
 * rows, very narrow widths, TTY vs pipe, NO_COLOR) against the original Python implementation. Rendering is done
 * in-process on both sides (a fake stdout stream, `COLUMNS` set per case); raised exceptions are compared too.
 *
 *   ORACLE_VENV=/path/to/venv node parity/diff/rich_tables.mjs [--verbose] [--seed N] [--count N]
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
const argAfter = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const verbose = process.argv.includes("--verbose");
let seed = Number(argAfter("--seed", "7"));
const count = Number(argAfter("--count", "300"));

if (!ORACLE_VENV || !existsSync(join(ORACLE_VENV, "bin", "python"))) {
  console.error("ORACLE_VENV must point to a venv with the original easy-sandbox installed (see docs/PORTING.md).");
  process.exit(2);
}

const rnd = () => {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];

const POOL = [
  "plain", "sbx-1234567890abcdef", "python-3.11", "running", "", " ", "  padded  ", "a b c d e f g h i j k l m n o p",
  "日本語のテキスト", "中文名称", "한국어", "ＦＵＬＬ　ＷＩＤＴＨ", "ｈａｌｆ", "😀", "👨‍👩‍👧‍👦", "🇨🇳", "e\u0301", "a\u200bb", "\u200d", "x\ufe0f", "❤️", "✔",
  "[bold]markup[/bold]", "[red]red[/red]", "[/]", "[/nope]", "[not a tag]", "[link=http://x]l[/link]", "\\[escaped]", "[", "]", "[[]]", "[b]unclosed",
  ":smile:", ":+1:", ":not_an_emoji:", ":flag_cn:", "a:b:c",
  "tab\there", "line1\nline2", "cr\rcr", "\x1b[31mansi\x1b[0m", "\x00", "\x07bell", "\u2028sep", "\u00a0nbsp",
  "averyveryverylongunbreakablewordthatexceedsanynarrowwidthwhatsoever0123456789",
  "http://example.com/a/very/long/url/that/should/wrap/somewhere?q=1&r=2#frag", "/home/user/some/deep/directory/file.txt",
  "2026-10-12T08:31:00Z", "1234567", "-1", "3.14159", "None", "True",
];
const cell = () => {
  const n = pick([1, 1, 1, 2, 3]);
  return Array.from({ length: n }, () => pick(POOL)).join(pick(["", " ", "-", "_"]));
};

const tables = [
  { headers: ["ID", "Template", "Status"], rows: [["sbx-1", "python", "running"], ["sbx-2", "node", "paused"]] },
  { headers: ["名称", "状态"], rows: [["沙箱一号", "运行中"], ["サンドボックス", "停止"]] },
  { headers: [], rows: [] },
  { headers: ["only"], rows: [] },
  { headers: ["a", "b"], rows: [["1"]] },
  { headers: ["a", "b"], rows: [["1", "2", "3"]] },
  { headers: ["[bold]h[/bold]", ":smile:"], rows: [["[/]", "x"]] },
  { headers: ["a"], rows: [[""], [" "], ["\t"]] },
  { headers: ["h".repeat(60), "i".repeat(60)], rows: [["x", "y"]] },
];
for (let i = 0; i < count; i += 1) {
  const cols = pick([1, 2, 3, 4, 6]);
  const rows = Array.from({ length: pick([0, 1, 2, 3, 6]) }, () => Array.from({ length: cols }, cell));
  tables.push({ headers: Array.from({ length: cols }, () => pick(["ID", "Name", "名称", "Status", "Template", "Created", "x", "😀", "[b]B[/b]", cell()])), rows });
}

const cases = [];
tables.forEach((t, ti) => {
  for (const width of [12, 30, 80]) {
    for (const tty of [false, true]) {
      for (const noColor of [false, true]) {
        // The wide sweep is for the first tables only; random tables rotate through the combinations.
        if (ti >= tables.length - count && (ti + width + Number(tty) + Number(noColor)) % 3 !== 0) continue;
        cases.push({ ...t, width, tty, noColor });
      }
    }
  }
});

const PY = String.raw`
import io, json, os, sys
from easy_sandbox.cli.formatters import OutputFormatter
from easy_sandbox.cli.output import OutputManager

class Buf(io.StringIO):
    def __init__(self, tty): super().__init__(); self._tty = tty
    def isatty(self): return self._tty

cases = json.load(open(sys.argv[1]))
res = []
for c in cases:
    os.environ["COLUMNS"] = str(c["width"])
    row = {}
    for api in ("formatter", "manager"):
        buf = Buf(c["tty"])
        saved = sys.stdout
        sys.stdout = buf
        try:
            if api == "formatter":
                OutputFormatter(use_json=False, quiet=False, no_color=c["noColor"]).print_table(c["headers"], c["rows"])
            else:
                OutputManager(no_color=c["noColor"]).table(c["headers"], c["rows"])
            row[api] = {"out": buf.getvalue()}
        except Exception as e:
            row[api] = {"out": buf.getvalue(), "err": type(e).__name__ + ": " + str(e)}
        finally:
            sys.stdout = saved
    res.append(row)
json.dump(res, sys.stdout)
`;

const TS = `
import { readFileSync } from "node:fs";
import { OutputFormatter } from ${JSON.stringify(pathToFileURL(join(CLI_ROOT, "src/cli/formatters.ts")).href)};
import { OutputManager } from ${JSON.stringify(pathToFileURL(join(CLI_ROOT, "src/cli/output.ts")).href)};
import { sys } from ${JSON.stringify(pathToFileURL(join(CLI_ROOT, "src/framework/io.ts")).href)};

class Buf { chunks = []; constructor(tty) { this.tty = tty; } write(t) { this.chunks.push(t); } flush() {} isatty() { return this.tty; } getvalue() { return this.chunks.join(""); } }
const cases = JSON.parse(readFileSync(process.argv[2], "utf8"));
const res = [];
for (const c of cases) {
  process.env.COLUMNS = String(c.width);
  const row = {};
  for (const api of ["formatter", "manager"]) {
    const buf = new Buf(c.tty);
    const saved = sys.stdout;
    sys.stdout = buf;
    try {
      if (api === "formatter") new OutputFormatter({ use_json: false, quiet: false, no_color: c.noColor }).printTable(c.headers, c.rows);
      else new OutputManager({ noColor: c.noColor }).table(c.headers, c.rows);
      row[api] = { out: buf.getvalue() };
    } catch (e) {
      row[api] = { out: buf.getvalue(), err: (e.name === "Error" ? e.constructor.name : e.name) + ": " + e.message };
    } finally {
      sys.stdout = saved;
    }
  }
  res.push(row);
}
process.stdout.write(JSON.stringify(res));
`;

const scratch = mkdtempSync(join(tmpdir(), "ebx-rich-"));
let failed = 0;
try {
  const casesFile = join(scratch, "cases.json");
  writeFileSync(casesFile, JSON.stringify(cases));
  const tsFile = join(scratch, "run.mts");
  writeFileSync(tsFile, TS);
  const tsx = pathToFileURL(join(CLI_ROOT, "node_modules", "tsx", "dist", "esm", "index.mjs")).href;
  for (const noColorEnv of [false, true]) {
    const env = { PATH: process.env.PATH, HOME: scratch, EBX_NO_KEYCHAIN: "1", TERM: "xterm-256color", LANG: "C.UTF-8", ...(noColorEnv ? { NO_COLOR: "1" } : {}) };
    const py = spawnSync(join(ORACLE_VENV, "bin", "python"), ["-c", PY, casesFile], { env, cwd: scratch, encoding: "utf8", maxBuffer: 1 << 28 });
    if (py.status !== 0) throw new Error(`oracle failed: ${py.stderr}`);
    const node = spawnSync(process.execPath, ["--import", tsx, tsFile, casesFile], { env, cwd: CLI_ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
    if (node.status !== 0) throw new Error(`node failed: ${node.stderr}`);
    // Rich draws a random `id=` for every hyperlink; it carries no information.
    const strip = (t) => t.replace(/\\u001b\]8;id=\d+;/g, "\\u001b]8;id=N;");
    const a = JSON.parse(strip(py.stdout));
    const b = JSON.parse(strip(node.stdout));
    cases.forEach((c, i) => {
      for (const api of ["formatter", "manager"]) {
        if (JSON.stringify(a[i][api]) !== JSON.stringify(b[i][api])) {
          failed += 1;
          if (failed <= 6) {
            console.log(`DIFF [NO_COLOR env=${noColorEnv}] ${api} width=${c.width} tty=${c.tty} no_color=${c.noColor} headers=${JSON.stringify(c.headers)} rows=${JSON.stringify(c.rows).slice(0, 200)}`);
            console.log(`  py:   ${JSON.stringify(a[i][api]).slice(0, 300)}\n  node: ${JSON.stringify(b[i][api]).slice(0, 300)}`);
          }
        } else if (verbose) console.log(`ok ${api} width=${c.width} tty=${c.tty}`);
      }
    });
  }
  console.log(`${failed === 0 ? "IDENTICAL" : "DIFFERENCES"}: ${failed} differing comparison(s) of ${cases.length * 4} (${tables.length} tables)`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(failed === 0 ? 0 : 1);
