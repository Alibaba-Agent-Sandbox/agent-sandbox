# Verification: Provider current-host integration checkpoint

- Date: 2026-10-18
- Result: PARTIAL — acceptance continues; no merge or complete coverage claim.
- Scope: integration with main `5df3d594580c880fd1528cb7a12fa2c85be16590`, adapter ownership and current runtime contracts.
- Owner: Issue #47, PR #35; SDK dependency https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/38.
- Environment: Linux, Node 22.22.2; reproducible package-lock installation. Current source and tests were copied to a temporary checkout with equal content digests to separate filesystem startup overhead from behavior. No time budget was increased.

## Commands and results

- Strict typecheck/build PASS at the integration checkpoint; subsequent affected changes receive a new acceptance run.
- Focused native/auth/template/selection: 122 PASS. Template/region/help/error repair run: 308 PASS.
- Python consumer full client: 2174 PASS / 24 SKIP; full configured native cloud: 116 PASS / 6 SKIP / 2 DESELECTED / 1 known XFAIL. These are SDK-owner results, not extra CLI passes.
- Initial temporary aggregate: 3877 PASS / 26 FAIL / 2 SKIP, 155 files, 71.58 seconds. It exposed stale native-bypass/error-oracle/umask assumptions, a missing dynamic handler table, and network-intermediary failures. Follow-up fixes and unchanged baseline comparison are pending this checkpoint.
- SEA executable build and version smoke PASS; tested checkpoint SHA256 `9f510404904f856f5c662e53ace96095430d2b4594866433791ea75a839c0a1d`.
- Binary offline: 61 PASS / 1 leak-check SKIP (no cloud resource created).
- Binary configured cloud/management: 81 PASS / 1 guarded destructive SKIP / 2 FAIL; two created sandboxes deleted and leak-check PASS. Failures were process info without procps and invalid Python metrics syntax. Both now have real-process regressions; fresh binary/cloud acceptance is required.

## Current implementation

Every backend uses Provider infrastructure and owned session hooks. URL conventions live
with the wire adapter; compatibility configuration helpers delegate. Retired orphan APIs
and automatic AK/SK key creation stay removed. Generic CLI callbacks use the independent
error renderer. Schema and handler discovery switch together; missing Cube PTY remains
unsupported, and a separate explicit wire fixture tests the generic terminal bridge.

## Cleanup and limitations

The checkpoint binary run reports two created, zero leaked. Independent SDK listing after
its full cloud run observed zero sandbox resources and zero Python E2E tags. No new Team,
API key, Volume, Bucket, role or template was created by these checkpoint runs.

Native Cube/E2B/container/OpenSandbox environments are not configured. Optional image
factories are not activated. Mandatory current-head hosted CI/review and the remaining
local checks are not waived. The PR remains draft until its acceptance gates pass.
