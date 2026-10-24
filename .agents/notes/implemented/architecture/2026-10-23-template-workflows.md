# Decision: Plan template workflows independently from runtime offerings

Status: implemented

## Problem

A template-provided Python application was treated as requiring the provider's unified interpreter. Coarse capability labels conflated image contents, application protocols, adapter operations and consumer bridges. HTTP 404 execution fallback also silently changed interpreter semantics.

## Decision

Consume the versioned operation rules and acceptance profiles owned by [python-sdk/contracts](https://github.com/Alibaba-Agent-Sandbox/python-sdk/tree/main/contracts). Use one standalone pure planner for CLI and registry consumers. Validate spec v4 workflows, derive only the selected path's dependencies, and keep environment checks separate. Runtime declarations must agree with installed manifests and real handlers. Reject retired machine fields without a compatibility mode.

Lock build sources and provider code into execution snapshots. Persist owned-resource intent before preparation/create requests; uncertain outcomes require reconciliation. Resolve application HTTP by sandbox/port binding, preserve proxy path/query, isolate credentials, and refuse redirects or anonymous retries. Stateless interpreter execution uses an isolated explicit context and cleanup; default-context execution is a distinct operation. Standard client sources and attribution remain unchanged.

The initial native Express workflow consumer supports managed inputs only. Its independent build commands are not silently reused as workflow source preparation. The guessed Connect interpreter implementation and its runtime exports are removed; Express, REST presets and the E2B catalog consumer cannot advertise those code operations. Real provider-owned default-context HTTP handlers remain separate from stateless and explicit-context support.

Provider code identity uses the shared path-NUL-bytes-NUL encoding. The install integrity digest is an additional runtime mutation fence. New operation/input/startup declarations participate in installation consent and update risk assessment. Application engine routes use `/application/commands` so an application command named `run` cannot enter the shell route.

## API Design

`validateWorkflowManifest(manifest)` validates new workflow fields. `planWorkflow(manifest, provider, workflowId, consumer)` returns deterministic T/F/U requirements using adjacent canonical JSON rules. `NetworkModule.resolveEndpoint(port)` returns a structured private endpoint. `ResourceJournal` persists intent, created identity and recovery state without credentials. Sandbox creation carries journal and intent IDs as correlation metadata. Explicit build profiles select an unmodified root Dockerfile.

## Alternatives considered

- **Remove the code gate alone** — does not implement the application HTTP path or truthful consumer support.
- **Keep legacy schemas/fallbacks** — conflicts with the prerelease contract reset and can silently change execution semantics.
- **Fork registry planning rules** — permits directory/runtime disagreement.

## Dependencies

The Python-owned workflow IDL, conformance vectors and profiles; spec v4 templates; provider operation and workflow declarations; existing CLI infrastructure and standard client provenance.

## Test Strategy

Run shared vectors across Python and Node, operation/context regressions, bound application transport security tests, source/provider snapshot mutation tests, preparation/create uncertainty and cleanup checks. Run repository tests, type checks, lint, package build and record hygiene; record real component limitations explicitly.

## Acceptance criteria

- Application paths do not require interpreter operations unless explicitly selected.
- Missing operations, input kinds and startup modes fail before billable actions.
- Application requests preserve exact bindings and never retry anonymously or follow redirects.
- Interpreter failures never invoke shell execution; stateless contexts are cleaned on failure.
- Shared vectors match exactly; immutable inputs and owned-resource recovery are observable.
- Required local/remote checks and real-component verification pass before acceptance.

## Evidence

- [Issue #118](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/118)

- [Verification](../../../evidence/verify/2026-10-23-template-workflows.md)

## Implementation

Delivered in [PR #121](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/121); actual merged state was checked on 2026-10-24. Later acceptance and current limitations are indexed in the [current synchronization record](../../../evidence/verify/2026-10-24-current-docs-and-records.md). Earlier verification files remain unchanged and retain their original pending or failed observations.
