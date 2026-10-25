# Decision: Resolve managed entries from the public template catalog
Status: implemented

## Problem

CLI 0.5.0 parsed only `templates`; the actual public index stores four native entries in `managed_templates`. The earlier managed launch test fabricated a repository and skipped the real catalog parser. Public-package `template launch base` failed before resource creation.

## Decision

Parse both lists with shared name uniqueness and manifest validation. Managed entries retain provider and native ID without a source repository. Resolve launch identity independently of source installation; redirect managed source installation to the launch command. Preserve raw YAML cache format and re-parse it using the fixed parser. Send resolver diagnostics to stderr so JSON launch stdout remains one document.

## API Design

No new options, manifest fields or workflow states. Existing source references remain unchanged. Release a new patch, 0.5.1; preserve the published 0.5.0 artifact and tag.

## Alternatives considered

- Fabricate source directories for native entries: duplicates authority and cannot identify the real provider resource.
- Require cache deletion: unnecessary because cached data is the original YAML, not parsed entries.

## Dependencies

[Public catalog](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/blob/45eb6c40b8d40e8ae1799420631cec1f5cb2f832/awesome-templates.yaml); no producer changes are required to fix parsing.

## Test Strategy

Use the complete pinned public YAML fixture: 46 source rows and all four managed rows. Exercise parser, existing cache, search, source-install guidance and native launch. Run bare-name launch against the public Git catalog and real Express API with an isolated home, execute 42, kill, and independently confirm absence.

## Acceptance criteria

- All four native identities survive parsing and search; 46 source references remain available.
- Managed launch performs no fictitious source fetch or build.
- Real catalog launch, remote execution and cleanup pass before patch publication.
- Normal PR CI, main CI, release binaries and public npm verification remain required.

## Evidence

- [Verification](../../../evidence/verify/2026-10-25-cli-051-managed-catalog.md)
- [Issue 153](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/153)
