# Decision: Describe shortcut actions before their aliases

Status: proposed

## Problem

Root help described all ten shortcuts only as “Same as” another command, so users
could not tell what the actions did without opening more help pages.

## Decision

Keep concise purpose text in the fixed shortcut metadata in
`src/cli/command_surface.ts`. Render the purpose first and append
`(alias: abx GROUP VERB)` in `src/cli/main.ts`. Preserve lazy loading and the fixed
command set. Distinguish arbitrary execution (`exec`) from registered commands
(`run`). Update root help snapshots, the offline scenario, both reference pages,
both READMEs and the changelog.

## API Design

N/A — this decision does not involve API changes.

## Alternatives considered

- Alias-only descriptions: do not explain the available actions.
- Import all command implementations to read their help: adds work to root help
  and undermines its lazy command-loading contract.

## Dependencies

Existing shortcut registration and Commander help rendering; no new packages.

## Test Strategy

Update the existing command-surface check to require a purpose before each alias.
Regenerate only the root help golden file. Exercise the built CLI through the
root-help offline scenario and run repository CI, record and hygiene checks.
No cloud resources are needed to render this metadata-only help.

## Acceptance criteria

- All ten root shortcut rows explain their purpose before the canonical alias.
- `exec` and `run` explain their different actions.
- Command routing, order and lazy loading remain intact.
- Root help snapshot and built CLI help checks pass; broader gates are recorded.

## Evidence

- [Verification](../../../evidence/verify/2026-10-21-shortcut-help-descriptions.md)
