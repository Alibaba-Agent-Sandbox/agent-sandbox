# Verification: CLI 0.6.0-alpha.2 preparation

- Date: 2026-11-25
- Result: PARTIAL — source preparation; public publication remains pending.
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/282.
- Base: merged PR 280, `4454d154c9cd42ee26170a8dcc22ed688ca283aa`.

## Scope

Merged OpenAPI invocation, verified credential binding, deployment presentation and
MCP cleanup/protocol behavior are delivered together. Native resource/empty-Sandbox
and managed bridge drafts are excluded. The additional MCP template-input fix is
merged normally in PR 284 at `78f633e9540b5e3a905e3be956237341b471d925` and is included through a normal merge.

## Local preparation checks

Locked `npm ci` and TypeScript build passed. A new version evidence batch and 86
CLI snapshot tests passed; prior batches were preserved. `npm pack` was installed
into a fresh prefix and the actual installed executable passed the full existing
release checker, including output/stdin help and duplicate-body preflight rejection.
The real PTY authentication cancellation check passed. This preliminary package
still has the old runtime pin and is not the final public release candidate.

Public `--bind` verifies the actual Provider target and is not an offline operation.
The installed artifact check therefore does not fake a network-free binding. Real
protected application invocation and its subprocess natural-argument checks remain
recorded in merged PR 277; actual MCP create/exec/delete is recorded in PR 280.

## Publication gates

The paired runtime and local artifact gates are recorded below. Public server-wheel
Docker and normal remote CI remain required. After reviewed merge, run five-platform
binary checks, publish as prerelease/non-latest through existing workflows, then
independently verify public npm installation and native checksum/download.

No cloud resource was created by this release preparation.

## Current command and consent documentation audit

A targeted scan found stale current authentication/permissions examples using
`sandbox list` and treating `--ci` as managed-key consent. Both languages now use
explicit Provider `api-key.prepare --yes` followed by `--ci list`; current help
acceptance was checked without calling a management API. Historical Provider design
records remain historical and point to current command/reference guides. Retired
template command labels in the current permissions table were corrected.

Current deployment guides no longer instruct users to hand off build/receipt files.
They use the already-supported automatic `deploy SOURCE --name` path. This is a
user-guide correction, not a claim that the older runtime build command became
pure or that pending native resource migration has shipped.

## Public paired-runtime prerequisite

Python prerelease `v0.5.0a1` identifies source
`8d9297f7d1a9adddf3710ddcaab914b9e35d3618`. Its existing publication workflow
[45597651893](https://github.com/Alibaba-Agent-Sandbox/python-sdk/actions/runs/45597651893)
passed. Independent owner verification downloaded all four public files with exact
metadata hashes, then tested fresh no-cache client-only HTTP, optional server
registration and a pip-less server inventory. Initial simple-index propagation
failures were preserved before the same installation command succeeded.

- Client wheel SHA-256: `8d5633797e164ba0cf4783b4245abc458d731233271de9e723bd5771f87d0b4f`.
- Server wheel SHA-256: `b5f91c42a3aec2a5336f73a9927c397e5cfd7b4a62b810bb53b37a8ac5faab90`.

The shared consumer pin and server-wheel checkout were changed only after that
public gate; generated MCP continues to require the client extra alone.

## Final pinned source checks

The final runtime pin passed TypeScript typecheck/build, 160 codegen/CLI evidence/
MCP-template tests and 8 generated MCP configuration tests. Full ESLint, hygiene
and repository health passed (105 passed, 11 registered historical warnings).

The actual generated MCP source was installed from its exact public requirements
into a fresh no-cache virtual environment. The verifier ran its real Uvicorn ASGI
server in an isolated local network namespace to avoid shared-host loopback
interference. All nine authentication/protocol/catalog/deletion assertions passed;
client version was 0.5.0a1 and the Server SDK distribution was absent. Three initial
connection-refused readiness polls preceded listening; the owned process stopped.
No cloud requests were made. [Raw safe result](2026-11-25-cli-060-alpha2-mcp-artifact.json).

The local host has no Docker executable, so the real public server-wheel Docker
check is delegated to the existing required CI job, not reported as locally run.

The final 0.5.0a1-pinned CLI tarball was repacked and installed into a second fresh
prefix. The complete actual-executable verifier and real PTY authentication
cancellation passed again. This proves the final local npm artifact, not public
registry publication or all standalone platforms.
