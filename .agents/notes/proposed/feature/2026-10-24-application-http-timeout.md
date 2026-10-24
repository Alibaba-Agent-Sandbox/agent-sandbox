# Decision: Apply the existing HTTP deadline to application requests

Status: proposed

## Problem

`ABX_HTTP_TIMEOUT` configures the transport, but application discovery and command calls omit that value and always use the helper's 30-second default. A configured 40-second wait therefore still fails for a 35-second command. Tracked in [Issue 147](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/147).

## Decision

Pass `TransportConfig.http_timeout` through the existing discovery, health, listing and command request helpers. Convert seconds to integer milliseconds with `Math.ceil` before constructing the abort signal; valid fractional seconds must not raise a Node range error. Keep the 30-second default and send each command once.

## API Design

No new CLI flag, environment variable, provider field or execution mode. Existing helper functions accept an optional timeout argument. This is a per-request wait, not a remote execution cancellation or a whole-workflow deadline. CLI 0.4.17 is a new immutable release.

## Alternatives considered

- Increase the hardcoded default: ignores callers' existing configuration and short deadlines.
- Add a separate application timeout setting or retry: duplicates configuration or risks replaying side effects.
- Cancel the remote process on timeout: a different protocol and ownership change outside this fix.

## Dependencies

Existing application endpoint binding, token assembly and Node abort signals. The real-component regression uses published Python client/server 0.3.1a5 and Express base; no provider change is required.

## Test Strategy

Real local HTTP covers short and long deadlines, default and fractional values, discovery/list/health, and one POST. The cloud regression compares published CLI 0.4.16 to the candidate against the same owned server and independently verifies deletion. Node 20/22 CI, packaging, parity and repository gates remain required.

## Acceptance criteria

A configured 40-second wait receives a real 35-second result; a one-second wait fails without replay. Default 30 seconds remains unchanged. Both language guides explain the remote cancellation boundary. Required CI and real resource cleanup pass.

## Evidence

[Verification](../../../evidence/verify/2026-10-24-application-http-timeout.md).
