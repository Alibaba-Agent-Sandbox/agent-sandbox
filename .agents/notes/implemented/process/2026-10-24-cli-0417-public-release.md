# Decision: Record CLI 0.4.17 public distribution

Status: implemented

## Problem

The application timeout fix needs public binary and npm delivery evidence in addition to its implementation tests. The CLI contribution guide also duplicates retired template catalog fields and can direct authors to an invalid manifest.

## Decision

Publish the exact reviewed merge through the existing tag, five-platform binary and npm workflows. Record public checksums and a fresh npm installation separately from source validation. Replace the contribution guide's duplicate template schema and layout checklist with links to the owning repository's current contribution guide and specification. Preserve all earlier release and experiment records.

## API Design

N/A — this decision does not involve API changes. Runtime behavior and its compatibility contract belong to [PR148](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/148).

## Alternatives considered

- Treat a green source CI run as publication: rejected because it does not prove that public consumers can install the release.
- Copy another template schema into the CLI guide: rejected because the template repository already owns and validates it.

## Dependencies

- Exact reviewed source/tag commit `2809931b0fb05c6ba53fb7b8be2369938c308614`.
- Existing GitHub release and npm publication workflows.
- Current [template contributor guide](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/blob/main/CONTRIBUTING.md) and [specification](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/blob/main/docs/template-spec.md).

## Test Strategy

Verify five successful platform jobs and ten binary/checksum assets before publishing the draft. Require npm workflow success, public metadata and fresh installation. Record an independent public-package real-cloud timeout regression and cleanup without relabeling historical experiments. Run the repository's document, record and hygiene checks and normal PR CI.

## Acceptance criteria

- The immutable tag matches the merged source and package version.
- Five platform binaries and checksum sidecars pass; the published Release includes its tested npm archive.
- A new public npm installation exposes version 0.4.17 and the template launch command.
- The public-package timeout regression and cleanup have recorded outcomes.
- Records and contributor links pass checks and independent review before merge.

## Evidence

- [Public distribution and cloud verification](../../../evidence/verify/2026-10-24-cli-0417-release.md).
