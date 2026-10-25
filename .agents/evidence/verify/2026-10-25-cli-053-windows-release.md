# Verification: Windows journal correction and CLI 0.5.3

- Date: 2026-10-25
- Result: PARTIAL — actual Windows candidate checks and publication are pending.
- Scope: Windows resource journal writes and the next minimal patch release.

## Retained failed release

Version v0.5.2 remains an immutable tag at 1bbfb2e6d8326a21738af467eaad210f5d7926b7. [Release Binary run 40201815914](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40201815914) failed its actual Windows npm artifact check before provider execution with `Cannot establish journal directory durability.` Linux x64/arm64 passed. No v0.5.2 release was formally published and its npm publisher was not triggered. Other platform results remain visible in that original run.

## Candidate correction

All platforms write and sync the temporary journal file before renaming it into place. File write, sync and rename failures still reject the intent. POSIX keeps the existing journal/ancestor directory synchronization. Windows omits the unsupported POSIX directory stage; this does not claim equivalent directory-entry persistence after power loss. The journal remains a recovery aid, not a transaction with the remote provider.

Initial focused journal suite on Linux: 6 PASS, including two explicitly simulated Windows-path tests. These prove that files are actually synced, repeated updates persist and file-sync failure is not swallowed. They do not prove execution on Windows. The next step is the existing five-platform manual binary workflow against the exact candidate branch, including actual npm/standalone behavior.

Additional candidate checks: 124 PASS across journal and executable snapshot suites; locked dependency installation, build, typecheck and hygiene PASS. Repository health: 106 PASS / 11 historical warnings / 0 FAIL.

## Remaining gates

Actual Windows and other platform artifacts, normal required owner CI, independent review, immutable v0.5.3 tag, complete release assets/npm publication, and fresh public-install developer reruns remain required. Failed, skipped and blocked developer cases remain separate from passes.
