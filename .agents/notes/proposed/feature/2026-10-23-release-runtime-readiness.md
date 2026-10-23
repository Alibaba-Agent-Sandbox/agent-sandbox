# Decision: Verify provider initialization and release runtime boundaries
Status: proposed

## Problem

Contract adapters silently count skipped capabilities as passes. Installed plugins can
bypass current host requirements, engine streams ignore backpressure, and Python's
lazy engine client cannot prove a plugin initialized. MCP and packaged Skill guidance
also expose stale release information.

## Decision

Fail skipped framework cases without an explicit skip adapter. Reuse manifest host
checks on load and direct factories. Add authenticated provider initialization that
builds and closes infrastructure without sandbox operations. Honor SSE drain/close.
Use the package host version for MCP. Repair stale offline E2E fixtures against
current configuration, catalog and provider contracts without changing product behavior. Correct Skill references and verify their
closure in the npm package gate.

Preserve main's content-bound Node execution snapshots; the old proposed restart-only
solution is unnecessary on base 475848c. Test real relative dependency updates.

## API Design

`POST /v1/providers/:provider/initialize` takes the existing connection header or
body and returns `{provider, initialized: true, version}` only after successful close.
Old engines return 404, which consumers must report as unsupported verification.
No release version is assigned by this local change.

## Alternatives considered

- Cloud create as a health check: unnecessary side effects and incorrect scope.
- Treat missing initialization routes or skip adapters as success: false evidence.
- A new plugin version service: unnecessary for Git and content-bound snapshots.

## Dependencies

Existing CLI provider and HTTP layers. Python doctor consumes the new route; land
this host capability before the dependent consumer. Owner repository:
https://github.com/Alibaba-Agent-Sandbox/python-sdk .

## Test Strategy

Real loopback HTTP, real ES modules and installed plugin trees verify initialization,
cleanup, invalid code, updated dependencies and SSE disconnects. Run local CI,
package closure, offline E2E and repository health. Record cloud/remote gates separately.

## Acceptance criteria

- No skipped test is silently counted as a pass without an adapter.
- Incompatible hosts reject plugins before execution.
- Initialization never invokes sandbox lifecycle and closes returned infrastructure.
- Slow consumers stop upstream iteration; disconnection releases it.
- Packaged Skill references resolve and MCP reports the installed version.
- Required cloud E2E, CI and review must pass before merge; this record remains proposed.

## Evidence

[Verification](../../../evidence/verify/2026-10-23-release-runtime-readiness.md).
