# Decision: Preserve declarative option aliases

Status: implemented

## Problem

The CLI registers additional long names as boolean opposites even for value options, and parameter collection discards their values. Provider test --option therefore does not implement its declared contract. Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/264.

## Decision

Separate ordinary aliases from slash flag pairs. Register value aliases with the same arity, converter and canonical Commander attribute, preserving mixed-repeat order. Explicit presets own flag polarity and the declarative defaults/environment fallback remain authoritative. Remove the expired date from the bilingual README preview notice.

## API Design

Existing --opt/--option/-o declarations pass the same opt array to command callbacks. A scalar uses the last explicit alias; a slash flag pair uses the last explicit polarity. No Provider protocol, command namespace or package version changes.

## Alternatives considered

- Fix only help or addOption: rejected because collectParams would still discard values.
- Merge arrays after parsing separate attributes: rejected because mixed alias order would be lost.
- Retain Commander implicit negation defaults: rejected because defaults belong to the declarative framework.

## Dependencies

Existing Commander and CLI option declarations; no dependency changes.

## Test Strategy

Complete command callbacks cover mixed repeats, scalar precedence, integer/choice validation, missing values, help, true slash pairs, standalone --no-* flags and declared defaults/environment values. Run the full owner checks, actual built CLI against the local-process Provider and focused real-cloud observation. Preserve environment failures and skipped unsupported Provider cases separately.

## Acceptance criteria

- The original source fails the regression and the candidate passes.
- The built provider test command accepts all three value aliases together.
- Bilingual docs, changelog and dated evidence describe source versus published behavior.
- Required exact-head checks/review pass before merge; no package publication.

## Evidence

- [Verification](../../../evidence/verify/2026-11-25-option-aliases.md).

- [Public alpha.1 delivery](../../../evidence/verify/2026-11-25-cli-060-alpha1-public-release.md).
