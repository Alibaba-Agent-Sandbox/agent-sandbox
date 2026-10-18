# Verification: Provider management final review

- Date: 2026-10-16
- Previous evidence: [Initial implementation verification](2026-10-16-provider-management-commands.md).
- Change: [CLI #30](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/30).
- Delivery: [CLI draft PR #35](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/35),
  with [Python draft PR #38](https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/38).
- Tested product revision: `5ddd5ba27f5f42ec87b36fdae89a6c9ccf04979d`, based on main
  `7854c314055fd9c196332babffca7c2aa608f805`. The rebase excluded unrelated client-name work.
- Result: BLOCKED — implementation is present; the full mandatory gate set and all cloud acceptance criteria are not complete.
- Scope: provider command contract/dispatch, Node/exec/in-process EPP adapters, CLI/engine routes,
  FC management mappings, regression/black-box tests, translated docs and repository records.
- Environment: Linux, Node 22.22.2. Dependencies were installed with isolated npm 10.9.4 because
  the environment npm 12 failed before installation. Credentials are supplied only through
  process configuration; no values, account metadata or raw service responses are recorded here.

## What was verified

Static discovery and consent, bounded input/output schemas, real Node and EPP dispatch,
configuration isolation, confirmation, no automatic replay, credential redaction and bounded cleanup.
All 20 FC management methods map to the locked official SDK. Mapping tests use the real generated
models and a fake client; they are not evidence that every cloud operation is available.

Independent reviews first audited command registration, authoritative backend interfaces and the
Python contract. Follow-up reviews corrected cleanup hangs, skipped client cleanup, null infrastructure,
secret-bearing result keys, Ajv cache retention, schema/property-name confusion, cross-language consent
ordering, omitted in-process EPP command forwarding, initialization cleanup and legitimate null results.
Real Node plugin regressions demonstrated the EPP defects before their fixes.

## Commands and results

| Check | Result | Evidence and limits |
| --- | --- | --- |
| Lockfile installation with npm 10; clean `npm ci --ignore-scripts --no-audit --no-fund` in a separate dependency-verification directory | PASS | 214 packages installed; Ajv is a direct locked dependency. |
| `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` | PASS | Repeated during final integration. |
| `node node_modules/typescript/bin/tsc -p tsconfig.build.json` | PASS | Built CLI used for cloud checks. |
| `npm run lint` using npm 10 | PASS | No errors; 221 pre-existing warnings. Final changed-file lint also passes. |
| Management, CLI, engine, FC adapter and dynamic-skip regression tests | PASS | Final combined run: 112 tests across five files, including the legitimate null-result regression. |
| Management plus existing EPP tests | PASS | Latest independent review: 67 passed, including four new real Node helper regressions. |
| FC adapter suite | PASS | Latest independent review: 59 passed; SDK mapping, aliases, pagination, state-error hint, exclusive absolute secret file and failure cleanup. |
| Provider CLI help snapshots | PASS | Five help snapshots checked; new dated capture preserves historical evidence. |
| Catalog Node regression suite with an explicit catalog path | PARTIAL | 6 passed, 2 failed: loopback envd requests receive environment-generated HTTP 501, including with NO_PROXY enabled. |
| `npm test` | FAIL | Initial full run: 3817 passed, 27 failed, 56 skipped. Twenty-six failures were reproduced in the unchanged original checkout; the remaining null-infrastructure cleanup defect was fixed and its regression passes. |
| Baseline reproduction of 26 failures | FAIL (baseline) | Missing Docker affects 11 template cases; proxy/network behavior, TLS trust, WebSocket wording, Node color warnings, MCP header/oracle behavior and archive directory modes account for the rest. No unrelated source was changed to suppress them. |
| `make ci` | FAIL on initial attempt | Hygiene/typecheck passed; cleanup implementation initially triggered no-unsafe-finally, which was fixed and lint rerun successfully. The aggregate cannot be described as green while full test failures remain. |
| `bash scripts/check-repo-health.sh` | FAIL (baseline) | 94 pass, 5 warnings, 10 failures: stale repository structure, historical links/local paths, missing records and existing translation mismatches. New design/record links resolve. |
| Full `ABX_BIN=<built CLI> node e2e/run.mjs` | INTERRUPTED | Runtime restart interrupted the broad run during offline command enumeration, before cloud sandbox creation. No complete aggregate pass is claimed. |

## Real cloud verification

The built CLI successfully executed `volume.list`, `team.list`, `api-key.list` and `quota.list`
against the actual FC control plane. The command discovery/schema/confirmation/input/unsupported-domain
black-box checks also passed: nine scenarios passed in the recorded management run, with the sandbox
leak check skipped because no sandbox was created.

The first disposable API-key lifecycle reached create/get/list/update/reset but failed deletion with
`InvalidApiKeyStatus` because the key remained active. The task-owned key was then explicitly disabled,
deleted, and queried to confirm E8005. This led to the documented inactive-before-delete precondition,
an E8002 hint, and lifecycle/cleanup regressions. The adapter does not add a hidden status mutation.

The corrected black-box `provider-management-lifecycle/existing-team-api-key-lifecycle` subsequently
passed against the actual service: a new randomly named key was created, queried, listed, renamed,
rotated into another exclusive mode-0600 file, explicitly disabled, deleted and confirmed absent.
Generated values were checked only in protected temporary files and were absent from CLI output.
No existing Team or pre-existing API key was changed. This establishes the API-key lifecycle, not all
20 operations. The corrected lifecycle took 158.058 seconds. The final management-read run
also completed with nine passes and one sandbox-leak-check skip; zero sandboxes were created.

## Final integration and remote delivery

The product change was rebased onto the owning repository's main branch without unrelated
feature commits. Both task branches were pushed normally and their draft PRs are open and
unmerged. The CLI secret-scanning commit hook passed. Its optional pre-commit framework was
not installed in the restarted environment; manual typecheck and lint results are reported above.
No hook or required check was disabled.

All remote checks on CLI product revision `5ddd5ba` passed: Node 20/22 tests/parity,
typecheck/lint/hygiene, installer, package build and Markdown links. All remote checks on Python
revision `25fd4b6` also passed: client and server on Python 3.10/3.11/3.12, hygiene, package builds
and Markdown links. These results apply to those revisions before the final mount addition:
[CLI CI](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/38846675456),
[Python CI](https://github.com/Alibaba-Agent-Sandbox/python-sdk/actions/runs/38846543897).
The rebased local `make ci` passed hygiene, typecheck, lint (221 warnings) and build. Its unit
phase reproduced existing Docker/template and Node color-warning failures; it was explicitly
interrupted (exit 130) before the final mount work began. It did not reach parity or packaging
and is not a completed aggregate run. The earlier complete full-suite result remains recorded
above. The full cloud gate remains incomplete regardless of remote unit-test results.

## Final mount omission found during review

An additional source audit found a genuine implementation gap beyond missing cloud storage:
the sandbox-create model discarded Volume mount configuration. The official product example
uses a path-to-Volume-name map; its documented request representation is
`volumeMounts: [{name, path}]`. The final change adds that create-time option to the CLI/host
and Python lifecycle chain, plus an opt-in independent mount/sentinel/cleanup scenario.
No successful real cloud mount is claimed. The role and same-Team sandbox API-key requirements
are now explicit in both language versions of the design and guide.

The Node regressions first demonstrated 28 failures before implementation. The corrected
four-layer suite passed all 161 cases. The final combined integration run passed all 317 cases
across the following 11 files (`node node_modules/vitest/vitest.mjs run <files> --reporter=dot`):

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
```

These totals overlap rather than add together. Typecheck, production build, full ESLint
(zero errors; 221 existing warnings), scoped ESLint (zero errors; 20 existing warnings)
and diff checks passed. The changed help snapshot was
regenerated, then compared successfully without update mode. The standard capture driver
also produced a [new dated help capture](../cli/2026-10-16-volume-mount.md); its one test passed,
and the original evidence files remain unchanged. All changed local Markdown links resolve.
The current repository-health rerun still reports 94 pass, 5 warnings and 10 baseline failures.

The mount safety suite passes an ordinary-directory rejection, actual local mount-table
probing, an exclusive local sentinel roundtrip, preservation of unrelated content and symlinks,
and failure-path sandbox cleanup using a fake CLI. The standalone runner safely skips with
missing credentials or without the explicit mount opt-in, creating zero sandboxes. These
local checks are not evidence of FC storage compatibility.

Python additionally negotiates a supported-create-option flag with its existing gRPC engine
before a nonempty mount request. An old live engine cannot silently ignore the new protobuf
field and create an unmounted sandbox; it returns E8004 with an upgrade/restart hint. Empty
mount maps preserve the older call behavior. Its independent evidence belongs to
[Python PR #38](https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/38).

## Cleanup

The initial test key was confirmed absent after explicit cleanup. The corrected lifecycle checks absence
before completing and removes its temporary files. No sandbox was created by these management checks;
the persisted interrupted-run ledger also contains zero tracked sandboxes. No cloud storage was
created, mounted or modified. The local mount safety tests removed only their own temporary
sentinels. No cleanup claim is made about resources created by other tasks.

## Remaining gates

- The account's Volume list is empty; Volume create/get/update/delete and actual sandbox mounting need
  an existing authorized test storage configuration. No Bucket, role, plan or Volume state was invented.
- New Team/quota write scenarios require an explicitly selected eligible plan/resource group. The existing
  account plan was not copied into a new subscription for verification. Volume status transitions remain
  unverified; SDK field presence is not a documented state-transition contract.
- Domain commands have no verified public Agent Sandbox client API in either audited SDK. Follow-up:
  [CLI #32](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/32).
- STS management credentials and newer JuiceFS SDK fields are not implemented by this scoped adapter.
- The strict repository gates, remote CI/review and merge remain outstanding. The ADR stays proposed,
  and delivery must remain a draft PR while required gates fail.
- Python implementation and its independent verification are tracked in
  [python-sdk #34](https://github.com/Alibaba-Agent-Sandbox/python-sdk/issues/34).

## Evidence durability

An environment restart removed earlier temporary logs and interrupted an active broad E2E run.
The executed results above were observed in tool output before that restart. Subsequent sanitized
verification logs are kept in the ignored build directory; this tracked summary contains only facts
and limitations, not credentials, private resource identifiers, machine-specific paths or raw logs.
