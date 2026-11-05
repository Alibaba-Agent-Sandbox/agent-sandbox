# Decision: Complete Express runtime preflight after adversarial review

Status: proposed

## Problem

Review of [PR #234](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/234)
at `bbe6e0db61aec209ff8f428e29e4b1708a3504b0` found two remaining defects within
[Issue #230](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/230).
Append-mount validation checked only adjacent sorted directories. A separate
`/mnt/data-temp` directory could hide the conflict between `/mnt/data` and
`/mnt/data/log`. The CLI configuration preflight also classified the three new
runtime operations as native management, requiring an AccessKey pair even when
the user supplied a Sandbox API key.

## Decision

After independent adversarial confirmation, compare every pair of submitted,
already normalized mount paths for equality or a slash-delimited ancestor
relationship. The schema permits at most 40 submitted points, so a bounded
quadratic comparison needs no new dependency or indexing abstraction. Named
and inline mounts share this validation before runner credential resolution.

The Express-owned CLI extension identifies its runtime command catalog alongside
the existing conditional catalog when selecting `sandbox_api_key` requirements.
It continues to use the existing runtime authentication resolver. Native metadata
management retains its AccessKey requirements, mutation confirmation remains in
place, and managed-key creation or renewal requires separate consent.

## API Design

No new public operation or field. `sandbox.mounts.append` rejects all submitted
overlaps with E8002; similarly named sibling directories remain valid. The CLI
paths for `sandbox.mounts.append`, `sandbox.network.update`, and `sandbox.timeout`
accept a Sandbox API key alone. Prepared managed keys remain reusable.

## Alternatives considered

- **Retain adjacent sorting**: disproved by the three-directory counterexample.
- **Build a trie or ancestor index**: unnecessary for a maximum of 40 paths.
- **Require AccessKeys for runtime operations**: contradicts the actual API-key
  authentication contract and excludes API-key-only users.
- **Put Express command IDs in the generic CLI**: violates provider ownership.

## Dependencies

Existing runtime schemas, provider CLI extension, authentication resolver and
PR #234. No dependency or generated standard runtime change.

## Test Strategy

Add failing regressions before changing production code. Test the obscured
ancestor in both input orders, mixed named/inline input and valid similar-prefix
directories. Exercise actual CLI callbacks with key-only authentication, retained
native-management requirements, missing credentials, prepared key reuse and no
implicit key creation. Independently invoke the source CLI against a local HTTP
fixture, checking exact requests and no request for invalid paths. Run mandatory
repository checks and retain full-cloud acceptance limitations.

## Acceptance criteria

- All submitted overlapping directories fail in the runner before credential
  resolution and HTTP; unrelated directories keep their existing meaning.
- All three runtime CLI operations work with only a Sandbox API key.
- Native management, mutation confirmation, prepared-key identity and separate
  key creation/renewal consent are preserved.
- Regression, source CLI and required-check outcomes are recorded truthfully.
- The existing PR remains draft while required real-storage acceptance is unmet.

## Evidence

- [Follow-up verification](../../../evidence/verify/2026-11-05-express-runtime-adversarial-followup.md).
- [Actual source CLI capture](../../../evidence/cli/2026-11-05-express-runtime-adversarial-followup.md).
