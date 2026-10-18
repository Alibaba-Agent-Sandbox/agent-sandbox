# Verification: Sandbox Skill reliability

- Date: 2026-10-18
- Change: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/43
- Baseline: 62cb6c9 (isolated branch fix/skill-reliability-20261018)
- Result: PARTIAL overall original requirement coverage; PASS for the scoped 21-tool live reliability acceptance and first-head required CI. Advanced requirements remain explicitly unverified.
- Environment: Linux, Node.js 22.22.2; real Alibaba Agent Sandbox in cn-hangzhou. Credentials loaded from environment/.env, values never recorded.

## Recovery and historical failure

The recovered conversation JSON was read completely (2,122,766 bytes; SHA-256 9aaf134b1154eefd1a3c4b25fd40d15013b39b3f581d40fca475c4216c79f100). Its roles/tool calls were treated as history. The prior temporary worktree and some edit contents were unavailable; this is a fresh implementation and run from committed baseline, not a claim of byte-for-byte recovery.

On 2026-10-16 the independent agent observed create/probe/upload success, then E3006 with upstream FunctionNotFound; the same sandbox later returned E2009. Its historical template jjous014ebntx3qsj258 now returns HTTP 404 (`template not found`), request ID 9a8097fc-5ad3-4091-81bf-791be100e06d. A subsequent authenticated ActionTrail LookupEvents query recovered an exact-target successful DeleteFunction event at **2026-10-16T07:18:48Z**, before the recorded task failure at 07:18:51. Event dc52a248-8128-4ada-a9f4-23cb55d9bdea, request 1-6ad1cfd8-1544ab2a-f408e621953a, has no errorCode and references the exact missing backing function. This establishes the direct cause: the backing function was deleted before task execution. The actor is assumed-role, its AccessKey differs from the currently supplied AK, and its session name mentions FC. Those facts do not identify the upstream initiating operation or prove a platform product defect. Other DeleteFunction events in the same second failed FunctionNotFound; they are not counted as successful deletions. The filtered DeleteTemplate query returned no events, which does not prove no template deletion occurred. See [exact-target audit evidence](2026-10-18-skill-reliability/audit-exact-target.json). Query parameters follow the [official LookupEvents contract](https://www.alibabacloud.com/help/en/actiontrail/developer-reference/api-actiontrail-2020-07-06-lookupevents) and [published endpoint](https://www.alibabacloud.com/help/en/actiontrail/developer-reference/api-actiontrail-2020-07-06-endpoint); only non-sensitive correlation fields were retained.

## Verified attribution and repairs

| Finding | Attribution | Evidence / repair |
| --- | --- | --- |
| Requested 600s, displayed 300s | Client metadata defect | Raw GET omitted timeout; startedAt 02:28:20.249770Z and endAt 02:38:20.249738Z prove 600s. Request f1c48741-586e-4d84-bf5e-cf0a762d8c1b. Preserve unknown instead of filling a platform claim. |
| Date values appeared as empty objects | Client JSON rendering | Workflow metadata explicitly converts Date to ISO. |
| Lookups renewed lifetime; disconnect killed adopted resources | MCP lifecycle implementation | Observational API, explicit retention and ownership regression. |
| Template list lost aliases/build state | CLI response mapping | Accept actual aliases/builds response and regression. |
| Protocol readiness awaited SDK import | MCP startup implementation | Remove eager import from protocol startup; cold-process and loop tests. |
| Successful cancellation returned MCP isError true due to -15 | MCP result mapping | Independent agent reproduced twice; restrict nonzero-exit tool errors to run_command/run_code, preserve query/cancel outcome separately. Fresh regression/rerun required. |
| Acceptance script expected task status/completed but API returns state/succeeded | Evaluation harness | Preserve failed assertions; correct harness without calling this a platform defect. |

## Independent agent CLI acceptance

Agent: skill_acceptance, independently loaded Skill and chose CLI. Model version was not separately exposed. One short-lived sandbox, existing ready template y2of2a2kkkci2y10q0qq/build ad78c967-5e52-4715-8096-3d2a5c45a9fd. No existing resource was modified.

Eight assertions passed: create, upload, disconnect during running task, recover same PID, exact JSON bytes/remote-local SHA-256, explicit exit 7, observable cancellation, own-resource cleanup. Actual artifact: 53 bytes, `{"row_count":3,"total_amount":"31.50","total_qty":6}\n`, SHA-256 9c808afca68751e859669502476d9570d6fe5a0a6ac1c8fb774d40ec3346d6f8. SIGTERM heartbeat PID 500 wrote marker 15, disappeared and remained at count 182 across approximately 41 seconds. Only owned sandbox was killed; list empty at 02:34:40 UTC.

## MCP acceptance and repository checks

The independent agent exercised 18/21 MCP tools against real resources. Full MCP process restart recovered the original task and exact artifact. First cancellation attempts returned correct cancelled state but incorrect isError:true; the repaired build returned isError:false for cancel_task and get_task, with SIGTERM marker 15, vanished process and stable heartbeat count 11. Timeout mutation changed observed expiration from 02:49:04.278Z to 02:44:13.000Z; numeric timeout remains unreported, so timeout_verified:false is intentionally retained. All four sequential independent-agent sandboxes were confirmed deleted; maximum concurrent owned sandboxes was one. Evaluation bridge was subsequently shut down.

Parent agent then discovered Team through the configured official ListTeams API and exercised the remaining three tools. The first build submission failed HTTP400 (request 01A14CE2-58B3-5266-82CA-C42248A06B7A) because the adapter supplied startup commands with default generation 1. This was an implementation defect. Default generation 2 and a generation-1 preflight rejection fixed it. The rerun submitted unique template 3flkuk3r62835h4ydjtd (request 01A14CE3-C0D6-52D2-BFF8-745A8E70607F), observed ready, created a real test sandbox, passed command/output/binary checks and independently verified sandbox cleanup. Only the newly created template was then deleted; subsequent official GetTemplate confirmed absence.

Combined operation coverage is **21/21 tools exercised live**, split explicitly between independent runtime acceptance and parent template acceptance. This is not 21 independent natural-language evaluations or full original P0/P1/P2 acceptance. [Reviewed input/return/effect report](2026-10-18-skill-reliability/independent-agent.md), [assets and reproduction](2026-10-18-skill-reliability/README.md), [machine summary](2026-10-18-skill-reliability/SUMMARY.json).

### Execution-platform controls

A matching loopback Host returned HTTP200 and incremented the local handler counter. The same destination with custom Host returned HTTP501 and body “项目网络审计已关闭”, with handler count zero. A raw server that sent `garbage` was observed as HTTP502 rather than those bytes. These are execution-platform interception effects, not responses from the tested service. Existing engine/cubesandbox/TLS/proxy/WebSocket raw-wire tests affected by that interception remain blocked locally; their failures cannot be counted as passes. See network-controls.json.

The shell default umask is 077. A directory-mode oracle assumes 022; rerunning with umask 022 passes without changing extraction code. Mocked deploy unit tests unintentionally required an installed Docker binary; the unit fixture now stubs that prerequisite while real Docker/cloud acceptance remains separate. The JSON-fidelity oracle now controls its backend error instead of assuming the environment preserves connection-refused bytes, and normalizes only the intentionally expanded tool catalog while retaining the historical fixture.

## Not verified

All original P0/P1/P2 requirements remain in scope for coverage reporting. Arbitrary-image dependency/registry inspection and business-specific OCI acceptance, durable storage remount, cache/warm-pool performance/cost, billing attribution, hibernation, snapshots, network-policy management, preview expiry, browser/desktop handoff/replay, hosted remote MCP, third-party MCP/framework isolation and batch cleanup require their own real acceptance. A current implementation or declaration is not a passed scenario. FC application deployment is excluded by the user.


## Original requirement coverage denominator

| Requirement | Actual status |
| --- | --- |
| Basic create/query/delete and observable timeout update | PASS on the tested provider/template; runtime Team is credential-owned; arbitrary Team create parameter is refused |
| Commands/code, binary files, background recovery, cancellation, artifact business result | PASS for recorded live tasks; broader resource-exhaustion/expiry injection is NOT_RUN |
| OCI template submit/readiness/runtime/cleanup | PASS on an existing tested OCI image; arbitrary external image inspection NOT_RUN |
| Durable storage mount/read-only/remount persistence | NOT_RUN; no generic MCP adapter |
| Installation/auth/config/client verification | PARTIAL: actual source CLI/STDIO checked; full installed-client matrix NOT_RUN |
| Template cache/warm pool performance and cost comparisons | NOT_RUN |
| Billing by Team/template/sandbox and savings estimates | NOT_RUN |
| Deep hibernation/process/service/mount recovery | NOT_RUN |
| Snapshot reuse/external VM compatibility | NOT_RUN |
| Template update/rollback/cache/warm pool synchronization | PARTIAL: unique version preserves existing template; business rollback and pool updates NOT_RUN |
| Network/VPC rules/credentials policy management | NOT_RUN |
| Repository build/test/preview link expiration | NOT_RUN |
| Browser/desktop handoff/replay | NOT_RUN |
| Framework session reuse/user isolation/cleanup | NOT_RUN |
| Hosted remote MCP authentication/routing/operations | NOT_RUN; local evaluation bridge is not hosted MCP |
| Third-party MCP/Skill installation/version/logs/real call | NOT_RUN |
| Batch parallel verification/failure preservation/cleanup | NOT_RUN; these runs were deliberately sequential |

## Local validation commands

Exact check outcomes and remote gate state are appended after the final scoped checks. All failed attempts remain preserved in their distinct artifacts. No credential values or private raw SDK responses are included.


## Executed local checks (publication candidate)

- Lockfile installation: `npm ci --ignore-scripts --no-audit --no-fund`, PASS.
- Initial workflow/protocol/core checks: 85/85 PASS.
- Cancellation protocol regression using a real local process: 8/8 PASS; real-cloud rerun also PASS.
- Template workflow regressions: 4/4 PASS; real generation-2 build/runtime/cleanup PASS.
- Protocol checks after controls: JSON-number oracle and 20 KiB HTTP header PASS; isolated STDIO process suite 3/3 PASS. The historical JSON fixture remains unchanged; only the deliberately expanded catalog is normalized.
- Docker-free mocked template tests and umask-022 extraction: PASS; they do not establish Docker image-build acceptance.
- CLI status snapshots: `ABX_UPDATE_EVIDENCE=1 ... -t mcp`, 9 passed, 101 unselected. New dated CLI capture: three MCP cases, zero skipped; historical captures untouched.
- Full suite attempt during fixes: 3,765 passed, 34 failed, 2 skipped. Detailed failure inventory is in `local-full-suite-attempt.json`; that attempt overlapped changes and cannot certify the final revision. Subsequent corrected-contract regressions and remote CI are reported separately. No failure is relabeled a pass by removing it from the denominator.
- TLS control observed issuer `mitmproxy`, with a fingerprint different from the locally generated self-signed certificate; this proves that local self-signed trust tests see a different certificate in this execution environment.
- Typecheck/build/lint, package allow-list, final record/link/hygiene/secret scans and remote CI status are recorded below when complete. A draft is not merged acceptance.


- Latest focused API/template/task/protocol regressions: **73/73 PASS**, including SDK dependency readiness, unknown metadata and concurrent template-name collision refusing update/delete.
- Actual shipped CLI entrypoint with FORCE_COLOR and NO_COLOR: **PASS**, exit zero and no conflict warning. The development tsx loader can emit its warning before the CLI shim runs; that loader side effect is separated from the delivered executable.
- Repository lint: **PASS**, 0 errors (existing warnings retained). One intermediate lint accidentally included generated scratch output; the scratch build was moved outside the checkout and lint rerun over the actual repository.
- Package dry-run: SKILL.md, all three references and dist/bin/abx.js present. npm 12 returns the package record under a package-name object; the verification reader was corrected to inspect the actual shape instead of assuming an array. This was an evaluation-reader error, not a packaging failure.
- Repository health: **PASS**, 105 checks, 11 recommendations, 0 failures; hygiene **PASS**.


## Final real-component and remote evidence

- Standard repository E2E: `ABX_BIN="node dist/bin/abx.js" node e2e/run.mjs --suite cloud-lifecycle --filter 'cloud-lifecycle/(create-json|info-json|exec-basic|exec-exit-code-propagates|kill-yes-json|kill-twice)( |$)'`, **7 PASS**, one sandbox created and zero leaked. The first evaluation filter accidentally selected zero cases (one skip), was preserved as `official-e2e-unselected.json`, corrected and rerun; that no-op is not claimed as acceptance.
- PR: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/44 ; implementation head 3ad94be1bef2025c0f801b3a1dc18fcf27918aea.
- First-head remote CI: Node 20 and Node 22 test jobs, typecheck/lint/hygiene, installer, Markdown links and package build all **PASS**. Each Node job reports all **156 test files passing**. This validates the suite in the normal CI network environment while local interception limitations stay documented.
- [CI run](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/39091654429) and [docs run](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/39091654430). The final documentation/evidence commit receives its own CI run before merge; no pending check is treated as passed.
- Secret-value scan: 79 scoped files checked before the implementation commit, zero matches. Commit hook secret scan PASS; optional pre-commit framework was not installed, as permitted by the repository hook. Health/hygiene/link checks remain independently recorded.

- First-head CI unit totals: Node 20 **3,803 passed / 3 skipped**; Node 22 **3,804 passed / 2 skipped**, out of 3,806 each. Both have 156 passing test files. Skips remain explicit.

- Final installation review removed the stale `pip install agent-sandbox` instruction. The SDK's actual source distribution is agent-sandbox-client; its PyPI JSON endpoint returned 404 in this environment. The Skill directs users to release/source-install instructions rather than claiming publication. Node CLI/MCP acceptance does not require that Python distribution. Hosted Python MCP/deploy acceptance remains outside the passed coverage.
