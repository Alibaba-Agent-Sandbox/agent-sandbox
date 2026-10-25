# Decision: Mask AccessKey identifiers through provider-owned CLI UI metadata

Status: proposed

## Problem

Current configuration output intentionally treats the AccessKey identifier as a plain value, so summaries and JSON can disclose it in copied output. The separate secret is already masked. Tests explicitly preserve the old full-identifier display.

## Decision

Add AccessKey ID to the Express provider's existing sensitive UI list. Reuse that provider-scoped policy together with declared secret metadata in configuration list/get/set output and hidden input. Preserve full stored/resolved values for authentication; do not change the shared SDK key schema, introduce a reveal mode or add an SDK version just for display policy.

## API Design

Existing commands now mask the identifier by default. No options, storage locations, wire protocols or provider permissions change. Other providers use their own metadata rather than inheriting Express key-name policy.

## Alternatives considered

- Mask only one list format: rejected because qualified get and provider config expose the same value.
- Change shared SDK secret classification and release another SDK: unnecessary for a CLI display policy.
- Guess sensitive values by their text: rejected; reuse explicit provider-owned metadata.

## Dependencies

- https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/175
- https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/174

## Test Strategy

Synthetic non-credential sentinel in a fresh HOME/outside checkout; text/JSON and qualified/native command output; exact file and resolver readback; hidden input and provider isolation regressions; actual installed artifact checks and required owner CI.

## Acceptance criteria

- Config output never contains the complete test identifier while stored/resolved values remain exact.
- Provider-specific and general command surfaces agree without new compatibility or SDK contracts.
- Current guidance explains registered platform IDs versus Registry source launch; old parameter examples are removed.
- New source head passes normal required checks and independent review before CLI 0.5.4 publication.

## Evidence

- [Verification](../../../evidence/verify/2026-10-25-access-key-identifier-masking.md).
