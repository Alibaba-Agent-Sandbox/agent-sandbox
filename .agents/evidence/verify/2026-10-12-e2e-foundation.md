# Verification: black-box E2E suite and differential harness (cli)

- Date: 2026-10-12
- Change: ADR [`2026-10-12-e2e-suite-and-definition-of-done`](../../notes/implemented/process/2026-10-12-e2e-suite-and-definition-of-done.md)
- Result: PARTIAL (every runnable scenario passes against the Python oracle and the Node port; the Docker deploy scenarios are opt-in and were not executed)
- Binary under test: Python `ebx` 0.2.0 (pristine original, the oracle) for the baseline; the Node port at commit `e26562b` run through `tsx` as an informational snapshot
- Environment: real Alibaba Cloud FC agent sandbox platform (cn-hangzhou), Node 22, Linux. Credentials: supplied via the gitignored `.env` (values not recorded)

## What was verified

The language-neutral suite `e2e/` (`npm run e2e`, `EBX_BIN` selects the binary) and the stub-based differential harness `parity/diff/`. The suite drives the real binary with an isolated HOME against the real cloud: sandbox create, list, info, exec, run, file upload/download, `sandbox files/process/system`, template list/info, config and MCP install, error envelopes and exit codes. The harness compares two binaries wire for wire against a stub platform and envd.

## Commands run

```bash
EBX_BIN=<python ebx> node e2e/run.mjs --json <outside repo> --markdown <outside repo>   # twice
EBX_BIN=<node port>  node e2e/run.mjs --json <outside repo>
EBX_ORACLE=<python ebx> EBX_BIN=<python ebx> node parity/diff/diff.mjs --fast
EBX_ORACLE=<python ebx> EBX_BIN=<node port>  node parity/diff/diff.mjs --fast
node parity/diff/selftest.mjs
```

## Results

| Run | Result |
|---|---|
| E2E vs oracle, run 1 | 129 pass, 3 skip, 0 fail; created 2, leaked 0 |
| E2E vs oracle, run 2 | 129 pass, 3 skip, 0 fail; no scenario changed result (no flakiness) |
| E2E vs Node port (snapshot) | 129 pass, 3 skip, 0 fail; created 2, leaked 0 |
| Diff, oracle vs oracle (`--fast`) | 118/118 identical |
| Diff, oracle vs port (`--fast`) | 118/118 identical (an earlier run during concurrent port edits showed 2 transient MCP-artifact diffs that did not reproduce) |
| Diff selftest | injected deviations are detected |

Per-scenario table: [`e2e/BASELINE.md`](../../../e2e/BASELINE.md). The 3 skips: `docker-deploy/*` (opt-in `EBX_E2E_DOCKER=1`) and `kill-all-guard` (opt-in `EBX_E2E_ALLOW_KILL_ALL=1`).

## Cleanup

Each run tracks every created sandbox and kills it; the final `leak-check` scenario fails the run if any remain. After all runs, `ebx list` against the account (and `npm run e2e:cleanup -- --list` with `EBX_BIN` set) reported no sandboxes. Nothing leaked.

## Problems found

- Oracle quirks (`files stat` blank name/path, directories typed `file`, `list --status paused` returning running sandboxes, `template list` wrong key exits 1 instead of 3, `info` timeout always 300 s, `exec "exit 7"` fails without a shell). Pinned or deliberately not asserted, see BASELINE.
- A real credential was echoed once into an agent session transcript while exploring (an MCP config file was printed without masking). It was never written to a repository file, report or snapshot. Rotating that key is recommended. The suite and harness now mask output and must never print config files.

## Not verified

- `template deploy` / `template build` through Docker and ACR: pushing real image layers stalls at about 17 KB/s from the test environment (python-sdk KI-011).
- `kill --all` against a real account (opt-in, risk of destroying other users' sandboxes).
- `mcp start` / `mcp deploy` and AI generation commands (non-deterministic or long-running, covered by unit tests).
