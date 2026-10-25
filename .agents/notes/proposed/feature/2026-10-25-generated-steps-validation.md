# Decision: Validate generated native steps before cloud deployment

Status: proposed

## Problem
A fresh public CLI 0.5.1 model run omitted `base.image` and embedded stale command source. The local commands.py and Dockerfile were valid, so checking only those files could not establish that the native cloud recipe would execute the same code.

## Decision
Restrict the generated recipe to existing `build.run` dependency commands. Assemble native provider preparation and source delivery deterministically from the provider-resolved image/profile and final local file bytes. The CLI installs the current public server alpha, writes source using encoded real bytes, performs WORKDIR before relative dependency installation and ownership repair, then restores the existing runtime user. No model-authored base64 or native delivery recipe is deployed.

## API Design
No new public options or schema. This preparation applies only to newly generated `steps` workspaces. User-authored templates retain their existing native-step support unchanged.

## Alternatives considered
- Fill only a missing base image: leaves stale model-written file payloads undetected.
- Disable native steps: would remove the documented Docker-free path.
- Ask the model to correct its recipe: a real bounded correction still generated invalid YAML; remove that unnecessary state and own serialization in code.

## Dependencies
Existing Qwen Code generation, template validation and native build-plan parser.

## Test Strategy
Regression tests decode the actual generated file-delivery step, assert exact final source bytes, retain dependency commands and ownership ordering, and reject provider-image changes, model-authored delivery and escaping symlinks. Repeat a fresh real model generation, native cloud build, CLI/SDK/HTTP calls and exact resource cleanup.

## Acceptance criteria
- Generated preparation uses existing provider defaults and final source bytes.
- No additional model call or state machine.
- No stale model-authored delivery recipe is deployed.
- Existing non-step validation behavior is preserved.
- Required CI and real cloud execution pass.

## Evidence
- https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/157
- [Verification](../../../evidence/verify/2026-10-25-generated-steps-validation.md)
