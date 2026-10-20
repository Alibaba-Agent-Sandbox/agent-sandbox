# Decision: Publish an explicit native CLI entry for step acceptance

Status: proposed

## Problem

Default public template list/create commands use the pinned standard migration surface; the canonical Express step workflow requires the existing native official inventory/readback/cleanup and named-command shapes. Current0.4.0 rejects a real non-help --native config invocation, forcing a historical0.3.0 binary/external SDK or a private source launcher.

## Decision

Add an explicit first-global-option --native selector before the standard dispatcher, reusing the same native main and all existing Provider feature/configuration checks. Preserve default routing, remote argv and notice handling. Prepare patch0.4.1 with accepted ENV and standalone management-SDK fixes; preserve historical version captures and add a new0.4.1 capture. Publish/verify actual artifacts through existing workflows after CI/review/merge.

## API Design

abx --native [existing native root options] COMMAND. Only the first root option is consumed; flags in remote exec input remain untouched. The native framework and vendor implementations are reused. No backend switch, capability declaration or duplicate cloud implementation is introduced.

## Alternatives considered

Implicit routing from output flags would change the pinned migration contract. A private module launcher or an old binary plus extra SDK modules does not provide a stable current installed entry. A separate executable would duplicate distribution/artifact surfaces unnecessarily.

## Dependencies

Accepted ENV prerequisite https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/88; accepted bundled SDK prerequisite https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/87. Template acceptance https://github.com/Alibaba-Agent-Sandbox/awesome-templates/issues/149. This defect is tracked in https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/89; independent npm-channel publication remains https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/66.

## Test Strategy

Actual old bin --native config read exits2 with unknown option; new package entry executes the read and official native list help. Protect default routing, selected Provider and opaque remote flags. Run existing route/standard suites, own immutable version capture, full local and remote checks, actual installed artifact/native cloud acceptance and independent owned cleanup. Verify real remote publication rather than a configured token.

## Acceptance criteria

- First-option native entry works in npm/SEA source distributions without modifying standard routing.
- Package/version/lockfile, English/Chinese guide, changelog and immutable records agree.
- Relevant regressions, required CI and normal PR merge pass.
- Actual released installation artifacts and scoped native cloud acceptance pass; publication blockers remain explicit.
