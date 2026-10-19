# Verification: CLI E2B integration review

- Date: 2026-10-16
- Change: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/40; https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/33
- Result: PARTIAL
- Environment: Linux x64, Node 22.22.2, Python 3.13.13. Credentials supplied only through ignored environment configuration.
- Base: parent 71aace1; accepted repository-health implementation retained rather than overwriting historical records.

## What was verified

Reviewed the complete command entry map against the pinned source: template init/create use standard semantics; scaffold/from-image/build/deploy are explicit project entries; standard publish/unpublish/migrate and sandbox snapshot/metrics/logs stay routed to the standard client subject to backend restrictions. Updated README/skill/reference examples, command hints and bilingual links. Natural language uses --prompt. Historical oracle/capture artifacts remain unchanged; a separate current error-string fixture records the baseline hash and the two deliberate CLI hint transformations.

## Commands run

- Final changed-doc/standard/create tests: 5 files, **205 passed**, 111.08 seconds.
- Final error-format/template/process/build request regressions: 4 files, **314 passed**, 17.15 seconds.
- Explicit prompt/adopt/process regressions: 7 passed, 40 unrelated deselected, 11.39 seconds; includes one regression for resolving an envd handle without treating it as an OS PID.
- Full integrated Vitest run: **3746 passed, 39 failed, 50 skipped** (3835 total), 414.25 seconds. Ten failures were old Python-CLI hint expectations, two were old init/adopt test inputs, one was a scheduling timeout in a pure request-map test. Those groups pass in the focused reruns after the documented current fixture/prompt updates. The other 26 failures were independently reproduced on the pristine pre-feature baseline (round two); no full green result is claimed.
- `ABX_BIN=<standalone> node e2e/run.mjs --suite offline`: **62 passed, 1 cleanup skip**, zero resources created.
- `ABX_BIN=<standalone> node e2e/run.mjs --suite all-commands`: **1 passed, 1 cleanup skip**, full help/usage walk (187.861 seconds), zero resources created. The walk handles standard aliases, excludes virtual help recursion and discovers the embedded extension list.
- Cloud read-only/lifecycle/standard suite: **71 passed, 1 failed**, two tracked sandboxes, zero leaked. The remaining native process-info failure exposed that Alibaba envd IDs are not always OS PIDs; a source fix and regressions now resolve listed handles before ps. Final cloud rerun of that fix remains required.
- Standard cloud scenario in that run: PASS, including a real local PTY, retained shell state, connect ownership, default-create expiry and cleanup.
- `make`/npm build/typecheck/lint and standalone build: PASS before the last process-info change. ESLint 0 errors / 221 warnings. Final process-info build/type/lint are running separately.
- `bash scripts/check-repo-health.sh`: **105 pass / 11 warning / 0 fail** after removing the task-generated parity JSON report. Warnings include exact-hash registered immutable history, not silently edited captures.

## Results

Both the standalone and npm routes retain the owned standard source and embedded templates/licenses. The older black-box scenario collection has been aligned: standard options precede IDs, no-input commands use ignored stdin, resource cleanup uses standard kill/list, and template.yaml workflows use scaffold. The default runner includes the real standard PTY scenario. The workflow now runs the full CI matrix for stacked PRs as well as main-target PRs; the previous branch filter had only run Markdown links on this draft.

## Cleanup

Every completed cloud run reported two tracked sandboxes and zero leaked. The nested standard scenario separately verifies its automatically-expired and explicit-kill IDs. No account-wide kill was used; the obsolete kill-all confirmation probe was removed because standard --all acts immediately. An additional reference comparison created one owned sandbox and removed it in finally.

## Problems found

- An empty stdin pipe on python-hello produces HTTP 404/unimplemented from closeStdin: the pinned upstream CLI and the project both preserve output and exit 1. This was verified against both actual executables with the same owned sandbox; it is documented as an existing backend limitation, not patched into a false EOF success.
- The local 26 baseline failures involve Docker/prerequisite seams, archive permissions, managed-network and old WebSocket/MCP oracle behavior. Their failures are retained.
- The first remote Markdown job found old init/create fragment links; current references now have correct scaffold/from-image links and stable standard template anchors. The new remote head must verify them.

## Not verified

Final process-info real-cloud rerun, latest full remote Node matrix, conditional snapshot/pause fixtures, required review, parent PR https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/23 acceptance, merge and publication. The ADR remains proposed. SDK contract dependency: https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/47 (its first remote Python 3.10/3.11/3.12 client/server/package/hygiene/links matrix passed).
