#!/usr/bin/env node
// Proves the harness detects regressions: diffs the oracle against a deliberately mutated wrapper
// (rewrites "running" -> "RUNNING" in stdout and turns exit code 4 into 9). Exits 0 only if the
// differences are reported for the expected cases and oracle-vs-oracle stays clean.
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const oracle = process.env.EBX_ORACLE;
if (!oracle) { console.error('EBX_ORACLE is required'); process.exit(2); }
const dir = mkdtempSync(join(tmpdir(), 'ebx-diff-selftest-'));
const wrapper = join(dir, 'mutant.sh');
writeFileSync(wrapper, `#!/bin/bash\nOUT=$(${oracle} "$@"); CODE=$?\nprintf '%s\\n' "$OUT" | sed 's/running/RUNNING/g'\n[ "$CODE" = 4 ] && CODE=9\nexit $CODE\n`);
chmodSync(wrapper, 0o755);

const run = (bin) => spawnSync('node', [join(here, 'diff.mjs'), '--fast', '--filter', '^(list|info|info-missing|exec-missing-sandbox|version)$'], { env: { ...process.env, EBX_ORACLE: oracle, EBX_BIN: bin }, encoding: 'utf8' });
const clean = run(oracle);
const mutant = run(wrapper);
rmSync(dir, { recursive: true, force: true });
const ok = clean.status === 0 && mutant.status === 1 && /DIFF  list/.test(mutant.stdout) && /DIFF  info-missing/.test(mutant.stdout) && /same  version/.test(mutant.stdout);
console.log(`oracle vs oracle: exit ${clean.status}\nmutant: exit ${mutant.status}\n${mutant.stdout.split('\n').filter((l) => /^(DIFF|same)/.test(l)).join('\n')}`);
console.log(ok ? 'selftest OK: mutations were detected, clean run stayed clean' : 'selftest FAILED');
process.exit(ok ? 0 : 1);
