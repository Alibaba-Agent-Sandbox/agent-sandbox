# Decision: Integrate runtime readiness into CLI 0.4.11

Status: implemented

## Problem

The previous release-readiness fixes remained local while main gained workflow admission,
durable recovery and corrected cloud acceptance. Publishing that old branch would omit
accepted safety fixes. Python provider doctor requires the new authenticated initialization
route, which the public 0.4.10 package does not provide.

## Decision

Integrate the reviewed runtime fixes on main ee359fd, retain both sets of changes, and
prepare 0.4.11. Preserve the previous evidence as history. Align release fixture pins with
normal CI so publication validates the same Python/server and provider contracts.

## API Design

Retain the authenticated POST /v1/providers/:provider/initialize contract, explicit
initialization failure, provider runtime requirements, SSE backpressure and package-version
MCP metadata. No additional provider capability or cloud protocol is introduced.

## Alternatives considered

- Publish the earlier candidate: rejected because it omits newer workflow safety fixes.
- Claim the old engine can initialize providers: rejected; its missing endpoint must fail
  explicitly and the CLI must be delivered before the Python consumer.

## Dependencies

- [Issue 126](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/126).
- Python fixture 270a7a8fa72656653b485403273491fd99aeefc8 and provider fixture
  de4fbf647966459feb57a35ab590b938024abe0e, matching normal CI.
- Python SDK prerelease must consume the delivered initialization endpoint.

## Test Strategy

Run typecheck, build, lint, focused regressions, full unit/parity, offline acceptance,
package installation and real Express read-only/lifecycle acceptance. Record managed-network
failures distinctly; the normal Node 20/22 CI matrix must pass on the reviewed head.

## Acceptance criteria

All required CI and review gates pass; real cloud acceptance and owned cleanup are recorded;
installed 0.4.11 reports the expected version and retains complete Skill references. Publish
only the tested version-matching tag and verify its public registry artifact afterward.

## Evidence

- [Integration verification](../../../evidence/verify/2026-10-24-release-integration.md).

## Implementation

Delivered in [PR #127](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/127); actual merged state was checked on 2026-10-24. Later acceptance and current limitations are indexed in the [current synchronization record](../../../evidence/verify/2026-10-24-current-docs-and-records.md). Earlier verification files remain unchanged and retain their original pending or failed observations.
