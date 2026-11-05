# Decision: Complete current Express native management contracts

Status: proposed

## Problem

The current and legacy Alibaba Cloud management APIs expose the same operation names but different field and update semantics. The CLI loses requested build steps when a same-name template create falls back to update, omits JuiceFS and instance-count quota fields, and cannot express the complete native template configuration. Temporary AccessKey credentials also lose their STS SecurityToken before SDK requests.

Owner Issues: [template step loss #229](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/229) and [current Express API completion #230](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/230). The SDK dependency update overlaps [Dependabot #220](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/220).

## Decision

Use the current Sandbox API for native management and template workflows. Keep the previously published status-only Volume update as an explicit legacy request branch; never mix it with current storage/mount updates or replay a failed current request through the legacy API. Preserve all four storage configurations, current AgenticFS identity fields, storage-class filtering and the optional instance-count quota.

Add schema-described native template CRUD to the existing provider command catalog. Its mutation requests share the generated request boundary with existing template helpers. New template creation refuses name conflicts; existing deploy workflows retain their existing duplicate-name policy. Update steps preserve omitted versus explicit empty arrays. Runtime VPC/log configuration, OS type, registry authentication/network/certificate settings and storage-client build preparation use structured input, not additional top-level command trees.

Pass the selected STS credential with its matching AccessKey pair into management, template/cache/managed-key and ACR authentication. ACR temporary authentication does not fall back to a direct Docker login without its token. Registry passwords and JuiceFS tokens remain secret-bearing input; returned metadata is allowlisted and credentials are redacted.

## API Design

- `provider command run alicloud-express template.create|get|list|update|delete` uses strict nested snake_case input, explicit Team ownership and current generated wire aliases.
- `volume.update` accepts either legacy `status` alone or current storage/mount configuration. A mixed request fails before SDK loading. Current updates place Team in the query.
- `quota.update` still requires CPU/memory. Optional `instance_count` preserves the documented omission, -1, zero and positive-limit semantics.
- Template steps use `PublicUpdateTemplateStep` and preserve an explicitly supplied empty array.
- API Key policies returned beside `apiKey` normalize into the existing `ip_whitelist`/`ip_blacklist` output; explicit top-level arrays, including empty arrays, take precedence over embedded compatibility fields.
- Read projections preserve optional/empty VPC, log and registry-network metadata independently from the stricter mutation-input requirements.
- Shared STS configuration is owned by the Python configuration contract; this adapter consumes `security_token` without creating a second registry.
- The list descriptor keeps projected runtime metadata compact to respect the host's existing schema nesting bound. Execution still applies the complete typed native response allowlist.

## Alternatives considered

- **Replace package names without contract tests** — rejected: UpdateVolume body/query semantics differ, and SDK 1.2.0 does not contain the update-step model even though current metadata does.
- **Remove legacy Volume status input** — rejected: published callers would silently lose a supported operation. An explicit, mutually exclusive branch preserves compatibility.
- **Duplicate native cloud mappings in Python or Node** — rejected: provider management is already shared through the CLI engine catalog.
- **Add many CLI flags for every nested native template field** — rejected: structured provider input is discoverable and avoids flattening distinct runtime and registry networks.
- **Echo all new response fields unchanged** — rejected: JuiceFS tokens and registry credentials are not ordinary public metadata.
- **Infer cloud expiry success or OS admission from a client field** — rejected: the explicit empty expiry request is tested, but service effect and runtime qualification require separate verification.

## Dependencies

Pin `@alicloud/sandbox20260820` to 1.2.1, which contains `PublicUpdateTemplateStep` and its sandbox update field. Retain the legacy FCSandbox package for the compatibility branch. Regenerate the installed SDK graph's notices. Shared STS configuration is coordinated with [python-sdk](https://github.com/Alibaba-Agent-Sandbox/python-sdk); the adapter does not acquire or refresh credentials.

## Test Strategy

First run failing regressions against the fixed base, then use actual generated model classes and serializers with bounded fake clients to inspect current/legacy versions, path/query/body, response projection, credential construction and non-replay behavior. Test omitted/clear/changed steps, all native template operations, storage and quota additions, invalid IP policy, secret outputs and signed ACR temporary-credential requests. Execute the relevant existing provider, template, CLI and Docker suites; complete all owner gates and real-component acceptance separately.

Real native acceptance uses `e2e/express-management-completion.mjs`: isolated owned resources, independent SDK reads, actual sandbox build artifacts, a private recovery ledger and independently verified deletion. The verified v1 → same-name v2 → cleared-step artifacts establish the original deployment fix. Metadata-only Volume checks do not establish backing-storage mount behavior. The tested official-base image was rejected for caching by both the CLI and a separately authorized same-body official SDK control, so successful custom-image caching remains a service-fixture gate.

## Acceptance criteria

- Requested same-name update steps reach the actual generated wire body, including explicit clearing.
- Current Volume and quota inputs/outputs preserve the documented fields and sentinel values; legacy status updates remain explicit and non-fallback.
- Native template CRUD is discoverable without SDK loading and uses structured, bounded schemas and safe outputs.
- STS reaches every matching credential consumer without being displayed, logged or implicitly refreshed.
- IPv4/exclusive policy validation rejects incompatible inputs locally while preserving empty-list clearing.
- Bilingual usage, changelog, engineering records, required checks, independent review and real-component evidence are complete before merge.

## Evidence

- [Verification](../../../evidence/verify/2026-11-05-express-management-completion.md)
