#!/usr/bin/env node
// Black-box E2E runner for ANY `abx` implementation. See e2e/README.md.
//   ABX_BIN="/path/to/abx" node e2e/run.mjs [--suite id[,id]] [--filter regex] [--json out.json] [--markdown out.md]
import { main } from './lib/runner.mjs';

const args = process.argv.slice(2);
const opts = { suites: null, filter: null, json: null, markdown: null, bail: false, verbose: false, list: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--suite') opts.suites = args[++i].split(',');
  else if (a === '--filter') opts.filter = new RegExp(args[++i], 'i');
  else if (a === '--json') opts.json = args[++i];
  else if (a === '--markdown') opts.markdown = args[++i];
  else if (a === '--bail') opts.bail = true;
  else if (a === '--verbose') opts.verbose = true;
  else if (a === '--list') opts.list = true;
  else if (a === '--help' || a === '-h') {
    console.log('usage: ABX_BIN=<abx> node e2e/run.mjs [--suite ids] [--filter regex] [--json file] [--markdown file] [--bail] [--verbose] [--list]');
    process.exit(0);
  } else { console.error(`unknown option ${a}`); process.exit(2); }
}
if (opts.list) {
  const { loadSuites } = await import('./lib/runner.mjs');
  for (const s of await loadSuites(opts.suites)) {
    console.log(`${s.id} [needs: ${(s.needs ?? []).join(',') || 'nothing'}] ${s.title}`);
    for (const sc of s.scenarios) console.log(`  ${sc.id} - ${sc.title}`);
  }
  process.exit(0);
}
await main(opts);
