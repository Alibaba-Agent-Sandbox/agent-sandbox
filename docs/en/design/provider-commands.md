# Provider management commands

Status: proposed; implementation and verification are tracked in the repository ADR.

## Existing command surfaces

Core CLI groups and shortcuts are fixed in `src/cli/command_surface.ts`. Providers implement
the shared sandbox protocols and declare the existing 18 feature tokens. Those tokens are
not executable management commands. `abx sandbox command` discovers application commands
registered by the server inside a sandbox; it does not manage cloud infrastructure.

Provider management commands have the identity `(provider ID, command ID)`. They cannot
replace core commands, application commands, or another provider's command. The portable
feature registry remains unchanged. Installed plugins without commands remain compatible.

## Static registration and discovery

Manifest version 1 gains this optional, separately versioned section:

```toml
[commands]
protocol = "provider-commands/1"

[[commands.entries]]
id = "volume.list"
description = "List this provider's volumes."
description_zh = "列出此提供方的存储卷。"
effect = "read"
idempotent = true
input_schema = { type = "object", properties = {}, additionalProperties = false }
output_schema = { type = "object" }
```

There are at most 128 commands, sorted by ID for display and consent comparison. IDs match
`^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$` and contain at most 80 characters. Each descriptor is
at most 64 KiB and has at most 16 levels of nesting. Both descriptions, both schemas,
`effect` (`read`, `write`, `delete`) and the boolean `idempotent` are required. Input is an
object with `additionalProperties: false`. The validator uses JSON Schema draft 7, without
external/local references, asynchronous validators, custom keywords, formats or regex
keywords. Schema IDs and prototype-related keys are rejected. These restrictions bound
validation and prevent schema resolution or interpretation from making network requests.

Discovery reads metadata only: no plugin import, credentials, sandbox connection or cloud
request. Non-link installations verify integrity before trusting metadata. Node and exec
plugins may declare commands; a declarative REST plugin cannot supply arbitrary handlers.
Built-in commands use the same descriptor and validation contract. Full descriptors enter
installation consent and update comparison; adding a command or changing its schema/effect
requires renewed consent. An absent commands field in an older receipt means an empty list.

## Invocation contract

The host exposes `listProviderCommands`, `getProviderCommand`, and `runProviderCommand` in
`src/providers/commands.ts`. It rejects unknown IDs with E8004 and malformed input with
E8002 before loading a plugin or opening a connection. Validation never coerces values,
inserts defaults, or removes unknown properties. Inputs are bounded JSON objects (1 MiB,
32 levels); results are bounded JSON values and checked against their output schema.

A Node plugin returns optional `provider_commands: { run(command, input, signal) }` from
`buildInfra(ctx)`. An exec plugin answers exactly `provider.commands.run` with
`{command, input}`. This is a declared-command dispatcher, never an arbitrary RPC, shell,
URL, SDK-method or module-name passthrough. Missing handlers remain E8004.

Configuration resolves for the explicitly named provider and current invocation. Plugins
receive only their declared options and consented inherited keys. Credentials belong in
provider configuration, not command input. Errors and results redact known credentials;
generated secrets must additionally be redacted by the adapter. The host validates results,
closes resources on every path, and enforces a bounded call timeout. Timeout means the
outcome of a cloud mutation may be unknown: abort and cleanup are best effort and do not
prove that the remote operation was cancelled. Management invocations are never replayed
automatically, including operations marked idempotent.

Provider handlers execute as trusted host code. Schemas, declared effects and confirmation
protect the invocation contract; they do not sandbox plugin code or prove which cloud actions
a handler performs. Installation trust and cloud IAM/RAM permissions remain the authority
boundaries. Metadata must not be presented as a restriction on a malicious handler.

## CLI and SDK transport

```text
abx provider command list PROVIDER
abx provider command info PROVIDER COMMAND
abx provider command run PROVIDER COMMAND --input '{"team_id":"..."}'
abx provider command run PROVIDER COMMAND --input-file request.json --yes
```

`--input` and `--input-file` are mutually exclusive; omitted input is `{}`. Existing JSON,
quiet, error-code and provider configuration conventions apply. Writes and deletes require
explicit `--yes`; reads do not. Input parse errors never echo the input. The file form avoids
putting certificate material in argv. Global/provider-specific options cannot silently switch
the positional provider.

The existing authenticated loopback engine gains fixed routes:

| Method | Route | Result |
| --- | --- | --- |
| GET | `/v1/providers/:provider/commands` | `{commands: descriptor[]}` |
| GET | `/v1/providers/:provider/commands/:command` | descriptor |
| POST | `/v1/providers/:provider/commands/:command` | command result |

POST body is `{input: object, confirm: boolean}`. Non-read operations require `confirm: true`.
Provider identifiers in the path and connection must agree (E8030). The engine's existing
Bearer, loopback, Host and Origin checks apply. Each request resolves its own connection;
management credentials and results are not cached as sandbox sessions. The Python SDK is
a thin engine client, and disables transport retry for command invocation. Built-in sandbox
execution remains usable without Node; these new management APIs explicitly require the
Node engine. Other SDKs may consume these routes without another cloud implementation.

MCP exposure is deferred: the existing sandbox MCP tools must not implicitly receive
account-level management authority. A later opt-in management tool can reuse these APIs,
with an explicit provider/command allowlist and separate read/write permissions. This work
does not claim such MCP tools exist.

## Provider capability delivery and review

Implement only documented cloud operations, using the official SDK's actual request models.
Keep supported, console-only, backend-dependent and unverified capabilities distinct. A model
class without a callable client method is not proof of an API. See
[Alibaba Cloud management commands](alicloud-provider-commands.md) for the capability matrix.

Independent agents first audit registration, authoritative backend interfaces, and cross-language
contracts. One owner establishes the shared contract before adapters are implemented in disjoint
files/worktrees. Cross-review checks naming, credential boundaries, input rejection before I/O,
mutation replay, cleanup and declared-versus-callable capability claims. The coordinator owns
integration and verifies actual test results, remote checks and merge state; agent conclusions
and mocks cannot substitute for cloud evidence.

Verification runs must also isolate sockets, temporary roots and cloud-resource ownership.
Process IDs alone can collide across tool namespaces. Suites using a fixed port run
sequentially; independent suites may run in parallel only when their resources are disjoint.

Acceptance covers legacy manifests, malformed/duplicate descriptors, consent changes, static
discovery, Node and exec dispatch, schema rejection before I/O, CLI/engine/Python parity,
credential redaction, malformed results, timeouts, exception cleanup and official SDK mappings.
Real cloud checks use scoped resources and cleanup; missing prerequisites remain blocking
evidence, with the ADR proposed until required gates pass.
