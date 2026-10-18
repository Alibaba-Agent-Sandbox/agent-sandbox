# Decision: Keep provider ownership and update outcomes explicit

Status: proposed

## Problem

Bundled provider update is reported as a missing plugin; bulk update swallows Git installation errors. Legacy template feature declarations can enter FC implementation. Migration and all-capabilities claims exceed verified scope.

## Decision

Guard legacy FC template execution; return bundled lifecycle guidance without self-updating; report manual sources and propagate Git errors. Record the incomplete FC boundary and reuse the separately proposed image factory instead of implementing a competing contract.

## API Design

UpdateResult adds bundled/manual statuses and optional message. Existing successful Git result fields remain. Bundled --check is offline guidance, not latest-release discovery. Legacy plugin template commands fail E8004 before FC setup.

## Alternatives considered

Automatic global npm/pip replacement cannot safely identify installation ownership. Silent credential aliases risk cross-provider leakage. Adding feature flags without adapters does not implement deployment.

## Dependencies

https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/35; optional image host https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/42; Python consumer https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/38.

## Test Strategy

Negative-control regressions on the unchanged base; updated CLI/installer/provider tests; strict typecheck/lint/build, built binary offline acceptance, dated CLI captures and required full aggregate. Preserve every failure.

## Acceptance criteria

No plugin enters FC template execution; bundled and manual updates are truthful; Git failures propagate; migration/AI/coverage and native factory limits are bilingual; mandatory gates pass before merge.

## Evidence

[Verification](../../../evidence/verify/2026-10-18-provider-portability-updates.md).

Owner issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/47.
