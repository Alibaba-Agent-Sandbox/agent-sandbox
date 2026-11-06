# Verification: managed deployment drain recovery

- Date: 2026-11-06
- Change: [PR235](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/235), continued from 7e1d6b9d274e58bb76e8bb860ad90740f5f38fec.
- Result: PARTIAL — all local gates pass; joint cloud acceptance is a separate gate.
- Binary / package under test: unpublished source npm CLI 0.5.9 candidate.
- Environment: Linux, Node.js 22.22.2; no cloud operations or credentials used in this local run.

## What was verified

Destroy must account for retained production after an update fails before creating its Dispatcher.
Retirement needs the runtime's persistent revision admission fence. Control responses from a replaced
state store must not permit deletion, and historical Gateway ownership must remain recoverable.
The runtime owner independently reviewed these counterexamples and bounded cleanup changes.

## Commands run

```bash
npm ci
npm run typecheck
npx vitest run tests/test_cli/test_managed_application.test.ts
ABX_UPDATE_EVIDENCE=1 npx vitest run tests/test_cli_evidence/test_evidence_snapshots.test.ts -t 'test_evidence_snapshot \[version\]'
ABX_SERVER_SDK_SRC="$SERVER_FIXTURE_SRC" ABX_AWESOME_PROVIDERS="$PROVIDER_FIXTURE" PYTHON_SDK_ROOT="$PYTHON_FIXTURE" make ci
bash scripts/check-repo-health.sh
npm pack --pack-destination "$CANDIDATE/artifacts" --json
# In a separate private consumer project with the exact local tarball dependency:
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
node scripts/check-release-artifact.mjs "$CANDIDATE/node_modules/.bin/abx"
```

## Results

The initial baseline regression run exposed retained-worker deletion, historical Gateway leakage and
replacement-state acceptance. A retirement test was corrected to capture the requested operation
outside the mock so a mock assertion could not itself satisfy the expected rejection. The version bump initially exposed the expected old 0.5.8 golden; a new dated 0.5.9 golden was generated without changing historical captures. A plain local CI attempt also reported six skipped parity entries because the server checkout was absent. The final run supplied the exact CI-pinned server and provider fixtures and passed every required gate.

| Scenario / check | Result | Notes |
| --- | --- | --- |
| Managed behavior regressions | PASS | 48 tests, including six new drain/history/context cases |
| Full `make ci` | PASS | Hygiene, typecheck, lint, clean build, complete unit run, parity and package entry; Node 22 only |
| Complete unit run with pinned fixtures | PASS | 4,688 passed, five optional/fixture-dependent skips; no transport failures in this environment |
| Parity ledger | PASS | 907 entries passed, zero failed/skipped/missing; 11 moved owner entries verified |
| Repository health | PASS | 105 passes, 11 existing warnings, zero failures |
| Installed npm artifact | PASS | Exact candidate install, release-artifact checker, 11 read-only help/version commands |
| Frozen artifact/source equality | PASS | All 697 packaged dist files match the final local build |
| Native cloud joint lifecycle | NOT VERIFIED HERE | Integration owner runs the independent FC/database/Sandbox/model acceptance |

The fixture identities match CI: Python `8e610a3658040d8d6973e7951f9590ea50a4d70a`, providers `126a50e3c4e4c6792019b9c96674d35a9518d8ad`. The unpublished tarball SHA-256 is `ce05ffac162df005a7485a6cb3b61141fc05a3d7c611f7afc316e0aa9042f9e7`; its reproducible consumer lock SHA-256 is `d9a057387463197531030dc7e5f7bee58fd6f3812b45aa979a5d8c22fd802b46`. Installation intentionally skips lifecycle scripts; the installed-artifact checks above are the observed executable validation. No tests run inside that installed dependency tree. The five skips cover three temporary-volume mount cases, a live local OpenSandbox server case, and sibling Python SDK user-documentation validation (the CI-pinned sparse fixture does not include those docs).

## Cleanup

Tests create isolated local temporary directories and clean them in `afterEach`; no cloud resources
were created by these local tests. Joint deployment resources are recorded by the integration owner.

## Problems found

The staged-file secret hook initially rejected an existing synthetic token assignment in the modified
test file. Its literal now explicitly starts with `test-`; the different long-token behavior is retained,
and neither the scanner nor any allowlist changed. The runtime reviewer independently approved this
fixture clarification. The managed regressions and staged secret hook were rerun after it.

The complete component dependency-tree lock includes mutable development test caches. The lock is
preserved; real deployment uses a separate installed production candidate snapshot that is not
mutated by running tests. The Docker context copy excludes `.abx`, `.env` and `.env.*` at every depth;
private deployment input belongs under `.abx` or outside the project. Arbitrary `private` directory
names are ordinary source input and are not automatically secret locations.

## Not verified

No npm publication, tag, release or merge is claimed. Full FC lifecycle, business output, real model
execution and independent native resource absence remain joint acceptance gates.
