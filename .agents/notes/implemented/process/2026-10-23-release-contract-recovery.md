# Decision: Verify the current installed release contract before tagging

Status: implemented

## Problem

All five v0.4.7 binary jobs stopped on an installed-artifact assertion requiring the removed --official-api selector. Ordinary package CI did not execute that gate. Native help and deployment helper argv also retained fragments of the retired contract.

## Decision

Verify actual current standard/native help, run the installed-artifact gate in normal package CI, repair native list/info prose and explicit Express helper arguments. After npm publication/readback succeeds, a separate contents-write job attaches the exact tested candidate and SHA-256 to the GitHub Release for the website mirror; the publisher/diagnostic jobs retain their limited permissions. Preserve the failed immutable v0.4.7 tag and publish the next patch candidate, 0.4.8. Keep historical captures unchanged.

## API Design

No backend API or reporting feature changes. Native template list/info use FCSandbox with AccessKey credentials; standard template list retains Sandbox API-key authentication. Helper region arguments belong to their subcommands, with explicit Express provider selection.

## Alternatives considered

Retargeting v0.4.7 would rewrite immutable release history. Skipping the failed artifact check would hide packaging regressions. Reintroducing retired flags would undo the accepted compatibility removal.

## Dependencies

Existing npm/SEA packaging and release workflows, pinned standard source and native template metadata. [Issue #111](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/111); original corrections [PR #110](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/110).

## Test Strategy

Install and run the exact npm candidate outside the checkout. Pass both helper scripts through the actual executable parser with help appended before cloud work. Run snapshots, shell syntax, types/lint/health/hygiene, normal CI including installed-artifact smoke, and all five platform artifact jobs before publication.

## Acceptance criteria

- Current installed-artifact smoke and helper parser regressions pass.
- Normal CI catches retired-contract artifact assertions before tag creation.
- New dated captures, bilingual guidance and changelog included.
- Required checks, actual merge, npm/platform publication and website mirror are verified separately.

## Evidence

[Verification](../../../evidence/verify/2026-10-23-release-contract-recovery.md). No new cloud/reporting deployment is part of this repair.
