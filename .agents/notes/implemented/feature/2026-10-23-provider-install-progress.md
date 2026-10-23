# Decision: Report provider installation stages and bounded Git waits

Status: implemented

## Problem

`abx provider install ... --allow-unpinned --yes` buffers Git output and previously printed only the final result. Users could not distinguish a source fetch from validation or handshake waiting. The old shallow-fetch fallback retried every installation error, including a two-minute timeout.

## Decision

Use host-authored phase callbacks from the installer, rendered by the project CLI through its existing OutputManager. Report inspect, fetch, shallow-transport fallback, validation, store write/lock waiting and handshake stages on stderr. A terminal activity line counts elapsed seconds; JSON and quiet modes suppress progress. Close activity before consent and in a finally block before returning or rendering errors. Apply the same presentation to updates.

Keep the existing 120-second per-Git-operation timeout, identify the Git operation in its diagnostic and provide network/SSH/local-directory troubleshooting. Retry without depth only when Git explicitly reports unsupported shallow transport. Preserve source restrictions, metadata-only inspection before consent, digest checks and rollback on failed post-consent verification. Retain the consent/verification explanation, document progress output in install help and correct its group's obsolete create --template example. Publish patch version 0.4.10 through the existing gated release process.

## API Design

Optional `onProgress?: ProgressFn` on prepare/install/update and fetch options. `ProgressFn = (phase: InstallPhase) => void`; phases are a finite union of host-owned identifiers, carrying no raw Git output, source URLs or plugin output. Export the types alongside the existing installer exports. No provider protocol, standard generated source or cloud API changes.

## Alternatives considered

- Print raw Git progress: leaks uncontrolled output and couples presentation to subprocess diagnostics.
- Animate a single generic install message: fails to identify the stage and obscures consent.
- Retry every fetch failure: doubles timeout waits and repeats authentication/network failures unnecessarily.
- Add percentage completion: total Git/validation/handshake work is not known, so elapsed time is accurate.

## Dependencies

Existing Node child_process, Git, OutputManager and Vitest. POSIX terminal tests use the existing Python terminal driver; no runtime dependency added. Tracks [Issue 119](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/119).

## Test Strategy

Real local Git repository installation exercises stage ordering and consent/verification boundaries; failed handshake verifies rollback. A real CLI, delayed real Git executable and POSIX terminal verify an elapsed redraw before installation finishes. Deterministic subprocess tests cover timeout, no retry of unrelated failures and announced shallow fallback. CLI tests preserve JSON/quiet and stdout/stderr separation. Actual installed npm artifact and public GitHub OpenSandbox installation verify real delivery components. Full tests, type/lint/build, records/hygiene, latest-head remote CI, release and website readback gate delivery.

## Acceptance criteria

- Human commands emit stages before completing; terminal waiting shows elapsed seconds.
- Timeout diagnostics identify the operation; timeouts and unrelated failures are not retried.
- JSON/quiet remain free of progress; consent and rollback are preserved.
- English/Chinese docs, dated captures, release artifacts and official installer readback agree.

## Implementation

Local implementation and real Git/plugin checks are complete. Full local tests have ten independently reproduced baseline network/TLS/WebSocket failures; the broad offline harness has three independently reproduced baseline failures. These are not passes. Latest-head remote CI and public release/deployment remain pending at this local capture; Issue 119 stays open until delivery is verified.

## Evidence

[Verification](../../../evidence/verify/2026-10-23-provider-install-progress.md).
