# Verification: Bundled Express management and template SDK loaders

- Date: 2026-10-20
- Change: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/85
- Related release tracking: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/66
- Result: PARTIAL; scoped regressions and real Linux SEA read-only acceptance pass.
  Full local tests retain exactly the clean baseline's 20 network failures;
  hosted gates and final integrated artifact acceptance remain pending.
- Pull request: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/87
- Source: base `4aec47b734be04fbadc932b0bbf4cd7ae0ac1eb4` plus the accompanying
  loader, isolated regression and license distribution changes.
  Final product revision: `cc8f13a236703c380d0e869b7466a489b0b35008`, including a
  normal merge of main `eeacf9c`; the final follow-up changes verification only.
- Environment: Linux x64, Node 22.22.2, dependencies installed with `npm ci`.
  Cloud credentials were supplied in the parent acceptance process through the
  environment, without recording values or raw cloud responses.

## What was verified

The official management and template SDKs can be loaded lazily from an isolated
CommonJS bundle without checkout dependencies. The real generated request and
client constructors remain available; the existing loader seams remain
synchronous. The SDK-specific dependency graph's shipped notices are retained in
license output, while the standard CLI notice prefix is preserved.

## Commands run

```sh
npm ci --ignore-scripts --no-audit --no-fund
node node_modules/vitest/vitest.mjs run tests/test_providers/test_bundled_alicloud_sdk.test.ts
node node_modules/vitest/vitest.mjs run tests/test_providers/test_bundled_alicloud_sdk.test.ts tests/test_providers/test_alicloud_commands.test.ts tests/test_api/test_fc_template.test.ts tests/test_cli/test_standard_executable.test.ts tests/test_providers/test_complete_isolation.test.ts
node scripts/alicloud-sdk-notices.mjs --check
npm run build
node scripts/build_binary.mjs
npm pack --pack-destination "$CANDIDATE_DIR" --json
npm install --prefix "$INSTALL_DIR" --ignore-scripts --no-audit --no-fund "$CANDIDATE_TARBALL"
ABX_BIN="$ISOLATED_SEA" npm run e2e -- --suite provider-management-cloud --filter '^(?!.*context).*' --json "$SANITIZED_REPORT"
make ci
npm run test:standard-provenance
make dist-check
bash scripts/check-repo-health.sh
```

## Results

| Scenario | Result | Notes |
| --- | --- | --- |
| Isolated SDK regression before fix | PASS reproduction | One test failed with the friendly SDK load error, proving the packaging defect. |
| Focused corrected-source suite | PASS | Five files, 121 tests, including unchanged backend isolation enforcement and expanded exact license output. |
| Attribution regeneration | PASS | 25 SDK dependency packages; original package declarations and available LICENSE/README notices retained. |
| npm source build and clean artifact installation | PASS | Tarball installed into an independent prefix; version/license output passed without checkout dependency resolution. |
| Linux SEA build and isolated license output | PASS | SDK attribution present; no external dependency directory beside the executable. |
| Real Linux SEA management acceptance | PASS | Run `20261020133213-a276c9`: volume, team, API-key and quota list all pass; four passes, one leak-check skip. |
| Initial full local CI | FAIL, followed by corrections | Initial full tests had the known 20 baseline network failures plus two license integration failures; both integration failures were corrected without relaxing isolation enforcement. |
| Final full local CI | PARTIAL | Hygiene, typecheck, lint and build pass. Full tests: 4028 pass, 20 fail, 8 skip across 169 files. The 20 failed titles exactly match the clean baseline's 20 failures, with no additional failures. CI stops at the test gate; no full-CI pass is claimed. |
| Record/link health | PASS | 105 passes, zero failures; 11 registered historical warnings. |
| Standard attribution provenance | PASS | Seven provenance tests pass; normal pinned-source replay only updates the generated root NOTICE prefix. |
| Existing `make dist-check` helper | FAIL on npm 12.0.2 | The unchanged helper expects an array from `npm pack --dry-run --json`; npm 12 returns an object keyed by package name. Direct inspection confirms the actual entry point, both SDK adapters and compiled runtime attribution are included; real tarball installation already passed. The unrelated helper is not modified. |
| Hosted CI and other native targets | PENDING | No pass is claimed before observing those gates. |

The real-cloud SEA candidate was copied outside the checkout. Its SHA-256 was
`a41870873326dae859d88ec213d4ae90bf3018d2fd14d89ffb77cccd58835bd3`.
Subsequent changes to attribution composition preserve the same SDK loading code;
final integrated artifacts remain a separate acceptance gate.

## Cleanup

The management suite performed only reads: zero sandboxes created and zero
leaked. The leak-check scenario skipped because no sandbox was created. No cloud
resource identifiers or response data are retained here.

## Problems found

The baseline's 20 transport/network failures also reproduce on a clean main
snapshot with the same sibling Provider catalog; they include intercepted 501/502,
TLS and WebSocket behavior. They are not represented as passing tests. A direct
Provider implementation import for license text and an outdated exact license
expectation were identified by the first full run and corrected without relaxing
the isolation test.
The existing package-content helper also assumes an older npm JSON shape; npm
12.0.2 returns a keyed object and makes its `[0].files` lookup fail. This is an
explicitly failed helper gate, not evidence of a missing npm entry point.

## Not verified

Mutating management operations, template creation, all 26 management operations,
other native platforms and public npm/Release publication are outside this scoped
artifact acceptance. The real npm cloud read acceptance and final integrated
artifact rerun are delegated to the parent integration acceptance and are not
claimed by this independent record. Eight local full-suite skips remain skips;
the remote matrix is required before any merge. The optional pre-commit framework
was unavailable; the repository's secret scanner ran through the normal hook.
