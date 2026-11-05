# Verification: Express runtime completion

- Date: 2026-11-05
- Base: `b77b75d91617483bc088f28b8eaecf74cbea711a`, branch `fix/express-api-completion-20261105`.
- Result: PARTIAL
- Issue: [#230](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/230)
- Scope: runtime provider command catalog, native create/lifecycle routing, opaque create input hook, in-memory gateway credential and explicit private files, bilingual usage and local regression evidence.
- No cloud mutation or Key creation/renewal was performed by this subtask. Root-owned cloud acceptance is recorded separately and is not inferred from these local results.

## Commands and outcomes

1. Initial missing-operation/native regressions against the unmodified base: 27 failures. Missing IDs returned E8004; qualified native lifecycle verbs and network-file options were unreachable. These were behavior regressions, not cloud operations.
2. Initial post-implementation discovery failed because the companion native template list descriptor exceeded the existing generic schema depth bound. The management owner bounded the projected descriptor; generic validation was not relaxed.
3. Existing region tests initially reported 8 failures because they mocked the former shared protocol constructor instead of the new provider subclass. The fixture now mocks ExpressSandboxProtocol; no production transport behavior was weakened.
4. Runtime network total-switch wire regression was first changed to the locked standard SDK's actual `allow_internet_access` spelling: 1 failed / 24 passed. After separating update encoding from create encoding, it passed. Create retains the documented top-level `allowInternetAccess` plus nested network object.
5. Adjacent API/provider tests initially had 1 failure / 99 passes from a constructor-name assertion. It now checks the provider protocol class rather than the former name.
6. `npx vitest run tests/test_cli/test_command_surface.test.ts tests/test_cli/test_region_options.test.ts tests/test_providers/test_express_runtime_completion.test.ts tests/test_cli/test_express_runtime_completion.test.ts tests/test_providers/test_conditional_commands.test.ts tests/test_cli/test_standard_dispatch.test.ts tests/test_cli/test_sandbox_commands.test.ts tests/test_api/test_sandbox.test.ts tests/test_api/test_lifecycle_without_connect.test.ts tests/test_providers/test_sandbox_provider.test.ts`: exit 0, 10 files / 283 tests passed.
7. `npm run typecheck`: exit 0 after traffic and network wire changes.
8. Scoped ESLint over owned sources and tests: exit 0, zero errors; 20 existing warnings in API/native CLI/index remain. No unrelated lint cleanup was included.
9. Nine actual source CLI help/catalog commands, executed with only PATH/locale inherited: all exit 0. [Captured output](../cli/2026-11-05-express-runtime-completion/help-and-discovery.md). No cloud, environment credentials or default token persistence were used.
10. Root's full check found one new provider-isolation violation: a native CLI import of the Express network schema. The CLI now reads a bounded JSON object and calls provider.validateCreateOptions; the vendor schema stays provider-owned. The existing isolation assertion was unchanged. Follow-up results are appended below.
11. `npx vitest run tests/test_providers/test_complete_isolation.test.ts tests/test_cli/test_express_runtime_completion.test.ts tests/test_providers/test_express_runtime_completion.test.ts`: exit 0, 3 files / 45 tests passed after removing the core vendor import.
12. Final focused runtime suite after adding a reflected-network-secret diagnostic regression: exit 0, 26 tests passed. The reflected 400 message remains a typed E2000 while String/inspection/JSON omit the rule credential. No implementation change was needed for this additional regression. A final scoped ESLint run over runtime/new-file sources, native CLI and owner tests exited 0 with 3 existing native CLI warnings and no errors; typecheck and `git diff --check` exited 0.
13. The CLI integration list case reproduced the same former-constructor fixture problem: 1 failed / 9 skipped before changing its import/spy to ExpressSandboxProtocol. `npx vitest run tests/integration/test_cli_e2e.test.ts` then exited 0, all 10 tests passed with the original two-ID output assertions preserved.
14. `npm run parity:coverage` after that fixture correction exited 0: all 907 ledger entries passed, no failures/skips/missing, and 11 verified cases remain in the Python owner. This is parity-ledger success; root records underlying full-suite and baseline failures separately.
15. Two further regressions first failed for JSON-escaped and short rule credentials. Credential-bearing create HTTP failures now use fixed safe diagnostic fields and retain their typed SDK error and numeric HTTP status; the new error holds no original cause/request/response. The no-secret path keeps its previous behavior. `npx vitest run tests/test_providers/test_express_runtime_completion.test.ts tests/test_providers/test_complete_isolation.test.ts tests/test_api/test_sandbox.test.ts tests/test_providers/test_sandbox_provider.test.ts tests/test_cli/test_express_runtime_completion.test.ts tests/integration/test_cli_e2e.test.ts` then exited 0, 6 files / 152 tests passed. Typecheck, scoped ESLint over these final sources/tests and `git diff --check` each exited 0. This final diagnostic change supersedes literal replacement as the security policy for credential-bearing create HTTP failures.

## Observable coverage

| Scenario | Local result and boundary |
| --- | --- |
| Mount append | Named plus four inline types; exact wire aliases, 204 empty response, duplicate/overlap/path rejection |
| Network update | Flat replacement, explicit empty clear, total-switch alias, creation-only rejection, secret-free errors |
| TTL | Correct seconds body without connect or retry |
| Runtime failures | 400/403/409/429/500, timeout/unknown outcome and closed runner; no mutation replay |
| Key resolution | Lazy prepared-Key resolution; invalid input precedes resolution; no implicit account preparation |
| Native routing | Qualified pause/resume/TTL and conflicting explicit provider rejection |
| Create | Real Express protocol builds top-level network and secure envd access; insecure private input fails before infrastructure |
| Traffic | Separate public-gateway/envd headers; no ordinary model dump/inspection disclosure; GET refresh retains held token |
| Explicit token files | New 0600 output, no overwrite, no token output, symlink/shared/multiline input refusal, own-empty-file cleanup and replacement-path preservation |

Warnings in the API suite intentionally exercise failed cleanup and are negative controls. They do not describe leaked real resources.

## Cleanup and limits

Test-owned files were removed. The original checkout was not modified. No generated standard runtime bundle was edited. Shared-tree management/configuration changes belong to the other owners.

This evidence does not establish real OSS/AgenticFS/AgenticBucket/JuiceFS admission or data access, all native API lifecycle behavior, actual policy enforcement, complete CI success or release availability. Full checks, real service acceptance, changelog/index integration and independent review belong to root integration. The engineering decision remains proposed.
