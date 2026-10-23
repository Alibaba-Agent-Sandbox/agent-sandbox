# Decision: Recover an immutable npm publication after delayed readback

Status: implemented

## Problem

The 0.4.8 publish command succeeded with signed provenance, but six five-second install attempts exhausted before the public registry exposed the version. Re-running an unconditional publish would fail or attempt to republish an immutable version, preventing the dependent mirror-asset job from recovering.

## Decision

Check fresh public version metadata against the exact candidate SHA-512. Skip publication only on an exact version/integrity match; a missing version may publish, while conflicting/invalid/unavailable metadata fails closed. Bound online install readback to thirty attempts separated by twenty seconds, each with a fresh cache. Retain the original failed run and immutable 0.4.8 tag.

## API Design

No runtime/CLI/backend API changes. Recovery dispatch continues to select an existing release tag from the default branch workflow; new publication remains gated by the existing version/repository checks. The dependent asset job still requires successful public installation/readback.

## Alternatives considered

Unconditional republishing is unsafe and cannot repair an already accepted immutable version. Ignoring the failed readback would skip actual installation verification. Reusing one negative cache undermines retries. Infinite retrying has no bounded operational outcome.

## Dependencies

Public npm HTTPS metadata and SHA-512 integrity, existing publication/artifact workflow. [Issue #111](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/111). The runtime release source remains the verified 0.4.8 tag.

## Test Strategy

Execute the actual workflow scripts with missing/matching/conflicting/malformed/unavailable registry responses and delayed/permanently failing installation. Verify fresh cache paths, retry bound and no publication on a verified existing candidate. Run actual public npm install plus artifact smoke, types/lint/health/hygiene and final-head CI, then recover the existing tag and verify mirror assets.

## Acceptance criteria

- Integrity guard refuses mismatched/unknown versions and permits only verified reuse.
- Readback retries fresh metadata and fails within a fixed bound.
- Public package installs and actual artifact checks pass.
- Required checks/merge, recovered workflow and website readback recorded before delivery closure.

## Evidence

[Verification](../../../evidence/verify/2026-10-23-npm-readback-recovery.md).
