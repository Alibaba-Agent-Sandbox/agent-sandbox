# Verification: Scoped unused-code cleanup

- Date: 2026-10-27
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/203
- Base revision: `a27b682218825532ef96028faa314cbda5ddada6`
- Functional patch SHA256: `a56ef7a1e37bfe5404c4fa6af714d8acfb273182cff2b03ccc751965cffa8bf3` (Git binary diff against the base, excluding records/docs/changelog).
- Result: BLOCKED (required complete real-component acceptance remains unmet).
- Environment: Linux, Node 22.22.2, TypeScript 5.9.3, ESLint 10.12.0.
- Compiled standalone artifact: `abx` 0.5.7, 129.6 MB, SHA256 `44fc6ade6e733d8caeeaa9b837ca3ea838eb1d6a1ec10fe95d3154126a9c3ca7`.

## What was verified

Remove reviewed unused bindings/private helpers/write-only state and an unconsumed direct dependency; preserve initialization, hooks, public exports, positional signatures and maintained standard sources. Task files are isolated from the original working-tree edits.

## Commands and results

| Command / check | Result | Evidence |
| --- | --- | --- |
| `npm ci` after the lockfile update | PASS | Reproducible installation; the removed direct dependency has no source or remaining lockfile consumer. |
| `npm run typecheck` | PASS | Enhanced baseline had 94 diagnostic lines; both noUnused gates are now enabled. |
| `npm run lint` | PASS | 0 errors, 168 existing style warnings. |
| `make ci` with absolute workflow-pinned fixture roots | PARTIAL / exit 130 | Hygiene, types, lint and build passed. Local unit run was interrupted after repeated altered-HTTP failures and source-startup/PTY timeouts; no complete local unit/parity pass is asserted. |
| Remote CI at `1c8a0bb4282e5e09bb2b6fadfcfb339962b732fd` | PASS | Complete Node 20/22 tests, typecheck, installer and package build; Docs links, Express source acceptance and generated MCP artifact also pass. |
| `make dist-check` | PASS | npm dry-run package contains the executable and complete Skill reference closure. Run before the separate binary build. |
| `npm run build:binary` | PASS | Official single-executable build and version smoke test; artifact hash above. |
| `node scripts/alicloud-sdk-notices.mjs --check` | PASS | 25 embedded official-SDK dependency notices verified. |
| `bash scripts/check-repo-health.sh` | PASS | 106 pass, 11 warnings, 0 failures. |
| JavaScript unused-binding review | PASS | 92 files reviewed. The remaining scanner-only unused-disable notice is not a binding. |
| Existing-key `abx sandbox list --format json` | PASS | Read-only service preflight; listing response omitted. |
| `ABX_BIN=<standalone artifact> npm run e2e` | FAIL / exit 1 | 162 pass, 16 fail, 8 skip; 1238 seconds. Full-run failures are retained below. |
| `npm run e2e -- --suite provider-management-cloud` | PASS | 8 read-only Volume/Team/API-key/quota list cases passed with the existing AccessKey pair; no management write operation, key preparation or renewal. |
| `npm run e2e -- --suite cloud-readonly --filter 'cloud-readonly/template-info(?:-missing(?:-json)?)? '` | PASS | Exactly 3 template-info read cases executed and passed with existing AccessKeys. Two earlier empty filter selections are not counted as passes. |

The local CI fixture roots were the exact workflow-pinned provider and Python revisions, supplied as absolute values of ABX_AWESOME_PROVIDERS, ABX_SERVER_SDK_SRC and PYTHON_SDK_ROOT. Remote validation:

- https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40476308664
- https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40476308662
- https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40476308725
- https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40476308752

## Full-run failure analysis

Eleven failures were missing-configuration prerequisites in the first controlled run, which supplied only the existing service key: 8 management list cases and 3 template-info reads subsequently passed with AccessKeys. These reruns do not turn the original full-run exit into a pass.

Five cases remain unresolved:

- `template-profile-no-network` and `search-json-shape` still assert retired workflow fields. Their assertions are unchanged from the base; current spec v5 uses startup/services. Tracked separately at https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/205.
- `template-delete-missing` received the missing-configuration envelope in the service-key-only run; the destructive negative command was not included in the read-only rerun.
- `standard-lifecycle-pty` exceeded its 240-second whole-scenario bound after detached create, command stdout/failure, template list and lease-shortening checks passed.
- `run-named-command` could not discover the deployed python-hello protocol-v2 catalog: HTTP 502, E8002. Deployment/prerequisite validation remains required; no server implementation or safety check was weakened.

Eight opt-in management-write/Volume/Docker cases were skipped. No real model qualification is claimed. Candidate deletion alone does not establish that the remaining component failures were caused by this patch; the original full-run gate remains unmet.

## Initial attempts and corrections

Initial lint caught a leftover increment of a removed unused counter; that write was removed. A relative-fixture run was canceled and a later attempt stopped on a transient temporary-filesystem I/O failure. The corrected run used absolute fixtures. The commit secret hook flagged two pre-existing fixed credentials in the local parity stub; both are explicitly annotated as synthetic placeholders without changing their values or behavior. An initial standard list probe used unsupported `--json`; the corrected `--format json` probe passed.

The first ESM-artifact E2E run was interrupted after 810 seconds because help-only commands took 30–40 seconds each in this filesystem environment. Its cleanup handler ran and its ledger had zero remaining/uncertain resources. The official standalone artifact was then tested with the complete results above. The later local source-unit interruption occurred only after the equivalent remote full Node matrix had passed.

## Scope and further analysis

The nine original orphan-module findings are already resolved on accepted main. Eleven exported helpers remain because the package allows deep imports; two have generator ownership. shlexJoin has a parity consumer. Logger initialization, useIso calls and the WebSocket positional argument remain. No maintained standard source, public export, license notice or historical golden capture was deleted.

## Cleanup and remaining gates

The complete runner reports leak-check PASS: 2 tracked sandboxes created, 0 unconfirmed, 0 unresolved creates. A subsequent independent SDK inventory listed 0 total sandboxes: none leaked. Read-only reruns created no resources. Management write opt-ins were not enabled; no API-key preparation/renewal was attempted. Initial interrupted ledgers contain zero remaining and zero uncertain entries.

The cleanup PR remains draft and Issue #203 remains open. The unresolved real-component gate and current-head CI for this evidence-only update must pass before merge. Earlier passing CI is attributed to its exact code head above, not to a future metadata commit. No manual release or deployment was performed.
