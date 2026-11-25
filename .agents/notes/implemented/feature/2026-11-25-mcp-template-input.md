# Decision: Remove the misleading MCP injection toggle

Status: implemented

## Problem

The public MCP template tool accepted `envd_inject=false`, but the Express mapper
omits `buildConfig` for false. Omission does not enforce a disabled cloud policy.
The user requested removal of ineffective and misleading public controls.
Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/283.

## Decision

Remove the input from the strict MCP schema. Reject both obsolete explicit values
before reading credentials or contacting the Provider. Preserve the prior default
preparation request internally. Keep native Provider operations separately scoped;
this does not declare envd-free Sandbox startup or change platform defaults.

## API Design

`submit_template_build` retains explicit Team, name, image and supported sizing and
startup fields. Callers must remove `envd_inject`; there is no silent compatibility
alias. Tools discovery and English/Chinese guidance use the same field list.

## Alternatives considered

- Document false as a disable switch: unsupported by the actual mapper.
- Silently ignore explicit values: hides incorrect client assumptions.
- Delete native Provider configuration: unnecessary for this high-level tool fix.

## Dependencies

Existing Express adapter and strict Zod schemas; no new dependencies.

## Test Strategy

Both retired booleans fail before configuration/list/create. The normal submission
still uses its prior preparation behavior. Run compiled real HTTP initialization,
discovery and invalid tools/call, plus scoped tests, CI and repository health.

## Acceptance criteria

- Discovery omits the retired field; explicit true/false calls fail locally.
- Default behavior remains; no new cloud policy is inferred from omission.
- Independent review and required CI pass, with bilingual guidance and evidence.

## Evidence

The parent independently challenged whether false is transmitted; inspection
confirmed the truthy-only mapper. A second repository owner reviews consumer
differences before paired release. See [record](../../../evidence/verify/2026-11-25-mcp-template-input.md).
