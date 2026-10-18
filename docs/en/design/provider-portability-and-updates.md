# Provider portability, ownership and updates

Status: proposed; the safeguards in this change do not complete the legacy FC extraction.

## Migration contract

Agent Sandbox is a client and tool layer over existing providers, not a destination cloud.
An Express user can keep the same account, region, Team, sandbox API key, template IDs,
Volumes and RAM roles. Adopting this client does not require exporting resources or
rebuilding an existing template. It is **not a zero-change E2B SDK replacement**.
Imports, configuration names, method coverage and return/error types need review.
Using an existing sandbox also requires its same-Team credential and a live lease;
connecting does not make the client its exclusive owner or authorize deleting it.

The Python owner's [Express migration guide](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/31c8b5c60badba9436e7400f75b32f6d13253a5c/docs/en/guide/migrate-from-alicloud-express.md)
defines the source/API differences and an explicit environment mapping. Do not add
silent `E2B_*` credential aliases: that could send another backend's key to Express.
There is no implemented one-click migration command. Do not advertise one.

Language scope also matters: the public `nodejs-sdk` currently exports configuration
names and a port-9000 `ServerClient`, not cloud `Sandbox.create` or provider lifecycle.
An E2B JavaScript application cannot migrate by changing its import to that package.
The TypeScript CLI implementation is not evidence of public Node SDK parity. See the
[Node SDK scope](https://github.com/Alibaba-Agent-Sandbox/nodejs-sdk/blob/main/README.md).

## Ownership audit

| Concern | Owner and current implementation |
| --- | --- |
| Command registration, JSON output, schemas, validation, consent, integrity, timeouts and cleanup | Generic CLI/host. No per-vendor endpoint branches should be added here. |
| Backend URLs, authentication/signing, wire aliases, polling/status semantics, image/template interpretation and unsupported operations | Selected provider adapter. Plugins receive only their own config and consented inherited fields. |
| Express resource operations | Built-in `providers/alicloud_commands.ts` and `providers/fc_sdk.ts`; SDK method mapping stays here. |
| Express template deployment and parts of native lifecycle/auth | Legacy `cli/commands/template.ts`, `api/fc_template.ts`, `protocol/` and `transport/`. These remain coupled; the provider abstraction is not complete. |
| Docker build plans, local image build/push mechanics and template cache | Reusable host services. A shared helper must take provider-selected parameters rather than assume ACR or FC. |
| Image authoring defaults | Provider `[template]` profile; a Dockerfile profile does not implement deployment. |
| Template/provider compatibility rows | Template author usage hints, intersected with adapter capabilities; neither feature flags nor these rows are native E2E evidence. |
| Provider create examples | Provider-owned, non-executable `catalog.json`; the registry renders data instead of switching on vendor IDs. |

Filtered configuration is a routing contract, not a process sandbox. Node plugins
are trusted host code and can access host resources; declared features/effects do
not replace cloud IAM/RAM permissions or install-time trust decisions.

Legacy template read/build commands currently have only the FC implementation. Even
a plugin declaring `templates.read` or `templates.build` must get E8004 before this
implementation resolves FC credentials or touches Docker/ACR. An advertised feature
is not a dispatch adapter. This safeguard does not disable a separately implemented
provider image factory.

## Template contract and pending delivery

Reuse the optional `templates.deploy` / `buildTemplates(ctx)` contract in
[CLI PR #42](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/42), not another
SDK or arbitrary CLI/shell passthrough. It accepts a normalized, already pushed image,
scoped resource/start/readiness/registry inputs and returns allowlisted ready metadata.
Provider adapters own API calls, units, polling and rejected options. A caller cannot
assume a factory accepts a directory, Dockerfile, build steps or another provider's
start/readiness semantics. Unsupported inputs fail before I/O.

| Provider | Current installed workflow | Additional implementation and remaining gate |
| --- | --- | --- |
| Express | Existing template ID/alias; legacy FC deploy workflow | Full extraction into a built-in template adapter remains pending. |
| Container edition | Existing sandbox-manager template ID | Native cluster/template provisioning is not invented by the host. |
| CubeSandbox | Existing cluster template ID; no declared PTY | [PR #10](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/pull/10) has an unactivated native image adapter; needs a real authorized Cube/KVM backend. |
| E2B | Existing E2B template ID | [PR #5](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/pull/5) has an unactivated official-SDK image adapter; needs native E2B acceptance. |
| OpenSandbox | Provider-resolved image URI/alias | Docker image create and a golden-image/template service are different contracts; backend/runtime acceptance is required for the latter. |

The optional host, shared schema, UI/catalog and adapter deliveries must agree before
activation. Their draft PRs are not installed/public releases. Never set the deployment
feature just because the backend has a similarly named model or because a mock passes.

## Express coverage and AI use

The [FC capability matrix](alicloud-provider-commands.md) owns supported command inputs.
The existing [real storage record](../../../.agents/evidence/verify/2026-10-16-provider-volume-live.md)
proves OSS Volume create/get/list/delete, actual kernel mounting and file I/O,
sandbox-recreation persistence, Team/key/quota lifecycles and owned-resource cleanup
for its recorded configuration. It does not prove every feature, region or template.
`volume.update` state transitions remain unverified. Domains, dynamic mount/attach,
STS management tokens and newer JuiceFS fields are not established by this adapter.
Do not describe 20 mapped management methods as all Express capabilities tested.

AI callers should first use `provider info --json`, static command list/info and the
selected input schema. Read/list calls do not authorize writes; writes/deletes require
explicit confirmation. Keep secrets in protected config/input files, never argv or
logs. A timed-out mutation has an unknown outcome: inspect owned resource state before
retrying. Track exact resources created by the run; delete only those, not a reused
Team, key or template. Management MCP exposure is explicitly deferred; sandbox MCP
support does not implicitly give an agent account-management authority.

## Update lifecycle

| Installation | Operation and result |
| --- | --- |
| Git plugin | `abx provider update ID --check`; apply with `--yes` after review. Source/ref, tree digest, minimum host version, full descriptors and renewed consent govern replacement. Failed verification rolls back. |
| Pinned Git plugin | Stays `pinned` without an explicit `--ref`; it is not automatically moved to a branch or latest release. |
| Local copy / development link | Reinstall the reviewed source with `--force`; bulk CLI update reports `manual`. Link mode remains a trusted development mode. |
| Python catalog install | Python installer updates from its recorded catalog; the CLI reports manual/reinstall guidance rather than silently changing sources. |
| Built-in Express in abx | `abx provider update alicloud-express --check` returns `bundled`, installed host version, `available: null` and host-upgrade guidance. It does not query the latest host release or install software. |
| Built-in Express in Python | `python -m agent_sandbox.providers --json update alicloud-express --check` reports `bundled`. Upgrade matching client/server releases using their original install method; Node management also needs a compatible abx release. |

`--all` does not silently discard Git download/handshake errors or call local/catalog
sources up to date. `--ref` is not a separate version selector for the built-in provider.
No provider command runs npm/pip, overwrites the running binary, forces moving refs,
or kills an unknown engine. Host upgrades follow the original pinned installer/package
workflow; restart only owned engines, then rerun version, doctor, feature discovery
and relevant acceptance checks. Existing sandboxes are backend resources and are not
recreated or upgraded by replacing a local provider. Rollback needs both the previous
host/provider release and its compatible configuration; persistent plugin data remains
outside the replacement tree.

## Remaining acceptance

Extract the FC template/lifecycle compatibility boundaries behind explicit adapters
without changing existing public imports; migrate vendor config/endpoint logic with
regressions. Complete native acceptance before activating optional factories. Resolve
the recorded mandatory local aggregate failures. Cold registry/SDK imports now run
before test hooks/operation assertions without increasing timeout budgets. Verify
exact-head remote checks/reviews, then land the shared host before consumers.
None of these pending gates is waived by this design.
