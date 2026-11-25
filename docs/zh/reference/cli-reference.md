# CLI 参考

[命令参考](cli-commands.md)集中列出当前命令和选项。已安装版本以 `abx --help` 及各命令的 `--help` 为准；当前命令布局需要源码安装，已发布的 0.5.10 使用原布局。

| 任务 | 入口 |
| --- | --- |
| 部署、检查和清理 | `deploy`、`list`、`status`、`logs`、`delete`、`recover` |
| 查找和编写模板 | `template list/info/init/build/publish` |
| 执行命令、传输文件和终端连接 | `exec/connect/upload/download` |
| 配置凭据和默认值 | `config` |
| 安装后端、执行原生管理操作 | `provider` |
| 接入 AI 工具 | `mcp` |

参阅[配置](configuration.md)、[Provider 操作](../guide/provider-commands.md)、[模板创作](../guide/authoring-templates.md)与[托管应用](../guide/managed-applications.md)。

带值选项的别名使用相同的参数格式与校验。例如，`abx provider test PROVIDER --opt key=value`、`--option key=value` 和 `-o key=value` 设置的是同一个可重复选项，混用时保留命令行顺序。正反布尔开关以最后一个显式输入为准，未输入时使用声明的环境变量或默认值。此修复位于当前源码，公开发行版 0.5.10 请使用 `--opt` 或 `-o`。
