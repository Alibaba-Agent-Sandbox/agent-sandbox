# Verification: FC control request bytes and drained-ledger bootstrap

- Date: 2026-11-06
- Scope: continued CLI PR235; unpublished 0.5.9 candidate.
- Result: PASS for local component, full CI and installed artifact gates; remote CI and joint cloud recovery remain separate.

## Original observed failure

The integration owner reported all three real FC functions created and verified before bootstrap
failed with ERR_INVALID_ARG_TYPE in Darabonba Stream Buffer.concat. The failed apply receipt remains
executionMayHaveStarted=true. No replay or remote-absence claim is derived from this local crash.
The regression executes the old string stream in an isolated Node subprocess and confirms exit 1,
ERR_INVALID_ARG_TYPE and Readable.onEnd/Function.concat; no cloud request is made by this regression.

## Actual official SDK regression

The positive test invokes production createFcTransport.invokeControl through the locked generated FC
request model, OpenAPI signing/serialization and Darabonba readAsBytes. Only the declared
Darabonba doAction HTTP network boundary is replaced with its actual Response class wrapping a stream. Unicode envelope bytes, original HMAC payload, ACS content hash,
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

The full local make ci passed with the CI-pinned Python/provider fixtures: 4709 unit tests passed,
5 existing optional skips; the parity run passed 4735 with 5 optional skips. The ledger reports
907 passed, zero failed/skipped/missing, and 11 moved cases verified in Python. Strict types, ESLint,
hygiene, build and package-entry checks passed. Eleven newly related focused cases passed, with
58 unrelated cases deselected. Installed npm artifact checks passed, including actual version,
root/standard/native help, authentication-menu cancellation, one JSON result and complete notices.
The separate fourth immutable package has SHA256
c5573c9a30db2c5a5eb7afc5e576a8949869c012154316a4a9af4d82d94f2899 and consumer lock SHA256
28f13fc0c78fb3003db14301587cc5353e6d91b15ae773c7717c0b83ed342c9a.

The first independent repository-health check failed only because the test imported transitive
httpx directly. An independently reviewed test-only correction instead intercepts the declared
Darabonba doAction boundary after the exact same real serializer and ACS hash, avoiding a new
undeclared dependency. The repeated focused checks, strict types and repository health passed
(105 pass, 11 historical warnings, zero fail). Product source, manifests, dist and the frozen package
were unchanged by this test-only correction. The original string serializer negative remains intact.

The earlier state-pin regression initially lacked the newly required explicit draining boolean;
its fixture was corrected to the runtime's real false status without weakening its identity mismatch
assertion. Remote CI and root's real FC recovery are tracked separately. The integration owner performs new-candidate status/drain/destroy of the
existing failed receipt and any later fresh deployment. No cloud mutation is performed by this fix.
Earlier v2/v3 packages and receipts are unchanged.
