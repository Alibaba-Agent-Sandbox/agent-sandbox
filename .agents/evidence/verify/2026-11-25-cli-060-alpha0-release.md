# Verification: CLI 0.6.0-alpha.0 preparation

- Date: 2026-11-25
- Change: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/270
- Result: PARTIAL — preparation checks are in progress; public release is pending.
- Package under test: @agent-sandbox/cli 0.6.0-alpha.0, based on main c268608d6a3f917c6d07b7feaa24ab54f25e8fdf.
- Environment: Linux x64, Node 22.22.2, npm 12.0.2. No credentials are written into evidence.

## What was verified

The official npm registry initially reported only latest=0.5.10, without next or
0.6.0-alpha.0. The website stable mirror reported v0.5.10. No existing open
release Issue/PR was found before Issue 270 was created. This change prepares a
distinct preview identity for the already merged command contract.

## Commands run

- npm ci --no-audit --no-fund
- npm run typecheck
- npm run lint
- npm run build
- Version-only snapshot regeneration into the new cli-060-alpha0-20261125 batch.
- node scripts/capture-cli-evidence.mjs --command version --out .agents/evidence/cli/cli-060-alpha0-20261125

## Results

- Locked dependency installation, typecheck, lint and build passed. ESLint has no errors; existing warnings are retained.
- The actual version snapshot passed. The capture ran one case with zero skips.
- Complete tests and the installed candidate are pending in this record.
- Before preparing this version, the final PR 269 source head f84ab4a398b04c163007bc178475ebb8d8104550 had successful CI, Docs links, Generated MCP artifact and Express source workflow acceptance runs. Its five CI jobs passed, including both Node test/parity versions and the actual installed npm package. These are inherited-runtime evidence, not exact-head checks for this PR.

## Cleanup

No cloud resources, management keys, image registries or deployments were created.
Local test directories and installed candidate artifacts are owned by this run.

## Problems found

None introduced by preparation at the time of this record. Complete aggregate
results and any environment limitations will be recorded before review.

## Not verified

No npm package or GitHub prerelease has been published by this change. Five
platform binaries, public registry installation, dist-tags and final exact-head
CI/review remain release gates. The runtime's scoped existing real-component
verification does not establish all Providers, complete OpenAPI support or a
production SLA.
