# Configure an Express sandbox at runtime

Express runtime operations use the selected Sandbox API key and regional API URL. They are separate from Team, Key and Volume metadata management, which uses Alibaba Cloud credentials. If you use an already prepared AK/SK-managed Sandbox Key, runtime operations reuse it; creating or renewing that credential still requires its own confirmation.

Use a CLI build whose `abx provider command list alicloud-express` includes `sandbox.mounts.append`, `sandbox.network.update` and `sandbox.timeout`. The presence of an operation does not enable an account allowlist or supply storage clients, roles or network resources.

## Create with network settings

The explicit native path accepts a network JSON file. Standard create retains its terminal and lifecycle behavior:

```sh
abx --native create --template TEMPLATE --network-file ./network.json
```

The file uses the same snake_case fields as the runtime network operation, plus two creation-only fields:

```json
{
  "allow_public_traffic": false,
  "allow_internet_access": false,
  "allow_out": ["api.example.com"],
  "deny_out": ["0.0.0.0/0"],
  "rules": {
    "api.example.com": [{"transform": {"headers": {"X-Application": "sandbox"}}}]
  }
}
```

`allow_public_traffic` controls anonymous access to public application URLs. `allow_internet_access`, `allow_out` and `deny_out` control outbound access. Native create uses secure envd access; a private public gateway requires it. `mask_request_host` is also accepted at creation. `egress_proxy` is not supported. Rules containing credentials should be kept in a protected local file and supplied through `--network-file` or `--input-file`.

For VPC or create-time direct storage configuration, use the existing native `--metadata KEY=VALUE` input with the official reserved metadata fields. ACR image-pull network settings are a different configuration. See the official [network guide](https://help.aliyun.com/zh/agent-sandbox/network-access-control) and [storage guide](https://help.aliyun.com/zh/agent-sandbox/persistence-storage/).

## Call an application behind a private gateway

The gateway traffic token, envd session token and application authentication token have different purposes. The CLI never prints or saves the gateway token by default. To reuse it across CLI invocations, explicitly request a new private output file:

```sh
abx --native create --template TEMPLATE --network-file ./network.json --traffic-token-output ./traffic-token
abx run alicloud-express:SANDBOX_ID COMMAND --traffic-token-file ./traffic-token --json-args '{"value":1}'
abx sandbox command list alicloud-express:SANDBOX_ID --traffic-token-file ./traffic-token
```

The output file is created exclusively with mode 0600; an existing file is never replaced. Input must be a private regular file. The token is sent as `e2b-traffic-access-token`, separately from application authentication. Application commands still require a running template service. Attaching with a supplied traffic token does not implicitly resume the sandbox or extend its lifetime.

GET info/list responses do not recover a lost gateway token. Use an explicitly mutating standard SDK connect/resume flow or a previously retained token when recovery is needed. The native CLI resume acknowledgement does not export a token. Do not substitute the Sandbox API key, envd token or ABX_SERVER_TOKEN for this gateway credential. Remove the explicitly exported file when it is no longer needed.

## Replace outbound network policy

Save the complete desired replacement under `network` in an input file:

```json
{
  "sandbox_id": "SANDBOX_ID",
  "network": {
    "allow_internet_access": false,
    "allow_out": ["api.example.com"],
    "deny_out": ["0.0.0.0/0"]
  }
}
```

```sh
abx provider command run alicloud-express sandbox.network.update --input-file ./network-update.json --yes
```

This replaces the egress configuration; it does not merge with existing rules. An explicit `"network": {}` clears existing rules. Creation-only `allow_public_traffic` and `mask_request_host` cannot be updated. Transformation rules remain under `network.rules`; reserve precise domains and follow the platform CA requirements for HTTPS credential injection. The result acknowledges the update without returning credential-bearing rules. Verify actual application responses rather than TCP connection establishment alone.

## Append storage mounts

Append mounts to a running sandbox using existing same-Team Volume names, direct storage configuration, or both:

```json
{
  "sandbox_id": "SANDBOX_ID",
  "named_volume_mounts": [{"name":"workspace","path":"/mnt/workspace"}],
  "request_timeout": 120
}
```

```sh
abx provider command run alicloud-express sandbox.mounts.append --input-file ./mounts.json --yes
abx --json provider command info alicloud-express sandbox.mounts.append
```

Direct configuration is supplied under `inline_volume_mounts`. Every storage group has a `mount_points` array; use these point fields:

| Group | Mount point fields | Group settings |
| --- | --- | --- |
| `oss` | `bucket_name`, `endpoint`, `mount_dir`; optional `bucket_path`, `read_only` | None |
| `agentic_fs` | `server_addr`, `mount_dir` | Optional `user_id`, `group_id` |
| `agentic_bucket` | `agentic_bucket`, `bucket_name`, `endpoint`, `mount_dir`; optional `bucket_path`, `read_only` | None |
| `juice_fs` | `volume_name`, `mount_dir`, `token`; optional `remote_dir`, `args` | Optional `envs`, including `BASE_URL` when the sandbox has no JuiceFS service address |

The local mount directories must be distinct normalized absolute Unix paths outside system and hidden directories. Submitted directories cannot overlap. Each inline storage group accepts at most five points; the service also counts existing mounts. JuiceFS `args` cannot override the platform-managed `--token` or `--subdir` options.

Appending retains existing mounts and the sandbox's current role/VPC settings. The required storage clients, access policy, roles and network must already be ready. It does not unmount, replace or provision underlying storage. A successful acknowledgement is not proof of data access: independently read an expected file, or write/read/delete an owned test file. The official [append mount guide](https://help.aliyun.com/zh/agent-sandbox/append-mount-volume) describes service prerequisites and limits.

## Pause, resume and update lifetime

```sh
abx pause alicloud-express:SANDBOX_ID
abx resume alicloud-express:SANDBOX_ID
abx sandbox timeout alicloud-express:SANDBOX_ID 600
```

Qualified references retain their Provider ownership; a conflicting explicit Provider fails before a backend call. Pause/resume remain subject to service admission. Timeout is the lifetime in seconds, not a request timeout, and changing it does not connect or resume the instance. The corresponding provider operation is `sandbox.timeout` with `sandbox_id`, `timeout` and optional `request_timeout`.

Runtime mutations are not automatically replayed. A request timeout can leave the remote outcome unknown. Inspect the sandbox and independently verify mounts/network before deliberately repeating an operation. Release owned sandboxes with `abx kill ID`; underlying storage data and explicitly exported traffic-token files require their own cleanup.
