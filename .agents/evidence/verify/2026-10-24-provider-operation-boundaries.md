# Verification: Provider operation boundaries

Date: 2026-10-24
Result: PARTIAL — scoped local checks passed; final PR CI/review pending.
Base: `cf7dcf67496488a98c0a9ce67dcb0541f723a516`.
Tracking: [Issue 145](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/145).
Scope: bilingual provider guide, changelog and engineering records only.

## Executed checks

- Reviewed native CLI command registration, standard-provider dispatch, application HTTP binding and template workflow guide. Compared explicit Python ProviderSandbox export, application_client and network.resolve signatures. CLI prepares source; the Python path consumes a prepared reference or connects to the returned sandbox.
- Compared the existing real three-consumer proxy evidence, [provider run 40110372103](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/actions/runs/40110372103): its OpenSandbox application calls disprove the blanket EPP prohibition. This is historical evidence, not a fresh execution in this docs change and not full-template coverage.
- Validated all local Markdown targets in both changed guides: PASS.
- `bash scripts/check-repo-health.sh`: PASS=106, WARN=11, FAIL=0. Warnings are existing repository history/layout notices.
- `npm run check:hygiene`: PASS.
- `git diff --check`: PASS. English/Chinese task mappings agree.

## Limits

No runtime code or package version changed. No new cloud sandbox, image or model task was created. The task explicitly scopes this follow-up to prose and existing-interface verification; unrelated cloud E2E and the ongoing full template matrix are not rerun here. Normal remote CI still applies. No all-provider or all-template success is claimed.
