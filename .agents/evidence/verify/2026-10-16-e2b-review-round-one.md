# Verification: E2B behavior review, first full run

- Date: 2026-10-16
- Change: proposed architecture ADR `2026-10-16-e2b-behavior-contract`
- Result: PARTIAL
- Revision: uncommitted scoped implementation on `feat/e2b-behavior-20261016`; not a published release
- Environment: Linux x64, Python 3.13.13, Node 22.22.2. Credentials supplied from ignored environment configuration; values omitted.

## What was verified

This first review found contract regressions and obsolete assumptions after canonical configuration and standard API changes. The task is not complete; subsequent fixes require a new verification record.

## Commands run

- `make test`: FAIL; 3600 passed / 134 failed / 56 skipped (154 files); many failures were old natural-language/configuration assumptions, with additional loopback/network and legacy Python-oracle failures.
- Focused config and standard-routing tests after fixes: PASS, 119 tests.
- `node scripts/build_binary.mjs`: PASS; built Linux x64 SEA executable and --version smoke passed.
- Real cloud standalone binary: sandbox list PASS; template list PASS; detached create PASS; exec output PASS with nonzero command mapped to exit 1 by the pinned CLI.
- Natural-language/config regression rerun after fixes: 147 passed / 4 failed; remaining helper invocations still needed --prompt. No full-suite pass claimed.

## Results

The bundled standalone client reached the actual Express endpoint without an installed external E2B executable. Core command routing and output were exercised; interactive PTY and the complete E2E runner remain to be verified.

## Cleanup

The cloud smoke used try/finally to kill its SDK-created sandbox and killed the ID emitted by detached create. Final account listing/cleanup verification remains required.

## Problems found

Canonical E2B settings conflicted with retired-name assertions and stale conformance vectors. Natural-language tests and help still assumed positional descriptions. Historical output captures remain unchanged; new behavior needs new fixtures/evidence. Several raw-network tests failed under the managed environment, and old Python-oracle terminal expectations conflict with the E2B behavior target.

## Not verified

Complete CI matrix, all cloud conditional capabilities, final package/hygiene/health checks, required remote review, PR merge and package publication. This record does not close the Issue or mark the proposed ADR implemented.
