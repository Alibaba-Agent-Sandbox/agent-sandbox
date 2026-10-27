# Decision: Preserve safe template preparation diagnostics in CLI 0.5.7

Status: implemented

## Problem

A source template can collect all credentials in one CLI session and then fail during Docker dependency installation. The launch boundary replaces Docker errors with generic E8002, hiding the failed phase. Directly forwarding upstream stderr could expose credentials. Previously merged initialization fixes are absent from public CLI 0.5.6.

## Decision

Preserve existing typed Docker, registry and platform preparation error codes with controlled messages and the existing recovery-journal reference. A provider-shared DockerBuildFailure derives fixed diagnoses from build output, prioritizing network evidence over misleading dependency-resolution messages. Never forward arbitrary tool output through the final error. Release the reviewed initialization fixes and these diagnostics together as CLI 0.5.7 using the normal five-platform GitHub and npm workflows. SDK configuration stays noninteractive.

## API Design

DockerBuildFailure(output: string, exitCode: number) extends DockerBuildError. Its message and suggestion contain only controlled text and an integer exit status. Existing DockerBuilder.build signature and E7020 remain unchanged. Preparation retains E7021/E7022/E7010/E7011 without forwarding raw provider exception messages.

## Alternatives considered

- Forward raw stderr — can expose unknown credentials and private build inputs.
- Keep generic E8002 — incorrectly diagnoses a build failure as configuration failure.
- Disable TLS, change dependency pins or force host networking — conceals an environment failure and changes unrelated security or build semantics.
- Add another wizard or SDK configuration command — unnecessary; existing CLI initialization and environment/configuration sources already provide the intended flow.

## Dependencies

Existing DockerBuilder, shared project prerequisites, typed errors, resource journal and release workflows. No new package dependencies.

## Test Strategy

Regression tests cover controlled diagnoses, network-priority classification, unknown secret omission, typed preparation phases, one submission and no sandbox creation on failure. A real failing Docker RUN checks CLI JSON and the journal. Real Express source-template journeys exercise initialization, build credentials, image push, registration, readiness, commands and owned-resource cleanup. Public npm installation and the original OpenCode reference are rerun after publication. Full make ci, repository health, package verification and normal remote CI gate delivery.

## Acceptance criteria

- A failed Docker build returns E7020, a useful controlled diagnosis and recovery guidance.
- Registry and platform failures retain their existing typed phases and do not disclose raw exceptions.
- No automatic replay or change to resource ownership/recovery semantics.
- Real Express source acceptance and cleanup are recorded separately from environmental prerequisites.
- CLI 0.5.7 is public only after normal source and platform gates; public-package reruns are recorded as fresh evidence.

## Evidence

- [Verification](../../../evidence/verify/2026-10-27-template-build-diagnostics.md).
- [Issue 197](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/197).

## Implementation

CLI 0.5.7 is public on GitHub, official npm and the website mirror. The [publication and independent public-consumption receipt](../../../evidence/verify/2026-10-27-cli-057-publication.md) records final source/platform gates, exact artifact identity, real Express source reruns and cleanup. Candidate evidence is immutable. Optional model inputs remain explicit environment/configuration inputs; no SDK configuration command was added.
