# Decision: separate reusable Sandbox preparation from instance creation
Status: proposed

## Problem

The unified CLI already removed the public `template launch` command. Its
replacement still combined Sandbox template preparation and instance creation
in `deploy SOURCE`. This made reusable preparation look like a special case.
Express also accepted a negative envd flag that emitted the same native request
as omission. Follow-up to the unified CLI in
[issue 260](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/260).

## Decision

Keep source acquisition optional. Prepare a local or Registry source with
`template build`, then create each instance from the saved artifact. Create
directly from a Provider-native template ID when it is already available.
Managed applications retain `deploy`, including their plan and managed build
path. Instances and applications share observation, recovery and deletion.

A prepared build retains its Provider identity, original source, native reference
and managed-resource journal. Creation uses the saved reference and verifies the
frozen source and target before requests. It runs declared startup, readiness and
service discovery. It does not restage the image inputs or rebuild them.
Deletion releases the build consumer only after instance cleanup. An unused
artifact is cleaned by `template build --clean`. Configuration setup saves settings
and ends without invoking deployment.

## API Design

- `template init DIR --from REF` copies editable sources.
- `template build REF|DIR --out FILE --yes` prepares reusable resources.
- `create --build FILE [--name NAME] --yes` uses a ready Sandbox build.
- `create --template-id ID [--name NAME] --yes` uses a Provider-native template.
- `deploy [SOURCE] [--build FILE] [--plan] [--bindings FILE]` handles managed
  application recipes and their build artifacts.
- The native Express adapter has a positive envd request only. The public native
  JSON operation accepts omitted or false to leave the request to platform defaults.
  An explicit true is limited to generation 1. A separate destination requires
  that true request. Steps reject the explicit injection and destination options.

## Alternatives considered

1. Keeping a one-command Sandbox source deployment would preserve overlapping
   lifecycle choices and implicit preparation.
2. Creating from a raw ID for every source template would lose frozen startup,
   environment, service and ownership metadata.
3. A second preparation verb would duplicate the implemented artifact contract.

## Dependencies

Provider capability checks, build consumer locking, the Sandbox journal and managed
application receipts stay with their existing implementations. The Express guard
uses the current Sandbox native contract. The bundled client still calls the older
FCSandbox API, whose metadata does not specify the same generation and omission
rules. Automatic preparation policy remains separate from these explicit inputs.

## Test Strategy

Cover parser routes, failure before effects, repeated artifact consumption,
frozen source, Provider identity, startup, recovery and release of build consumers.
Check the native SDK request body for omitted, false and explicit generation-1
values. Exercise a real Express instance, a reusable artifact borrowing that
template, and the official python-hello command fixture. Verify CLI help and
bilingual examples alongside the command inventory.

## Acceptance criteria

- Each entry point has one explicit resource lifecycle.
- Build preparation never creates a Sandbox instance.
- Instance creation by either route is observable and recoverable.
- Removed or ineffective options fail before the associated resource request.
- Help, end-to-end runners and current public examples use the current routes.
  Published-version walkthroughs retain their pinned commands.
- Mandatory CI and applicable real-provider acceptance are supplied before merge.
