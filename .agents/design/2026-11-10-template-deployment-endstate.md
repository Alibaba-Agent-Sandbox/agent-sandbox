# Template and deployment CLI end-state intent

Date: 2026-11-10. Status: design intent with a Draft implementation candidate.
The user requires the final command model before formal product release, without
old-command compatibility. The earlier proposal's up/fetch naming and compatibility
strategy are not the recommendation. This archive explains intent; the linked
owner ADRs and actual source govern the candidate's implemented details.

## Task model

Templates define reusable business content; deploy creates or updates a running
target. Ordinary Sandbox and managed application templates share a deployment
entry while retaining their actual executors, resource models and capabilities.
Common management uses list/status/logs/delete/recover. A template name is not an
application instance identity.

| Task | Intended entry and boundary |
| --- | --- |
| Discover | template list/info |
| Create editable source | template init, optionally --from; local files only |
| Build a reusable artifact | template build; no automatic remote publication |
| Publish a reusable version | template publish; does not start a running target |
| Run or explicitly update | deploy with an explicit source and new name or update target |
| Inspect and manage | list/status/logs/delete; actual target-type dispatch |
| Resolve an uncertain operation | recover with operation identity and ownership records |
| Sandbox-specific tasks | sandbox execution, files, process and terminal operations |
| Vendor-specific tasks | provider discovery and native operation dispatch |

The source candidate's exact syntax and support must be read from
[unified deployment](../notes/proposed/architecture/2026-11-10-unified-deployment.md),
[authoring boundaries](../notes/proposed/architecture/2026-11-10-template-authoring-boundaries.md)
and [one CLI parser](../notes/proposed/architecture/2026-11-10-single-cli-protocol.md).
Published CLI 0.5.10 has an earlier command contract.

## Removal, consolidation and retained capabilities

Remove the app command tree and duplicate template launch/deploy/install/scaffold
entries and root runtime aliases. Do not add hidden aliases, old loaders, output
compatibility modes or a second parser simply to preserve unreleased interfaces.
Internal build, planning, deployment, revision and cleanup machinery can remain
when it serves the single command model.

Retain SDK/Provider capabilities with independent uses: programmatic create,
cloud template registration/reuse, execution, files, terminal, ports and supported
pause/resume/snapshot operations. CLI consolidation is not authority to delete
those APIs. Preserve source attribution, dynamic registration and generated-source
ownership when evaluating removable code.

MCP local setup remains local. An HTTP MCP service is an editable application
rather than a second deployment platform. Full artifact and cloud acceptance
still applies to its implementation.

## Identity, recovery and resource behavior

Names resolve only within their documented configuration/record scope. Ambiguity
requires an explicit ID. Listing local management records does not inventory an
entire cloud account. Status refreshes the remote target instead of reporting a
cached success.

Source acquisition does not install dependencies, execute hooks or request cloud
credentials. Build output records provenance and may be reused. Deployment owns
resources it creates and records borrowed artifacts/services separately. Updates
require an explicit target; the CLI does not infer one from a directory, template
name or latest receipt. Existing sessions can retain required versions.

Plans describe fixed inputs and intended side effects; unknown image results can
be derived during execution. Dry-run/planning must not silently build or execute
hooks. Unknown remote outcomes require observation/reconciliation before retry.
Stopping a wait does not prove a remote side effect stopped. Partial deletion and
retained resources remain actionable records.

## CI/CD and user-facing delivery

The default automation path should call the same deployment entry with fixed
source, target, credentials and explicit noninteractive intent. Separate plan
export/review is an optional delivery path, not mandatory file handoff for every
user. Parallel runners need target-level serialization beyond a local process
lock. Exact plan flags are governed by actual source/help rather than this intent
archive.

Current help, completion, MCP descriptions, bilingual guides and generated
Registry/website instructions must agree. Historical fixed-release walkthroughs
retain their version context. Source installation must be explicit until the new
command contract is actually released.

## Acceptance and current boundary

Acceptance requires real ordinary-template and managed-application business use,
source acquisition without cloud side effects, reusable build/publication,
explicit updates, session retention, owned deletion and uncertain-result recovery.
Removing command registrations alone does not satisfy the product goal.

[CLI PR #247](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/247)
contains the implementation candidate. Its owner evidence records local/remote
checks and missing managed-application and generated-MCP Docker/cloud acceptance.
The coordinated source changes remain Draft; no release or merge is established
by this design archive.
