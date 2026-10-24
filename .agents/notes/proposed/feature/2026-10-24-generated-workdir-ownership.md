# Decision: Order Express workspace ownership repair after WORKDIR
Status: proposed

## Problem
[Issue #132](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/132) reports
that a generated README promised a writable application directory although the default
non-root runtime could not create files there. The generation guide placed WORKDIR after
chown and told the model that chown guaranteed runtime writability.

## Decision
Keep source embedding and non-root execution. Place all WORKDIR steps before the final
syntax/ownership RUN, then restore USER user. Explain the observed Express-specific
metadata behavior in the steps guide. Require README guidance to distinguish configured
ownership from runtime verification, including an actual temporary write/read/delete
probe. Do not rewrite existing manifests, elevate runtime users or change generic
Dockerfile/provider permission policies. Publish this correction as CLI 0.4.13.

## API Design
N/A — this decision does not involve API changes. The test-only
`e2e/generated-workdir.mjs --sandbox-id ID` executes through the CLI and
removes its temporary child directory; callers retain sandbox lifecycle ownership.

## Alternatives considered
- Merely remove the README claim — leaves the reproducible step-order problem in newly
  generated templates.
- Force root or chmod 777 — unnecessary privilege/permission broadening.
- Parse and rewrite arbitrary shell steps — exceeds this defect's scope and would mutate
  user intent; the generation instruction and its regression remain the narrow fix.

## Dependencies
Express generation-2 steps on the tested public base v0.0.49; normal provider credentials.
The regression uses the built CLI; independent comparison uses public Python client 0.3.1a2. Unchanged SDK,
provider and template catalogs retain their own release/version conventions.

## Test Strategy
Compare two minimal real-cloud builds differing in WORKDIR/chown order, retaining
build-time metadata snapshots. Execute the non-root file lifecycle independently from
application commands. Generate a fresh add application with the candidate CLI and real
model, inspect README/manifest, and run CLI/SDK/HTTP checks. Run local CI, repository
health, the owning CLI cloud suite and required remote CI before release.

## Acceptance criteria
- The old order is reproduced and the corrected order preserves UID 1000 ownership and
  actual write/read/delete on the tested Express environment.
- Fresh generation follows the corrected order; README makes no unsupported verified claim.
- Runtime remains non-root; no user manifest is automatically changed.
- Owned test sandboxes/templates have confirmed cleanup.
- Release assets, npm installation and website distribution are checked after publication.
- [Issue #131](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/131) remains
  open and explicitly listed as a known limitation; this task does not diagnose it.

## Evidence
See [verification](../../../evidence/verify/2026-10-24-generated-workdir-ownership.md).
