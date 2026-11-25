# Decision: Target-first Sandbox API operations

Status: proposed

## Problem

The public `sandbox command list/run` wrapper combines a specific Server SDK protocol with platform commands. The user approved `abx sandbox TARGET OPERATION`, target/operation help, explicit operation aliases, and OpenAPI as the application contract. Main has neither API contract ingestion nor target bindings, so a syntax-only rename would not deliver that interface. This change is tracked by [Issue 265](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/265).

## Decision

Reserve `sandbox TARGET [OPERATION]` for declared application operations. Move existing platform tools to root commands without renaming their underlying SDK/Provider APIs. Remove the old wrapper; do not guess whether a target name is a legacy command. Keep lifecycle commands as deployed on this baseline.

Import strict, bounded OpenAPI 3.1 contracts from `registry.yaml.apis`. Bind each selected logical resource to an existing actual Sandbox ID, Provider, routing snapshot and port. Save a private local contract snapshot; help reads only that snapshot. A single-Sandbox source deployment binds its optional contract from the same source snapshot that is deployed. Explicit binding for existing targets connects to establish identity and never starts a service. Resource labels are selectors, not a new resource deployment engine.

Resolve application endpoints through the selected Provider. Validate inputs before connection, verify ID/Provider/port before application credential resolution, preserve gateway headers and signed query bytes, and perform one bounded HTTP request. Do not probe Server SDK routes or fall back to envd/shell. Preserve HTTP status/body rather than adapting responses into the old registered-command envelope.

Credential references are granted explicitly by the local caller. A document cannot select a local secret. Support `env:NAME` and `config:server_token`, Bearer and header API-key schemes; refuse ambiguous configured alternatives and never downgrade after a failed request. This does not change the server's own authorization policy.

## API Design

- `abx sandbox TARGET --bind REGISTRY [--resource sandbox.NAME] [--credential API.SCHEME=SOURCE] [--alias NAME=API:OPERATION]` replaces a local binding.
- `abx sandbox TARGET --help` and `abx sandbox TARGET OPERATION --help` render the cached declaration without network or credential reads.
- `abx sandbox TARGET OPERATION [--api NAME] [--body JSON|@FILE] [--path K=V] [--query K=V] [--header K=V] [--timeout SECONDS]` invokes one operation.
- Raw IDs, qualified `provider:ID` and local deployment names resolve deterministically. Changed or unavailable named identities cannot reuse old bindings.
- `api_contract.ts` owns import/schema/operation preparation; `api_binding.ts` owns local associations; `openapi_http.ts` owns bounded transport; `sandbox_api.ts` owns CLI composition.

The initial executable subset uses JSON bodies, scalar path/query/header parameters, internal nonrecursive references and explicit values. External references, schema formats, automatic parameter sources/default insertion, multipart/SSE, cloud signing, OAuth and generic SDK invocation are outside this change. Unsupported semantic features fail rather than being silently simulated.

## Alternatives considered

- `registry-command list/describe` plus a second invocation tree adds another noun and separates help from its target. Target help provides discovery without a wrapper.
- Renaming `Sandbox.listCommands/runCommand` preserves a mandatory `/capabilities` + `/commands` protocol and cannot support ordinary REST applications.
- Trusting OpenAPI `servers` or credential extensions could redirect a bound call or grant ambient secrets. Endpoints remain Provider-owned and references caller-granted.
- Preserving both old and new `sandbox` grammars makes target names such as `exec` ambiguous. Platform tools have unambiguous root paths.

## Dependencies

Uses existing YAML, Ajv2020, Commander and Provider endpoint contracts. No package dependency/version changes or new cloud services. Server SDK routes and Python/Node SDK methods are unchanged. Generated Python/Node scaffolds include a matching OpenAPI declaration; independent catalog templates require their own declarations and are not claimed migrated by this CLI PR.

## Test Strategy

Two independent reviewers examined parser/UX and contract/auth boundaries before implementation and cross-reviewed the implementation. Regressions cover offline help, qualified IDs, name replacement, aliases through references, credential isolation, schema input checks, raw signed queries, response limits, no replay/redirect and preservation of platform preflight. Test actual local HTTP with a service that has no discovery endpoints. Run a narrowly scoped cloud workflow with a temporary Sandbox and independently confirm cleanup. Run source checks, packaging, capture current command help in a new evidence batch, and preserve earlier evidence.

## Acceptance criteria

- All described entry points are reachable; removed wrappers fail without executing a fallback.
- Help is useful for reference-based contracts and requires neither remote availability nor credentials.
- Input, binding and endpoint constraints hold before side effects or credential transmission.
- A successful real service call and authenticated rejection are observed, with cleanup recorded.
- Bilingual guidance and generated examples use the final command layout.
- Repository checks and required review/CI pass before merge. Unverified cloud behavior is not reported as delivered.

## Evidence

[Verification and review disposition](../../../evidence/verify/2026-11-25-sandbox-api-operations.md).
