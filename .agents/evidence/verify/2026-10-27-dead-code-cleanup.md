# Verification: Scoped unused-code cleanup

- Date: 2026-10-27
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/203
- Base revision: `a27b682218825532ef96028faa314cbda5ddada6`
- Functional patch SHA256: `a152ad4a77bde7900dda829212de867dd51df94008940a2b919801438a9a4771` (Git binary diff against the base, excluding records/docs/changelog).
- Result: BLOCKED
- Environment: Linux; Node 22.22.2, TypeScript 5.9.3, ESLint 10.12.0; final Python checks use system Python 3.13.13; Ruff 0.17.3.

## What was verified

The scoped deletion preserves observable behavior, public contracts, generator ownership and historical evidence. Work is isolated from pre-existing workspace edits. Scope is the functional patch above plus its bilingual documentation, changelog where applicable, decision and evidence; current-head CI will bind verification to the pushed commit.

## Commands and results

| Command / check | Result | Evidence |
| --- | --- | --- |
| `npm ci` after lockfile update | PASS | Reproducible installation; removed dependency has no source or remaining lockfile consumer. |
| `npm run typecheck` | PASS | Enhanced baseline had 94 diagnostic lines; reviewed findings removed and both noUnused gates now enabled. |
| `npm run lint` (within final `make ci`) | PASS | 0 errors, 168 existing style warnings. |
| `make ci` with absolute pinned fixture roots | IN PROGRESS | Full tests, parity coverage and package-content checks still pending at this checkpoint. |
| `bash scripts/check-repo-health.sh` | PASS | 106 pass, 11 warnings, 0 failures before final evidence update. |
| JavaScript unused-binding review | PASS | 92 files reviewed; imports/private locals removed. Remaining scanner-only unused-disable notice is not an unused binding. |
| Existing-key `abx sandbox list --format json` | PASS | Read-only service access succeeded; response omitted. |
| `ABX_BIN=<immutable compiled artifact> npm run e2e` | IN PROGRESS | Existing service key only; AK/SK removed from subprocess environment. |

The fixture roots were absolute paths to the workflow-pinned provider and Python sources. They are represented below by environment variable names rather than machine-local paths:

```sh
ABX_AWESOME_PROVIDERS="$PROVIDER_FIXTURE" ABX_SERVER_SDK_SRC="$PYTHON_FIXTURE/server-sdk/src" PYTHON_SDK_ROOT="$PYTHON_FIXTURE" make ci
```

Initial runs are preserved separately: lint caught a leftover write to an unused counter, which was fixed; a relative-fixture run was canceled; another attempt stopped on a transient temporary-filesystem I/O error before product checks. The final run uses corrected absolute fixtures. The commit secret hook flagged two pre-existing fixed credentials in the local parity stub; both are now explicitly documented as synthetic placeholders, without changing their values or test behavior. An initial service probe used unsupported `--json` for a standard command and failed at argument parsing; the corrected `--format json` probe succeeded.

## Scope and further analysis

Private declarations/write-only state and unused bindings are removed, while logger initialization and hooks still execute. The positional WebSocket argument remains. The nine original orphan-module findings are already resolved on accepted main. Eleven exported helpers remain because the distributed package permits deep imports; generator-owned helpers require canonical-source changes. Maintained standard CLI source, vendored attribution, golden captures and public exports are unchanged.

## Cleanup and remaining gates

Cloud acceptance is running with unique test ownership. No cleanup success is claimed at this checkpoint. Required current-head remote Node matrix, reviews and complete real-cloud results remain pending. This PR stays draft until mandatory gates pass.
