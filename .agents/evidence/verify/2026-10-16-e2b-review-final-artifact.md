# Verification: final E2B CLI artifact and virtual process handles

- Date: 2026-10-16
- Change: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/40; source revision ca70e59
- Result: PARTIAL (targeted final artifact checks PASS; full mandatory gates still outstanding)
- Binary: abx 0.3.0 Linux x64, Node SEA, SHA256 ddd6b3c743138498fc5cc190e8944919d0c4dbb8750f90024cd560d5abefbf12.
- Credentials: supplied only through ignored environment configuration, never recorded.

## What was verified

The final binary includes the envd-handle fix and the standard runtime/template assets. Resolving a real background process now works on Express: the returned envd handle is resolved through the list endpoint instead of being assumed to be an OS PID. An unimplemented provider enumeration retains OS inspection, without inventing host-only metadata.

## Commands run

- `ABX_BIN=<final-binary> node e2e/run.mjs --suite cloud-lifecycle --filter 'create-json|process-info-owned'`: **3 passed** including the built-in leak check; create 2.556 seconds, process inspection 6.065 seconds.
- Final standalone temporary-filesystem smoke: Python sync and async template init, process info --help, scaffold --help and --licenses: **PASS**. Generated Python imports agent_sandbox, and assets work outside the checkout.
- Final four-file targeted regression run: **314 passed** (17.15 seconds), including error serialization/current hints, process virtual-ID resolution and unsupported-enumeration fallback, request-map construction and adopt output. Separate prompt/adopt run: 7 passed, 40 unrelated deselected.
- Final build/typecheck: PASS. ESLint: 0 errors / 221 existing warnings. No Node SDK repository changes.

## Results

The final previously failing real-cloud process case is fixed and verified. The prior complete cloud suite had 71 passing scenarios and this one failure; that is not relabeled as a 72-pass single run. The full local Vitest run still contains 26 independently reproduced baseline failures after the targeted current-contract corrections; see the integration record. The all-command help/usage walk passed, and offline suite passed 62 cases.

## Cleanup

Final cloud output: `sandboxes created=1 leaked=0`. The owned background process is stopped in finally; the sandbox is registered with the runner and removed in final cleanup. The separate stdin reference comparison removed its owned sandbox. Python janitor dry run found zero tagged candidates (one unrelated sandbox was listed and left untouched).

## Problems found

The existing backend closeStdin incompatibility is confirmed against both actual reference/project CLIs and documented in the migration guide. The full Node CI/parent dependency and conditional cloud fixtures remain outstanding; targeted passes do not bypass those gates.

## Not verified

Latest remote Node matrix and review, conditional MicroVM snapshots/pause, parent PR acceptance, merge, release publication. The PR and ADR remain draft/proposed until required gates pass. Companion SDK: https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/47.
