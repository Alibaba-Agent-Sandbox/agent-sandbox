# Decision: Drain retained managed revisions before deletion

Status: proposed

## Problem

An update can fail before its new Dispatcher exists while the previous production revision still
owns reusable Sessions. Looking only at the failed update's execution flag permits deleting live
workers. A zero-activity observation during retirement also leaves admission open, and an early
failed update may not repeat the previous Gateway alias/version ownership in its current receipt.

## Decision

Continue [PR235](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/235). Inspect recorded
current and retained resources, require the exact native Dispatcher identity, then invoke a durable
drain fence. Require its saved persistent state identity and all three zero activity counts before
deletion. Prefer the current Dispatcher; fall back only after confirmed native absence, retaining
resources when a historical Dispatcher cannot clean an unknown revision. Retirement fences the
specific revision before deletion. Destroy recovers only recorded historical Gateway children and
rejects conflicting Gateway creation identities before any deletion. Never enumerate or delete
unrecorded functions, triggers, aliases or versions.

Keep complete tool-tree integrity checks. Development test caches may mutate that tree, so the
real deployment consumes a separate installed npm tarball snapshot that is not used for tests.
Prepare package and lock version 0.5.9 without publishing or replacing immutable 0.5.8.

## API Design

No new CLI command or wire contract. `app retire` explicitly closes remaining Sessions of the
selected revision. `app destroy` drains all recorded revisions, including retained production after
an early update failure. Control responses must match the receipt's persistent state identity.

## Alternatives considered

- **Observe zero once**: rejected because an old Gateway can accept another Session or input.
- **Trust only the latest receipt**: rejected because failed updates can retain live production.
- **Delete every native alias**: rejected because names alone do not establish resource ownership.
- **Ignore development caches in the tool lock**: rejected because it weakens the frozen input check.

## Dependencies

The existing managed runtime's durable global/revision admission fence and control state identity;
[SDK PR156](https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/156) and
[template PR296](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/pull/296). The runtime owner
independently reviewed the deletion/fallback counterexamples and this bounded cleanup design.

## Test Strategy

Behavior regressions cover failed updates with active retained Sessions, successful historical
Gateway cleanup, conflicting Gateway creation identities, missing retirement fence, and replacement
persistent state identity. Inspect the actual temporary Docker build context for excluded `.abx`
and environment files. Run full local CI, record existing environment failures separately, and
consume an independently installed tarball for real deployment. Real cloud and cleanup evidence
remain separate from local mocks.

## Acceptance criteria

- No worker deletion before a confirmed durable drain of every retained revision.
- Replacement native functions or persistent state never authorize cleanup.
- Recorded historical Gateway children are cleaned after an early update failure.
- Full local and remote checks have recorded outcomes; real FC acceptance is independently recorded.
- The installed 0.5.9 candidate remains distinct from an npm publication.
