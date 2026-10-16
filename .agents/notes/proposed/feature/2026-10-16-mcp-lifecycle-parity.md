# Decision: Safe MCP lifecycle parity in the CLI
Status: proposed

## Problem

The Python SDK exposes bounded account listing, metadata refresh and explicit TTL
updates through MCP. The CLI host still advertises only seven tools, so clients
cannot perform these operations through the CLI's STDIO or HTTP sessions.

## Decision

Add three tools to the shared handler table: `list_sandboxes`, `get_sandbox`, and
`set_sandbox_timeout`. Extend creation with existing provider, region, CPU and
memory controls. Reject unknown fields and invalid input types before SDK access.

List and metadata responses use a nine-field allowlist. Provider errors become
fixed safe categories; their original messages, URLs and suggestions are omitted.
An external ID uses direct `Sandbox.getInfoById` / `setTimeoutById` control-plane
dispatch, never provider connect/resume, with temporary infrastructure closed in `finally`,
without entering the session destruction or automatic-renewal sets. Managed TTL
updates replace the automatic renewal duration only after successful renewal and
only while the same handle remains registered.

## API Design

- `list_sandboxes({status?, limit?: 1..100, offset?: >=0, provider?, region?})`
  returns `{sandboxes, limit, offset}` without changing session state.
- `get_sandbox({sandbox_id?})` refreshes safe metadata without renewal.
- `set_sandbox_timeout({timeout: 1..86400, sandbox_id?})` returns
  `{success, sandbox_id, timeout}`.
- Get/set without an ID require an existing default; neither implicitly creates.
- `create_sandbox` accepts optional non-empty provider/region and positive integer
  CPU/memory (MB). Region maps to the existing core `provider_options.region`.
- Team/account selection is not exposed; authorized provider configuration governs
  visibility. List visibility can be eventually consistent.

## Alternatives considered

- **Use the execution get-or-create path** — rejected because inspection would
  create or renew instances and could adopt external resources for destruction.
- **Serialize SDK model dumps or raw errors** — rejected because those may contain
  access tokens, credential-bearing URLs, environment variables or user metadata.
- **Separate HTTP and STDIO implementations** — rejected because shared handlers
  keep validation, ownership and privacy boundaries consistent.

## Dependencies

Existing CLI SDK core lifecycle methods; no dependency or provider endpoint changes.
Python counterpart: https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/33.

## Test Strategy

Regression tests cover strict types, bounds, unsupported selectors, safe metadata,
provider error/log privacy, external client cleanup, managed TTL updates, and late
completion after shutdown. HTTP catalog and CLI golden evidence cover ten tools.
`e2e/mcp-lifecycle.mjs` starts two real CLI STDIO processes against the authorized
cloud, validates the lifecycle and execution/file roundtrips, then destroys only
its own sandbox and performs a readonly absence check.

## Acceptance criteria

- All three tools are advertised and callable through both shared transports.
- Invalid input never reaches SDK access; inspected external instances remain alive
  after the observing session ends.
- Only safe metadata and fixed provider failure categories leave lifecycle tools.
- Required local gates, bilingual docs, evidence and changelog are included.
- Mandatory failures remain visible and prevent claiming repository-wide completion.

## Evidence

See [verification](../../../evidence/verify/2026-10-16-mcp-lifecycle-parity.md).
The decision remains proposed until review and required gates pass.
