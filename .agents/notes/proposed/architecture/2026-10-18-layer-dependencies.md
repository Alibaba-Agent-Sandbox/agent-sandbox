# Decision: Remove CLI root cycles and upward exception imports
Status: proposed

## Problem

Commands import the root for error handling while the root lazily imports them.
Transport/protocol import pure exception helpers from API; transport config
imports provider error values from the implementation layer.
https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/55

## Decision

Extract error rendering to cli/error_handler, move pure exception helpers to
utils/_pyerrors and provider error definitions to models/provider_errors.
Use the lower modules in transport/protocol and the independent handler in
commands. Preserve old root/API/provider re-exports and class identities.
Keep lazy loader seams, callbacks, exit codes and output bytes unchanged.

## API Design

No CLI surface change. Existing deep import symbols re-export the same objects.
The low-level modules import only their own/lower dependencies. Existing
provider-specific exit mapping remains shared by root orchestration and handler.

## Alternatives considered

- Ignore cycles because imports are lazy: still couples commands to root setup.
- Delete compatibility paths: unnecessary programmatic break for a move.
- Duplicate exception classes: breaks instanceof/error mapping across consumers.

## Dependencies

Orphan cleanup PR53 and API-key PR54 are merged in
https://github.com/Alibaba-Agent-Sandbox/agent-sandbox.
No new dependency or cross-owner schema change. Registry/website aggregate
updated bilingual architecture source docs without a catalog feature change.

## Test Strategy

AST dependency graph, existing command/error/transport/protocol regressions,
full tests/types/lint/build, goldens byte comparison and actual built CLI
standard cloud lifecycle slice with owned cleanup. Keep local environment
failures distinct from latest-head hosted acceptance.

## Acceptance criteria

- Commands no longer import root; root cycle absent in AST graph.
- Lower transport/protocol dependencies do not import API exception helpers.
- Existing imports retain object identity and observable behavior.
- Required checks, real component run, bilingual docs/changelog/record pass.
