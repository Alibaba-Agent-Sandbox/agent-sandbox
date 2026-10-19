# Decision: Prepare catalog projects through provider adapters
Status: proposed

## Problem

Catalog visitors are asked to supply provider template IDs or manually publish an image before trying source templates. References and build policies differ by backend.

## Decision

Add the explicit template launch extension, generic staging/OCI/process primitives and a capability-guarded prepareProject contract. Express deployment stays under its provider directory and polls submitted builds before creation. The core never selects a backend from a reference.

## API Design

prepareProject(directory, options) returns a ready reference and optional metadata, nonsecret provider options and service commands. Launch validates capabilities and uses the exact reference with the selected provider.

## Alternatives considered

- Keep manual IDs as the primary path: this leaves the requested first-use workflow incomplete.
- Dispatch on known provider names in core or Registry: this couples consumers to backend policy.
- Claim capability parity or promote all providers: references cannot add missing PTY/code support and native acceptance is independent.

## Dependencies

Tracked by https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/69. Cross-repository delivery depends on https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/69, https://github.com/Alibaba-Agent-Sandbox/awesome-providers/issues/16, https://github.com/Alibaba-Agent-Sandbox/registry/issues/13 and https://github.com/Alibaba-Agent-Sandbox/awesome-templates/issues/118. The published CLI 0.4.0 predates launch; until a new release, users must build the reviewed source as documented.

## Test Strategy

Focused integration: 54 passed / 1 conditional skip before the final readiness regression. Strict typecheck and build passed. ESLint passed with existing warnings. Official SDK project parser and host staging passed against a loopback protocol fixture. Full local transport checks are affected by the environment network interception; hosted Node 20/22 CI is mandatory. Real Express launch and native Docker validation are recorded separately once executed.

## Acceptance criteria

- Selecting source does not require manually copying a backend ID when preparation is supported.
- Provider policy remains with its owner; unsupported capabilities fail before resources are prepared.
- Documentation lists one-time credentials/tool/image prerequisites and artifact costs/cleanup.
- Required CI passes on the current PR head; owner PRs are merged in dependency order.
- Registry deployment ingests merged revisions and production readback verifies the published result.

## Evidence

See [verification](../../../evidence/verify/2026-10-19-provider-template-launch.md). Proposal status is retained until acceptance gates have actually passed.
