# Decision: Serialize private FC invocation bytes and preserve drained ledgers

Status: proposed

## Problem

The real joint deployment created and verified all three FC roles, then the official SDK request
serializer crashed before private bootstrap was confirmed. Its Stream.readAsBytes implementation
passes chunks to Buffer.concat; Readable.from of JSON strings emits strings. Separately, a destroyed
application retains its durable admission fence; recreating the same application against that ledger
could publish a healthy endpoint that rejects new Sessions.

## Decision

Supply explicit UTF-8 Buffer chunks to the existing generated FC InvokeFunctionRequest. Preserve the
signed envelope, credentials, request bounds, no-retry policy and conservative execution receipt.
Reject native HTTP 200 error envelopes with explicit error-type/message/object keys before any
activity output; surface only the existing bounded static error.
At bootstrap, require global status.draining to be explicitly false before state pinning or candidate
publication. Reject true or missing status without reopening admission. Use a new application name
or fresh empty state database after complete destruction; normal updates retain previous receipts.
The runtime owner independently reviewed both narrow changes before implementation.

## API Design

No new command, HTTP route or runtime operation. The CLI explains a preserved drain fence explicitly.
The signed private payload and its HMAC are unchanged. Existing failed receipts and installed
candidates remain immutable; recovery uses a separate candidate and never replays apply.

## Alternatives considered

- Mock only invokeControl success: rejected because it bypasses the failing official serializer.
- Retry a failed invocation or apply: rejected because a local stream failure is not proof of remote absence.
- Automatically activate or clear the ledger: rejected because old Gateways could regain admission.
- Treat missing admission state as ready: rejected by the minimum runtime's explicit boolean protocol.

## Dependencies

The locked official FC SDK, OpenAPI serializer and Darabonba Stream implementation. No dependency or
wire-format change is required. SDK PR156 supplies the existing explicit global status boolean.

## Test Strategy

Reproduce the original uncaught string-chunk failure in an isolated Node process. Exercise the real
createFcTransport, generated FC request model and official serializer, substituting only the HTTP
network boundary. Verify Unicode UTF-8 bytes, ACS payload hash, original signed envelope, one request
and bounded decoded response. Test drained and absent admission booleans before candidate exposure.
Run focused checks, full CI and immutable installed-artifact checks separately from root's real FC run.

## Acceptance criteria

- Official serialization reaches the native network boundary with the exact signed UTF-8 body.
- A draining or unconfirmed ledger never publishes a new candidate or changes admission.
- Existing resources, receipts and earlier immutable candidates remain available for safe recovery.
- Local, remote and joint cloud results are recorded independently and honestly.
