# Decision: Execute named template and Serving resources

Status: proposed

## Problem

The v1 migration draft still models a single Sandbox, dynamic instances and a managed
application profile. The user approved a smaller resource configuration and requested
its complete implementation, including native FC components and consistent abx logs.
The current component runner already uses the official Devs loader in a child process,
but discards component logs and supports only managed application operations.

## Decision

The public document starts at `specVersion: 1`, with `name`, optional author-defined
`vars`, and named `sandbox` and `serving` collections. Names are globally unique.
`registry.yaml.parameters` is publication/initialization metadata; local execution
uses only `template.yaml` and its explicit configuration references.

Sandbox `template.region` remains a template attribute. Its sibling volumes inherit
that region. Provider-specific template attributes are flat. Express maps them to the
Sandbox/2026-08-20 request, preserving omitted fields rather than inventing defaults.
`buildConfig` is either `dockerfile` with optional `context` (default: Dockerfile's
parent), or native `steps`. Neither branch is inferred from unrelated local files.
The `image` field is the input for image-only/native Steps preparation and the push
target for Dockerfile builds. Native Steps return a template reference; no confirmed
API exports their final snapshot as a pushed OCI image.

Ordinary configuration does not expose `osType`, `registryType`, `acrInstanceId`,
`buildConfig.copy`, `envdInject`, or `installStorageClients`. Platform inference and
existing registry configuration own inferable details; Dockerfiles/base images own
software installation. Optional registry auth, TLS and network overrides remain.
Native start/readiness commands run in template preparation, not after each dynamic
instance creation. Static volume registration does not create/delete underlying storage.
Borrowed references are observed, never updated or deleted; owned retained volumes
survive application removal.

Serving keeps component-native props and precise component versions. The
`serverless-devs/` routing prefix is removed only at the native loader boundary.
The official Devs parser resolves variables; resource outputs are deferred until the
producer is ready. Resource-local actions run on the deployment host in declaration order.
Pre/success/fail/complete actions preserve the original failure and completed effects.
Component execution, credentials, results and logs use the existing isolated runner.
Logs are redacted and forwarded through abx logging; raw stdout cannot corrupt JSON.

No public `access`, `application`, `outputs`, `runtimeConfig`, `sandboxConfig`, generic
`build/builds`, or dynamic `instance` declaration is retained. Existing business API
runtime settings must move to their actual application code/FC configuration rather
than being dropped. Deploy prepares templates/volumes and deploys Serving; business
code or explicit SDK/CLI calls create dynamic instances.

## API Design

Resource references use `${resources.agent.output.templateId}`. Planning validates
missing resources and cycles before effects. Execution records account/region/resource
identity and intent before writes. Template submission is not readiness. Component
props and resolved secrets are never copied into public plans or ownership records.
`abx deploy SOURCE --plan` previews resources; `abx deploy SOURCE --yes` applies them.
Named status/delete use the same ownership record. Build prepares reusable artifacts
without creating dynamic instances.

## Alternatives considered

- Move region to the resource root: rejected by the user; template owns the property.
- Require `serverImage`/`sandboxImage` variables: rejected; vars keys are arbitrary.
- Expose every native field: rejected; repeated inferred inputs increase user work.
- Reimplement FC: rejected; preserve native component behavior and adapt its host.
- Pretend Steps push OCI output: rejected; unsupported by the verified API contract.

## Dependencies

Official Devs parser/loader, current Sandbox API and existing abx credential/logging
and process helpers. Contract owner: https://github.com/Alibaba-Agent-Sandbox/awesome-templates/pull/311
Registry consumer: https://github.com/Alibaba-Agent-Sandbox/registry/pull/102
Existing CLI migration: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/249

## Test Strategy

Shared contract parity, real native-parser and component-loader execution, dependency
ordering, actions, omitted/native request fields, readiness, borrowed/retained cleanup,
secret-safe logs and failure recovery. Run CLI typecheck/lint/build/full unit checks.
Real cloud validation is recorded separately; no mock result establishes cloud support.

## Acceptance criteria

- New configuration is the public accepted format and examples match execution.
- Dockerfile/context and native Steps work independently; no accidental dynamic instance.
- Native FC calls and logs reach the standard CLI through one component host.
- Missing references/cycles fail before writes; only ready producer outputs are consumed.
- Partial failures retain enough identity to inspect and clean owned resources safely.
- Affected templates, Registry consumption and bilingual user docs match the contract.
- Required checks and real component/cloud scope are recorded honestly before merge.
