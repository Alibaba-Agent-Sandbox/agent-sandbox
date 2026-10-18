# Verification: Complete provider isolation

- Date: 2026-10-18
- Change: proposed ADR `2026-10-18-provider-portability-updates`; CLI PR #35, Issue #47.
- Result: PARTIAL — source/binary/cloud/isolation checks pass; mandatory aggregate gates remain failing.
- Revision scope: provider-owned extraction and generic core/CLI/agent/configuration changes in the accompanying commit; verification preceded this commit.
- Binary/package: source-built `abx` 0.3.0 and Linux x64 SEA executable.
- Environment: Node 22.22.2, Linux; real Express cn-hangzhou. Credentials were supplied only through an ignored environment file, never recorded here.

## Commands run

```sh
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.build.json
node node_modules/eslint/bin/eslint.js .
node node_modules/vitest/vitest.mjs run tests/test_providers/test_complete_isolation.test.ts tests/test_cli/test_provider_boundaries.test.ts tests/test_cli/test_config_providers.test.ts --maxWorkers=2
node node_modules/vitest/vitest.mjs run --exclude 'tests/integration/test_{cli,nl_template_init}_e2e.test.ts'
node scripts/build_binary.mjs
ABX_BIN="$PWD/dist/binary/abx-0.3.0-linux-x64" node e2e/run.mjs --suite offline
node scripts/capture-cli-evidence.mjs --out .agents/evidence/cli/2026-10-18-provider-complete-isolation/final
PATH="$PWD/build/task-tools/bin:$PATH" make dist-check
bash scripts/check-repo-health.sh
```

## Results

| Check | Result | Scope/limitation |
| --- | --- | --- |
| Typecheck/build | PASS | Strict TypeScript source and tests; compiled distribution |
| ESLint | PASS | Zero errors, existing/style warnings remain |
| npm package contents | PASS | `make dist-check` with the repository's npm 10 wrapper; both CLI entry and provider implementation included; dry run only |
| Isolation/config/CLI regression | PASS | 37 tests: no native fallback, factory selection, Node template class methods, module-cache switching, cleanup ownership |
| Python caller against real Express | PASS | Create, exec, file roundtrip, connect, list, owned deletion |
| Built source CLI against real Express | PASS | Create, exec, info, list, provider template read, owned deletion |
| Standalone CLI against real Express | PASS | Same six operations and owned deletion; no npm SDK installed beside executable |
| SEA build/smoke | PASS | Version smoke passed; SHA256 `c9401d3d27197c0b7b8b3d396ffdd54c893d6bebbbf6bdacddfc335c2a7ef95c` |
| Binary offline E2E | FAIL | 59 passed, 2 failed, 1 skipped: invalid-list-status and invalid-mcp-target expected `not one of` in emitted error text |
| Full aggregate (intermediate extraction checkpoint) | FAIL | 3840 passed, 91 failed, 56 skipped across 163 files in 1370.41 seconds; subsequent fixes were verified by scoped runs, not a second full-green aggregate |
| Broader provider/API/CLI suite | PASS | 908 passed, 37 skipped in 33 files; a separate rerun supplies the local catalog to cover those adapters |
| CLI evidence capture | PASS | 114 cases, zero skipped, 17 generated documents in the [final capture](../cli/2026-10-18-provider-complete-isolation/final/README.md); historical captures are untouched |

## Problems found

Later scoped verification:

- Final selection-isolation regression: **9 passed**, including a native-module lazy load followed by a different provider template factory, and provider-owned help/AI/option rediscovery.

- Native template/deploy and architecture isolation: **121 passed** after moving specialized UI declarations to one provider-owned metadata source. The final binary repeats the six real-cloud CLI checks successfully.
- Configuration output compatibility: **59 passed**. Provider-neutral region tests: **65 passed**. Credential precedence and isolation rerun: **7 passed** (included in the 15-pass final regression run).
- Container adapter, provider gaps and neutral error contracts: **54 passed** with the local catalog explicitly supplied. Missing URLs are derived only by the selected protocol adapter.
- CLI sandbox commands plus all evidence snapshots: **152 passed, 2 failed**. The two remaining snapshots are MCP status/status JSON; their unrelated expected output was not overwritten. Twelve affected help snapshots were regenerated and reviewed; native deploy retains its full help.
- Local catalog rerun: **71 passed, 6 failed**; failures reach the platform audit response HTTP 501 rather than the local Cube test server. This is not native Cube acceptance and is not reported as a pass.

Full acceptance is blocked by the recorded aggregate failures. Do not treat targeted
or real-cloud successes as a replacement for mandatory local/remote gates. No reviews
or remote checks have been bypassed. The complete Node 20/22 remote matrix remains unverified locally. The draft remains unmerged.

## What was verified

Provider-owned session binding, URLs, authentication, optional create inputs and resource
cleanup replace the core native/default bypass. Historical public exports remain. The
import-boundary regression prevents concrete backend imports in core implementation files;
explicit composition roots, declarative metadata and public export facades are intentional.
New architecture and configuration docs are available in English and Chinese.

## Cleanup

The real source CLI, standalone CLI and Python smoke each tracked and deleted only its own
new Express sandbox. Post-delete listing confirmed each owned ID absent. No Team, key,
Volume, Bucket, role or template was created by these follow-up smoke runs. Existing
storage acceptance remains the separate 2026-10-16 record and is not relabeled as a new test.

## Not verified

No new native E2B/Cube/container provisioning or optional image-factory activation is claimed.
No full-region/full-capability acceptance, package publication or verified merge is claimed.
The current implementation remains proposed while mandatory aggregate gates fail.

Final repository health and hygiene checks pass in both owners. The unrelated pre-existing untracked server output file was excluded from this contribution.
