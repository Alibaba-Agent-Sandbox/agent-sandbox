# Decision: Template source authoring and reusable builds

Status: Proposed; implemented locally, integration gates pending.
Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/244

## Problem

Template discovery, source copying, Provider-native resources, implicit build/start,
and the MCP FC artifact generator occupied overlapping command paths. Source-only
acquisition rejected newer manifest versions before copying them.

## Decision

Keep catalog list/info, source init, reusable build and Git publish under template.
Deployment belongs to root deploy and the common named lifecycle. Provider-native
management remains in the Provider interface. Remove old public install/scaffold/
launch/deploy aliases rather than layering another parser over them. Init copies
future manifests without claiming they can be deployed. Model generation writes
reviewable source and preserves its research, clarification and overwrite controls.

MCP init produces editable spec5 source using the existing Python MCP HTTP service,
with authentication, sessions and separate Provider traffic headers. It uses a real
published runtime pin and a normal Sandbox service, not a new FC deployment profile.
Local MCP stdio/server/install operations remain unchanged.

## API Design

SandboxTemplateBuild version1 stores a private projectRoot snapshot, sourceDigest,
prepared Provider reference, exact target, journal_file and status. Preparing never
creates a Sandbox. Snapshots reject symlinks, exclude secrets/build bookkeeping and
keep the outer snapshot private while preserving ordinary source modes for container users. Outputs are unique and never overwrite
prior ownership records. Failed preparation retains its journal and recovery state.
Deployment borrows prepared resources and records consumers. Cleanup rereads the
artifact and consumers under the same realpath-keyed local lock used by deploy and
delete; only confirmed owned resources are deleted. Images may remain manual.

Publish pushes only a reviewed clean commit to a new tag on an existing GitHub
remote, refuses another commit at that version and returns the immutable SHA source
reference. It does not create a new registry publishing platform or auto-commit.

## Alternatives considered

Keeping install plus init would retain duplicate source semantics. Making source
copying validate every future schema prevents independent authoring. Reintroducing
an FC-only MCP generator would duplicate deployment ownership and hide editable
source. Deleting old tests wholesale would lose independent resource and credential
checks, so retained Provider adapters and launch services use test-only harnesses.

## Dependencies

Current CLI deployment target/ownership services, existing template source resolver,
existing provider prepareProject, and published Python runtime 0.4.0a6. No release
version changes are included. The Python optional server extra is a separate source
change: https://github.com/Alibaba-Agent-Sandbox/python-sdk/issues/157.

## Test Strategy

Use real file snapshots and Git bare remotes, a generated Python service installed
from its actual requirements, and behavioral Provider/service harnesses. Keep model
adapter seams while exercising the public template init parser. Integration/cloud
checks and product-wide publication gates remain separate.

## Acceptance criteria

- Future manifest source acquisition succeeds without build/validation side effects.
- Build resources remain recoverable and cannot be cleaned while consumed/locked.
- Published source references are immutable and cannot overwrite a different commit.
- Generated MCP HTTP supports auth, initialize, tools/list and session deletion.
- Removed command aliases are absent; runtime suggestions and bilingual guides match.

See [verification](../../../evidence/verify/2026-11-10-template-authoring-boundaries.md).
