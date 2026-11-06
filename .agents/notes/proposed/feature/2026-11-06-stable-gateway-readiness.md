# Decision: Verify the stable HTTP Gateway revision before final credential rejection

Status: proposed

## Problem

The deployed stable alias is verified natively, but its HTTP route was not checked for the new
revision. An older Gateway also rejects a new temporary key, so401 alone can falsely establish
successful upgrade routing. A later real attempt recorded404 at the final credential check;
its original response body and precise cause remain unknown.

## Decision

After stable-trigger publication and before the unchanged credential gate, GET stable /health.
Require HTTP200 and the exact frozen new revision. Retry only health404/502/503/504 within30 seconds,
at most30 attempts and one-second delays. Each fetch is limited to min15 seconds and remaining budget.
Wrong-revision200,500, other statuses or transport errors stop. Keep native ownership, alias and
version checks and strict temporary-key rejection: no auth404 retry, no accepted key can be hidden.
Root and the runtime owner independently confirmed this separate routing-correctness requirement.

## API Design

No public command or API changes. New receipts report stable-readiness and verify-production-auth
phases. Failed historical receipts are immutable and remain requires_reconcile; no apply is replayed.

## Alternatives considered

- Treat final401 as proof of the new HTTP revision: rejected because old revisions also reject new keys.
- Retry authentication404: rejected because it does not prove credential rejection.
- Assume the recorded404 proves edge propagation: rejected without captured native error evidence.
- Wait through wrong-revision200: deferred; immediate failure is conservative and avoids unknown routing.

## Dependencies

The existing managed Gateway health revision, native alias publication and bounded fetch path.
The fixed-app diagnostic experiment is separate and cannot rewrite the earlier unknown response.

## Test Strategy

Check stable404 recovery before any credential request, wrong-revision failure, fatal403/500,
total-budget expiry without auth success and real fetch remaining timeout. Retain every strict
v6 credential regression, including503 then200 stopping before a later401. Run types/build and
install a separately frozen seventh candidate, then complete local/remote and actual-source gates.

## Acceptance criteria

- Stable HTTP must serve the new frozen revision before publication is finalized.
- Health retries cannot bypass or weaken temporary-key rejection or native identity checks.
- Safe status/count diagnostics disclose no body/header/token; old evidence is not rewritten.
- Source candidate checks and public package/template acceptance stay separate.
