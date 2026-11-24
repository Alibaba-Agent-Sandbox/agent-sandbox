# 命令职责

CLI 按用户任务组织；[命令参考](../reference/cli-commands.md)是语法的统一说明，选项细节集中在那里，不再复制多套命令目录。

| 任务 | 入口 |
| --- | --- |
| 创建沙箱、部署 FC 应用并管理运行资源 | `create`、`deploy`、`list`、`status`、`logs`、`delete`、`recover` |
| 查找、创作、构建和发布可复用模板 | `template` |
| 操作 Sandbox 内部及其扩展生命周期 | `sandbox` |
| 配置本机默认值和凭据 | `config` |
| 安装后端、执行原生操作 | `provider` |
| 接入 AI 工具 | `mcp` |

`create --build FILE` 使用已准备的 Sandbox 构建，`create --template-id ID` 使用已有 Provider 原生模板。`deploy SOURCE --name NAME` 部署托管 FC 应用，`--plan` 提供本地预览。托管应用更新复用同一个名称；普通 Sandbox 部署须先删除，再用相同名称重新创建。

`template init --from` 只复制源码，`template build` 准备可复用产物而不创建实例，`template publish` 通过已有 GitHub remote 发布已提交源码。Provider 云模板 CRUD 归 `provider run`。

全局输出和 Provider 选项共用一个解析器。exec 名称/ID 之后的参数属于远端命令；显式命令期限在连接前校验，Sandbox 存活期限单独设置。`--ci` 控制机器输出，不授权管理凭据创建或续期。

普通交互配置保存在本机供后续复用，临时选项和环境变量不自动变为保存的默认值。CLI 准备默认应用认证；模型、平台及云管理凭据仍各有用途。

重复命令别名和 app 树已移除，协议辅助和 Provider engine 保留独立职责。参阅[架构](architecture.md)、[操作教程](../guide/cli-tutorial.md)、[模板创作](../guide/authoring-templates.md)及[托管应用](../guide/managed-applications.md)。
