# Decision: Run maintained regressions through the current Express command surface

Status: implemented

## Problem

The maintained known-issues runner combines native Express flags with standard
CLI routing and asserts obsolete timeout text. It also unnecessarily defaults
to an application template although the scenarios need only process/files.

## Decision

Select native Express explicitly for CLI calls, use existing base by default,
and configure the same selected test account for the standard TypeScript SDK
and project CLI. Assert typed E3001, bounded elapsed time and process absence
instead of dynamic timeout prose. Update both languages without product aliases.

## API Design

No product interface, runtime or package version change. Standard TypeScript
api_key/api_url/domain remain valid and are not rewritten as Python keywords.

## Alternatives considered

Adding product compatibility aliases would hide the incorrect test routing.
Keeping the application template adds unnecessary preparation prerequisites.
Comparing full timeout prose would remain coupled to optional PID diagnostics.

## Dependencies

[Public CLI 0.5.3](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/releases/tag/v0.5.3).
The built TypeScript SDK uses matching source revision
6dfdf9897ad76bf2fdb7eb1ccf455252b2dcb9fb; only test/docs files change here.

## Test Strategy

Run the entire existing known-issues suite against a fresh public CLI install
and real Express runtime, verify owned cleanup independently using public Python
a2, then run required owner checks and latest-head CI/review.

## Acceptance criteria

All maintained scenarios run through their intended current interfaces, 17 real
scenarios pass, no owned sandbox remains, and normal owner checks/merge pass.

## Evidence

[Verification](../../../evidence/verify/2026-10-25-current-known-issue-runner.md).

Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/171
