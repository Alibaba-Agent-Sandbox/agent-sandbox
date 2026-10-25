# Verification: Whole-template launch candidate

- Date: 2026-10-25
- Result: PARTIAL — final repository gates and source cloud acceptance in progress.
- Candidate package: CLI 0.5.0, source branch `refactor/unified-template-launch`.
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/151

## Behavior

Spec v5 launches the complete template, starts its command once and checks all declared services. Managed catalog names resolve the catalog manifest directly. Business API operations are not treated as launch types. Removed selectors and v4 manifests fail before resource creation.

## Completed checks

- `npm ci`: PASS.
- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- Focused model, template, generator, catalog and launch tests: 7 files / 206 tests PASS, followed by launch and shared vectors: 2 files / 50 tests PASS before the final added regressions.
- `ABX_UPDATE_EVIDENCE=1 npx vitest run tests/test_cli_evidence/test_evidence_snapshots.test.ts`: 118 tests PASS; new help snapshots preserve historical captures.
- Version/help-only regeneration after 0.5.0 bump: 10 PASS, 108 excluded by filter.
- `node scripts/capture-cli-evidence.mjs --command help-template --out .agents/evidence/cli/template-launch-20261025`: 9 command captures, no skips, PASS.
- `bash scripts/check-repo-health.sh`: 106 PASS, 11 existing warnings, no failures.
- `make ci`: hygiene, typecheck, lint (0 errors / 274 warnings), build PASS; full unit run pending at this checkpoint.

## Real-component progress

`e2e/unified-template-launch.mjs` uses real Express credentials from the environment and isolated temporary state. Local spec v5 managed `base` launch and remote execution have passed. This is not the production catalog-name path: the production catalog remains v4 until coordinated publication. Managed catalog resolution itself has a local CLI regression with a supplied catalog fixture.

Two early probe runs placed the native exec selector incorrectly or overlapped a rebuild that removed dist; their remote exec steps failed. Owned sandboxes were independently confirmed absent. The corrected final runner is in progress for managed and native-steps source startup. Only the final completed run can establish full acceptance.

## Not yet verified

Source steps completion, final full-suite result, candidate installed-package verification, remote CI and the Docker/OpenSandbox template matrix. No claim of merged or published changes is made. No Docker executable is present locally; the focused Express steps path does not replace that matrix.
