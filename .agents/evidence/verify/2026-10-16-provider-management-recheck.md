# Verification: provider management recheck

- Date: 2026-10-16.
- Result: PARTIAL; required storage and broader management-write acceptance remain blocked.
- Issue: [CLI #30](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/30).
- Delivery: [draft PR #35](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/35), with
  [Python draft PR #38](https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/38).
- Tested product revision: `796252e`, merging accepted main `62cb6c9` into the task branch.
- Subsequent changes: translated prerequisite/runner documentation, changelog and records.
- Environment: Linux, Node 22.22.2; existing locked dependencies and npm 10 wrapper.
  Cloud credentials were supplied in memory through environment configuration, never argv or logs.

## Review and integration

Independent CLI/Python reviews found no new confirmed defect in registration, schema/consent,
provider/account isolation, confirmation, redaction, single-send transport or bounded cleanup.
Real local Node, exec and in-process EPP tests cover dispatch; account-level MCP exposure remains
explicitly deferred. Accepted repository-health fixes now pass without changing historical bytes
or hiding their warnings. Python separately merged accepted main's lifecycle/loader/workspace/task
fixes, preserving both sides of four documentation conflicts. Shared contracts land first.

## Commands and results

| Check | Result | Observed evidence / limitation |
| --- | --- | --- |
| `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` | PASS | Post-synchronization, exit zero. |
| `node node_modules/vitest/vitest.mjs run <12 related files> --reporter=dot` | PASS | 323 passed, 57.49 seconds; files listed below. |
| Independent pre-synchronization management/CLI/engine/EPP review | PASS | Four files, 85 tests; overlaps later coverage. |
| `bash scripts/check-repo-health.sh` | PASS | 105 pass, 11 warnings, zero failures after synchronization. An earlier concurrent run read the old script and reproduced its 10 failures; it does not describe the new source. |
| `ABX_BIN='<absolute built CLI command>' node e2e/run.mjs --suite provider-commands-offline` | PASS | Five discovery/schema/confirmation/input/unsupported-domain scenarios. Leak check skipped: no sandbox created. |
| Same runner, `--suite provider-management-cloud` with configured credentials | PASS | Four actual FC list operations; zero created/leaked sandboxes, leak check skipped. |
| Read-only list/detail probe through the built CLI | PASS | `volume.list`, `team.list/get`, `api-key.list/get`, `quota.list`, each exit zero. Zero visible Volumes; no quota entry for a detail probe. IDs/bodies were not recorded. |
| Pre-synchronization remote head `e1a6699` | PASS | All six checks: Node 20/22 tests/parity, typecheck/lint/hygiene, build, installer and links. Does not establish a later head's status. |

The 12-file invocation used:

```text
tests/test_cli/test_provider_management_commands.test.ts
tests/test_engine/test_provider_commands.test.ts
tests/test_providers/test_management_commands.test.ts
tests/test_providers/test_alicloud_commands.test.ts
tests/test_e2e/provider_management_skip.test.ts
tests/test_models/test_sandbox.test.ts
tests/test_api/test_sandbox.test.ts
tests/test_cli/test_sandbox_commands.test.ts
tests/test_protocol/test_sandbox.test.ts
tests/test_e2e/volume_mount_safety.test.ts
tests/test_providers/test_epp.test.ts
tests/test_scripts/test_repository_health.test.ts
```

Initially supplying `node dist/bin/abx.js` to the offline runner caused all five startup checks
to fail because isolated scenario directories cannot resolve that relative path. Correcting the
absolute binary command passed all five. Both E2E quick starts now use `node $PWD/dist/bin/abx.js`.
No implementation was changed to accommodate that invocation error.

At capture, a new `make ci` had passed hygiene and reached typecheck; no aggregate PASS was
available. The earlier full-suite failures and interrupted aggregate attempts remain in
[the previous review](2026-10-16-provider-management-final-review.md). Targeted or remote passes
do not erase those local attempts.

## Authoritative capability recheck

The [official OSS Volume guide](https://help.aliyun.com/zh/agent-sandbox/user-guide/create-oss-volume)
currently requires invitation access through a support ticket. Both language guides/design now
require target account/region/Team access to be confirmed before storage preparation. An empty
successful list proves neither create permission nor mount capability. An existing Bucket, storage
role and owning Team's sandbox API key remain separate requirements.

The current latest official packages were downloaded into memory: `@alicloud/sandbox20260820`
1.2.0 and `@alicloud/fcsandbox20260509` 1.5.1. Both `src/client.ts` and `dist/client.js` were
inspected; neither exposes domain methods. The
[product domain guide](https://help.aliyun.com/zh/agent-sandbox/custom-domain-name) describes
console binding. [CLI #32](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/32)
remains the upstream API dependency; unrelated FC/AgentRun APIs were not substituted.

## Cleanup and remaining gates

This recheck only read cloud resources. No Team, key, Volume, quota, Bucket, role, subscription or
sandbox was created/modified. The corrected disposable-key lifecycle and confirmed cleanup remain
historical evidence, not a new write run. No private IDs or response bodies appear here.

Real Volume create/get/update/delete and mount/read/write/cleanup need authorized storage,
invitation access and a same-Team key. New Team/quota lifecycles need an explicitly selected test
plan/resource group. None was guessed. Volume status transitions, STS and newer JuiceFS support
retain their previously documented limitations.

Both PRs were open drafts and unmerged at review. No GitHub review was submitted; independent
agent review completed. Neither repository had active branch protection/rulesets when inspected;
no missing external approval is invented as a blocker. Incomplete product acceptance still keeps
the PRs draft and ADR proposed. No check bypass or merge is claimed.

Python's post-synchronization static checks and 206 tests are in its
[own recheck](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/feat/provider-commands-20261016/.agents/evidence/verify/2026-10-16-provider-management-recheck.md).
Earlier [implementation](2026-10-16-provider-management-commands.md),
[mount review](2026-10-16-provider-management-final-review.md) and
[specification review](2026-10-16-provider-command-spec-review.md) evidence stays unchanged.
