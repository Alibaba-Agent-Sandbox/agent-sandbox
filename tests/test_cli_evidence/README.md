# CLI evidence snapshots

Golden-file regression tests for the exact text the CLI prints.

| File | Role |
| --- | --- |
| `evidence_cases.ts` | The registry (`REGISTRY`, ~110 cases): command line, description, category, the mock that makes it offline, golden file name. Also `normalize`, `formatResult`, `runCase`. |
| `test_evidence_snapshots.test.ts` | Port of `test_evidence_snapshots.py`. One `test_evidence_snapshot [<golden>]` per offline-deterministic case; compares the normalised stdout byte for byte with `golden/<name>.txt`. |
| `capture_cli_evidence.capture.ts` | The capture driver behind `scripts/capture-cli-evidence.mjs` (Markdown evidence documents). |
| `golden/` | The committed snapshots, copied unchanged from the Python repository. |

Category A cases need nothing but the CLI; category B cases drive a mocked backend (`Sandbox.create`/`connect`, template
API, MCP IDE config map, API-key lookup, ...). The mocks are installed per case and undone afterwards, so the snapshots
never touch the network, the real home directory or real credentials.

## Running

```bash
npx vitest run tests/test_cli_evidence          # compare every case with its golden file
ABX_UPDATE_EVIDENCE=1 npx vitest run tests/test_cli_evidence   # (re)write golden files instead of asserting
```

Only refresh a golden file when the output change is intentional and reviewed: the files are the byte-level contract with
the Python CLI.

## Capture script

```bash
node scripts/capture-cli-evidence.mjs                      # offline + mocked; writes .agents/evidence/cli/*.md
node scripts/capture-cli-evidence.mjs --command create     # only cases whose golden name starts with "create"
node scripts/capture-cli-evidence.mjs --out <dir>          # write somewhere else
node scripts/capture-cli-evidence.mjs --live               # also run un-mocked category-B cases (needs E2B_API_KEY)
```

The cases rely on in-process spies, so the script runs them inside vitest
(`scripts/capture-cli-evidence.vitest.config.mjs`) and passes its options through `ABX_CAPTURE_OPTIONS`. `--live` talks to
the real platform with the credentials in the environment and is never part of `npm test`. If the output directory already
holds a hand-curated `README.md`, the generated index is written to `README.generated.md` instead.
