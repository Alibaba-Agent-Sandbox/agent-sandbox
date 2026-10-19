# Verification: Gated provider image host merge

Date: 2026-10-19
Result: PARTIAL (local environment failures; native third-party acceptance deferred)

## Scope and environment
Merge candidate combines PR42 head a28d75f685922a0a49922c62646e77cbcc4937d4 with accepted main 38185156ea2cc14ad0874e06790e4e216ba7779f. Scoped changes: optional image contracts/API/router, node factory and shared lazy SDK helper, provider-owned Express help examples, locked optional SDK, bilingual guides, CLI snapshots and owner records. Node 22.22.2; npm ci used the lockfile. Reviewed provider source is the consumer branch for awesome-providers Issue14.

## Verification
- PASS: strict typecheck and build.
- PASS: focused image/Express-boundary/standard-route/command-surface/snapshot tests: initial 170 passed; final set including complete isolation: 181 passed. The image suite includes arbitrary provider-ID SDK requests, scoped credentials, validation, strict results and cleanup, plus retained Express UI.
- PASS: actual built CLI, temporary local E2B plugin install, adapter and official locked e2b 2.55.0 SDK loopback: exactly three protocol requests, scoped provider key, private registry, CPU/memory/start/readiness mapping and safe result. Command: ABX_E2B_PROVIDER_SOURCE=<reviewed adapter> node e2e/providers/template-image.mjs.
- PASS: actual built CLI, temporary local CubeSandbox install, native CubeAPI loopback: exactly two requests, millicore conversion, independent credentials/private registry and strict result. Command: ABX_CUBESANDBOX_PROVIDER_SOURCE=<reviewed adapter> node e2e/providers/template-image-cube.mjs. No E2B ID dispatch is involved.
- PASS: adapter T0 with pinned official SDK: 14 passed, zero skipped.
- PASS: npm run lint (zero errors, 253 warnings), npm run check:hygiene, bash scripts/check-repo-health.sh (106 passes, 11 historical warnings, zero failures).
- PASS: npm run test:standard-provenance (7 tests). Standard generated source was retained from accepted main, not edited. Locked upstream source replay is additionally checked in hosted CI.
- PASS: affected CLI capture, 8 help cases, zero skips; output is under .agents/evidence/cli/2026-10-19-provider-image-beta-merge. Regenerated the current convergence from-image golden; historical captures were retained.
- PARTIAL: full npm test with SDK/provider sources: 3992 passed, 20 failed, 1 skipped (4013 total). The same 20 failures were reproduced on clean accepted main: 10 raw socket/TLS/WebSocket negative tests and 10 engine/Cube proxy cases. The environment's network interception returned audit/502 responses rather than the tests' local raw responses. Removing proxy environment variables did not remove interception. No test/assertion was weakened.
- PASS (ledger only): npm run parity:coverage reported 907/907 ledger entries, zero missing or failed/skipped, and 11 SDK moves verified. Its underlying Vitest run retains the local environment limitations above; this is not a full-suite pass.

## Integration corrections
The first attempted integration exposed duplicate from-image ownership and an Express-only guard. Those were fixed by one capability-selected route while preserving provider-owned legacy UI; the focused rerun passed. An incorrect new help expectation and a missing current convergence golden were also corrected. An earlier full run was interrupted during that fix and is not counted as a pass.

## Acceptance boundary and cleanup
The maintainer explicitly deferred third-party formal native acceptance and requested gated Beta work be merged. Independent native E2B build/create/execute/kill remains unrun and tracked in the provider Issue4. Public templates.deploy stays undeclared; only accepted Express is Stable. Express keys were not sent to E2B. No cloud/model test or cloud resource was created in this follow-up. Both installed-host fixtures closed their listeners and removed temporary HOME/provider stores in finally blocks.

The first hosted run (39219149116) found one additional isolation failure in each Node matrix: the legacy compatibility module still declared a local type alongside its concrete re-export. The type now lives with the provider-owned gate and the compatibility module consists entirely of exports. The isolation gate was retained unchanged, and explicit foreign/Express compatibility checks were added. The final affected regression set passes (see next-head CI for the complete hosted matrix).

Latest-head GitHub CI, review requirements and actual merge state must be checked before delivery; local environment failures are not hidden as passes.

https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/42
https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/41
https://github.com/Alibaba-Agent-Sandbox/awesome-providers/issues/14
