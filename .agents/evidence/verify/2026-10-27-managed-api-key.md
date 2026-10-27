# Verification: Consented Express managed API keys

- Date: 2026-10-27
- Change: [Issue #200](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/200); [decision](../../notes/implemented/architecture/2026-10-27-managed-api-key.md).
- Result: PARTIAL — feature acceptance passed; full-suite baseline failures remain blocking.
- Binary: candidate source, package version 0.5.7, built with npm run build from main 51c7d5af0ba1de6c50a38d86baa060d555d09482 plus this PR. This is not a published release.
- Environment: Linux, Node 22.22.2, real Express cn-hangzhou; credentials supplied through ignored environment configuration, never recorded.

## What was verified

Express owns the official Sandbox 2026-08-20 key-resource API. A new or nearly expired key requires explicit consent; the literal `--ci` flag may provide it, while ambient CI does not. Explicit keys retain priority. Reuse is read-only, disabled/deleted keys are not replaced, and unknown writes remain pending. A 30-day resource is shared privately by CLI and Python consumers, with no background renewal promise. English/Chinese docs explain feature/action/resource scopes and RAM authorization.

## Commands run

```sh
npm ci
npm run typecheck
npm run lint
npm run build
npm test
npx vitest run tests/test_providers/test_managed_api_key.test.ts
ABX_UPDATE_EVIDENCE=1 npx vitest run tests/test_cli_evidence/test_evidence_snapshots.test.ts
ABX_BIN='<candidate>' npm run e2e:offline
ABX_BIN='<candidate>' node e2e/onboarding.mjs
ABX_BIN='<candidate>' node e2e/managed-api-key.mjs
npm run test:standard-provenance
npm run parity:coverage
make dist-check
bash scripts/check-repo-health.sh
npm run check:hygiene
```

## Results

| Scenario | Result | Detail |
|---|---|---|
| Managed-key regression | PASS | 20 tests: official models, consent/ambient CI, private cache, Team/identity isolation, renewal, disabled keys, error redaction, uncertain/incomplete writes, independent-process serialization |
| Help evidence | PASS | 119 tests; new captures under managed-key-20261027; historical captures untouched |
| Full unit suite before final response-validation regression | FAIL | 4530 pass, 10 fail, 59 skip; the final added regression separately passed |
| Clean main comparison | FAIL, same baseline | Same 10 failures/18 passes in the three transport files on clean main; removing proxy environment variables did not resolve them |
| Typecheck/build | PASS | TypeScript build and no-emit check |
| Lint | PASS | Zero errors; 275 existing warnings |
| Offline E2E | PASS | 81 pass, one leak-check skip because zero cloud resources were created |
| Terminal onboarding | PASS | Six actual-PTY assertions, including cancellation, masked input and noninteractive modes |
| Real managed-key acceptance | PASS | Seven assertions: no-consent denial; terminal decline; explicit --ci preparation/private reuse; sandbox create/exec/kill/404; terminal renewal; confirmed CI renewal preserving ID and secret; key disable/delete/404 |
| Standard CLI provenance | PASS | Seven checks; no vendored runtime edits |
| npm pack | PASS | CLI entry and shipped Skill reference closure |
| Health/hygiene | PASS | Health 105 pass/11 warning/0 fail; no prohibited local paths or credential-like strings |
| Parity ledger | PASS | With PYTHON_SDK_ROOT and ABX_SERVER_SDK_SRC configured as in CI: 907 pass, zero failed/skipped/missing; 11 moved SDK tests verified. An earlier run without those fixtures had six skips |

The baseline failures are refused-TCP error mapping; transport ADV-core 20/21/23/25/26/30; WebSocket ADV-core 54/56/58. They were reproduced on unchanged main. They are not reported as passes and do not justify bypassing required CI.

Earlier verification found a new npm Skill link outside the shipped package, stale operation counts, and a PTY harness that incorrectly requested JSON with piped stdout. These were corrected and the affected package/offline/PTY checks passed. The initial cloud exec attempt used piped stdin and hit backend process-close behavior; using ignored stdin passed. Initial cloud attempts' owned keys/sandboxes were cleaned before later runs.

## Cleanup

Every managed-key run disabled/deleted only its own tracked key and independently confirmed DescribeApiKey returned 404. Its sandbox was killed and independently read back as HTTP 404. The earlier standalone probe's retained key was also disabled/deleted with 404 readback; its isolated engine was stopped and home removed. No general all-account cleanup was used. No owned cloud resource remained unconfirmed.

## Problems found

Full-suite baseline transport failures prevent claiming full CI success. Configuring the SDK/server-source fixtures resolved all parity-ledger skips. Tracked in [baseline issue #201](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/201). ADR remains proposed and PR remains draft while mandatory gates fail.

## Not verified

The full cloud/Docker/ACR matrix, alternate regions, Windows ACL behavior, standalone SEA binary, real least-privilege RAM account denial/grant and the remote Node matrix were not verified here. The feature has real cloud positive evidence plus mocked permission-denial regressions; it does not claim that every documented RAM policy was exercised with a separate restricted user. No npm release was requested or performed.

Supported remote Node 20/22 CI subsequently passed; see [CI acceptance](2026-10-27-managed-api-key-ci.md). Earlier local failures remain part of this run history.
