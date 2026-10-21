# Verification: Release artifact CI output

- Date: 2026-10-21
- Base: 1ab7b5676d2bee1ff7598c22d92d17b083138626
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/95
- Environment: Linux, Node.js 22.22.2, installed npm tarball, isolated directories.
- Result: PARTIAL (remote checks/publication pending)

## Reproduction

`CI=true node scripts/check-release-artifact.mjs <installed-abx-0.4.3>` failed
the stderr assertion. Actual exit status was 2, stderr empty, stdout JSON held
the actionable scaffold guidance. The five-platform v0.4.3 run failed at this
same verification stage and did not publish a release:
https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/39538514039.

## Scope

Combine stdout and stderr in that assertion. Preserve exit-status and no-write
checks, CLI output semantics, historical evidence and the existing tag. Change
package/snapshot metadata to 0.4.4; document the existing CI output contract in
English and Chinese. The product onboarding implementation remains unchanged.

## Validation

The corrected 0.4.4 tarball was packed and globally installed into an isolated
prefix. `node scripts/check-release-artifact.mjs <installed-abx>` passed with
and without `CI=true`, including exit status, guidance and filesystem checks.
`npm run typecheck`, `npm run build`, `npm run lint` (zero errors, 253 existing
warnings), `make dist-check`, hygiene, repository health and `git diff --check`
passed. Focused onboarding/terminal/help/snapshot tests: 143 passed. Version
snapshots were regenerated through `ABX_UPDATE_EVIDENCE=1`; 117 cases passed.

No product logic changed after the full-suite run documented in
[onboarding verification](2026-10-21-cli-onboarding.md). Those host failures
remain disclosed; the original PR's remote Node 20/22, parity, lint, package
and installer checks passed. New current-head CI remains required:
https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/94.

## Cleanup and limits

Only isolated local template directories are created and removed. No cloud
resources are used. Release, official mirror and default installer acceptance
are pending; npm registry access remains tracked in
https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/66.
