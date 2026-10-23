# Decision: CLI recovery and scaffold command review

Status: proposed

## Problem

Shared AI errors still recommended removed Express create syntax; generated README deployment continued after failure and opened a terminal. The error-reporting proposal left event claims and uncoded diagnostics underspecified.

## Decision

Correct shared recovery hints, use explicit prompt generation and provider-owned scaffold instructions with interactive deployment gated before detached creation. Keep reporting design-only while specifying stable diagnostic codes, leased claims and accepted state, retry/conflict/crash behavior and analytical deduplication.

## API Design

CLI public command semantics are unchanged. Express examples use positional create plus --detach; other provider scaffolds use provider-qualified help. Proposed telemetry uses independent diagnostic_code and (installation_subject,event_id) state; no reporter setting or endpoint is implemented.

## Alternatives considered

Keeping --template perpetuates a real parser failure. Independent shell lines continue after failed deploy. A bare dedup reservation suppresses pre-output crashes. Free-form error messages risk secret disclosure.

## Dependencies

The existing pinned standard parser and template profiles. Companion harness correction: https://github.com/Alibaba-Agent-Sandbox/awesome-templates/issues/192. Reporting remains tracked at https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/107.

## Test Strategy

Exercise rendered suggestions through the executable parser and generated shell blocks through a real shell. Run relevant/full unit, lint, typecheck, build, health, provenance and CI checks. Verify real-cloud create/exec/owned cleanup separately; do not infer Docker/ACR acceptance or reporter deployment.

## Acceptance criteria

- [ ] Recovery/scaffold regressions pass.
- [ ] Required repository gates and real-component verification recorded.
- [ ] Bilingual guides/design and changelog match implemented scope.
- [ ] PR merged after checks; reporter implementation remains explicitly future work.

## Evidence

[Verification](../../../evidence/verify/2026-10-23-command-recovery-review.md). Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/109.
