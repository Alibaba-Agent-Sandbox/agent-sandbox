# Decision: Describe actual CLI environment scopes

Status: proposed

## Problem

The bilingual CLI guide still describes two independent process trees in every sandbox, universal creation-time inheritance and detached standard Express --env as lifetime injection. It also labels sandbox system env as application environment and applies native direct-exec rules to the standard Express shell entry.

## Decision

Document template launch as the application startup owner, standard create/connect --env as terminal configuration, exec --env as per-process input and sandbox system env as a newly executed process observation. Distinguish standard Express Bash rendering from native process execution. Link the SDK's authenticated application environment methods and keep provider-specific capabilities explicit.

## API Design

N/A — this decision does not involve API changes. Existing parameters, provider dispatch, credentials, source notices and standard contracts remain unchanged. No new alias, flag, mode, runtime dependency or package version is introduced.

## Alternatives considered

- Apply the native direct-exec description everywhere: the standard implementation instead uses Bash -l -c.
- Add a global environment setter or change PATH handling: unnecessary for correcting prose and outside this task.
- Duplicate SDK implementation or its whole environment page: use its maintained guide and actual verified receipt instead.

## Dependencies

Refs https://github.com/Alibaba-Agent-Sandbox/python-sdk/issues/135 and https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/136. A search of existing CLI environment/envd/terminal-env Issues found no matching active documentation Issue; this routine documentation follow-up reuses those cross-repository references instead of manufacturing a duplicate bug Issue. Baseline CLI source is6d6b8e4306b452b12bc59ea7aefbcd1c8c558e3e and actual published binary is0.5.6.

## Test Strategy

Use the actual published standalone binary's local help under a new isolated HOME without credentials, inspect the pinned standard/runtime and native source, syntax-check both pages' shell examples and run documentation/health/hygiene gates. Reuse the already merged SDK136 actual public-package/local-HTTP evidence via an immutable source link. No cloud creation, dependency installation or new runtime tests are required to validate this prose change; normal current-head CLI CI remains required.

## Acceptance criteria

Both languages accurately describe terminal/process/application input and actual provider-entry shell behavior. Documented flags match official help, all local document/record/hygiene checks pass, and current applicable remote gates and independent review pass before normal merge. No package release or template rebuild follows from this docs-only change.
