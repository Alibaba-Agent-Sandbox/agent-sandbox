# Verification: last CLI artifact after guide corrections

- Date: 2026-10-16
- Change: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/40
- Result: PASS (artifact smoke only)
- Source behavior: efd23bc; the following commit only corrects tutorial prose and records this result.
- Binary: abx 0.3.0 Linux x64, SHA256 d9079027868e9e64f463a27d83bcb6e5c7eb9001577a9f4094bc383158621e6b.

## What was verified

Rebuilt the standalone artifact after the final config-help --prompt correction. It retains the embedded standard runtime, Python template assets, licensing and native process-handle fix. This does not assert successful conditional backend operations or a complete latest-head CI pass.

## Commands run

- `node scripts/build_binary.mjs`: PASS, 126.6 MB, version smoke exit 0.
- Actual binary from a fresh temporary HOME/cwd: config init --help contains scaffold --prompt; create --help contains --detach; --licenses contains MIT notices: PASS.
- Actual standard template init for python-sync and python-async outside the checkout: PASS; both generated template.py files import agent_sandbox.
- Previous complete hosted Node 20/22/type/installer/links/npm-package matrix passed at cb034f09. The new head's remote matrix is running; pending is not a pass.

## Results

No external E2B executable/runtime installation is needed by the standalone artifact. The current tutorial distinguishes standard JSON output from project --ci, and scopes region/global options to the commands that actually support them. Historical real-output pages remain verbatim behind an explicit context notice.

## Cleanup

Temporary local directories were removed automatically; no cloud resources created. Existing process/PTY/resource-cleanup evidence and rejected conditional backend probes remain separate records.

## Problems found

No additional artifact defect. Conditional pause requires an enabled function and snapshot success requires a supported MicroVM runtime/account. Existing test function reports both prerequisites absent.

## Not verified

Latest remote matrix, successful conditional backend fixtures, dependency/review acceptance, merge and publication. Do not mark the feature complete from this artifact-only pass. SDK companion: https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/47.
