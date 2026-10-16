# Verification: Server wheel Dockerfile structure

- Date: 2026-10-16
- Change: Issue https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/36 and ADR `2026-10-16-server-wheel-dockerfile-structure`
- Result: BLOCKED
- Binary/package: @agent-sandbox/cli 0.3.0, source based on main `7854c314055fd9c196332babffca7c2aa608f805` plus the scoped builder/test/docs/record changes
- Environment: Linux, Node.js 22.22.2, npm 10, repository package-lock.json installation

## What was verified

The actual exported rewrite function reproduced COPY inserted into a continued else branch when
called with the current agents-cli Dockerfile and a server wheel name. The regression suite added
seven initial cases: six failed against unchanged main and one passed. After the fix, complete
RUN instructions retain conditionals, continuation commands and unrelated operands. Additional
regressions protect echoed control words, literal heredoc text and multi-stage copies.

## Commands run

- `npm ci --registry=https://registry.npmjs.org`: completed using the existing lockfile.
- `node node_modules/vitest/vitest.mjs run tests/test_api/test_dockerfile_server_wheel.test.ts`: baseline 6 failed / 1 passed, confirming regression.
- `node node_modules/vitest/vitest.mjs run tests/test_api/test_dockerfile_server_wheel.test.ts tests/test_api/test_docker_builder.test.ts`: 48 passed.
- `npm run typecheck`: pass.
- Scoped ESLint: zero errors; one pre-existing no-useless-assignment warning in the unchanged builder code.
- A Node source-import harness called the actual export for 17 current template Dockerfiles: no split else/standalone continuation output; CMD, ENTRYPOINT, USER, WORKDIR and EXPOSE unchanged.
- `make ci`: hygiene, typecheck, ESLint and build passed; the full test phase had 3756 passed, 37 failed and 2 skipped across 154 files. It exited nonzero and did not reach subsequent parity/package targets.
- Same-environment untouched main baseline: 3746 passed, the same 37 failing test identities, and 2 skipped across 153 files. New failures: none. The ten additional passing tests are the new wheel regressions.
- Failures include Docker-dependent template install prechecks, HTTP 501 transport/provider fixtures, archive directory modes, color-warning and Python-oracle differences; they remain failures, not waived passes.
- `npm pack --dry-run --json`: pass; built dist/bin/abx.js is included.
- `npm run check:hygiene`: pass.
- `bash scripts/check-repo-health.sh --quiet`: 10 failures / 5 warnings. The untouched baseline has exactly those ten failures plus its temporary dependency-symlink diagnostic. No new health failure is introduced. Existing findings cover unresolved dependency-source text detection, retained Python parity fixtures, missing examples/history links, historical paths/slugs and en/zh design drift.
- Scoped README/guide/ADR relative-link check and `git diff --check`: pass.
- With the real built binary and cloud credentials supplied only in memory, `node e2e/run.mjs --suite docker-deploy`: 3 SKIP, Docker preflight `spawnSync docker ENOENT`, no resources created/leaked. This is BLOCKED, not a passing deployment.
- The first isolated E2E probe used a relative binary path and did not inherit credentials; its version probe failed and cloud checks skipped. The corrected absolute-binary/credential probe above establishes the actual Docker blocker.
- A first parity attempt inherited the platform's broken npm 12 launcher. The corrected `npm run parity:coverage` with npm 10 completed with a failing ledger result: 907 entries, 901 passed, 6 failed/skipped, 0 missing; the six failures are existing Docker-dependent template-install cases. Eleven entries moved to python-sdk were not verified by the standalone worktree layout.

The full-test baseline was executed from an untouched detached checkout of the exact base
revision, using the same Node, locked dependencies and test fixture environment. Comparing
all failing test identities produced identical sets: 37 failures in each, no added failure.
The baseline-only health diagnostic is its intentionally reused dependency symlink; the
contribution worktree has a normal lockfile installation and does not trigger that diagnostic.

## Independent source review

A separate contributor reviewed the changed builder implementation and all ten new regression
cases line by line. The review covered complete instruction boundaries, quoted operands,
conditional branches, other package requirements, multi-stage copies and heredoc preservation;
no blocking defect was identified within this scope. The reviewer confirmed that the actual
system-shell syntax check exercises the original failure. This is independent source review,
not a Docker image build or deployment result.

## Results

| Scenario/test | Result | Notes |
|---|---|---|
| Conditional wheel/archive RUN | PASS | Real shell syntax check; one complete RUN |
| Continued direct install | PASS | Commands before/after and extra package arguments retained |
| Unrelated exact pins/examples/comments | PASS | No package-name-prefix or arbitrary URL rewrites |
| Heredocs and exec form | PASS | Retained verbatim |
| Actual current Dockerfile materialization | PASS | Export called without mocks; 17 templates |
| Docker image build and cloud deploy | BLOCKED | No Docker executable/usable daemon available |

## Cleanup

No cloud sandbox or template was created by the materialization/unit checks or the Docker-preflight-blocked E2E run. The transformation
runs in memory and leaves original template Dockerfiles untouched. Real cloud resource checks
cannot be inferred from these local results.

## Problems found

https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/36 records the reproduced defect.
The fix does not claim automatic rewriting of embedded scripts or JSON exec-form programs;
those must declare their own wheel install. CI images using original Dockerfiles plus a wheel
are not evidence that the CLI's materialized Dockerfile deploy path works end to end.

## Not verified

Real Docker builds, source-wheel template deployment, deployed SDK command invocation and the
remote Node 20/22 matrix are not established by local unit/shell-syntax checks. The mandatory
product E2E gate remains BLOCKED; keep the PR draft and the ADR proposed.
