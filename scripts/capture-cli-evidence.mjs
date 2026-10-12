#!/usr/bin/env node
// Capture CLI evidence: run every registered evidence case (tests/test_cli_evidence/evidence_cases.ts) against the Node
// CLI with the mocked, offline backend and generate the Markdown evidence documents.
//
//   node scripts/capture-cli-evidence.mjs                       # offline + mocked (default), writes .agents/evidence/
//   node scripts/capture-cli-evidence.mjs --live                # also run un-mocked category-B cases (needs E2B_API_KEY)
//   node scripts/capture-cli-evidence.mjs --command create      # only cases whose golden name starts with "create"
//   node scripts/capture-cli-evidence.mjs --out <dir>           # write the documents somewhere else
//
// The cases need module-level mocks (spies on the API / transport / seam objects), so the capture runs inside vitest
// (config: scripts/capture-cli-evidence.vitest.config.mjs). Golden snapshots are refreshed with
//   EBX_UPDATE_EVIDENCE=1 npx vitest run tests/test_cli_evidence
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function usage(code) {
  console.error("usage: capture-cli-evidence.mjs [--live] [--command PREFIX] [--out DIR]");
  process.exit(code);
}

const options = { live: false, command: null };
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--live") options.live = true;
  else if (arg === "--command" && i + 1 < args.length) options.command = args[++i];
  else if (arg === "--out" && i + 1 < args.length) options.out = resolve(args[++i]);
  else if (arg === "-h" || arg === "--help") usage(0);
  else usage(2);
}

const run = spawnSync("npx", ["vitest", "run", "--config", "scripts/capture-cli-evidence.vitest.config.mjs", "--reporter=dot"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, EBX_CAPTURE_OPTIONS: JSON.stringify(options) },
});
process.exit(run.status ?? 1);
