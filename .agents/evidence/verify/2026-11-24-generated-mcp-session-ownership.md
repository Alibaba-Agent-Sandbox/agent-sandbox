# Verification: Generated HTTP MCP session ownership

- Date: 2026-11-24
- Change: [CLI #262](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/262)
- Result: PARTIAL
- Binary / package under test: CLI source at main `57c7632` with the scoped generator change and published Python 0.4.0a6 and 0.4.0a7 packages
- Environment: Linux, Node 22, Python 3.13 and isolated loopback for the local
  probes. A separate ownership run used a configured Express account with private
  credentials.

## What was verified

CLI main includes the prior STDIO and local HTTP verification. The generated
HTTP app has a separate Python runtime pin. The same generated ASGI source
and controlled provider handles allowed an artifact-level release comparison.

## Commands run

- `npm ci --no-audit --no-fund` and `npm run build`.
- `node dist/bin/abx.js template init <artifact> --template mcp --yes`.
- `uv pip install --python <venv-python> --default-index https://pypi.org/simple 'agent-sandbox-client[mcp]==0.4.0a7'`.
- `node scripts/verify-mcp-artifact.mjs --python <venv-python> --artifact <artifact> --output <report>` inside a fresh user/network namespace with loopback enabled.
- `python tests/fixtures/agent/mcp_ownership_probe.py <baseline-artifact>` using the published 0.4.0a6 pair as the negative control and the 0.4.0a7 pair for the same generated application.
- Focused Vitest generation, ownership, STDIO and HTTP suites in an isolated loopback namespace.
- `python <ownership-e2e>` against the generated ASGI app with published 0.4.0a7
  packages and the real Express provider. The harness used `httpx.ASGITransport`
  for MCP request/response and required an independent provider lookup after
  cleanup.
- `npm run typecheck` and targeted ESLint for the edited TypeScript and Script files.

## Results

| Scenario | Result | Notes |
| --- | --- | --- |
| Published a6 negative control | FAIL expected | Legitimate read through a borrowed handle succeeded. Session DELETE returned 200 and attempted provider deletion of that handle. The new regression rejected it. |
| Same ASGI source on the published a7 pair | PASS | The same operation closed the borrowed handle once with zero delete calls. The owning fixture was still live after the borrowing session ended. Its owning session produced exactly one delete. |
| Current CLI-generated a7 HTTP executable | PASS | Nine actual loopback HTTP checks cover Bearer 401, initialization, catalog, distinct session IDs, termination, 404 and continued service to the second session. The Uvicorn process stopped. |
| Current CLI-generated a7 ownership fixture | PASS | Independent defaults, owned delete, borrowed close only. Fixture supplies the provider handles. |
| Generated a7 MCP and real Express | PASS | Session A created a Sandbox and wrote a file. Session B read that file by explicit Sandbox ID, then ended. A executed a command and observed `owner-alive` with exit 0. Ending A released its owned sandbox. An independent provider lookup returned typed NotFound. |
| Scoped CLI unit suites | PASS | 118 tests in nine files. |

## Cleanup

The local generated-artifact verifier stopped its owned server. Provider-handle
fixtures performed zero cloud operations. The separate Express run created one
owned sandbox, observed it survive the borrowing session's close and independently
confirmed its absence after the owner closed.

## Problems found

Successful protocol termination establishes that the session was invalidated.
It alone cannot establish successful deletion of every owned cloud sandbox.
Idle expiration is currently checked on requests. Both behaviors are described
in the updated user guidance. They require a separate reliability design and
are outside the pin correction.

## Not verified

The repository-wide suite and final PR gates are separate. The real Express run
used in-process ASGI transport. Docker packaging, a publicly hosted HTTP endpoint,
multi-replica routing, managed multi-tenant operation and migration to MCP
2026-07-28 are outside this acceptance.
