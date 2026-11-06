# Verification: production temporary-credential probe

- Date: 2026-11-06
- Scope: CLI PR235 sixth unpublished candidate.
- Result: focused 13 cases, strict types and build passed; complete/new-cloud gates in progress.

The fourth actual source attempt reached stable-trigger after its real two-turn candidate business
hook passed, then the final credential check failed. Its HTTP status was not recorded and remains
unknown. Root independently observed stable health200, missing/random credentials401 and valid
business-key200 afterwards. No credential leak, definite transient cause or ready state is inferred.

The fix accepts only401, retries only502/503/504 within30 seconds/four attempts/one-second delay,
and narrows each actual fetch timeout to min15 seconds and remaining time. Any200,500, other status
or transport failure stops. The error includes only a validated integer HTTP status or unavailable
and attempt count. The same credential is reused; no cloud mutation is replayed.

Thirteen focused cases passed: three permitted transient statuses, five immediately fatal statuses,
transient503 followed by200 stops before a later401, transport privacy/no retry, four-attempt exhaustion, total-budget expiry and remaining real fetch
signal timeout. Fatal responses retain requires_reconcile and produce no later cloud operation.
The actual original failure is preserved; this fix does not mark that receipt ready. Root's manual
source validation on that partial endpoint is distinct from the subsequent normal sixth-candidate
build/plan/apply/publication and public-consumption gates.
