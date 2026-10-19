# Decision: Normalize project tool deadlines to integer milliseconds
Status: proposed

## Problem

Project adapters carry a remaining deadline in seconds. JavaScript evaluates `8.001 * 1000` to `8000.999999999999`, which Node execFile rejects before Docker/kubectl starts. The current built helper reproduced RangeError for 1.001 seconds.

## Decision

Round the converted milliseconds upward with Math.ceil in the generic tool runner. This preserves a fractional-second deadline with less than one millisecond of rounding, without backend branches or timeout inflation to whole seconds.

## API Design

No signature or command changes. runTool continues accepting optional timeout seconds. Provider policy stays in adapters.

## Alternatives considered

- Round adapters to whole seconds: unnecessarily changes their shared deadline.
- Ignore a passing native run: the failure is deterministic for particular remaining durations and can recur during any build.

## Dependencies

Node execFile unsigned-integer timeout contract. Follow-up to https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/69 and https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/71 .

## Test Strategy

Run a real Node subprocess with 8.001 seconds, the value whose unrounded conversion is not an integer. Run strict typecheck, launch regressions, full suite, lint, build, health/hygiene and hosted Node 20/22 CI. Pin provider T4 to this reviewed source and rerun native Docker project launch.

## Acceptance criteria

The real subprocess returns its output; no RangeError occurs. Existing privacy/cleanup regressions remain green. Current-head CI and the corresponding native OpenSandbox workflow pass before merge.

## Evidence

See [verification](../../../evidence/verify/2026-10-19-project-tool-deadline.md).
