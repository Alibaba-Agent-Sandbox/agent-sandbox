# Decision: Match repository capitalization for npm provenance
Status: implemented

## Problem
After authentication and 2FA requirements were satisfied, npm rejected CLI 0.4.6 with E422: its lowercase package repository URL did not match the capitalized GitHub repository identity in the provenance certificate. GitHub URL routing is case-insensitive; npm provenance identity verification is case-sensitive.

## Decision
Use the canonical repository capitalization in the current package manifest. During existing-tag recovery, require the tagged URL to equal the current GitHub repository URL ignoring capitalization, correct only capitalization, and perform all dependency/build/test/pack/install gates afterwards. Reject any different repository identity. Publish the same tested tarball with provenance. Log the actual checked-out source SHA and publishing-workflow SHA for traceability.

## API Design
No runtime API or CLI changes. A documented package-metadata transformation allows recovery without moving or rewriting the existing source tag. The new npm tarball is distinct from older Release assets and has a new recorded checksum.

## Alternatives considered
- Disable provenance: rejected because this would weaken publication assurance.
- Move the existing version tag: rejected because published source references must remain immutable.
- Rewrite arbitrary repository URLs: rejected because a different repository identity must fail validation.
- Publish the previously tested Release tarball: rejected because its embedded metadata still fails the registry check.

## Dependencies
Existing GitHub Actions, Node builtins, Git and npm; no dependency version changes.

## Test Strategy
Execute the actual workflow shell for canonical/no-op, lowercase normalization, unrelated owner/repository and missing identity cases. Pack and install a real normalized npm fixture and inspect installed metadata. Test the real CLI candidate artifact and real cloud guidance before merging. Require the latest-head CI matrix and independent review. After merge, run the recovery publisher and verify public npm installation and real cloud behavior from that installation.

## Acceptance criteria
- Only capitalization changes are accepted for the current repository URL.
- Canonical URLs are byte-preserving and invalid identities are never rewritten.
- Tagged source references, version guards, full tests and provenance remain enforced.
- Actual source/workflow commits and the new npm tarball checksum are traceable.
- Real registry publication and installation are recorded separately from local candidate validation.

## Evidence
- [Verification](../../../evidence/verify/2026-10-22-npm-provenance-repository-case.md).
- [Release delivery Issue](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/66).
- [Npm provenance documentation](https://docs.npmjs.com/generating-provenance-statements/).
