# Decision: Complete Express runtime operations and private gateway access

Status: proposed

## Problem

The Express adapter exposes named mount creation but has no declared runtime append operation, cannot replace egress policy through the shared engine catalog, and lacks a discoverable TTL command. Qualified native pause/resume routes have no native lifecycle implementation. Native create cannot supply the documented network body, while create responses discard the gateway token needed for private application URLs.

Owner Issue: [Express API completion #230](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/230). The pre-implementation adversarial review distinguished runtime data-plane operations from native management APIs, and gateway traffic authentication from envd and application authentication.

## Decision

Add three schema-described provider commands to the existing shared catalog: append mounts, replace egress configuration and set TTL. Validate before resolving a prepared Sandbox API key. Reuse the existing resolver without authorizing Key creation or renewal. Mutations are never replayed automatically, including after ambiguous timeouts.

Keep the default standard CLI behavior and generated bundle intact. Explicit native create accepts a network file. Provider-owned validation and encoding preserve the dependency direction: core CLI/API use the provider contract and opaque optional network input, while Express owns its schema. Native pause/resume/timeout select the declared provider, preserve qualified-resource ownership checks and do not GET-connect the sandbox first.

Preserve a live traffic token in memory and pass it only to the public application gateway header. GET attach remains read-only and does not overwrite a known token when the response omits it. Token export is explicit, exclusive and private; normal output and session files do not persist it.

## API Design

- `sandbox.mounts.append` accepts named mounts and inline OSS, AgenticFS, AgenticBucket and JuiceFS configuration. It sends one POST and accepts the documented empty 204 acknowledgement. Existing mounts, roles and VPC remain service-owned.
- `sandbox.network.update` requires an explicit replacement object. `{}` clears rules; creation-only ingress fields are rejected. Runtime wire spelling follows the standard API's mixed `allow_internet_access` and `allowOut`/`denyOut` names.
- `sandbox.timeout` sets seconds through POST without connecting, resuming or extending a second time on failure.
- Native `--network-file` passes top-level create network settings through the Express protocol. Private ingress requires secure envd access. Existing reserved metadata remains available for VPC/direct storage configuration.
- Native `sandbox pause|resume|timeout` use declared provider commands and return acknowledgement only. Bare default standard commands retain their existing semantics.
- `--traffic-token-output FILE` reserves a new 0600 file before creation; export failure triggers cleanup of the newly owned sandbox. `--traffic-token-file FILE` accepts a private regular file for application calls and rejects symlinks. Neither option places the token itself in argv.
- Optional PortContext traffic data defaults to absent, preserving other providers' behavior. Gateway, envd, Sandbox API and application tokens remain independent.

## Alternatives considered

- **Arbitrary HTTP escape hatch** — rejected: it bypasses discoverable schemas, effects and ownership boundaries.
- **Implicit POST connect to obtain traffic credentials** — rejected: it can resume or extend an instance during an application read path.
- **Merge policy with a GET** — rejected: the service operation replaces configuration and concurrent edits would race.
- **Automatically prepare management Keys** — rejected: generic mutation confirmation is not consent to account credential creation or renewal.
- **Put traffic credentials in ordinary provider results or sessions** — rejected: those surfaces are printed or persisted by existing consumers.
- **Import vendor network schema into core CLI/models** — rejected: validation belongs behind the provider contract; isolation tests enforce this boundary.

## Dependencies

Existing Express data-plane endpoints, managed-Key resolver, provider command engine, native command surface and shared e2b protocols. No new endpoint, third-party runtime dependency or generated standard bundle change is needed. Python consumes the same catalog; its typed lifecycle/session binding changes are recorded in its owning repository.

## Test Strategy

Run initial missing-operation regressions before implementation. Verify exact paths, methods, JSON aliases and empty-response handling with an intercepted real HttpClient boundary; check invalid input before credentials/I/O, secret-free errors, no replay, deadlines and late credential cleanup. Exercise native qualified routing and conflicts, create network forwarding, private gateway/envd separation, GET token retention and exclusive file behavior. Run adjacent lifecycle, CLI dispatch, isolation and provider tests. Capture source help and catalog without credentials. Full owner checks and real service behavior remain separate gates.

## Acceptance criteria

- All three runtime commands are credential-free discoverable and shared by CLI/Python engine consumers.
- All documented mount types, whole-policy replacement, explicit clearing and TTL reach their correct data-plane endpoints without replay.
- Qualified lifecycle verbs preserve ownership conflicts and do not create a preliminary session.
- Native network creation and private gateway access preserve independent credentials and explicit file handling.
- Bilingual usage, engineering evidence, full checks, independent review and real service acceptance are complete before merge.

## Evidence

- [Local verification](../../../evidence/verify/2026-11-05-express-runtime-completion.md)
- [Source CLI help and catalog](../../../evidence/cli/2026-11-05-express-runtime-completion/help-and-discovery.md)
