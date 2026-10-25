# Verification: Named-command JSON failure diagnostics

- Date: 2026-10-25
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/180
- Result: PARTIAL — focused, build and candidate real-cloud checks pass; full local suites have recorded failures; latest remote CI remains pending.
- Base: public CLI source `3f7fa28e16888a5489980dc56c86d6c71c11c4a0` (0.5.5).
- Environment: Linux, Node.js 22.22.2; reproducible `npm ci` from the unchanged lockfile. HTTP fixtures use placeholders only.

## Original observation and independent reproduction

A public CLI 0.5.5 native-steps supplementary template run returned exit 1 and only `{"result":null}`. Its template and sandbox were independently confirmed deleted, but the runner stopped at the CLI consumer before SDK/HTTP business checks. The original server status/body was not retained. This record does not infer the business failure's cause from that output.

An independent installed-public-package diagnostic made five actual loopback HTTP requests through the real `Sandbox.runCommand` mapping and dispatcher, replacing cloud connection/command transport only. HTTP 500 and 400 produced exit 1, result-null stdout and empty stderr; text-mode 500 preserved the diagnostic; 200/null exited 0; 404 retained E3005. These are local fixture results, not a real-cloud acceptance claim.

## Commands and results

- `npm ci --prefer-offline --no-audit --no-fund`: PASS.
- Added five real local HTTP dispatcher cases, then ran `npx vitest run tests/test_cli/test_run_command.test.ts` before the source fix: 15 PASS, 2 FAIL. Both JSON error cases failed because the actual output lacked `status`/`code`; the three control cases passed.
- The same command after the source fix: 17 PASS, 0 FAIL.
- `ABX_UPDATE_EVIDENCE=1 npx vitest run tests/test_cli_evidence/test_evidence_snapshots.test.ts -t run-failure-json-20261025`: PASS. The new dated capture contains one E3000 error JSON and exit 1; no historical capture is overwritten.
- `make ci`: FAIL (exit 2). Hygiene, typecheck and build PASS; lint has 0 errors and 275 existing warnings. Unit result: 4407 PASS, 10 FAIL, 50 skipped. The failed assertions concern transport error handling, TLS trust, proxy behavior and WebSocket close/handshake behavior; this record does not assign an unverified host cause.
- `npm run parity:coverage` with the reviewed SDK `8e610a3` and provider `126a50e` source trees: ledger 907/907 PASS and 11 moved SDK entries verified, exit 0. The underlying unit run is **4472 PASS, 20 FAIL, 1 skipped**. Ten additional engine/Cube/provider assertions fail, including observed HTTP 501 text `项目网络审计已关闭`; the text is an observation, not a root-cause conclusion. Ledger success does not mean the full suite passed.
- `npm run test:standard-provenance`: 7 PASS.
- `make dist-check`: PASS for the package entry and installed Skill reference closure.
- `bash scripts/check-repo-health.sh`: initially 106 PASS / 11 historical warnings. After parity generated its ignored raw report, the next scan correctly failed on machine-local paths inside that report (105 PASS / 11 WARN / 1 FAIL). The raw report was preserved privately outside the checkout; the final health scan passes again with 106 PASS / 11 WARN / 0 FAIL. No scanner rule or checked-in evidence was weakened.
- A separate five-request real local HTTP run against compiled candidate modules preserves 500/400 JSON diagnostics, text failure, successful null and typed 404 controls. It remains a local fixture, with no cloud calls.

Detailed safe results: [checks](2026-10-25-named-command-json-error-checks.json), [separate baseline/candidate HTTP fixtures](2026-10-25-named-command-json-error-fixtures.json).

## Candidate real-component verification

The compiled source at `89ec2bf66f80f06c43af6a94b83d9a6156d3878c` was exercised through the actual CLI against one newly created Express base sandbox. The host client and actual remote server were both public `0.4.0a6`. An uploaded command fixture deliberately raises a safe RuntimeError, validates two integers and returns a null value. Independent authenticated HTTP requests confirm the server returns 500 for execution failure and 400 for invalid input.

Five actual CLI cases PASS: JSON execution failure and the full command alias's JSON validation failure each emit one diagnostic E3000 object with exit 1; text mode retains the diagnostic; successful null retains `{result:null}` with exit 0; unknown command retains E3005 with exit 2. These use the unreleased source candidate, whose package identity remains 0.5.5. They do not claim the immutable public 0.5.5 package was patched, and do not establish the separate template business failure's cause.

Safe receipt: [candidate cloud results](2026-10-25-named-command-json-errors-cloud.json). Credentials and the exact owned ID remain private. No template or model was created.

## Cleanup

All local HTTP servers close in `finally`. Local diagnostics and focused regressions create no cloud resources. The candidate cloud test journals its one owned sandbox immediately after creation, kills that exact ID in `finally`, and independently confirms `SandboxNotFoundError`; no template is created. The earlier supplementary template run's cleanup remains in its owning receipt.

## Not yet verified

The failed full local suites remain recorded, without disabling tests. Latest remote CI, the final reviewed record commit, merge and release are not established by the local or cloud checks above. The earlier cloud candidate carried the base 0.5.5 identity; release preparation now sets package/lock and current installation guidance to the minimal next patch, 0.5.6. No public 0.5.6 artifact is claimed before the separate release gates.

## Minimal patch release preparation

The same unreleased change is prepared as CLI 0.5.6. Package and lock versions, current bilingual installation/tutorial guidance, and new dated version/help captures advance together. Earlier 0.5.5 records and output captures remain unchanged. The public SDK6/runtime pins and generated standard runtime bytes do not change. The earlier source-candidate cloud receipt retains its actual package identity and commit. Latest required CI, normal merge, five-platform artifacts, official publication and fresh public reruns remain pending.

Release preparation checks: `npm run build`, `npm run typecheck` and hygiene PASS at package 0.5.6. The three matching command/snapshot files pass 148 tests; the actual host-adapter and registry-scoping files pass 56 tests. The three new version/help captures were generated with `ABX_UPDATE_EVIDENCE=1`; previous release captures remain unchanged. Compiled 0.5.6 candidate modules pass the same five real loopback HTTP controls. Repository health is 106 PASS / 11 WARN / 0 FAIL. The named-command runtime source hash is unchanged from the reviewed and cloud-tested candidate.

## Independent pre-fix transport baseline

A separate reviewer ran the three failing transport/WebSocket files on actual pre-fix head `4396ac10903d1c17ecfec5ccada4dd36895324a2`, whose tree equals public main `3f7fa28e16888a5489980dc56c86d6c71c11c4a0`, reusing the same installed lockfile dependencies. Result: 18 PASS / 10 FAIL, exit 1. Comparison against this candidate's original `make ci` failure list matches all ten complete test names after whitespace normalization; neither list has additional names. These ten failures therefore precede this patch. This does not establish a host root cause or turn either full run into a pass, and no tests were disabled. The other ten failures in the producer-enabled run remain separate observations.

Safe independently produced baseline and explicit name comparison: [baseline](2026-10-25-named-command-json-errors-baseline.json).
