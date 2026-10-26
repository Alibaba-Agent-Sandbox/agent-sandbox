# Decision: verify explicit sandbox resources before MCP create succeeds
Status: proposed

## Problem

Live Express acceptance returned a running sandbox after CPU 1 / memory 1024 was requested, but a separate metadata read showed template defaults CPU 2 / memory 2048. A returned ID did not prove the user's resource requirement was met.

## Decision

For MCP create calls with explicit CPU or memory, independently observe only the newly created sandbox. Matching values allow the existing successful response. A mismatch or unknown value yields a structured resource-configuration error, rolls back only that new resource, and independently checks absence. Return its recovery ID and cleanup verification so an uncertain cleanup remains actionable. Select or build a matching-resource template for backends whose runtime resources are template-defined.

## API Design

`verifyCreatedResources(manager, id, {cpu?, memory?}): Promise<JsonObject | null>` is an agent-layer helper. The MCP error includes `category: resource_configuration`, requested/observed resources, `verified: false`, `sandbox_id` and `cleanup_verified`. No explicit resource requirement preserves the previous create path. Public Node/Python client create semantics are unchanged.

## Alternatives considered

- Trust create acknowledgement: rejected by the observed cloud mismatch.
- Report success with an explanatory note: rejected because the required specification was not delivered.
- Invent backend resource controls: rejected; the matching-template workflow was tested instead.

## Dependencies

Existing sandbox observation and exact-ID deletion methods, typed not-found errors and MCP error handling. No new package or backend endpoint.

## Implementation

New `src/agent/create_resources.ts`, integrated into `src/agent/tools.ts`; focused regressions and existing lifecycle forwarding fixture updated. Task workflow references and English/Chinese MCP guidance describe rollback and matching-template behavior. The maintained real STDIO fixture uses configurable CPU/memory expectations, independently checks both values and parses qualified references for metadata comparison.

## Verification

[Live evidence](../../../evidence/verify/2026-10-26-cli-live-resource-verification.md) records original failure, real post-fix rollback/absence, matching-resource template acceptance, files, durable tasks, cancellation, errors, client installation and three parallel environments. Focused tests 36 passed, typecheck and build passed. Full-repository and remote gates remain the coordinating task's responsibility. This record remains proposed until accepted and merged.

Maintained [STDIO fixture verification](../../../evidence/verify/2026-10-26-mcp-lifecycle-fixture.md) passed 15 real checks after the coordinating build. [Explicit Team/region verification](../../../evidence/verify/2026-10-26-explicit-team-region.md) used a short-lived key bound to the selected existing Team, confirmed runtime effects and revoked both test keys.
