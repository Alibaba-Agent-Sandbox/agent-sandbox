# Verification: CLI 0.4.11 integration

- Date: 2026-10-24
- Change: [Issue 126](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/126).
- Base: main ee359fd; previous local candidate 88ce9ca. Integrated runtime commits: 43965fd and 8fba58e.
- Result: PARTIAL; local full-suite network cases are environment blocked, remote gates pending.
- Runtime: Linux, Node 22.22.2, npm 12.0.2. Secrets were loaded only into child process environments.

## What was verified

The earlier runtime fixes are integrated with current main's workflow admission and durable
cleanup. Release fixture pins now match normal CI; the package candidate is 0.4.11.
A local-disk verification copy avoids slow mounted storage: all 920 tracked runtime, test,
E2E and script files were byte-compared with the integrated Git tree before checks.
No production-code changes followed the real-cloud run; only package version/release
metadata changed from 0.4.10 to 0.4.11, followed by fresh build and artifact verification.

## Commands run

- `npm ci --no-audit --no-fund`
- `npm run typecheck`; `npm run build`; `npm run lint`
- `npx vitest run tests/test_engine/test_initialize.test.ts tests/test_engine/test_sse_backpressure.test.ts tests/test_providers/test_runtime_loading.test.ts tests/test_providers/test_contract_kit.test.ts tests/test_agent/test_mcp.test.ts tests/test_skill_installation_docs.test.ts tests/test_agent/test_mcp_http_wire.test.ts tests/test_cli/test_package_entry.test.ts`
- `npm test -- --maxWorkers=4 --reporter=json --outputFile=parity/.vitest-report.json`
- Six affected test files against unchanged main ee359fd, with identical pinned fixtures.
- After version bump: `npm run build`, MCP/package tests, `npm run e2e:offline`, `make dist-check`.
- `npm pack`, fresh-prefix global install of the exact tarball, then `node scripts/check-release-artifact.mjs INSTALLED_ABX`.
- `npx vitest run tests/integration/test_cli_e2e.test.ts tests/integration/test_nl_template_init_e2e.test.ts`
- `ABX_BIN=BUILT_ABX node e2e/run.mjs --suite cloud-readonly,cloud-lifecycle --json REPORT --markdown REPORT`

Full tests use Python fixture 270a7a8fa72656653b485403273491fd99aeefc8 and providers
fixture de4fbf647966459feb57a35ab590b938024abe0e via the existing documented fixture variables.

## Results

| Check | Result | Scope |
| --- | --- | --- |
| Lockfile installation | PASS | npm policy blocked two dependency postinstall scripts; actual build and runtime checks passed |
| Typecheck, build, lint | PASS | 0 lint errors; 273 existing warnings |
| Focused runtime/Skill regressions | PASS | 96 tests |
| Integrated full npm test | FAIL / environment blocked | 4277 passed, 20 failed, 2 skipped |
| Unchanged current-main baseline | Same failures | Six affected files: 39 passed, the identical 20 test-name failures |
| Final-version MCP/package tests | PASS | 59 tests against 0.4.11 |
| Offline E2E | PASS | 81 passed, 1 resource-leak check skipped because no cloud resources were created |
| Additional integration files | PASS | 26 tests |
| Package contents and actual fresh install | PASS | Complete Skill reference closure; installed 0.4.11 version, menus, JSON, help and licenses |
| Real Express read-only/lifecycle | PASS | 71 passed, 0 failed/skipped; 2 owned sandboxes; 0 leaked and 0 unresolved creates |
| Complete parity first run | FAIL | 4302 passed, 21 failed, 2 skipped: existing 20 environment failures plus stale 0.4.10 version golden |
| Version evidence repair | PASS | Captured 0.4.11 into a new golden directory, preserving historical evidence; full evidence-file regression passes |
| Final complete parity rerun | PENDING | Record actual result before release |
| Remote CI/review | PENDING | Required on the final reviewed head |

The 20 local full-suite failures remain the existing managed-network HTTP/TLS/proxy and
WebSocket failures, including intermediary 501/502 responses. The exact test-name set was
reproduced on unchanged current main ee359fd, whose public Node 20/22 CI was independently
observed green. Assertions and transport behavior were not weakened. That upstream CI does
not replace CI for this candidate.

## Real component scope and cleanup

Cloud run `20261024020221-151d8c` ran 02:02:21–02:04:20 UTC. It exercised the exact
integrated production source with its pre-bump 0.4.10 metadata; the tested installed release
artifact subsequently reports 0.4.11. All 71 checks passed, including independent final
inventory: two owned sandboxes deleted, no unconfirmed IDs, no unresolved creation attempts.
No global cleanup command was used.

The application scenario explicitly uploaded the reviewed python-hello commands from
[4235f53](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/tree/4235f53a8d8c74e504f0441d985ab26243889b4f/python-hello),
SHA-256 `819dd5d91a67edc9d681b01dc44caac479c6d693d947f1818d5a1253cc9b9ceb`, to
`/home/user/app/commands.py` and ran exactly
`agent-sandbox-server serve --port 9000 --commands /home/user/app/commands.py`.
This proves managed-sandbox/current-uploaded-fixture interoperability, not preinstalled image
contents or native source-image construction. Local engines and temporary test resources were
closed by their test teardown.

## Not verified

Latest-head remote CI, required review, merge, npm publication and public artifact readback
remain separate gates. No release has been published by this verification.
