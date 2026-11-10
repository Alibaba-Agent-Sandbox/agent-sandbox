# Decision: one deployment lifecycle and explicit template authoring
Status: proposed

## Problem

Template acquisition, authoring, image preparation, Sandbox creation and managed
application deployment exposed overlapping command trees and different parsers.
The user requested the terminal product design without compatibility aliases.
Coordination: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/244.

## Decision

- Root deploy/list/status/logs/delete/recover own running deployments. A local name
  locates the existing Sandbox journal or managed application receipt; it is not a
  new cloud resource authority. Native Sandbox IDs remain usable.
- Template list/info/init/build/publish own catalog discovery and reusable source.
  Source publication pushes a clean committed version to an existing GitHub remote;
  it does not create a Registry platform or deploy an instance.
- Sandbox owns runtime operations; Provider run owns native management. Remove app,
  the second parser, native selector and redundant execution aliases.
- Reuse existing managed application execution and ownership checks. Explicit
  profile normalization comes from the template owner, with a fixed source/hash.
  An application name is independent of the template name; cloud names use a bounded
  name plus digest. Source manifests are never rewritten to rename an instance.
- Automatic builds belong to the deployment lifecycle. Explicit author builds are
  borrowed and protected by the existing file lock while consumers are admitted or
  removed. Only unused author builds may be cleaned.
- Persist the resolved non-secret Provider routing and resource intent before a
  create. Store credentials only through existing configuration. An explicit
  effectsStarted=false distinguishes failed pre-request admission from an uncertain
  create; missing journals never establish absence. Initialize empty journals before
  entering Provider preparation so a no-request failure remains cleanable.
- Recover observes rather than replaying creation/publication. A local stale lock is
  removed only for the same host and a PID independently confirmed absent. Active,
  unknown-host and permission-denied locks remain protected.
- List reports per-Provider partial failures. Application logs reuse an existing FC
  log destination; no new logging service or resources are provisioned.

## Alternatives considered

Keeping old aliases or layering a third facade would preserve the ambiguity the user
asked to remove. A generic deployment DAG, environment hierarchy, cross-cloud
transaction manager, account-token identity platform and duplicated SDK were rejected.
The local locator reuses existing receipts and cleanup, with explicit uncertainty.

## Review and acceptance

Independent reviews covered the command parser/PTY and interruption behavior,
profile producer/consumers, author build ownership, Python installation boundaries
and generated MCP execution. Review found and fixed admission consumer deadlock,
private snapshot modes that broke non-root image reads, authorization conflated
with CI output, target resolution before configuration guidance, and missing native
plugin template management. No outcome was promoted from source presence alone.

Acceptance requires current command help and bilingual examples, meaningful local
regressions, built-artifact checks, real component execution, complete owned cleanup
and required CI. See the accompanying verification record for remaining blocked gates.
