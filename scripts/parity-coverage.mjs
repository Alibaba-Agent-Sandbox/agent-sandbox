#!/usr/bin/env node
// Compare the Python test ledger with the Node (vitest) test results.
//
//   node scripts/parity-coverage.mjs            # run vitest, report missing/failed/skipped
//   node scripts/parity-coverage.mjs --no-run   # reuse parity/.vitest-report.json
//   node scripts/parity-coverage.mjs --filter test_cli/test_main   # restrict to ledger entries containing the substring
//
// Ledger line:  tests/test_cli/test_main.py::TestFoo::test_bar[param]
// Node match:   file tests/test_cli/test_main.test.ts, ancestor titles [TestFoo], title starting with "test_bar"
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = join(root, "parity", ".vitest-report.json");
const args = process.argv.slice(2);
const filterIdx = args.indexOf("--filter");
const filter = filterIdx >= 0 ? args[filterIdx + 1] : "";

if (!args.includes("--no-run")) {
  const run = spawnSync(
    "npx",
    ["vitest", "run", "--reporter=json", `--outputFile=${reportPath}`, "--exclude", "tests/integration/**"],
    { cwd: root, stdio: "inherit" },
  );
  if (!existsSync(reportPath)) process.exit(run.status ?? 1);
}

const ledger = readFileSync(join(root, "parity", "python-tests-to-port.txt"), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => l.replace(/\[.*$/s, ""))
  .filter((v, i, a) => a.indexOf(v) === i)
  // `npm test` and the vitest run below both exclude tests/integration.
  .filter((l) => !l.startsWith("tests/integration/"))
  .filter((l) => !filter || l.includes(filter));

const report = JSON.parse(readFileSync(reportPath, "utf8"));
const results = new Map();
for (const file of report.testResults) {
  const rel = file.name.slice(root.length + 1);
  for (const t of file.assertionResults) {
    const key = `${rel}::${t.ancestorTitles.join("::")}${t.ancestorTitles.length ? "::" : ""}`;
    const list = results.get(key) ?? [];
    list.push(t);
    results.set(key, list);
  }
}

const missing = [];
const bad = [];
let ok = 0;
for (const entry of ledger) {
  const [pyFile, ...rest] = entry.split("::");
  const name = rest[rest.length - 1];
  const classes = rest.slice(0, -1);
  const nodeFile = pyFile.replace(/\.py$/, ".test.ts");
  const key = `${nodeFile}::${classes.join("::")}${classes.length ? "::" : ""}`;
  const hits = (results.get(key) ?? []).filter((t) => t.title === name || t.title.startsWith(`${name} [`) || t.title.startsWith(`${name}[`));
  if (hits.length === 0) {
    missing.push(entry);
  } else if (hits.some((t) => t.status !== "passed")) {
    bad.push(`${entry} (${hits.filter((t) => t.status !== "passed").map((t) => t.status).join(",")})`);
  } else {
    ok++;
  }
}

console.log(`\nparity ledger entries: ${ledger.length}  passed: ${ok}  failed/skipped: ${bad.length}  missing: ${missing.length}`);
if (bad.length) console.log(`\nFAILED/SKIPPED:\n${bad.join("\n")}`);
if (missing.length) console.log(`\nMISSING:\n${missing.join("\n")}`);
process.exit(bad.length || missing.length ? 1 : 0);
