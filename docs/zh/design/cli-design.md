# 命令职责

CLI 按用户任务组织；[命令参考](../reference/cli-commands.md)是语法的统一说明，选项细节集中在那里，不再复制多套命令目录。

| 任务 | 入口 |
| --- | --- |
| 准备和管理具名资源 | `deploy`、`list`、`status`、`logs`、`delete`、`recover` |
| 查找、创作、构建和发布可复用模板 | `template` |
| 操作 Sandbox 内部及其扩展生命周期 | `sandbox` |
| 配置本机默认值和凭据 | `config` |
| 安装后端、执行原生操作 | `provider` |
| 接入 AI 工具 | `mcp` |

`deploy SOURCE --name NAME --yes` 准备模板、静态卷及 Serving 资源；`sandbox create --template ID` 创建动态实例。`--plan` 仅预览。重复部署按归属记录更新资源；动态实例及其业务进程由调用方管理。

`template init --from` 只复制源码，`template build` 准备可复用产物而不创建实例，`template publish` 通过已有 GitHub remote 发布已提交源码。Provider 云模板 CRUD 归 `provider run`。

全局输出和 Provider 选项共用一个解析器。exec 名称/ID 之后的参数属于远端命令；显式命令期限在连接前校验，Sandbox 存活期限单独设置。`--ci` 控制机器输出，不授权管理凭据创建或续期。

普通交互配置保存在本机供后续复用，临时选项和环境变量不自动变为保存的默认值。CLI 准备默认应用认证；模型、平台及云管理凭据仍各有用途。

重复命令别名和 app 树已移除，协议辅助和 Provider engine 保留独立职责。参阅[架构](architecture.md)、[操作教程](../guide/cli-tutorial.md)、[模板创作](../guide/authoring-templates.md)及[托管应用](../guide/managed-applications.md)。
