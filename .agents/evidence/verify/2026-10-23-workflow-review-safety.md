# Verification: workflow review safety

- Date: 2026-10-23
- Change: [Issue 122](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/122); `fix/workflow-review-20261023`, based on main `475848c`.
- Result: PARTIAL — focused local verification passes; full local and latest-revision cloud acceptance are pending.
- Binary/package: current CLI 0.4.10 source, Node.js 22.22.2, Linux. Dependencies installed with `npm ci` from the unchanged lockfile (233 packages). The local npm policy blocked two dependency postinstall scripts; the actual build still passed.

## What was verified

An independent review reproduced malformed discovery/catalog acceptance and a known-sandbox leak on journal failure. The fix requires strict v2 discovery and exact identity endpoint admission before payload, preserves creation ownership through failures, and establishes file/directory journal sync before mutation.

## Commands run

- `vitest run tests/test_api/test_sandbox.test.ts tests/test_providers/test_template_launch.test.ts tests/test_template/test_workflow_plan.test.ts tests/test_template/test_resource_journal.test.ts tests/test_transport/test_application_http.test.ts`: intermediate revision 145 PASS.
- Current Python `SandboxServer` process with restricted named-command policy: CLI verifies v2, lists `add`, returns 42 for `add(x=20,y=22)` with the application identity; wrong identity is refused during discovery. PASS; server stopped in `finally`.
- Final focused regressions: `vitest run tests/test_api/test_sandbox.test.ts tests/test_providers/test_template_launch.test.ts tests/test_template/test_resource_journal.test.ts tests/test_api/test_application_protocol.test.ts tests/test_utils/test_template_index.test.ts tests/test_transport/test_application_http.test.ts tests/test_template/test_workflow_plan.test.ts`: 7 files / 204 PASS.
- `npm run typecheck`: PASS. `npm run lint`: PASS (0 errors; existing warnings retained).
- `npm run build`: PASS on final token/response/recovery/durability source. Independent root verification of `npm install --global --prefix ISOLATED_PREFIX .` followed by `abx template launch --help`: PASS; workflow, build-profile and service-url options are present. The same compiled source is under separate cloud verification.
- `bash scripts/check-repo-health.sh`: 105 PASS, 11 historical-context warnings, 0 FAIL after installing actual dependencies; `npm run check:hygiene`: PASS.
- `npm test -- --maxWorkers=4 --reporter=json --outputFile=parity/.vitest-report.json`: full current suite running. Earlier full runs were interrupted after code changed; they are not passes. Parity will consume the completed report without rerunning the same suite.

## Results

| Check | Result | Notes |
| --- | --- | --- |
| Independent reproductions | PASS | Pre-fix known-ID persistence failure: no kill/close; malformed 200 catalog: empty array; direct payload without discovery |
| Current Python application server | PASS | Real localhost HTTP; correct identity succeeds, wrong identity fails before payload |
| Final focused regressions | PASS | 204 tests; real HTTP valid/invalid/denied protocol, exact run/list/health, token preflight, strict result/null, recovery attributes and fsync chain |
| Typecheck, lint and build | PASS | Final reviewed production source |
| Record and hygiene checks | PASS | 105 record checks; known historical warnings retained |
| Full local unit/parity | PENDING | Current report still being generated |
| Required cloud acceptance | PENDING | Separate latest-revision OpenSandbox workflow and cloud-lifecycle runs, coordinated by the root task |

## Cleanup

Local HTTP servers and Python application process were closed. Temporary reproduction source and isolated configuration were removed. This agent did not create cloud resources.

## Problems found

The above two P1 runtime findings and missing journal sync were fixed locally. Bilingual catalog design still documented a retired v1 index and capabilities field; it now matches the strict v2 locator format. CLI schema-upgrade guidance referenced pip, and current source-install instructions hardcoded a retired tarball filename; both now target the actual CLI installation paths. Historical release facts and evidence are unchanged.

## Not verified

Remote CI and latest-revision real-cloud acceptance are not represented by earlier source revision results. No package was published or deployed by this verification.
