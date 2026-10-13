# Real-cloud verification of the SDK defect fixes (KI-001 .. KI-008)

> 中文说明见 [README.zh-CN.md](README.zh-CN.md).

The Python SDK fixed the defects recorded in `python-sdk/e2e/KNOWN-ISSUES.md` (KI-001 .. KI-007, KI-010); the
Node CLI ports the same fixes (see `CHANGELOG.md` Unreleased > Fixed and `parity/sdk-defect-fixes.md`). The unit
tests (`tests/test_known_issues/ki00N_*.test.ts`) pin the wire shapes against a mock transport. `run.mjs` proves
the same behaviour against the **real platform and a real envd**: the Node counterpart of the known-issue tests in
`python-sdk/e2e/test_03_commands.py` and `test_04_files_envd.py`.

```bash
npm run build                                   # the SDK scenarios import dist/ (ABX_SDK_DIST overrides)
ABX_BIN="node dist/bin/abx.js" node e2e/known-issues/run.mjs
ABX_BIN="node dist/bin/abx.js" node e2e/known-issues/run.mjs --filter 'KI-004|ki003' --json out.json
```

Credentials come from the environment or the gitignored `cli/.env` (`ABX_SANDBOX_API_KEY`, `ABX_SANDBOX_BASE_URL`, `ABX_SANDBOX_DOMAIN`);
they are never printed (all captured output is masked). Without credentials the script prints `SKIP: ...` and
exits 0. `ABX_E2E_TEMPLATE` selects the template (default `python-hello`).

## What it does

One sandbox is created through the CLI (`create --template ... --timeout 900`) and removed in `finally`, on
SIGINT/SIGTERM, and through the ledger in `e2e/.state/` (`npm run e2e:cleanup` is the janitor). The account is
listed before and after; the run fails if any sandbox is left (`leak check: ... leaked=0`).

| Scenario | KI | Checks (through the CLI unless noted) |
|---|---|---|
| `ki001-per-call-env` | 001 | SDK `commands.run(..., { env })`: the variable reaches the command (`envs`, not `envVars`) |
| `ki002-prepare` | 002 | builds a directory tree with `abx sandbox files mkdir` / `upload` |
| `ki002-list-json-reports-directories` | 002 | `files list --json`: directories are `directory`, files are `file`, real names and sizes |
| `ki002-stat-directory-and-file` | 002 | `files stat --json`: real `Name`/`Path`/`Type`/`Size` (nested `entry`) |
| `ki007-list-missing-directory` | 007 | `files list` of a missing directory: exit 4, `E4001` (envd answers HTTP 200 with no entries) |
| `ki007-list-empty-directory-still-ok` | 007 | `files list` of an existing empty directory: exit 0 |
| `ki005-stat-missing-file` | 005 | `files stat` of a missing path: exit 4, `E4001` |
| `ki005-download-missing-file` | 005 | `download` of a missing file: exit 4, `E4001`, nothing written |
| `ki005-missing-sandbox` | 005 | `info` / `exec` of an unknown sandbox: exit 4, `E2009` |
| `ki006-bad-api-key` | 006 | wrong API key: exit 3, `E1001` (`list` and `create`), the key never appears |
| `ki003-sdk-timeout-kills-the-process` | 003 | SDK `run("sleep 113", { timeout: 3 })`: `CommandTimeoutError` (`E3001`) and the process is gone |
| `ki003-cli-exec-timeout` | 003 | `abx exec --timeout 3 "sleep 114"`: exit 5, `E3001`, process gone |
| `ki004-sdk-kill` | 004 | SDK `commands.kill(pid)` terminates a running process |
| `ki004-sdk-send-input` | 004 | SDK `commands.sendInput` reaches stdin of a running `head -n 1` |
| `ki004-cli-unsupported-signal` | 004 | `abx sandbox process signal --signal 2`: rejected with the envd message before any request |

Per-call env, background processes and stdin have no `abx` command, so those scenarios use the Node SDK built from
the same sources as `ABX_BIN` (`ABX_SDK_DIST`, default `<repo>/dist`).

## Related changes in the black-box suite

The scenarios whose output can take more than one form accept both (`404` or `E4001`/`E2009`, `E1000` or `E1001`): `auth-wrong-key*`,
`info-missing-sandbox`, `exec-missing-sandbox`, `kill-missing-sandbox`, `kill-twice`, `download-missing-remote`,
`files-stat-missing`.
