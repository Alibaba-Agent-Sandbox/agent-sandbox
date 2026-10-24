# Verification: generated Express workdir ownership

- Date: 2026-10-24
- Change: CLI 0.4.13 candidate; [#132](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/132)
- Result: PASS for the real-cloud correction, fresh generation and full CLI E2E.
  Local wire-level suite remains environment-blocked; latest-head remote CI is required before merge.
- Environment: Node 22.22.2, Python 3.13.13, public client/server 0.3.1a2 for the
  independent comparison, Express cn-hangzhou generation 2, base v0.0.49.
  Credentials were injected privately; no credential values are recorded.

## What was verified
Two uniquely named templates shared the same source and dependencies. Steps were
USER root, install server, write commands.py, WORKDIR/chown in opposite orders,
record final metadata, USER user. Each chown RUN recorded directory/file ownership
immediately after chown; the later RUN recorded it again before runtime.

| Order | After chown | Final build directory | Runtime directory | Actual write/read/delete |
| --- | --- | --- | --- | --- |
| chown, WORKDIR | UID 1000, 0755 | UID 0, 0755 | UID 0, 0755 | Permission denied |
| WORKDIR, chown | UID 1000, 0755 | UID 1000, 0755 | UID 1000, 0755 | Pass |

Both runtimes used UID 1000; commands.py retained UID 1000/0644 and add(3,4)
returned 7 in both. The comparison isolates the observed ownership change to the
Express WORKDIR boundary; it does not claim knowledge of the provider's internal
implementation or generalize to other providers/Dockerfile builds.

## Commands run
- `npm ci` from the committed lockfile.
- `npx vitest run tests/test_agent/test_template_guide.test.ts`: 17 passed, 6 optional
  server SDK checks skipped before the pinned SDK fixture was supplied.
- `make ci`: initial run exposed a stale provider fixture, expected version-snapshot
  update, and intercepted local-network tests. A second run used CI's exact
  provider/SDK revisions and the new historical version snapshot.
- Second full test run: 4303 passed, 20 failed, 2 skipped. Local network interception
  returns HTTP 501 (`project network audit disabled`) or rewrites deliberately
  malformed responses/handshakes. These failures are not marked as passes, and
  transport assertions were not relaxed. Required clean remote CI is still pending.
- Local typecheck, lint and build completed before the full-test failures.
- Real template deploy/readiness, sandbox create, independent SDK metadata and
  write/read/delete, application add, exact-ID cleanup/readback executed for both orders.

## Fresh generation and complete E2E
- Real model qwen3.8-max, CLI 0.4.13 installed candidate, original add prompt, 1200-second
  generation budget and unchanged 600-second build budget. The generated manifest uses
  WORKDIR, final py_compile/chown, USER user without manual edits.
- The generated README distinguishes intended configuration from runtime verification.
  Its exact documented shell check passed with uid=1000 and WRITABLE. The repository
  Node probe independently observed directory UID/GID 1000, mode 0755, successful
  write/read/delete and temporary-directory removal. No chmod/chown was applied at runtime.
- The existing add application experiment passed all 50 assertions, covering SDK/HTTP
  calls, CLI lifecycle, files, process, terminal and system operations. Its owned
  sandbox and template both have confirmed absence after cleanup.
- `ABX_BIN=<isolated-installed-cli> npm run e2e -- --json <report> --markdown <report>`:
  176 passed, 8 explicit opt-in skips, zero failures, 317.94 seconds. The leak check
  passed: two tracked suite sandboxes, zero unconfirmed IDs or unresolved attempts.
  The fixture template was deleted and TemplateNotFound confirmed. Opt-in management
  writes, unsupported volume status mutation and Docker/ACR deployment were skipped;
  the scoped steps build was verified independently above.
- The packed and freshly installed 0.4.13 candidate passed `check-release-artifact.mjs`,
  including the actual terminal menu, help, JSON output and notices.

## Cleanup
Both comparison sandboxes returned typed SandboxNotFoundError after deletion; both
templates returned TemplateNotFound after deletion. Initial harness attempts exposed
registration-before-READY and status-shape mistakes; their templates were deleted.
The first full CLI suite was invalidated by concurrently rebuilding its dist entry;
it failed before loading the CLI during the create attempts. Its template cleanup
was recovered with the unchanged public executable and verified independently.
The rerun used an isolated installed tarball so builds could not remove its entry.

## Not verified
Required latest-head remote CI and release publication are checked separately on
[PR #133](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/133).
Binary/npm publication and website distribution must be checked after merge/tagging.
[Issue #131](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/131) is deferred.
