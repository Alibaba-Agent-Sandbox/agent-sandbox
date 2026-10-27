# Express features and permissions

This guide applies to `alicloud-express`. Grant permissions to the RAM identity owning the AK/SK that signs management requests. Supplying credentials does not grant permissions. Other providers have independent authorization.

## Choose a credential path

| Task | Credentials and permissions |
|---|---|
| Standard sandbox create/connect/list/kill, commands, files and interpreter | Existing sandbox API key, endpoint/domain and a suitable template. No caller AK/SK is needed. Key policy, Team, expiry, IP rules and runtime support still apply |
| First managed-key preparation from AK/SK | `sandbox:CreateApiKey` on the target Team's `apikeys/*`; continuing to runtime also needs the Describe action below; explicit confirmation or `--ci` |
| Reuse a managed key | `sandbox:DescribeApiKey` on the same Team's `apikeys/*`; no credential creation |
| Continue when the managed key has less than one day left | Confirm `sandbox:UpdateApiKey` on the same Team's `apikeys/*`; extend the existing key without resetting its secret |
| Help, config initialization/display and provider command discovery | No cloud permissions and no key creation. Complete configuration does not certify live permissions |

Key management is Team-scoped: `acs:sandbox:<region>:<account-id>:teams/<team-id>/apikeys/*`. The last segment must remain `*`, even for operations addressing one key ID. Account ID means the owning Alibaba account UID, not a RAM user ID. When using the API's default Team, substitute its actual Team ID in the policy. An administrator must prepare a Team if none exists; the tool does not create one automatically.

## Minimum AK/SK policy

Replace the placeholders and grant this custom policy to the RAM user owning the AccessKey. It covers preparation, lookup and renewal, without template access, Team modification or key reset/deletion:

```json
{
  "Version": "1",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["sandbox:CreateApiKey", "sandbox:DescribeApiKey", "sandbox:UpdateApiKey"],
    "Resource": "acs:sandbox:<region>:<account-id>:teams/<team-id>/apikeys/*"
  }]
}
```

Administrator steps: RAM console → Permissions → Policies → Create custom policy → Script editor → replace placeholders → Identities → Users → select the AccessKey owner → Add permissions → select this policy. Follow your organization's role workflow where applicable. Do not attach this caller policy to the sandbox's storage execution role by mistake.

Remove `UpdateApiKey` for an identity that must never renew keys; use will then fail when renewal is needed. Applications using an existing API key do not need this policy or an AccessKey. Listing or deleting managed resources requires additional actions below.

```bash
abx config set access_key_id      # masked input
abx config set access_key_secret  # masked input
abx config set region cn-hangzhou
abx config set team_id <TEAM_ID>  # optional; otherwise the API's default Team
abx sandbox list                 # asks for confirmation if preparation is needed
abx --ci sandbox list --format json  # explicit automation consent
abx provider command run alicloud-express api-key.prepare --yes  # explicit preparation
```

A pipe, `CI=true`, JSON output or another operation's `--yes` is not implicit credential-creation consent. SDKs, MCP and the local engine never display interactive prompts or silently create a key. Prepare explicitly using the CLI above or Python `prepare_api_key(confirm=True)`. `api-key.resolve` is read-only; `api-key.prepare` is a confirmed write. `--ci` does not auto-confirm arbitrary writes from other providers.

## Add permissions for the features you use

These actions apply to native management APIs. Do not require native Sandbox RAM actions for ordinary E2B-compatible API-key applications.

| Feature / command | RAM actions | Resource scope |
|---|---|---|
| `team.list`; native template flow without an explicit Team | `sandbox:ListTeams` | `acs:sandbox:<region>:<account-id>:teams/*`, not one Team ARN |
| `team.get/create/update/delete` | `sandbox:GetTeam`, `sandbox:CreateTeam`, `sandbox:UpdateTeam`, `sandbox:DeleteTeam`, respectively | Get/update/delete: `acs:sandbox:<region>:<account-id>:teams/<team-id>`; create: `acs:sandbox:<region>:<account-id>:teams/*`; resource-group changes check source/destination groups |
| `--native template list`, `template info` | `sandbox:ListTemplates`, `sandbox:GetTemplate` | Target Team's `templates/*` or specific Template; automatic Team lookup additionally needs `ListTeams` |
| `template from-image`, platform-step build, registration/status polling in `template deploy` | `sandbox:CreateTemplate`, `sandbox:GetTemplate`; `sandbox:ListTeams` when Team is not explicit | Target Team's `templates/*`; lookup may use a specific Template |
| Native template update/delete | `sandbox:UpdateTemplate`, `sandbox:DeleteTemplate` | Target Template ARN; registration does not grant deletion |
| `api-key.list/get` | `sandbox:ListApiKeys`, `sandbox:DescribeApiKey` | Target Team's `apikeys/*` |
| `api-key.create/update` | `sandbox:CreateApiKey`, `sandbox:UpdateApiKey` | Same; policy-field updates additionally require `CreateApiKey` |
| `api-key.reset/delete` | `sandbox:ResetApiKey`, `sandbox:DeleteApiKey` | Same; disabling before deletion additionally needs `UpdateApiKey` |
| `template-cache.create/get/list/delete` | `sandbox:CreateTemplateCache`, `sandbox:DescribeTemplateCache`, `sandbox:ListTemplateCache`, `sandbox:DeleteTemplateCache` | `acs:sandbox:<region>:<account-id>:teams/<team-id>/template-caches/<template-id>`; list uses `template-caches/*` |
| `volume.create/get/list/update/delete` | `sandbox:CreateVolume`, `sandbox:GetVolume`, `sandbox:ListVolumes`, `sandbox:UpdateVolume`, `sandbox:DeleteVolume` | Create/list use `teams/<team-id>/volumes/*`; addressed operations use a specific Volume. Prefix each with `acs:sandbox:<region>:<account-id>:` |
| `quota.get/list/update/delete` | `sandbox:DescribeQuota`, `sandbox:ListQuotas`, `sandbox:UpdateQuota`, `sandbox:DeleteQuota` | Get/update/delete: `acs:sandbox:<region>:<account-id>:teams/<team-id>/quotas/*`; account list: `acs:sandbox:<region>:<account-id>:teams/*/quotas/*` |
| Local Docker build | No cloud RAM action; working Docker is required | Local machine |
| ACR image push | Target repository push permission; enterprise temporary login also needs `cr:GetAuthorizationToken` | See below; not granted by `sandbox:*` |
| OSS or other storage mounts | Volume management and storage access are separate | Sandbox execution role; see below |

For read-only templates, add a Statement granting `sandbox:ListTemplates` and `sandbox:GetTemplate` on `acs:sandbox:<region>:<account-id>:teams/<team-id>/templates/*`. Specify a Team where the command supports it if you do not have automatic Team-list permission. Do not grant all-resource modification simply to list one Team's resources.

## ACR and storage authorization

Enterprise ACR temporary login uses `cr:GetAuthorizationToken`; repository pull/push uses `cr:PullRepository`/`cr:PushRepository`. Have an administrator prepare missing repositories/namespaces using the setup permissions below. Personal and enterprise editions use different APIs/resource ARNs: scope the policy using the target instance's official authorization reference. New personal-edition instances use their fixed registry password; possessing an AccessKey does not guarantee temporary registry login. Platform-step builds do not push through local Docker/ACR and must not require local ACR push permission.

A caller's `CreateVolume` does not authorize sandbox access to stored data. The execution role must trust `fc.aliyuncs.com` for `sts:AssumeRole` and grant only the necessary storage access: for example `oss:ListObjects` and `oss:GetObject` for read-only OSS, adding `oss:PutObject`, `oss:DeleteObject` and multipart actions only as needed. Configure Bucket-level and Object-level resource scopes separately. Key policy and product admission conditions still apply.

## Managed-key lifecycle and recovery

After confirmation, the Express provider calls official `Sandbox / 2026-08-20` `CreateApiKey` with an explicit 30-day expiry. This is a tool policy, not a claimed STS token lifetime. Cache files live under `~/.abx/credentials/alicloud-express/`, with directory 0700 and files 0600 (Windows uses its local permission model). Normal configuration display never prints their secrets. AccessKey ID, region and Team selector isolate caches; CLI/SDK/MCP sharing one user directory reuse them.

Resolution checks cloud status. With less than a day remaining, renewal requires confirmation and extends the same key to 30 days from now. Checks happen on use, without a background timer. Disabled/deleted keys, identity mismatch and denied permissions fail explicitly without reset or replacement. Long-lived applications should explicitly prepare and reconnect before expiry; already constructed clients are not promised background renewal.

A lost create/renew response leaves a `pending` journal and blocks automatic write replay. Inspect the named key in the correct region/Team. If creation succeeded but its secret was lost, an administrator must disable/delete that exact tool key, move aside its exact local record, then confirm preparation again. If no key was created, move aside that exact pending record after verification. Never reset another application's key or upload credential files to tickets. Cleanup needs `sandbox:UpdateApiKey` and `sandbox:DeleteApiKey`; ordinary preparation does not need Delete permission.

For permission failures check the signing identity, Action, owning account UID, region, Team and policy conditions. Cloud RAM and the key's own access policy both affect the result; granting one cannot bypass the other.

## Official references

- [Sandbox actions and resource scope](https://help.aliyun.com/zh/agent-sandbox/authorize-ram-users-to-access-the-console)
- [API-key management and plaintext-return rules](https://help.aliyun.com/zh/agent-sandbox/api-key-management)
- [Native SDK/API](https://help.aliyun.com/zh/agent-sandbox/alibaba-cloud-sdk-api-description-1)
- [Personal ACR login/push](https://help.aliyun.com/zh/acr/user-guide/use-a-container-registry-personal-edition-instance-to-push-and-pull-images)
- [Enterprise ACR temporary login](https://help.aliyun.com/zh/acr/developer-reference/api-cr-2018-12-01-getauthorizationtoken)
- [Storage execution role](https://help.aliyun.com/zh/agent-sandbox/create-ram-role)

If a crashed process leaves a `.lock`, verify that its owner has exited and reconcile pending/cloud state as above before removing that exact lock file. The tool never removes stale locks automatically, avoiding duplicate creation during concurrent recovery.
