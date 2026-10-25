# Decision: Bind the standalone built-in provider to executable bytes

Status: proposed

## Problem

Public CLI 0.5.1's standalone installation succeeds but template launch tries to read a nonexistent sibling provider source directory. Help-only artifact checks missed this actual execution path. npm installation succeeds on the same account.

## Decision

When the existing standalone build marker is present, identify and recheck the built-in Express provider using SHA-256 of the executable that contains it. Keep ordinary provider-directory hashes for npm/source installations and external plugins. The marker selects the packaging layout; the executable bytes, rather than its version, establish identity. Extend the delivered-artifact test to reach managed launch against a closed loopback endpoint using synthetic configuration.

## API Design

No command or wire API changes. A standalone launch's existing provider digest fields now contain the executable SHA-256. `executableContentDigest` reads the actual regular executable in bounded chunks.

## Alternatives considered

A sidecar provider directory defeats single-file distribution. Skipping identity or hashing only the version cannot detect code changes. Copying source assets into an archive adds unnecessary delivery machinery when the executable already contains the code.

## Dependencies

Existing SEA build marker, Node filesystem and SHA-256. No new dependencies.

## Test Strategy

Unit regressions for actual executable bytes and mutation beyond the first chunk; existing launch/plugin tests; actual built SEA artifact check; real Express managed launch, CLI/SDK commands, file round trip and independently confirmed deletion. Required repository tests, type checks, records and latest-head CI remain gates.

## Acceptance criteria

The standalone artifact needs no provider sidecar, retains non-null byte-based identity and launches managed Express templates through the public catalog. npm and plugin validation remain unchanged. Public 0.5.1 failure remains recorded separately from candidate success. Publication requires coordinator approval and is not implied by this fix.

## Evidence

- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/156
- [Verification](../../../evidence/verify/2026-10-25-standalone-provider-identity.md)
