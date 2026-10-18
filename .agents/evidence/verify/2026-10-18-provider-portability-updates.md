# Verification: provider portability, ownership and updates

- Date: 2026-10-18.
- Result: PARTIAL; targeted behavior and offline real-component checks pass; complete mandatory aggregates and native provider rollout are not established.
- Base: b332c2c462ec4f2e76acc885b692a67dc28f6a2b plus the scoped paths in this change.
- Environment: Linux, Node 22.22.2; existing lockfile dependency tree; no cloud credentials supplied to this follow-up.
- Owner issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/47.

## Scope and verified behavior

Legacy FC read/build commands reject plugin feature declarations before FC setup. Bundled update returns current host ownership and explicit guidance instead of a missing-plugin or latest-version claim; batch updates report manual sources and propagate Git failures. Git pinning, consent, rollback and persistent data remain covered by the existing installer suite. Bilingual design inventories the remaining FC coupling and reuses the separate optional image factory; it does not activate native E2B/Cube adapters.

## Commands and results

| Check | Result | Evidence and limits |
| --- | --- | --- |
| New regression negative control on unchanged base | EXPECTED FAIL | 7/7 new tests fail at b332c2c in an isolated worktree. |
| `node node_modules/vitest/vitest.mjs run tests/test_cli/test_provider_boundaries.test.ts tests/test_cli/test_provider_commands.test.ts tests/test_cli/test_provider_gaps.test.ts tests/test_providers/test_installer.test.ts tests/test_providers/test_alicloud_commands.test.ts --maxWorkers=1 --reporter=dot` | PASS | 200 tests, 128.58 seconds. Includes actual CLI entry, updater/rollback and real official SDK model mappings. No cloud request. |
| Initial and first repeated four-file run | FAIL | 140 pass / 1 hook timeout each; the cold registry import exceeded the unchanged 10-second hook budget. Not counted as passes. |
| Independent cold official SDK load | OBSERVED | 26,782 ms on this filesystem, exceeding a request-assertion test's unchanged 20-second budget. Registry and SDK fixture imports now occur before per-test hooks/assertions. No deadline was increased; reset failures are no longer silently swallowed or allowed to finish after teardown. |
| Strict typecheck and production build | PASS | `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`; `tsc -p tsconfig.build.json`. |
| Help golden update and clean comparison | PASS | One selected provider-update case in each run; 114 unrelated cases explicitly unselected. |
| Dated CLI capture | PASS | `node scripts/capture-cli-evidence.mjs --command help-provider-update --out .agents/evidence/cli/2026-10-18-provider-update`: one actual case, zero skips; historical captures unchanged. |
| Built production CLI offline E2E | PASS | `ABX_BIN=<absolute built CLI> node e2e/run.mjs --suite provider-commands-offline`: 6 pass; leak check skipped because zero sandboxes created. Includes bundled update, static discovery, schema, confirmation and unsupported-domain checks. |
| Repository health | PASS | 105 pass / 11 historical warnings / zero fail. |
| Scoped Markdown links, diff and staged configured-secret scan | PASS | Only the intended task paths; no credential/private resource values. |
| Reference provider suites on this base/catalog | FAIL | 30 pass / 6 fail; engine/loopback HTTP behavior in existing providers. This does not establish native backend compatibility. |

## Pending final aggregate

The mandatory local make-ci run is being completed and its exact outcome is appended before final delivery. Existing successful remote checks and historical cloud acceptance are not relabeled as a current full aggregate pass.

## Cloud evidence and cleanup

This change creates zero cloud resources. Existing actual OSS mount, persistence, Team/key/quota and complete cleanup evidence remains immutable in the 2026-10-16 provider-volume-live record. No new claim is made about all Express features. Domains, dynamic attach, STS/newer storage fields and Volume status-transition acceptance remain outside established coverage; native E2B/Cube/container factories need their own authorized backend. Optional host delivery remains https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/42. Local fixture trees, sockets and test-owned files are isolated; no pre-existing user sandbox or engine was adopted or killed.
