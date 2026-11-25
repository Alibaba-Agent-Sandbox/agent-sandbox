# Verification: CLI 0.6.0-alpha.2 preparation

- Date: 2026-11-25
- Result: PARTIAL — source preparation; public publication remains pending.
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/282.
- Base: merged PR 280, `4454d154c9cd42ee26170a8dcc22ed688ca283aa`.

## Scope

Merged OpenAPI invocation, verified credential binding, deployment presentation and
MCP cleanup/protocol behavior are delivered together. Native resource/empty-Sandbox
and managed bridge drafts are excluded. The additional MCP template-input fix is
tracked in PR 284 and must merge normally before the final release source.

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

## Pending final gates

Wait for public paired Python 0.5.0a1 before pinning generated server/client
requirements. Rebuild and verify the exact final npm artifact, generated MCP HTTP,
public server wheel image and normal CI. After reviewed merge, run five-platform
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
