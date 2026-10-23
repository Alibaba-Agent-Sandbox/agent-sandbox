# Verification: Provider installation progress

- Date: 2026-10-23
- Change: [Issue 119](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/119)
- Result: PARTIAL — local implementation verified; publication and required remote CI pending
- Package: @agent-sandbox/cli 0.4.10, built from the scoped branch with locked dependencies
- Environment: Linux x64, Node 22.22.2, Git and Python POSIX terminal driver; no credentials recorded

## What was verified

The exact public OpenSandbox Git install succeeds from an isolated home with source inspection, Git fetching, validation, write and real plugin handshake stages. A delayed real Git fetch and a real terminal verify the elapsed stage display. JSON/quiet output, consent ordering, rollback, timeout and shallow fallback are covered by regressions.

## Commands run

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run lint
npm run build
npm test
npx vitest run tests/test_providers/test_installer.test.ts tests/test_providers/test_installer_git_wait.test.ts tests/test_cli/test_provider_commands.test.ts tests/test_cli/test_provider_install_terminal.test.ts tests/test_cli_evidence/test_evidence_snapshots.test.ts
ABX_UPDATE_EVIDENCE=1 npx vitest run tests/test_cli_evidence/test_evidence_snapshots.test.ts -t '\[(version|help-provider)'
node scripts/capture-cli-evidence.mjs --command help-provider --out .agents/evidence/cli/provider-progress-20261023
npm pack --pack-destination <temporary-pack-directory>
npm install --global --prefix <temporary-prefix> <tested-tarball>
node scripts/check-release-artifact.mjs <temporary-prefix>/bin/abx
abx provider install alibaba-agent-sandbox/awesome-providers//opensandbox --allow-unpinned --yes
ABX_BIN=<installed-abx> node e2e/run.mjs --suite offline
bash scripts/check-repo-health.sh
npm run check:hygiene
```

## Results

| Scenario | Result | Evidence |
| --- | --- | --- |
| Final targeted installer/CLI/terminal/snapshots | PASS | 247 tests |
| Real delayed Git + terminal | PASS | Fetch stage redraw includes 1s before success; final stdout contains only result |
| Real public GitHub OpenSandbox install | PASS | Source/plugin 0.4.1, actual post-consent handshake, isolated home; 1.35s in development run; 1.24s using the actual installed npm artifact |
| Actual installed npm artifact smoke | PASS | Version 0.4.10, terminal menu, JSON result, guidance/help/notices |
| Typecheck / ESLint / build | PASS | Locked source environment |
| Full local suite | BASELINE FAIL | 4096 pass, 10 fail, 56 skipped; all ten failures reproduced on unmodified d426df8 in the same environment |
| Baseline comparison | CONFIRMED | Three network/TLS/WebSocket files: 10 fail, 18 pass on unmodified main |
| Broad installed offline E2E | BASELINE FAIL | 62 pass, 3 fail, 1 skip; same config-list-json, config-set-invalid-number and template-search-local-index failures on unmodified main |
| Health / hygiene | PASS | Initial health PASS=105 WARN=11 FAIL=0; hygiene clean; final record check repeated before commit |
| Latest-head CI, release, website | PENDING | Required before closing Issue 119; later immutable delivery receipt will be linked there |

## Cleanup

Public provider installs and terminal fixtures use disposable homes; removed after execution. No backend sandbox, template or OpenSandbox server was created. The broad offline harness reports zero created/zero leaked resources.

## Problems found

The missing feedback and unconditional shallow retry are fixed in this branch. Existing unrelated local network/TLS/WebSocket and offline-harness failures remain explicit limitations; no tests or cloud controls were weakened.

## Not verified

This capture does not establish public npm/binary publication or official mirror deployment. Remote CI and post-release checks will receive separate dated evidence linked from the Issue. No cloud sandbox lifecycle is exercised because installation does not create one.
