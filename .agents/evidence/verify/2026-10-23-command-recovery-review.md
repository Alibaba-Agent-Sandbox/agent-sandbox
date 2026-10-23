# Verification: command recovery review

- Date: 2026-10-23
- Result: PASS for scoped recovery/scaffold regressions and real cloud smoke; full local suite retains the environment failures below. Final-head CI/merge/publication are separate gates recorded in PR #110.
- Tested code head: 28f58d9e26f9 (base 6df41f624249c316654fbd5c6d36c34a7beca0b8); following changes only finalize records.
- Environment: Linux, Node 22.22.2, Python 3.13.13. Credentials supplied via ignored environment, never printed or committed.

## Behavior verified

Recovery class defaults, inherited errors and code-generation overrides use explicit --prompt and positional detached Express create. Generated shell blocks stop before create on failed deploy and preserve provider selection. Non-Express scaffolds direct users to their provider. Reporting documents define stable diagnostic codes, body-bound leased event claims, acceptance/retry/crash semantics and stable identity renewal; no reporter implementation is claimed.

## Commands and results

| Check | Result |
| --- | --- |
| npm ci; npm run build; npm run typecheck | PASS |
| npm run lint | PASS: zero errors, 277 existing warnings |
| npm run test:standard-provenance | PASS: 7 tests |
| bash scripts/check-repo-health.sh | PASS: 105 PASS, 11 historical WARN, zero FAIL |
| npm run check:hygiene; git diff --check | PASS |
| Affected CLI/model/provider/scaffold/codegen/snapshot/formatting suites | PASS: 584 tests across 7 files in temporary filesystem copy; executable/entry follow-up: 22 tests across 2 files passed after building that copy |
| Historical error oracle adaptation | PASS: 255 formatting/tool-payload tests; original Python fixture preserved |
| Fresh help/version/clarification captures | PASS: generated in command-recovery-20261023; old captures unchanged |
| Remote full tests and parity, Node 20 and Node 22 on tested code head | PASS: both Run tests and Parity coverage check steps succeeded in [CI](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/39887460376) |
| Real current CLI + harness helper smoke | PASS: read-only preflight, actual standard template inventory, detached create, exec, standard kill helper, full list absence readback |
| Final read-only full sandbox inventory | PASS: zero sandboxes listed; no owned resources leaked |

The seven affected files were test_standard_executable, test_codegen, test_errors, test_template_profile, test_template_commands, test_evidence_snapshots and test_error_str_oracle. The actual standard executable accepts recovered commands; a real shell verifies deploy failure gates creation. Cloud helper code used the current built executable against Express; no template registration or image build was necessary for this contract fix.

## Failures preserved and resolved

Initial current-head CI found ten old oracle-default assertions and one clarification snapshot mismatch. Current project defaults now override only minimal-constructor cases; historical formatting/caller-supplied suggestions remain protected, and a new dated snapshot was captured. The corrected full Node 20/22 tests/parity passed.

Mounted-filesystem executable tests exceeded their 20-second deadlines (21 failures). The same affected behavior passed from the temporary filesystem copy. That full local copy run reported 4,104 passed, 22 failed, 4 skipped (176 files); two failures were absent temporary dist output and passed after an explicit compiler build. The remaining 20 network/proxy/TLS/WebSocket failures include synthetic HTTP 501 “项目网络审计已关闭”. All six failing test files and 16 transport/engine files match untouched base bytes. The same environment failure family is independently documented in [earlier baseline evidence](2026-10-22-guided-configuration.md). This local full run is not represented as passing; remote CI provides the clean full matrix.

An initial 60-second real helper run passed preflight/inventory then failed exec/cleanup; short TTL with slow startup was a hypothesis, not an established diagnosis. Repeating with 300 seconds passed create/exec/owned cleanup/readback; final inventory was empty. Its private recovery journal was removed only after confirmed absence.

## Limits and delivery

No new Codex Docker/ACR build, template qualification, general diagnostic capture, opt-out setting, sender, FC/SLS resource, HTTPS endpoint, telemetry latency or abuse-control acceptance is claimed. Reporting remains on [Issue #107](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/107).

This receipt predates the final record-only commit and merge. [PR #110](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/110) records required checks for its exact final head, merge state and release follow-through. Related harness: [PR #193](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/pull/193).
