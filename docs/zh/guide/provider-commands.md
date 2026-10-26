# Provider 能力注册与共享命令

## 通过帮助发现操作

Provider 安装一次后，声明的操作自动可见，不需要用户再执行“注册”。交互使用可以设置
默认 Provider，脚本可以显式选择：

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

这些上下文帮助和 `run` 入口需要包含本次变更的构建，原始 v0.4.0 发布物尚未包含。
顶层帮助显示所选 Provider 和操作摘要；`provider --help`、`provider run --help` 显示
完整操作目录和完整调用路径；具体操作帮助显示说明、输入字段、JSON Schema、影响和
确认要求。`-h` 与 `--help` 等价。帮助只读取本地声明，不要求凭据、不执行插件、不访问
云端。所选 Provider 无效时，帮助显示诊断并保留修复命令；真正执行时严格报错，不会
悄悄切换后端。

选择顺序与执行共用同一规则：`--provider ID`、`ABX_PROVIDER`、项目 `.env`、用户 `.env`、
已保存配置、内置默认值。像上例一样，把全局选项放在 `provider` 命令组之前。
`provider default ID` 保存偏好，环境变量仍可覆盖该值。

操作 ID 是一个完整参数，包括其中的点：`snapshot.create` 不转换成 `snapshot create`。
操作固定放在 `provider run` 下，名为 `list`、`install` 或 `default` 的操作不能覆盖宿主
管理命令。输入继续使用有大小限制的 `--input` 或 `--input-file` JSON，不把任意 Schema
字段变成 CLI 参数。写入和删除操作要求 `--yes`。敏感输入使用权限受限的本地 JSON
文件，并通过 `--input-file` 传入。

原有显式 ID 和机器可读接口继续兼容：

```sh
abx --json provider command list alicloud-express
abx --json provider command info alicloud-express snapshot.create
abx --json provider command run alicloud-express snapshot.create \
  --input-file ./snapshot-input.json --yes
```

AI 和自动化应使用这些 JSON 接口。面向人的帮助不是稳定 JSON 响应契约。
Provider 管理操作、沙箱应用命令（`abx sandbox command`）与模板准备
（`abx template launch`）是不同职责。注册和查看帮助不会创建模板或云资源。
本次变更不会自动生成 MCP 工具、Shell 补全或 SDK 类型化方法。

## 职责与更新

Provider 自己拥有操作 ID、说明、Schema、影响声明和处理器。Node 插件在
`abx-provider.toml` 声明，并实现 `buildInfra(ctx).provider_commands.run`；exec 插件通过
EPP 处理 `provider.commands.run`。REST 预设不支持非空操作目录。宿主从同一份目录
生成帮助和 JSON 发现结果，并使用同一个执行器调度。示例见
[编写 Provider](authoring-providers.md#provider-管理操作)。

已安装插件通过 `abx provider update ID --ref <40-hex-commit>` 更新，沿用现有固定提交
与授权规则。下一次调用自动看到新增声明，无需重新注册或生成帮助。内置极速版随宿主
CLI 发布升级，不作为独立插件安装更新。应检查实际安装构建；`main` 已合并不代表
npm 包或 Release 附件已经包含变更。

帮助和发现不执行插件代码。安装属于另一个阶段：同意前读取静态元数据，同意后默认
握手可能导入和初始化插件代码。详见[安装信任规则](authoring-providers.md#4-发布并从-git-安装)。

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

## 极速版 Template Cache

内置 Provider 通过官方2026-08-20 Sandbox 管理 API 实现
`template-cache.create`、`template-cache.get`、`template-cache.list` 和
`template-cache.delete`。这些操作使用所选 AK/SK 与地域，地址固定为
`sandbox.<region>.aliyuncs.com`；沙箱 API Key 不能代替 AK/SK。
帮助和 JSON 发现只读取本地声明，不要求凭据，不初始化云 SDK。
使用前确认实际安装的 CLI 构建已经包含这些声明。

所有操作都必须明确传入 `team_id`，创建、查询详情和删除还必须提供准确的
`template_id`，不会自动选择 Team 或模板。把以下非密钥引用保存为 `cache-ref.json`：

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

创建只提交一次请求，在 `data` 中返回实际缓存元数据。真实验收观察到
`status: "creating"`、`progress: 0`，之后才变为 `status: "ready"`、
`progress: 100`，镜像大小 `image_size_mb: 584`。创建请求成功不代表缓存可用；
应在有截止时间的轮询中查询详情，直到实际状态为 ready，遇到 failed/error/evicted
则停止。缺少的状态、进度和时间不会补默认值。`http_timeout` 限制每个 SDK 请求，
操作不会自动轮询或重试；超时或冲突后，先核对同一 Team 和模板再决定是否重新写入。

列表每次返回一页：`data.template_caches`、`data.max_results`、
`data.next_token`。可选输入为 `template_id`、`status`、`max_results`（1–100）和
`next_token`，续页令牌应原样传回，null 表示最后一页。
删除已不存在的缓存返回 `data.deleted: false`，不会删除模板。
报告清理成功前应独立查询详情和列表核对。

比较缓存前后的实际沙箱就绪并能执行任务的耗时，保持模板、地域和规格一致，记录样本数
和波动。没有显式缓存元数据不等于全局冷镜像。镜像大小是缓存占用，不是节省金额；
费用估算需要已核实的计费标准和账单数据。这四个操作不提供 WarmPool 配置或账单 API。

选择本轮创建且已经 Ready 的模板运行真实资源验收：

```sh
export ABX_SKILL_CACHE_TEAM_ID=REPLACE_ME_TEAM_ID
export ABX_SKILL_CACHE_TEMPLATE_ID=REPLACE_ME_TEMPLATE_ID
node e2e/skill-template-cache-acceptance.mjs --output ./cache-acceptance-new.json
```

场景在缓存已存在时停止，观察真实 creating→ready 进度，测试四个 CLI 操作，并通过独立
官方 SDK 查询404和列表确认删除。它会删除本轮缓存，保留调用方提供的模板。
