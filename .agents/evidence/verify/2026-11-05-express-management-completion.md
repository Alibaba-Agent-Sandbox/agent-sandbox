# Verification: Express native management completion

- Date: 2026-11-05
- Base: `b77b75d91617483bc088f28b8eaecf74cbea711a`, task branch `fix/express-api-completion-20261105`.
- Result: PARTIAL
- Scope: current/legacy management adapters, native template commands and helper step updates, STS consumption, corresponding tests, SDK lockfile/notices and bilingual management usage.
- Runtime: Node.js 22.22.2; actual installed Sandbox SDK 1.2.1 generated classes. Local serialization regressions and explicitly authorized real cloud acceptance are separated below.
- Issues: [#229](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/229), [#230](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/230); dependency overlap [#220](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/220).

## What was verified

Current native requests preserve newer storage, quota and template fields through the real generated serializers. Legacy status-only Volume updates retain the old API and are mutually exclusive with current configuration updates. Template update steps preserve omitted/empty/nonempty distinctions. Responses omit unknown fields and redact storage credentials. Temporary identity tokens reach native SDK configuration and ACR signing inputs without direct-tokenless fallback.

## Commands run

1. `npx vitest run tests/test_providers/test_express_management_completion.test.ts` against the unmodified base with the initial 13 regression cases: exit 1, 11 failures and 2 passes. Failures demonstrated rejected newer fields, incompatible IP policy reaching the SDK, missing template operations and dropped update steps.
2. `npm install --save-exact @alicloud/sandbox20260820@1.2.1 --ignore-scripts --no-audit --no-fund`: exit 0. The exact package's generated update-step model was inspected before adoption. The lockfile uses the official npm tarball URL and published integrity.
3. `node scripts/alicloud-sdk-notices.mjs`: exit 0, installed graph recorded; retained legacy and current SDK attribution.
4. `npx vitest run tests/test_providers/test_express_management_completion.test.ts tests/test_providers/test_alicloud_commands.test.ts tests/test_providers/test_template_cache_commands.test.ts tests/test_providers/test_managed_api_key.test.ts tests/test_providers/test_bundled_alicloud_sdk.test.ts tests/test_api/test_fc_template.test.ts tests/test_api/test_docker_builder.test.ts`: exit 0, 7 files and 232 tests passed. The new regression file has 21 cases; ACR temporary-signing and fallback controls were added to its existing owner suite.
5. `npm run typecheck`: exit 0.
6. `npm run build`: exit 0.
7. Scoped ESLint on changed management/template sources and tests: exit 0, no errors. 19 existing warnings remain in the CLI template adapter, Docker builder and Docker test imports; zero errors.
8. `npx vitest run tests/test_cli/test_build_modes.test.ts tests/test_cli/test_template_commands.test.ts tests/test_cli/test_region_options.test.ts tests/test_cli/test_template_guided_configuration.test.ts tests/test_cli/test_output_channels.test.ts tests/test_providers/test_express_source_workflow.test.ts tests/test_providers/test_template_launch.test.ts`: 252 passed / 8 failed. The failures were transport fixtures for runtime list/kill after the companion runtime implementation introduced platformRequest; the runtime owner was notified. The remaining six template/source files passed. After the runtime owner corrected that fixture, the same command was rerun: exit 0, all 7 files and 260 tests passed. The initial failed result remains recorded here.
9. `git diff --check`: exit 0.
10. Two additional top-level API-Key policy regressions failed on the preceding implementation, demonstrating that response-level policies were lost in favor of embedded policies. After normalization with explicit response-level fields (including empty arrays) taking precedence, `npx vitest run tests/test_providers/test_express_management_completion.test.ts tests/test_providers/test_alicloud_commands.test.ts tests/test_providers/test_managed_api_key.test.ts`: exit 0, 3 files and 103 tests passed. The completion file now has 23 cases. Typecheck and scoped ESLint passed again. These tests use synthetic Keys only.
11. `node --check e2e/express-management-completion.mjs`, `node e2e/express-management-completion.mjs --help`: exit 0. Real runs used `ABX_BIN='node --import <absolute-tsx-loader> <absolute-src/bin/abx.ts>'` with child-only injected credentials, an isolated HOME and an explicitly selected existing Key's Team. `--inspect` passed read-only native Team/template queries. Cloud modes `--template-only`, `--metadata-only` and `--cache-only` retained nonzero exit codes for the service/fixture failures described below; they were not relabeled as full passes.
12. Independent review identified output VPC/log/registry-network schemas inheriting mutation-required fields. Two additional generated-response regressions failed before the fix. Response-only nested schemas now preserve optional/empty metadata while mutation requirements remain strict. The seven-file management suite from step 4 was rerun: exit 0, 7 files and 236 tests passed; the completion file now has 25 cases. Typecheck, scoped ESLint and diff check passed again.

## Results

| Scenario | Result | Scope |
| --- | --- | --- |
| Current storage and quota generated serializer paths | PASS | Local real SDK models, bounded fake response |
| Legacy status-only path and refusal to retry current failures through it | PASS | Current/legacy generated SDK clients with intercepted callApi |
| Native template CRUD, runtime/log/VPC/build/registry fields and resource tags | PASS | Actual generated request and response serialization |
| Same-name steps omitted/clear/changed behavior | PASS | Existing helper with real generated update models and fake cloud methods |
| IPv4 policy and malformed input rejection | PASS | Before SDK loading |
| Secret response projection and exclusive Key exports | PASS | Synthetic credentials, actual temporary filesystem |
| SDK attribution and bundled lazy dependency loading | PASS | Installed graph and actual bundler checks |
| STS signed ACR requests | PASS | Real signing functions and intercepted local transport |
| Full repository CI | OWNER INTEGRATION | Root records the repository-wide gates separately |
| Real native management/template lifecycle | PARTIAL | See the real-resource scenarios and limitations below |

The unit suites' managed-Key confirmation messages come from synthetic clients; no actual Key was created or renewed. Warnings for intentionally unavailable or invalid wheel downloads are negative controls, not evidence of real package publication failures.

An additional expiry regression confirms that an explicit empty string reaches `expireTime` unchanged while omission does not send it. Actual expiry cancellation was not attempted on any user Key. Input build/copy settings and public query output were compared separately: the current Get model does not expose buildConfig/copy or registryType. The wrapper permits optional public registry_type metadata if available but does not synthesize absent service fields; code/message are treated as the success/error envelope, with request_id retained.

## Real cloud acceptance

`e2e/express-management-completion.mjs` creates only uniquely named resources owned by its run. Create submissions are made once and ambiguous results are reconciled through independent inventories. Recovery ledgers have mode 0600 and contain resource references, never credentials. Cleanup independently reads the resource's run ownership before deleting it and confirms absence with bounded read-only polling; no mutation is retried automatically. API Key operations are explicitly refused by the script.

| Scenario | Result | Independent observation |
| --- | --- | --- |
| Structured native template create/get/list | PASS | An official generation-2 base image built successfully and a new sandbox read marker v1 from the actual filesystem |
| Existing-name native deploy with changed steps | PASS | A separate sandbox created after deploy read marker v2; request acceptance alone was not the assertion |
| Structured template update with `steps: []` | PASS | A subsequent new sandbox confirmed the marker file was absent; Get omitted its optional empty steps field |
| Native template delete | PASS | Independently confirmed not found after deleting the owned template |
| Team create/get/list/update/delete | PASS | Only newly created Teams were changed; independent reads confirmed description changes and eventual absence |
| Quota update/get/list/delete | PASS | Owned-Team CPU/memory zero and instance-count values 2, 0 and -1 were preserved/cleared; deletion was confirmed in an independent quota inventory |
| OSS, AgenticBucket and JuiceFS Volume metadata CRUD | PASS | Only placeholder metadata was created; independent generated-SDK reads confirmed readOnly or remoteDir changes, storage-class filtering included the owned Volume, and delete was confirmed absent |
| AgenticFS metadata create | FIXTURE REJECTED | HTTP 400 InvalidParameter for a deliberately nonexistent access-point address; no actual AgenticFS endpoint or mount was verified |
| TemplateCache create/control | SERVICE REJECTED | CLI returned HTTP 400 InvalidParameter for an owned ready template; after independently confirming no cache existed, a separately authorized direct official-SDK request with the same body also returned 400 InvalidParameter. Safe error terms identified template/image/not supported |
| Cache readiness/get/list/delete of a successful cache | NOT VERIFIED | The service rejected the tested image before creating a cache. Logical cache absence was confirmed; this is not a successful cache CRUD claim |

The cache request was compared with the current `CreateTemplateCacheInput` model and [official cache guide](https://help.aliyun.com/zh/agent-sandbox/template-cache): the body contains only Team/template IDs, and the template was ready, same-user and same-region. The guide distinguishes automatic prewarming of official templates from API prewarming of custom templates. It documents no generation-specific restriction. The matching direct-SDK rejection establishes the tested image boundary; it does not establish that cache works for every custom image or that the platform is generally unavailable.

Initial failures remain part of the evidence: an early harness environment alias prevented cloud submission; one Team create returned a generic error and independent inventory found no owned Team. An early harness required explicit empty steps/token response fields and failed despite the service's optional-field contract; the follow-up checked the actual cleared filesystem artifact and accepted an omitted secret. An initial immediate Team absence check raced eventual deletion; an independent later SDK query returned 404 TeamNotFound, followed by successful recovery cleanup. The corrected script independently verifies Volume update effects and requires cache status ready before passing, rather than only successful calls.

## Cleanup

All management acceptance runs finished with zero owned resources and zero unresolved submissions after independent cleanup confirmation. The recovery run for the first eventually deleted Team also confirmed zero. No user-existing Team, quota, Volume or template was modified, and no API Key was created, renewed, reset, updated or deleted. Private recovery ledgers remain outside the repository; no IDs, credentials, raw response bodies or headers are recorded here. The original user checkout was not modified. Shared task-tree changes belonging to runtime/configuration owners are outside this subtask's diff ownership.

## Not verified

This evidence does not establish real backing-storage mounts/reads/writes, quota enforcement under load, SLS delivery, actual temporary-credential expiry behavior, successful caching of a supported custom image, every 29-API cloud lifecycle or a package release. No actual Key mutation was authorized for this acceptance. Owner integration/CI and remote review/merge are recorded separately; the decision remains proposed until their gates are satisfied.
