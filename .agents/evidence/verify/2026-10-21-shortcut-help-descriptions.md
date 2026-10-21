# Verification: Shortcut help descriptions

- Date: 2026-10-21
- Base revision: 3e86e7a2b790365d12fa30dd4f3736d2fe50a154
- Change: `src/cli/{command_surface,main}.ts`, existing command-surface check,
  root help golden file, offline help assertion, bilingual docs and changelog.
- Result: BLOCKED (scoped behavior passes; full gates and publication remain blocked)
- Package: @agent-sandbox/cli 0.4.1; Node.js 22.22.2; Linux.

## What was verified

All ten root shortcuts explain their purpose before a trailing canonical alias.
`exec` describes arbitrary execution; `run` describes registered commands. The
fixed command set, ordering and existing command routing checks still pass.
The built CLI renders the descriptions with its normal 80-column wrapping.
See the [dated help capture](../cli/2026-10-21-shortcut-help.md).

## Commands run

| Command / scenario | Result | Evidence |
|---|---|---|
| `npm ci --no-audit --no-fund` | PASS, exit 0 | Isolated dependency directory with unchanged package.json and package-lock.json; node_modules moved into the task worktree |
| `npm test -- tests/test_cli/test_command_surface.test.ts` | PASS, exit 0 | 11 tests |
| Same updated command-surface test on the unchanged base implementation | Expected FAIL, exit 1 | Only the changed root-help expectation fails: 10 pass, 1 fail; demonstrates the regression |
| `ABX_UPDATE_EVIDENCE=1 npm test -- tests/test_cli_evidence/test_evidence_snapshots.test.ts -t 'test_evidence_snapshot \[help-abx\]'` | PASS, exit 0 | 1 regenerated root snapshot; 116 intentionally filtered tests |
| `make ci` | FAIL, exit 2 | Hygiene, typecheck, lint and build pass; full tests: 4067 pass, 10 fail, 56 skip, across 172 files; later make targets not reached |
| Base revision: `npm test -- tests/adversarial/core/transport_net.test.ts tests/adversarial/core/ws.test.ts tests/test_transport/test_node_transport_integration.test.ts` | FAIL, exit 1 | Identical 10 failure titles; 18 other tests pass; no new full-suite failure titles |
| `npm run parity:coverage` | FAIL, exit 1 | 907 ledger entries, 901 pass, 6 skip, 0 missing; server-SDK cross-check prerequisites not configured; moved SDK entries unverified without a sibling checkout |
| `make dist-check` | PASS, exit 0 | Built CLI entry exists in dry-run package |
| `ABX_BIN="node $PWD/dist/bin/abx.js" node e2e/run.mjs --suite offline --filter 'help-root|help-no-args'` | PASS, exit 0 | 2 help scenarios pass; no cloud resources; leak-check explicitly skipped |
| `env -u CI -u GITHUB_ACTIONS node dist/bin/abx.js --help` | PASS, exit 0 | Inspected and captured real built-process output |
| `bash scripts/check-repo-health.sh --quiet` | PASS, exit 0 | 105 pass, 11 existing warnings, 0 fail |
| `git diff --check` | PASS, exit 0 | No whitespace errors |
| `git check-ignore cli/.env` | PASS, exit 0 | Credential file remains ignored |
| `GIT_TERMINAL_PROMPT=0 timeout 20 git push --dry-run origin HEAD:refs/heads/fix/shortcut-help-20261021` | BLOCKED, exit 128 | No GitHub HTTPS username/credential; terminal prompts disabled |

The first offline help invocation used a relative binary path. The harness changes
cwd, so that attempt failed with a module lookup error. Repeating it with the
absolute path above passed; no product change was needed.

## Cleanup

No cloud resources were created; the offline runner reports created=0 and leaked=0.
Temporary test homes are isolated and removed by the harness. The generated,
ignored parity JSON report was moved out of the repository after the health
scanner flagged its local test paths; a fresh health run then passed.

## Problems found

The base revision reproduces all ten transport failures: HTTP parsing/error text,
TLS environment trust, proxy behavior, WebSocket errors and refused-connection
classification. These files are unchanged by this contribution. ESLint exits 0
with existing warnings. The parity ledger also skips six server-guide cross-checks
when their server SDK prerequisites are not supplied.

GitHub CLI and API credentials are unavailable. Public Issue/PR searches for
“shortcut help” returned no matches. The push dry-run independently confirmed
missing GitHub HTTPS authentication. No remote Issue, branch or PR was created.

## Not verified

Required full CI remains red. Remote CI/review and real-cloud E2E are unverified.
The Python differential harness was not run: no reference `ABX_ORACLE` is configured,
and this change intentionally updates help copy. Local help acceptance does not
claim cloud or differential parity. Keep the note proposed and do not merge until
required gates are satisfied.

## Issue draft

Title: [Bug]: Root shortcut help only names equivalent command paths

Description: `abx --help` prints `Same as 'abx sandbox create'.` and similar
redirections for ten actions, obscuring what users can do.

Reproduction: build the base revision and run `node dist/bin/abx.js --help`.
Expected: each shortcut explains its action, optionally followed by an alias note.
Actual: shortcut rows only identify another command path.
Environment: CLI 0.4.1, Node.js 22.22.2, Linux; no credentials required.
Acceptance: all ten purposes precede their aliases; exec and registered run stay
distinct; command routing stays intact; help snapshot and built-process checks pass.

## Pull request draft

Title: fix: describe shortcut actions before canonical aliases

Description: Root help now explains each shortcut before showing its canonical
command as an `(alias: abx …)` note. Add static purpose metadata without importing
command implementations during root help. Preserve command names and routing.

Type: bug fix. Changes include the existing command-surface regression, root-help
snapshot and offline scenario, English/Chinese docs, changelog, proposed note and
new dated evidence/capture. Validation is recorded above. Required full gates are
blocked by reproduced base failures and missing parity prerequisites. Remote
publication requires GitHub authentication. This is a local draft, not an open PR.
