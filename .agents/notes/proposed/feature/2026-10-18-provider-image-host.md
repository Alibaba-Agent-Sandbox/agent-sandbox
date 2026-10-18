# Decision: Dispatch opt-in provider image template factories

Status: proposed

## Problem

The E2B adapter has no committed host dispatch. Reusing templates.build would
send other providers through Express-specific Docker, registry and template APIs.
The prior uncommitted host worktree was not present after session recovery.

## Decision

Add an independent templates.deploy feature and optional buildTemplates factory.
Expose a narrow image-only API and template from-image CLI route. Preserve legacy
capability gates and exclude the new feature from Express declarations. Load the
pinned optional E2B SDK only for its image factory, with a Node 22 prerequisite.
Validate requests before resources, forward declared/consented configuration,
allowlist ready results and close all context HTTP clients on every outcome.

## API Design

Provider.buildTemplates(config) and node/1 buildTemplates(ctx) return
{deploy(input), close?()}. deployProviderImage(input, options?) accepts only an OCI
image, template name, cpu/memory/start/ready spec, optional registry credentials,
timeout and AbortSignal. Results contain template_id, build_id, status and ref.
No EPP or engine deployment endpoint is introduced. Python metadata acceptance
and registry capability aggregation remain separate owning-repository changes.

## Alternatives considered

- Reuse templates.build: rejected because legacy routes perform Express work.
- Enable E2B's catalog immediately: rejected pending shared schema delivery and
  native build/create/execute/kill acceptance with authorized native credentials.
- Reuse the Express E2B-shaped key on E2B: rejected; provider namespaces stay separate.

## Dependencies

- https://github.com/Alibaba-Agent-Sandbox/awesome-providers/pull/5
- https://github.com/Alibaba-Agent-Sandbox/python-sdk/issues/50
- Optional e2b 2.55.0, Node 22 or newer for that factory only.

## Test Strategy

Validate unsupported/invalid requests, config isolation, raw-error omission,
result validation and all cleanup paths. Exercise the built CLI with real local
install/consent and the actual catalog adapter plus official SDK against loopback.
Run full tests, types, lint, build, parity, health, hygiene and CLI evidence checks.
The loopback run is not native-cloud acceptance; keep separate evidence and gates.

## Acceptance criteria

- Existing manifests and Express template operations retain their capabilities.
- Invalid requests never build sandbox infra; unsupported providers return E8004.
- Factory requests reach only the selected provider, with scoped authentication.
- Local resources close on success, invalid result, factory and cleanup failures.
- Shared schemas land before catalog opt-in; native deployment acceptance is
  still required before declaring the provider workflow complete.

## Evidence

- [verification](../../../evidence/verify/2026-10-18-provider-image-host.md)
- https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/41
