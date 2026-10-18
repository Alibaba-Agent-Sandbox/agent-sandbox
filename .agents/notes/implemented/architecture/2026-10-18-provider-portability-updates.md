# Decision: Keep provider ownership and update outcomes explicit

Status: implemented

## Problem

Bundled provider update is reported as a missing plugin; bulk update swallows Git installation errors. Legacy template feature declarations can enter FC implementation. Migration and all-capabilities claims exceed verified scope.

## Decision

Route every backend through a real Provider instance. Move Express cloud/auth/template and session assembly into provider-owned modules, with shared E2B adapters selected explicitly. Keep structural core contracts and public compatibility facades. Register provider-owned CLI/config/AI extensions in explicit composition roots; resolve them per invocation. Return bundled update guidance without self-updating; retain verified plugin updates. The separate proposed image factory is not activated by this refactor.

## API Design

UpdateResult adds bundled/manual statuses and optional message. Existing successful Git result fields remain. Bundled --check is offline guidance, not latest-release discovery. Template managers are optional provider factories. Missing methods fail E8004 before FC setup; Node plugins can supply their own factory. Lifecycle binding and terminal hooks prevent native fallbacks.

## Alternatives considered

Automatic global npm/pip replacement cannot safely identify installation ownership. Silent credential aliases risk cross-provider leakage. Adding feature flags without adapters does not implement deployment.

## Dependencies

https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/35; optional image host https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/42; Python consumer https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/38.

## Test Strategy

Negative-control regressions on the unchanged base; updated CLI/installer/provider tests; strict typecheck/lint/build, built binary offline acceptance, dated CLI captures and required full aggregate. Preserve every failure.

## Acceptance criteria

No plugin enters FC template execution; bundled and manual updates are truthful; Git failures propagate; migration/AI/coverage and native factory limits are bilingual; mandatory gates pass before merge.

Acceptance also requires no concrete backend imports in core implementation, no
null/default-provider lifecycle bypass, provider-owned authentication/session/URL/terminal
assembly, no foreign configuration defaults, and owned-versus-borrowed cleanup regressions.

## Evidence

[Verification](../../../evidence/verify/2026-10-18-provider-portability-updates.md).

Owner issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/47.

## Implementation

The full-isolation follow-up removes the earlier guard-only limitation. Authentication,
cloud mappings, template orchestration, session defaults and vendor UI metadata are
provider-owned. Historical evidence remains unchanged; acceptance is tracked in the new
[isolation verification](../../../evidence/verify/2026-10-18-provider-complete-isolation.md).


The current-host integration retains the accepted API-key-only runtime authentication,
independent CLI error renderer and retired native gRPC slice. Provider-owned URL builders
replace core wire-format logic. Python schema composition remains lazy and injected;
CLI tool schemas and handler discovery are recomputed together. Earlier engine-routing
verification remains historical, not evidence that the retired daemon is still used.
See the [integration checkpoint](../../../evidence/verify/2026-10-18-provider-current-host-checkpoint.md).

Port access and file-transfer URL conventions now belong to explicit adapter hooks.
Asynchronous-only discovery fails closed in synchronous helpers. Neutral Python imports
remain lazy; a fresh-process regression prevents built-in auth/wire loading.

[Port and file URL boundary checkpoint](../../../evidence/verify/2026-10-18-provider-port-url-boundaries.md).

Current host/adapter acceptance is complete for the tested Express configuration; see
[final verification](../../../evidence/verify/2026-10-18-provider-isolation-acceptance.md). Hosted checks pass on the tested
implementation revisions. The evidence-only PR head must pass its gates before merge.
Native image factories and unconfigured backend E2E remain separate acceptance work.

A subsequent ordinary merge preserves the independent wheel/auth-preflight repairs.
Provider configuration/image/legacy URL metadata remains in the pure L0 owned metadata
module; core compatibility formatters consume declared templates rather than hard-code
wire addresses. Shared E2B adapters retain their own URL implementation.

[Convergence verification](../../../evidence/verify/2026-10-18-provider-convergence-acceptance.md) records the ordinary remote
merges, provider-owned pure metadata restoration and current Express smoke results.
