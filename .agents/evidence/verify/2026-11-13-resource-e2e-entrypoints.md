# Resource E2E entry-point verification

## Scope

Updated CLI-owned E2E scripts and their current English/Chinese instructions. No product executor changes, no SDK changes and no historical evidence edits. The release-artifact verifier was handled independently by the engine reviewer.

## Actual checks

- `ABX_BIN="node $PWD/dist/bin/abx.js" node e2e/run.mjs --suite capability --filter template-profile-no-network`: one scenario passed through the actual executable. It checks generic Dockerfile output and named v1 resource fields, and excludes dynamic startup declarations. The separate cloud leak check was skipped because no Sandbox was created. Logs: `/tmp/abx-yaml-final-20261113/capability-v1-final.log` and `.json`.
- `node e2e/template-build-failure.mjs` through the same candidate CLI, with existing credentials loaded only into the subprocess by the workspace private runner and a dedicated Docker daemon: passed. The real Alpine 3.21 RUN printed the fixture marker and exited 23. The test verified E7020, known-token redaction, no Docker publication attempt, and a `ResourceDeployment` receipt in `requires_recovery` with exactly one pending image intent for `example.invalid`. No template, volume or Serving identity was recorded or submitted by this code path. Log: `/tmp/abx-yaml-final-20261113/docker-failure-v1-final.log`.
- Account/Team resolution used existing credentials and read-only cloud requests. No management key or cloud resource was created. The temporary project, home directory and trace were removed. The engine owner was notified to stop the dedicated daemon and remove its disposable cache/network; the engine owner independently confirmed daemon/data/bridge removal, restored `ip_forward=0`, and complete iptables equality with its pre-start baseline (six cleanup assertions passed).
- JavaScript syntax and whitespace checks: passed for the changed scripts and diff.
- Repository health: first run found this new ADR missing its required Decision title/API Design section; corrected the record and reran. Final result `PASS=105 WARN=11 FAIL=0`; warnings are existing registered historical context. Log: `/tmp/abx-yaml-final-20261113/resource-e2e-health-final.log`.

## Boundaries

The two native Steps scenarios only had unused retired YAML generation removed. Their direct API payloads and resource cleanup were preserved; they were not rerun against cloud resources in this change. No fresh model or complete managed-application acceptance is claimed. Source-only and release-artifact acceptance remain separate.
