# 操作速查

公共命令使用同一个解析入口，`--provider` 选择后端，`--json` 控制机器输出。

| 任务 | 命令 |
| --- | --- |
| 部署源码/目录模板 | `abx deploy SOURCE --name APP --yes` |
| 从原生模板创建 | `abx sandbox create --template TEMPLATE` |
| 查看/状态/日志 | `abx list`、`abx status APP`、`abx logs APP` |
| 删除/恢复 | `abx delete APP --yes`、`abx recover APP` |
| 执行进程 | `abx sandbox exec SANDBOX_ID -- COMMAND` |
| 交互终端 | `abx sandbox connect SANDBOX_ID` |
| 注册函数 | `abx sandbox command list SANDBOX_ID`、`abx sandbox command run SANDBOX_ID NAME --arg key=value` |
| 文件和进程工具 | `abx sandbox files --help`、`abx sandbox process --help` |
| 目录与源码 | `abx template list`、`abx template info NAME`、`abx template init` |
| 构建/源码发布 | `abx template build SOURCE --yes`、`abx template publish SOURCE --tag VERSION --yes` |
| Provider 原生操作 | `abx provider command list PROVIDER`、`abx provider run OPERATION --input-file request.json` |

APP 是本机保存的部署名称。Sandbox 操作使用显式创建返回的原生 ID；托管应用通过业务 HTTP API 使用，不能被当作一个 Sandbox。Provider 写入/删除操作在非交互模式需要 `--yes`。查看操作帮助确认输入 JSON 的字段和效果。

[入门](getting-started.md) · [模板编写](authoring-templates.md) · [完整命令参考](../reference/cli-commands.md)
