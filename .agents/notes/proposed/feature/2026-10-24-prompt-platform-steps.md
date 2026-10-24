# Decision: Complete prompt creation through existing platform steps
Status: proposed

## Problem

A new developer using the public create help passes `--detach` to natural-language
creation, but the native generation route rejects it. Without local Docker,
generation produces an artifact that cannot reach deployment. A submitted cloud
template is not yet ready for sandbox creation. Public template guides also retain
retired capability fields that contradict the shared spec v4 workflow contract.

## Decision

Accept detach on prompt creation, expose the actual route help, and pass an explicit
Express build mode through the existing generator and deployment extension. Keep
Docker as the default. Reuse the provider's existing base-image materialization and
Ready waiter. The generator receives the concrete image and must preserve it;
ordered platform steps carry application files, dependency installation and runtime
ownership. The guidance uses the published server alpha with the official index.

Use existing provider extensions, build-plan validation and polling progress. Do not
introduce a new template registry, artifact service, interpreter binding or retrying
model generation. Keep failed generated files and report the owned template ID.
A real diagnostic also exposed ignored native process OS-user options. Select an
explicit user through the existing per-request envd Basic principal, preserving
default identity and gateway headers without mutating shared authentication.
Engine/EPP payload contracts and the standard implementation stay unchanged.
Direct template deployment retains its submission-only result. Update bilingual
guides and the packaged Skill to the actual workflow and authentication contracts.

## API Design

Express prompt creation accepts `--build auto|dockerfile|steps` and `--detach`.
Generation adapters receive optional buildMode and baseImage fields. Providers may
supply a resolved generationBaseImage through the existing CLI extension boundary.
Standard positional create and its pinned options are unchanged.

## Alternatives considered

- Require Docker for all generated templates: excludes the existing supported cloud
  build path despite the user's requested developer journey.
- Rewrite the template architecture: unnecessary; build plans and Ready polling exist.
- Edit generated files in the acceptance harness: would hide generator failures.

## Dependencies

Existing Express template administration, provider profile, Qwen Code generation,
shared spec v4 schema and `agent-sandbox-server==0.3.1a1` (published alpha).
Issues: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/128 and
https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/130
Python counterpart: https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/94

## Test Strategy

Regression tests cover option dispatch, explicit build validation, image preservation,
submitted-to-Ready sequencing and failure propagation. Run the full unit suite,
repository gates, real model/cloud creation, HTTP business calls, CLI files/process/
system/PTY operations, exact owned-resource cleanup and installed-artifact checks.

## Acceptance criteria

- Default Docker behavior and direct-deploy submission semantics remain compatible.
- A fresh model-generated steps artifact reaches Ready and an actual sandbox.
- Its API and CLI return independently checked business outputs and a valid plot.
- Failed and successful resources are cleaned by precise identity and readback.
- Bilingual docs, packaged Skill, release version and regression evidence agree.

## Evidence

- [Verification](../../../evidence/verify/2026-10-24-prompt-platform-steps.md)
