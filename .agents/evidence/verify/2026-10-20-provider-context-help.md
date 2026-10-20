# Verification: Provider context help and operation runner

- Date: 2026-10-20
- Change: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/83
- Result: PARTIAL — relevant regressions and real npm control-plane calls pass; local full-suite baseline failures and standalone packaging follow-up are recorded below. Remote gates are pending.
- Source: CLI base `4aec47b734be04fbadc932b0bbf4cd7ae0ac1eb4` plus the scoped Provider help/runner changes; catalog fixtures `9d2cf07467ff0e36303e4c80cbfe9fbf0fd70c6d`.
- Environment: Linux x64, Node 22.22.2. Cloud credentials supplied only through environment from an ignored source; no values recorded.
- Artifacts: lockfile-installed TypeScript build and Node SEA candidate. Version remains 0.4.0 for these unreleased candidates; no publication is implied.

## What was verified

Provider metadata automatically supplies default/explicit contextual help and the isolated
`provider run OPERATION` tree. Tests cover opaque names that coincide with host commands,
per-invocation switching, empty catalogs, reinstall/refresh, English/Chinese descriptions,
schema help, malformed defaults and integrity failures, repair, old JSON compatibility,
confirmation/input gates and marker plugins proving help does not load code.

## Commands run

```sh
npm run typecheck
make ci
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy make ci
ABX_UPDATE_EVIDENCE=1 node_modules/.bin/vitest run tests/test_cli_evidence
node_modules/.bin/vitest run tests/test_cli/test_provider_operation_help.test.ts tests/test_cli/test_provider_management_commands.test.ts tests/test_providers/test_management_commands.test.ts tests/test_providers/test_conditional_commands.test.ts tests/test_providers/test_registry_scoping.test.ts tests/test_cli_evidence
npm run parity:coverage
node scripts/build_binary.mjs
ABX_BIN='<built Node CLI>' node e2e/run.mjs --suite provider-commands-offline,provider-operation-help-offline
ABX_BIN='<built Node CLI>' npm run e2e -- --suite provider-management-cloud
ABX_BIN='<isolated standalone candidate>' npm run e2e -- --suite provider-management-cloud
git diff --check
```

Paths are symbolic to avoid embedding workstation paths. Credentials are omitted. The same
eight real read scenarios exercised old explicit-ID and new contextual invocation routes.

## Results

| Scenario / test | Result | Notes |
| --- | --- | --- |
| Typecheck, ESLint, hygiene and TypeScript build in make ci | PASS | Test stage subsequently failed as below |
| Focused command/help/schema/scoping/golden suite | PASS | 6 files, 224 tests, including 12 new fixture regressions |
| Golden regeneration and manual diff inspection | PASS | Only root and Provider help captures changed |
| Real CLI/filesystem offline suites | PASS | 16 scenarios; leak-check skipped because no cloud sandbox was created |
| Real npm/dist management reads | PASS | 8/8: Volume, Team, API Key and Quota lists, both invocation forms; response shape and key redaction verified |
| Node SEA build and version smoke | PASS | Binary moved outside the checkout for dependency isolation |
| Isolated standalone management reads | FAIL | 8/8 could not load the existing official SDK; independent packaging defect, not accepted as cloud coverage |
| Full local unit suite | FAIL | 4099 pass, 20 fail, 1 skip; no new failure titles relative to clean baseline |
| Clean base comparison | CONFIRMED | Same 6 files on 4aec47b with catalog fixtures: 20 fail, 38 pass, 0 skip; both title sets identical |
| Parity ledger | PASS | 907/907 mapped entries; 11 server-owned entries verified in Python repository |
| Remote Node 20/22 and package CI | PENDING | Must inspect latest head before merge |

### Integration checkpoint

PR https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/86 at implementation
head `864452b0fe2845e4599f1ef6c7330e04015a9116` passed remote Node20/22 tests,
typecheck/lint/hygiene, package build, installer and Markdown-link checks. Later record/help
and integration commits must pass their latest-head gates too.

Running the complete offline entry initially produced 73 pass, 5 fail and 1 skipped leak
check. The five frozen scenarios expected retired standard-root flags, standard E2B aliases
inside native config/MCP, or an obsolete PyPI recipe. Their replacements follow the existing
migration/config/MCP contracts and strengthen canonical-alias isolation, VSCode no-secret
workspace behavior and matching immutable Python client/server source pins. All five pass
against the real standalone candidate; a final combined full run remains required.

The independent SDK packaging repair is
https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/87 (Issue85). Its isolated SEA
candidate passed all four legacy real cloud lists with no resources created. The combined
new/legacy eight-read candidate is verified after integration; the earlier failures above
are retained as historical evidence.

## Cleanup

Fixture homes, plugin stores and temporary default settings were isolated and removed. Real
control-plane calls only read one page and created no resources. Sandbox count created=0,
leaked=0; cloud sandbox leak checks were skipped, not counted as passes. No project credentials
or raw private API response bodies were written to the record.

## Problems found

All 20 local full-suite failures reproduce on the unmodified base with the same catalog. They
include network-audit-disabled HTTP501 responses, proxy/TLS/loopback and WebSocket differences.
Clearing proxy environment did not resolve them; network controls were not modified or bypassed.
No additional failure title was introduced by this change. This is not a claim that all tests pass.

The standalone candidate revealed that an existing createRequire-based official SDK loader is
not included by the bundler. Node/npm calls work, while isolated SEA management calls fail before
backend access. Track this separately from help, together with
https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/66, and rerun the actual candidate
after the owner fix lands. Do not claim a working published standalone workflow from source tests.

## Not verified

Remote CI/review and merge, publication, browser/Registry presentation, Python Node handshake
repair, new shell completion/MCP generation and renewed native acceptance of every Provider.
These are not inferred from local command discovery. No new cloud mutation handlers were added.
