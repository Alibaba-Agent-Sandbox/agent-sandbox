# CLI E2E baseline: Python oracle (`ebx` 0.2.0, original Python implementation)

- Binary under test: `EBX_BIN=<pristine Python ebx, easy-sandbox @ b15b88f>` (`ebx, version 0.2.0`)
- Date: 2026-10-12; cloud: real Alibaba Cloud FC agent sandbox platform (cn-hangzhou), credentials from the gitignored `cli/.env` (never recorded here)
- Method: `node e2e/run.mjs --json ... --markdown ...` executed **twice back to back** against the same account to detect flakiness; isolated HOME and cwd per suite, CI variables stripped.
- Run 1: {'pass': 129, 'fail': 0, 'skip': 3, 'xfail': 0}; run 2: {'pass': 129, 'fail': 0, 'skip': 3, 'xfail': 0}; sandboxes created per run: 2/2, leaked: 0/0 (verified with `list` after each run: none of the created ids remain).
- Flakiness: no scenario changed result between the two runs. Latencies vary 1-13 s per command (cloud/envd); `create-json`, `exec-basic` and `create-with-env-and-upload` allow a bounded retry for cold starts and `list-contains-sandbox`, `kill-yes-json` and `run-custom-command` poll with `eventually`; no retry was needed in either run.

| Suite | Scenario | Run 1 | Run 2 | Time (run1 / run2) | Notes |
|---|---|---|---|---|---|
| offline | `version` | PASS | PASS | 0.1s / 0.1s |  |
| offline | `help-root` | PASS | PASS | 0.1s / 0.1s |  |
| offline | `help-no-args` | PASS | PASS | 0.1s / 0.1s |  |
| offline | `help-sandbox` | PASS | PASS | 0.0s / 0.0s |  |
| offline | `help-sandbox-files` | PASS | PASS | 0.0s / 0.0s |  |
| offline | `help-sandbox-process` | PASS | PASS | 0.0s / 0.0s |  |
| offline | `help-sandbox-system` | PASS | PASS | 0.0s / 0.0s |  |
| offline | `help-template` | PASS | PASS | 0.0s / 0.0s |  |
| offline | `help-config` | PASS | PASS | 0.0s / 0.0s |  |
| offline | `help-mcp` | PASS | PASS | 0.1s / 0.1s |  |
| offline | `help-exec` | PASS | PASS | 0.0s / 0.0s |  |
| offline | `help-kill` | PASS | PASS | 0.0s / 0.0s |  |
| offline | `help-create` | PASS | PASS | 0.0s / 0.0s |  |
| offline | `unknown-command` | PASS | PASS | 0.0s / 0.0s |  |
| offline | `unknown-command-json` | PASS | PASS | 0.0s / 0.0s |  |
| offline | `missing-args-exec` | PASS | PASS | 0.0s / 0.0s |  |
| offline | `missing-args-run` | PASS | PASS | 0.0s / 0.0s |  |
| offline | `invalid-log-level` | PASS | PASS | 0.0s / 0.0s |  |
| offline | `invalid-list-status` | PASS | PASS | 0.0s / 0.0s |  |
| offline | `invalid-mcp-target` | PASS | PASS | 0.1s / 0.1s |  |
| offline | `upload-missing-local` | PASS | PASS | 0.0s / 0.0s |  |
| offline | `create-needs-route` | PASS | PASS | 0.2s / 0.2s |  |
| offline | `create-conflict` | PASS | PASS | 0.2s / 0.2s |  |
| offline | `kill-needs-target` | PASS | PASS | 0.2s / 0.2s |  |
| offline | `no-credentials-list` | PASS | PASS | 0.2s / 0.2s |  |
| offline | `no-credentials-list-json` | PASS | PASS | 0.2s / 0.2s |  |
| offline | `no-credentials-exec` | PASS | PASS | 0.2s / 0.2s |  |
| offline | `no-credentials-template-list` | PASS | PASS | 0.2s / 0.2s |  |
| offline | `config-list-json` | PASS | PASS | 0.2s / 0.2s |  |
| offline | `config-list-text` | PASS | PASS | 0.2s / 0.2s |  |
| offline | `config-get-default` | PASS | PASS | 0.2s / 0.2s |  |
| offline | `config-get-json` | PASS | PASS | 0.2s / 0.2s |  |
| offline | `config-get-unknown` | PASS | PASS | 0.0s / 0.0s |  |
| offline | `config-set-invalid-number` | PASS | PASS | 0.0s / 0.0s |  |
| offline | `config-set-get-delete` | PASS | PASS | 0.6s / 0.6s |  |
| offline | `config-set-numeric` | PASS | PASS | 0.2s / 0.2s |  |
| offline | `config-secret-masked` | PASS | PASS | 0.6s / 0.6s |  |
| offline | `config-env-overrides-store` | PASS | PASS | 0.1s / 0.1s |  |
| offline | `config-init-yes` | PASS | PASS | 0.0s / 0.0s |  |
| offline | `config-init-non-tty` | PASS | PASS | 0.0s / 0.0s |  |
| offline | `config-reset-shortcuts` | PASS | PASS | 0.0s / 0.0s |  |
| offline | `config-shortcut-expansion` | PASS | PASS | 0.0s / 0.0s |  |
| offline | `mcp-status-json` | PASS | PASS | 0.2s / 0.2s |  |
| offline | `mcp-status-text` | PASS | PASS | 0.2s / 0.2s |  |
| offline | `mcp-stop-not-running` | PASS | PASS | 0.1s / 0.1s |  |
| offline | `mcp-install-targets` | PASS | PASS | 0.9s / 0.9s |  |
| offline | `mcp-install-merges-existing` | PASS | PASS | 0.2s / 0.2s |  |
| offline | `template-init-python` | PASS | PASS | 0.0s / 0.0s |  |
| offline | `template-init-refuses-overwrite` | PASS | PASS | 0.2s / 0.2s |  |
| offline | `template-deploy-missing-dir` | PASS | PASS | 0.0s / 0.0s |  |
| offline | `template-search-local-index` | PASS | PASS | 0.8s / 0.8s |  |
| cloud-readonly | `config-list-masks-secrets` | PASS | PASS | 0.4s / 0.4s |  |
| cloud-readonly | `auth-wrong-key` | PASS | PASS | 1.1s / 1.0s |  |
| cloud-readonly | `auth-wrong-key-json` | PASS | PASS | 3.8s / 1.2s |  |
| cloud-readonly | `auth-wrong-key-template-list` | PASS | PASS | 1.2s / 0.9s |  |
| cloud-readonly | `list-json-shape` | PASS | PASS | 1.3s / 4.6s |  |
| cloud-readonly | `list-text` | PASS | PASS | 2.9s / 1.0s |  |
| cloud-readonly | `list-status-accepts-valid` | PASS | PASS | 1.0s / 1.0s |  |
| cloud-readonly | `template-list-json` | PASS | PASS | 2.4s / 1.0s |  |
| cloud-readonly | `template-list-text` | PASS | PASS | 1.2s / 1.1s |  |
| cloud-readonly | `template-info` | PASS | PASS | 1.2s / 0.9s |  |
| cloud-readonly | `template-info-missing` | PASS | PASS | 1.1s / 1.1s |  |
| cloud-readonly | `template-info-missing-json` | PASS | PASS | 1.2s / 0.9s |  |
| cloud-readonly | `template-delete-missing` | PASS | PASS | 2.6s / 0.9s |  |
| cloud-readonly | `create-missing-template` | PASS | PASS | 1.0s / 1.0s |  |
| cloud-readonly | `create-missing-template-json` | PASS | PASS | 1.0s / 1.1s |  |
| cloud-readonly | `info-missing-sandbox` | PASS | PASS | 2.0s / 1.0s |  |
| cloud-readonly | `info-missing-sandbox-json` | PASS | PASS | 2.3s / 1.2s |  |
| cloud-readonly | `exec-missing-sandbox` | PASS | PASS | 1.1s / 1.0s |  |
| cloud-readonly | `kill-missing-sandbox` | PASS | PASS | 1.0s / 1.0s |  |
| cloud-readonly | `files-missing-sandbox` | PASS | PASS | 1.0s / 1.0s |  |
| cloud-readonly | `kill-all-guard` | SKIP | SKIP | 0.0s / 0.0s | opt-in: set EBX_E2E_ALLOW_KILL_ALL=1 (a buggy implementation could destroy every sandbox of the account) |
| cloud-lifecycle | `create-json` | PASS | PASS | 2.0s / 2.3s |  |
| cloud-lifecycle | `list-contains-sandbox` | PASS | PASS | 1.6s / 4.0s |  |
| cloud-lifecycle | `list-filter-running` | PASS | PASS | 1.1s / 1.2s |  |
| cloud-lifecycle | `info-text` | PASS | PASS | 1.5s / 1.0s |  |
| cloud-lifecycle | `info-json` | PASS | PASS | 1.1s / 1.4s |  |
| cloud-lifecycle | `exec-basic` | PASS | PASS | 2.0s / 1.9s |  |
| cloud-lifecycle | `exec-exit-code-propagates` | PASS | PASS | 2.5s / 4.2s |  |
| cloud-lifecycle | `exec-json` | PASS | PASS | 2.4s / 4.8s |  |
| cloud-lifecycle | `exec-json-nonzero-exit` | PASS | PASS | 2.6s / 8.0s |  |
| cloud-lifecycle | `exec-cwd` | PASS | PASS | 4.3s / 3.3s |  |
| cloud-lifecycle | `exec-quoting` | PASS | PASS | 3.0s / 10.2s |  |
| cloud-lifecycle | `exec-unicode` | PASS | PASS | 3.9s / 3.1s |  |
| cloud-lifecycle | `exec-quiet` | PASS | PASS | 2.1s / 4.8s |  |
| cloud-lifecycle | `exec-ci-mode` | PASS | PASS | 2.2s / 3.3s |  |
| cloud-lifecycle | `exec-ci-env-var` | PASS | PASS | 2.9s / 1.9s |  |
| cloud-lifecycle | `exec-timeout` | PASS | PASS | 8.9s / 13.4s |  |
| cloud-lifecycle | `upload-download-binary-roundtrip` | PASS | PASS | 8.5s / 8.4s |  |
| cloud-lifecycle | `upload-json` | PASS | PASS | 3.1s / 2.0s |  |
| cloud-lifecycle | `upload-directory` | PASS | PASS | 6.7s / 4.2s |  |
| cloud-lifecycle | `download-json` | PASS | PASS | 3.5s / 3.0s |  |
| cloud-lifecycle | `download-missing-remote` | PASS | PASS | 3.3s / 1.9s |  |
| cloud-lifecycle | `files-list-json` | PASS | PASS | 2.0s / 1.9s |  |
| cloud-lifecycle | `files-list-text` | PASS | PASS | 2.5s / 1.9s |  |
| cloud-lifecycle | `files-stat-json` | PASS | PASS | 1.9s / 1.8s |  |
| cloud-lifecycle | `files-stat-missing` | PASS | PASS | 2.6s / 2.5s |  |
| cloud-lifecycle | `files-mkdir` | PASS | PASS | 3.0s / 2.0s |  |
| cloud-lifecycle | `files-mv` | PASS | PASS | 4.8s / 4.4s |  |
| cloud-lifecycle | `files-search` | PASS | PASS | 2.2s / 3.8s |  |
| cloud-lifecycle | `files-rm-needs-confirmation` | PASS | PASS | 5.5s / 4.0s |  |
| cloud-lifecycle | `files-rm-yes` | PASS | PASS | 4.1s / 10.4s |  |
| cloud-lifecycle | `process-start-exit-code` | PASS | PASS | 1.9s / 4.2s |  |
| cloud-lifecycle | `process-start-json` | PASS | PASS | 9.0s / 6.5s |  |
| cloud-lifecycle | `process-list` | PASS | PASS | 1.9s / 2.4s |  |
| cloud-lifecycle | `process-info-pid1` | PASS | PASS | 2.2s / 2.0s |  |
| cloud-lifecycle | `process-signal` | PASS | PASS | 3.6s / 3.1s |  |
| cloud-lifecycle | `shell-stream` | PASS | PASS | 3.1s / 3.7s |  |
| cloud-lifecycle | `connect-repl` | PASS | PASS | 1.7s / 4.3s |  |
| cloud-lifecycle | `system-info` | PASS | PASS | 2.1s / 5.0s |  |
| cloud-lifecycle | `system-info-json` | PASS | PASS | 2.0s / 2.0s |  |
| cloud-lifecycle | `system-env-filter` | PASS | PASS | 1.8s / 2.9s |  |
| cloud-lifecycle | `system-ports` | PASS | PASS | 2.3s / 3.6s |  |
| cloud-lifecycle | `system-metrics` | PASS | PASS | 4.9s / 2.8s |  |
| cloud-lifecycle | `system-packages` | PASS | PASS | 4.7s / 2.7s |  |
| cloud-lifecycle | `capabilities-json` | PASS | PASS | 1.1s / 4.2s |  |
| cloud-lifecycle | `capabilities-text` | PASS | PASS | 1.1s / 1.2s |  |
| cloud-lifecycle | `run-custom-command` | PASS | PASS | 12.3s / 11.1s |  |
| cloud-lifecycle | `create-with-env-and-upload` | PASS | PASS | 8.3s / 8.6s |  |
| cloud-lifecycle | `kill-needs-confirmation` | PASS | PASS | 3.7s / 1.3s |  |
| cloud-lifecycle | `kill-yes-json` | PASS | PASS | 4.0s / 5.3s |  |
| cloud-lifecycle | `kill-twice` | PASS | PASS | 1.0s / 3.4s |  |
| catalog | `search-python` | PASS | PASS | 0.3s / 0.3s |  |
| catalog | `search-json-shape` | PASS | PASS | 0.3s / 0.3s |  |
| catalog | `search-no-match` | PASS | PASS | 0.3s / 0.3s |  |
| catalog | `search-caches-index` | PASS | PASS | 0.6s / 0.5s |  |
| catalog | `install-download-only` | PASS | PASS | 0.5s / 0.5s |  |
| catalog | `install-download-only-json` | PASS | PASS | 0.5s / 0.5s |  |
| catalog | `install-unknown-template` | PASS | PASS | 0.3s / 0.3s |  |
| docker-deploy | `deploy-minimal-template` | SKIP | SKIP | 0.0s / 0.0s | opt-in: set EBX_E2E_DOCKER=1 (builds an image and pushes it to ACR; slow and costs real cloud resources) |
| docker-deploy | `create-from-deployed-template` | SKIP | SKIP | 0.0s / 0.0s | opt-in: set EBX_E2E_DOCKER=1 (builds an image and pushes it to ACR; slow and costs real cloud resources) |
| builtin | `leak-check` | PASS | PASS | 0.0s / 0.0s |  |

## Snapshot: Node port (informational, not the baseline)

The same suite was executed once against the in-progress Node.js port (`src/bin/ebx.ts` run through `tsx`, working tree at commit `e26562b`) on 2026-10-12: **129 pass, 3 skip, 0 fail**, sandboxes created 2, leaked 0. The 3 skips are the same opt-in scenarios listed under "Not executed". The port is still being developed, so this is a point-in-time observation; rerun `npm run e2e` against a build before claiming parity.

The differential harness (`parity/diff`, `--fast`) gave 118/118 identical for oracle vs oracle and 118/118 identical for oracle vs port on the same day. A first port run taken while the port sources were being edited showed 2 transient MCP-artifact diffs that did not reproduce.

## Oracle behaviours observed while building the suite

These are properties of the Python oracle on the real cloud; the suite pins the stable ones and deliberately does **not** assert the quirky ones (a port may legitimately differ or fix them).

| Observation | Treatment in the suite |
|---|---|
| `sandbox files stat` prints empty `Name`/`Path` and `Size 0` for existing files (envd returns the entry under a different key) | only the JSON key set `Name/Path/Type/Size` is asserted |
| `sandbox files list` reports directories with `Type file` against the live envd (numeric entry type not understood) | `type` asserted to be a string, never `directory` |
| `list --status paused` returns running sandboxes (the filter is not applied server-side) | only the *accepted* values and the `running` filter are asserted |
| `info` always shows `Timeout 300s` even if the sandbox was created with `--timeout 900` | not asserted |
| `exec "exit 7"` (a bare shell builtin) fails with `E3006` (exit 1) because the command is exec'ed without a shell; `echo x; exit 7` works and propagates 7 | the scenario uses the compound form |
| `template list` shows `N/A` aliases/status for every template | only the key set is asserted |
| `sandbox files search` returns hits in non-deterministic order | order-insensitive matchers |
| `sandbox system ports` exits 1 ("ss/netstat not available") on the python-hello image | exit 0 or 1 accepted |
| `template list` with a wrong key exits **1**, whereas every other command exits **3** (E1000) | asserted exactly as observed (`auth-wrong-key-template-list`: non-zero + `401`) |

## Not executed (and why)

| Scenario | Reason |
|---|---|
| `docker-deploy/*` (`template build`/`deploy` -> ACR push -> official CreateTemplate -> sandbox) | Opt-in (`EBX_E2E_DOCKER=1`). Docker works locally, but pushing real image layers to personal ACR from this environment stalls at about 17 KB/s (see `python-sdk/e2e/KNOWN-ISSUES.md`, KI-011), so a full deploy cannot finish in a reasonable time. The scenario is written and syntax-checked; it self-skips with this exact reason. |
| `cloud-readonly/kill-all-guard` | Opt-in (`EBX_E2E_ALLOW_KILL_ALL=1`): `kill --all` could destroy other users' sandboxes in a shared account if an implementation ignored the confirmation. |
| `mcp start` / `mcp deploy` | Long-running stdio/HTTP server and artifact generation; covered by the unit tests, not by this black-box suite (`mcp stop`, `status`, `install` are covered). |
| AI generation (`create "<description>"`, `template init "<description>"`) | Requires the Qwen Code binary and a DashScope key, non-deterministic by nature. |
