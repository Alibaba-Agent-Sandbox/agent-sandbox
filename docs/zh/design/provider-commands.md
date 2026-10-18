# Provider 管理命令

状态：proposed。实现和验证状态以本仓库 ADR 为准。

## 三类命令

CLI 的通用命令组和快捷命令由 `src/cli/command_surface.ts` 固定注册。Provider 通过
18 个标准 feature token 接入通用沙箱协议；token 本身不是可以调用的云资源管理命令。
`abx sandbox command` 调用沙箱内服务注册的应用命令。Provider 管理命令以
`(provider ID, command ID)` 唯一标识，不能覆盖通用命令或应用命令。

## 静态声明和发现

Manifest version 1 增加独立版本的可选章节：

```toml
[commands]
protocol = "provider-commands/1"

[[commands.entries]]
id = "volume.list"
description = "List this provider's volumes."
description_zh = "列出此提供方的存储卷。"
effect = "read"
idempotent = true
input_schema = { type = "object", properties = {}, additionalProperties = false }
output_schema = { type = "object" }
```

最多 128 项；ID 满足 `^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$`，最长 80 字符。
每个描述不超过 64 KiB、嵌套不超过 16 层。双语说明、输入与输出 schema、
`effect`（`read`、`write`、`delete`）和布尔类型 `idempotent` 均为必填。
输入 schema 顶层必须是 object，并设 `additionalProperties: false`。

采用 JSON Schema draft 7，禁用引用、异步验证、自定义关键字、format、正则关键字和
schema ID；拒绝原型相关键。限制大小和深度，不进行任何 schema 网络加载。
发现操作只读元数据，不导入插件，不要求凭证，不连接沙箱或云端；非 link 安装先校验完整性。
Node 和 exec 可以声明命令；REST 声明式插件不能承载任意 handler。
内置 provider 使用相同描述和校验契约。安装确认展示命令，更新比较完整描述；增加命令或
修改 schema、effect 需要重新同意。旧 receipt 中缺失 commands 等价于空数组。

## 统一调用

`src/providers/commands.ts` 提供 `listProviderCommands`、`getProviderCommand` 和
`runProviderCommand`。未知命令返回 E8004；无效输入返回 E8002，并在加载插件或连接后端前
拒绝。校验不做类型转换、默认值填充或属性删除。输入最多 1 MiB、32 层；返回值最多
8 MiB、32 层，并由输出 schema 校验。

Node 插件的 `buildInfra(ctx)` 可返回 `provider_commands: {run(command, input, signal)}`。
exec 插件只通过 `provider.commands.run` 接收 `{command, input}`。宿主只允许已声明的 ID，
不提供任意 RPC、URL、shell、模块或 SDK 方法透传。缺失 handler 仍返回 E8004。

每次调用按明确指定的 provider 解析独立配置；插件只接收声明的字段和已同意继承的配置。
凭证从 provider 配置读取，不作为命令业务参数。错误和结果对已知凭证脱敏；新生成的密钥还须
由适配器安全处理。所有退出路径释放资源，调用有超时上限。超时只表示等待结束，远端写入
结果可能未知；中止和清理不证明云端操作已取消。管理命令一律不自动重放，包括幂等命令。

Provider handler 是在宿主上执行的受信任代码。Schema、作用声明和确认保护调用契约，
不会隔离插件代码，也不能证明 handler 实际执行了哪些云操作。安装信任和云端 IAM/RAM
权限仍是授权边界，不能将元数据描述为对恶意 handler 的权限限制。

## CLI、引擎和 SDK

```text
abx provider command list PROVIDER
abx provider command info PROVIDER COMMAND
abx provider command run PROVIDER COMMAND --input '{"team_id":"..."}'
abx provider command run PROVIDER COMMAND --input-file request.json --yes
```

`--input` 与 `--input-file` 互斥，省略为 `{}`；沿用 JSON、quiet、退出码和配置约定。
读操作不要求确认；写入、删除必须显式 `--yes`。JSON 错误不回显原文；证书类输入应从文件
读取，避免进入进程参数。全局 provider 选择不得静默覆盖位置参数中的 provider。

引擎在既有认证的 loopback 接口增加固定路由：

| 方法 | 路由 | 结果 |
| --- | --- | --- |
| GET | `/v1/providers/:provider/commands` | `{commands: descriptor[]}` |
| GET | `/v1/providers/:provider/commands/:command` | descriptor |
| POST | `/v1/providers/:provider/commands/:command` | 命令结果 |

POST body 为 `{input: object, confirm: boolean}`，非读操作要求 `confirm: true`。
路径与 connection 的 provider 必须一致，否则 E8030。沿用 Bearer、loopback、Host、Origin
检查；管理凭证和结果不进入沙箱 session 缓存。Python SDK 只做引擎调用封装，POST 禁止
重试。原有内置沙箱接口仍可不依赖 Node；新增管理接口明确要求 Node 引擎。

MCP 管理工具暂未实现。现有沙箱 MCP 工具不自动获得账号管理权限；后续接入须显式启用，
配置 provider/command 白名单并分别控制读写权限，再复用相同调用接口。

## 能力交付和多智能体审查

只实现有公开依据的云操作，使用官方 SDK 的真实模型。区分已支持、仅控制台、依赖后端和
未验证能力；存在模型类不等于存在可调用 API。阿里云范围见
[阿里云管理命令设计](alicloud-provider-commands.md)。

独立智能体先分别审计注册机制、官方后端接口、跨语言契约；协调者先确定共享契约，各实现者
再在互不重叠的文件和 worktree 中实施。交叉审查命名、凭证隔离、I/O 前校验、写操作重放、
资源清理及能力声明真实性。协调者负责集成、检查实际测试和远程合并状态；智能体结论和
mock 均不能替代真实云端证据。

验证运行还须隔离 socket、临时目录及云资源所有权；不同工具命名空间中的进程 ID 可能
重复。使用固定端口的套件顺序执行，只有运行资源互不重叠的独立套件才能并行。

验收覆盖旧 manifest、非法和重复声明、安装授权差异、静态发现、Node/exec 调度、输入拒绝、
CLI/Engine/Python 一致性、脱敏、错误返回、超时清理、官方 SDK 映射。云验证只操作本次创建
的资源并清理。缺少条件如实标为 BLOCKED，必需门禁通过前 ADR 保持 proposed。
