# Verification: Terminal installation and prompts

- Date: 2026-10-23
- Change: Issues [114](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/114), [115](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/115); scoped install.sh, CLI prompts/call sites, tests and bilingual docs based on cd7f5e9.
- Result: PARTIAL (remote delivery pending at this capture)
- Package under test: @agent-sandbox/cli 0.4.9 source build; actual curl, sh, filesystem, Node/Inquirer and POSIX terminal.
- Environment: Linux x64, Node 22.22.2; isolated temporary HOME; no cloud credentials used.

## What was verified

Real transfer progress on terminal stderr with installation script stdin piped. Redirected output stays quiet. Real arrow-key/default/cancel behavior and scripted selections; existing guided setup isolation and persistence regressions. Template capability declarations and actual backend acceptance remain independent.

## Commands run

- `PATH=<shellcheck-bin>:$PATH node --test tests/install/install.test.mjs`
- `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`
- `node node_modules/eslint/bin/eslint.js .`
- `npm run build`
- `npm test` (with ABX_SERVER_SDK_SRC and ABX_AWESOME_PROVIDERS selecting existing local checkouts)
- `npm pack --pack-destination <temporary-directory>`; `npm install --global --prefix <temporary-prefix> <tested-tarball>`
- `node scripts/check-release-artifact.mjs <temporary-prefix>/bin/abx`
- `ABX_UPDATE_EVIDENCE=1 node node_modules/vitest/vitest.mjs run tests/test_cli_evidence/test_evidence_snapshots.test.ts -t '\[version\]'`
- `node scripts/capture-cli-evidence.mjs --command config --out .agents/evidence/cli/terminal-menus-20261023`
- `bash scripts/check-repo-health.sh --quiet`; `npm run check:hygiene`
- `node node_modules/vitest/vitest.mjs run tests/test_cli/test_select_prompt.test.ts tests/test_cli/test_guidance_contract.test.ts tests/test_cli/test_template_guided_configuration.test.ts tests/test_cli/test_config_init.test.ts tests/test_cli/test_configuration_setup_regressions.test.ts tests/test_cli/test_config_providers.test.ts tests/test_cli/test_create_nl.test.ts tests/test_cli/test_template_github_token_setup.test.ts`

## Results

| Check | Result | Notes |
| --- | --- | --- |
| Installer, actual curl/HTTP and real terminal | PASS | 10 tests; measured 50.0% and 100.0%, no percent on stdout, correct installed bytes; existing checksum/platform/fallback checks |
| Focused CLI and real terminal regressions | PASS | 182 tests across eight files, including five actual terminal key sequences |
| Types | PASS | Strict project typecheck |
| ESLint | PASS | Zero errors; 277 existing warnings |
| Build | PASS | Compiled package and copied standard assets |
| Installed npm artifact | PASS | Packed and installed 0.4.9 in a temporary prefix; executable passed isolated preflight/help/notices and actual terminal Down/Down/Enter cancellation |
| Full local suite | PARTIAL | Initial capture: 4131 passed, two skipped, 21 failed. One failure was the version snapshot updated for 0.4.9; the remaining 20 network-sensitive failures match the six baseline files documented in [guided setup evidence](2026-10-22-guided-configuration.md). Complete remote Node 20/22 CI is required |
| Version snapshot | PASS | Regenerated with ABX_UPDATE_EVIDENCE=1 after the intentional patch bump |
| CLI capture | PASS | 20 config cases captured into a new dated evidence directory; no historical capture overwritten |
| Health/hygiene | PASS | Health has the existing 11 warnings, zero failures; hygiene reports no local paths/credential-like strings. Test Python code is embedded in an MJS test helper, consistent with the Node-only repository |
| Remote latest-head CI / delivery | PENDING | Record actual remote state separately after completion |
| Public source observation | PASS | Current python-hello registry detail shows automatic preparation and does not render the old existing-ID/No-PTY labels |

## Cleanup

Tests remove their temporary installation projects and terminal resources. No cloud operations or resources were created. No local user/provider store was modified.

## Problems found

The initial source-executable probe was not yet installed/executable (EACCES); actual npm installation corrected the harness and passed. The initial health check correctly rejected a standalone Python test helper; it was replaced by an embedded MJS test driver without changing the health gate. Local full-suite networking has previously documented restrictions; no tests or network checks were weakened.

## Not verified

Windows terminal interaction and macOS curl are covered by the existing cross-platform library and CI/artifact matrix as available; a Linux PTY run is not native macOS/Windows evidence. No new provider preparation/PTY implementation or real cloud capability acceptance is claimed. Publication and website delivery pending.
