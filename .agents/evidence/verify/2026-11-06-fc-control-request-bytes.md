# Verification: FC control request bytes and drained-ledger bootstrap

- Date: 2026-11-06
- Scope: continued CLI PR235; unpublished 0.5.9 candidate.
- Result: PARTIAL — actual serializer regressions passed; complete focused/build/package checks in progress.

## Original observed failure

The integration owner reported all three real FC functions created and verified before bootstrap
failed with ERR_INVALID_ARG_TYPE in Darabonba Stream Buffer.concat. The failed apply receipt remains
executionMayHaveStarted=true. No replay or remote-absence claim is derived from this local crash.
The regression executes the old string stream in an isolated Node subprocess and confirms exit 1,
ERR_INVALID_ARG_TYPE and Readable.onEnd/Function.concat; no cloud request is made by this regression.

## Actual official SDK regression

The positive test invokes production createFcTransport.invokeControl through the locked generated FC
request model, OpenAPI signing/serialization and Darabonba readAsBytes. Only httpx.request, the native
HTTP network boundary, is replaced. Unicode envelope bytes, original HMAC payload, ACS content hash,
qualifier, Sync/None headers, exactly one request and decoded response are checked. This test passed.
It is a real serializer component check, not real FC invocation or model acceptance.

Six additional cases pass a native HTTP 200 error object through the actual official SDK and require
the same static error for errorType, ErrorType, errorMessage, ErrorMessage, error and Error. Raw native
message content never reaches activity. This is an explicit error-envelope guard, not complete
validation of arbitrary response fields.

## Admission fence

A global bootstrap status must explicitly report draining=false. True or absent booleans retain all
three native functions with requires_reconcile, no candidate trigger/alias and only a read-only status
operation. The saved database fence is never reset. Bilingual usage explains new application identity
or fresh database after destruction, and previous-receipt updates.

## Verification and remaining gates

Focused suite, strict types, build, immutable installed package, full local and remote CI results are
recorded as they complete. The integration owner performs new-candidate status/drain/destroy of the
existing failed receipt and any later fresh deployment. No cloud mutation is performed by this fix.
Earlier v2/v3 packages and receipts are unchanged.
