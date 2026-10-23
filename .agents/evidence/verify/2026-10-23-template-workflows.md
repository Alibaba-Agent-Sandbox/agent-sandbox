# Verification: template workflows

- Date: 2026-10-23
- Change: [Issue #118](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/118); proposed template-workflows decision
- Result: PARTIAL
- Package: isolated CLI implementation branch; pure contract commits `1cab8a6` and `f98a880`
- Environment: Node.js 22, Linux; credentials and private endpoints are not recorded

## What was verified

The pure planner consumes canonical operation rules and 31 conformance vectors. Application workflows do not infer interpreter dependencies. The source launcher selects explicit build profiles, preserves Dockerfiles, records creation intent, and validates provider/source identity. Dedicated application HTTP requests preserve proxy scope, isolate credentials and refuse redirects and anonymous retry. The guessed Connect interpreter and its runtime export have been removed rather than certifying a mock endpoint as a real implementation.

## Commands run

- `node scripts/sync-workflow-contracts.mjs --check`: PASS; source revision `b8d06847780448193f7d529c59c40b5ba9cc6b8d`.
- Direct Node normalized comparison against owner vectors: PASS, 31 cases.
- Scoped Vitest command covering `test_workflow_plan`, `test_resource_journal`, `test_application_http`, `test_content_identity`, `test_manifest`, `test_template_launch`, `test_code`, `test_capability`, `test_template_index`, `test_code_interpreter` and `test_e2b_provider`: PASS, 198 tests across 11 files at that checkpoint.
- Migration regression across 10 files: 336 PASS, 4 FAIL in engine proxy/Host tests. Later migration fixes and stricter interpreter rejection are recorded by subsequent focused checks; this is not a full-suite pass.
- `npm test -- --maxWorkers 4` on an intermediate implementation: FAIL; 4,006 passed, 155 failed, 3 skipped. This run predates subsequent fixture migrations. No failing test was changed to a skip to obtain a pass.
- `npm run typecheck`, `npm run build`, `npm run lint`: executed repeatedly during implementation; final-head results are appended below when available.
- `bash scripts/check-repo-health.sh`: PASS, 106 pass / 11 historical-context warnings / 0 failures at the recorded checkpoint.
- `node scripts/capture-cli-evidence.mjs --command template --out .agents/evidence/cli/2026-10-23-template-workflows`: PASS, 5 offline cases, 2 capture files.

## Results

| Check | Result | Notes |
| --- | --- | --- |
| Canonical planner and strict manifest | PASS | Exact normalized agreement, including required readiness operations |
| Isolated context lifecycle and no shell fallback | PASS | Generic operation logic exercised with explicit adapters; guessed HTTP routes removed |
| Application HTTP real component | PASS | Real localhost server receives exact proxy prefix/query and separate application/gateway authentication |
| Source/profile/journal identity logic | PASS at checkpoint | Relevant regressions included in scoped suite; additional final changes require their final run |
| Full latest-head repository gates | Pending | Intermediate full-suite failure above is preserved |
| Engine proxy/foreign Host checks | FAIL locally | Actual socket destination is localhost; explicit foreign Host and envd-dial tests receive HTTP 501 with “项目网络审计已关闭”; expected security/status assertions remain intact |
| Real OpenSandbox source lifecycle | Not yet verified by this owner | Cross-repository remote run required; local Docker is unavailable |
| Remote CI / merge | Not verified | Parent coordinates contribution workflow after owner commits |

## Cleanup

Recorded checks created no cloud sandboxes or templates. Real HTTP test servers close in `finally`; local snapshot and journal fixtures use isolated temporary directories. No claim of cloud resource cleanup is made without a real provider run.

## Problems found

A provider version/manifest hash is not code identity. Source readiness commands require `exec.run` even for native entrypoint startup. App command `run` must not collide with the engine shell route. The guessed interpreter's previous 404 fallback hid an unimplemented transport; removing only the fallback would still leave false capability claims.

## Not verified

The final complete CI matrix, package/SEA distribution acceptance, differential parity, and real OpenSandbox launch/invoke/cleanup must pass before the proposed change is accepted or merged. Beta maturity and historical receipts do not satisfy these gates.

## Final local checkpoint before owner commit

- `npm run typecheck`: PASS, exit 0 after launcher config/source freeze changes.
- `npm run build`: PASS, exit 0; mandatory remote build/package gates remain pending.
- `npm run lint`: PASS, exit 0; 276 warnings, no errors.
- Follow-up source/HTTP/context regression: PASS, 49 tests across 3 files, including Git-ignored input exclusion, source profile selection and combined execution/cleanup failure preservation.
- Engine application route regression: PASS, 1 selected test. The other 12 tests were not selected by `-t`; this is not a claim that the engine suite passed. A named application command `run` reaches the application handler and malformed arguments are rejected before invocation.
- Source CLI `template launch --help`: PASS; captured with explicit workflow, build-profile and external-service flags.
- `git diff --check`: PASS at checkpoint.

Complete latest-head test/CI and real OpenSandbox gates remain outstanding; this record does not authorize a green merge on partial evidence.

## Independent HTTP path review follow-up

A shared review found that WHATWG URL normalization can remove TAB characters and then normalize dot segments. The application URL join now rejects raw and decoded C0/DEL characters before constructing the operation URL, and validates the raw endpoint before URL parsing. Regression inputs include raw/encoded TAB traversal and encoded NUL/DEL. No request is sent for rejected paths.

- HTTP path and Provider help fixture regressions: PASS, 29 tests across 2 files.
- Interpreter environment/callback input regressions: PASS, 21 tests; malformed maps or callbacks are rejected before context creation and payload execution.
- `npm run typecheck`: PASS, exit 0 after the review fixes.
- ESLint on the changed API/transport/test files: PASS, exit 0.
- Launch help capture updated to distinguish source, managed/image and external-service workflows.

These focused checks do not replace the outstanding full-suite, remote CI and real-provider gates above.

## CI dependency and merge readiness

PR [#121](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/121) initially had no check runs because GitHub reported `mergeable=false` / `mergeable_state=dirty`. Actions was enabled; draft state was not treated as a passing CI result. The Provider catalog checkout is pinned to reviewed producer revision `9a1eaaa7659bcd8a98d321c8111a4a1340ca3227` from [Provider PR #25](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/pull/25). This dependency is pending; update the immutable pin to the verified producer merge revision before acceptance.


## Full-suite and real CI convergence follow-up

The clean lockfile installation and build were run in a native temporary checkout to avoid slow workspace filesystem access. The intermediate complete local suite returned 4,140 passed / 23 failed / 2 skipped across 185 files. These failures remain recorded; no security assertion was skipped or relaxed. Local explicit foreign-Host/envd-dial requests returned network-audit HTTP 501, and low-level TCP/TLS/WebSocket fixtures also differed locally.

The actual Ubuntu GitHub CI at CLI revision `ecfbd31b1b7920cb6253bd2fcf023fbc1cb8037b` ran both Node 20 and Node 22. Node 20 reported 4,149 passed / 9 failed / 6 skipped; both jobs failed. [CI run](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/39937561722). The nine failures were retired-schema test fixtures, help snapshots, exact-operation error expectations, and Cube application endpoint scheme/domain reconstruction. The local network-audit and low-level transport failures did not reproduce in this Ubuntu run. Docs links, typecheck/lint and installer checks passed; package build was skipped because tests failed.

The follow-up migrates test fixtures to the current schema, gives the two changed help captures a new evidence directory, and checks the exact `code.context.create` operation. Application networking now refuses providers that supply only an asynchronous URL resolver without an explicit owned endpoint descriptor, preventing a synchronous fallback from changing HTTP to HTTPS or losing the reported domain. Producer revision `de4fbf647966459feb57a35ab590b938024abe0e` supplies explicit Cube/Container/E2B endpoint descriptors and is pinned in CI pending its reviewed merge.

- Follow-up fixture/application/container regression: PASS, 178 tests across 6 files.
- Provider/engine integration with the new descriptors: 29 passed / 10 failed, all remaining failed paths are the local foreign-Host/envd network-audit paths described above. Missing-token checks and application endpoint binding assertions remain intact. The Cube fallback-domain endpoint test now passes locally.
- `npm run typecheck`: PASS, exit 0.
- `npm run lint`: PASS, exit 0; 276 warnings / 0 errors.
- `npm run check:hygiene`: PASS.
- `npm run test:standard-provenance`: PASS, 7 tests.

The updated full remote matrix, package/distribution and real provider gates remain required. No complete-suite pass or merge is claimed by this follow-up.


## Historical parity ledger migration

The parity runner includes natural-language integration tests outside the default unit command. Their generated manifests now use strict current workflow fixtures. The historical Python ledger remains unchanged: explicit replacements connect retired capability/default/build-field contracts to current rejection/no-claim regressions, including tests that moved within the Python owner repository. The checker verifies the mapped owner test class/function in its explicit owner file.

- Natural-language integration and template guide: PASS, 34 tests across 2 files; the real Python server reference was available.
- E2B endpoint descriptor regression: PASS, 10 tests. Async endpoint resolution uses the API-reported domain; the fallback-domain fixture explicitly omits the reported domain.
- Full parity runner with current SDK and provider sources: 4,167 passed / 22 failed / 2 skipped. Twenty failures remain in the previously identified local audit/TCP/TLS/WebSocket paths; two E2B reported-domain expectations were then migrated and their complete file passed as recorded above. This is not a full-suite pass.
- Latest `node scripts/parity-coverage.mjs --no-run`: PASS; 907/907 CLI ledger entries, 0 failed/skipped ledger entries, 0 missing entries; all 11 moved Python tests verified and found. This validates coverage correspondence using the full recorded report, not the outcome of every test in that report.
- `node scripts/sync-workflow-contracts.mjs --check`: PASS.
- `bash scripts/check-repo-health.sh`: PASS, 106 pass / 11 historical-context warnings / 0 failures.
- Scoped ESLint for migrated guide/NL tests: PASS.

Remote CLI revision `128f8dc6c71a9be9e28a9608e1e19f1b2e44a374` did not reach tests because its pinned Provider commit had not yet been pushed (`upload-pack: not our ref`). The producer was subsequently pushed by the coordinator. A new complete CI run remains necessary; the checkout failure is not interpreted as a pass or a test assertion failure.


## Reproducible owner verification and installed artifact

CI now pins the Python contract/test producer to `270a7a8fa72656653b485403273491fd99aeefc8` from [Python PR #89](https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/89), checks out the owner test files, and explicitly points `PYTHON_SDK_ROOT` at that checkout for parity verification. This avoids quietly leaving moved-test verification unavailable in CI. Both pending producer pins must be updated to verified merge revisions when their dependencies land.

- `make dist-check`: PASS; packaged `dist/bin/abx.js` found.
- `npm pack` and isolated global installation of the produced tarball: PASS.
- `node scripts/check-release-artifact.mjs <isolated-installed-abx>`: PASS; actual installed executable verifies version, isolated configuration guidance, a single JSON result, root/standard/native help, notices, and terminal-menu cancellation before credential input.

No live credentials or cloud resources were needed for these package checks. Standalone SEA and real-provider workflow evidence remain separate required checks.
