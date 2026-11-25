# Decision: give the unified CLI a distinct preview version
Status: proposed

## Problem

Current main and the published CLI both report 0.5.10 despite different command
layouts and managed-key consent rules. The merged option-alias correction is not
yet delivered through a new public package. Coordination:
https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/270.

## Decision

Prepare 0.6.0-alpha.0 from reviewed main, including the target-first API command
contract merged in PR 269. Update the package and lockfile together. Document
explicit preview installation, removed commands, replacement tasks and the
separate meanings of --ci and --yes in English and Chinese. Preserve historical
goldens; only the version case uses a new capture batch.

Use the existing immutable-tag release process: all five platform binaries must
pass before the draft prerelease is published. The npm workflow publishes a
tested tarball with provenance to next. latest and stable installers retain
0.5.10. Preparation does not establish publication; the Issue remains open until
the independent public installation and artifact readback criteria pass.

## API Design

No runtime API is changed by this preparation. The version identifies the
already merged command contract and authorization behavior.

## Alternatives considered

- Reuse 0.5.10: it would leave two different contracts under one identifier and
  conflict with immutable package publication.
- Use a patch release: the command removals and consent changes need a distinct
  pre-1.0 minor line and explicit preview installation.
- Declare a 1.0 release candidate: the task does not establish general-availability
  readiness or authorize broad new compatibility claims.

## Dependencies

- Reviewed main c268608d6a3f917c6d07b7feaa24ab54f25e8fdf and its lockfile.
- Existing release.yml, release-binary.yml and installed-artifact verifier.
- Python runtime pins remain unchanged unless a separately verified public
  runtime release and its consumer checks justify updating them.

## Test Strategy

Run repository health, hygiene, typecheck, lint, build and complete tests with the
CI-pinned fixtures. Verify the actual installed npm candidate, current help,
fresh version capture, option-alias behavior against a local process Provider,
and release packaging. Require exact-head remote Node 20/22 CI and reviews.
Use the already recorded scoped real-component checks for the unchanged runtime;
this metadata/documentation preparation creates no cloud resources. Public npm
readback and five-platform binaries are separate post-merge publication gates.

## Acceptance criteria

- Package and lockfile identify 0.6.0-alpha.0 without dependency churn.
- Both languages explain preview selection, command migration and consent.
- Existing tests and candidate checks pass; limitations remain explicit.
- Prior source and evidence are preserved, and the exact release candidate is
  reviewed through a PR before its immutable tag is created.
- Publication remains pending until the Issue's public delivery criteria pass.

## Evidence

- [Preparation verification](../../../evidence/verify/2026-11-25-cli-060-alpha0-release.md).
- [Option-alias fix](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/267).
- [Current API operation contract](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/269).
