# Decision: Provider-owned operations with contextual help and one dispatcher

Status: proposed

## Problem

Provider management operations already have shared descriptors and handlers, but users must learn
an explicit catalog query before discovering them. Separately adding vendor-specific CLI routes,
SDK mappings and website tables would create competing sources of truth. Injecting arbitrary
operation IDs directly under `provider` would also collide with host commands such as `list`,
`install` and `default`. Previous documentation overstated installation as never executing plugins.

The product needs a coherent journey: install, choose a Provider, ask for help, inspect input,
execute, update and repair. This decision addresses that command/help contract. Existing Python
handshake defects, package publication and separate website/Registry content defects remain
independent acceptance work; this change does not certify them as fixed.

## Decision

1. Keep host installation, configuration, default selection and diagnostics as fixed commands.
   Add canonical `abx provider run OPERATION` for operations of the selected Provider. Preserve the
   complete operation ID as one opaque argument; dots are not subcommand separators.
2. Use `provider-commands/1` as the only operation metadata and execution contract. The Provider owns
   descriptions, schemas, effects, credentials, vendor API mapping and handlers. The host owns
   bounded validation, confirmation, generic dispatch, redaction and presentation. A declaration
   becomes discoverable after installation/update without a second registration command.
3. Render progressively detailed local help: root `-h/--help` shows selected Provider and compact
   grouped summary; `provider --help` shows full invocation paths and `provider run --help` lists
   the operation leaves once; `provider run OPERATION --help` shows description, input fields, input/output
   schemas, effect and confirmation. Rendering reads descriptors only: no plugin import, process
   startup, credentials, engine startup or cloud requests.
4. Resolve selection with the existing resolver for both help and execution: invocation override,
   environment, project dotenv, user dotenv, stored configuration, built-in default. Recommend
   `abx --provider ID provider run ...`; preserve provider-local option semantics. A corrupt or
   missing default degrades help with an actionable diagnostic, preserving host repair commands.
   Execution fails strictly for the selected backend and never silently falls back.
5. Keep JSON inputs through `--input` or `--input-file`, the existing input limits and write/delete
   `--yes` contract. Arbitrary schemas do not become flags. `--help` is static presentation, not
   a mutation or a request to access an account. Unknown operation and invalid-input diagnostics
   point to the complete actionable discovery/help command.
6. Preserve `provider command list/info/run ID ...` and their JSON shapes. These remain explicit
   machine-readable interfaces for AI clients and scripts, sharing the same descriptors and executor.
   Do not promise dynamic Python methods, MCP tools, shell completion or cloud-account readiness.
7. Installed plugins follow existing pinned `provider update`/consent/digest verification. The next
   invocation sees updated descriptors. Express remains bundled under `src/providers/alicloud_express`
   and updates with a host release. No second built-in installation or independent update mechanism
   is introduced. A merged source change is not proof that a published package contains it.
8. State the trust phases accurately: pre-consent metadata inspection executes no plugin code;
   post-consent default installation verification may import and initialize it. Help/discovery are
   independent of this verification phase and never invoke it.

This design takes two specific lessons from primary sources rather than copying a framework:
[kubectl plugin limitations](https://kubernetes.io/docs/tasks/extend-kubectl/kubectl-plugins/#limitations)
protect built-in commands from replacement; [oclif plugin loading](https://oclif.io/docs/plugin_loading/)
uses manifest metadata to avoid requiring command modules for discovery. These support namespace
protection and metadata-driven help here. Oclif's user-plugin resolution precedence is not adopted.

## API Design

```text
abx [-h|--help]
abx [--provider ID] provider [-h|--help]
abx [--provider ID] provider run [-h|--help]
abx [--provider ID] provider run OPERATION [-h|--help]
abx [--provider ID] provider run OPERATION [--input JSON|--input-file PATH] [--yes]

abx --json provider command list ID
abx --json provider command info ID OPERATION
abx --json provider command run ID OPERATION [--input JSON|--input-file PATH] [--yes]
```

Node handlers retain `buildInfra(ctx).provider_commands.run(command, input, signal)`; exec retains
EPP `provider.commands.run({ command, input })`. REST presets cannot declare nonempty catalogs.
No manifest protocol version, engine HTTP route, descriptor field or output-schema change is required.
Render operations as data; do not install runtime-generated top-level parser commands.

## Alternatives considered

- **Direct `abx provider OPERATION` injection** — rejected: arbitrary IDs can shadow current or future
  host management commands, and dotted IDs would acquire new accidental syntax.
- **Keep only `command list/info/run`** — compatible but insufficient as the main human journey;
  it hides already-declared operations from standard help and repeats Provider IDs unnecessarily.
- **Turn every schema property into a flag** — rejected: nested values, unions, nullability and names
  collide with host flags. A separately versioned CLI parameter contract would be required.
- **Execute plugins to populate help** — rejected: offline help must work before credentials,
  without backend delays, imports or user-code execution.
- **Invent a new registration endpoint/command** — rejected: the installed manifest already declares
  the catalog and the executor already dispatches it.
- **Add vendor switches to each consumer** — rejected: cloud behavior belongs in the Provider.

## Dependencies

- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/83.
- Existing `provider-commands/1`, CLI framework help rendering, shared Provider selection resolver,
  manifest validation, command executor, consent/pinning and bundled Express metadata.
- Catalog adapters remain owned by
  https://github.com/Alibaba-Agent-Sandbox/awesome-providers; SDK bridging remains owned by
  https://github.com/Alibaba-Agent-Sandbox/python-sdk; website content and Registry ingestion remain
  owned by https://github.com/Alibaba-Agent-Sandbox/website and
  https://github.com/Alibaba-Agent-Sandbox/registry respectively.

The system has three distinct catalogs: Provider control-plane operations, template resource
definitions, and named application commands served inside a running sandbox. They must not share
a registration lifecycle merely because each contains the word command.

| Owner repository | Contract and boundary |
| --- | --- |
| agent-sandbox | Host selection/install/trust, generic operation dispatcher, contextual CLI help and engine catalog; bundled Express adapter remains inside its Provider tree |
| awesome-providers | Installable manifests, native API/authentication/prepare/register/poll implementations and operation handlers |
| python-sdk | Python API contracts and engine bridge; operation registration does not synthesize typed SDK methods; Node handshake verification tracked separately |
| nodejs-sdk | Client of a running in-sandbox HTTP server; do not advertise cloud Provider installation or management unless implemented |
| awesome-templates | Project/image/application resource definitions, required capabilities and startup intent; no host management-operation registration |
| registry | Ingest versioned metadata and source provenance; distinguish declarations, native acceptance and the package users can actually install |
| website | Official documentation and shared UI source; consume catalog data instead of authoring another vendor command table |
| blogs | Versioned published examples; active installation tutorials must match the artifact they recommend |

Consumer rollout follows contract then implementation then packaged acceptance then public guidance.
Future Registry/help/completion consumers should read a versioned descriptor snapshot with source,
Provider version and host compatibility rather than importing arbitrary plugin code. A source SHA
does not identify a published artifact; released version, digest and actually exercised installation
path are separate evidence. The current implementation preserves the existing JSON catalog and
does not claim that this later consumer rollout or shell completion has already shipped.

Independent review findings retain their owner tracking:

- Python initialization verification: https://github.com/Alibaba-Agent-Sandbox/python-sdk/issues/79.
- Registry examples and capability truthfulness: https://github.com/Alibaba-Agent-Sandbox/registry/issues/6.
- Standalone SDK inclusion: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/85.
- Public package delivery: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/66.

## Test Strategy

Test observable help at root, Provider group, runner directory and operation level for bundled and
installed node/exec fixtures, including arbitrary operation IDs. Assert complete paths, schemas,
effects, required/optional fields and JSON inputs. Marker plugins prove discovery/help imports
nothing and starts no runtime; isolated HOME and empty credentials prove offline behavior.

Exercise explicit/env/stored defaults consistently; reject conflicting or missing execution
selections. Broken default help must retain repair commands. Preserve old JSON responses and dispatch
validation, confirmations, output validation, redaction and abort behavior. Run real CLI subprocesses
against fixture files to cover actual parser/help routing, not just rendering helpers. Run repository
typecheck, lint, unit, build, hygiene and health gates and record actual results. Do not rerun unrelated
cloud mutations merely to prove local help; this change does not create new cloud API handlers.

## Acceptance criteria

- A newly installed fixture's operation is visible in `abx -h` after default selection and in detailed
  operation help, then executable through the canonical runner without a registration command.
- All help levels work with no credentials and no plugin code/runtime/cloud execution.
- Arbitrary operation names cannot shadow fixed host commands; input remains bounded JSON.
- Default and explicit selections agree between displayed metadata and execution; no implicit fallback.
- Invalid defaults retain repair help; invalid execution remains a typed failure.
- Existing explicit-ID command discovery/execution and AI JSON responses remain compatible.
- English/Chinese guides, authoring example, packaged Skill reference and changelog agree with the
  implemented surface, update behavior, trust phases and source/release boundary.
- Latest-head CI and real CLI/filesystem verification are recorded before claiming completion.

## Consequences

Progressive help makes operations discoverable without adding another registration concept. Scripts
retain explicit stable JSON interfaces. Users still pass JSON rather than arbitrary generated flags;
this is a deliberate consistent contract for nested schemas and AI tools. The catalog shows declared
implementation, not proof of account admission or native backend acceptance.

## Implementation

First deliver the host help/runner, regression coverage and bilingual contract together. Consumer
presentation should subsequently consume the same descriptors rather than duplicate vendor tables.
Publication and the unrelated review findings require their own verified owner changes; no release
or native Provider acceptance is inferred from this ADR's presence. Keep this record proposed until
the change has passed its gates and merged.
