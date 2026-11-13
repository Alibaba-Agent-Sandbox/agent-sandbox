# 托管 Agents 应用

[Agents API 模板](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/tree/main/agents-api) 提供稳定 Gateway、按版本独立的 Worker/Dispatcher 和可复用 Sandbox 模板。Session 计算实例由业务运行时创建。

template.yaml 使用命名 sandbox/serving 及原生 FC props；业务策略放在作者自定义变量和启动代码里。数据库、模型、认证、版本路由与发布由模板脚本承接，通用 CLI 不会仅凭三个 FC 函数推断这些职责。

具体私有环境输入、依赖、部署及 HTTP/SDK 用法以该模板双语 README 为准。脚本本地生成并复用应用凭据，在切换稳定入口前验证候选版本，为已有 Session 保留旧 Worker。存在旧版本期间保持内部控制令牌稳定。

按模板 abx deploy 配方部署；删除前运行模板的 drain/destroy 脚本，确认会话与不确定清理结果。通用资源删除本身不会检查应用数据库。已有数据库、执行角色和传入镜像保持外部归属。

当前源码规范与较早已发布 CLI 不同，使用匹配的源码 CLI 与模板版本。Schema 可用不能替代完整业务验证。

[通用资源配置](template-workflows.md) · [构建与部署](deploy-and-build.md)
