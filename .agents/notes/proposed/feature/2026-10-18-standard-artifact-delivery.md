# Decision: Ship complete standard artifact attributions and matching install recipes

Status: proposed

## Problem
The upstream CLI is itself prebundled, so esbuild's package graph omitted86
package identities. Larger notices exposed a real piped-output truncation at
roughly64KiB. Generated Python recipes also named an unreleased PyPI distribution
or pinned an implementation predating the documented standard public entry.

## Decision
Inventory both source graphs and bind the prebundle to its exact source-map hash,
package identities, tarball integrity and notice bytes. Preserve upstream license
files/comments. When a package only publishes an SPDX declaration, retain its actual
metadata/README and clearly labelled canonical reference text; never manufacture
copyright owners or years. Maintainer refresh uses Node and read-only tar inspection.
Normal build verifies checked-in provenance offline; CI replays the locked source port.
Wait for stdout completion for licenses and drain standard-command streams before exit.
Pin generated/bilingual Python recipes to the tested standard implementationcceb318d.

## API Design
`abx --licenses` emits the complete supplied attribution through a pipe. Standard
command syntax and exit statuses remain unchanged. Generated Python examples use
paired source archives rather than claim a package release.

## Alternatives considered
Only retaining esbuild inputs misses the upstream prebundle. Enlarging a test buffer
cannot fix partial synchronous writes. Inventing missing copyright years is rejected.
Installing an older async-root implementation contradicts synchronous examples.

## Dependencies
Pinned CLI2.20.0/protocol2.50.0 lockfile and upstream source map; pinned SPDX source
31ba1a50e5397e00a304dbadc76531740e89ee48. Standard implementation source is
https://github.com/Alibaba-Agent-Sandbox/python-sdk/commit/cceb318d58fad0096def8809165d6646029a35e2
SDK47 must land before its CLI consumer can merge.

## Test Strategy
Reject omitted/extra identities, source drift, truncated notices and missing
provenance. Run actual source replay, standard executable/template regressions,
Linux SEA inventory through a real stdout pipe, clean paired source installation,
quality/record gates and exact-head ordinary hosted CI. Cloud acceptance stays local.

## Acceptance criteria
All108 supplied dependency identities and all86 prebundle identities appear in the
actual artifact output. Source replay is deterministic and CI verifies it. Generated
install recipes resolve the documented entries. Conditional cloud success remains
an independent gate for the parent migration feature.

## Evidence
[Verification](../../../evidence/verify/2026-10-18-standard-artifact-delivery.md).
