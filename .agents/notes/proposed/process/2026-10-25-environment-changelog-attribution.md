# Decision: Attribute the environment guide to unreleased documentation

Status: proposed

## Problem

PR183 added its environment-guide changelog entry under the older0.5.5 Changed heading. That placement incorrectly attributed a later documentation correction to a released version and could mislead downstream documentation aggregation.

## Decision

Move that exact bilingual entry into the existing Unreleased Documentation section. Preserve its text, release headings, immutable tags, old evidence and runtime/package versions. Record only this attribution correction.

## API Design

N/A — no API, runtime, version or dependency changes.

## Alternatives considered

Changing a released tag or publishing another package would not correct the current changelog's grouping. Rewording the entry or adding another architecture decision would expand this small documentation fix unnecessarily.

## Dependencies

https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/183

Baseline main429d27ff1fca2d89139e6d8cbf4aede271b8db3a. No new Issue or cloud prerequisite is needed for this routine records correction.

## Test Strategy

Verify the entry is byte-identical, appears exactly once under Unreleased Documentation and no longer appears under0.5.5. Run repository health/link/hygiene checks, actual configured credential-value scanning and diff checks. Existing PR183 help and runtime evidence remains unchanged; no repeat cloud, help, dependency installation or full local test suite is required for moving prose.

## Acceptance criteria

Only the changelog line's section and this owner note/evidence/index change. Required current-head CI and independent review pass before normal merge. Downstream sources use the actual merged revision without attributing this correction to0.5.5.
