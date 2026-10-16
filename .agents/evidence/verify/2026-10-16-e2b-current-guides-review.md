# Verification: current CLI guides and captured history

- Date: 2026-10-16
- Change: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/40
- Result: PASS (current-guide review); conditional backend success remains separately blocked
- Environment: Linux checkout. No cloud resources created by these corrections.

## What was verified

A final walkthrough of the tutorials found obsolete options and line-REPL assumptions outside the canonical reference. The current English/Chinese lifecycle tutorials now use positional templates, detached IDs, state/format queries, remote option boundaries, actual PTY behavior and immediate standard kill. The project config-help example now uses scaffold --prompt. SDK/CLI skill guidance distinguishes standard behavior from provider/server extensions.

The older e2e-template-workflow pages contain actual historical output. Their complete captured bodies were restored from parent 71aace1 and retained verbatim with a leading historical-context notice linking to the current contract; they are not silently rewritten as new real-cloud evidence.

## Commands run

- Targeted help-config-init capture in the current unmerged capture directory: PASS (1 case; unrelated cases deselected). Historical captures unchanged.
- `bash scripts/check-repo-health.sh`: PASS, 105 pass / 11 historical-context warnings / 0 failed.
- `git diff --check`: PASS.
- The complete hosted Node 20/22 test, type/lint/hygiene, installer, Markdown-link and npm-package matrix passed on source head cb034f09 before these guide/comment/help-example corrections. The latest documentation/help head still requires its remote checks.

## Results

The current tutorial no longer teaches --template/--stream/local --timeout or stateless connect for standard Express commands. Project provider commands and extension-only options retain their own scope. No change to protocol, routing, process handling or resource ownership was made in this final guidance correction; the help snapshot covers the one visible config-help string change.

## Cleanup

No resources created. Final binary/cloud process evidence remains in the earlier artifact record. Conditional backend probes returned disabled pauseSession and unsupported snapshot runtime, with their owned sandboxes removed.

## Problems found

The omissions were documentation drift from the earlier CLI behavior. Source comments and agent guidance now use explicit --prompt and scaffold as well. Original captured cloud transcripts are clearly historical rather than claimed as current successful runs.

## Not verified

Final head CI, enabled-function/MicroVM success paths, dependency acceptance, review, merge and release. No Node SDK repository changes.
