#!/usr/bin/env node
// Differential harness (area: completeness). Dumps the click tree of the Python oracle and of the Node port
// and diffs every command / group / option / argument field (names, defaults, types, envvars, help, hidden...).
// Usage: ORACLE_VENV=/path/to/venv node parity/diff/adv_completeness_click_tree.mjs   (needs `npm run build`)
// Skips cleanly (exit 0) when the oracle or dist/ is absent. Exit 1 on any difference.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const inv = resolve(here, "../review/inventory");
const venv = process.env.ORACLE_VENV;
if (!venv || !existsSync(join(venv, "bin", "python"))) {
  console.log("SKIP: ORACLE_VENV not set / oracle absent");
  process.exit(0);
}
if (!existsSync(resolve(here, "../../dist/cli/main.js"))) {
  console.log("SKIP: dist/ missing (run npm run build)");
  process.exit(0);
}
const home = mkdtempSync(join(tmpdir(), "adv-compl-"));
const env = { PATH: process.env.PATH, HOME: home, EBX_NO_KEYCHAIN: "1", NO_COLOR: "1", ORACLE_VENV: venv };
const run = (cmd, args) => spawnSync(cmd, args, { env, encoding: "utf8", maxBuffer: 1 << 28 });

const py = run("python3", [join(inv, "click_tree.py")]);
const node = run(process.execPath, [join(inv, "click_tree.mjs")]);
if (py.status !== 0 || node.status !== 0) {
  console.error(py.stderr, node.stderr);
  process.exit(2);
}
const a = join(home, "py.json");
const b = join(home, "node.json");
writeFileSync(a, py.stdout);
writeFileSync(b, node.stdout);
const d = run("python3", [join(inv, "click_tree_diff.py"), a, b]);
process.stdout.write(d.stdout);
process.stderr.write(d.stderr);
process.exit(d.status === 0 && /differences=0/.test(d.stdout) ? 0 : 1);
