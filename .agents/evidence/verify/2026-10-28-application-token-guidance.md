# Verification: Application-token guidance

- Date: 2026-10-28
- Base revision: a27b682 (origin/main at isolated worktree creation)
- Result: BLOCKED — scoped regressions pass; full-suite failures, missing cloud credentials and GitHub authentication prevent completion/merge.
- Environment: Linux, Node 22.22.2, Python 3.13.13; dependencies installed with the unchanged package lock using `npm ci --no-audit --no-fund` in isolated temporary storage.
- Scope: CLI configuration help/setup, template environment error, onboarding PTY scenario,
  application setup tests/new golden, bilingual README/guides, CHANGELOG and new engineering records.

## Behavior verified

Both local and remote source selections carry a command-only platform key into application setup.
A generated saved token reaches creation and application verification; a manually supplied
command-only token reaches both without being saved. Saved/explicit precedence, cancellation and
undeclared optional authentication keep their previous behavior. Input/generated values are
absent from captured output. Noninteractive errors now explain purpose, origin, generation,
configuration commands and later reuse before submission.

A real POSIX PTY exercised the reported sequence through the built CLI: select the platform API-key
method, choose Only this command, enter a hidden placeholder key, reach the explained application
prompt, and cancel. No application secret or platform key was saved, and billable creation was
not reached. The built CLI JSON path produced the new missing-token golden; no cloud request was
submitted. The user's installed executable version is unknown. The downloaded npm 0.5.7 archive
already contains the interactive wizard; this does not prove which binary the report used.

## Commands and actual results

| Check | Result | Scope/limitation |
| --- | --- | --- |
| `npm ci --no-audit --no-fund` | PASS | Unchanged lock, 234 packages; npm reported two install scripts blocked by the environment's policy |
| New application regression before patch | FAIL as expected | 3 failing, 5 passing; missing purpose/source explanation reproduced |
| `npx vitest run tests/test_cli/test_template_application_setup.test.ts tests/test_cli/test_template_onboarding_pty.test.ts tests/test_template/test_environment.test.ts tests/test_cli/test_guidance_contract.test.ts tests/test_cli_evidence` | PASS | 158 tests, five files, includes exact new diagnostic golden |
| `node e2e/onboarding.mjs` | PASS | Seven real-terminal scenarios; no cloud resource creation |
| `make lint` | PASS | Zero errors; 275 existing warnings |
| `make typecheck` | PASS | Strict TypeScript check |
| `npm run build` | PASS | Built candidate from scoped sources |
| `ABX_BIN="node <candidate>/dist/bin/abx.js" npm run e2e:offline` | PASS | 81 pass, one cleanup skip because no cloud resources were created |
| `npm run parity:coverage` with the fixed SDK test source | PASS | 907 ledger entries passing; 11 moved entries found; its nested broader suite is not claimed green |
| Full `make test` with existing workspace sibling checkouts | FAIL | 61 failed, 4536 passed, five skipped; old provider manifests lack the required operation contract |
| Full `make test` with CI-pinned provider/SDK sources | FAIL | 20 failed, 4577 passed, five skipped; 206 files, including passing scoped tests |
| Clean-base targeted controls | FAIL | The same 20 failing test identities reproduce on unchanged a27b682 across engine, cubesandbox/plugin, HTTP/TLS and WebSocket test files |
| Focused HTTP/TLS/WebSocket run without proxy environment variables | FAIL | Same 10 transport assertions still fail; no network/proxy root cause is asserted |
| Real-cloud `node e2e/guided-configuration.mjs --application` | BLOCKED | Existing runner stops at missing Sandbox API key before resource creation |
| `bash scripts/check-repo-health.sh --quiet` | PASS | Final verification copy, historical warnings retained |
| `npm run check:hygiene` | PASS | No machine-local paths or credential-like strings in delivered content |
| `git diff --check` | PASS | Scoped whitespace/diff checks |
| GitHub publishing | BLOCKED | `gh` is unavailable, GH_TOKEN/GITHUB_TOKEN absent, and repository dry-run push cannot read a GitHub username |

The CI dependency pins were exported from existing Git objects without modifying sibling work:
provider 126a50e3c4e4c6792019b9c96674d35a9518d8ad; SDK
8e610a3658040d8d6973e7951f9590ea50a4d70a. Baseline controls ran the five failing
provider/transport files (16 failures) and engine file (four failures), with matching failed test
names. These are control observations, not permission to waive required checks.

## Captured output

New golden: `tests/test_cli_evidence/golden/application-token-20261028/missing-token.txt`.
It was captured from built-CLI JSON using an isolated home, managed fixture and placeholder platform
credential. The new golden test checks the same automation error. Existing golden checks pass;
historical captures were not changed. The seven PTY scenario descriptions are retained in
`e2e/onboarding.mjs`; real terminal input was hidden and cancellation restored terminal state.

## Records, cleanup and remaining gates

Original working directories and their pre-existing uncommitted changes were preserved. Tests
ran in an isolated temporary checkout with matching changed-file bytes. Initial health checks rejected the temporary node_modules symlink, missing delivery-tree
development dependencies, and a generated parity report containing temporary paths. Dependencies
were moved into a real verification-tree directory, and the task-generated parity report was
removed after its results were read. The final repository-health and hygiene checks run on the
verification tree with byte-identical scoped sources and records. No release or deployment was performed, no
credentials were generated/renewed in the cloud, and no cloud resources were created. No remote
Issue, PR or merge is claimed. The separate delivery draft records the proposed Issue and PR text.

Mandatory full-suite, real-cloud E2E, remote CI and review remain unsatisfied. The decision remains
proposed, and any future PR must stay draft until those gates pass.
