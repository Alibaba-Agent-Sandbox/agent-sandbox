# Decision: Exercise the current standard and explicit project cloud commands

Status: proposed

## Problem

The real-cloud lifecycle and read-only runners still pass project root output switches
into the standard command parser. Creation fails before backend work, preventing the
remaining lifecycle checks from exercising their behavior. Some scenarios also assume
retired application paths or acknowledge a signal sent to an invented process ID.

## Decision

Use positional detached standard creation, command-local JSON format and state filters,
and standard kill semantics. Preserve project JSON exec, quiet/CI and creation-time
sandbox environment/upload checks through the maintained explicit `--native` entry.
Test setup supplies both current configuration namespaces from the selected account;
negative overrides remain effective. No product aliases or compatibility paths are added.
Persist create intent before submission; retain ambiguous outcomes, capture unexpected IDs even
in negative scenarios, and never replay mutations. Record identities before later checks and untrack only
after independent info and inventory absence. The template owns application startup;
verify its deployed protocol-v2 hello service instead of guessing a script. A caller may supply
the exact selected manifest startup command; invoke it once, validate its real process ID and
require that process to remain visible before admitting the catalog or any payload. For an
older managed image, a caller may explicitly pair reviewed local source and remote destination
with that start command. Validate all three before upload, upload once and do not start after
upload failure. Evidence distinguishes this managed-sandbox/current-fixture bridge test from
preinstalled-image acceptance or source-image construction. Signal only
owned process handles, reject malformed process inventories, and check that the signalled
process disappears. The shared runner and standalone recovery command only confirm absence
from valid standard inventory, persist partial progress and retain unresolved create intents.
A successful kill acknowledgement cannot clear a recovery record. Structured metrics/package
checks preserve the current public output and reject generic authentication/network errors.

## API Design

N/A — this change updates test invocations and setup, without changing public product APIs.

## Alternatives considered

- Restore implicit old-command routing: rejected because it changes the approved standard contract.
- Remove JSON/application/process scenarios: rejected because it loses real behavior coverage.
- Treat standard terminal environment as sandbox environment injection: rejected because those scopes differ.

## Dependencies

The reviewed CLI runtime [PR 123](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/123),
a selected Express test account, and an already deployed current python-hello application.
Tracks [Issue 124](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/124).

## Test Strategy

Run scenario discovery and syntax checks, focused safety regressions for identity retention,
configuration overrides and cleanup/postconditions, repository checks and the two real-cloud
suites. Existing standard PTY and OpenSandbox T4 runs provide separate runtime evidence;
they do not replace acceptance of the corrected full runner.

## Acceptance criteria

- Existing lifecycle/read-only behavior coverage is retained with explicit current commands.
- No create replay, lost known identity, invented PID or unconfirmed cleanup acknowledgement.
- Local gates and real-cloud suites pass with an honest cleanup and evidence record.
- Update the bilingual runner documentation and changelog.

## Evidence

- [Cloud E2E command-contract verification](../../../evidence/verify/2026-10-23-cloud-e2e-command-contract.md)
