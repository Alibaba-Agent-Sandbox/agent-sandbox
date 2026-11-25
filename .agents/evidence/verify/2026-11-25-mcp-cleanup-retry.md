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
