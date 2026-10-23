# Verification: npm readback recovery

- Date: 2026-10-23
- Result: PASS for workflow recovery regressions and actual public package/artifact verification; final CI/merge/recovered workflow and website readback are tracked separately.
- Runtime source remains immutable v0.4.8 at ea0b25f4623a80ad9f82f7227892e6a585328baf. This patch changes workflow recovery, tests and documentation only.

## Observed failure and public recovery

[Original release workflow](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/39891094880) successfully published 0.4.8 with signed provenance, then exhausted six five-second install readbacks with ETARGET. Public metadata became visible later; the failed run is preserved rather than reported as passing.

The public tarball was downloaded and verified against npm SHA-512 integrity and SHA-1. The original workflow's npm-release-candidate ZIP was downloaded using authenticated fixed-origin discovery with credentials removed before the storage redirect; its artifact digest was verified. The extracted original candidate equals the public tarball byte-for-byte. A local temporary build tarball differed, so it was not used as publication identity evidence.

Actual `npm install --global --prefix PRIVATE_PREFIX @agent-sandbox/cli@0.4.8 --registry=https://registry.npmjs.org --prefer-online --cache PRIVATE_CACHE` passed. `node scripts/check-release-artifact.mjs PRIVATE_PREFIX/bin/abx` passed version, isolated guidance, single JSON output, root/standard/native help and complete notices. After these equivalent gates passed, the exact public/original-tested candidate and SHA-256 were attached to the existing release; all 12 platform/npm/checksum assets were present. Existing website refresh was dispatched; no new FC/SLS resource was created.

## Executed regression checks

| Check | Result |
| --- | --- |
| Actual workflow scripts, controlled registry/readback responses | PASS: 33 tests across new recovery and existing publication workflow suites |
| Missing/matching/mismatched/malformed/unavailable metadata | PASS: only exact immutable version/integrity match permits skipping publication; ambiguous cases fail closed |
| Delayed and permanent install failures | PASS: fresh online metadata/cache per attempt, success stops retry, permanent failure stops at 30 attempts and skips artifact checker |
| Readback wall-time bound | GitHub Actions step timeout is 10 minutes in addition to the attempt bound; configuration asserted by regression |
| Actual public npm installation and artifact smoke | PASS |
| Public tarball vs original CI-tested candidate | PASS: identical bytes, registry integrity and workflow artifact digest verified |

Types/lint/health/hygiene and current-head CI are finalized before merge; final outcomes and recovered existing-tag workflow are recorded in the PR and [Issue #111](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/111). No runtime version, tag, cloud API, diagnostic service or template qualification is changed by this workflow repair.
