# Decision: Unify CLI operation ownership before extending provider commands

Status: proposed

## Problem

The E2B migration implementation and the native provider implementation currently expose two command frontends. The standard frontend preserves pinned E2B behavior; the native frontend supplies project extensions and non-Express providers. Their lifecycle, terminal, parser, output and error contracts are not interchangeable. A provider manifest or typed command registration alone cannot implement a missing common operation, determine account availability, or justify invoking the Express backend.

The multi-agent review found configuration and argument-routing defects as well as independent pre-existing feature-gating and layering defects. Targeted fixes must not be mistaken for completion of this architecture proposal. The companion SDK owns its own design: https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/47.

## Decision

Keep the pinned standard protocol implementation and explicit project extensions. Introduce a single ownership boundary before any command can perform side effects. This is a staged proposal, not a description of an already unified implementation.

1. Parse an invocation once into an immutable provider context, qualified resource, operation, local options, output policy and remote argv. Resolve configuration values and their provenance from the same source snapshot. Output flags must never change lifecycle or backend selection.
2. Map common operations to explicit provider adapters. Every supported operation needs both a declared contract and an executable handler; unsupported operations fail before network requests or template generation. Preserve pinned E2B behavior on the supported Express migration surface. Report incompatible backend semantics explicitly rather than inventing equivalence.
3. Separate feature declaration, adapter implementation and conditional availability. A condition result distinguishes supported, unsupported, unknown and unavailable with a reason and prerequisites. Discover only through documented backend APIs or explicit configuration; an absence of discovery must remain unknown. Avoid eager cloud probes on every help invocation.
4. Keep backend-specific control-plane operations in a provider namespace. Typed registration supplies discovery, argument schemas and handler binding; it does not wire common lifecycle commands or prove that credentials/runtime prerequisites are satisfied. Never borrow another provider's implementation.
5. Define template operations separately: build an image, register a template, and deploy project server configuration are different contracts. Add an adapter for each supported operation instead of routing a generic templates flag to FC/ACR.
6. Once the common boundary has product-level regression coverage, remove redundant native implementations of standard operations. Preserve historical evidence. Do not rewrite imported/generated source for cosmetic consistency.

## API Design

Proposed internal concepts are `ResolvedInvocation`, `ProviderContext`, operation descriptors and availability results. These names are design placeholders, not public exports. A resolved invocation contains exactly one provider identity and one configuration result. Common-operation adapters consume that identity instead of re-reading ambient defaults. Remote argv remains opaque after the sandbox-ID boundary.

The standard Python `Sandbox` and `AsyncSandbox` remain pinned E2B clients; `ProviderSandbox` remains the explicit provider API. Switching ABX_PROVIDER must not secretly change their protocol or return models. Python changes belong to the SDK repository.

## Alternatives considered

- Keep adding special cases to both parsers: rejected as the long-term design because selection, aliases, global options and remote argv drift independently.
- Treat every feature flag as a runnable operation: rejected because declaration, execution and runtime/account availability are distinct.
- Route missing provider operations to Express: rejected because resource ownership and credentials would change implicitly.
- Make the standard SDK a dynamic provider proxy: rejected because synchronous behavior, result/error models and protocol compatibility would change.
- Rewrite the pinned protocol source port immediately: rejected; it would remove the migration oracle while adding implementation risk.

## Dependencies

- CLI migration and scoped ownership fixes: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/40.
- Pending typed management registration: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/35 and https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/38.
- Actual provider manifests and adapters in https://github.com/Alibaba-Agent-Sandbox/awesome-providers.
- Documented backend/runtime/account support; no fabricated discovery endpoint.

## Test Strategy

Create a product-entry matrix across Express, OpenSandbox and feature-limited fixtures. Cover provider sources, explicit overrides, qualified references, root flags, aliases, remote flags, and unsupported operations. Assert both selected backend and absence of unintended requests. Verify common pause/resume, timeout, PTY and template behavior against actual enabled providers. A fixture validates routing, not a live OpenSandbox server.

Add regressions for terminal feature gates and resume permission/error handling before enabling their operations. Add static layer-dependency checks after moving pure helpers below API. Test installed npm artifacts and a Linux SEA in PR CI, then all supported binary platforms before release. Audit notices from final bundle inputs, including upstream prebundled dependencies; the known 17-package notice fix is not a complete SBOM audit.

## Acceptance criteria

- Output/diagnostic options never select a different lifecycle implementation.
- Explicit provider selection determines both execution and configuration; every qualified namespace is resolved or rejected before backend work.
- Supported common operations have a handler and product-entry regression; unsupported or conditional operations explain the exact limitation.
- Native pause/resume and provider-backed PTY are either implemented with real-backend evidence or explicitly unavailable; metadata does not advertise CLI coverage by implication.
- Feature checks cannot be bypassed by direct terminal construction, and resume does not swallow authentication, authorization or server errors.
- Protocol/transport modules have no imports from the API layer.
- Bilingual architecture and command docs reflect the real entry points; source-port maintenance, complete artifact notices and release gates are reproducible.
- Original conditional Express snapshot/pause success cases remain open until tested with enabled account/runtime fixtures. PRs stay draft while mandatory acceptance gates remain unmet.
