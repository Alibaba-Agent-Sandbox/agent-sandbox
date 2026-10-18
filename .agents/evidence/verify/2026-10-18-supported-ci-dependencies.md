# Verification: supported CI dependency updates

- Date: 2026-10-18
- Result: PARTIAL; latest-head hosted matrix pending
- Scope: setup-node PR 6 rebased by ordinary merge on main 2eca074, dependency bot policy and bilingual contributor guides.

## Checks

- Reviewed PR 6: only setup-node references change from v4 to v7 in CI and
  release workflows; upstream `actions/setup-node` v7 action.yml runs node24.
  Installed runtime targets remain Node 20/22 for CI and 22 for releases.
- PR 7 current-head Actions run 38443667158 fails dependency installation in
  all three jobs; lockfile has TypeScript 7.0.2 while current typescript-eslint
  peer requires >=4.8.4 <6.1.0. No forced peer resolution attempted.
- PR 9 run 38443456338 fails Node 20/22 CLI behavior assertions; annotations
  identify argument-error exit/text differences. Commander 15 lock metadata
  requires Node >=22.12.0, conflicting with advertised Node >=20.
- PR 10 run 38443466742 fails typecheck on Node 20/22 and lint job:
  `adv_mcp_http_header.test.ts` passes string | NonSharedBuffer to a Buffer
  parameter. Runtime/type major migration remains separate work.
- YAML parse of dependabot plus all three modified workflows: PASS.
- Exactly three major-only ignores; patch/minor updates retained: PASS.
- Runtime package.json/package-lock.json unchanged from main: PASS.
- `npm ci --no-audit --no-fund`: PASS, 210 packages. npm 12 blocked two
  unapproved dependency install scripts; no allowlist bypass performed.
- `bash scripts/check-repo-health.sh`: 105 PASS / 11 historical WARN / 0 FAIL.
- `bash scripts/check-no-local-paths.sh`: PASS.
- Initial health attempt using a symlinked node_modules was rejected by the
  repository guard. Removed the symlink, installed from the lockfile, and
  reran successfully. No commit/publish from the rejected dependency layout.

## Remaining gates

Publish the scoped update to PR 6 and inspect all latest-head CI/review gates.
The earlier six successful checks do not establish acceptance of the new head.
No release dispatch, package publication or skipped cloud deployment is claimed.
The three incompatible version PRs remain unmerged; decline them with this
policy/evidence after review, without recording their failing checks as passes.
