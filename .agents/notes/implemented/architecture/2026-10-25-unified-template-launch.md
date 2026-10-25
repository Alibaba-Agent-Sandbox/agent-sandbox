# Decision: Launch a complete template without workflow selection

Status: implemented

## Problem

A single template required authors and users to select application, execution or interpreter workflows, duplicating service and platform preparation declarations. This obscured the expectation that launching a template starts its whole application.

## Decision

Use spec v5 with existing `provides`, `start_cmd` and `ready_cmd`. Remove selectable workflows from current runtime manifests and launch commands. Derive preparation from source or a fixed image/owned managed reference. Start once, run declared readiness checks, resolve all service addresses, and verify known Agent Sandbox Server v2 endpoints using health/discovery without invoking business commands. Other protocols are not automatically probed. Preserve Provider preparation, immutable snapshots, resource journals and owned cleanup.

## API Design

`validateTemplateManifest(manifest)` validates spec v5; `planTemplateLaunch(manifest, provider, consumer, prepared=false)` returns supported, required operations, missing operations, services and an optional incompatibility reason. `template launch TEMPLATE_REF` has no workflow or external-service selector. Provider installation metadata remains compatible. Historical v4 receipts and their readers remain historical.

## Alternatives considered

- Hide the default selector but retain multiple workflow definitions: rejected because it preserves author complexity and duplicated execution paths.
- Infer extra platform capabilities from installed packages: rejected because installed software does not implement Provider adapters.

## Dependencies

Canonical launch contracts are owned by [Python SDK](https://github.com/Alibaba-Agent-Sandbox/python-sdk/tree/283ff91dae79ffaf0e27c5503b1c7788bdc26de7/contracts). Template v5 publication and Registry consumers must be coordinated. See [Issue 151](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/151).

## Test Strategy

Run shared cross-language vectors, launch lifecycle regressions, migration rejection, all-service endpoint and known-protocol verification and catalog-managed launch tests; preserve uncertain-create and cleanup regressions. Run CLI checks, evidence capture and real Provider startup before delivery.

## Acceptance criteria

Current launch has no workflow selector; all services are retained and resolved, declared readiness checks run, and known server v2 endpoints receive health/discovery checks; fixed managed catalog entries launch by name; v4 gives a migration error. Shared contracts match the pinned owner, repository checks pass, and real-component evidence is recorded before merge.

## Evidence

- [Contract foundation](../../../evidence/verify/2026-10-25-unified-template-contract.md)
- [Runtime and CI](../../../evidence/verify/2026-10-25-unified-template-runtime.md)
- [Real Express startup and cleanup](../../../evidence/verify/2026-10-25-unified-template-cloud.md)

## Publication

CLI 0.5.0 was published from merge `408e618f38c11e5df98f0e6fb859465060f4fdb8`. The subsequent public managed-name lookup defect is corrected separately by 0.5.1; see the [release and managed-catalog evidence](../../../evidence/verify/2026-10-25-cli-051-managed-catalog.md).
