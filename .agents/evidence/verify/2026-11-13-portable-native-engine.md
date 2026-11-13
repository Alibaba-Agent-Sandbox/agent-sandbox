# Verification: Portable native engine

- Date: 2026-11-13
- Result: PASS for the local installed-npm and Linux x64 SEA scope. Remote CI is tracked separately on the PR.
- Scope: installed npm and actual Linux x64 SEA native parser/component packaging.

## Failure and review

A real pre-fix SEA passed version smoke but failed the release-artifact source-build
probe with an invalid native parser result. Two independent reviewers identified
the executable-vs-Node child mismatch and external package resolution. The adopted
[decision](../../notes/proposed/architecture/2026-11-13-portable-native-engine.md)
retains official dependency code and isolates only its delivery/runtime entry.

## Verified locally

- SDK interoperability: 132 related tests passed, one explicit environment skip;
  includes actual Node ESM and independent CJS constructors, signed loopback STS/FC
  requests and existing resource/receipt tests.
- Worker tests: 20 passed, including actual official parser/loader CJS bundles,
  dynamic filesystem component loading, original logger/result handling, fixed
  mode admission and refusal to overwrite files or symlinks.
- Actual rebuilt SEA: SHA-256
  `a26a807dcad906b07b00adeca9d5a95224d36612953ba87910f0a83cd45e151b`.
  The executable and reviewed FC3 package were copied outside the checkout. Its
  children used an empty PATH, isolated HOME and no NODE_PATH, NODE_OPTIONS,
  ABX_APP_NODE or real credentials.
- Native vars/env/file/dotenv values matched exactly. Published FC3 0.1.26 performed
  real loopback HTTP: existing function (two reads, zero creates), conflict (three
  requests, one create attempt), successful creation (four requests, one create).
  No update/delete requests occurred. FD4 delivered 49/41/28 structured events,
  FD3 held one result, stdout/stderr remained separate, and fixture credentials
  were absent from output. Owned subprocesses, server and temporary files were removed.
- The first probe incorrectly required `logCount` in error responses. That field
  is only returned on success; the corrected probe still requires nonempty, valid
  FD4 events for every scenario and the original conflict/HTTP assertions. No
  production behavior was changed to satisfy that mistaken assertion.
- Complete release-artifact checks passed with the SEA copied outside the checkout
  and no external Node on PATH, including the actual terminal cancellation flow.

The official FC3 archive was fetched again and matched SHA-256
`6b16e9d84392fde4e10c6982371066ba8d366be52e66c7929307a027d8546893`.
CI now verifies this identity before its independent native SEA probe.

## Limits

The loopback FC tests use the real published component and real HTTP transport,
with controlled responses; they are not additional cloud deployment. Existing
Express, native Steps, FC and Docker cloud evidence remains in the
[named-resource record](2026-11-13-named-resource-execution.md). This does not claim
Mac/Windows/ARM execution or new PostgreSQL-backed managed application acceptance.

## Final integration

The final complete Vitest/parity run passed 4,619 tests, zero failed and 55
conditionally pending. All 907 historical ledger entries passed and all 11 moved
SDK tests were verified against CI's pinned SDK commit. Final typecheck, full lint
(zero errors, 262 warnings), hygiene and repository health passed (105 passes,
11 registered historical warnings, zero failures).

An independent fresh npm build/pack/isolated install passed the complete actual
artifact script again after the SDK/worker changes. Tarball SHA-256:
`f8f2a4189847588d6f1bc5f3c78de0d96afc479f82af8a6cf6194f3779d5e635`.
The npm installer reported its existing blocked postinstall policy; installation
and every artifact assertion passed without changing that policy.

A read-only real-cloud identity/Team check also passed with the changed static
SDK imports. It created no cloud resource and printed no credentials or identities.
The added CI gate builds the real SEA, verifies the official component archive hash,
and runs both the release-artifact and relocated native-engine probes.
