# Verification: Incompatible downloaded source guidance

- Date: 2026-10-25
- Result: PARTIAL (targeted tests and real CLI filesystem behavior PASS; integrated release gates pending)
- Scope: registry source loader, local capability discovery, their regressions and bilingual startup guide.
- Base: 49686a59ba2e756d07760a0ffc4ebe4b719dd041, CLI 0.5.4 candidate.
- Environment: Linux, Node 22.22.2; isolated temporary HOME and source directories.

## Executed verification

`vitest run tests/test_api/test_capability.test.ts tests/test_utils/test_registry.test.ts tests/test_utils/adv_pyos_parity.test.ts`: 91 PASS.
`tsc -p tsconfig.json --noEmit`: PASS.
`eslint src/utils/registry.ts src/api/capability.ts tests/test_utils/test_registry.test.ts tests/test_api/test_capability.test.ts`: PASS with seven existing warnings.
`npm run build`: PASS. `git diff --check`: PASS.

The installed public CLI 0.5.3 and built candidate each executed
`abx template install LOCAL_CACHED_TEMPLATE --download-only` from an unrelated
working directory with a new HOME and no platform credentials. The old manifest
contained spec_version 4 and retired workflow fields. Both exited 1 and left its
bytes unchanged. Public 0.5.3 printed the raw Zod field list and generic report-
an-issue hint. The candidate returned existing E2004, the actual manifest path,
required version, source-revision guidance and a scoped source-cache explanation.
No raw Zod or unexpected-error text remained. The adjacent
[receipt](2026-10-25-template-source-version-cli.json) preserves sanitized output.

The real filesystem and executable are used here; no fake cloud or new cloud
resource is involved. Unit tests additionally exercise matched cached discovery,
explicit local discovery, an adjacent directory outside the cache, and current
manifest loading. The original 78-test intermediate run and subsequent 91-test
run passed; an intermediate known-error wording was refined before this result.

## Limits and cleanup

No source/cache file was removed automatically. No cloud API, remote template
build or resource creation was needed to reproduce this parser failure. Full
owner/CI and real-cloud gates remain with the containing release PR; this receipt
does not claim the 50-template matrix or public 0.5.4 publication.

Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/176.
PR: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/174.

The first hygiene/health run flagged the synthetic home-path placeholder in the receipt. It was replaced with an explicit isolated-home placeholder, without allowing or suppressing workstation paths; the checks were rerun.

Independent adversarial review found that explicitly selected local source inside
the configured cache root should never receive a deletion suggestion. Explicit
local discovery now suppresses cache advice, and its regression deliberately
places the source inside that root. Source-cache advice is conditional on a
downloaded copy with an already updated remote. All 91 tests passed again.

A reused dependency symlink also correctly failed repository-health. It was
removed and dependencies were installed with the lockfile using `npm ci`.
Final health: 106 PASS, 11 historical warnings, zero failures; hygiene PASS.
No checker exemption, dependency-permission expansion or bypass was added.
