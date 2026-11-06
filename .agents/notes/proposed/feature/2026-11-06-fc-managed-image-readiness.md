# Decision: Verify native FC image preparation before managed publication

Status: proposed

## Problem

The joint real FC attempt rejected the owned Server image digest URI at native function creation,
although independent ACR inspection confirmed its tag and digest. Its certificate chain also pushed
the compiled environment beyond the native 4 KiB limit. Creation and update complete asynchronously;
calling Devs immediately can race preparation. A maximum valid template name could produce a
65-character Dispatcher name, above FC's 64-character limit.

## Decision

Keep the frozen image digest in plans and ownership receipts. Submit the confirmed owned build's
unique tag to FC, then verify the exact tag and resolved digest after preparation and every Devs
update. Borrowed digest inputs remain explicit; never guess or adopt another tag. Wait only through
native reads, with a five-minute bound, before deployment/invocation/publication. Failed, unknown or
expired readiness retains the receipt without replay. A settled Inactive existing Gateway may be
redeployed; post-update readiness requires Active and Successful.

Keep certificate material out of role environments. Encode public CA PEM as the managed runtime's
explicit base64 argument; secrets remain role-scoped environment values. Before the first FC creation,
compile every role using the real prepared Template ID, future persistent state pin and candidate auth,
and reject key/value UTF-8 totals above 4096 bytes. Verify full command/entrypoint/port/environment
and native ownership with the frozen image. Shorten the safe application prefix to 34 characters.

The runtime and integration owners independently reviewed these exact boundaries. The old candidate,
plans and receipts remain unchanged; a new separately installed tarball is used for the next cloud run.

## API Design

Public bindings/commands are unchanged. The optional private runtime flag is `--database-ca-base64`;
[SDK PR156](https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/156) validates canonical ASCII
Base64, bounded decoded CA material and mutually exclusive environment input. No secret moves to argv.
Native create/update acceptance remains mandatory; host validation does not promise that FC accepts
all 64 KiB CA bundles in command arguments.

## Alternatives considered

- **Assume create/deploy is immediately ready**: rejected by asynchronous native image preparation.
- **Compare only tag or digest**: rejected because the frozen image identity and exact submitted tag both matter.
- **Compress all bootstrap secrets**: rejected as unnecessary protocol expansion.
- **Guess a tag for borrowed digests**: rejected because no owned source identity establishes that mapping.
- **Rewrite a failed plan or replay apply**: rejected because native effects must be reconciled first.

## Dependencies

The existing FC/ACR adapters and the SDK's explicit CA argument. Official
[FC custom-container states](https://help.aliyun.com/en/functioncompute/states-of-custom-container-functions)
require native state checks after create/update; the source example also exposes image and resolvedImageUri.
The exact Personal ACR digest-input failure belongs to the integration owner's real attempt, not a
claim that every FC registry path rejects digest input.

## Test Strategy

Exercise owned tag/frozen digest, every compiled runtime field, Pending/Successful ordering, Failed,
unknown and timeout retention, CA command delivery, early environment rejection and the longest valid
name. Run focused checks, full local CI and latest-head remote CI in the development checkout. Install
a new immutable tarball snapshot for real cloud testing; never run tests inside its dependency tree.

## Acceptance criteria

- No Devs update or publication races pending native image preparation.
- Every deployed runtime matches its native identity, tag, resolved digest, complete argv and environment.
- Public CA does not consume role environment space; all future bootstrap variants fit 4 KiB.
- Maximum valid manifest names yield native names of at most 64 characters.
- Required CI and exact new-candidate cloud acceptance have honest separate results.
