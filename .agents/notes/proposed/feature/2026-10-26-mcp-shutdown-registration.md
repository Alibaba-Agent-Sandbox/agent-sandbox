# Decision: Make MCP lifecycle registration atomic with shutdown
Status: proposed

## Problem

[Issue187](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/187) tracks a reproduced session-end race. Checking the session epoch outside the state lock allowed an in-flight create/connect to pass the old epoch, queue behind shutdown and then register after shutdown's empty cleanup snapshot. The create succeeded while its sandbox remained unowned; a late borrowed handle was also not closed.

## Decision

Capture lifecycle epochs before lazy SDK loading and check them again when loading completes. After a real SDK create/connect returns, compare the epoch and register its handle in one state-lock critical section. When shutdown wins, delete only the exact newly created handle, or close only the exact borrowed connection handle, then reject the late operation with cancellation. Do not look up another resource by ID during that rollback.

## API Design

Public signatures are unchanged. The correction makes an in-flight request that loses the shutdown race reject rather than return a handle registered after session cleanup. Explicit user deletion and accepted task retention keep their existing contracts.

## Alternatives considered

- Keep the unlocked epoch check — rejected because the reproduced lock-queue ordering still leaks ownership.
- Hold the state lock across the cloud request — rejected because a slow backend would block shutdown and unrelated state operations.
- Kill every late handle — rejected because explicitly connected resources are borrowed; only their local clients may be closed.

## Dependencies

Existing SandboxManager state/epoch, AsyncLock and provider-owned SDK handles. No new dependency, cloud endpoint or public command is introduced.

## Test Strategy

Two deterministic regressions hold the actual state lock, queue shutdown first and then release an SDK result. Both failed before the fix and pass after it. Run affected lifecycle/HTTP/stdio suites and a real-cloud handle acceptance scenario whose hooks control scheduling without mocking backend responses. Independently read owned-resource404 and prove the borrowed sandbox can still execute its business command.

## Acceptance criteria

- No late create/connect registers after shutdown's snapshot.
- A late newly created owned sandbox is killed through its exact returned handle.
- A late borrowed connection closes locally and is never killed by shutdown.
- Affected tests, actual cloud behavior, independent cleanup, bilingual docs and owner evidence are recorded; full repository CI/review remains separately required.

## Evidence

- [Verification](../../../evidence/verify/2026-10-26-mcp-shutdown-registration.md)
