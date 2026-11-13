# Decision: Reuse the native component host with structured CLI logging

Status: proposed

## Problem

The existing managed application adapter already loads the official Devs component directly.
Its injected logger counts and discards messages. It forces a temporary working directory,
fixed deployment arguments and four lifecycle methods, so it cannot run native resource build
actions with project-relative paths or show progress using the existing CLI output manager.

## Decision

Extend the isolated host, preserving the official component implementation. The generic host
accepts a pinned component, command, argv, project directory, native props and one credential
snapshot. It passes the original project path as the YAML base, so native build artifacts remain
available to the following deploy. Resource orchestration owns action ordering and deployment
readiness; the component host does not execute hooks itself.

Use a separate bounded log event pipe. Forward logger methods, console calls and direct stream
lines through the existing namespaced logger and OutputManager. Buffer stream lines before
redaction, strip terminal controls and redact known credentials and sensitive props. Results use
a private independent pipe. Parent cancellation, deadlines and output limits kill the child
process group. Cloud effects already submitted may still require reconciliation.

## API Design

`invokeDevsComponent(ComponentExecutionInput): Promise<unknown>` returns the native method result.
`onLog(ComponentLogEvent)` is injectable; the default uses existing CLI stderr/verbosity behavior.
`execute` adds optional event and raw output callbacks while retaining existing caller defaults.
The old managed host request shape remains an internal compatibility detail, not public YAML.

## Alternatives considered

- Reimplement FC build/deploy and its logger: duplicates upstream behavior and update burden.
- Run components in the CLI process: exposes mutable native process environment and singleton logs.
- Print component stdout directly: corrupts JSON output and bypasses credential redaction.
- Suppress every log: prevents useful build and deployment progress and diagnostics.

## Dependencies

The already pinned `@serverless-devs/load-component` 0.0.10-beta.7 and existing CLI logger.
No new package or native component fork is introduced.

## Test Strategy

Exercise the real isolated process with a fixture component loaded by the official loader;
verify build-to-deploy artifacts, arguments, paths, credential snapshots, logs, errors and tree
termination. Load the actual fc3 0.1.26 release bundle and call its read-only getSchema method.
Cloud deployment and the complete resource lifecycle are separate integration gates.

## Acceptance criteria

- Native build and lifecycle methods receive project paths and unchanged native props/argv.
- Credential callbacks return copies of one snapshot without additional credential resolution.
- All tested logging paths preserve stdout for results and redact credentials before transfer.
- A timed-out child cannot leave its tested descendant running.
- The old managed loader fixture still passes; the new resource executor uses this same host.
- Complete resource deployment is validated separately before claiming cloud readiness.

## Consequences

The public resource contract now exposes named Sandbox and Serving resources. Source discovery
projects a single Sandbox only when exactly one exists, and never turns native template
start/readiness commands into instance hooks. The former manifest-driven instance launch and
managed-recipe adapter reject their retired input path before side effects; internal stored
managed receipts keep their separate cleanup types. Scaffolds and generation guidance use the
new shape, and MCP is expressed as a native FC Serving resource with its process-local session
persistence limit stated. Runtime environment helpers remain available to explicit creation and
credential setup flows.

## Native FC create-only admission and public lifecycle boundary

The release fc3 bundle embeds its SDK. Decorating an external SDK package cannot constrain
its create/update fallback. The isolated host instead installs request admission on the
built-in HTTP, HTTPS and HTTP/2 channels before loading the original component. For a new
owned function, only one create mutation at the selected FC endpoint is permitted until the
response confirms the expected function name and a native function ID. A conflict, uncertain
repeat, or native no-op does not grant ownership. Response observation preserves the SDK's
paused reader; adding a data listener consumed bytes before the SDK attached its reader and
was rejected by the real-bundle probe. The normal native FC component still owns props,
packaging and deployment logic. Existing owned-function updates use their independent ID
verification and do not enable the creation gate.

Public deploy accepts SOURCE, name, build, plan, build-timeout and yes. Dynamic instance
creation/deletion lives at sandbox create/delete. Old managed receipt helpers remain private
for cleanup; no old schema or public dynamic deploy flags are restored. Managed catalog
entries without source direct users to sandbox create with the native template reference.
