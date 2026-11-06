# Decision: Explicit deployment of managed Agents applications

Status: proposed

## Problem

Sandbox endpoints are instance-specific. An application requires one stable public Gateway,
durable Session routing, revision-specific Workers and recovery of uncertain deployment outcomes.
The old application draft targets an obsolete schema and cannot safely be merged as an implementation.
This work continues [Issue 80](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/80).

## Decision

Implement the closed spec6 managed profile alongside existing template launch. Freeze source,
Server image digest, Node executable, complete loader dependencies and the exact fc3 bundle before
planning. Invoke official component methods in a bounded child with one verified AK/STS snapshot;
reserve new function identities through native create-only requests first. Preserve the existing
Express preparation ResourceJournal and use a unique Sandbox Template/image tag per revision.

Keep one owned Gateway function, publish immutable versions and update its stable alias only after
candidate business validation. Workers and Dispatchers are revision-specific; retained Sessions
continue routing through their original revision. Before candidate exposure, persist that execution
may have started. Destruction thereafter requires a durable signed drain with zero reusable Sessions,
pending cleanup and uncertain resources. Early confirmed resources without exposure can be cleaned
without an unavailable Dispatcher. Unknown creation outcomes are never adopted by same name.

Generate the default business and internal control keys only on initial explicit apply, in a dedicated
0600 user store scoped to application, verified account and region. Keep resolved binding values out
of plans, receipts and diagnostics. Candidate verification uses an expiring temporary owner key;
remove its hash before production publication and confirm the final endpoint rejects it.

The native FC alias API has no conditional compare-and-swap. Local exclusion plus before/after
inspection detects ordinary conflict but is not a distributed lock. Shared deployers must serialize.

## API Design

The explicit commands are `app build`, `plan`, `apply`, `status`, `reconcile`, `retire` and `destroy`.
`plan` consumes an observed build receipt and optionally a previous ready application receipt;
`apply` consumes that frozen plan. Destruction has a separate reviewed plan. Reconcile observes;
retire is an explicit deletion of a drained retained revision. Existing `template launch` does not
deploy applications or run application hooks.

`src/application/` owns schema validation, binding/bootstrap compilation, process isolation and the
state machine. Concrete FC, ACR and Express preparation live in the owning provider's application adapter.
FILE/JSON runtime bootstrap uses role-scoped explicit bindings;
model credentials go only to Worker. Source and private binding files are never a generic steps DSL.

State bindings may supply a closed native VPC configuration. All roles explicitly enable Internet
access for model/Sandbox access and verify native network/bootstrap readback. Initial deployment
pins the durable stateInstanceId before exposure; later roles compile expectedStateId and reject
replaced ledgers. Non-secret DSN routing checks reject unknown schema/host overrides but do not
substitute for the durable identity check. Database migration is deliberately outside this profile.

Server builds journal a random tag before effects and retain recovery receipts on uncertain pushes.
Only matching native/local creation identities grant ownership. clean-build handles isolated builds;
once apply records usedBy, cleanup follows application revision references. Borrowed digests are
never removed. Existing Sandbox build-image manual cleanup remains explicit in the public summary.

## Alternatives considered

- Merge draft PR81 directly: rejected because its provider/preparation interfaces and schema are stale.
- Repoint an alias across different Gateway functions: rejected because FC aliases belong to one function.
- Treat timeout as cancellation: rejected because external cloud work can continue after waiting stops.
- Implicitly delete retained revisions in reconcile: rejected because idle logical Sessions can accept future inputs.
- Generate another template-specific secret helper: rejected in favor of private default CLI credentials.

## Dependencies

Owner schema/template: [awesome-templates PR296](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/pull/296).
Optional managed Server and private guest bridge: [python-sdk Issue155](https://github.com/Alibaba-Agent-Sandbox/python-sdk/issues/155).
Exact fc3 0.1.26 and load-component 0.0.10-beta.7, official FC/STS SDKs, Node.js 20+, Docker/ACR,
an existing reachable PostgreSQL database and an explicit existing FC execution role.

## Test Strategy

Behavioral tests cover freeze verification, role isolation, private credential reuse, candidate auth
removal, create-only collisions, unknown results, early cleanup, logical Session drain gates and
partial/repeated deletion. Real subprocess tests confirm termination and bounded output. Load the
actual component, verify caller/native cloud identity and exercise component deploy/info/remove.
Full application acceptance must additionally exercise real FC, persistent PostgreSQL, model tools,
Sandbox cleanup, stable updates and retained revision routing. Unit passes do not satisfy that gate.

## Acceptance criteria

All repository checks pass. Each documented command runs from the actual compiled CLI. The real
component lifecycle and full managed application flow pass with independent resource absence checks.
Unmet external dependencies or failures keep this record proposed and the PR draft.

## Evidence

- [Verification](../../../evidence/verify/2026-11-05-managed-agents-application.md)
