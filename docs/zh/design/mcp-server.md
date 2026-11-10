# MCP 职责边界

MCP 将项目已有的 Sandbox 操作提供给 AI 客户端，复用 Provider 选择、配置和资源生命周期，不另建后端或部署系统。

本机 CLI 通过 `mcp start` 支持 STDIO 和 HTTP；`mcp install` 写入客户端启动配置，`mcp status/stop` 管理已记录的本机进程。STDIO 的 stdout 只承载协议消息。HTTP 认证与 Sandbox 平台凭据用途不同，帮助和工具发现不证明云端执行能力。

可部署的 HTTP MCP 服务由 `template init --template mcp` 生成普通 Sandbox 源码项目，再用 `deploy` 部署。生成服务使用 Python server runtime。本机 CLI 服务和生成的 HTTP 服务分别暴露其运行时已实现的工具，客户端应查询实际工具列表，不假定覆盖完全一致。生成服务需要明确配置其创建下游沙箱所使用的后端。

创建 Sandbox、启动任务、观察结果和删除资源是不同工具效果。不确定远端结果不会被自动重试，本机取消不证明远端已停止。模板验证和业务验收应检查实际输出及所属资源清理，不能只检查返回码。

安装、认证和操作检查见 [MCP 集成](../guide/mcp-integration.md)、[Agent Skill](../../../SKILL.md)、[Provider 契约](../../../references/provider-contracts.md)及[任务流程](../../../references/task-workflows.md)。
