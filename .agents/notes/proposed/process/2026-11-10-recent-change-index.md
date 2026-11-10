# Decision: Index recent changes to cli deployment, template authoring and mcp
Status: proposed

## Problem

Recent implementation, user-experience changes and delivery status are spread across
owner records, pull requests and workspace reports. The user requested that recent
changes be retained under each owning repository's `.agents/` and pushed.

## Decision

Keep this dated index in agent-sandbox; link existing canonical decisions and immutable
verification instead of copying their reports or rewriting historical acceptance.
This index adds no product behavior and does not change any older ADR's lifecycle.

### Owner changes and canonical records

The candidate consolidates deployment into deploy/list/status/logs/delete/recover, separates template list/info/init/build/publish, removes the duplicate parser and app/legacy aliases, and retains real protocol, Provider, ownership and recovery behavior. It also updates current-source help, MCP workflows and documentation. The exact command contract remains in the linked owner ADRs.

- [One parser and protocol boundary](../../../notes/proposed/architecture/2026-11-10-single-cli-protocol.md).
- [Unified deployment lifecycle](../../../notes/proposed/architecture/2026-11-10-unified-deployment.md).
- [Template authoring and HTTP MCP boundaries](../../../notes/proposed/architecture/2026-11-10-template-authoring-boundaries.md).
- [Current documentation and health-check verification](../../../evidence/verify/2026-11-10-current-documentation-index.md).
- [Managed application and release history](../../../evidence/verify/2026-11-05-managed-agents-application.md).

### Mainline and candidate boundary

- Mainline observed: `d0a8302f3a921a4572b9ee237bd093bb43e74d5d`.
- Candidate/source observed before this records commit: `fbdf20ddb27c342a911ff576080e7157ef87b7fa`.
- [agent-sandbox PR #247](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/247), OPEN and Draft at the recorded query; not merged.
- The unified source CLI is different from published CLI 0.5.10. This task does
  not issue npm/PyPI releases, deploy sites or certify changed templates.

Recent mainline changes, inspected from the refreshed Git history:

| Date | Commit | Change |
| --- | --- | --- |
| 2026-11-10 | [d0a8302f3a92](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/commit/d0a8302f3a921a4572b9ee237bd093bb43e74d5d) | docs: replace community QR image and join link (#246) |
| 2026-11-10 | [fc878790aa84](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/commit/fc878790aa84802ce8c65953c24df179f27b21cd) | docs: announce preview release schedule and developer community (#245) |
| 2026-11-07 | [2f84e3f802e5](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/commit/2f84e3f802e5f6abd98a528c457b844a9307041d) | fix: wait for planned Gateway readiness (#238) |
| 2026-11-06 | [7b08d7c66299](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/commit/7b08d7c66299f5ac98ea34684d968d61e208f0d9) | docs: record CLI 0.5.9 public delivery (#236) |
| 2026-11-06 | [dbc0224474c5](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/commit/dbc0224474c556710569f9e72d3835f685a69597) | feat(app): add managed Agents deployment profile (#235) |

### Remaining delivery limits

Required generated-MCP Docker/cloud and managed FC apply/update/logs/destroy acceptance remains incomplete. The recorded missing prerequisites were Docker and a reusable PostgreSQL binding. Do not create a new database or release packages for this records task.

## API Design

N/A — this decision does not involve API changes. Existing runtime, credential,
source identity and resource ownership contracts remain with their original owners.

## Alternatives considered

- A workspace-only summary cannot travel with an independent checkout.
- Copying all cross-repository reports duplicates authority and may expose private logs.
- Marking all proposed records implemented would confuse source work with accepted delivery.
- Combining unrelated local changes or permission-only differences in this commit
  would conceal the actual records scope.

## Dependencies

Existing owner records and GitHub PR/commit state. Coordinated implementation is
tracked in [CLI Issue #244](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/244).
Each repository retains its own branch, record, verification and push.

## Test Strategy

Check the new record structure, relative links, pinned Git source revisions and
scoped diff; run the owner's applicable documentation/health checks. Query PR/CI
state separately from local checks. Do not run cloud tests solely to validate prose.

## Acceptance criteria

- Recent owner work is reachable from `.agents/README.md` with dated source references.
- Merged, Draft, failed, unrun and planned work remain distinguishable.
- Existing historical evidence and unrelated work remain intact.
- Documentation checks and remaining gates are recorded; scoped commits are pushed
  to task branches and remote branch hashes are independently compared.

## Evidence

- [Records verification](../../../evidence/verify/2026-11-10-recent-change-index.md).

- [Application product planning boundary](../../../design/2026-11-10-ai-application-product-plan.md).

- [CLI end-state intent archive](../../../design/2026-11-10-template-deployment-endstate.md).
