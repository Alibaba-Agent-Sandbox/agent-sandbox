# Alibaba Cloud provider management commands

Status: proposed; implementation and cloud verification are tracked separately.

## Scope and product identity

`alicloud-express` is the FC-backed Express Edition. `alicloud-container` is the
ACS/ACK OpenKruise edition. A provider's command catalog describes its own
management API; the global sandbox commands retain their existing contracts.
This design implements FC management operations using the repository's locked
`@alicloud/fcsandbox20260509` 1.5.1 SDK and its generated request models.
Management uses AK/SK credentials. The separate sandbox-create mount option uses
the sandbox API key of the Team that owns the Volume.

## Discovery and invocation

The host lists descriptors before loading credentials. Each descriptor contains a
stable ID, English and Chinese descriptions, strict input and output JSON schemas,
an effect (`read`, `write`, `delete`), and an idempotency declaration. Commands stay
under the provider command namespace; plugins cannot replace global commands.
The host applies input validation and mutation confirmation before execution.
The FC adapter repeats semantic validation before constructing a client.

Inputs use snake_case; generated SDK request models use their documented camelCase
names. Unknown properties, empty identifiers, invalid pagination and incompatible
storage configurations fail before SDK loading or network access. Execution calls
one explicitly selected SDK method; there is no arbitrary method/path passthrough.
List operations return a single page and its pagination metadata. Callers decide
whether to fetch another page. Mutation retries are disabled, including create and
API-key rotation. An idempotent descriptor is not permission to retry automatically.

API-key deletion requires an inactive key. Change the selected key explicitly with
`api-key.update` and `"status": "inactive"`, then call `api-key.delete`.
The observed cloud rejection for an active key is `InvalidApiKeyStatus` (HTTP 400),
mapped to configuration error E8002 with these next steps. The adapter does not
silently disable a key or add another mutation behind a delete command. Lifecycle
tests disable only their own disposable key before deleting it; cleanup reads its
status, disables an active test-created key, accepts inactive or already missing
keys, and refuses to guess a transition for an unknown status.

## Capability matrix

| Command IDs | Public SDK methods | Result |
| --- | --- | --- |
| `volume.create`, `volume.get`, `volume.list`, `volume.update`, `volume.delete` | CreateVolume, GetVolume, ListVolumes, UpdateVolume, DeleteVolume | Implemented adapter; account/region access still required |
| `team.create`, `team.get`, `team.list`, `team.update`, `team.delete` | CreateTeam, GetTeam, ListTeams, UpdateTeam, DeleteTeam | Implemented adapter |
| `api-key.create`, `api-key.get`, `api-key.list`, `api-key.update`, `api-key.reset`, `api-key.delete` | CreateApiKey, DescribeApiKey, ListApiKeys, UpdateApiKey, ResetApiKey, DeleteApiKey | Implemented adapter; returned key values always redacted |
| `quota.get`, `quota.list`, `quota.update`, `quota.delete` | DescribeQuota, ListQuota, UpdateQuota, DeleteQuota | Implemented adapter; quota service may require allowlisting |
| Template operations | Existing template commands | Retained in the existing template surface |
| `domain.*` | No methods in either audited sandbox SDK | Not registered; use the documented console workflow |
| JuiceFS configuration | Absent from locked SDK 1.5.1 | Not accepted; SDK migration requires its own compatibility work |

Volume creation accepts exactly one of `oss_volume_config`,
`agentic_fs_volume_config`, and `agentic_bucket_volume_config`, plus optional
`mount_config`. Creating/deleting Volume metadata does not create/delete the
underlying storage. Updating a Volume uses only the published `status` field and
Team identifier; it is not an arbitrary storage reconfiguration operation.
Mounting an existing Volume into a sandbox is a separate runtime operation and is
not implied by successful Volume creation. The official OSS Volume guide currently
requires invitation access through an Alibaba Cloud support ticket. Confirm that
the target account, region and Team have Volume access before preparing storage;
a successful empty list does not establish permission to create or mount a Volume.

Discover and inspect the exact schemas before preparing an input file:

```bash
abx provider command list alicloud-express
abx provider command info alicloud-express volume.create
abx provider command run alicloud-express volume.create --input-file volume.json --yes
```

Example `volume.json` (the underlying Bucket must already exist):

```json
{
  "team_id": "TEAM-ID",
  "volume_name": "workspace",
  "oss_volume_config": {
    "bucket_name": "example-bucket",
    "bucket_path": "/workspace",
    "endpoint": "https://oss-cn-hangzhou.aliyuncs.com",
    "read_only": false
  },
  "mount_config": {
    "role": "acs:ram::ACCOUNT-ID:role/EXISTING-STORAGE-ROLE"
  }
}
```

The role must already exist and grant access to the intended storage. Creating
Volume metadata alone does not establish those permissions. Mount the existing
Volume by **name** when creating a sandbox:

```bash
abx create --template base --volume-mount /mnt/workspace=workspace
```

`Sandbox.create({volume_mounts: {"/mnt/workspace": "workspace"}})` uses the same
path-to-name map. The FC request encodes `volumeMounts: [{name: "workspace", path:
"/mnt/workspace"}]`; omission keeps the previous payload. Paths and names are
validated before transport creation; a provider without this mapping is rejected
before plugin execution. This create-time extension does not claim a dynamic
`storage.mount` protocol. Repeated CLI mount paths are rejected rather than replaced.

The sandbox API key must belong to the Volume's Team. The role may instead be
supplied through sandbox metadata `fc.sandbox.auth.role`; it takes precedence over
the Volume's `mount_config.role`, and an empty role disables this authorization.
Mount acceptance still requires real storage and an independently verified mount;
successful request serialization is not evidence of successful storage access.

API-key create/reset input additionally requires `secret_file`, for example
`"secret_file": "/absolute/private/new-api-key"`; this must be an absolute path on
the local engine host (which can have a different working directory from the SDK caller). Create the private directory first and
choose a filename that does not exist. The secret file contains the new key and
must not be added to source control. Get/list/update never export secret values.

## Credentials, results and failures

Execution uses one resolved `LayeredConfig` snapshot: `access_key_id`,
`access_key_secret`, `region`, and `http_timeout`. Both AccessKey fields are
required; the sandbox API key is never substituted. The generated SDK signs AK
requests and uses its FCSandbox regional endpoint. No request can supply an
arbitrary endpoint or credentials. SDK automatic retries are disabled.
STS session tokens are not represented by the current resolved configuration;
this adapter does not claim support for temporary credentials without that token.

The public result is `{request_id, data}`. Resources are projected to documented
snake_case fields, with list pagination included in `data`. Unrecognized response
fields are dropped. `api_key_value` is replaced with `[REDACTED]` even for create,
reset and detail responses. Create and reset require `secret_file`: before the
cloud request, the adapter exclusively creates a new file with `wx` and mode
0600, refusing existing files and symlinks. The newly returned key is written
and flushed to that file; the structured result includes its absolute path.
The file path is never sent to the cloud. A cloud failure removes only this
invocation's still-empty reservation, checking its inode before removal. A
local write failure after remote creation/rotation reports that the remote key
has changed and requires recovery, without printing its value or retrying.
Partially written files are retained with mode 0600 for recovery. No secret
values are accepted on the command line. Future certificate/key input must
likewise come from files.

SDK failures preserve a sanitized service error code, numeric HTTP status and
request ID, while omitting raw messages, request bodies and SDK response objects
which can include credentials. Authentication, not-found and quota failures map
to the existing provider error families. Application-level error envelopes also
fail instead of being reported as successful empty resources.

## Domain boundary

The official product documents custom domains as an Express cloud extension and
describe console binding, DNS and certificate configuration. The audited
FCSandbox SDK 1.5.1 contains domain model classes but exposes no client methods.
The newer official `@alicloud/sandbox20260820` 1.2.0 package also exposes no domain
client methods. Models alone do not prove a callable API. FC and AgentRun domain
APIs are separate products; their routes must not be reused without public proof
that they manage Agent Sandbox domains. Consequently `domain.*` remains absent,
with this concrete upstream blocker documented instead of guessed endpoints.

For the container edition, upstream `/volumes` routes are explicitly disabled;
CSI mounting uses an existing PV and claim-time metadata. Its domain management
is a Kubernetes Ingress/TLS deployment task. Neither is FC Volume/domain CRUD.

## Verification and acceptance

Unit tests exercise every SDK mapping, all three supported storage shapes, strict
validation before I/O, isolated credentials, single-page pagination, zero-valued
quotas, response projection, key redaction, sanitized failures and disabled
retries. Tests inject a fake client while retaining real generated model classes;
they do not establish cloud compatibility. Host tests cover discovery, selected
provider dispatch, confirmation, JSON file input and output-schema validation.

Cloud acceptance requires read-only list/get against the correct account and
region, followed by isolated create/update/delete of test-owned resources when
the account has the required access. API-key rotation must use a disposable key.
Volume acceptance also requires independently verifying an actual sandbox mount.
Clean up only resources created by that run. Missing credentials, allowlisting or
permissions remain explicit blocked gates; no mocked run is called cloud E2E.

## Primary sources

- [Official SDK client source](https://github.com/aliyun/alibabacloud-typescript-sdk/blob/master/fcsandbox-20260509/src/client.ts), audited installed release 1.5.1.
- [Official newer SDK package](https://www.npmjs.com/package/@alicloud/sandbox20260820), audited release 1.2.0.
- [Volume concepts and storage lifecycle](https://help.aliyun.com/zh/agent-sandbox/persistence-storage/).
- [OSS Volume creation, authentication and permissions](https://help.aliyun.com/zh/agent-sandbox/user-guide/create-oss-volume).
- [Mounting an OSS Volume](https://help.aliyun.com/zh/agent-sandbox/mount-oss-volume-1).
- [RAM role and create-time role precedence](https://help.aliyun.com/zh/agent-sandbox/create-ram-role).
- [AgenticBucket fields and VPC restrictions](https://help.aliyun.com/zh/agent-sandbox/create-agenticbucket-volume).
- [Team quota contract](https://help.aliyun.com/zh/agent-sandbox/team-quota-management).
- [Express custom domains](https://help.aliyun.com/zh/agent-sandbox/custom-domain-name).
- [Container routing source](https://github.com/openkruise/agents/blob/7dc85e9491d8ca6203abd24b0a24b9612ea9d00b/pkg/servers/e2b/routes.go).
- [Container CSI mounting](https://openkruise.io/kruiseagents/user-manuals/ondemand-volume-mount).

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
