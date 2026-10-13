# Mock-vs-oracle differential harness

Runs **identical argv** against two `abx` binaries and diffs everything observable: exit code,
normalised stdout/stderr, files written (config, MCP configs, downloads) and the **HTTP traffic** each
binary sends to a deterministic stub of the cloud. It answers "does the port behave exactly like the
Python oracle?" without a cloud account, in under a minute.

> **Oracle scope.** The oracle is the Python CLI as it was before the command-surface redesign. Cases for spellings that
> no longer exist (user shortcuts, top-level `init`/`install`, `process start`, `shell-stream`, global `--timeout`/`--profile`,
> `template.yaml` `custom_commands`) were removed; everything else still compares against it. The harness needs a
> checkout of that oracle and cannot run from this repository alone. The stubs also set the oracle's `E2B_*` / `SANDBOX_*` environment names, which the
> CLI no longer reads (it reads `ABX_*`), so treat the harness as historical tooling, not as a CI gate.

> 中文说明见 [README.zh-CN.md](README.zh-CN.md).

```bash
ABX_ORACLE=/path/to/python/venv/bin/abx \
ABX_BIN="node dist/bin/abx.js" \
node parity/diff/diff.mjs [--filter regex] [--fast] [--verbose] [--show] [--out reports/dir] [--list]

ABX_ORACLE=... node parity/diff/selftest.mjs     # proves the harness catches deliberate regressions
ABX_ORACLE=X ABX_BIN=X node parity/diff/diff.mjs # oracle vs itself: must report 0 differences
```

| File | Role |
|---|---|
| `stub.mjs` | One HTTP server: platform REST (`/sandboxes`, `/templates`) and envd Connect RPC (`/process.Process/*` streaming frames, `/filesystem.Filesystem/*`, `/files`). Responses carry `envdUrl` pointing back at the stub; a tiny canned command emulator answers `echo`, `ls`, `exit N`, unknown executables (HTTP 500), and `sleep` (hangs, for timeout cases). Faults (401/404/429/500) are injectable per case. Records every request. |
| `cases.mjs` | 120 cases (88 seeded from the original 100-case evidence registry `tests/test_cli_evidence`, 32 added for sandbox files/process, kill/exec variants and stub-only failure modes). Each case records its `evidence` provenance. |
| `diff.mjs` | Runner: per case and per binary a fresh HOME/cwd, the stub world is reset, argv executed, output normalised (sandbox ids, timestamps, durations, temp paths, stub address, binary path in MCP configs), then compared. `--fast` skips cases that wait for timeouts/retries. |
| `selftest.mjs` | Diffs the oracle against a mutant wrapper (rewrites a word, changes an exit code) and checks the harness reports exactly those cases. |

Normalisation is deliberately narrow: anything not listed above is compared byte for byte. A case
with `wire: false` (offline cases) compares only output/artifacts.

What is **not** covered: interactive prompts beyond piped stdin, AI generation, Docker/ACR, streaming of
long-running output timing, TLS/HTTP2 behaviour of the real gateway. Use the real-cloud suite in
[`../../e2e/`](../../e2e/README.md) for those.

Reports (`--out`) are written as `diff-report.json` and `diff-report.md` and contain only normalised
output (the stub credentials are fake).

## Framework / output-layer harnesses

Self-contained scripts that need only `ORACLE_VENV` (a venv with the original package; no stub server). They render or
run the same input in-process on both implementations and diff the results.

| Script | Covers |
|---|---|
| `orjson_gen.py` | Generates `orjson_cases.json` with the oracle's orjson; consumed by `tests/test_cli/test_orjson_dumps.test.ts` |
