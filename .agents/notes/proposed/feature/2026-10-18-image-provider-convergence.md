# Decision: Preserve image factories during provider main convergence

Status: proposed

## Problem
The image feature branch predates session/authentication/template-manager ownership
changes. Whole-file conflict resolution would discard active adapters or lose the
separate factory metadata and official SDK constructor placement.

## Decision
Port the independent templates.deploy factory onto current provider composition.
Reuse the current Node context and tracked clients; keep legacy template managers
and session adapters. The optional constructor stays at kit.e2b.Template, loaded
only for opted-in E2B image factories. Built-in Express stays unopted.

## API Design
ProviderImageRequest/Result and buildTemplates remain separate optional contracts.
The selected provider owns credentials, API mapping, build polling and cleanup.

## Alternatives considered
Restoring older adapter files resurrects retired ownership. Inferring factory
support from templates.build incorrectly activates unsupported providers.

## Dependencies
Accepted CLI31/35/37/61 and current provider manifests. No package release.
https://github.com/Alibaba-Agent-Sandbox/awesome-providers/pull/10

## Test Strategy
Strict check/build, full suite, typed guards, actual locked optional SDK through
installed host, real CubeAPI adapter loopback, safe result and cleanup assertions.

## Acceptance criteria
Latest CI passes. Native E2B build/create/execute/kill is required before activation;
missing native credentials keep this candidate draft and manifests gated.

Accepted native preflight corrections from https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/62 are retained without expanding public provider opt-ins.

## Evidence
[Verification](../../../evidence/verify/2026-10-18-image-provider-convergence.md).
