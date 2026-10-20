# Decision: Explicit Agent application deployment from one template

Status: proposed

## Problem

An external Agent application needs deployment, runtime bindings and resource ownership.
Running cloud deployment implicitly from sandbox creation would couple SDK lifecycle,
permissions and billing. A second Agent manifest would duplicate the user entry point.

## Decision

Consume optional `application` in template spec v3. Keep sandbox fields at the root,
retain legacy/v2 behavior, reject unsupported versions before provider operations.
Application plans are offline and explicitly applied; existing sandbox operations
never execute application hooks. B prepares a sandbox template; A additionally
deploys literal, prebuilt FC containers with durable runtime state outside FC memory.

Keep the host orchestration in `src/application/` and CLI composition in `commands/app`.
The generic template/version validator and vendored schema live in `utils` so client
core does not import an upper runtime layer. The canonical schema is owned by the
template repository and is copied without changes, with a documented SHA256.

Use one AK/STS profile snapshot for native FC inspection and Serverless Devs. Atomic
CreateFunction refuses upsert and records every returned incarnation immediately;
SD handles only triggers and async invocation configuration. Candidate readiness
checks identity, image digest, runtime revision/protocol and hooks. Receipts retain
uncertainty and support independently accepted destruction of verified owned subsets.
Source and complete tool bundles are rechecked; no broad automatic rollback runs.

## API Design

- `abx app plan [template.yaml] [--destroy RECEIPT] [--out FILE]`
- `abx app apply PLAN --yes`, `status RECEIPT`, `reconcile RECEIPT --yes`
- `abx app destroy DESTROY_PLAN --yes`
- Optional provider `ProjectTemplateOptions.createOnly` and `PreparedTemplate.ownership`
  attest whether a prepared reference can authorize cleanup. Existing launch does not
  require that extension; application cleanup does.
- Hooks use bounded request/result JSON files, correlated hook/operation IDs, explicit
  argv/cwd/environment/deadline, with no shell default and no installation auto-execution.

## Alternatives considered

- Separate Agent YAML: rejected after user review; use one template with distinct sections.
- `Sandbox.create()` invoking s: rejected because application deployment has a different lifecycle.
- Unrestricted `s deploy`: rejected because a preflight absence check cannot prevent an upsert race.
- Treating `s plan` as an accepted transaction: rejected; the host plan locks inputs, not remote state.
- Adopt every ready provider reference: rejected; readiness alone does not establish ownership.

## Dependencies

Existing Ajv/YAML dependencies plus pinned official FC and Serverless Devs credential
SDKs. Runtime/container code and durable run APIs are owned by the Python SDK.
Provider plugins remain separate from application deployment adapters.

Owner/dependency tracking:

- https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/80
- https://github.com/Alibaba-Agent-Sandbox/awesome-templates/issues/139
- https://github.com/Alibaba-Agent-Sandbox/python-sdk/issues/74

## Test Strategy

Strict schema/semantic tests; stale/forged plans; actual bounded hook subprocesses;
same-group descendant cleanup; exact SDK request serialization; create races,
partial receipts and resource replacement; runtime health revisions; CLI surface,
build/package, lint/typecheck, full repository suite and real cloud acceptance.
Unit/mock checks never substitute for FC deployment and IAM/network evidence.

## Acceptance criteria

1. Single-file inline and explicit project paths have one authoritative configuration.
2. No cloud/hook side effects during plan, import, installation or sandbox creation.
3. Unknown fields/versions, duplicate YAML, unsafe paths, sensitive literals, mutable
   images/toolchains and stale accepted inputs are rejected.
4. Cancellation and durable run behavior stay in the optional Python runtime; local
   Agents routes are not published wholesale as business APIs.
5. Owned partial cleanup never deletes a foreign/replaced function or reused template.
6. Required CI/review and real FC apply/update/destroy gates pass before this preview
   is reported as production accepted. Missing Docker/managed state remain explicit.

## Evidence

See [verification](../../../evidence/verify/2026-10-20-template-agent-application.md).
