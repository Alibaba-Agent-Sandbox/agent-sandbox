# Decision: Share whole-template launch for generated applications

Status: proposed

## Problem
Natural-language creation duplicated deployment and creation instead of using the existing whole-template executor, resource journal and service checks. Maintaining both paths increases complexity and makes behavior harder to keep consistent.

## Decision
Extract the existing launch executor from its CLI presentation. Both entry points prepare once, create once, start the declared services through the provider and verify readiness. Newly generated applications declare an empty runtime token name; the creation command validates this known requirement before invoking the model. Resolve runtime environment separately from image preparation, with explicit creation values overriding process values.

## API Design
No new CLI option, template type, credential store or auth mechanism. Remove the unused provider-specific generated deployment extension. Existing create JSON fields remain; TemplateID and Services expose the exact prepared reference and application endpoints. Existing anonymous user templates keep their declared behavior. Generation-only does not require runtime credentials.

## Alternatives considered
- Restart or patch the already-running service: preserves duplicate lifecycles and introduces a second startup mechanism.
- Add another credential or workflow mode: unnecessary because template launch already owns preparation and runtime startup.

## Dependencies
Existing template launch executor, provider-owned preparation, runtime environment declarations and resource journal.

## Test Strategy
Unit coverage verifies model/build/create are all untouched on a missing required token, explicit runtime precedence, no host-secret inheritance, one preparation/create, unchanged direct-template behavior and compatible output. Fresh real model/native-cloud execution asserts all CLI/SDK/POST/PTY paths, directory ownership, source hashes, application credential boundary and exact cleanup. Official public-package reruns remain a release gate.

## Acceptance criteria
- One shared prepare/create/start/readiness implementation.
- Required runtime input is checked before model work; values never enter generated artifacts or build recipes.
- Upload, metadata, volume mounts, request timeout and sandbox lifetime preserve their existing options.
- Scope-specific tests, full repository CI and real source-candidate/public-package E2E pass.

## Evidence
- [Verification](../../../evidence/verify/2026-10-25-generated-template-launch.md)
