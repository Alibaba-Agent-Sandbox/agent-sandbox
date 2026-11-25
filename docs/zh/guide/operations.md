# 操作速查

公共命令使用同一个解析入口，`--provider` 选择后端，`--json` 控制机器输出。

| 任务 | 命令 |
| --- | --- |
| 部署源码/目录模板 | `abx deploy SOURCE --name APP` |
| 从原生模板创建 | `abx create --template TEMPLATE --name APP` |
| 查看/状态/日志 | `abx list`、`abx status APP`、`abx logs APP` |
| 删除/恢复 | `abx delete APP --yes`、`abx recover APP` |
| 执行进程 | `abx exec APP -- COMMAND` |
| 交互终端 | `abx connect APP` |
| 注册函数 | `abx sandbox APP --help`、`abx sandbox APP NAME --body @request.json` |
| 文件和进程工具 | `abx files --help`、`abx process --help` |
| 目录与源码 | `abx template list`、`abx template info NAME`、`abx template init` |
| 构建/源码发布 | `abx template build SOURCE --yes`、`abx template publish SOURCE --tag VERSION --yes` |
| Provider 原生操作 | `abx provider command list PROVIDER`、`abx provider run OPERATION --input-file request.json` |

APP 是本机保存的部署名称。Sandbox 操作也接受原生 ID；托管应用通过业务 HTTP API 使用，不能被当作一个 Sandbox。Provider 写入/删除操作在非交互模式需要 `--yes`。查看操作帮助确认输入 JSON 的字段和效果。

`abx status APP` 使用保存的 Sandbox ID 和 Provider 查询。`status` 表示当前远端状态，`recorded_status` 表示本机保存的部署操作状态。确认实例不存在时返回 `status: missing` 和 `observation: not_found`；认证或连接失败会使命令报错，不会被当作实例不存在。如果创建过程中没有记录实例 ID，当前状态为 `unknown`。查询不会清除本机归属记录，也不会创建替代实例。

`abx exec APP --stream -- COMMAND` 将 stdout、stderr 实时写到对应终端通道。启用 `--json` 或 CI 输出时，返回包含 `stdout`、`stderr`、`exit_code` 的单个 JSON 对象，并使用远端命令的退出码。流式执行及极速版执行的 JSON 捕获上限为两个输出通道合计 16 MiB UTF-8 字节。超出上限后，CLI 在原执行期限内继续观察已有执行并报错，不会把截断输出当作成功。大量输出请先保存为 Sandbox 内的文件后下载，或使用终端流式输出。流结束却没有确认退出码时会报错，不会重试执行命令。

[入门](getting-started.md) · [模板编写](authoring-templates.md) · [完整命令参考](../reference/cli-commands.md)

目标优先的业务调用入口需要已绑定 OpenAPI 契约，见[绑定与认证](sandbox-api.md)。
