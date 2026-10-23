# Decision: Align launch documentation with OpenSandbox acceptance

Status: implemented

## Problem

The launch guide still says every third-party provider is Beta, conflicting with the maintainer’s acceptance of the verified OpenSandbox Docker scope.

## Decision

Update English and Chinese guide paragraphs and changelog to reference provider-owned acceptance scope. E2B/Cube/cluster remain Beta. Per-template coverage stays independent. No CLI code, package version or cloud behavior changes.

Implementation is prepared locally. Required current-head CI and public delivery are pending at this capture; this note does not establish publication or a passed native run.

## API Design

N/A — this decision does not involve API changes.

## Alternatives considered

Keep blanket Beta text or hide every status: this would discard the maintainer’s accepted scope or obscure the remaining Beta providers. Promoting untested backends or treating provider acceptance as per-template coverage would overstate evidence.

## Dependencies

Provider-owned acceptance: https://github.com/Alibaba-Agent-Sandbox/awesome-providers/issues/21 .

Issue: https://github.com/Alibaba-Agent-Sandbox/awesome-providers/issues/21

## Test Strategy

Document/link/record health and hygiene; normal required CI. No unrelated cloud test or new CLI binary release for prose.

## Acceptance criteria

Both language guides describe accepted OpenSandbox Docker scope and independent Beta/per-template status accurately.

## Evidence

[Verification](../../../evidence/verify/2026-10-23-opensandbox-maturity.md).
