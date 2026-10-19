# Verification: project tool deadline rounding

Result: PARTIAL

Before the fix, the actual built runTool helper raised RangeError for timeouts 1.001 and 1.003 seconds because execFile received noninteger milliseconds. A normal 179.999-second timeout passed, explaining why a successful native run alone did not catch this boundary.

The scoped fix rounds only the milliseconds conversion. Regression uses a real subprocess and 8.001 seconds. Required local/hosted checks and the provider native rerun are tracked in this follow-up PR. No cloud resources are created by the regression. Broader Express/native receipts remain preserved in the original launch evidence and PR71; the normal launch public contract and Beta limits do not change.

## Executed local checks

- PASS: `npm run typecheck`, locked `npm run build`, `npm run lint` (0 errors; 253 existing warnings), `npm run check:hygiene`, repository health (106 pass, 0 fail).
- PASS: `npx vitest run tests/test_providers/test_template_launch.test.ts` — 11/11, including real subprocess execution with a fractional remaining deadline.
- PASS: independent built-helper subprocess probes at 1.001, 1.003 and 8.001 seconds all returned expected output after the fix.
- PARTIAL: complete `npm test` with actual reviewed provider/server sources — 4014 pass, 20 fail, 1 skip (4035 total). All 20 failures are the existing intercepted-network transport/engine/Cube cases. The launch regression has no failure. Hosted Node 20/22 tests remain required; local network failures are not relabeled as passes.
- The provider native workflow pins reviewed runtime source `5a9f544c07554c7f1fd6345b67156f61e0eb1477`; subsequent owner-record-only commits do not change those runtime bytes. An ordinary merge keeps that pin reachable in main history. Current-head hosted receipts are linked from PR72/PR17.
