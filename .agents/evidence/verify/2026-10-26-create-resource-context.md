# Verification: exact creation context for MCP resource validation

Result: PASS for the scoped correction. Whole-repository CI and publication remain separate gates.

[Decision](../../notes/proposed/feature/2026-10-26-create-resource-context.md) · [Issue 185](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/185) · [Tested source hashes](2026-10-26-create-resource-context/tested-files.json).

## Reproduced failures before correction

- A regression supplied the newly created Shanghai resource's metadata reader while the manager default lookup returned not found. The previous helper ignored the reader, rejected matching resources and incorrectly returned `cleanup_verified: true`. One selected test failed before correction.
- A regression supplied the exact-created-handle rollback while the manager cache could disappear during observation. The previous helper ignored that binding and used ID lookup; the selected test failed because the captured rollback was never called.

These are deterministic routing/scheduling tests, not claims that an actual second regional deployment was exercised. No cloud backend was mocked in the later live acceptance.

## Corrected observable behavior

The API captures the actual Provider build factory, raw created ID and complete resolved LayeredConfig. Each fresh metadata request receives an independent deep copy, retaining endpoint, region, credentials and nested provider options. TransportConfig's smaller projection is not used to reconstruct this context. The agent helper has no manager/default-ID lookup path.

Only the resource query's typed not-found or HTTP404 can confirm absence. Initialization failures and close failures, including typed404 at either phase, remain unknown. A kill error still triggers independent readback. Rollback calls only the newly returned handle. Manager bookkeeping is removed only when the cached entry still has that handle's identity; both removed and replaced entries preserve unrelated resources. An uncertain result returns a provider-qualified recovery handle without private exception text.

## Checks actually executed

- Targeted API/MCP suites: 9 files, 229 tests PASS. This includes 18 focused creation-context/resource cases and affected sandbox, lifecycle, shutdown-race, tools, HTTP and STDIO behavior.
- `npm run typecheck`: PASS.
- Scoped ESLint: PASS with 0 errors and 18 existing warnings in the pre-existing large sandbox/manager files. New helper and test files have no lint errors.
- `npm run build`: PASS.
- `node e2e/mcp-lifecycle.mjs`: PASS, 15 actual CLI STDIO checks, exit0. The fresh observer accepted real base-template resources 2 CPU / 2048 MB; independent metadata, list visibility, TTL update, observer disconnect, files, command output42, exact deletion and final inventory absence also passed. [Result](2026-10-26-create-resource-context/stdio.json).
- Actual configured-region MCP `create_sandbox(timeout=120,cpu=3,memory=2304)` through the current server wrapper: PASS, 7 checks, exit0. Real base metadata returned 2 CPU / 2048 MB; MCP returned `isError: true`, preserved requested values and a provider-qualified ID, and confirmed rollback through its fresh bound observer. A separate runtime HTTP request also returned404. Only this newly created test resource was subject to cleanup. [Result and independent cleanup](2026-10-26-create-resource-context/mismatch.json).

## Independent SDK red-team review

The SDK's analogous correction in [Issue140](https://github.com/Alibaba-Agent-Sandbox/python-sdk/issues/140) was reviewed read-only after its final follow-up: first metadata and deletion use the captured new handle; local cleanup checks exact identity; readback uses the complete frozen TransportConfig. Only query-phase not-found confirms absence. Setup/close failures remain unknown with a qualified recovery identity, and MCP marks structured failures as errors. Independently ran its 13 resource tests: PASS. Existing canonical provider identities, closed-session registration guards and qualified background-task handles remain present. This is a review of those specific guards, not a substitute for SDK CI.

## Limits and cleanup

Actual cloud execution used the configured Express endpoint; cross-region routing isolation is verified with deterministic configuration/protocol tests, not a deployed second region. Base runtime overrides remain unsupported backend behavior and are correctly rejected, rather than claimed implemented. The maintained STDIO test's owned resource was deleted and absent from its final inventory; the separate mismatch resource independently returned HTTP404. No existing templates, borrowed sandboxes, Team settings or credentials were modified.
