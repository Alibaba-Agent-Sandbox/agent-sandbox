# Decision: Current resource E2E entry points

Status: proposed

## Problem

The named v1 resource migration left a generic scaffold scenario asserting spec5 and a Docker-failure scenario supplying an invalid retired manifest. The latter could fail before Docker and could not verify its advertised behavior. Current contributor examples also retained the removed deploy-to-instance command.

## Decision

Use actual named v1 scaffold assertions and explicit Sandbox creation examples. Keep original platform API payloads in the two native Steps checks, removing their unused retired YAML fixtures. Test Docker failure through the real candidate executable with valid resource input and a tiny Alpine RUN that exits 23. Resolve existing account/Team read-only, select an invalid publication host, and wrap the real Docker CLI to reject login/push and record whether the actual failing instruction ran. Inspect the new resource receipt rather than an obsolete journal shape.

## API Design

No product API is added. Tests consume `specVersion: 1`, `sandbox.agent.template.buildConfig`, explicit `sandbox create --template`, and the existing resource receipt. The failing Docker script accepts the same `ABX_BIN` executable selector and requires a running daemon plus existing AccessKeys for identity/Team reads.

## Alternatives considered

Keeping spec5 would test schema rejection instead of Docker diagnostics. Placeholder cloud credentials cannot reach Docker because the new path resolves account and Team first. Mocking a failing Docker process would not prove the actual instruction executed. No extra cloud template, function, database or Sandbox is needed.

## Dependencies

Uses the current named-resource executor, an existing authorized Alibaba Cloud identity, a running local Docker daemon and candidate CLI. The native Steps scenarios still require their separately documented real cloud prerequisites; removing unused files does not certify those scenarios.

## Test Strategy

Run the actual capability scaffold scenario and intentional Docker RUN failure. Require E7020, known-secret redaction, an observed failed build instruction, no publication attempt, and only a pending image intent. Check syntax and current bilingual examples. Retain the original diagnostic purpose while replacing obsolete schema and receipt assumptions.

## Acceptance criteria

Current scripts and examples use resource preparation or explicit instance creation as appropriate. Real Docker failure cannot pass due to schema rejection, missing daemon, image-pull failure or cloud-auth failure. Existing historical evidence remains unchanged.

## Evidence

See [verification](../../../evidence/verify/2026-11-13-resource-e2e-entrypoints.md). Parent owns the coordinated commit, full gates and remote delivery.
