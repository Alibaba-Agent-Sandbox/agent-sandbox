# Decision: Check current syntax and retain exact historical context

Status: proposed

## Problem

Ten existing repository-health categories prevent honest delivery review. Several
are stale repository-name or text-scanning false positives. Other findings refer
to immutable captures, relocated SDK records, absent old captures and English
pages left in a different directory from their Chinese counterparts.

## Decision

Use the existing TypeScript parser for actual static/export/dynamic/require
imports and executable JavaScript strings. Validate the actual repository and
Issue endpoint, keep Python only in engineering records, parity oracles and
explicit test fixtures, and scan script directories using anchored relative
paths. Add useful CLI recipes, make installer URL fixtures portable, and move
four current English pages beside their Chinese counterparts while preserving
old-path links. Correct links for the new location.

Preserve every historical file byte. Register only individually reviewed old
findings against their entire file's SHA256 and exact finding key. The ledger
records the real owning SDK URLs, a moved superseded CLI ADR, temporary captured
fixture paths and two genuinely unavailable old captures. Recognized contexts
remain visible WARNs and `--strict` still rejects them. Changes to those bytes,
unlisted findings and findings outside the explicit immutable record paths still
fail. A missing historical capture is not converted into passing test evidence.

## API Design

No product command or public runtime API changes. Repository-health requires the
existing lockfile development toolchain installed by `npm ci`.

## Alternatives considered

- Rewrite old evidence or accepted notes: rejected because captures are historical.
- Ignore all records or all missing references: rejected because new violations
  must remain blocking.
- Match imports with a broader regular expression: rejected because source
  comments and strings are not JavaScript import syntax.

## Dependencies

Existing TypeScript development dependency and Node standard libraries only.
[Issue 38](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/38).

## Test Strategy

Positive and negative regressions cover canonical repository URLs, real imports
including package subpaths, comments/examples, parity versus product Python,
actual removed-CLI execution and exact hash/finding/path historical boundaries.
Run the whole gate on the real checkout, normal runtime CI and real CLI recipes.

## Acceptance criteria

- Genuine new code/document violations still fail, demonstrated by negative controls.
- Existing ten categories are resolved with traceable ownership and visible limits.
- Historical evidence and implemented notes remain byte-identical to main.
- Bilingual documentation, changelog, verification, normal CI and real-component
  behavior pass before normal merge.
