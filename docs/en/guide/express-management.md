# Manage Express resources

Express resource commands manage Team, API Key, Volume, quota, template and template-cache resources. They use Alibaba Cloud AccessKey credentials or an STS credential triple. Sandbox execution, files and terminals use the separate Sandbox API Key.

Set the AccessKey ID and Secret using `abx config init --build`, or provide the existing `ALICLOUD_ACCESS_KEY_ID` and `ALICLOUD_ACCESS_KEY_SECRET` environment variables. Obtain them from the RAM identity authorized to manage the target resources. When using temporary credentials issued by STS, also set `ALIBABA_CLOUD_SECURITY_TOKEN` from the same credential triple. The token is secret and expires with those credentials; the CLI does not acquire or refresh STS credentials.

Discover operations and their JSON schemas locally:

```sh
abx provider command list alicloud-express
abx provider command info alicloud-express volume.update
abx provider command run alicloud-express volume.list --input '{"max_results":20}'
```

Use `--region` to select the resource region. Lists return one page and its continuation token; pass `next_token` unchanged to fetch another page. Team and API Key lists use `page_number` and `page_size` instead. Write and delete operations require `--yes`. Use `--input-file` for configuration containing passwords or tokens.

## Templates

Native `template.create/get/list/update/delete` operations accept structured configuration. Standard `abx template create` retains its template-build meaning. Native template creation submits a new name and refuses conflicts; an existing template is changed only by the explicit update operation.

Create a JSON input file with the target Team, image and runtime settings:

```json
{
  "team_id": "REPLACE_ME",
  "name": "project-runtime-v1",
  "runtime_config": {
    "cpu": 2,
    "memory_size": 2048,
    "disk_size": 15360,
    "sandbox_config": {
      "image": "REPLACE_ME",
      "generation": 2,
      "os_type": "linux-amd64"
    }
  },
  "build_config": {
    "install_storage_clients": true
  }
}
```

The image must be accessible to the selected account and region. A second-generation template and a supported image are required for installing storage clients. Installation prepares the image; it does not create storage, attach a mount or configure its permissions.

```sh
abx provider command run alicloud-express template.create --input-file template.json --yes
abx provider command run alicloud-express template.get --input-file template-reference.json
```

The reference file contains `team_id` and the returned `template_id`. Creation is submission, not readiness: query the template state until ready before creating a sandbox. Keep failed build details and the request ID when requesting support.

`runtime_config` also accepts `log_config` for an existing SLS project/logstore and `vpc_config` for the sandbox's network and role. `sandbox_config.registry_config.network_config` selects the network for pulling a registry image; it is separate from the sandbox's runtime VPC. Registry authentication and certificate settings belong under `registry_config`. Discover the exact nested fields with `provider command info`.

Update only the fields to change. Omitting `sandbox_config.steps` preserves existing steps; supplying `steps: []` clears them. For example:

```json
{
  "team_id": "REPLACE_ME",
  "template_id": "REPLACE_ME",
  "runtime_config": {
    "sandbox_config": {
      "steps": [{"type": "RUN", "args": ["python3 -m pip install cowsay"]}]
    }
  }
}
```

Run this file with `template.update --input-file update.json --yes`. Choose a new versioned template name when existing consumers must retain their environment. Deleting a template is a separate operation from deleting its sandboxes or snapshots.

## Volumes and quotas

`volume.create` accepts exactly one of `oss_volume_config`, `agentic_fs_volume_config`, `agentic_bucket_volume_config` or `juice_fs_volume_config`, together with a Team and Volume name. It saves a mount configuration for existing storage; it does not provision or copy the underlying data. JuiceFS tokens are supplied in the input file and redacted in returned metadata.

`volume.update` accepts one storage configuration and/or `mount_config`, plus `team_id` and `volume_id`. For example, update an existing Volume's RAM role using:

```json
{
  "team_id": "REPLACE_ME",
  "volume_id": "REPLACE_ME",
  "mount_config": {"role": "REPLACE_ME"}
}
```

The deprecated status-only input remains available for existing scripts through the legacy API. It cannot be combined with storage or mount changes. New configuration updates use the current Sandbox API and do not fall back to the legacy API on failure. `volume.list` supports `storage_class` filtering. Deleting a Volume removes its mount metadata and preserves its storage data.

Quota updates require `team_id`, `cpu_cores` and `memory_gb`. Optional `instance_count` controls the live-instance quota: omit it to preserve that quota, use `-1` to clear it, `0` to prohibit instances, or a positive integer to set the limit. Query existing quota values before changing CPU or memory limits.

## API Keys and cleanup

API Key creation and reset require a new absolute `secret_file` path on the machine running the CLI engine. The file is created exclusively with private permissions; command output does not disclose the key. Source-IP policy accepts IPv4 addresses/CIDRs. Nonempty allow and deny lists are mutually exclusive; empty lists can clear existing restrictions. Rule descriptions are limited to 128 characters.

Expiry accepts an RFC3339 timestamp or an explicitly empty `expire_time` string, which is sent unchanged to the native API. Omitting this field on update preserves the existing expiry. Confirm the resulting metadata after requesting a non-expiring key.

Managed Key creation or renewal requires its own confirmation. Reusing an existing managed Key does not authorize an unconfirmed replacement. STS credentials do not remove these requirements.

Delete only resources created for the task. Template-cache deletion preserves its template; Volume deletion preserves underlying storage. Sandbox termination and storage-file cleanup are separate actions.

See [provider commands](provider-commands.md), [authentication](authentication.md), and the [official native API reference](https://api.aliyun.com/document/Sandbox/2026-08-20/overview) for resource permissions and service conditions.
