# Verification: CLI option aliases

- Date: 2026-11-25
- Baseline: main 57c7632706aac739171fcdb7c2849938e58295ef.
- Change: [Issue #264](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/264) and [decision](../../notes/implemented/feature/2026-11-25-option-aliases.md).
- Result: PARTIAL — focused tests pass; remote gates pending; local environment limitations recorded.
- Candidate: source CLI 0.5.10 identifier, not a released 0.5.10 replacement. Node.js 22.22.2, Linux.

## What was verified

Independent design and patch review accepted alias normalization and preservation of actual boolean pairs. Ten callback regressions cover values, errors, defaults and ordering. The unmodified implementation failed eight and passed two; the candidate passed all ten.

## Commands run

| Command | Result |
| --- | --- |
| npm ci --no-audit --no-fund | PASS, locked installation |
| npx vitest run tests/test_cli/test_option_aliases.test.ts | Before: 8 failed / 2 passed; after: 10 passed |
| make ci | FAIL in tests: 4,571 passed, 22 failed, 5 skipped. Hygiene, typecheck, lint and build passed before tests. Network/loopback and sibling shared-fixture results are retained; not counted as a full pass. |
| npm test with CI-pinned SDK/Provider inputs and isolated loopback | 4,588 passed, 3 failed, 7 skipped. Remaining failures: one readiness timeout, no DNS in isolated namespace, and the neighboring SDK main fixture mismatch. |
| ABX_BIN=candidate node e2e/run.mjs --suite cloud-readonly --filter list | PASS: 9 cloud read-only scenarios; leak check skipped because no sandbox was created. Existing credentials were supplied only in the child environment. |
| bash scripts/check-repo-health.sh --quiet | PASS=106, WARN=11, FAIL=0 |
| Targeted readiness test on its original assertion | PASS, 1 passed / 109 unselected tests skipped |
| Targeted unknown-host resolver test with ordinary DNS | PASS, 1 passed / 3 unselected tests skipped |
| npm pack --dry-run --json piped to node scripts/check-package-entry.mjs | PASS, CLI entry and Skill references are present |
| Built CLI provider install local-process --yes, then provider test local-process --opt debug=true --option debug=true -o debug=true | PASS: 15 passed, 0 failed, 3 explicitly unsupported features skipped |

## Results and limitations

The local-process fixture is real code, subprocesses and files on the local machine. It does not prove any cloud backend. A normal shared-network suite returned a non-project HTTP 501 for loopback traffic; isolated results are recorded separately. The first run also detected the neighboring SDK main config fixture differs from this CLI's frozen fixture; CI checks out its SDK dependency inside vendor instead.

## Cleanup

The isolated fixture home and its resources were removed after the command returned. No package was published. The focused cloud read-only suite created zero sandboxes and had zero unconfirmed or unresolved creates. Exact-head remote CI remains pending.

## Not verified

No change to managed Key authorization, Provider API coverage or arbitrary backend behavior is claimed.

The isolated rerun retained its three failures. Independent original-assertion reruns passed the readiness and DNS tests; the remaining sibling fixture comparison depends on a checkout layout not used by the remote CI. These reruns do not rewrite the full-run totals.
