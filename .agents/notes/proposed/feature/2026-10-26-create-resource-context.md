# Decision: bind resource verification and rollback to the exact creation context
Status: proposed

## Problem

[Issue 185](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/185) requires resource requirements to be verified before MCP reports success. Independent review found that the first implementation's manager-level lookup reloaded global connection settings. A sandbox created with a different region or provider options could be rejected incorrectly, and another endpoint's HTTP404 could falsely confirm cleanup. An intervening shutdown/cache replacement could also make ID-based rollback operate on a different handle.

## Decision

At successful creation, capture the actual Provider factory, raw new ID and a deep snapshot of the complete resolved LayeredConfig. Bind an internal fresh metadata reader to the new handle. Each read constructs separate infrastructure from a fresh copy of that snapshot and closes it. Only not-found from the resource query itself proves absence; configuration/factory/close errors remain unknown. No fallback reloads process defaults.

Bind rollback to the exact returned new handle. Remove session bookkeeping only when its entry still has that handle's identity. Even when the kill response fails, independently read back through the frozen connection context. Keep the provider-qualified recovery identity when cleanup is uncertain.

## API Design

An optional internal SandboxInit reader and Sandbox `_createdMetadataReader` closure carry no serialized configuration or credentials. `verifyCreatedResources` accepts observation/rollback closures instead of looking up a sandbox through manager defaults. `SandboxManager.rollbackCreatedSandbox` kills its captured handle and guards local removal by identity. No public command or tool input changes. The error response adds `recovery_sandbox_id` when cleanup is unconfirmed.

## Alternatives considered

- Copy TransportConfig alone: rejected because it omits provider-specific options.
- Query or kill by qualified ID with global defaults: rejected because identity alone does not preserve endpoint/region credentials.
- Treat any HTTP404 as deletion: rejected because setup or close failures do not observe resource absence.

## Dependencies

Existing Provider.buildInfra, LayeredConfig, sandbox metadata protocol and typed not-found errors. No additional dependency or endpoint.

## Test Strategy

Preserve two before-fix failures, exercise full-context deep-copy isolation, query/setup/close error phases, failed-delete reconciliation, absent/replaced cache entries and actual MCP create wiring. Re-run affected API/MCP suites, typecheck/build/lint, the maintained real STDIO lifecycle fixture and an actual mismatching create with independent HTTP404.

## Acceptance criteria

- First verification and cleanup query preserve the actual creation context.
- Only the newly returned handle can be rolled back; replacements and borrowed resources are untouched.
- Unknown context remains unverified, with a qualified recovery handle and no provider exception text.
- Actual cloud success/mismatch and cleanup are separately recorded; second-region deployment and whole-repository CI are not inferred from local routing tests.

## Evidence

[Verification](../../../evidence/verify/2026-10-26-create-resource-context.md). Shared CI/publication is coordinated in the owning pull request.
