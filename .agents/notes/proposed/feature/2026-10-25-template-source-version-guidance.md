# Decision: Explain incompatible downloaded template revisions

Status: proposed

## Problem

An old spec-v4 template read from local source or cache produces separate raw
schema errors. The current source revision and downloaded source cache are
separate from the catalog index, so an index refresh is not a reliable remedy.

## Decision

Reject an explicitly incompatible manifest before model validation with the
source file and required spec-v5 version. Recommend a source revision containing
the current contract. For a file actually within the source cache, identify only
that template directory for removal after the remote source has been updated.
Preserve files and reject the old manifest without migration or fallback.

## API Design

No new CLI flag, mode or accepted schema. Reuse TemplateParseError (E2004) for
the source-version failure, including local capability discovery. Existing raw
model validation remains responsible for other invalid fields.

## Alternatives considered

- Accepting v4 or changing its version automatically would conceal incompatible
  declarations and revive retired workflows.
- Refreshing the index cannot replace downloaded source files.
- Deleting the entire cache would remove unrelated downloads and would not
  update an explicitly pinned old Git revision.

## Dependencies

Issue https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/176.
Release PR https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/174.
No SDK change or new dependency.

## Test Strategy

Regress source loading and capability discovery with old local/cached manifests,
including a similarly named directory outside the cache. Compare the installed
public CLI and built candidate against real isolated filesystem input. Run owner
checks and latest-head CI with the containing release patch.

## Acceptance criteria

Explicit v4 is rejected with actionable source guidance, the matching cache path
is identified without deletion, current manifests continue to parse, and neither
raw Zod noise nor unexpected-error instructions obscure this known failure.

## Evidence

[Verification](../../../evidence/verify/2026-10-25-template-source-version-guidance.md).
