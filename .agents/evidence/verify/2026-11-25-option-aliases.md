# Verification: CLI option aliases

- Date: 2026-11-25
- Baseline: main 57c7632706aac739171fcdb7c2849938e58295ef.
- Change: [Issue #264](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/264) and [decision](../../notes/proposed/feature/2026-11-25-option-aliases.md).
- Result: PARTIAL — focused tests pass; full local rerun and remote gates pending.
- Candidate: source CLI 0.5.10 identifier, not a released 0.5.10 replacement. Node.js 22.22.2, Linux.

## What was verified

Independent design and patch review accepted alias normalization and preservation of actual boolean pairs. Ten callback regressions cover values, errors, defaults and ordering. The unmodified implementation failed eight and passed two; the candidate passed all ten.

## Commands run

| Command | Result |
| --- | --- |
| npm ci --no-audit --no-fund | PASS, locked installation |
| npx vitest run tests/test_cli/test_option_aliases.test.ts | Before: 8 failed / 2 passed; after: 10 passed |
| make ci | FAIL in tests: 4,571 passed, 22 failed, 5 skipped. Hygiene, typecheck, lint and build passed before tests. Network/loopback and sibling shared-fixture results are retained; not counted as a full pass. |
| npm test with CI-pinned SDK/Provider inputs and isolated loopback | Pending |
| Built CLI provider install local-process --yes, then provider test local-process --opt debug=true --option debug=true -o debug=true | PASS: 15 passed, 0 failed, 3 explicitly unsupported features skipped |

## Results and limitations

The local-process fixture is real code, subprocesses and files on the local machine. It does not prove any cloud backend. A normal shared-network suite returned a non-project HTTP 501 for loopback traffic; isolated results are recorded separately. The first run also detected the neighboring SDK main config fixture differs from this CLI's frozen fixture; CI checks out its SDK dependency inside vendor instead.

## Cleanup

The isolated fixture home and its resources were removed after the command returned. No package was published. Cloud resource results and exact-head CI are pending.

## Not verified

No change to managed Key authorization, Provider API coverage or arbitrary backend behavior is claimed.
