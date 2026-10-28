# Decision: Publish current installation guidance without release implementation details

Status: proposed

## Problem

Installation examples still selected 0.5.7 after the authenticated application repair shipped as
0.5.8. The public installation guide also contained publisher recovery, CI and npm provenance
implementation instructions unrelated to installing or using the CLI.

## Decision

Update the bilingual README recommendation, tutorial and binary examples to published CLI 0.5.8.
Keep installation, checksums, platform choices, authentication and source builds in the user guide.
Move existing publisher/recovery/provenance instructions into .agents/design/cli-release-operations.md.
Record actual release/public-consumption checks in new evidence, preserving earlier records.
Move the accepted application-token decision into implemented after its verified PR merge.

## API Design

N/A — this decision does not involve API changes.

## Alternatives considered

- Leave the old version pinned: rejected because users should install the released correction.
- Keep publisher internals in installation instructions: rejected by the public-document audience rule.

## Dependencies

Published CLI 0.5.8; source PR https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/208.

## Test Strategy

Validate repository health, links, record lifecycle and diff/secret hygiene. Independently install
from the public npm registry and check the actual artifact and authenticated application path.
Retain real cloud cleanup and remote CI as separate recorded evidence.

## Acceptance criteria

- Both language examples select an existing public 0.5.8 release.
- User installation instructions contain no publisher recovery or internal validation narrative.
- Maintainer instructions and historical evidence remain available in engineering records.
- Link/record checks and public-package verification pass; current-head remote gates pass.

## Evidence

- [CLI 0.5.8 publication](../../../evidence/verify/2026-10-28-cli-058-publication.md)
