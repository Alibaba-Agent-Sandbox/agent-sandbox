# Decision: Remove retired project compatibility

Status: implemented

## Problem
The maintainer states that the project has not formally released and requests removing old template management/API behavior and other project compatibility layers. Keeping aliases, alternate factories and fallback branches expands an API that is not meant to be supported.

## Decision
CLI template routing, canonical configuration, backend module ownership, method/stream aliases and provider-supplied addressing.
Keep a single current project contract. Do not add a migration mode or replacement aliases. Preserve historical engineering evidence and the current pinned upstream standard-client contract.

## API Design
Removed interfaces are unavailable. Current provider preparation uses `templates.build` and `prepareProject`; each owning provider retains its native implementation. This repository's exact changes are reviewable in its scoped branch.

## Alternatives considered
- Keep deprecated wrappers or document them as disabled: rejected by the maintainer's request.
- Rewrite historical evidence: rejected; old evidence describes its tested revision.

## Dependencies
Cross-repository cleanup is coordinated with https://github.com/Alibaba-Agent-Sandbox/agent-sandbox and https://github.com/Alibaba-Agent-Sandbox/awesome-providers. Shared UI originates in https://github.com/Alibaba-Agent-Sandbox/website and is synchronized into https://github.com/Alibaba-Agent-Sandbox/registry.

## Test Strategy
Run the repository's required local checks and regressions for current observable behavior, including rejection of removed interfaces. Record actual results and outstanding live/remote gates separately.

## Acceptance criteria
- Current paths work and removed project compatibility paths are unavailable.
- Documentation and tests describe the same contract.
- Required local checks pass, evidence is recorded, and remote CI/review pass before merge.

## Evidence
- [Verification](../../../evidence/verify/2026-10-22-remove-legacy-compatibility.md)

Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/103

## Acceptance

Verified merged implementation: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/104. The source merge commit is `bbd7504094eee58d5126857b55d297ab0480fe92`.

- [Remote acceptance](../../../evidence/verify/2026-10-22-remove-legacy-acceptance.md)

## Current documentation follow-up

Remove stale instructions that still advertised retired imports, credential aliases, retry settings, template selectors and server transfer routes. The current API references, provider boundary pages and contributor entry point describe the merged implementation.

- [Documentation verification](../../../evidence/verify/2026-10-22-remove-legacy-docs.md)
