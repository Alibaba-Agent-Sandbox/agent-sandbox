# Decision: Preserve native template info JSON types

Status: proposed

## Problem

The native template info command formats every response value as a string before JSON serialization. Nested status/runtime objects require a second parser, while numbers, booleans and null lose their types. [Issue 162](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/162) records the reproduction.

## Decision

Send the adapter response directly to the existing JSON formatter. Keep the readable text table unchanged. Remove the cloud regression's expectation of the erroneous string serialization.

## API Design

`abx --native --json template info TEMPLATE_ID` returns the native response JSON, including `status.state` and the structured `runtimeConfig`. No additional parser, compatibility switch or response envelope is introduced.

## Alternatives considered

Parsing Python dictionary strings downstream was rejected: it preserves an accidental output defect and creates inconsistent consumer behavior.

## Dependencies

The existing native Express adapter and JSON formatter; no new packages or cloud operations.

## Test Strategy

Exercise the actual command callback with nested maps, arrays, numeric/boolean/null fixtures. Run the maintained native cloud-readonly scenario against an existing same-account template. Capture affected CLI evidence, run the full checks and record environmental failures separately.

## Acceptance criteria

- JSON preserves all adapter value types and the existing text command still passes.
- The real cloud scenario reads structured status/runtime configuration.
- English/Chinese docs, changelog and verification remain in the owning repository.
- Required latest-head CI and review pass before merge; public package validation follows the patch release.
