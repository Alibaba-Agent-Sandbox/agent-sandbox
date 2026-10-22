# Verification: remove retired CLI compatibility

- Date: 2026-10-22
- Result: PARTIAL (mandatory remote checks and remaining native gates pending)
- Revision: scoped files in branch `refactor/remove-legacy-20261022`; the containing commit identifies the exact source.
- Environment: Linux, Node.js 22.22.2, lockfile installation with `npm ci`.
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/103

## What was verified

The native project surface no longer exposes the old REST template manager, standalone template factory capability, forwarding imports, migration commands, deprecated protocol spellings, inferred provider ports or old configuration fallback. Template operations use the official control plane; output includes provider identity. Research uses one structured outcome. Configuration has one storage descriptor and no inert retry fields; credentials are not read from obsolete plaintext TOML storage.

## Commands and results

- PASS: `npm run typecheck`, `npm run build`.
- PASS: `npm run lint` — zero errors; existing and scoped warnings are visible in the command result (277 warnings on this run).
- PASS: `npm run check:hygiene`.
- PASS: `bash scripts/check-repo-health.sh` — 106 passes, 11 historical warnings, zero failures.
- PASS: `node scripts/gen-config-keys.mjs --check`; the shared export is regenerated from its Python source.
- PASS: `ABX_UPDATE_EVIDENCE=1 npm test -- tests/test_cli_evidence --maxWorkers=4` — 117 cases. New captures use `golden/remove-legacy-20261022`; tracked historical captures are preserved.
- PASS: focused final configuration, retired-storage, adapter, and research regressions — 208 tests. Earlier obsolete assertions were corrected to the current contract and are not recorded as passes.
- BLOCKED: the full `npm test -- --maxWorkers=4` attempt hit the 900-second bound. HTTP fixtures in this environment receive 501 with the message “project network audit disabled”; native process/TTY tests also exceeded their startup limits. A second scoped broad attempt hit its 600-second bound. Neither bounded attempt is a full-suite pass. Required clean-run CI remains outstanding.
- PASS: `node e2e/guided-template-steps.mjs --inspect` with credentials loaded from the ignored workspace environment — the real official control plane exposes the existing ready public source and resources.
- BLOCKED: this public source is generation 1, so the platform RUN-step scenario cannot proceed without a verified generation-2 source. The inspection performed no cloud writes. Docker/ACR image deployment is not verified locally because Docker is unavailable.

## Outstanding gates

Required latest-head remote CI/review and native checks are mandatory before merge. The Python shared contract must land before this consumer. Initial Git processes had not loaded the workspace credentials; authenticated access and scoped branch publication are available. No package release or manual production deployment is requested.

## Cleanup

Read-only template inspection creates no resource. Local fixtures own their temporary files and servers. Related real-cloud SDK fixtures track and clean their sandboxes. No credential values or raw sensitive logs are stored in this record.

## Additional final checks

- PASS: 535 targeted CLI/configuration/protocol-adapter/research regressions on the final source.
- PASS: real native CLI `--json template list` and `template info` via the official control plane, with valid JSON results. Both operations are read-only.

## Remote Docker gate correction

The first native Docker job retained an import of the deleted forwarding module in its verification script. It now imports DockerBuilder from the owning provider path. The obsolete standalone image-factory E2E scripts and npm entry are removed; current provider project preparation is covered by the provider T0/T4 workflows. The corrected native Docker gate is rerun remotely.

## Complete native template lifecycle and CI fixture alignment

- PASS: create a uniquely named owned template through the current official factory from the already verified public source image, wait for ready, read it back, and delete it through the current native CLI. Independent inventory absence and HTTP 404 were verified; no owned template remains. No Docker build or RUN-step acceptance is inferred from this control-plane check.
- The first full Node20/22 CI run exposed eight stale assertions/doc references (4104 other tests passed on Node20). Fixtures now store credentials in the current environment-file location, expect structured authentication/process results, ignore retired Qwen settings, omit deleted migration vectors and link the owning base64 module. The final full CI rerun remains mandatory.
