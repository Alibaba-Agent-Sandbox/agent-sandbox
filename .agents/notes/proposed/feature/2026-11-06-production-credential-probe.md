# Decision: Bound transient production credential checks without hiding acceptance

Status: proposed

## Problem

The fourth real source attempt passed its candidate business hook and reached the stable trigger,
then its final temporary-credential rejection check failed with no recorded HTTP status. Later
independent health, missing/random credentials and business-key probes passed. The original status
is unknown; this does not prove accepted credentials, a specific cloud transient or a routing bug.

## Decision

Keep the exact final GET and token. Accept only HTTP401. Retry only502/503/504, at most four attempts
inside30 seconds, delaying one second between attempts. Each native fetch receives at most15 seconds
and no more than the remaining total budget. HTTP200,500, other statuses and transport failures stop
immediately. Safe errors include only integer HTTP status or unavailable plus the bounded attempt
count. No body, headers or token are exposed. Do not rewrite any failed receipt or replay apply.
The runtime owner independently reviewed the exact status policy, bounds and security regressions.

## API Design

No new command, HTTP route or mutation retry. The private probe timeout argument only narrows the
final read budget; existing health probes retain their timeout. Do not add a warmup GET without
separate evidence. Publication still requires exact temporary-key rejection and all existing gates.

## Alternatives considered

- Retry every non401 or accepted credential: rejected because it can conceal authentication failure.
- Retry500 or transport errors: rejected from this narrow verified status policy.
- Assume the old failure was502 or leaked credentials: rejected because its status was not captured.
- Mark the old requires_reconcile receipt ready: rejected because actual finalization did not complete.

## Dependencies

Existing fetch and AbortSignal timeout, fixed native deployment/alias identities and the original
verification token. The prior publication, timer and candidate cleanup order is unchanged.

## Test Strategy

Require transient-to401 retries to reuse the exact token. Require first200/other statuses/transport
errors to stop with no later cloud mutation, including no timer enable or candidate-trigger deletion.
Check bounded attempts, expired total budget, remaining fetch timeout and requires_reconcile retention.
Run focused checks, strict types/build, separate immutable installed-package checks and full CI.

## Acceptance criteria

- No accepted temporary credential can be hidden by a later retry result.
- Only the three explicit transient statuses retry within the finite request/time budget.
- Diagnostics disclose safe status/count only; old unknown evidence remains unknown.
- Failed application state is preserved and new source validation uses a new application/plan.
