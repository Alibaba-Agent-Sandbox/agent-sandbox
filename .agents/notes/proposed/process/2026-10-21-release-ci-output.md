# Decision: Verify installed artifact guidance across CLI output modes

Status: proposed

## Problem

The unpublished v0.4.3 binary matrix rejected valid missing-project guidance:
the artifact checker expected stderr, while CI mode writes JSON errors to stdout.

## Decision

Check the combined captured output while retaining exit-code and filesystem
assertions. Preserve CLI output contracts. Prepare 0.4.4 and keep v0.4.3 immutable.

## API Design

No API or CLI behavior changes. Only artifact verification and patch metadata change.

## Alternatives considered

- Disable CI mode: would leave the supported CI output path unverified.
- Change CLI error streams: breaks existing JSON contracts.
- Move the existing tag: loses immutable release provenance.

## Dependencies

Existing installed-artifact checker and release workflows; no new packages.

## Test Strategy

Reproduce the prior failure with CI=true. Install the new tarball and run the
same checker with and without CI. Require current-head CI, five-platform actual
artifact acceptance and official mirror/default-installer verification.

## Acceptance criteria

- Both output modes retain guidance, nonzero exit status and no unwanted writes.
- All remote release checks pass before publishing 0.4.4.
- Official default installer selects and installs the complete new release.

## Evidence

- [Verification](../../../evidence/verify/2026-10-21-release-ci-output.md)
- https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/95
