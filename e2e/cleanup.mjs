#!/usr/bin/env node
// Janitor for sandboxes leaked by an interrupted E2E run.
//   node e2e/cleanup.mjs                 kill sandboxes recorded in e2e/.state/run-*.json (dry-run unless --yes)
//   node e2e/cleanup.mjs --yes           actually kill them
//   node e2e/cleanup.mjs --list          show every sandbox of the account (never kills unrecorded ones)
import { readdirSync, readFileSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { E2E_DIR, loadCredentials, makeMasker } from './lib/env.mjs';
import { baseEnv, parseBin, runBinary } from './lib/exec.mjs';

const yes = process.argv.includes('--yes');
const listOnly = process.argv.includes('--list');
const creds = loadCredentials();
const mask = makeMasker(creds);
const bin = parseBin(process.env.EBX_BIN || 'ebx');
const home = mkdtempSync(join(tmpdir(), 'ebx-e2e-janitor-'));
const env = baseEnv({ home, creds });

if (listOnly) {
  const r = await runBinary({ bin, argv: ['list'], env, cwd: home });
  console.log(mask(r.stdout + r.stderr));
  process.exit(r.code);
}

const stateDir = join(E2E_DIR, '.state');
const files = existsSync(stateDir) ? readdirSync(stateDir).filter((f) => f.startsWith('run-') && f.endsWith('.json')) : [];
let leaked = 0;
for (const f of files) {
  const rec = JSON.parse(readFileSync(join(stateDir, f), 'utf8'));
  for (const id of rec.sandboxes ?? []) {
    leaked++;
    if (!yes) { console.log(`[dry-run] would kill ${id} (run ${rec.runId})`); continue; }
    const r = await runBinary({ bin, argv: ['kill', id, '--yes'], env, cwd: home });
    const gone = r.code === 0 || /404|not found/i.test(r.stdout + r.stderr);
    console.log(`${gone ? 'killed' : 'FAILED'} ${id}`);
    if (gone) rec.sandboxes = rec.sandboxes.filter((x) => x !== id);
  }
  if (yes && !(rec.sandboxes ?? []).length) rmSync(join(stateDir, f), { force: true });
}
console.log(files.length ? `${leaked} recorded sandbox(es)` : 'no leaked-run ledgers found');
rmSync(home, { recursive: true, force: true });
