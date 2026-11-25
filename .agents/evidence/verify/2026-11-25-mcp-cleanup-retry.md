# MCP cleanup retry verification — 2026-11-25

## Scope and baseline

CLI baseline `b095ab0001f40f1f148e0552d0bdbc378eae11fd`.
[Issue 278](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/278).
The original SessionStore removed sessions before shutdown and SandboxManager removed
all handles before attempting deletion, then swallowed failures. A bounded local probe
returned destroyed=true with a throwing owned kill and no remaining session/handle.

## Review

The implementation agent and an independent workflow reviewer challenged late admitted
creation, borrowed resource ownership, concurrent DELETE/expiry, partial failure and
lock ordering. The second review identified idle clients unable to retry explicitly;
cleanup now retries on later requests after the configured session TTL, with no timer
or new tuning parameter. Server close failure now settles both completion promises.

## Verification

- Lockfile install, TypeScript check and build passed.
- Initial focused MCP cleanup/lifecycle/HTTP set: 72 passed, including seven new tests.
- Initial full agent subset: 854 passed, 6 skipped, 2 failed. Both failures assert raw
  HTTP header order for empty notification/307 responses. The unchanged MCP baseline
  reproduced exactly the same two failures (13 other wire tests passed); no production
  or test assertion was changed to hide this baseline condition.
- A real local HTTP server over a temporary Unix socket exercised 503 after injected
  owned-handle deletion failure, 409 while closing, retry DELETE 200 and later 404.
  The backend failure in this test is a test double, not a cloud failure injection.
- A separate real Express run used the built CLI HTTP server over a Unix socket:
  missing auth 401, authenticated initialize, tools discovery, base sandbox creation
  with a 120-second lifetime, actual `run_command`, DELETE 200, independent native
  NotFound and rejected deleted Session. All eight assertions passed. No fallback
  cleanup was needed. The exact owned sandbox was independently absent. No templates,
  images, databases or FC deployments were created by this run.

- Final new cleanup regression file: 8 passed, including listener close failure settlement.
- `npm run typecheck`, scoped ESLint and repository health passed (105 pass, 11 existing warnings, 0 fail).
- Reproducible real-cloud harness: `npm run build` then
  `node e2e/mcp-http-cleanup-acceptance.mjs`, with existing credentials supplied only
  through child-process environment. This is opt-in and creates one owned base sandbox.

Full CI results and PR status are appended as they complete.

## Boundaries

The real cloud journey proves the ordinary cleanup route, not a live cloud failure
or complete MCP interoperability matrix. Recovery records remain process-local; full
active-tool drain and process-restart durability are not implemented by this correction.
Borrowed handles are closed rather than remotely deleted. Existing Provider kill
acknowledgements retain their meaning; unknown failures do not prove absence.

## Second-round corrections

Independent review found concurrent borrowed connections could overwrite an owned
handle. The CLI now preserves the owned handle and closes duplicate borrowed clients,
retaining failed duplicate closes for retry. Source tracing also found actual
`Sandbox.kill()` closed its client in `finally` even after failed remote deletion.
The corrected implementation preserves that transport on failure and separately tracks
acknowledged remote deletion and completed local cleanup. Real Sandbox class tests
exercise a transport that refuses operations after close; retries succeed without
repeating an already acknowledged remote delete.

[Issue 279](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/279) covers
explicit MCP protocol header validation. Origin and auth precede the version check;
invalid/unsupported headers return 400 before cleanup or dispatch. Absent headers keep
existing negotiated-session behavior. Source: the official
[MCP 2025-06-18 transport specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).
This check alone is not a claim of complete MCP conformance.

## Aggregate runs

The first `make ci` run completed with 4,577 passed, 61 skipped and 14 failed tests.
It overlapped a later listener-completion source/test edit, so that new listener result
is not a stable-source verification. The stable focused rerun passed. Other failures
were shared-loopback transport cases, the two baseline header-order assertions and the
pre-existing missing-token fixture corrected separately in
[PR 277](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/277).
A separate parity coverage run reported 4,601 passed, 61 skipped and 12 failed tests
in those remaining categories. The coverage tool exits successfully despite underlying
test failures; it is not recorded as a fully passing test run. Package dry-run validation
passed. A final stable-source isolated-network run is recorded separately when complete.

Final scoped run after duplicate-handle, native-client and protocol corrections:
155 tests passed across the cleanup, Sandbox API, ownership-race, lifecycle and HTTP suites.

## Stable isolated-network run

The final source run under an isolated user/network namespace completed with 4,590
passed, 63 skipped and two failures. All MCP and Sandbox API tests passed, including
the earlier raw-header-order cases. The remaining failures were the older missing-token
fixture corrected in PR 277 and a DNS-specific transport expectation: without an
external resolver the isolated namespace returned temporary DNS failure instead of
NXDOMAIN. Neither result was converted into a passing assertion. The original shared-host
failures remain above. The focused final run and real cloud journey remain separate scopes.

## Current-main integration

Merged current main `c9a068cbdd2bb00cfae2917f50e3f31ea0bfcb9d` (PR 277) through a
normal merge, preserving both changelog entries. This supplies the independent
missing-token fixture correction. CLI MCP changes are tracked in
[PR 280](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/280); source merge,
CI completion and release remain separate statuses. No additional cloud creation was
needed for the documentation and main integration changes.

The merged-source focused run passed 212 tests across six files, including the updated
source-template fixture. TypeScript and the full build passed again. Both independent
reviewers accepted the cleanup ownership, cancellation/late-handle, protocol guard and
transport retry changes. The accepted
[decision](../../notes/implemented/architecture/2026-11-25-mcp-cleanup-retry.md) is
implemented in source; remote CI and release status are still tracked independently.
