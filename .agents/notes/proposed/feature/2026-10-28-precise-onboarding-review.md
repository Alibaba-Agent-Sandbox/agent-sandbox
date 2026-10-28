# Decision: Precise onboarding cancellation and credential recovery
Status: proposed

## Problem

After the earlier setup simplification, rejecting template creation was still wrapped as E8002 with recovery advice despite no recorded resource intent. Missing runtime authentication expanded unrelated managed-key lifecycle/RAM prose and omitted the direct key source. Build-only AccessKey input also displayed managed-key permissions.

## Decision

Propagate CLI Abort from preparation when the owner journal has no entries. Preserve the controlled failure/recovery path after any recorded intent; upstream errors remain sanitized. Keep missing-authentication recovery to available methods, a configuration command and the provider-owned key-source hint. Detailed managed-key help remains in verbose output, explicit configuration and actual creation/renewal consent. AccessKey input identifies its RAM origin without claiming that entering a pair grants permissions. Review current entry points across eight repositories; scope fixes to demonstrated onboarding defects.

## API Design

No new public symbols, options or SDK behavior. Existing Abort exits with status 1. ProviderConfigUi descriptors, ResourceJournal callbacks and runtime-authentication resolution remain unchanged.

## Alternatives considered

- Suppress all preparation errors: would lose genuine remote uncertainty and resource cleanup guidance.
- Remove managed-key consent/detail globally: would hide permission/lifecycle information when the user actually authorizes a mutation.
- Rewrite all provider and historical practice guides: would expand scope and conflate pinned published behavior with unreleased source behavior.

## Dependencies

Existing CLI prompt Abort, provider-owned configuration help and journal entries. Public Registry follow-up: https://github.com/Alibaba-Agent-Sandbox/registry/issues/87. Earlier automatic authentication source: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/211.

## Test Strategy

Before/after regressions for pre-intent cancellation and ordinary missing authentication; preserve post-intent recovery. Exercise real POSIX terminal decline/Ctrl-C and automation modes, actual installed npm artifact, real Express creation/discovery/business invocation/HTTP401/deletion, full tests, exact unchanged-main failure comparison, parity, typecheck/lint/build, and owner health/hygiene checks.

## Acceptance criteria

- Pre-submission cancellation reports Aborted without a misleading failure or recovery journal; source preparation and creation do not execute.
- A recorded intent retains recovery information after interruption.
- Normal missing-key errors identify the source and repair command without managed-key RAM/lifecycle paragraphs; actual consent is unchanged.
- Real terminal input restores mode and preserves hidden credentials; actual installed-package cloud use and independent owned cleanup pass.
- Both translations, changelog and dated owner evidence accompany the patch. Exact-head CI/review remain required for merge.

## Evidence

- https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/212
- [Verification](../../../evidence/verify/2026-10-28-precise-onboarding-review.md)
- [CLI capture](../../../evidence/cli/2026-10-28-precise-onboarding-review.md)
