# Decision: Record managed application source acceptance and CLI 0.5.9 publication

Status: proposed

## Problem

The earlier managed application evidence identifies unpublished candidates and incomplete cloud gates.
The final candidate subsequently passed the real deployment, retained-session upgrade and retirement
scenarios, and its CLI artifacts were published. Rewriting those earlier checkpoints would erase the
actual failures and blur source execution with public-package template acceptance.

## Decision

Add a separate dated record for the accepted source and immutable public CLI artifacts. Publish the
existing verified five-platform draft only after every platform completes, then use the normal release
workflow for npm. Independently download/check the resulting artifacts and install npm in a fresh user
context. Keep candidate snapshots and release tags unchanged. Update the bilingual managed deployment
guide to install the now-public npm CLI 0.5.9 and date the release in the changelog.

The final source run and a complete public dependency recipe run remain separate scopes. The public
recipe, its provider qualification and its catalog publication belong to the template owner. Do not
infer their completion from CLI source tests or the publication of a package.

## API Design

No command, runtime, wire or receipt behavior changes. The deployment profile requires Node.js 20+
and the npm CLI. Standalone executables retain their independently verified installation/help scope;
this record does not certify managed deployment through every standalone platform executable.

## Alternatives considered

- **Rewrite candidate evidence as passed**: rejected because the original failures and unknown outcomes are historical facts.
- **Republish the same version or move its tag**: rejected because release identities must remain immutable.
- **Treat public installation as full template acceptance**: rejected because it does not execute the application workload.

## Dependencies

[CLI PR235](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/235),
[SDK PR156](https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/156),
[contract PR299](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/pull/299), and the
separate [template PR296](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/pull/296).
No additional deployment, cloud resource or management key is required for this documentation change.

## Test Strategy

Preserve the final product's full local/remote checks and actual source-cloud evidence. Verify all five
binary downloads against checksums, run the Linux binary artifact checks, download and validate the
public npm tarball integrity, freshly install it and compare its complete dist bytes with the reviewed
candidate. Check this follow-up's documentation, records, hygiene and repository-required CI separately.

## Acceptance criteria

- The recorded merge, tag, workflow runs and published artifacts are actual verified identities.
- Original source failures, skips and the remaining public template gate remain explicit.
- English and Chinese installation guidance names the same published npm version.
- Documentation and evidence contain no private identifiers, credentials, raw model output or local paths.

## Evidence

- [Publication and source acceptance](../../../evidence/verify/2026-11-06-cli-059-publication.md).
