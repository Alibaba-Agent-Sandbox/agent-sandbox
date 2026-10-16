#!/usr/bin/env node
// Compare the Python test ledger with the Node (vitest) test results.
//
//   node scripts/parity-coverage.mjs            # run vitest, report missing/failed/skipped
//   node scripts/parity-coverage.mjs --no-run   # reuse parity/.vitest-report.json
//   node scripts/parity-coverage.mjs --filter test_cli/test_main   # restrict to ledger entries containing the substring
//
// Ledger line:  tests/test_cli/test_main.py::TestFoo::test_bar[param]
// Node match:   file tests/test_cli/test_main.test.ts, ancestor titles [TestFoo], title starting with "test_bar"
//
// parity/moved-to-python-sdk.txt lists entries that test the Python SDK itself ("<entry> -> <python-sdk relative file>").
// They are reported as "moved" (not missing) and, when the python-sdk monorepo checkout is next to this CLI, the class
// and test function are verified to exist there.
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
    ["vitest", "run", "--reporter=json", `--outputFile=${reportPath}`],
    { cwd: root, stdio: "inherit" },
  );
  if (!existsSync(reportPath)) process.exit(run.status ?? 1);
}

const movedPath = join(root, "parity", "moved-to-python-sdk.txt");
const moved = new Map();
if (existsSync(movedPath)) {
  for (const raw of readFileSync(movedPath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [entry, target] = line.split(" -> ");
    moved.set(entry.trim().replace(/\[.*$/s, ""), (target ?? "").trim());
  }
}

const allEntries = readFileSync(join(root, "parity", "python-tests-to-port.txt"), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => l.replace(/\[.*$/s, ""))
  .filter((v, i, a) => a.indexOf(v) === i)
  .filter((l) => !filter || l.includes(filter));
const ledger = allEntries.filter((l) => !moved.has(l));
const movedEntries = allEntries.filter((l) => moved.has(l));

const pythonSdkRoot = process.env.PYTHON_SDK_ROOT ?? resolve(root, "..", "python-sdk");
const movedMissing = [];
if (existsSync(pythonSdkRoot)) {
  for (const entry of movedEntries) {
    const [, ...rest] = entry.split("::");
    const name = rest[rest.length - 1];
    const cls = rest.length > 1 ? rest[0] : null;
    const file = join(pythonSdkRoot, moved.get(entry));
    let found = false;
    if (existsSync(file)) {
      let text = readFileSync(file, "utf8");
      if (cls) {
        const m = new RegExp(`^class ${cls}\\b[\\s\\S]*?(?=^class |$(?![\\s\\S]))`, "m").exec(text);
        text = m ? m[0] : "";
      }
      found = text.includes(`def ${name}(`);
    }
    if (!found) movedMissing.push(`${entry} -> ${moved.get(entry)}`);
  }
}

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

// Keep the historical Python ledger immutable; trace intentionally replaced contracts.
const replacements = JSON.parse(readFileSync(join(root, "parity", "changed-contracts.json"), "utf8")).replacements;
const missing = [];
const bad = [];
let ok = 0;
for (const entry of ledger) {
  const mappedEntry = replacements[entry]?.target ?? entry;
  const [pyFile, ...rest] = mappedEntry.split("::");
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

const movedNote = movedEntries.length
  ? `  moved to python-sdk: ${movedEntries.length}${existsSync(pythonSdkRoot) ? ` (verified, ${movedMissing.length} not found there)` : " (python-sdk checkout not present: not verified)"}`
  : "";
console.log(`contract replacements: ${Object.keys(replacements).length} (parity/changed-contracts.json)`);
console.log(`\nparity ledger entries: ${ledger.length}  passed: ${ok}  failed/skipped: ${bad.length}  missing: ${missing.length}${movedNote}`);
if (movedMissing.length) console.log(`\nMOVED BUT NOT FOUND IN python-sdk:\n${movedMissing.join("\n")}`);
if (bad.length) console.log(`\nFAILED/SKIPPED:\n${bad.join("\n")}`);
if (missing.length) console.log(`\nMISSING:\n${missing.join("\n")}`);
process.exit(bad.length || missing.length || movedMissing.length ? 1 : 0);
