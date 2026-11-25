# Decision: Keep MCP cleanup failures retryable

Status: implemented

## Problem

Session deletion removed its ownership records before remote deletion completed, and
manager shutdown swallowed backend errors. A failed delete could therefore return
success while losing the only session handle needed for retry. See
[Issue 278](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/278).

## Decision

Keep session and sandbox handles until their individual cleanup succeeds. Mark a
session closing before cleanup; reject subsequent tool requests but accept repeated
DELETE. Serialize manager shutdown and share concurrent session deletion. Track
already admitted handle acquisition and mutation so late create/connect results stay
owned by shutdown. Continue cleanup of other resources after one failure.

Idle cleanup retries use the existing session TTL as their minimum interval. Closing
entries remain counted against capacity. Server shutdown reports incomplete cleanup,
settles its completion promise and blocks new session admission.

## API Design

- `DELETE /mcp`: 200 only after cleanup; 503 on incomplete cleanup, same session ID retryable.
- `POST /mcp`: 409 while the selected session is closing.
- `SandboxManager.shutdown()` retains failed handles and throws `McpCleanupError`.
- Existing owned kill versus borrowed/retained close behavior remains unchanged.
- Failed native deletion keeps the SDK transport usable; acknowledged deletion retries
  only failed local cleanup.
- Explicit invalid MCP protocol headers return 400 before mutation, per
  [Issue 279](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/279).

## Alternatives considered

- Remove the record first: loses retry ownership and falsely reports success.
- Retry every incoming request: repeats failing backend calls without pacing.
- Add a durable task service: outside this bounded session lifecycle correction.

## Dependencies

Existing manager locks, SDK handles, HTTP transport and session TTL; no new packages.
Python counterpart: [Issue 181](https://github.com/Alibaba-Agent-Sandbox/python-sdk/issues/181).

## Test Strategy

Regress partial failure, borrowed close failure, late creation, concurrent deletion,
TTL-paced expiry, capacity, server shutdown, and real local HTTP failure/retry. Run the
existing MCP suite and a real Express HTTP create/execute/delete journey with independent
resource absence observation.

## Acceptance criteria

Failures preserve retryable handles and return non-success; retries do not delete
borrowed resources or repeat successful cleanup. Existing admitted creations cannot
escape shutdown ownership. Public bilingual docs explain retry and in-memory boundaries.

## Consequences

This is not durable process-restart recovery or complete active-tool drain. Remote
kill success retains the existing Provider contract; a timeout, auth failure or other
unknown result is never interpreted as absence. Retained resources keep their existing
platform lifetime. No database, FC deployment or template startup behavior changes.
