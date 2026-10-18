# Verification: Sandbox Skill second review

- Date: 2026-10-18
- Change: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/45
- Baseline: merged main 3f9faaf575d2d4304e6241406260ba6da7ff1d8e (PR #44).
- Result: PARTIAL while final required gates run; original broad requirements remain PARTIAL.
- Environment: Linux, Node.js 22.22.2, lockfile npm ci; Alibaba cn-hangzhou. Credentials loaded at runtime from environment/.env, values excluded.
- Skill SHA-256 used by fresh runtime/template MCP runs: a421a4d2a74bd1ebf0acb487e4444d7daed7e4fa41b2f97ceb45341353f8ab31. Exact child model identifier is not exposed.

## What was verified

The user requested another verification of closure, documentation completeness and best practices. A new independent read-only review examined the delivered Skill and reproduced failures without being given the intended answer. The root agent performed a separate real STDIO/cloud acceptance. This review is new evidence; no historical failure or merged record was rewritten.

## Problems found and attribution

| Finding | Attribution | Reproduction and repair |
| --- | --- | --- |
| Installation uses agent-sandbox/agent-sandbox, which is a different repository | Documentation | Its pinned raw Skill/reference URLs return 404; canonical Alibaba-Agent-Sandbox URLs return 200. Correct install/raw sources. |
| Clone examples use cli/ and copy only SKILL.md; sparse pattern omits references | Documentation | Fresh clone directory is agent-sandbox; install entrypoint plus all three references. |
| Task reports cancelled while a resistant descendant writes heartbeat | Implementation | Independent local heartbeat grew 35→46 after cancelled/-15. Supervisor now retains waitable leader identity and waits for non-zombie members of the original group/session. |
| Qualified sandbox deletion keeps a dead default/cache entry | Implementation | Independent reproduction reusedKilledDefault:true; use qualified keys/object identity and clear successful deletion. |
| retain:false on borrowed sandbox permits disconnect deletion | Implementation | New regression failed on merged source; reject cleanup ownership transfer. Explicit authorized kill remains available. |
| Explicit delete failure drops local retry state | Implementation | New regression failed on merged source; remove handle/default only after successful deletion. |

Five new behavioral regressions failed on merged source before repair (8 cases unselected), then the first corrected focused run passed 54/54. Two earlier harness startup attempts ran before dependency installation completed (missing vitest/config / missing bin); they are harness prerequisite failures, not product failures, and are not passes. The successful baseline reproduction ran after dependencies were ready.

## Fresh live acceptance

Runtime tools: 18/18 exercised through a real MCP STDIO child. Original task recovered after a full process restart; downloaded actual 53-byte business artifact SHA-256 is 9c808afca68751e859669502476d9570d6fe5a0a6ac1c8fb774d40ec3346d6f8, with typed row_count 3, total_qty 6 and total_amount string 31.50. Both expected command exit 7 and borrowed retain:false return isError:true and are explicitly checked as expected errors, not successful business commands.

A SIGTERM-resistant descendant stayed cancelling; actual stdout increased 110→190 bytes while still active. Repeated TERM after shell-leader exit retained group identity. Explicit SIGKILL targeted only that owned task group; terminal cancelled output then remained stable at 295 bytes. Ordinary cancellation also stopped output. Borrowed sandbox survived rejected retain:false and a second full MCP restart. Observed start/end timestamps establish requested 600 seconds; missing numeric timeout/region remain null. Explicit timeout change was accepted and changed observed expiration; timeout_verified:false is preserved.

Owned runtime sandbox sbx-7c50fc96-3f4b-4bc5-8063-60431b7a15b7 was deleted, independent get returned E2009 and resource list matched empty baseline. Template follow-up, standard E2E and final checks are appended when executed.

## Installation and documentation

Pinned canonical raw downloads fetched all four files with HTTP200. Equivalent wrong-owner URLs returned HTTP404. Actual skills@1.7.0 installation from the canonical repository into an isolated temporary project succeeded and contained all references; each hash matched the pinned merged baseline. This tests installation file delivery, not activation in every supported IDE. Sparse/clone examples and candidate package bundle are checked separately.

A second reviewer confirmed the previous 14 delivery hashes, both original result artifacts and 111 recorded actions. The historical SUMMARY.json mentions EVIDENCE.md, a nonexistent old label; use independent-agent.md and the historical top-level verification instead. That immutable JSON remains unchanged, including its independent 18-tool vs parent 3-tool distinction.

## Original requirement closure

Basic runtime and tested-image template scenarios can be verified independently. Advanced acceptance remains open in https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/46 : storage persistence, arbitrary image/business validation, installed-client matrix, cache/warm pool/cost/billing, hibernation/snapshots, business rollback/pool synchronization, VPC policy, preview expiry, desktop/replay, framework/user isolation, hosted MCP, third-party installation and batch verification, plus resource-exhaustion/expiry injection. None is newly marked PASS by this review. FC application deployment remains excluded.

Historical FunctionNotFound direct cause is proven by exact successful DeleteFunction three seconds before task failure. Its upstream initiating operation remains unresolved. This review does not relabel it a platform product defect or claim a later healthy-template test fixes the deleting actor.

## Best-practice assessment

The Skill uses progressive references, actual tool discovery, explicit provider boundaries, unknown metadata, typed business/hash checks, ownership-limited cleanup and sanitized action evidence. Those are supported by real behavior. Installation and cancellation boundary defects meant the previous delivery did not yet satisfy those practices in every case; this follow-up repairs the demonstrated gaps. Process-group supervision is bounded: intentional setsid/daemonization escapes its original session/group, and destruction of the sandbox is the complete-environment termination option when authorized. No cross-provider, all-client or statistical reliability claim is made.

## Commands run

- npm ci --ignore-scripts --no-audit --no-fund
- npx --no-install vitest run tests/test_agent/test_workflow_reliability.test.ts -t 'refuses to transfer|provider-qualified default|qualified cache entry|failed deletion|SIGTERM-resistant' --no-color (baseline: 5 failures)
- npx --no-install vitest run tests/test_agent/test_workflow_reliability.test.ts tests/test_agent/test_mcp.test.ts tests/test_agent/test_template_workflows.test.ts --no-color (first corrected run: 54 passes)
- npm run typecheck; npm run build
- DISABLE_TELEMETRY=1 npx --yes skills@1.7.0 add alibaba-agent-sandbox/agent-sandbox --skill agent-sandbox -a codex -y --copy (isolated project)
- Fresh runtime/template reproduction drivers use repository, environment-file and output-directory arguments; credentials never appear in their arguments or records.

## Results and cleanup

Final checks and owned-resource confirmation are appended below as they finish. See [action assets](2026-10-18-skill-recheck/README.md).


## Additional executed outcomes

- Fresh template tools: 3/3 live through STDIO, unique template x9r6a621z41zwrcqz8bu ready, real runtime command/binary checks verified, temporary sandbox deletion independently confirmed. Only the newly created template was deleted; official GetTemplate then returned not-found. Combined fresh tool invocation coverage is 21/21, not full original requirement coverage.
- Corrected sparse checkout/copy example: PASS; all four files present and match the pinned merged baseline. skills@1.7.0 and manual raw download also matched that baseline. Candidate bundle inclusion is checked independently.
- Typecheck/build: PASS. Lint: PASS, 0 errors / 222 existing warnings. Hygiene: PASS. Repository health: PASS=105, WARN=11, FAIL=0.
- Independent candidate review: 38 focused regressions PASS plus seven separate local behavioral controls PASS, including two providers sharing a bare ID and a deliberately altered pid_start refusing cancellation. The reviewer observed leader Z, repeated cancelling with heartbeat 40→80, then stable terminal output only after SIGKILL. The ordinary leader-first-exit case remained running until its child completed.
