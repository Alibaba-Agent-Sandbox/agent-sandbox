# Verification: E2B behavior review, second run

- Date: 2026-10-16
- Change: proposed architecture ADR `2026-10-16-e2b-behavior-contract`; https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/33
- Result: PARTIAL
- Binary: abx 0.3.0 Linux x64, built from this branch with Node 22.22.2; SHA256 4312bb67b97441cef5bc088a2777a5b0993cd4ffc50657c0f1d488697b417e7b.
- Credentials: ignored environment configuration; values omitted.

## What was verified

The CLI embeds an attributed fixed source port of @e2b/cli 2.20.0 with e2b 2.50.0. There is no E2B runtime dependency or external executable lookup. Standard Express command behavior is separated from named project extension commands. Node SDK changes are excluded.

## Commands run

- Focused command/routing/scaffold tests: 5 files, 111 passed (70.33 seconds).
- Full Vitest run: 3749 passed, 27 failed, 50 pending (3826 total), before correcting the changed native template child name. The affected command-surface test passes in the focused run. The other 26 failures reproduce in an extracted pristine c269603 baseline: 13 Docker/archive/MCP prerequisite failures, 12 managed-network/JSON-oracle failures, one FORCE_COLOR warning assertion. No full-suite green claim.
- `PYTHON_SDK_ROOT=<python-checkout> node scripts/parity-coverage.mjs --no-run`: 907 historical ledger entries; 901 pass, 6 failed, 0 missing, 11 moved contracts verified. Six failures are the pre-existing Docker template-install group.
- Typecheck, ESLint, build and npm package dry-run: PASS (ESLint: 0 errors, 221 warnings).
- `node scripts/build-standard-cli.mjs`: PASS; 35 pinned dependency inputs, no external nonbuiltin runtime imports.
- `node scripts/build_binary.mjs`: PASS; version smoke PASS.
- `ABX_BIN=<standalone> node e2e/standard.mjs` with credentials provided only through environment: PASS against the real Express backend.
- Final standalone filesystem smoke: Python sync/async `template init` output imports agent_sandbox and documents agent-sandbox-client; native scaffold --prompt help, from-image help and --licenses all PASS. Template assets are embedded, not read from the checkout.

## Results

| Scenario | Result | Details |
|---|---|---|
| Detached create/list/kill | PASS | Real binary and cloud, IDs/output and explicit cleanup |
| Remote execution | PASS | Stdout preserved; remote status 7 propagated as exit 7 |
| Real terminal sessions | PASS | Python local PTY with explicit 24x80 dimensions; cwd and exported shell variables persist |
| Connect ownership | PASS | Existing sandbox survives terminal exit |
| Interactive create expiry | PASS | Default post-terminal request is one second; Alibaba rounds to roughly 60 seconds. Automatic expiry observed within the documented backend window |
| Reference comparison | CONFIRMED | The fixed upstream CLI also returned approximately 59 seconds after terminal exit. The earlier 15-second test expectation was wrong for both implementations |
| Snapshot / conditional pause | NOT VERIFIED | Backend runtime/allowlist fixture required |

## Cleanup

The standard cloud scenario kills all tracked IDs in finally, verifies the interactive-created ID expires and verifies explicit-kill IDs disappear from listing. No tracked sandbox remained. No kill-all account cleanup was used.

## Problems found

Corrected exec forwarding of remote --provider/--prompt options, native template create/init name conflicts, embedded-template filesystem assumptions and child-stdin closure in the test harness. Historical merged evidence remains intact. The repository health gate still reports historical broken links/slugs, machine-local paths and four missing English design translations (100 pass, 5 warnings, 4 failed groups); no history was rewritten to make it green. The temporary parity JSON report is not a committed artifact.

## Not verified

The older black-box scenario collection still contains assertions for retired Python-CLI parsing and needs alignment with the selected E2B contract. Complete required remote matrix/review and conditional cloud fixtures remain outstanding. Parent dependency https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/23 is still a draft. This evidence does not mark the ADR implemented, close the Issue or authorize a failing merge. Companion SDK: https://github.com/Alibaba-Agent-Sandbox/python-sdk/issues/36.
