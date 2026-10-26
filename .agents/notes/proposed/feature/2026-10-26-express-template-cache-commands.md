# Decision: Expose verified Express Template Cache commands
Status: proposed

## Problem

Owner tracking: [Issue186](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/186).

The existing bundled Provider has no Template Cache operation even though the actual selected account supports official cache create, describe, list and delete requests. A Skill could discuss startup acceleration but could not execute this management workflow through the shared CLI/Python engine contract.

## Decision

Register four explicit `provider-commands/1` operations in the Express Provider, implemented only in `template_cache_commands.ts` through the exact official `@alicloud/sandbox20260820@1.2.0` dependency. Load it lazily after input/authentication validation. Lock the API endpoint to the selected region, require explicit Team references, perform one SDK call without automatic retries and project only validated/redacted response fields.

## API Design

- `template-cache.create/get/delete`: required `team_id` and `template_id`.
- `template-cache.list`: required `team_id`; optional `template_id`, `status`, bounded `max_results` and opaque `next_token`; returns one page and a null terminal cursor.
- All return `{request_id, data}` with declared cache state/progress/image metadata. Create reports observed state without manufacturing readiness. Delete404 returns `deleted: false`.
- Create is a write/non-idempotent operation; delete is a delete/idempotent operation; generic host confirmation applies. Management uses AK/SK, not the sandbox API key. No new top-level command, MCP tool, typed Python method or WarmPool API is implied.

## Alternatives considered

- Route through the older FCSandbox SDK — rejected because its selected API does not expose the verified Template Cache contract.
- Add another provider switch in every consumer — rejected because the existing Provider catalog/engine already owns shared routing and consent.
- Automatically choose a Team/template, poll until ready or replay failed writes — rejected because those decisions can mutate an unintended resource or duplicate an ambiguous request.

## Dependencies

Exact production dependency `@alicloud/sandbox20260820@1.2.0`, the existing OpenAPI core dependency and selected Express AK/SK/region. Discovery requires none of these credentials and does not load the SDK. Source templates retain separate ownership and lifecycle.

## Test Strategy

Use official generated request classes with a private client-loader seam to verify exact fields, methods, endpoint/auth isolation, validation before I/O, command effects/confirmation, response scope/projection, actual status semantics, pagination, safe typed errors and no automatic retries. Run the permanent CLI acceptance scenario against a newly built task-owned generation-2 template, observe creating→ready, and independently verify deletion through the official SDK and exact inventory.

## Acceptance criteria

- Four commands are discoverable offline and use the shared Provider runner in both consumers.
- Invalid input, region, missing AK/SK and cancellation fail before SDK requests.
- Create does not report creating/pending as ready; missing metadata stays unknown.
- One-page opaque pagination and idempotent deletion preserve actual service semantics.
- Unit/CLI checks, real CRUD, independent cleanup, bilingual docs, engineering records and the repository's mandatory gates are recorded separately.

## Evidence

- [Verification](../../../evidence/verify/2026-10-26-express-template-cache-commands.md)
