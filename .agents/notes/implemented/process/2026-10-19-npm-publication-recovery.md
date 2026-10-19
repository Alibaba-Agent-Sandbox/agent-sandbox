# Decision: Recover npm publication without moving a released source tag

Status: implemented

## Problem
The first0.4.0 npm workflow passed source checks but npm interpreted dist-pack/name.tgz as a GitHub shorthand instead of a local file. Publication never ran. The already published GitHub tag and five verified binaries must remain immutable.

## Decision
Prefix the install and publish tarball glob with ./ . Allow an explicit release_tag input on the current main workflow; recovery always checks out refs/tags/<release_tag> and requires its package version to match. Recovery runs only from main. Automatic published-release runs still require a tag. Keep Issue66 open until public npm installation and local real-cloud acceptance pass.

## API Design
No runtime/package version change. The manual publisher input release_tag selects an existing immutable source tag; it cannot publish main source as that version. The npm workflow implementation can advance independently of the released runtime.

## Alternatives considered
Movingv0.4.0 would invalidate reviewed source/artifacts. Blindly rerunning the original tag workflow repeats the same path bug. Skipping the candidate install would hide an actual installation defect. A new runtime version is unnecessary for a workflow-only repair.

## Dependencies
Refs https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/66 and https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/67 . Existing npm environment/token, no credential copied or changed. No Python publishing or local cloud credential upload.

## Test Strategy
Execute the workflow's actual shell guard across valid release/recovery and refusal cases. Build a real dependency-free fixture tarball and execute the exact global-install command, proving bytes came from the local archive. Independently install the actual0.4.0 candidate with the corrected glob and verify version/help/notices. Read back the published binary through the default-latest installer and perform real Express operations locally. Require latest-head hosted CI before merge and actual public npm proof before closing Issue66.

## Acceptance criteria
Regression tests and repository checks pass before merge. The current main workflow can be dispatched for existingv0.4.0 with no tag rewriting; failed initial delivery remains historical evidence. Source-fix completion and public npm delivery are separate states.

## Evidence
See [verification](../../../evidence/verify/2026-10-19-npm-publication-recovery.md).
