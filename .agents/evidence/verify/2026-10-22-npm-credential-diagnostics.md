# Verification: npm credential diagnostics

- Date: 2026-10-22
- Change: release workflow credential diagnostics; Issue https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/66
- Result: PARTIAL
- Package under test: @agent-sandbox/cli 0.4.6, immutable tag v0.4.6
- Environment: Linux, Node 22; npm credentials supplied only through the CI secret (values not recorded).

## What was verified
A newly started publication run used the refreshed npm secret. Typecheck, build, unit tests, tarball installation and artifact verification passed; registry publication returned E404. The new diagnostic mode checks authentication and target-scope access without publishing.

## Commands run
- Release workflow_dispatch from main with release_tag=v0.4.6.
- Additional scoped and current-head CI checks are pending.

## Results
| Scenario / test | Result | Notes |
|---|---|---|
| New publication with refreshed secret | FAIL | [Run 39731201127](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/39731201127), registry PUT E404. All build/test/artifact steps passed. |
| Read-only registry diagnostic | PENDING | Not yet executed. |

## Cleanup
No cloud resource is created by the read-only diagnostic. Original checkout and historical evidence are preserved.

## Problems found
Npm delivery is still blocked; secret presence is not proof of publish authorization. Issue 66 remains open.

## Not verified
Public npm installation cannot be verified while registry publication is failing. This workflow-only change does not re-certify product cloud behavior.
