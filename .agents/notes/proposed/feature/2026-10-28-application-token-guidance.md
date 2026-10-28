# Decision: Explain application authentication wherever configuration is missing

Status: proposed

## Problem

A user launching the Codex template completed temporary platform-key setup and received E8002
requiring ABX_SERVER_TOKEN without understanding its purpose or source. Public npm 0.5.7 already
contains interactive application-token setup; the reported executable version is unknown. Current
noninteractive configuration errors omit existing field help, and the low-level resolver gives
only the variable name. Public READMEs also expose implementation details unrelated to setup.

## Decision

Reuse the existing shared application-token wizard. Label the prompt with ABX_SERVER_TOKEN and
explain that it protects the sandbox application API, is distinct from platform/model credentials,
and is chosen by the user or generated locally. Explain Save for future commands plus Enter,
manual hidden input, initialization and later abx run reuse. Include shared field help in
noninteractive diagnostics. Enrich the resolver error without making the resolver interactive.
Simplify both root README introductions and document application-token setup in both languages.
Keep internal investigation and acceptance results in engineering records.

## API Design

No signature or precedence changes. withTemplateEnvironment retains explicit/runtime/saved token
resolution, hidden entry, cancellation, per-command versus saved scope and pre-submission checks.
resolveTemplateEnvironment remains read-only and fails before resources are prepared or created.
No credential is generated for noninteractive execution or undeclared application authentication.

## Alternatives considered

- Automatically generate and discard a temporary token: rejected because later clients need the
  same secret and existing persistence choices should remain explicit.
- Tell users to obtain this token from a cloud console: rejected because it is an application secret.
- Treat the reported binary as proven to be current: rejected; only the downloaded npm 0.5.7
  contents and the current source were inspected, and the user's installed version is unknown.

## Dependencies

Prepare CLI 0.5.8 with unchanged dependency resolutions; the release includes the existing
mainline consented Express managed-key feature.

No dependency updates. Reuses CLI configuration help and template environment validation.
Related prior issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/189.

## Test Strategy

Exercise local/remote source launches, temporary platform/application inputs, generated saved
application tokens, subsequent reuse, overrides, cancellation and automation. Capture a built-CLI
JSON error as a new golden and verify prompts through a real POSIX PTY. Run mandatory local checks,
record full-suite failures separately, and attempt the existing real-cloud application scenario.

## Acceptance criteria

- Missing application authentication is explained before preparation/creation.
- Input and generated tokens never appear in output; scopes and later reuse retain their behavior.
- Automation receives purpose/source and actionable config/env commands without opening prompts.
- The resolver remains noninteractive and rejects unusable explicit values.
- Bilingual user docs focus on setup/use; engineering evidence stays in .agents/.
- Required real-cloud/remote gates remain blocking when credentials or repository access are absent.

## Evidence

- [Initial local verification](../../../evidence/verify/2026-10-28-application-token-guidance.md)
- [Authenticated cloud and release verification](../../../evidence/verify/2026-10-28-application-token-release.md)
- [Issue #207](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/207)
