# Decision: Verify the published managed-catalog patch through the user entry point
Status: implemented

## Problem

CLI 0.5.0 passed artifact checks but failed actual public managed-catalog lookup. A candidate local-manifest test did not establish that public integration. Release evidence must distinguish artifact delivery, source validation and fresh public-package behavior.

## Decision

Publish the separate 0.5.1 patch only after exact-head PR and main CI. Preserve 0.5.0 and all historical failures. Verify five platform assets, npm public metadata and integrity, fresh official installation, and bare public catalog `base` startup with real execution and independent cleanup. Record environment-limited local tests separately from the required passing Node 20/22 CI.

## API Design

No new API. Public templates use `template launch`; no workflow selection is restored.

## Alternatives considered

- Treat candidate or hand-built fixture success as public-package acceptance: rejected because it missed the catalog parser defect.
- Rewrite 0.5.0 or existing evidence: rejected; use a new patch and a new verification record.

## Dependencies

[PR 154](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/154), the official npm registry, GitHub Releases, the public Git template catalog and the real Express backend.

## Test Strategy

Use the published package in an isolated prefix and HOME. Check artifact commands, public archive integrity, launch/exec/kill, and independent absence. Remote CI uses pinned dependencies and both supported Node majors.

## Acceptance criteria

- Original tag and package remain unchanged.
- Patch release assets and npm package are public and consistent.
- Fresh installed package launches bare `base`, executes 42, kills it and leaves no owned resources.
- Current documents link the new record and preserve earlier failures as history.

## Evidence

- [Public release verification](../../../evidence/verify/2026-10-25-cli-051-public-release.md)
