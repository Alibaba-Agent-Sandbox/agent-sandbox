# Verification: npm credential diagnostics

- Date: 2026-10-22
- Change: [PR 101](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/101); release workflow credential diagnostics; Issue https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/66
- Result: PARTIAL
- Package under test: @agent-sandbox/cli 0.4.6, immutable tag v0.4.6
- Environment: Linux, Node 22; npm credentials supplied only through the CI secret (values not recorded).

## What was verified
A newly started publication run used the refreshed npm secret. Typecheck, build, unit tests, tarball installation and artifact verification passed; registry publication returned E404. The new diagnostic mode checks authentication and target-scope access without publishing.

## Commands run
- Release workflow_dispatch from main with release_tag=v0.4.6.
- `npm ci --ignore-scripts --no-audit --no-fund` (locked installation).
- `npx vitest run tests/test_release/test_npm_workflow.test.ts`: 14/14 pass after independent-review additions.
- `npm run typecheck`, `npm run lint`, `npm run check:hygiene`, `bash scripts/check-repo-health.sh`, `git diff --check`, staged secret scan: pass. Lint retains 252 pre-existing warnings; health reports 105 passes, 11 warnings, zero failures.
- `make ci`: typecheck/lint/build pass, full local tests fail in 10 unrelated transport/TLS/WebSocket cases (3 files); 4177 pass, 56 skipped. The local network instrumentation differs from stock CI. No product/transport files changed. This is disclosed as a failure, not counted as a pass.
- Real diagnostic dispatch from reviewed branch with `release_tag=v0.4.6`, `diagnostics_only=true`.

## Results
| Scenario / test | Result | Notes |
|---|---|---|
| New publication with refreshed secret | FAIL | [Run 39731201127](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/39731201127), registry PUT E404. All build/test/artifact steps passed. |
| Read-only registry diagnostic | PASS | [Run 39732247219](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/39732247219) at 70db3b9: credential present, identity authenticated, organization membership confirmed, package-access check E403. |
| Diagnostic publication exclusion | PASS | Publication job was skipped in the same real run. |
| Scoped regression and redaction | PASS | 14 cases include valid/rejected/missing credentials, denied org/package access, malformed upstream output, tag guards and actual local tarball installation. |
| Independent review | PASS | No blocking findings; added query-denial/malformed-output regressions and a 5-minute diagnostic job bound. |
| Remote CI | IN PROGRESS at capture | [Preparation run](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/39732255866): both Node unit steps, lint and installer passed; parity/build still running. Final-head checks and actual merge state are tracked on [PR 101](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/101); merge requires all green. |

## Cleanup
No cloud resource is created by the read-only diagnostic. Original checkout and historical evidence are preserved.

## Problems found
Npm delivery remains blocked. The refreshed token is accepted for authentication and the account is an organization member. The package-access query returns E403; this narrows investigation to authorization, but does not distinguish granular token package/scope permissions from account/team ACL or publishing 2FA policy. Organization token permissions alone do not grant package publication rights. See [npm token documentation](https://docs.npmjs.com/creating-and-viewing-access-tokens/). Issue 66 remains open. No repeated publish is attempted with unchanged permissions.

## Not verified
Public npm installation cannot be verified while registry publication is failing. This workflow-only change does not re-certify product cloud behavior. Released runtime source remains exactly v0.4.6; prior real-cloud acceptance is preserved in [guided-configuration evidence](2026-10-22-guided-configuration.md). The changed operational component (GitHub CI using the real npm registry and actual secret) was exercised directly. No cloud-resource mutation is introduced.
