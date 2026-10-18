# Verification: optional provider image template host

- Date: 2026-10-18
- Result: PARTIAL. Local installed-host and official-SDK acceptance passes; native
  provider deployment and catalog activation remain undelivered. Keep the PR draft.
- Base: `62cb6c923058f3b5d52df6dcaf1915ed4ce4b5cc`; scoped source includes
  `src/api/provider_template.ts`, the optional provider contracts/factory, CLI
  route, pinned optional dependency, regression/evidence and bilingual docs.
- Environment: Linux, Node 22.22.2, npm lockfile installation. All integration
  credentials were synthetic loopback fixtures; no real cloud credentials used.
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/41

## Commands and actual results

- `npm ci --no-audit --no-fund`: PASS, 231 packages; npm reported two dependency
  install scripts blocked by its current policy. No install policy was overridden.
- `npm run typecheck`, `npm run build`, `npm run lint`: PASS; lint retains 221
  existing warnings, zero errors.
- `node node_modules/vitest/vitest.mjs run tests/test_providers/test_image_templates.test.ts tests/test_cli/test_command_surface.test.ts tests/test_cli_evidence/test_evidence_snapshots.test.ts`:
  151 PASS. Invalid requests, unsupported providers, scoped config, arbitrary
  cancellation reasons, response allowlisting and synchronous/asynchronous cleanup
  failures are covered. Array-shaped sources are rejected.
- `ABX_UPDATE_EVIDENCE=1 node node_modules/vitest/vitest.mjs run tests/test_cli_evidence/test_evidence_snapshots.test.ts`:
  111 PASS; reviewed the changed template help and new from-image help snapshot.
- `node scripts/capture-cli-evidence.mjs --command help-template --out .agents/evidence/cli/2026-10-18-provider-image-host`:
  8 actual cases, zero skips; new dated captures preserve old evidence.
- `ABX_E2B_PROVIDER_SOURCE=<reviewed-e2b-directory> node e2e/providers/template-image.mjs`:
  PASS, repeated independently by the provider reviewer. Built CLI, real local
  installer/consent/integrity, actual catalog adapter and official E2B 2.55 SDK
  execute create/trigger/status through loopback. Checks include CPU/memory,
  start/readiness, scoped provider key, private registry auth and exact ready result.
- With only the owned optional E2B module temporarily hidden: full TypeScript
  check, built CLI version and image-command help all PASS. The module was restored
  in a finally block. No static SDK import is required for ordinary CLI operations.
- Full `npm test`: 3783 PASS / 37 FAIL / 2 SKIP. Independently installed untouched
  base: 3751 PASS / 37 FAIL / 3 SKIP. The exact 37 failing test identities match;
  no newly failing identity. These include platform HTTP/WebSocket restrictions,
  Docker-dependent install and existing transport expectations; local failures are
  retained as failures. The final help-only evidence case was added afterwards.
- `npm run parity:coverage`: 895/907 passed; 12 failed/skipped, zero missing;
  11 moved SDK entries could not be verified in this isolated checkout layout.
- `bash scripts/check-repo-health.sh`: 105 PASS / 11 historical WARN / zero FAIL
  on the final record/link run. `npm run check:hygiene` and scoped diff checks PASS.
  An initial final-health run found the owned ignored parity JSON report plus
  a capture-directory slug mismatch. Removing only that generated report and
  aligning the new dated capture slug resolved both; historical files are unchanged.

## Review

The independent provider review found that arbitrary AbortSignal reasons could
escape before the provider catch, and trusted host prerequisite messages were
being erased. Pre-cancellation now has a fixed message; a host-only error type
carries only fixed prerequisite text. Third-party error bodies remain omitted.
The reviewer also found an array-shaped source mismatch; explicit object checks
now match the provider adapter. The reviewer reran focused tests and the actual
installed-host SDK integration successfully.

## Cleanup

Integration closes the loopback server/all connections and removes only its
owned temporary provider store. Factory regressions check HTTP cleanup on success,
factory failure, invalid adapters/results and plugin-close failure. No cloud
sandbox, template, registry image or repository was created by this change.

## Outstanding gates

Native E2B build/create/execute/kill has not run: no authorized native E2B account
is configured. Express-compatible E2B-named credentials are never sent to E2B.
No complete Docker/ACR deploy wrapper, public package installation, Python deploy
API or remote engine deployment route is asserted. The unmodified E2B catalog
manifest stays unopted. Shared SDK and registry schema delivery are separate PRs;
this host remains draft even when its normal CI passes.
