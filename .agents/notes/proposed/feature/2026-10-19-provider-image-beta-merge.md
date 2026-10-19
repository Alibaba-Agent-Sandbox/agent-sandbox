# Decision: Merge the gated image host under explicit Beta acceptance

Status: proposed

## Problem
The optional image host draft conflicts with accepted standard CLI behavior and selects an SDK by provider ID. A third-party native cloud gate predates the maintainer decision to defer other providers' formal acceptance and keep only accepted Express Stable.

## Decision
Preserve the accepted standard entry and expose from-image only as a native provider extension. Generic loading has no vendor-ID dispatch. Adapters explicitly request the shared lazy SDK helper; old constructor kits remain compatible. Public catalog deployment stays unopted, providers remain Beta, and no independent native E2B success is claimed. The maintainer's explicit 2026-10-19 deferral governs this merge scope; native verification is still required before public deployment opt-in or formal acceptance.

## API Design
Generic ProviderImageRequest/Result and buildTemplates remain separate from legacy template managers. The E2B adapter calls kit.e2b.loadTemplate() on opted-in use, with a fallback to older kit.e2b.Template. Shared SDK loading has no backend calls or credential resolution. Authentication/API mappings/polling remain adapter responsibilities.

## Alternatives considered
Blindly merging the conflicted draft would regress standard behavior. Retaining host ID switches violates isolation. Enabling catalog factories without native acceptance would overstate support.

## Dependencies
CLI42 host contract lands before its compatible catalog consumer; accepted CLI40/SDK47 and provider consumer docs remain authoritative. Cross-repository links are absolute GitHub URLs.

## Test Strategy
Run strict type/build/lint, full CLI suite, parity, hygiene/health and new dated CLI capture. Re-run actual installed-host/official-SDK E2B loopback and CubeAPI loopback; distinguish these from native cloud. Adapter T0 verifies lazy opt-in and old-kit fallback. Exact-head CI and merge checks remain mandatory.

## Acceptance criteria
No provider ID determines SDK loading. Standard/native command routes coexist. The historical template_provider import forwards to the provider-owned Express gate. Unopted providers fail E8004; scoped credentials, safe output and cleanup remain tested. Records explicitly distinguish deferred native acceptance, local failures and actual passes. Merge through normal PR gates.

## Evidence
This acceptance scope supersedes the draft-only merge requirement in the earlier unmerged 2026-10-18 image host/convergence notes; it does not waive native verification before public feature activation.

https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/42
https://github.com/Alibaba-Agent-Sandbox/awesome-providers/issues/14
