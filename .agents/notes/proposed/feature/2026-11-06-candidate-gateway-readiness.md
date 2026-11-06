# Decision: Apply bounded HTTP revision readiness to candidate Gateways

Status: proposed

## Problem

Candidate publication used one HTTP health request while stable publication already used a bounded
revision check. A real update stopped at candidate-smoke with a generic error. Its original response
was not saved, so neither its status nor its cause is known. Later read-only observations found the
new revision at the candidate and the old revision at production; this does not establish why the
first request failed. Native readiness and trigger creation are not HTTP revision evidence.

## Decision

Use one shared health readiness function with a fixed Candidate or Stable stage. Require HTTP200
and the exact planned revision before candidate hooks or publication. Retry only404/502/503/504,
within30 seconds and30 attempts, with one-second delays included in the budget. Each real fetch
uses min15 seconds and remaining budget. HTTP200 with missing/wrong revision, other statuses and
transport failures stop immediately. Report only stage, safe HTTP status, attempt count and a static
revision-match failure; never echo the response body or identifiers. Keep strict credential rejection.

## API Design

No command or wire API changes. Candidate-smoke now uses the same bounded read gate as stable
readiness. Old failed receipts remain requires_reconcile. No apply or cloud mutation is replayed.

## Alternatives considered

- Treat the later successful health response as proof of the original cause: rejected.
- Retry wrong-revision HTTP200: rejected because routing correctness is unconfirmed.
- Repeat the failed apply: rejected because native side effects have already been admitted.

## Dependencies

The accepted spec6 profile, existing health revision response and bounded fetch transport.
The runtime owner independently reviewed the design and actual narrow implementation.

## Test Strategy

Check candidate transient recovery before hooks, wrong/missing revision, fatal HTTP/transport,
budget expiry and actual remaining fetch timeout. Preserve the stable-gate regressions and strict
production401 behavior. Freeze a separate eighth installed package before complete local/remote
checks, then validate a new source plan. Failed-branch cleanup is a separately reviewed task recovery.

## Acceptance criteria

- Candidate hooks start only after the exact planned revision is observed through HTTP.
- Readiness cannot turn an accepted credential or wrong revision into success.
- Error diagnostics reveal no raw body, revision identifier or credential.
- Source and public-package checks remain separate; previous attempts are not relabeled.
