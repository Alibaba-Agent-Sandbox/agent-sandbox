# Decision: Automatic application authentication for template launch

Status: proposed

## Problem

Template users must repeatedly choose configuration scope and understand an internal application token. CLI0.5.8 explains the token but keeps a second prompt and prints unrelated managed-key details. The user requested default local persistence, concise relevant prompts and automatic application authentication.

## Decision

When a template declares application authentication, the CLI resolves explicit runtime input, the caller environment and saved configuration first. With no configured credential, it generates32 cryptographic random bytes, saves the hex token using the existing protected user credential writer, verifies that it can reload the same value, and only then permits template preparation and creation. Startup verification and later CLI commands reuse the credential. Interactive configuration now saves supported values to the protected current-user configuration by default, without a scope selector. Existing explicit options and environment values remain temporary overrides and are not copied into saved configuration. Application setup does not ask another question. Default output contains concise target/source information and a save confirmation; detailed diagnostics use verbose output. Provider-managed key creation/renewal still requires the existing explicit consent or --ci. Provider-sensitive identifiers retain hidden input. Existing configured tokens are not rotated, and invalid explicit values fail closed. No cloud management API key is generated or renewed.

## API Design

The existing CLI-only `withTemplateEnvironment` signature remains compatible. No SDK, provider, server authentication, endpoint or wire contract changes. The lower-level template environment resolver still requires an explicitly supplied runtime token. Optional caller-owned tokens remain supported for external clients. A local save/reload failure stops before resource submission and provides a fixed, non-sensitive diagnostic.

## Alternatives considered

- Another explanatory token prompt: retains the reported product friction.
- Disable application authentication or reuse a platform/model key: violates credential separation and application authentication.
- Generate a process-only token: loses application access from later CLI processes.

## Dependencies

Node crypto and the existing CLI credential storage/resolution. No dependency, template manifest, provider receipt or release-version change.

## Test Strategy

Cover local/remote source launch, default provider-key persistence and temporary override isolation, automatic and explicit credentials, protected storage, reuse, invalid input, persistence failure and cancellation. Preserve historical golden captures and add a dated create-help snapshot. Run real POSIX terminal onboarding and actual Express launch followed by discovery, business invocation, wrong-token rejection and independently confirmed owned deletion. Validate the actual packed/installed artifact, including authentication-menu arrow cancellation after removing the scope selector. Distinguish local baseline failures from required remote CI.

## Acceptance criteria

- Normal launch never asks the user to obtain or type an application token.
- Correct generated authentication works across CLI processes; wrong authentication returnsHTTP401.
- Interactive provider input is saved by default, explicit overrides are not copied, and no scope menu appears. Credential files are owner-only and secrets never appear in output or generated source.
- Failure to save/reload authentication stops before template preparation and creation.
- Existing explicit credentials, SDK contracts and authentication requirements remain supported.
- English/Chinese guidance, dated evidence, current-head CI and normal PR review accompany delivery.

## Evidence

- [Installed artifact gate](../../../evidence/verify/2026-10-28-default-saved-artifact.md).
- [Final default-saved guidance verification](../../../evidence/verify/2026-10-28-default-saved-guidance.md).
- [Earlier automatic-authentication phase](../../../evidence/verify/2026-10-28-automatic-application-auth.md) at4c7f049 remains historical and records the earlier command-only design before the user changed that requirement.
- [Issue210](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/210).
