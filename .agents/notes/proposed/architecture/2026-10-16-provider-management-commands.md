# Decision: Discover and invoke typed provider management commands

Status: proposed

## Problem

The fixed CLI and shared sandbox feature registry do not provide a contract for provider-specific
cloud management. The built-in provider advertises storage/domain/VPC tokens without callable
standard protocols. Users need discoverable Volume and related FC management operations, while
cloud-specific APIs must not replace core commands or sandbox runtime application commands.

## Decision

Implement the separately versioned `provider-commands/1` descriptor contract and fixed
`provider command list|info|run` namespace. One host API validates inputs/results, isolates
configuration, redacts credentials, dispatches declared Node/exec handlers and bounds execution
and cleanup. Engine routes reuse that API; Python is a thin client. Full metadata participates
in install/update consent. Remove unsupported storage/domain/VPC tokens from the built-in
standard-protocol claim; expose only verified management operations through command discovery.

Map 20 official SDK operations for volumes, teams, API keys and quotas. Key creation/reset
requires an exclusive local secret file with mode 0600; no raw secret appears in responses.
Custom-domain automation remains unavailable until a documented callable Agent Sandbox API
is established. Do not substitute ordinary FC Function domain APIs or fabricate endpoints.

Final review found that Volume creation did not provide a way to mount it: the existing
sandbox-create model silently omitted mount configuration. Add an optional `volume_mounts`
path-to-Volume-name map and repeatable create flag `--volume-mount PATH=NAME`. The built-in
FC request serializes the documented `volumeMounts: [{name, path}]`; defaults keep the previous
payload. Validate before infrastructure setup, reject unsupported provider mappings and duplicate
CLI paths, and preserve the distinction from an unimplemented dynamic `storage.mount` protocol.
An opt-in real mount scenario must verify the actual mount before exclusive sentinel-file I/O
and clean up only its own file and sandbox. This remains blocked without real test storage.

## API Design

- Contract: `src/providers/command_contract.ts`; optional manifest `[commands]` protocol/entries.
- Public API: `listProviderCommands`, `getProviderCommand`, `runProviderCommand`.
- Node infrastructure: optional `provider_commands.run(command, input, signal)`.
- EPP: `provider.commands.run` with `{command, input}`; only declared IDs are allowed.
- CLI: `abx provider command list|info|run PROVIDER [COMMAND]`; writes/deletes require `--yes`.
- Engine: authenticated GET discovery/info and POST invocation under `/v1/providers/:id/commands`.
- Specification: [English](../../../../docs/en/design/provider-commands.md),
  [Chinese](../../../../docs/zh/design/provider-commands.md), and
  [FC capability matrix](../../../../docs/en/design/alicloud-provider-commands.md).

## Alternatives considered

- Dynamic top-level command injection: conflicts with fixed CLI surface and core ownership.
- Arbitrary SDK/RPC/HTTP passthrough: lacks stable schemas, capability gates and consent boundaries.
- One cloud implementation per SDK: creates mapping drift and retry differences.
- Implicit account-management MCP tools: grants new authority to existing sandbox integrations.

## Dependencies

Direct locked Ajv 8 dependency; existing official FCSandbox SDK and Zod. Python shared contract
and client are tracked in [python-sdk #34](https://github.com/Alibaba-Agent-Sandbox/python-sdk/issues/34).
CLI owner Issue: [#30](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/30).
Domain API prerequisite: [#32](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/32).
Review delivery: [CLI PR #35](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/35)
and [Python PR #38](https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/38). Both remain
drafts until required acceptance checks are complete; shared contracts land before consumers.

## Test Strategy

Independent audits covered CLI registration, authoritative cloud interfaces, and cross-language
contracts before implementation. Disjoint implementation ownership and independent review found
and corrected cleanup hangs, skipped resource cleanup, secret-bearing object keys, schema-cache
retention and unsafe key-rotation output. Tests cover bounded schemas, legacy manifests, update
consent, real Node/EPP execution, CLI/loopback routes, errors, cleanup and official model mapping.
New black-box scenarios exercise static discovery/guards and actual FC management reads.
Cloud writes, storage prerequisites, full repository gates and consumer parity are separate checks.
Verification must isolate sockets and temporary roots per run and serialize suites sharing
fixed ports. Effect metadata does not sandbox trusted provider code; IAM/RAM remains an
authorization boundary, as clarified in both language versions of the specification.

## Acceptance criteria

- Fixed core command surface and existing sandbox application commands remain compatible.
- Static discovery requires neither credentials nor plugin import/network access.
- Invalid/undeclared inputs fail before I/O; result/schema and credential protections are verified.
- Writes require explicit frontend confirmation; no management invocation is automatically replayed.
- Every owned resource is independently closed with a bounded cleanup deadline.
- Published FC operations match official request models; unsupported domain APIs are explicit.
- FC create-time Volume mounts reach the documented request field; real acceptance verifies
  a mount rather than treating an ordinary local directory as storage.
- Python contract/consent and real engine integration agree with this host.
- Required local, real-component and remote checks pass, and the scoped PR is reviewed before merge.

## Evidence

[Verification](../../../evidence/verify/2026-10-16-provider-management-commands.md).
[Final review and mount verification](../../../evidence/verify/2026-10-16-provider-management-final-review.md).
This decision remains proposed while required verification or API prerequisites are outstanding.
