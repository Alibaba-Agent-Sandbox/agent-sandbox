# Decision: Fail closed at application and creation recovery boundaries

Status: proposed

## Problem

Review of the explicit workflow implementation reproduced two defects: a malformed successful command-catalog response could admit an incompatible application, and a journal write failure after successful creation could leave a known sandbox outside cleanup. The journal also acknowledged writes before filesystem durability was established.

## Decision

Check application protocol v2 and the current identity's exact endpoint before sending command payloads. Reject malformed catalogs and command results, require an explicit result (including null), and check only a launch's selected operation before retention. Service-token credentials are required before resource mutation. Health probes do not require named-command permissions. Capture native sandbox IDs immediately after create, before session binding. Preserve the original failure, owned ID and confirmed cleanup result even if closing the client fails. Known-resource recovery survives journal I/O errors. Sync the journal temporary file, rename it and sync its containing directory before acknowledging a write; unsupported durability fails closed before mutation.

## API Design

`Sandbox.create({on_created})` awaits the callback with the native ID before authentication/capability binding. Errors after a known creation expose `owned_sandbox_id` and `cleanup_complete`. `Sandbox.verifyApplicationOperation()` checks the selected named-command operation for the current sandbox, port and application identity. These are project APIs; the pinned standard client remains independent.

## Alternatives considered

- Treat malformed HTTP 200 as an empty catalog: cannot establish the required application protocol.
- Persist only after constructing a session: loses the native ID when session binding fails.
- Treat all create errors as unknown: hides known resources and confirmed cleanup.
- Ignore unsupported filesystem sync: would promise durability without establishing it.

## Dependencies

Existing provider endpoint descriptors, the protocol-v2 server discovery document and Node filesystem handles. No new package or compatibility layer.

## Test Strategy

Cover wrong discovery versions, malformed documents/catalogs and denied endpoints with zero payload POSTs. Exercise real HTTP bindings and the current Python application server. Cover native callback ordering, receipt/close/cleanup failures and actual filesystem sync ordering/failure. Run owner typecheck, lint, build, unit, hygiene, record and real-cloud gates.

## Acceptance criteria

- No application payload is sent before strict protocol and endpoint admission.
- Launch cannot retain an application whose selected operation is denied.
- Known native IDs survive session/journal/close failure; confirmed cleanup is not relabeled uncertain.
- Durable journal writes finish before mutation and unsupported sync prevents creation.
- Current Python server, regression suite and required cloud acceptance pass on the reviewed revision.

## Evidence

- [Review verification](../../../evidence/verify/2026-10-23-workflow-review-safety.md).
- [Issue 122](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/122).
