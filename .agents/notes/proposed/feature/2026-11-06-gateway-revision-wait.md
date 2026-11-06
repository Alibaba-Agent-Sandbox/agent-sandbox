# Decision: Wait for the frozen Gateway revision

Status: proposed

## Problem

Published CLI 0.5.9 stops candidate/stable readiness at the first HTTP 200 with a nonmatching revision,
discarding the remainder of its 30-second wait. A real public-template update passed both Codex business
turns and then failed stable readiness with HTTP 200, one attempt and revision match false. The original
first body was not retained, so its underlying cause is unknown. See
[Issue 237](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/237).

## Decision

Treat HTTP 200 with an unready body as another bounded health observation. Keep the exact HTTP 200 plus
frozen revision success predicate. Both candidate and stable checks share the existing 30-second,
at-most-30-attempt wait, one-second delay and per-request remaining budget. Preserve failed receipts
and every mutation boundary. Prepare immutable patch release 0.5.10; this note does not establish publication.

## API Design

No public interface changes. HTTP 401/403/500 and transport errors remain fatal. HTTP 404/502/503/504
retain their existing health policy. Production temporary-credential checks remain separate; any HTTP
200 still immediately rejects publication. A wrong health revision is never accepted.

## Alternatives considered

- Accepting a different revision would break session/version routing guarantees.
- Retrying only a guessed previous revision needs new inputs without improving the exact success
  predicate. The first response was not saved, so no previous-revision cause can be inferred.
- Replaying failed apply or rewriting a receipt as ready would repeat unknown effects and is excluded.

## Dependencies

Existing managed application service and tests; no new runtime dependency, SDK release or Server image.
The Express acceptance report also needs strictly projected image ownership metadata for task-scoped
cleanup; it must not change application kill/cache behavior or expose raw journals.

## Test Strategy

Preserve before/after regressions for both stages. Exercise wrong/missing/null/array/nonstring bodies,
actual JSON parsing and remaining AbortSignal budgets, persistent mismatch deadlines and attempt caps,
fatal health statuses/transport errors and unchanged credential rejection. Run full repository gates,
the existing real Express workflow, and verify owned image cleanup independently from compute cleanup.

## Acceptance criteria

Both stages wait for exact frozen health within the old bounds; persistent mismatches retain the
deployment without later credential/timer effects. Required CI and real-component gates pass before
merge. Five-platform release and public npm installation remain independently verified publication gates.

## Evidence

- [Verification](../../../evidence/verify/2026-11-06-gateway-revision-wait.md)
