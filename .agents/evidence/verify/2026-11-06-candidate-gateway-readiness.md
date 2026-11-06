# Verification: candidate HTTP revision readiness

- Date: 2026-11-06
- Scope: CLI PR235 eighth unpublished candidate, service.ts and managed application regressions.
- Result: focused/local package gates passed; full local/remote and new-source acceptance pending.

The earlier real update failed at candidate-smoke after a single HTTP request. The original response
status/body were not retained. Later candidate200 at the new revision and stable200 at the old
revision are separate observations, not a demonstrated propagation root cause. The failed receipt
remains requires_reconcile; a new plan is required after independently verified branch recovery.

`npx vitest run tests/test_cli/test_managed_application.test.ts` with the candidate/stable readiness
selection passed15 cases: nine new candidate cases and six retained stable cases, with84 deselected.
This is a99-case file, not99 checks run by the focused selection. Strict typecheck and clean build
passed. A new reproducible eighth npm install passed the actual installed release-artifact check.
No earlier installed snapshot was modified. Complete make ci runs in the development checkout.

Candidate retry cases cover404 then503 then exact200 before hooks; HTTP200 wrong/missing revision;
fatal403/500; static transport-error withholding; total deadline; and actual fetch timeout narrowing.
Stable and production credential policies are retained. HTTP200 mismatch diagnostics now explicitly
report revision-match false without disclosing either revision or any response body.

The original old reusable Session subsequently reached its configured idle close and its native
Sandbox was absent. That is not a successful continuity test. The task recovery uses an explicitly
closed-old-session scope; any renewed continuity scenario gets a fresh separately saved Session.
No merge, tag, public release or complete eighth-candidate cloud result is claimed here.
