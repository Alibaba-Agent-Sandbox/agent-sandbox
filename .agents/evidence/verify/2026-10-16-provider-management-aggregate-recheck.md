# Verification: completed provider management aggregate recheck

- Date: 2026-10-16.
- Result: PARTIAL; local aggregate fails and real storage/write acceptance remains blocked.
- Product/source under test: `bf29321c36f1369acdb7202ac7e87f00b66b2236` (same product source as `796252e`).
- Issue/PR: [CLI #30](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/30),
  [draft PR #35](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/35).
- Environment: Linux, Node 22.22.2, npm 10.9.4, HTTP/HTTPS proxy configuration, no Docker binary.
  No cloud credentials were supplied to this aggregate or the baseline reproduction.

## Commands and results

`make ci` used the existing npm 10 wrapper on PATH, `ABX_SERVER_SDK_SRC` pointing to the
accepted server source and `ABX_AWESOME_PROVIDERS` pointing to the existing catalog checkout.
The full Make command returned **exit 2**, with its unit-test phase returning exit 1.
This run completed; it was not interrupted.

| Stage | Result | Evidence |
| --- | --- | --- |
| Hygiene | PASS | No local paths or credential-like findings. |
| TypeScript | PASS | `npm run typecheck`. |
| ESLint | PASS with warnings | Zero errors, 221 existing warnings. |
| Production build | PASS | `npm run build`. |
| Full unit phase | FAIL | **3919 passed, 37 failed, 2 skipped**, 160 files (147 pass / 13 fail), 455.27 seconds. |
| Parity and distribution stages | NOT RUN | Make stopped at the failed unit phase. |

## Failure review and baseline reproduction

Twenty-six cases match the previously recorded original-checkout baseline: Docker-dependent
template paths, HTTP/WebSocket/proxy and TLS response expectations, MCP oracle/header behavior,
archive directory modes and Node color warnings. The two catalog-plugin cases reproduce the
previously recorded loopback envd HTTP 501 behavior. Neither group was suppressed or relabeled
as a pass.

The explicit catalog path also enables engine and CubeSandbox suites that were skipped without
that prerequisite. Nine failures in those two files expose loopback HTTP 501 or resulting HTTP
500 errors. To check whether the new provider-command code caused them, the following ran in
the original checkout at `c269603177ffa7a4fd5b6b7cd43aca1b57b2bad1`, which has no provider-command
implementation. Its source/tests had no uncommitted diff; unrelated contributor documentation
was preserved.

```text
ABX_SERVER_SDK_SRC=<server source> ABX_AWESOME_PROVIDERS=<catalog source> \
  node node_modules/vitest/vitest.mjs run \
  tests/test_engine/test_engine.test.ts \
  tests/test_providers/test_cubesandbox_provider.test.ts --reporter=dot
```

That baseline returned **exit 1: 9 failed / 13 passed**, 36.42 seconds. The same five engine
and four CubeSandbox cases fail; direct RPC failures contain the environment-generated HTTP
501 denial and the wrapper assertions see HTTP 500. This is evidence of baseline reproduction,
not permission to bypass the network layer or proof that local aggregate acceptance passed.

## Remote and product gates

Every check on `bf29321` passed: [CLI CI](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/38857037637)
and [Markdown links](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/38857037671),
six total, including Node 20/22 tests/parity, typecheck/lint/hygiene, package build and installer.
All nine checks on Python `ec595c8` also passed:
[Python CI](https://github.com/Alibaba-Agent-Sandbox/python-sdk/actions/runs/38857058756).
These are checked exact-head results, not claims about a subsequent evidence-only commit.

The [independent recheck](2026-10-16-provider-management-recheck.md) records 323 related local
CLI tests, 206 related Python tests, both healthy repositories and actual cloud reads. It also
records missing Volume invitation/storage/role/same-Team-key and isolated Team/quota plan/resource
configuration. No additional cloud writes occurred here; there was no cloud resource to clean up.
Domain automation still requires a verified callable API, tracked in
[CLI #32](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/32).

Both PRs remain draft and unmerged. All failures, skips and unrun stages remain visible; no gate
or test expectation was weakened. Real mount/read/write/cleanup acceptance and the complete local
aggregate requirement remain unmet despite the successful remote matrix.
