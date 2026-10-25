# Decision: Correct Windows journal writes before the next minimal release

Status: proposed

## Problem

The immutable v0.5.2 tag reached the real five-platform artifact gate, where Windows native template launch failed in journal directory durability handling. Linux x64/arm64 artifacts passed, but v0.5.2 was not formally published and no npm publication was started. A Linux-only test result did not establish Windows support.

## Decision

Keep file write, file sync and rename checks on every platform. Keep existing POSIX directory synchronization. Windows does not attempt POSIX directory handles: Node's file synchronization does not establish the same directory-entry durability guarantee. Do not introduce a native binding, new recovery framework, user option or user state. Publish the next minimal patch, 0.5.3, only after actual platform artifacts pass.

## API Design

No public API, option or template schema changes. Windows can reach normal provider execution instead of failing on an unsupported persistence primitive. Any file write/sync/rename error still stops the operation before resource creation.

## Alternatives considered

- Relax the executable assertion: rejected because it would hide a Windows product failure.
- Replace the v0.5.2 tag or ship modified source under it: rejected; keep immutable history.
- Add a Windows native directory-flush binding: rejected as unnecessary complexity for the existing resource recovery record.

## Dependencies

- [Windows failure](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/169).
- Existing release binary workflow and normal required checks; matched public Python 0.4.0a2 stays unchanged.

## Test Strategy

Check actual file synchronization and rename behavior, rejected file-sync errors, existing POSIX ancestor synchronization, actual Windows and Linux npm/standalone artifacts, then publish and repeat fresh public installation and developer cases. A simulated Windows platform unit test is not an actual Windows artifact pass.

## Acceptance criteria

- Normal owner CI and independent review pass.
- Actual Windows npm and standalone launch preflight reaches the provider boundary.
- Five final release platforms pass before publication; no v0.5.2 tag is replaced.
- Current docs, blog examples and fresh public-install evidence refer to the actual final release.

## Evidence

- [Verification](../../../evidence/verify/2026-10-25-cli-053-windows-release.md).
- [Microsoft directory handle documentation](https://learn.microsoft.com/en-us/windows/win32/fileio/obtaining-a-handle-to-a-directory).
- [Microsoft file buffer flush documentation](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers).
