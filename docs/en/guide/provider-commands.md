# Provider-owned capabilities and shared commands

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
