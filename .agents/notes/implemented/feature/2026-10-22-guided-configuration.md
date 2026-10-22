# Decision: Guide operation-specific configuration before execution

Status: implemented

## Problem

Missing configuration stopped template deployment one field at a time and allowed a following, independent create command to reach an E2B-branded login prompt. Registered Provider settings could use environment names that neither consumer read; blank interactive input could remove an existing secret. CI and machine output could enter configuration questions. Configuration readiness, project creation, editor registration, artifact generation, and remote service success were not clearly distinguished.

[Issue #99](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/99) owns this change. The preceding three-round audit identified G01–G30 configuration, prerequisite, source-diagnostic, and recovery scenarios. This record describes the implementation and acceptance boundaries in this repository; it does not certify a cloud account, claim publication, or substitute for the final verification evidence.

## Decision

Use a project-owned preflight that derives requirements from the selected Provider and current execution plan. Parse help and syntax, validate ownership/capability and local inputs, resolve effective configuration and its sources, then collect only missing values when human interaction is permitted. Execute the original action once with the resulting operation-scoped snapshot. Do not convert arbitrary backend exceptions into a setup-and-replay loop.

Configuration input requires terminal stdin/stdout/stderr and excludes CI, JSON, quiet, existing yes modes, and protocol execution. Business commands choose one scope: temporary for this operation, explicit user persistence, or cancel. Explicit configuration commands already express persistence intent. Input remains hidden for secrets, invalid typed input can repeat, and empty interactive input preserves existing values or cancels missing-value collection. Required false/zero values remain configured.

Temporary values use AsyncLocalStorage and do not mutate process environment or user files. Legacy and layered loaders consume the same explicit operation snapshot; profile-only consumers read it too. Provider fields use their own schema, including fields that share core names. A complete authentication alternative satisfies the Provider contract without requiring another. Known invalid sources stop preflight rather than becoming missing values after coercion fallback.

Persistent writes use canonical schema storage and an actual destination report. Single-file replacement is atomic; the batch is not transactional. Commit a new canonical credential before removing its old copy. Cleanup failures report that the new value may already exist. Invalidate both configuration systems and read back effective values before continuing. Higher-priority environment/project sources retain precedence. Corrupt or unreadable files are diagnosed without secret contents and are not rewritten as empty documents.

Standard ABX authentication is isolated from unrelated E2B user login files, while documented standard parser/compatibility inputs and retained upstream attribution remain intact. Generated standard changes remain subject to the pinned provenance and replay gates. Provider selection never falls back to a different backend to satisfy configuration.

Build checks depend on the actual plan. Platform steps do not require Docker/ACR. Official Dockerfile deployment checks platform registration credentials before building or pushing. Local project preparation preserves explicit malformed inputs and existing overwrite authorization. Local-tool rechecks happen before side effects. Later failures retain generated files and known references rather than replaying completed mutation stages.

MCP editor registration can remain offline and does not copy Sandbox keys into IDE files. STDIO execution never enters terminal setup. HTTP setup preserves non-loopback Bearer authentication. Deployment artifact creation requires client authentication and may remain explicitly unready for Sandbox access; artifact output distinguishes generated files, deployment, and service verification. A deployment artifact can contain credentials because it is the explicit deployment destination.

## API Design

CLI-owned configuration orchestration:

```ts
withGuidedConfiguration<T>(
  ctx: Context | undefined,
  request: ConfigurationRequest,
  action: () => Promise<T>,
): Promise<T>;
```

`ConfigurationRequest` carries the operation, selected Provider, required field descriptors, original explicit overrides, optional existing adapter values, yes mode, and Provider-validation policy. `GuidanceField` can mark an operation-only input as nonpersistent and attach existing option/environment guidance. The action is never retried by this wrapper after execution begins.

The lower-level operation context has no prompting or I/O:

```ts
getOperationConfig(): Readonly<Record<string, unknown>> | undefined;
withOperationConfig<T>(values: Readonly<Record<string, unknown>>, action: () => T): T;
```

`loadConfig`, `loadLayeredConfig`, and CLI profile lookup consume this context within their existing return models. Provider-specific keys remain in Provider options except declared bundled legacy fields. Same-named Provider fields do not acquire core defaults or unrelated global credentials.

`canPrompt` centralizes interaction policy. `saveGuidedValue(key, value, providerId?)` writes a supported typed setting without printing its value and returns `{path, key, section?}`. Provider configuration helpers expose the actual storage location and selected initialization authentication keys. `ConfigurationCleanupError` distinguishes an already-written canonical value from failed previous-copy cleanup.

`assertConfigFilesReadable` and `assertConfigValuesValid` diagnose source readability, syntax and highest-priority explicit values without returning raw secret text. `configurationTargetSummary` formats effective Provider/region and sanitized API host for explicit configuration commands. No cloud endpoint, permission grant, new resume command, SDK wire format, or Provider protocol is introduced.

## Alternatives considered

- Print another isolated error and ask the user to rerun manually: leaves the same one-field-at-a-time setup failure and stale-consumer risk.
- Prompt from a global exception handler: confuses permissions/network errors with missing values and can replay cloud mutations.
- Save every entered value automatically or modify process environment for temporary scope: violates the selected scope, Provider isolation, and later-process expectations.
- Treat yes/CI as permission to wait for secrets: changes existing automation behavior and can hang scripts.
- Remove standard attribution or redirect users to E2B login: confuses retained compatibility code with the service's actual authentication ownership.
- Rewrite all legacy SDK configuration semantics: expands scope unnecessarily; the CLI operation context bridges consumers while preserving their existing contracts.
- Claim multi-field atomic persistence or cloud readiness from local validation: neither follows from a successful single-file write or complete local field set.

## Dependencies

Existing Provider schemas and authentication alternatives, command contexts and output manager, prompt/masked-input implementations, configuration metadata/resolver, TOML/dotenv parsers and targeted writers, AsyncLocalStorage, and existing template/MCP adapters. The pinned standard source build and its license inventory remain authoritative for generated frontend changes.

User documentation is mirrored in [English](../../../../docs/en/guide/guided-configuration.md) and [Chinese](../../../../docs/zh/guide/guided-configuration.md). Related contracts remain in the [configuration reference](../../../../docs/en/reference/configuration.md), [Provider guide](../../../../docs/en/guide/providers.md), [migration guide](../../../../docs/en/guide/migrate-from-e2b.md), and [MCP guide](../../../../docs/en/guide/mcp-integration.md).

## Test Strategy

Keep the three-round design inventory separate from delivered verification. Run regression tests through actual command objects and real configuration consumers, using isolated temporary homes and placeholder values. Use real files for storage, source precedence, special characters, permissions, corruption and readback. Inject controlled failures where a filesystem or remote error must be deterministic; do not call those tests real-cloud evidence.

`test_guidance_contract.test.ts` exercises temporary and persistent scope across legacy/layered/profile consumers, nested stages, auth alternatives, dynamic same-name fields, stale adapter values, validation, cancellation, source errors, save failures, and action execution count. `test_configuration_setup_regressions.test.ts` exercises actual configuration commands, built-in storage metadata, empty input, explicit deletion, typed false/zero values, canonical migration failure, source diagnostics, and machine modes. Retain existing masked-input PTY tests and credential-priority integration tests.

Template, standard frontend, MCP and artifact tests must cover their owning entry points, parser/help ordering, steps/Docker distinction, registration readiness, E2B file isolation, and reproducible generated source. Run the full repository gates, current-head CI matrix, affected CLI evidence capture and artifact checks. Real credential validation and real cloud lifecycle verification are separate final gates owned by the task coordinator; they are not asserted complete by this note.

## Acceptance criteria

The scenario groups retain their audit identifiers so implementation and evidence can be checked together:

| Audit coverage | Acceptance boundary |
| --- | --- |
| G01–G03 | Standard/native/qualified routes keep Provider ownership; missing sandbox versus official API identity is explained correctly; help and invalid syntax never ask for secrets. |
| G04–G08 | Requirement sets match Dockerfile, steps, push, legacy and existing-image paths; detect required registration credentials before Docker side effects; do not invent universal registry authentication. |
| G09–G13 | Launch/generation inspect requirements by safe stage; local/dry-run/download-only work avoids cloud setup; GitHub recovery is bounded to safe reads and preserves error categories. |
| G14–G16 | Missing projects/build files and local Docker receive explicit recovery choices; existing file/symlink/overwrite protections remain; LLM input/model/endpoint diagnostics do not replay completed generation. |
| G17–G19 | Dynamic required fields and one satisfiable auth group can be configured; unsupported capabilities remain errors; explicit init/set is typed, cancellation-safe and truthful about readiness. |
| G20–G23 | MCP offline registration/artifacts distinguish readiness from deployment; IDE files do not embed Sandbox keys; STDIO never prompts; HTTP/non-loopback and artifact client authentication remain required. |
| G24–G26 | Effective target/source context precedes secret collection; existing defaults avoid extra questions; optional business configuration, permission/quota/TLS/network failures are not treated as missing credentials. |
| G27–G30 | Temporary values actually reach consumers without environment mutation/persistence; saved values are read back with source conflicts identified; no mutation replay, no aggregate login loops, no unrelated E2B login inheritance, and no silent corruption/invalid-value fallback during setup. |

All applicable repository gates and real-component evidence must identify passes, failures, skips and limitations separately. Implementation acceptance is supported by three independent implementation-review rounds, the implementation-commit Node 20/22 CI gates, and recorded real terminal, filesystem, Sandbox lifecycle and platform-steps deployment evidence. Final-head checks, merge and release are separately verified by the task coordinator; this status does not assert that a PR merged or a package was published.

## Evidence

- [Verification receipt](../../../evidence/verify/2026-10-22-guided-configuration.md) records executed checks, real-cloud cleanup and outstanding final gates without claiming merge or publication.
