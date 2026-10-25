# Decision: Bound the full provider command stream

Status: proposed

## Problem

The process adapter maps HTTP idle ReadTimeout, which continuous output can keep resetting. A real public CLI 0.5.1 command with timeout 1 ran a four-second printing program to successful completion. [Issue 166](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/166) owns the defect.

## Decision

Use a monotonic deadline while awaiting each frame. On expiry, cancel only this call's HTTP streaming response/client, preserve CommandTimeoutError/E3001 and best-effort SIGKILL the positive PID actually observed for this command. Always request iterator closure. JavaScript generator return queues behind a pending next: an internal AbortSignal closes the existing per-call HTTP resources first, and custom iterators that ignore cancellation cannot delay the caller indefinitely. Preserve the existing HTTP idle-timeout mapping and normal output behavior.

## API Design

No new user option, response type, retry layer or public execution mode. Existing native/provider `--timeout` and `commands.run/stream/start` gain the documented total command budget. The separately pinned standard CLI path is unchanged. The signal field is internal to the existing HTTP streaming request options.

## Alternatives considered

Only shortening the HTTP read timeout fails for noisy commands. Awaiting generator return before cancelling the underlying read can hang. Killing by a tag, process-name match or sandbox-wide inventory would risk unrelated processes and is rejected.

## Dependencies

Existing ProcessProtocol, HttpClient, per-stream AsyncClient and the standard Node AbortController/performance clock. No new package.

## Test Strategy

Finite noisy and silent Connect streams exercise the actual HttpClient/protocol, typed error, exact PID signal and response/client/iterator closure. Preserve existing KI-003 mappings. Real cloud comparisons use explicit native/provider flags and independent SDK process/sandbox absence checks. Maintained cloud-lifecycle scenarios cover both stream shapes.

## Acceptance criteria

- Both output-producing and silent commands stop at the total budget with E3001.
- Only the observed owned PID is signalled and all stream resources are closed.
- Existing normal and transport-timeout behavior remains covered.
- Real-component evidence, bilingual docs, changelog and required latest-head CI accompany the patch release.
