# Provider-owned capabilities and shared commands

## Find operations through help

Install a Provider once; its declared operations are discovered automatically. There is no separate
registration step. Select a default for interactive work, or select explicitly for a script:

```sh
abx provider default alicloud-express
abx --help
abx provider --help
abx provider run --help
abx provider run snapshot.create --help
abx provider run snapshot.create \
  --input '{"sandbox_id":"<sandbox-id>","name":"checkpoint"}' --yes
abx --provider alicloud-express provider run snapshot.list --input '{}'
```

These contextual help/run entry points require a build containing this change; the original v0.4.0
release predates them. Root help shows the selected Provider and a compact operation summary;
`provider --help` and `provider run --help` show its full directory with complete invocation paths.
Operation help shows usage, input fields, effect and confirmation. Use `abx --json provider command info PROVIDER OPERATION` to inspect the full input and output schemas.
`-h` and `--help` work alike. Help reads local metadata without credentials, plugin execution or cloud
requests. An invalid selected Provider produces a help diagnostic while keeping repair commands
visible. Actual execution fails for an invalid selection rather than silently switching backends.

`--provider ID` takes precedence over `ABX_PROVIDER`, project `.env`, user `.env`, stored configuration
and the built-in default, using the same resolver as execution. Put the global option before the
`provider` group, as above. `provider default ID` stores a preference; environment overrides still win.

An operation ID is one opaque argument, including dots: `snapshot.create` is not translated into
`snapshot create`. Provider operations stay under `provider run`, so an operation named `list`,
`install` or `default` cannot replace host management commands. Inputs remain bounded JSON through
`--input` or `--input-file`; schema properties do not become undocumented CLI flags. Write/delete
operations require `--yes`. For sensitive input use a protected local JSON file and `--input-file`.

Existing explicit-ID and machine-readable interfaces remain compatible:

```sh
abx --json provider command list alicloud-express
abx --json provider command info alicloud-express snapshot.create
abx --json provider command run alicloud-express snapshot.create \
  --input-file ./snapshot-input.json --yes
```

Use these JSON interfaces for AI discovery and automation. Human help is presentation, not a stable
JSON response contract. Provider management operations are distinct from sandbox application commands
(`abx sandbox command`) and from template preparation (`abx template launch`). Neither management
registration nor help creates a template or a cloud resource. This change does not automatically add
MCP tools, shell completion entries or typed SDK methods.

## Ownership and updates

The Provider owns operation IDs, descriptions, schemas, effects and handlers. Node plugins declare
them in `abx-provider.toml` and implement `buildInfra(ctx).provider_commands.run`; exec plugins handle
`provider.commands.run` over EPP. Nonempty command catalogs are not supported by REST presets.
The host reads that same catalog for help and JSON discovery and dispatches through the same executor.
See [authoring Providers](authoring-providers.md#provider-owned-management-operations) for an example.

For an installed plugin, `abx provider update ID --ref <40-hex-commit>` follows the existing pinning and
consent rules. Newly declared operations then appear automatically on the next invocation; no manual
registration or help generation is required. The bundled Express Provider is updated by upgrading the
host CLI release, not by installing an independent Express plugin. Verify the actual installed build:
a merged `main` change does not prove an npm package or Release asset contains it.

Help/discovery do not run plugin code. Installation is a different phase: before consent the host
reads static metadata; after consent the default handshake may import and initialize plugin code.
Read the [installation trust rules](authoring-providers.md#4-publish-and-install-from-git).

## One provider implementation, shared discovery

The common host owns configuration isolation, installation/consent, bounded JSON schema validation,
engine authentication, errors and the generic command dispatcher. Providers own cloud API mapping,
credentials, resource identifiers, readiness conditions and pagination. CLI presentation and Python
async/type wrappers may differ; they must not contain independent backend implementations.

Express is a bundled provider under the CLI's `src/providers/alicloud_express/`, not a plugin copied
into `awesome-providers`. Catalog adapters stay in `awesome-providers`. The existing
`provider-commands/1` descriptors are discovered by both the generic CLI and Python engine client.
Adding a declared provider command needs no consumer dispatch table or generated top-level command.
Stable typed methods remain explicit APIs; registration does not dynamically add Python methods or
promise that every backend implements every operation. Standard E2B compatibility clients retain
their separate protocol contract.

Express now registers the following additional commands once:

| ID | Effect | Input |
| --- | --- | --- |
| `sandbox.pause` | write | `sandbox_id`, optional `request_timeout` |
| `sandbox.resume` | write | `sandbox_id`, optional lifetime `timeout` |
| `snapshot.create` | write | `sandbox_id`, optional `name`, `request_timeout` |
| `snapshot.list` | read | optional `sandbox_id`, `name`, `limit`, `next_token` |
| `snapshot.restore` | write | `snapshot_id`, optional lifetime `timeout`, string `metadata` |
| `snapshot.delete` | delete | `snapshot_id` |

All six use the selected **sandbox API key**, origin and region. They do not require control-plane
AK/SK. Existing Team/Volume/API-key/Quota operations still use AK/SK. Inspect the schema for the
complete bounded input contract. Readiness is distinct from implementation: pause/resume and
Snapshots require their account allowlists, and Snapshots require generation2. HTTP403/409 does
not mean an undeclared capability. Native ProviderSandbox feature flags retain their own scope;
these registered commands do not silently change the legacy native pause/resume protocol.

```sh
abx --json provider command list alicloud-express
abx --json provider command info alicloud-express snapshot.create
abx --json provider command run alicloud-express sandbox.pause \
  --input '{"sandbox_id":"<sandbox-id>"}' --yes
abx --json provider command run alicloud-express sandbox.resume \
  --input '{"sandbox_id":"<sandbox-id>","timeout":600}' --yes
abx --json provider command run alicloud-express snapshot.create \
  --input '{"sandbox_id":"<sandbox-id>","name":"checkpoint","request_timeout":300}' --yes
abx --json provider command run alicloud-express snapshot.list \
  --input '{"sandbox_id":"<sandbox-id>","limit":100}'
abx --json provider command run alicloud-express snapshot.restore \
  --input '{"snapshot_id":"<returned-snapshot-uuid>","timeout":300}' --yes
abx --json provider command run alicloud-express snapshot.delete \
  --input '{"snapshot_id":"<returned-snapshot-uuid>"}' --yes
```

Python calls the same registered implementation through the actual local engine:

```python
import asyncio
from agent_sandbox.providers import commands

async def main():
    catalog = await commands.list_commands("alicloud-express")
    print([entry["id"] for entry in catalog])
    # Configure ABX_SANDBOX_API_KEY, ABX_SANDBOX_BASE_URL and ABX_SANDBOX_DOMAIN locally.
    result = await commands.run_command(
        "alicloud-express", "snapshot.create",
        {"sandbox_id": "<sandbox-id>", "request_timeout": 300}, confirm=True,
    )
    print(result["snapshot_id"])

asyncio.run(main())
```

Use an `abx` build containing these descriptors (`ABX_BIN` can select it); the original v0.4.0
release predates this registration. Upgrading only Python cannot add a command missing in an older
engine. Discovery does not inspect cloud credentials or call the vendor. It shows registered
implementation, not a live account capability probe.

Snapshot creation defaults to a300-second request timeout, independent of sandbox lifetime. The
provider's outer deadline is360 seconds; mutations are never automatically retried. After an
uncertain timeout, list by the exclusively owned source sandbox before repeating a creation.
Immediate Snapshot creation after resume returned HTTP503 during acceptance; wait for running
state and service admission to settle before the first creation. The final test used a30-second
quiet interval, which is an acceptance observation, not a service readiness SLA.
`next_token` is the service's opaque pagination cursor. Restore creates a new sandbox; it does not
resume or replace the source. Supply unique `metadata` when a restored sandbox must be reconciled
after an uncertain result. Kill owned clones first and delete Snapshots independently; killing a
source does not remove its Snapshots.

Express deletion uses the service's shared template endpoint. This registered extension accepts
**returned Snapshot UUIDs only**, rejecting template names/aliases before network I/O. Session
access tokens and extra backend fields are excluded from results. It does not support the
filesystem-only pause mode (`keep_memory=False`).

The manual acceptance controller in the Python repository exercises both consumers against one
real provider with memory/file continuity, clone isolation and owned-resource cleanup. No
cloud/model acceptance is added to Actions. Official constraints:
[pause/resume](https://help.aliyun.com/zh/agent-sandbox/pause-and-resume),
[Snapshot](https://help.aliyun.com/zh/agent-sandbox/snapshot-invited-test).

Run the cross-consumer local acceptance controller from the [Python owner](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/e2e/README.md#shared-provider-conditional-acceptance-local-only) using this CLI's standalone build. Save the binary outside directories cleaned by other builds.

## Express Template Cache

The bundled Provider also implements `template-cache.create`, `template-cache.get`,
`template-cache.list` and `template-cache.delete` through the official2026-08-20
Sandbox management API. These commands use the selected AK/SK and region, with the endpoint
fixed to `sandbox.<region>.aliyuncs.com`; a sandbox API key cannot replace AK/SK.
Help and JSON discovery stay local and require neither credentials nor SDK initialization.
Check that the installed CLI contains these descriptors before using them.

Every operation requires an explicit `team_id`. Create/get/delete also require the exact
`template_id`; no template or Team is chosen automatically. Save this non-secret reference
to `cache-ref.json`:

```json
{"team_id":"REPLACE_ME_TEAM_ID","template_id":"REPLACE_ME_TEMPLATE_ID"}
```

```sh
abx --json provider command info alicloud-express template-cache.create
abx --json provider command run alicloud-express template-cache.create --input-file ./cache-ref.json --yes
abx --json provider command run alicloud-express template-cache.get --input-file ./cache-ref.json
abx --json provider command run alicloud-express template-cache.list --input-file ./cache-ref.json
abx --json provider command run alicloud-express template-cache.delete --input-file ./cache-ref.json --yes
```

Create submits one request and returns the observed cache metadata in `data`. Acceptance
observed `status: "creating"`, `progress: 0` followed by `status: "ready"`, `progress: 100`
and `image_size_mb: 584`. A successful create is not readiness: query get with a bounded
deadline until the actual status is ready, stopping on a failed/error/evicted state. Missing
status, progress or timestamps remain absent. `http_timeout` bounds each SDK request;
there is no implicit polling or retry. After a timeout or conflict, inspect that exact
Team/template before repeating a write.

List returns one page as `data.template_caches`, `data.max_results` and `data.next_token`.
Optional inputs are `template_id`, `status`, `max_results` (1–100) and `next_token`.
Pass the opaque token unchanged to the next request; a null token marks the final page.
Delete returns `data.deleted: false` for an already absent cache. It retains the template;
independently query get and list to verify deletion before claiming cleanup.

Compare actual ready-to-business sandbox timings before and after caching using the same
template, region and resource specification. Record the sample count and variability.
Absent explicit cache metadata does not establish a globally cold image. Image size is
cache footprint, not a monetary saving; calculate costs only from verified rates and billing
data. These four operations provide no WarmPool configuration or billing API.

For owned-resource real acceptance, select a task-owned ready template and run:

```sh
export ABX_SKILL_CACHE_TEAM_ID=REPLACE_ME_TEAM_ID
export ABX_SKILL_CACHE_TEMPLATE_ID=REPLACE_ME_TEMPLATE_ID
node e2e/skill-template-cache-acceptance.mjs --output ./cache-acceptance-new.json
```

The scenario refuses a pre-existing cache, observes actual creating→ready progress, tests
all four CLI operations and verifies deletion using an independent official SDK Get404 and
inventory query. It deletes its cache and retains the caller's template.
