# Decision: Prepare the existing official source recipe

Status: proposed

## Problem

The public OpenSandbox source launch path rejects the official native base placeholders and does not supply the server wheel expected by its Dockerfile. Historical acceptance tooling prepared these outside the public command. Adding another template state or asking the user to repair an official recipe does not fix this path.

## Decision

Reuse the current source snapshot and Docker builder. Resolve only the official native base FROM recipe with documented image defaults. When its existing server-wheel COPY has no context wheels, add a Docker wheel stage using the exact archive already pinned in the Dockerfile. Keep application RUN, COPY ownership and final USER instructions. Validate an optional server-sdk.commit against the archive. Explicit profiles remain explicit; no fallback or manifest schema is added. The Express extension retains its existing native build path. Tool failures report only fixed phase/prerequisite text, never subprocess output or arguments.

## API Design

The public command remains `abx --provider opensandbox template launch SOURCE`. The existing stageProject helper materializes the official recipe in its temporary copy. No new template fields, provider methods, statuses, or user options are introduced. The optional provider source_placeholders description accepts only the existing catalog substitution names and grants no runtime operations. Older hosts must be updated before installing a plugin that declares it.

## Alternatives considered

- Separate default-target declarations and status machinery: unnecessary for the existing recipe.
- Require users to run the historical private preparation harness: does not provide a usable public entry.
- Replace the base with a portable Dockerfile automatically: changes runtime semantics.
- Build wheels using host Python: adds an undeclared local prerequisite.

## Dependencies

Docker and existing registry credentials. Source pin and recipe remain owned by [awesome-templates](https://github.com/Alibaba-Agent-Sandbox/awesome-templates). OpenSandbox metadata is owned by [awesome-providers](https://github.com/Alibaba-Agent-Sandbox/awesome-providers). Tracking: [Issue 136](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/136).

## Test Strategy

Test official recipe expansion, unchanged application instructions, pin agreement, explicit portable profiles, unknown placeholders, idempotent staging, frozen effective inputs and redacted failures. Run local CI and the real public launch path, invoke the application through the host endpoint and confirm owned cleanup.

## Acceptance criteria

- No edits to the original template or implicit profile changes.
- Exact pinned server source reaches the existing wheel installation branch.
- Unknown/mismatched source inputs fail before builds.
- Repository checks and real OpenSandbox launch pass; full catalog coverage is reported only when actually run.

## Evidence

- [Verification](../../../evidence/verify/2026-10-24-source-template-preparation.md)
