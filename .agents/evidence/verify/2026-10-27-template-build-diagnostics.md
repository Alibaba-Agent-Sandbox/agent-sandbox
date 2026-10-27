# Verification: template build diagnostics and CLI 0.5.7 candidate

- Date: 2026-10-27
- Change: Issue 197; template-build-diagnostics decision.
- Result: PASS for the candidate diagnostics/source-journey scope. Publication and public-package reruns are separate pending work.
- Package: local CLI 0.5.7 candidate, compiled from the scoped branch based on f537b0bad646fcce0d0a89b3cbcd45a13c828d5d.
- Environment: Linux, Node 22.22.2, Docker 26.1.5, Express cn-hangzhou. Credentials supplied only through ignored environment sources or masked terminal prompts; no values recorded.

## What was verified

A real failing Docker RUN now returns E7020, controlled build diagnosis and recovery-journal guidance. A deliberately printed synthetic secret is absent from CLI JSON and stderr. The journal contains one unresolved local-image intent and no image push, template registration or sandbox creation.

## Commands run

```sh
npm ci --ignore-scripts --no-audit --no-fund
npx vitest run tests/test_providers/test_template_launch.test.ts tests/test_api/test_docker_builder.test.ts
ABX_UPDATE_EVIDENCE=1 npx vitest run tests/test_cli_evidence/test_evidence_snapshots.test.ts
ABX_BIN=abx node e2e/template-build-failure.mjs
make ci
bash scripts/check-repo-health.sh --quiet
```

[Dated real CLI failure capture](../cli/2026-10-27-template-build-failure.md).

## Results

- Focused tests: 95 passed before version snapshot changes.
- Final complete fixture-enabled Vitest rerun (including integration files): 4,596 passed, 7 skipped, 0 failed (JSON reporter). Skips: three tests require the temporary directory itself to be a mount; two unreadable-file tests skip under root; one requires a live local OpenSandbox server; one requires Python SDK user docs. These are reported as skipped, not passed.
- Golden evidence: 119 passed; new dated 0.5.7 version capture preserves old version history.
- Real local Docker failure: PASS, including journal inspection and no remote submissions.
- Real default-network PyPI failure: PASS for diagnostics: E7020 now explicitly identifies network access failure/timeouts and suggests Docker DNS/proxy/HTTPS/MTU checks. No push or cloud creation was submitted.
- Initial make ci: FAIL, including two intended behavior/snapshot assertions now updated and environment-dependent local network failures. Ordinary-user loopback requests received an external 501/502 response, including an audit-disabled response; running the same 12 adversarial transport tests as the Docker-enabled root test account passed all 12. The root-account rerun passed; the fixture-enabled complete rerun also passed. These initial failures are not counted as passes.
- Final make ci: PASS. Normal unit command: 4,570 passed, 7 skipped; parity/full Vitest: 4,596 passed, 7 skipped; all 907 ledger entries passed, 0 failed/skipped/missing, 11 moved Python tests verified. Typecheck/build/hygiene/package checks passed. ESLint: 0 errors, 275 existing warnings.
- Final repository health with these records: 105 PASS, 11 pre-existing WARN, 0 FAIL.

## Build network diagnosis

The same official base image cannot complete PyPI HTTPS handshakes in the default Docker bridge (MTU 1500), while the actual host interface MTU is 1450. Host networking succeeds. An owned bridge configured with MTU 1450 succeeds for the same PyPI request; an owned BuildKit worker attached to that network completes a real RUN downloading the full public websockets index. This verifies an environment network mismatch; it does not establish a missing dependency or an invalid server version pin. TLS verification remains enabled.

Source acceptance uses that isolated, owned build worker and a test-only Docker launcher selecting it with explicit load into the local image store (installed buildx 0.13.1 lacks default-load). The product does not force host networking or modify the shared Docker daemon. Default networking on this host is not claimed fixed. Candidate source acceptance passed for both python-hello (174.0 seconds) and OpenCode (184.7 seconds). Each started from an empty home, entered Sandbox and build credentials through one initialization/catalog/build terminal journey, saved a generated application token, built/pushed/registered, reached readiness and reused saved configuration from later CLI processes. python-hello ran hello and actual Python code. OpenCode verified its pinned 1.19.0 binary, configuration/state permissions and a real dashscope/qwen3.8-flash model/tool task using explicitly supplied model environment settings. Both downloaded a generated summary.txt with exact bytes `total=51.30\n`, SHA-256 `8892711018b518692eeeff69c760c9de488c9f5ea155fd3e1a56535e333c22a1`. Raw terminal and model transcripts are not persisted. The original direct OpenCode command will be rerun with the public package after publication.

## Cleanup

The deliberate failure submits no cloud resource. Its temporary project, configuration home and journal are removed. Both candidate sandboxes were killed and independently returned HTTP 404. Both unique templates were deleted and absent from a subsequent native template inventory. The python-hello unique local image tag was removed; its exact journaled ACR tag was deleted through the official personal-registry tag API and independently returned HTTP 404. The OpenCode unique local and remote image tags were also removed, with independent remote tag HTTP 404. Final isolated build-worker removal remains pending; retained registry tags are never reported as deleted without readback.

## Problems found

Docker bridge MTU mismatch in this environment. Generic CLI E8002 is corrected by this candidate. Public CLI remains 0.5.6 until normal publication completes.

## Not verified

Publication, fresh public npm/standalone installation and post-publication source journeys are pending. No claim is made for the entire template/provider matrix.
