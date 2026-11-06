# Verification: Gateway revision wait

- Date: 2026-11-06
- Change: [Issue 237](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/237)
- Result: real-component coverage completed across preserved runs; final exact-head repository/publication gates pending.
- Package: locally prepared CLI 0.5.10; base main `7b08d7c66299f5ac98ea34684d968d61e208f0d9`.
- Environment: Linux, Node.js 22. Credentials are not needed for local regressions and are not recorded.

## What was verified

The existing implementation immediately rejected both new stage-specific regression scenarios.
The one-line policy change admits HTTP 200 to the bounded unready-health wait while keeping exact
revision success, fatal errors and production temporary-credential behavior unchanged.

## Commands run

- Reproducible `npm ci --no-audit --no-fund`.
- Before: selected `waits through nonmatching and malformed HTTP200 health` tests failed twice;
  101 other cases were filtered out.
- After: focused readiness/authentication tests passed 27 cases, with 79 filtered out, in 114.59 seconds.
- `npm run typecheck`: PASS.
- Independent reviewer ran both new stage-success cases and stable transport failure: three PASS.
- Image-only recovery report tests: 15 PASS locally and independently. The early failure fixture contains
  only actual `python-hello:<alias>` image entries, without a later template intent; these remain
  recoverable. Original compute cleanup selection is unchanged.
- First full `make ci` reached unit tests: 4,739 PASS, 11 optional skips and one expected version-golden
  mismatch after the release bump. Added a new dated 0.5.10 golden using `ABX_UPDATE_EVIDENCE=1` and
  retained every previous golden. The selected version case and later full rerun pass.
- ESLint: zero errors, 275 warnings. Repository health: 105 PASS, 11 WARN, zero FAIL.
- [Actual candidate version capture](../cli/2026-11-06-cli-0510-version.md).
- A second full run passed all 4,740 enabled unit cases but parity rejected six skipped server-reference
  cases because the isolated checkout lacked `ABX_SERVER_SDK_SRC`. This setup failure is preserved.
- Final `make ci`, with matched SDK source/public-PyPI interpreter and reviewed provider catalog supplied:
  PASS. Units: 4,746 PASS, five optional skips. Parity runner: 4,772 PASS, five optional skips; ledger:
  907/907 PASS, zero missing, 11 moved classes independently verified in the owning SDK. Package-entry
  and Skill-reference closure checks: PASS. The enabled server-guide component suite also passed 23 cases
  separately; those overlap the full run and are not additional unique coverage.
- Exact-head `b544c4ca8233bcbd24691e43638383cef8d6375d` remote CI
  [42232391962](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/42232391962):
  Node 20/22 tests, typecheck, installer and package build PASS. Documentation links also PASS.
  Automatic Express run 42232391946 skipped its real launch step; its green job is not real-component evidence.
- [Initial standalone real Express result](2026-11-06-cli-0510-express-initial.md): FAIL; no blind rerun.
- [Subsequent real Express result and test-clock correction](2026-11-06-terminal-expiry-observation-budget.md):
  the second full report remains FAIL (177 PASS, one FAIL, eight SKIP); the isolated complete standard
  case then passed with actual waited exit 0 and independent typed absence for both owned IDs.
  The 37 pure image/expiry cases and lint also pass; all 697 product dist files remain unchanged.
- [Real local HTTP component](2026-11-06-gateway-real-http-component.md): one full `applyPlan` case
  uses two actual TCP origins and native probe/fetch/parse/delays, checking candidate/stable retries,
  persisted phases and hook/authentication/timer order. Its isolated old-line control fails as expected;
  the owning checkout's selected component passes. FC/state/hook control fixtures are not cloud evidence.

The five remaining optional cases require three temporary real filesystem mounts, a live local
OpenSandbox server, or the original SDK user-doc fixture. None is reported as passed.

## Results

Wrong/missing/null/array/nonstring bodies can precede an exact revision. Persistent wrong health still
fails at the original deadline or 30-read cap. Real fetch JSON parsing and AbortSignal budget narrowing
are exercised. HTTP 401/403/500 and transport failures remain fatal, and accepted temporary credentials
still stop publication immediately. Static full-message assertions withhold private body/revision labels.

## Cleanup

Local fixtures remove their owned directories. The standalone Express run independently confirmed
its owned sandbox/template absence. Its two image entries remain explicitly retained/manual in the
unchanged private journal; the initial image projection incorrectly selected zero rows. A separate
fixed-resource recovery removed their two exact tags and independently confirmed absence at
15:06:28Z, without deleting the generic repository. The later one-sandbox expiry observation also
confirmed sandbox/process absence. See the separate record for actual hashes and scope; the original
FAIL is unchanged.

## Problems found

The first real failing HTTP 200 body is unavailable. Route propagation or an old alias is an unverified
hypothesis. A temporary timer probe showed that this Vitest setup does not advance Node timers/promises;
that probe was removed. Final regressions use real bounded delays with a controlled Date.now clock.
The existing early-error journal selector only recognized correlations starting with the workflow alias,
while images use exact alias tags on the recipe repository. Image-only recovery now reads these journals
independently; it does not broaden the existing compute cleanup selector.

## Not verified

Final exact-head repository gates, managed public deployment with this patch, five-platform release
and fresh public npm installation are pending. Real Express coverage is scoped across the original
177 passing cases and the corrected selected standard case; eight conditional cases remain skipped.
Neither earlier complete-run failure is rewritten as success. CLI 0.5.9's failed receipt remains
historical and is not marked ready or replayed.
