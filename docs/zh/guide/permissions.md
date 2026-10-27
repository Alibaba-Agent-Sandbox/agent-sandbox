# 极速版功能与权限

本文适用于 `alicloud-express`。权限授予实际签名 OpenAPI 请求的 AK/SK 所属 RAM 身份；配置凭证本身不会授予权限。其他 Provider 使用各自的权限体系。

## 先选择使用方式

| 使用场景 | 凭证和权限 |
|---|---|
| 用已有 Key 创建、连接、列出、释放沙箱，执行命令、文件读写、代码解释器和标准 CLI | 已有沙箱 API Key、正确端点/域名和可用模板即可；不需要额外提供 AK/SK。仍受 Key 的 Team、策略、有效期、IP 规则及运行时限制 |
| 仅有 AK/SK，首次准备工具专用 Key | `sandbox:CreateApiKey`，作用于目标 Team 的 `apikeys/*`；必须确认，或显式使用 `--ci` |
| 后续复用已管理 Key | `sandbox:DescribeApiKey`，同一 Team 的 `apikeys/*`；只读检查，不重复创建 |
| 已管理 Key 的有效期不足一天，继续使用 | 确认后执行 `sandbox:UpdateApiKey`，同一 Team 的 `apikeys/*`；延长同一把 Key，不重置明文 |
| `config init`、帮助、配置查看、Provider 命令发现 | 无需云权限，不会创建 Key。引导完成只说明配置已填写，不代表权限已通过验证 |

API Key 是 Team 级资源。Key 管理的授权范围为 `acs:sandbox:<region>:<account-id>:teams/<team-id>/apikeys/*`；不能把最后一段写成某个 Key ID。`<account-id>` 是资源所属阿里云账号 UID，不是 RAM 用户 ID。使用默认 Team 时也需要把策略中的 `<team-id>` 替换为该默认 Team 的实际 ID。没有默认 Team 时先由管理员准备 Team，工具不会自动创建。

## AK/SK 方式的最小策略

替换三个占位符，将下列自定义策略授予 AK/SK 所属 RAM 用户。它覆盖首次创建、后续读取和到期续期，不授予模板、Team 修改或 Key 重置/删除权限：

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

管理员操作步骤：RAM 控制台 → 权限管理 → 权限策略 → 创建自定义策略 → 脚本编辑并替换占位符 → 身份管理 → 用户 → 找到 AK/SK 所属用户 → 新增授权 → 选择该策略。组织内已有角色授权流程时使用对应身份，不要把策略误加到沙箱内执行角色。

只允许首次创建、后续不允许续期的身份可以去掉 `UpdateApiKey`，但临近到期时续期会被拒绝。只希望使用已有 API Key 的应用不需要本节策略，也不必保存 AK/SK。若想自行查询或删除工具创建的 Key，再按下表补充对应权限。

```bash
abx config set access_key_id      # 隐藏输入
abx config set access_key_secret  # 隐藏输入
abx config set region cn-hangzhou
abx config set team_id <TEAM_ID>  # 可选；省略使用接口定义的默认 Team
abx sandbox list                 # 无有效管理 Key 时，在终端请求确认
# CI 中明确授权本次凭据准备；仍受上述 RAM 权限约束：
abx --ci sandbox list --format json
# 单独准备，--yes 是对这次显式写操作的确认：
abx provider command run alicloud-express api-key.prepare --yes
```

普通管道、`CI=true`、JSON 输出和其他操作的 `--yes` 不等于允许隐式创建凭据。SDK、MCP 和本机引擎不会弹确认框，也不会因为持有 AK/SK 就静默创建；先通过上述 CLI 显式准备，或使用 Python 的 `prepare_api_key(confirm=True)`。`api-key.resolve` 只读解析；`api-key.prepare` 是需要确认的写操作。`--ci` 不会自动确认其他 Provider 的任意写操作。

## 其他功能按需增加权限

以下均是原生管理操作的权限；标准 E2B 兼容操作使用 API Key，不应把原生 Sandbox RAM Action 强加给普通 SDK 应用。

| 功能／命令 | 所需 RAM Action | 资源范围 |
|---|---|---|
| `team.list`；原生模板流程未显式指定 Team 时的自动查询 | `sandbox:ListTeams` | `acs:sandbox:<region>:<account-id>:teams/*`，不是单个 Team ARN |
| `team.get` / `team.create` / `team.update` / `team.delete` | 分别为 `sandbox:GetTeam` / `CreateTeam` / `UpdateTeam` / `DeleteTeam`（每项都带 `sandbox:` 前缀） | 指定 Team；创建使用账号内 Team 范围；变更资源组另检查源/目标组 |
| `--native template list` / `template info` | 分别为 `sandbox:ListTemplates` / `sandbox:GetTemplate` | 目标 Team 的 `templates/*` 或具体 Template；没有指定 Team 时另需 `ListTeams` |
| `template from-image`、平台步骤构建、`template deploy` 的注册和状态等待 | `sandbox:CreateTemplate`、`sandbox:GetTemplate`；未指定 Team 时另需 `sandbox:ListTeams` | 目标 Team 的 `templates/*`；查询可限具体 Template |
| 原生模板更新／删除 | `sandbox:UpdateTemplate` / `sandbox:DeleteTemplate` | 对应 Template ARN；构建/注册权限不包含删除权限 |
| `api-key.list` / `api-key.get` | `sandbox:ListApiKeys` / `sandbox:DescribeApiKey` | 目标 Team 的 `apikeys/*` |
| `api-key.create` / `api-key.update` | `sandbox:CreateApiKey` / `sandbox:UpdateApiKey` | 同上；更新策略字段时官方还要求 `CreateApiKey` |
| `api-key.reset` / `api-key.delete` | `sandbox:ResetApiKey` / `sandbox:DeleteApiKey` | 同上；删除前需停用，停用另需 `UpdateApiKey` |
| `template-cache.create/get/list/delete` | 分别为 `sandbox:CreateTemplateCache` / `sandbox:DescribeTemplateCache` / `sandbox:ListTemplateCache` / `sandbox:DeleteTemplateCache` | `acs:sandbox:<region>:<account-id>:teams/<team-id>/template-caches/<template-id>`；列表使用 `template-caches/*` |
| `volume.create/get/list/update/delete` | 分别为 `sandbox:CreateVolume` / `sandbox:GetVolume` / `sandbox:ListVolumes` / `sandbox:UpdateVolume` / `sandbox:DeleteVolume` | 创建/列表用 `teams/<team-id>/volumes/*`，按 ID 操作用具体 Volume；均加 `acs:sandbox:<region>:<account-id>:` 前缀 |
| `quota.get/list/update/delete` | 分别为 `sandbox:DescribeQuota` / `sandbox:ListQuotas` / `sandbox:UpdateQuota` / `sandbox:DeleteQuota` | Team 的 `quotas/*`；主账号列表需账号级对应范围 |
| 本地 Docker 构建 | 无云 RAM Action；本机需要可用 Docker | 无 |
| Docker 镜像推送 ACR | 目标仓库的推送权限；企业版临时登录还需 `cr:GetAuthorizationToken` | 见下一节；不包含在 `sandbox:*` 内 |
| 沙箱挂载 OSS 等存储 | Volume 管理与底层存储访问分开授权 | 由沙箱执行角色访问存储；见下一节 |

以 Template 只读为例，在管理 Key 策略外增加一个 Statement，Action 为 `sandbox:ListTemplates`、`sandbox:GetTemplate`，Resource 为 `acs:sandbox:<region>:<account-id>:teams/<team-id>/templates/*`。如果没有 Team 自动查询权限，就在命令支持的位置显式指定 Team，不要为了列出一个 Team 的资源授予所有资源修改权限。

## ACR 和存储是独立授权

ACR 企业版临时登录用 `cr:GetAuthorizationToken`；仓库拉取/推送对应 `cr:PullRepository`、`cr:PushRepository`。仓库、命名空间不存在时，自动创建所需的管理 Action（例如企业版 `cr:CreateRepository`、`cr:CreateRepoNamespace`）还需单独授权。个人版和企业版资源 ARN/接口不同，应按目标实例的官方授权说明限定仓库；不要复制一个版本的策略到另一个版本。新版个人版应使用其固定登录密码，不能把“有 AK/SK”理解为一定能取得临时仓库凭证。平台步骤构建不经过本机 Docker/ACR 推送，不应因此要求 ACR 推送权限。

存储挂载时，AK/SK 调用者的 `CreateVolume` 不等于沙箱具备读取数据的权限。执行角色需信任 `fc.aliyuncs.com` 执行 `sts:AssumeRole`，再授予目标 Bucket/前缀所需权限，例如只读 OSS 的 `oss:ListObjects`、`oss:GetObject`；写入/删除按任务需要增加 `oss:PutObject`、`oss:DeleteObject` 等。Bucket 级与 Object 级资源要分别配置。挂载仍受 API Key 策略和产品开通条件约束。

## 管理 Key 的生命周期和恢复

经确认后，极速版 Provider 使用官方 `Sandbox / 2026-08-20` 的 `CreateApiKey`，请求明确的 30 天到期时间；这是一项工具策略，不是 STS 令牌有效期。缓存位于 `~/.abx/credentials/alicloud-express/`，目录 0700、文件 0600（Windows 遵循本机权限模型），普通配置查看不展示明文。缓存按 AccessKey ID、地域、Team 选择隔离，使用同一用户目录的 CLI/SDK/MCP 共享。

每次解析读取云端状态，剩余有效期不足一天时要求续期确认；同意后延长同一把 Key 至当前时间后 30 天。只在使用时检查，无后台定时续期。禁用、删除、身份不匹配或权限不足时明确失败，不重置、不自动新建绕过限制。业务长时间不重建客户端时，应在 Key 过期前显式准备并重新连接；工具不保证已存在客户端会后台续期。

创建或续期响应丢失会保留 `pending` 记录，后续拒绝自动重复写入。按提示的名称，在对应地域/Team 的控制台核实资源。创建已成功但明文丢失时，管理员先停用并删除那把工具 Key，再移走该精确缓存记录，重新确认准备；不要重置其他应用的 Key。确定云端没有创建时，移走该精确 pending 记录后重新确认。清理需要 `sandbox:UpdateApiKey` 和 `sandbox:DeleteApiKey`，日常准备不需要 Delete 权限。不要把缓存文件上传工单。

遇到权限不足，核对：实际 AK/SK 身份 → Action → 账号 UID → 地域 → Team → 策略条件。Cloud RAM 授权和 Key 自身的访问策略都会影响最终结果；补充一种权限不会绕过另一种限制。

## 官方依据

- [Sandbox RAM Action 与资源范围](https://help.aliyun.com/zh/agent-sandbox/authorize-ram-users-to-access-the-console)
- [API Key 管理、Team 归属及明文返回规则](https://help.aliyun.com/zh/agent-sandbox/api-key-management)
- [原生 SDK 与 API](https://help.aliyun.com/zh/agent-sandbox/alibaba-cloud-sdk-api-description-1)
- [ACR 个人版登录与推送](https://help.aliyun.com/zh/acr/user-guide/use-a-container-registry-personal-edition-instance-to-push-and-pull-images)
- [ACR 企业版临时登录凭证](https://help.aliyun.com/zh/acr/developer-reference/api-cr-2018-12-01-getauthorizationtoken)
- [存储执行角色](https://help.aliyun.com/zh/agent-sandbox/create-ram-role)

进程异常退出留下 `.lock` 时，先确认原进程已退出并按上述步骤核实 pending/云端结果，再删除该精确锁文件。工具不会自动移除旧锁，以免并发恢复造成重复创建。
