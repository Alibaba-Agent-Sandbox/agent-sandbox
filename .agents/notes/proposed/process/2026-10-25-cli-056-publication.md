# Decision: Record CLI 0.5.6 publication and independent public consumption

Status: proposed

## Problem

Current README and installation links still lead to a release-preparation checkpoint. GitHub/npm publication and later public-package verification must have their own record without rewriting earlier candidate results. The independently deployed website mirror may still serve an older release.

## Decision

Add dated publication evidence and sanitized independent public npm, Linux binary and actual application-error receipts. Link current bilingual README/installation status to this record, distinguish the website mirror checkpoint, and use the actual published GitHub assets in the versioned manual-download examples.

## API Design

N/A — this is documentation and evidence only. No runtime, API, package version, dependency, parser route or historical receipt changes.

## Alternatives considered

Rewriting the candidate record would erase its real preparation state and source identity. Calling the website default 0.5.6 before mirror promotion or calling five error controls five complete developer scenarios would overstate the verification.

## Dependencies

- https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/181
- https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/releases/tag/v0.5.6
- https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40236483898
- https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40236891035

## Test Strategy

Cross-check the existing release-owner receipts and actual public GitHub/npm metadata. Preserve their actual scope and omit machine-local executable paths. Run owner document/link/health/hygiene checks and applicable exact-head CI. Reuse the already completed public cloud proof without creating new resources for prose.

## Acceptance criteria

Current links show completed official publication; the six applicable source checks, immutable tag/artifacts and separate public-package observations are accurate. Website promotion, full matrices and prior local failures remain separate. No source/version change or new package release occurs; independent review and normal documentation merge complete.

## Evidence

- [Publication and public consumption](../../../evidence/verify/2026-10-25-cli-056-publication.md).
