# Decision: Preserve the supported CLI runtime during CI dependency updates
Status: implemented

## Problem

Dependency PRs 7, 9 and 10 currently fail installation, CLI behavior or type gates.
Blindly merging them would change the supported runtime or ignore real failures.
The setup-node v7 update in PR 6 has green checks but lacks owner change records.

## Decision

Update setup-node independently of the installed Node runtime. Preserve explicit
Node 20/22 CI and Node 22 release targets. Ignore automatic major updates only
for Commander, TypeScript and Node types, with manual migration acceptance in
both contributor guides. Continue patch/minor updates. Decline the three current
incompatible major PRs after this policy lands; never call their failed runs green.

## API Design

N/A — this decision does not involve API changes.

## Alternatives considered

- Drop Node 20 to adopt Commander 15: outside this maintenance scope and breaks support.
- Force TypeScript 7 peer resolution: bypasses the linter toolchain contract.
- Merge Node 26 types despite failure: permits unverified newer runtime assumptions.

## Dependencies

Existing setup-node v7 and the repository lockfile; no runtime package changes.
Current package typescript-eslint declares TypeScript >=4.8.4 <6.1.0.

## Test Strategy

Inspect exact-head failed job steps, annotations and lockfile diffs. Review the
upstream action metadata. Validate YAML/policy, unchanged runtime version matrix,
repository health/hygiene and latest hosted Node 20/22 installer/type/test/build
jobs after rebasing PR 6 on current main. Release workflows are reviewed only;
no release is triggered or claimed.

## Acceptance criteria

- Current-head CI for PR 6 is successful, with required review before merge.
- Supported Node targets and runtime dependency lockfile remain unchanged.
- Three incompatible majors are explicitly declined with evidence links.
- New engineering evidence and bilingual dependency policy are included.
