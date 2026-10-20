# Decision: Include lazy Express SDK dependencies in standalone artifacts

Status: proposed

## Problem

The standalone executable can describe Express management operations but fails when
an official SDK-backed operation is invoked outside the checkout. Bound
`createRequire(import.meta.url)` calls are runtime package lookups, so esbuild does
not embed their dependencies. Both management and template SDK loaders use this
pattern. A version-only artifact smoke test cannot detect the failure.
Actual package acceptance also revealed that the existing `dist-check` helper
assumes npm's older array report, while npm 12 returns an object keyed by name.

Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/85
Release tracking: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/66

## Decision

Keep the synchronous, lazy loaders and existing test seams inside the Express
adapter. Use literal global `require` calls when a CommonJS runtime is present so
esbuild can resolve them, with `createRequire` as the native ESM fallback. No
vendor dispatch or cloud implementation moves into generic core code.

Add an isolated bundle execution regression for both SDK adapters. Extend
`abx --licenses` with the official SDK dependency graph's shipped license/README
notices and package declarations, generated from the installed locked graph.
Preserve inconsistent upstream declarations verbatim; this supplement is not
represented as a complete CLI SBOM.
The generated text is a distribution asset in `src/licenses/`; the executable
does not import concrete Provider implementation modules to render licenses.
Keep the package entry-point gate effective across both npm report shapes using
a small stdin JSON validator; missing entry points and invalid reports fail.

## API Design

Existing `_requireSdk()` return values and `_sdkLoader.load` synchronous seams
remain unchanged. CLI operation names and inputs do not change. The only output
addition is dependency attribution in `abx --licenses`.

## Alternatives considered

- **Eager static SDK imports** — would initialize dependencies during unrelated
  command discovery and change the existing lazy loader contract.
- **Distribute external node_modules beside SEA** — defeats standalone delivery
  and leaves existing one-file installers incomplete.
- **Replace the official SDK with generic core HTTP calls** — duplicates provider
  authentication and API mapping instead of fixing artifact construction.

## Dependencies

The existing locked FCSandbox/OpenAPI runtime packages and esbuild. No dependency
version changes are required. Attribution generation examines only this SDK's
bundled runtime graph.

## Test Strategy

First demonstrate that the isolated CommonJS bundle cannot load either adapter
before the fix. After the change, construct actual generated SDK requests and
clients from that copied bundle without repository dependencies. Retain existing
management/template unit coverage, check generated attribution, build npm and
Linux SEA artifacts, and verify a read-only official operation from isolated
installations. Run repository checks and distinguish baseline network failures
from passes. Remote Node 20/22 and other native platforms remain separate gates.

## Acceptance criteria

- The isolated SDK regression fails before the fix and passes afterward.
- Both loaders retain lazy synchronous behavior and existing seams.
- A copied Linux SEA executes authorized read-only management operations without
  an external dependency directory; npm installation behavior remains valid.
- SDK dependency attribution is included in npm and SEA license output.
- Tests, bilingual installation guidance, changelog, and verification evidence
  accompany the change; incomplete gates remain explicit.

## Evidence

- [Verification](../../../evidence/verify/2026-10-20-bundled-provider-sdk.md)
