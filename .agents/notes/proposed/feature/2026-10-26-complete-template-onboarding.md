# Decision: Complete template onboarding using existing CLI configuration

Status: proposed

## Problem

Initialization, catalog discovery and launch required users to join separate instructions. Application credentials bypassed configuration guidance, and transport resolution, validation and source acquisition had duplicated implementations. Reproduction and acceptance: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/189.

## Decision

Extend the existing guided-configuration callback with its resolved values. Add one CLI runtime-environment helper, optional catalog continuation after setup and a picker for launch without a reference. Generate and save a CLI-only application token during initialization; reuse it for creation, validation and later named-command calls. Keep automation noninteractive. Resolve both transport views with the same pure resolver, share field/authentication rules and source acquisition, and share PAX parsing while preserving extraction policies. Do not create a workflow framework or add Python SDK configuration commands.

## API Design

The internal configuration callback receives a readonly values object. `withTemplateEnvironment` explicitly passes resolved runtime values into the existing launch lifecycle. `server_token` maps to ABX_SERVER_TOKEN and remains outside the exported Python configuration-name schema. Existing callbacks remain compatible. `template launch` accepts an omitted reference only in an interactive terminal.

## Alternatives considered

- Patch only the remote launch error: leaves local and generated paths incomplete.
- Add a generic dependency/workflow engine: unnecessary for existing operation stages.
- Change process.env for one command: leaks configuration across concurrent operations.

## Dependencies

Existing CLI prompts, configuration storage, template catalog and shared launch lifecycle. Shared authentication test vectors are owned by https://github.com/Alibaba-Agent-Sandbox/python-sdk.

## Test Strategy

Test initialization/picker continuation, local/remote runtime prompts, generated creation, explicit/stored/temporary values, cancellation, automation, no secret output, no mutation replay, transport compatibility and archive readers. Run all owner gates, packaged and real-cloud checks; capture changed CLI output separately from historical evidence.

## Acceptance criteria

- A user can initialize, select a template, fill missing settings and create through the same CLI flow.
- Application credentials are reused without copying cloud keys into runtime input or changing global process environment.
- CLI and SDK configuration responsibilities remain distinct.
- Shared helpers preserve provider ownership, protocol behavior, extraction policies and automation contracts.
- Required checks, evidence and review pass before merge.

## Evidence

- [Verification](../../../evidence/verify/2026-10-26-complete-template-onboarding.md).
