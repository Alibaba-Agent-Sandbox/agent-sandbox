# 阿里云 provider 管理命令

状态：设计提案；实现与真实云端验收分别记录。

## 范围与产品对应

`alicloud-express` 对应函数计算 FC 极速版；`alicloud-container` 对应
ACS/ACK OpenKruise 容器版。provider 自己的命令目录描述其管理接口，全局沙箱
命令保持已有契约。本设计使用项目已锁定的 `@alicloud/fcsandbox20260509` 1.5.1
及官方生成请求模型。管理接口使用 AK/SK；独立的创建沙箱挂载选项使用 Volume
所属 Team 的沙箱 API Key。

## 发现与调用契约

加载凭据前即可列出命令描述。每个命令声明稳定 ID、中英文说明、严格的输入和输出
JSON Schema、作用类型 `read` / `write` / `delete` 与幂等性。命令位于 provider
命名空间，插件不能覆盖全局命令。宿主先检查输入和修改确认，FC 适配器再检查业务
约束，随后才构造 SDK 客户端。

输入使用 snake_case，SDK 使用官方 camelCase 字段。未知字段、空标识符、无效分页、
互斥存储配置均在 SDK 加载和网络请求前失败。执行只调用明确映射的 SDK 方法，
不接受任意方法名或路径。列表返回单页及分页信息，由调用者决定是否继续读取。
关闭 SDK 自动重试，尤其不自动重放创建和 API Key 轮换。幂等声明不代表自动重试授权。

删除 API Key 前必须先停用。显式调用 `api-key.update` 并设置
`"status": "inactive"`，再调用 `api-key.delete`。真实云端对仍 active 的密钥
返回 `InvalidApiKeyStatus`（HTTP 400）；适配器将其映射为 E8002 配置错误并提示
上述步骤，不在删除命令背后自动停用密钥或附加其他修改。生命周期测试只停用、删除
自己创建的临时密钥；清理时先读状态，active 才停用，inactive 或已经不存在均可清理，
未知状态则明确失败，不猜测转换。

## 能力矩阵

| 命令 ID | 官方 SDK 接口 | 边界 |
| --- | --- | --- |
| `volume.create/get/list/update/delete` | CreateVolume、GetVolume、ListVolumes、UpdateVolume、DeleteVolume | 已实现适配；仍需账号、地域开通 |
| `team.create/get/list/update/delete` | CreateTeam、GetTeam、ListTeams、UpdateTeam、DeleteTeam | 已实现适配 |
| `api-key.create/get/list/update/reset/delete` | CreateApiKey、DescribeApiKey、ListApiKeys、UpdateApiKey、ResetApiKey、DeleteApiKey | 已实现适配；所有返回密钥值均脱敏 |
| `quota.get/list/update/delete` | DescribeQuota、ListQuota、UpdateQuota、DeleteQuota | 已实现适配；可能需要邀测白名单 |
| 模板管理 | 现有 template 命令 | 继续使用现有入口 |
| `domain.*` | 已核实的两套 SDK 均没有客户端方法 | 不注册；使用官方控制台流程 |
| JuiceFS 配置 | 已锁 SDK 1.5.1 没有该字段 | 不接受；需独立完成 SDK 迁移 |

创建 Volume 必须且只能选择 `oss_volume_config`、`agentic_fs_volume_config`、
`agentic_bucket_volume_config` 之一，可附带 `mount_config`。创建、删除 Volume
只操作挂载配置，不创建、删除底层存储。更新只映射公开的 `status` 与 Team 标识，
不提供任意存储重配置。将 Volume 挂入沙箱是独立运行时操作，创建成功不代表挂载成功。
官方 OSS Volume 指南目前要求提交阿里云工单申请邀测。准备存储前，应确认目标账号、
地域和 Team 已开通 Volume 能力；成功返回空列表不能证明已有创建或挂载权限。

先发现命令并查询准确 Schema，再准备输入文件：

```bash
abx provider command list alicloud-express
abx provider command info alicloud-express volume.create
abx provider command run alicloud-express volume.create --input-file volume.json --yes
```

`volume.json` 示例（Bucket 必须已存在）：

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

角色必须已经存在，并授权访问目标存储。创建 Volume 元数据不会自动建立这些权限。
创建沙箱时按 Volume **名称**挂载：

```bash
abx create --template base --volume-mount /mnt/workspace=workspace
```

`Sandbox.create({volume_mounts: {"/mnt/workspace": "workspace"}})` 使用相同的路径到名称
映射，FC 请求序列化为 `volumeMounts: [{name: "workspace", path: "/mnt/workspace"}]`。
未指定时保持原有请求体；路径和名称在建立传输前校验，不支持该映射的 provider 在执行
插件前拒绝请求。这是创建时选项，不表示已实现动态 `storage.mount` 协议。
CLI 重复指定相同挂载路径会报错，不静默覆盖。

沙箱 API Key 必须属于 Volume 的 Team。也可通过沙箱 metadata 的
`fc.sandbox.auth.role` 指定角色，其优先于 Volume 的 `mount_config.role`；空值会禁用
此授权。挂载验收仍需真实存储，并独立确认挂载成立；请求正确序列化不证明存储访问成功。

API Key 创建、轮换额外必填 `secret_file`，例如
`"secret_file": "/absolute/private/new-api-key"`。必须使用本机引擎宿主上的绝对路径，
避免引擎与 SDK 调用者工作目录不同。先创建私有目录，选取尚不存在的文件名；
生成文件保存新密钥，不能提交到版本库。查询、列表、更新不会导出密钥值。

## 凭据、结果与错误

每次执行读取同一个已解析 `LayeredConfig` 快照中的 `access_key_id`、
`access_key_secret`、`region` 与 `http_timeout`。AK/SK 必须同时存在，禁止用沙箱
API Key 代替。SDK 负责 AK 签名并使用 FCSandbox 地域端点。请求输入不能覆盖凭据、
端点；关闭 SDK 自动重试。
当前已解析配置没有 STS session token 字段，因此不宣称支持缺少 token 的临时凭据。

统一结果为 `{request_id, data}`。资源只投影公开的 snake_case 字段，列表包含分页
元数据，丢弃未知响应字段。包括创建、重置和查询在内，`api_key_value` 一律替换为
`[REDACTED]`。创建与轮换必须提供 `secret_file`，请求云端之前以 `wx` 和 0600
权限独占创建新文件，拒绝覆盖现有文件与符号链接。云端返回的新密钥只写入该文件并
刷盘，结构化结果返回绝对路径；文件路径不发送至云端。云端失败时仅清理本次创建、
仍为空且 inode 一致的文件。若远端已创建或轮换但本地写入失败，明确提示远端已变更、
需要恢复，不输出密钥或自动重试。已写入部分内容的文件保留为 0600 便于恢复。
不接受命令行密钥值输入；将来的证书、私钥输入也必须来自文件。

SDK 错误保留经过清理的云服务错误码、数字 HTTP 状态和请求 ID，不直接输出可能含
密钥的 SDK message、请求体或原始 response。认证、资源不存在、配额错误映射到已有
错误类别。HTTP 成功但业务错误的响应也必须失败，不能包装成空资源成功。

## 域名边界

官方文档将极速版自定义域名称为云扩展，并提供控制台、DNS、证书配置流程。
FCSandbox SDK 1.5.1 虽然含域名模型，但没有客户端方法；进一步实际审计官方
`@alicloud/sandbox20260820` 1.2.0 的 client 源码，同样没有域名方法。模型存在
不证明接口可调用。FC、AgentRun 的域名接口属于其他产品，缺少其支持 Agent Sandbox
域名的公开依据时，不能复用它们的路由。因此不注册 `domain.*`，明确记录上游阻塞。

容器版上游 `/volumes` 路由明确停用；CSI 挂载通过现有 PV 和领取时 metadata。
其域名通过 Kubernetes Ingress/TLS 部署管理，均不等同于 FC Volume 或域名 CRUD。

## 验收

单测验证所有 SDK 映射、三类存储、请求前严格校验、凭据隔离、单页分页、零配额、
响应字段投影、密钥脱敏、错误清理和关闭重试。使用真实生成模型与假客户端，
不将其称为真实云验证。宿主测试覆盖发现、provider 分发、修改确认、文件 JSON
输入及输出 Schema 校验。

真实云验收先验证正确账号、地域下的只读列表和详情，再在具备权限与开通能力的账号
创建、修改、删除本次测试专属资源。API Key 轮换只针对可丢弃测试密钥。Volume 还需
在实际沙箱挂载后验证读写。只清理本次资源。缺少凭据、白名单或权限均明确记录阻塞。

## 一手依据

- [官方 SDK client 源码](https://github.com/aliyun/alibabacloud-typescript-sdk/blob/master/fcsandbox-20260509/src/client.ts)，本次审计已安装的 1.5.1。
- [官方新版 SDK](https://www.npmjs.com/package/@alicloud/sandbox20260820)，本次审计 1.2.0。
- [持久化存储概念](https://help.aliyun.com/zh/agent-sandbox/persistence-storage/)。
- [OSS Volume、认证与权限](https://help.aliyun.com/zh/agent-sandbox/user-guide/create-oss-volume)。
- [挂载 OSS Volume](https://help.aliyun.com/zh/agent-sandbox/mount-oss-volume-1)。
- [RAM 角色与创建时角色优先级](https://help.aliyun.com/zh/agent-sandbox/create-ram-role)。
- [AgenticBucket 字段与 VPC 限制](https://help.aliyun.com/zh/agent-sandbox/create-agenticbucket-volume)。
- [Team 配额](https://help.aliyun.com/zh/agent-sandbox/team-quota-management)。
- [极速版自定义域名](https://help.aliyun.com/zh/agent-sandbox/custom-domain-name)。
- [容器版路由源码](https://github.com/openkruise/agents/blob/7dc85e9491d8ca6203abd24b0a24b9612ea9d00b/pkg/servers/e2b/routes.go)。
- [容器版 CSI 挂载](https://openkruise.io/kruiseagents/user-manuals/ondemand-volume-mount)。

## Provider 实现一次，两端共同发现

公共宿主负责配置隔离、安装/授权、受限 JSON Schema 校验、引擎认证、错误和通用调度。
Provider 负责厂商 API 映射、认证、资源标识、服务准入、分页。CLI 展示和 Python 异步/类型
封装可以不同，不能在各端分别维护一套云端实现。

极速版是 CLI `src/providers/alicloud_express/` 中随包发布的内置 Provider；其他可安装
Provider 的源码属于 `awesome-providers`。现有 `provider-commands/1` 声明由通用 CLI 与
Python 引擎客户端共同发现。新增已声明操作不要求给各端再加调度表或顶层命令。
稳定的类型化方法仍是显式 API，不会因为注册了名字就动态生成 Python 方法，也不保证
每个后端都支持全部能力。标准 E2B 兼容客户端继续保留自己的协议契约。

极速版新增的注册命令如下：

| ID | 影响 | 输入 |
| --- | --- | --- |
| `sandbox.pause` | 写入 | `sandbox_id`，可选 `request_timeout` |
| `sandbox.resume` | 写入 | `sandbox_id`，可选生命周期 `timeout` |
| `snapshot.create` | 写入 | `sandbox_id`，可选 `name`、`request_timeout` |
| `snapshot.list` | 只读 | 可选 `sandbox_id`、`name`、`limit`、`next_token` |
| `snapshot.restore` | 写入 | `snapshot_id`，可选生命周期 `timeout`、字符串 `metadata` |
| `snapshot.delete` | 删除 | `snapshot_id` |

六个操作只使用所选极速版的 **sandbox API Key**、地址与地域，不要求控制面 AK/SK。
已有 Team/Volume/API-key/Quota 操作仍使用 AK/SK。完整输入限制见命令 Schema。
已实现与账号可用分开判断：暂停恢复和快照各需白名单，快照还要求二代运行时。
HTTP403/409 不能归为 Provider 未声明能力。原生 ProviderSandbox 特性标志保持独立范围；
注册命令不会暗中改变旧原生暂停/恢复协议。

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

Python 通过真实本地引擎调用同一份注册实现：

```python
import asyncio
from agent_sandbox.providers import commands

async def main():
    catalog = await commands.list_commands("alicloud-express")
    print([entry["id"] for entry in catalog])
    # 本地配置 ABX_SANDBOX_API_KEY、ABX_SANDBOX_BASE_URL、ABX_SANDBOX_DOMAIN。
    result = await commands.run_command(
        "alicloud-express", "snapshot.create",
        {"sandbox_id": "<sandbox-id>", "request_timeout": 300}, confirm=True,
    )
    print(result["snapshot_id"])

asyncio.run(main())
```

须使用含有上述声明的 `abx` 构建，可以用 `ABX_BIN` 指定；原始 v0.4.0 发布物尚未包含这次
注册。单独升级 Python 不能让旧引擎凭空增加命令。发现操作不访问云端或检查云凭据，
列出的是已注册实现，不是实时账号能力探测。

创建快照默认请求超时300秒，与沙箱生命周期不同；Provider 外层截止时间360秒。
不自动重试写入。结果不确定时，先按本轮独占源沙箱查询，再决定是否重复创建。
`next_token` 原样传递服务分页游标。恢复会创建新沙箱，不恢复或替换源沙箱；需要在
异常后盘点时，为新沙箱传入唯一 `metadata`。先清理克隆沙箱，再独立删除快照，源沙箱
终止不会自动删除快照。

极速版删除快照使用与模板共用的服务接口。本注册扩展只接受**返回的快照 UUID**，在
发请求前拒绝普通模板名称和别名。结果不包含会话访问 token 或未声明的后端字段。
不提供仅保留文件系统的 `keep_memory=False` 暂停模式。

Python 仓库的手动验收控制器通过两端访问同一个真实 Provider，验证内存/文件连续性、
克隆隔离及自有资源清理；不新增云端/模型 Actions 验收。官方限制：
[暂停恢复](https://help.aliyun.com/zh/agent-sandbox/pause-and-resume)、
[快照](https://help.aliyun.com/zh/agent-sandbox/snapshot-invited-test)。

跨端本地验收使用 [Python 仓库的控制器](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/e2e/README.zh-CN.md)，传入本仓库构建的独立二进制；产物不要放在其他构建会清理的目录。

真实验收中，恢复后立即创建快照曾返回 HTTP503；先确认运行状态并等待服务准入稳定，再首次创建。最终验收使用30秒静置间隔，该值是验收观察，不是服务就绪 SLA。失败写入不自动重试。
