# Decision: Publish the corrected invocation and MCP preview

Status: implemented

## Problem

Public CLI alpha.1 lacks merged invocation options and cleanup/protocol fixes that
current guides explain. Generated MCP artifacts must consume the corresponding
published client corrections. Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/282.

## Decision

Release immutable CLI 0.6.0-alpha.2 through existing binary and npm workflows,
keeping npm latest on 0.5.10 and next on the preview. Use merged main fixes only;
exclude unfinished native resource, empty-Sandbox startup and managed drafts.
The shared generated runtime pin changes only after paired Python 0.5.0a1 public
metadata, hashes and clean-install verification are independently confirmed.

## API Design

No new command or runtime API is introduced by the release preparation. Existing
merged scalar options, body stdin, response-file output, verified authentication
binding and MCP retry/header corrections become installable in a distinct version.
Generated MCP remains a client-only distribution rather than adding Server SDK.

## Alternatives considered

- Retain alpha.1 installation links: users would install behavior absent from guides.
- Republish alpha.1 bytes: violates immutable publication.
- Include unfinished native migration: lacks the required cloud/startup acceptance.
- Change stable latest: this remains an explicit prerelease.

## Dependencies

Reviewed main source; existing lockfile, artifact verifiers and release workflows;
paired public Python client/server 0.5.0a1 before the shared consumer pin is finalized.

## Test Strategy

Require current-head CI and actual npm installation, generated client-only MCP
HTTP protocol/deletion checks and the public server wheel image check. Preserve
previous version captures and create a new version golden. Five-platform standalone
checks copy executables outside development dependency ancestors before release.
Verify public npm metadata, fresh installation and checksummed native assets.

## Acceptance criteria

- Release source contains only reviewed merged fixes and current bilingual usage.
- All required source/artifact checks pass before immutable tag/publication.
- Public npm next and GitHub prerelease identify the exact reviewed version;
  stable latest remains unchanged and independent installation succeeds.
- Record partial/failed/skipped checks without promoting them to cloud coverage.

## Evidence

- [Preflight](../../../evidence/verify/2026-11-25-cli-060-alpha2-release-preflight.md).
- [Preparation](../../../evidence/verify/2026-11-25-cli-060-alpha2-release.md).

- [Public delivery](../../../evidence/verify/2026-11-25-cli-060-alpha2-public-release.md).
