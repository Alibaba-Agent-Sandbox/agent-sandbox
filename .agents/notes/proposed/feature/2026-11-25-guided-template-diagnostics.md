# Decision: Concise configuration and actionable template preparation

Status: proposed

## Problem

Express setup displayed managed-key lifecycle details before the authentication choice, printed
multiple success messages, and labeled both project dotenv and private user files as `user`.
Accepting a displayed region or registry namespace could copy a temporary override into user
settings. Source deployment repeated registry output and asked for approval before checking Docker.
Some preparation failures directed users to an empty or unwritten recovery journal.

## Decision

Show one target and one setup result, with the exact variable and file for a winning override.
Use the selected Provider's resolver for the setup fields. An empty response keeps existing
settings in place. Setup still offers template discovery, with Finish selected when an entered
value is overridden. The existing credential protection and managed-key authorization remain.

Probe the selected Express Dockerfile toolchain before source deployment consent. Use the same
plan selection as preparation and keep the adapter's final pre-intent check. Resolve build
configuration once in the shared Express preparation path. Report recognized local failures
with fixed repair information. A recovery path appears when a write-ahead intent has been
acknowledged. A pre-request source failure permits a same-name retry.

## API Design

The public command and configuration contracts are unchanged. The CLI extension may supply a
read-only prerequisite check for the selected source recipe. The resource journal exposes an
in-memory indication of a successfully acknowledged intent, without changing its JSON schema.

## Alternatives considered

- Change dotenv precedence at setup time. This could send a subsequent operation to a different account.
- Forward arbitrary provider exceptions. Their messages can contain private inputs, build output or credentials.
- Stack the entire change on PR 261. Its command redesign has separate CI and documentation dependencies.
  The shared preparation changes are reusable when that branch moves source preparation to `template build`.

## Dependencies

Existing Provider configuration descriptors and resolver, Express Docker adapter, and resource journal.

## Test Strategy

Use original published 0.5.10 as a failure control. Verify configuration persistence and exact
source attribution in an isolated terminal. Use an isolated Docker daemon for the failing
Dockerfile and a real Express source launch. Check journal ordering and retained resources independently.

## Acceptance criteria

- Interactive setup reports the winning source and preserves hidden inputs, Enter semantics and explicit managed-key consent.
- Dockerfile deployment checks its daemon before approval. Plan previews and provider-native steps do not probe Docker.
- Missing configuration and local journal failures retain useful diagnostics. Recovery text refers to the actual journal when an intent can have side effects.
- Real terminal, Docker and Express results and owned-resource cleanup are recorded.

## Evidence

- [Issue 266](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/266)
- [Verification](../../../evidence/verify/2026-11-25-guided-template-diagnostics.md)
