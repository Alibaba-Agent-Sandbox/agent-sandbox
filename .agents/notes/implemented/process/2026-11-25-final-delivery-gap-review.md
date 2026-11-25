# Decision: preserve a requirement-level delivery checkpoint

Status: implemented

## Problem

The earlier coverage review predates several merges and publication steps. Treating every old
Draft as blocked would miss delivered work and obscure actual remaining implementation needs.

## Decision

Append a new source/delivery checkpoint, preserve the earlier evidence, and separate internal
unfinished implementation, concrete external validation prerequisites and rejected extra design.
Audit old PR249 against merged PR281 by source difference before deciding whether it is replaced.
This process record does not mark the complete product redesign implemented.

## API Design

N/A — this decision does not involve API changes.

## Alternatives considered

- Rewrite the merged coverage report — rejected because it would erase the earlier state.
- Close all older Drafts — rejected because the SEA worker candidate has independent remaining scope.
- Run a new cloud matrix for an audit — rejected because source/remote evidence answers this task.

## Dependencies

The merged CLI, Python, template and website changes and their owning repository evidence;
the current topic/article publication chain remains separately observed.

## Test Strategy

Read fixed source and remote state, cross-review the technical dispositions, run repository
record/link/hygiene checks and normal PR CI. Reuse linked cloud evidence only within its scope.

## Acceptance criteria

- Existing merged evidence remains unchanged.
- Necessary gaps identify a concrete cause, owner and executable next step.
- Public package and later main-branch behavior are distinguished.
- PR249 is not closed merely because PR281 merged.
- No new cloud resources, product code or releases are introduced by this record.

## Evidence

- [Final delivery and gap review](../../../evidence/verify/2026-11-25-final-delivery-gap-review.md).
