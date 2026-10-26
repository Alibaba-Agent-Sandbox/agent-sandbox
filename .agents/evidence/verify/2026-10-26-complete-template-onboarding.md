# Verification: complete template onboarding

- Date: 2026-10-26
- Result: PASS for scoped onboarding/configuration behavior; remote review/CI and merge checked separately.
- Change: scoped onboarding/configuration/source/PAX changes on refactor/operation-inputs-20261026, based on bf1bdda02f3a0e553b94c018624a2bc3a134e9e7.
- Environment: Linux, Node 22.22.2, Python 3.13. CLI 0.5.6 built from candidate source; this is not a public release.
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/189.

## What was verified

A fresh home can initialize with hidden Sandbox credentials, generate and save application authentication, search/select a catalog template, confirm billing, create on real Express and execute remotely. Missing local/remote/generated template application inputs reuse guided configuration before any preparation/create. Automation, cancellation, explicit precedence and secret isolation have regressions. SDK configuration remains noninteractive.

## Commands run

- npm ci — PASS using the lockfile.
- npm test — PASS: 204 files, 4542 tests, 8 conditional skips without the server-SDK source path. The workspace filesystem caused initial child-process timeouts; the identical candidate was verified in a filesystem-local checkout.
- npm run parity:coverage with SDK/provider source paths — PASS: 907/907 ledger entries, zero failed/skipped/missing; 11 moves verified in the SDK.
- npm run typecheck; npm run build — PASS.
- npm run lint — PASS (baseline warnings, zero errors).
- npm run build:binary — PASS: Linux x64 standalone version smoke test; final binary SHA256 f02aabcaefd8aea6b6a3f20872651078c4fa65387d200e5e9647300fb92e065c. Real initialization/catalog/create/remote-exec/404-cleanup also passed with this final standalone binary.
- ABX_UPDATE_EVIDENCE=1 vitest run tests/test_cli_evidence — PASS: 119 tests. New onboarding-20261026 snapshots preserve prior history.
- node scripts/capture-cli-evidence.mjs --out <new dated evidence directory> — PASS: 118 cases, zero skipped. Changed command groups are retained separately.
- vitest run tests/test_cli/test_setup_journey.test.ts tests/test_cli/test_template_application_setup.test.ts — PASS: 12 tests before the additional exact-name ordering regression.
- ABX_BIN=<candidate> node e2e/initialized-template.mjs — PASS: real terminal initialization through catalog creation, saved hidden input, generated token, remote execution and independent cleanup.
- Real managed base launch --yes — PASS, separately deleted and independently queried afterward.
- ABX_BIN=<candidate> node e2e/initialized-template.mjs --application — PASS against an existing real python-hello template: missing application token prompted and generated, same token injected at creation and reused by a subsequent sandbox command list; independent HTTP 404 cleanup confirmed.
- Final full suite with exact reviewed SDK 8e610a3658040d8d6973e7951f9590ea50a4d70a/provider 126a50e3c4e4c6792019b9c96674d35a9518d8ad dependencies — PASS: 204 files, 4550 passed, 2 conditional skips. Includes all 13 new behavior scenarios (exact-name ordering and saved declared model configuration included).
- bash scripts/check-repo-health.sh --quiet — PASS (105 pass, 11 baseline warnings, 0 failures).
- npm run check:hygiene — PASS.

- Fresh `npm run build` → `npm pack` → install into an empty prefix → real initialized-template E2E — PASS: the installed package completed initialization, catalog selection, cloud creation, remote execution and independent HTTP 404 cleanup. The archive contains all four new runtime modules; SHA1 21738ac0d3e459362156b300125a99b71085f08b. The first packaging probe used stale dist after only rebuilding SEA; rebuilding the npm distribution corrected the candidate before this successful clean installation. No package was published.

## Cleanup

Owned successful sandbox creations were deleted and independent authenticated HTTP GET returned 404. The terminal test uses an isolated home and removes its saved configuration. No existing user resources or configuration were changed.

- Real PTY hidden-input tests — PASS, 29 tests with immediate input and prompt-readiness assertion. The new assertion reproduced the pre-fix failure; the shared reader now prepares terminal input before displaying its prompt.

## Problems found

The first automated catalog test selected a description match ahead of the exact name and waited at source-build confirmation. The picker now prioritizes exact template names and has a regression. That attempt did not submit a build/create. Mounted-checkout cold starts caused test timeouts; verification copies contain the same tracked source plus scoped patch, without altered tests or timeout settings.

Two optional catalog-plugin cases hit an ambient external network route in a concurrent full run but passed alone (8/8). They now use the repository's existing isolated-home fixture, matching the other provider tests; the full pinned-dependency run is repeated. An initial application-test fixture installed a console script outside PATH and failed startup; independent 404 cleanup passed. The final application test uses the existing python-hello service instead of installing into a bare base image. A separate diagnostic sandbox also confirmed this PATH cause and was deleted with absence readback.

## Not verified

Full source-template Docker/ACR builds are blocked by missing Docker in this runner. A managed base receipt does not certify all source templates, models, providers or a public package publication. Application-service cloud verification passed as described above. Remote review/CI must pass before merge; no pending check is a pass.
