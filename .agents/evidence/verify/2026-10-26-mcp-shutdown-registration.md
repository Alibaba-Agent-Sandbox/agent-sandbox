# Verification: MCP shutdown versus late handle registration

- Date: 2026-10-26
- Issue: [187](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/187)
- Change: `2026-10-26-mcp-shutdown-registration` (proposed)
- Result: PASS for scoped local/real-handle acceptance; repository-wide publication gates are separate
- Environment: CLI0.5.6 candidate, Node22.22.2; real Express cn-hangzhou; runtime credentials supplied only through environment variables

## What was verified

Independent adversarial review first examined the resource-verification helper for unsafe rollback. Its caller supplies the newly created provider-qualified handle; no new borrowed-resource deletion path was found there. Review then found a separate existing SandboxManager race: create/connect checked epoch before acquiring its registration lock. Holding the lock, queuing shutdown and then resolving the SDK request reproduced a fulfilled operation, nonempty manager state and no owned cleanup after shutdown.

The correction places epoch comparison and registration in one critical section, outside the cloud request. It cleans the exact returned owned/borrowed handle according to its origin. The new permanent real-handle scenario creates actual cloud sandboxes and performs actual commands, connect and deletion; only SDK-return timing and lock scheduling are controlled by test hooks.

## Commands run

```bash
npx vitest run tests/test_agent/test_mcp_ownership_races.test.ts
npx vitest run tests/test_agent/test_mcp_ownership_races.test.ts tests/test_agent/test_create_resources.test.ts tests/test_agent/test_mcp_lifecycle.test.ts tests/test_agent/test_mcp.test.ts tests/test_agent/test_mcp_http.test.ts tests/test_agent/test_mcp_http_wire.test.ts tests/test_agent/test_mcp_stdio_loop.test.ts
npm run typecheck
npx eslint src/agent/mcp.ts tests/test_agent/test_mcp_ownership_races.test.ts e2e/skill-mcp-shutdown-acceptance.mjs
npm run build
node e2e/skill-mcp-shutdown-acceptance.mjs --output NEW_JSON_RECEIPT
```

## Results

| Check | Result | Observation |
|---|---|---|
| Before-fix deterministic regressions | FAIL, expected | Both queued-shutdown/create and queued-shutdown/connect returned fulfilled instead of cancellation |
| After-fix lifecycle/HTTP/stdio/resource suites | PASS |136 tests across seven files |
| Typecheck | PASS | No TypeScript errors |
| Scoped ESLint | PASS | Zero errors; one pre-existing unused catch-variable warning in the manager's separate shutdown loop |
| Real create race | PASS | Late registration cancelled; state empty; independent owned sandbox HTTP404 |
| Real connect race | PASS | Late registration cancelled; borrowed handle closed; independent sandbox200 and exact business output `borrowed-business-survived` |
| Final real test-resource cleanup | PASS | Both task-owned test sandboxes independently404 |

The [real-handle receipt](2026-10-26-mcp-shutdown-registration-events.json) records the seven behavioral checks and both independent cleanup reads. These are actual backend handles, not mocked backend returns. The race ordering is intentionally controlled by the test hooks, not inferred from accidental network timing.

## Independent sibling review

The same adversarial pass found two Python MCP ownership issues: provider-local raw-ID collision could replace an owned handle with another provider's borrowed handle, and an in-flight create/connect could repopulate state after HTTP session shutdown. Those changes belong to [Python Issue139](https://github.com/Alibaba-Agent-Sandbox/python-sdk/issues/139), not this CLI patch. After the SDK owner's correction, an independent local rerun passed all three original counterexamples, including queued-shutdown create and connect using the actual asyncio lock. Its wheel/HTTP/cloud acceptance is recorded by that owner and is not inferred from these local checks.

## Cleanup

Each actual sandbox was uniquely created for this scenario. The owned-create branch independently observed deletion immediately after cancelled registration. The borrowed branch proved the external owner handle still ran a command and HTTP200 before the outer scenario explicitly deleted its own fixture. Both final absence checks passed. No pre-existing user resource was borrowed or removed.

## Problems and limits

The first actual-handle harness completed all cloud checks but left an outer client handle open, delaying local process exit. Its resources were already independently absent. The permanent harness now closes every created client in finally; its final exit result is recorded separately. A failed backend cleanup remains distinct from cancellation, and the platform TTL remains the fallback bound. This scoped run does not claim arbitrary external-provider shutdown semantics or full remote CI/review/merge completion.
