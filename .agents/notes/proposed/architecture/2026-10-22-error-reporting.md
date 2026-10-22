# Decision: Opt-out structured error reporting through FC and SLS

Status: proposed

## Problem
Maintainers cannot see the failures users encounter across native commands, the embedded CLI, Providers and MCP. Unbounded raw log upload can disclose secrets or expose a public ingestion endpoint to abuse. The requested first deliverable is a complete design.

## Decision
Specify minimal events built from an allowlist, an explicit disabling policy, bounded private spool/background delivery, a separately protected FC ingress, dedicated SLS retention/IAM and verifiable abuse controls. See the canonical [English design](../../../../docs/en/design/error-reporting.md) and [Chinese design](../../../../docs/zh/design/error-reporting.md). No reporter, configuration key, HTTP route or cloud resource is implemented or deployed by this proposal.

## API Design
Proposed only: `diagnostics.enabled`, `ABX_DIAGNOSTICS=0`, enrollment and versioned events routes, signed installation-bound requests and a schema without free-form messages. These are not supported current interfaces.

## Alternatives considered
- Shared secret embedded in a public CLI — extractable; cannot prove an authentic unmodified client.
- Anonymous raw async FC invocation — validation follows queue admission and cannot alone bound abuse/cost.
- Upload arbitrary stderr/stack/argv — leaks credentials and user data.
- Guaranteed delivery with zero latency — impossible under offline/crash/opt-out conditions; bounded best effort has explicit losses.

## Dependencies
FC HTTP ingress/log delivery, SLS, gateway authentication/rate controls, shared atomic replay/quota state, deployment IAM and privacy documentation. Implementation and real-service verification are follow-up work in https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/107.

## Test Strategy
Design review traces all error boundaries, opt-out precedence and races, privacy/schema, worker packaging, signing/replay, ingress bypass, quotas, retention and rollout. The document specifies concrete future unit/fault/load/npm/SEA and real HTTPS-FC-SLS acceptance gates. Documentation checks do not establish those runtime gates.

## Acceptance criteria
- Deliver consistent English/Chinese design with explicit current/proposed boundary and real primary sources.
- Explain encryption versus authenticity, no distributed shared secret, installation-key limitations and Sybil controls.
- Define disabling before first use, no raw messages/secrets, bounded delivery and preserved CLI output/status.
- Leave implementation/deployment acceptance open until real readback, no-request opt-out and performance/security gates pass.

## Evidence
- [Verification](../../../evidence/verify/2026-10-22-template-command-guidance.md)
