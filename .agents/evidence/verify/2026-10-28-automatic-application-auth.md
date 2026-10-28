# Verification: Automatic template application authentication

- Date:2026-10-28
- Base:7aac212d6a9017e19f79d4ac60848857a9a4ffa8
- Issue:https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/210
- Result:PARTIAL — focused regressions and actual Express acceptance pass; unchanged-base controls match; current-head remote CI/review remain pending.
- Candidate: locally built CLI0.5.8 source candidate, no release or tag created.
- Environment:Linux, Node22.22.2; unchanged lockfile installed with `npm ci --no-audit --no-fund`. Existing project dotenv credentials supplied only to cloud-test child environments; no values recorded.

## What was verified

The reported terminal sequence now needs only platform API-key selection, command-only scope, hidden key entry and normal billable-create confirmation. Application authentication is automatically generated and saved in an owner-only file. The platform key is absent from that file. The same automatically generated credential reaches real service startup, a later CLI process performing authenticated command discovery and a real hello business command returning the requested greeting. A wrong application credential receivesHTTP401. The exact owned sandbox is killed and independently confirmed absent withHTTP404; temporary configuration is removed.

## Commands and results

| Check | Result | Scope |
| --- | --- | --- |
| New regression against unchanged behavior | Expected FAIL | Four failures/seven passes establish the missing automatic path before the change |
| Initial implementation regression | FAIL, corrected | Storage-failure test patched the wrong writer seam; corrected to the actual writer. Broader generation mocks return no configured value, so explicit process environment must retain normal precedence |
| Focused setup/generation/configuration/environment suite | PASS |126 tests across four files |
| Final focused suite including golden captures and real PTY | PASS |246 tests across six files |
| `node e2e/onboarding.mjs` | PASS | Seven actual terminal scenarios; command-only key entry now reaches automatic application setup and the billable confirmation, whose rejection prevents cloud submission |
| `ABX_BIN=<built candidate> node e2e/initialized-template.mjs --command-only-application` | PASS | Actual Express creation, no token prompt, hidden key, generated credential save/reuse, native discovery and hello business command; independentHTTP404 cleanup |
| Same real Express scenario with wrong-token control | PASS | Full fresh flow plus HTTP401 for an incorrect token; fresh owned instance independently absent after cleanup |
| `make ci` | FAIL | Typecheck, lint and build pass; full suite reports21 failed/4580 passed/five skipped. One stale create-help snapshot is corrected in a new dated folder and the complete focused snapshot suite passes. The other20 failures concern existing engine/provider/transport behavior; baseline comparison follows below |

## Captures and records

The new create-help snapshot lives under `tests/test_cli_evidence/golden/automatic-application-auth-20261028/`. Existing captures are preserved. The POSIX-terminal harness checks that the automatically generated token and hidden platform input never appear in output. User guides explain only normal configuration, automatic authentication, optional custom/external-client usage and practical limits; engineering statistics stay here.

## Remaining gates and cleanup

Current-head GitHub CI/review remains pending at this evidence point. No cloud management key or CI secret is created, restored or renewed. All cloud instances created by the recorded application scenarios are independently absent; no image or template build is required by this fixed managed fixture. Original unrelated working-tree changes remain untouched.

## Final local gate results

- Clean unchanged-main control at7aac212: the exact same20 engine/provider/transport test identities fail (39 pass across the six affected files). The changed help case is the only additional initial full-suite failure; the new dated snapshot and complete246-test focused suite pass. No baseline failure is waived or relabeled a pass.
- Parity check:907 ledger entries pass, zero missing/failed/skipped,11 moved entries verified. This does not imply the nested broader local suite passed.
- `make dist-check`:PASS, actual package entry and reference closure present.
- Initial repository health rejected the task-generated ignored parity JSON because it contains machine-local test paths. The generated report was moved out of the repository after its results were inspected; no historical or tracked file was changed. Final health and hygiene are rerun after that cleanup.

- Final repository health:PASS105, WARN11, FAIL0. Hygiene and `git diff --check`:PASS.
