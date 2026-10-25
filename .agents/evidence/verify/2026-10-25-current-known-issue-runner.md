# Current known-issue runner verification

Date: 2026-10-25
Result: PARTIAL

Scope: maintained known-issues runner, bilingual instructions and current
release navigation. No product runtime, package version or dependency change.
Node 22.22.2, Python 3.13.13, public npm CLI 0.5.3 and public Python client a2.
TypeScript SDK dist was built from matching released source
6dfdf9897ad76bf2fdb7eb1ccf455252b2dcb9fb without runtime changes.

- `npm ci`, `npm run build`, `node --check e2e/known-issues/run.mjs`: PASS.
- First complete real run after routing correction: 16 PASS, 1 FAIL, leaked=0.
  The timeout itself returned typed E3001 within budget and asked its observed
  PID to stop; the test incorrectly compared complete text without the dynamic
  PID diagnostic. That failed receipt remains separate.
- Corrected the regression to structured error code plus elapsed/process checks.
- `ABX_BIN=abx ABX_E2E_TEMPLATE=base node e2e/known-issues/run.mjs --json result.json`:
  PASS, 17 scenarios, 0 failures, 0 leaks. Both CLI and SDK deadlines, process
  signals/stdin, per-call environment, files/stat/missing paths and bad-key
  refusal actually exercised the selected Express account.
- Independent public a2 ProviderSandbox.get_info_by_id after cleanup raised
  typed SandboxNotFoundError for this run's exact owned sandbox: PASS.

The harness uses a temporary HOME and records ownership until confirmed absent.
Test account values came only from environment; no credentials or resource IDs
are included here. This is process/file regression coverage, not all-template,
real-model or interpreter coverage. Required owner checks and latest-head remote
review/merge remain pending at this snapshot.

Local owner validation: repository-health PASS (106 checks, 11 existing warnings);
hygiene, TypeScript, lint and build passed. Full make ci did not pass in this
host: 4,375 tests passed, 50 skipped, 10 raw-transport/TLS/WebSocket tests failed
in three files while local audit interception returned 502 or changed malformed
TCP/WS responses. These failures are retained and not disabled. Clean latest-head
CI remains required; this record does not relabel the local full run PASS.

Sanitized [first-run receipt](2026-10-25-current-known-issue-first-run.json)
and [complete final receipt](2026-10-25-current-known-issue-final-run.json)
preserve the assertion failure separately from the successful real run.
