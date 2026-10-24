# Decision: Separate provider operations and application interfaces

Status: proposed

## Problem

The active provider guide maps process execution to named application commands, attributes source-image preparation to Python, and treats EPP transport as proof that an application cannot be called. Its repeated feature table obscures actual consumer interfaces.

## Decision

Replace the large repeated mapping with six concrete task entries and existing command, workflow and launch links in both languages. Distinguish process execution, application HTTP, interpreters and PTY. Keep the application's endpoint/authentication requirements explicit. Preserve exec/rest/node support and clarify that an exec plugin can run a Python executable although kind=python manifests are not installable.

## API Design

N/A — documentation only; no runtime, manifest, package version or published artifact changes.

## Alternatives considered

Adding more capability/status categories would preserve the confusion. Inventing Python source preparation or rejecting all EPP applications contradicts the implemented paths. Existing detailed reference pages remain the source for complete operations.

## Dependencies

[Issue 145](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/145). Align with [provider guide correction](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/pull/33) and the Python provider guide. Runtime interfaces remain unchanged.

## Test Strategy

Compare current CLI registrations and Python application/endpoint APIs; check bilingual document links, repository health and hygiene; require normal PR CI and independent review. Follow the task's documentation-only scope: no unrelated cloud test or package release.

## Acceptance criteria

The guide names actual interfaces without inferring application availability from provider transport or generic feature names. Both translations, engineering records and changelog agree; required CI/review passes before merge.

## Evidence

[Verification](../../../evidence/verify/2026-10-24-provider-operation-boundaries.md).
