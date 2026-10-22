# Verification: npm provenance repository capitalization

- Date: 2026-10-22
- Change: recovery publisher, package repository metadata and workflow regression tests; Issue https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/66
- Result: PARTIAL (local candidate/cloud passed; registry publication follows reviewed merge)
- Package under test: @agent-sandbox/cli 0.4.6
- Environment: Linux, Node 22; credentials supplied through ignored environment sources and CI secrets only (values not recorded).

## What was verified
The refreshed token passed earlier registry authentication/2FA barriers. [Recovery run 39747770683](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/39747770683) passed typecheck, build, full unit tests and tarball installation, then registry publication failed E422 because the repository URL capitalization disagreed with provenance. Tagged source remains immutable. The fix corrects only matching-repository capitalization before all package verification.

## Commands run
- `npm ci --no-audit --no-fund`: locked dependency installation. Local npm 12 reports its default blocked-install-script warnings; CI uses its existing npm toolchain.
- `npm run build`, `npm run typecheck`, `npm run lint`, `npm run check:hygiene`, `bash scripts/check-repo-health.sh`, `git diff --check`: pass. Lint has 252 existing warnings, zero errors; repository health has 105 pass, 11 warnings, zero failures.
- Independent reviewer executed `npx vitest run tests/test_release/test_npm_workflow.test.ts`: 20/20 pass, including actual normalization shell and npm pack/install metadata checks.
- `npm test`: 4183 pass, 56 skip, 10 fail in 3 unchanged transport/TLS/WebSocket files. These match the previously recorded local network-instrumentation failures; this is a local failure, not a pass. The final-head stock Node 20/22 CI must pass before merge.
- `npm pack --pack-destination <candidate-directory>`; `npm install --global --prefix <isolated-prefix> <candidate.tgz>`; `node scripts/check-release-artifact.mjs <installed-abx>`: pass.
- `ABX_BIN=<installed-candidate-abx> node e2e/guided-configuration.mjs`: real-cloud pass, with ignored local credentials supplied only through the process environment.

## Results
| Scenario / test | Result | Notes |
|---|---|---|
| Refreshed-token publication | FAIL | E422 repository URL/provenance identity mismatch; no 2FA requirement in this publication response. |
| Workflow normalization/identity regressions | PASS | 20 targeted tests, canonical no-op, capitalization correction, unrelated identities rejected, and real tarball installation. |
| Repacked CLI artifact | PASS | Complete artifact checker passes; canonical repository URL is present in the installed manifest. Local candidate SHA256: `3353791caf5db8a23f0b5d0c6f758db4f6d585bb982294c4a2457cf8af1c0a4c`. |
| Real cloud candidate acceptance | PASS | Hidden-input terminal setup, operation-only configuration, create continuation and remote exec; kill and independent HTTP404 cleanup readback both pass. |
| Independent review | PASS | No blocking findings; preserve immutable tag and distinguish source/workflow commits and tarball checksums. |
| Full local test suite | FAIL | 10 existing network-instrumentation failures; 4183 pass, 56 skip. Product/transport sources are unchanged. |
| Final-head remote CI | REQUIRED | Current-head PR CI and review must pass before merge; the PR and delivery receipt retain final remote evidence. |
| Public registry install | BLOCKED | Package is not yet published. |

## Cleanup
The candidate test created one owned sandbox and killed it; an independent HTTP404 readback confirmed absence. Temporary configuration did not persist credentials. No resource leaked. Original checkout and historical evidence remain unchanged.

## Problems found
Registry provenance identity comparison requires exact capitalization, unlike GitHub URL resolution. This is a repository metadata defect rather than a request to refresh credentials again.

## Not verified
A successful public-registry publication and installation remain required after the reviewed publisher is merged. The previously uploaded Release tarball is not the new normalized npm artifact.
