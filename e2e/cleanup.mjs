#!/usr/bin/env node
// Recover only sandboxes recorded by this runner; --yes requires independent absence proof.
import { readdirSync, readFileSync, writeFileSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { E2E_DIR, loadCredentials, hasCloudCredentials, makeMasker } from './lib/env.mjs';
import { baseEnv, parseBin, runBinary } from './lib/exec.mjs';
import { cleanupTrackedSandboxes, leakCheck } from './lib/runner.mjs';

export async function cleanupRecordedRun({ file, record, bin, creds, root, wait }) {
  if (!Array.isArray(record.sandboxes) || record.sandboxes.some((id) => typeof id !== 'string' || !id.trim())) throw new Error('invalid sandbox recovery ledger');
  if (record.uncertainCreates !== undefined && (!Array.isArray(record.uncertainCreates) || record.uncertainCreates.some((attempt) => typeof attempt !== 'string' || !attempt.trim()))) throw new Error('invalid unresolved-create recovery ledger');
  const tracker = { sandboxes: new Set(record.sandboxes), killed: new Set(), uncertainCreates: new Set(record.uncertainCreates ?? []) };
  const persist = () => {
    record.sandboxes = [...tracker.sandboxes].filter((id) => !tracker.killed.has(id));
    record.uncertainCreates = [...tracker.uncertainCreates];
    writeFileSync(file, JSON.stringify(record), { mode: 0o600 });
  };
  await cleanupTrackedSandboxes({ bin, creds, root, tracker, persist });
  const result = await leakCheck({ bin, creds, root, tracker, persist, cloudOk: hasCloudCredentials(creds), skipOnlyOffline: false, ...(wait ? { wait } : {}) });
  persist();
  if (!record.sandboxes.length && !record.uncertainCreates.length) rmSync(file, { force: true });
  return { result, remaining: [...record.sandboxes], uncertain: [...record.uncertainCreates] };
}

export async function main() {
  const yes = process.argv.includes('--yes');
  const listOnly = process.argv.includes('--list');
  const creds = loadCredentials();
  const mask = makeMasker(creds);
  const bin = parseBin(process.env.ABX_BIN || 'abx');
  const home = mkdtempSync(join(tmpdir(), 'abx-e2e-janitor-'));
  try {
    if (listOnly) {
      const result = await runBinary({ bin, argv: ['list'], env: baseEnv({ home, creds }), cwd: home });
      console.log(mask(result.stdout + result.stderr));
      process.exitCode = result.code;
      return;
    }
    const stateDir = join(E2E_DIR, '.state');
    const files = existsSync(stateDir) ? readdirSync(stateDir).filter((file) => file.startsWith('run-') && file.endsWith('.json')) : [];
    let recorded = 0;
    for (const name of files) {
      const file = join(stateDir, name);
      const record = JSON.parse(readFileSync(file, 'utf8'));
      const ids = [...(record.sandboxes ?? [])];
      recorded += ids.length;
      if (!yes) {
        for (const id of ids) console.log(mask(`[dry-run] would kill ${id} (run ${record.runId})`));
        continue;
      }
      const { result, remaining, uncertain } = await cleanupRecordedRun({ file, record, bin, creds, root: home });
      for (const id of ids) console.log(mask(`${remaining.includes(id) ? 'UNCONFIRMED' : 'confirmed absent'} ${id}`));
      for (const attempt of uncertain) console.log(mask(`UNRESOLVED create attempt ${attempt}; no safe resource identity`));
      if (remaining.length || uncertain.length || result.status === 'fail') process.exitCode = 1;
    }
    console.log(files.length ? `${recorded} recorded sandbox(es)` : 'no leaked-run ledgers found');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
