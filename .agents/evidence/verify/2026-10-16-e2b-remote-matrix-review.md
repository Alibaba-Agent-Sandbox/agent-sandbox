# Verification: first complete remote E2B CLI matrix

- Date: 2026-10-16
- Change: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/40
- Result: PARTIAL (four review regressions corrected; new remote run required)
- Tested remote head: 5de6863
- Environment: GitHub-hosted Linux, Node 20 and 22; no cloud credentials in CI.

## What was verified

Removing the main-only PR filter enabled the actual full matrix for this stacked contribution. Both Node versions ran the complete unit suite, rather than only Markdown checks. This exposed four small omissions from the last native process-info source change.

## Commands run

- Remote npm test: Node 20 and 22 both failed the same four cases. Node 22 recorded 3805 passed / 4 failed / 2 skipped (3811 total).
- Remote typecheck/lint/hygiene, installer and Markdown-link checks: PASS. Package build was skipped because it depends on the failed test job.
- Corrected mock regression file: 26 passed (13.99 seconds).
- Recaptured only the changed help-sandbox-process case in the current unmerged snapshot directory: 1 passed / 109 unrelated deselected (13.84 seconds). Original historical captures are unchanged.

## Results

The three process-info column/error tests had an enumeration mock returning undefined; real commands.list returns an array. Their explicit empty-list seam now exercises the preserved OS ps fallback without changing expected columns/errors. The help snapshot now documents the correct background-option position. Runtime source and the already cloud-verified final binary are unchanged by these fixes. The local 26 baseline failures did not reproduce on hosted runners; do not present them as an intrinsic remote blocker.

## Cleanup

No cloud resources created by these checks. The previous final artifact process test reported one tracked sandbox and zero leaks.

## Problems found

Additional real conditional probes on python-hello returned pauseSession not enabled and runtime does not support snapshot; see https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/47. These are enabled-function/MicroVM prerequisites. Do not infer successful conditional operations from API symbols or generic Gen2 documentation.

## Not verified

The new remote matrix for this correction, conditional successful pause/snapshot operations, required review, parent PR acceptance and merge/publication. Keep the PR draft and the ADR proposed until gates and prerequisites are accepted.
