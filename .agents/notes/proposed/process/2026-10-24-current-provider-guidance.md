# Decision: Keep provider guidance aligned with delivered entry points

Status: proposed

## Problem

The bilingual provider guide still described CLI 0.3.0, unchanged 0.2.x behavior, universal rejection of non-Express template operations and provider support in every SDK. Those statements contradict delivered OpenSandbox preparation and the independent Node SDK's HTTP-only scope.

## Decision

Replace only these stale statements with the actual current division: selected-provider template managers/handlers and source launch, native FC/ACR ownership in Express, Node plugins hosted by the CLI, and Python consumption through the engine. Link the existing launch/workflow/install guides. Keep the correct statement that there is no standalone CLI URL command.

## API Design

N/A — documentation only. No executable, package version, tag or public protocol changes.

## Alternatives considered

Another generic support status would not explain the implemented path. Claiming every SDK supports the engine would invent integrations. Adding an unimplemented URL command to the guide was rejected after actual invocation failed.

## Dependencies

Delivered [CLI 0.4.16](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/releases/tag/v0.4.16), provider-owned preparation and [Node SDK source scope](https://github.com/Alibaba-Agent-Sandbox/nodejs-sdk). Tracking: [Issue 143](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/143).

## Test Strategy

Inspect actual template command routing and published command help, check bilingual local links, run repository health/hygiene and complete owner CI. Existing real proxy/source-launch receipts remain historical; prose does not need another cloud creation.

## Acceptance criteria

The active guide no longer contradicts delivered provider preparation or overclaims language-client integrations. Actual FC/ACR ownership and no-fallback rules remain explicit; both languages and required documentation checks pass.

## Evidence

[Verification](../../../evidence/verify/2026-10-24-current-provider-guidance.md).
