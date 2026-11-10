# Agent Sandbox CLI — 文档中心

`abx` 用于编写模板、管理具名部署、通过所选 Provider 执行沙箱操作，并通过 MCP 向 IDE Agent 提供沙箱工具。本页索引 CLI（`@agent-sandbox/cli`）的文档。Python SDK 的文档位于 [`python-sdk` 仓库](https://github.com/alibaba-agent-sandbox/python-sdk)，见 [相关 SDK 文档](#相关-sdk-文档)。

## 网站

| 网站 | 地址 |
|---|---|
| 官网 | https://www.agent-sandbox.cn |
| 提供方注册站 | https://registry.agent-sandbox.cn |

CLI 从 `alibaba-agent-sandbox/awesome-providers//<id>` 安装目录提供方。Python SDK 安装器拉取 `https://registry.agent-sandbox.cn/providers/index.json`。`ABX_PROVIDER_REGISTRY` 可以改 SDK 安装器使用的这个地址。

---

## 用户文档

### [`guide/`](guide/) — 使用教程与 How-to 指南

| 文档 | 说明 |
|------|------|
| [快速开始](guide/getting-started.md) | 安装、配置、第一个沙箱 |
| [最佳实践](guide/best-practices.md) | 何时使用 `--provider`、`--model`、`llm_model`、凭证和独立二进制 |
| [操作指南](guide/operations.md) | 每个命令组，以及做这件事时要运行的那一条命令 |
| [二进制安装](guide/binary-installation.md) | 单文件 `abx` 二进制（Node SEA），无需 Node.js |
| [提供商](guide/providers.md) | 安装、选择并配置沙箱提供商 |
| [Provider 命令](guide/provider-commands.md) | Provider 操作发现、JSON 输入、配置与平台原生 API |
| [编写提供商](guide/authoring-providers.md) | 编写 `node` 或 EPP/1 `exec` 提供商插件，含 `[template]` 与从 git 安装 |
| [认证配置](guide/authentication.md) | API Key / AK-SK 认证与 `abx config` |
| [CLI 教程](guide/cli-tutorial.md) | 命令行快速上手 |
| [托管应用](guide/managed-applications.md) | 统一 Gateway、显式部署与按 Session 隔离的 Sandbox 计算 |
| [模板使用](guide/using-templates.md) | 官方与社区模板使用 |
| [模板编写](guide/authoring-templates.md) | 自定义模板；已有项目用 `abx template init --adopt` |
| [部署与构建](guide/deploy-and-build.md) | 模板生命周期（`template init` / `--adopt` → `template build` → `deploy`） |
| [端到端模板工作流](guide/e2e-template-workflow.md) | 从零构建模板到沙箱使用完整指南 |
| [MCP 集成](guide/mcp-integration.md) | Cursor / Claude Desktop / VS Code 集成 |
| [环境变量](guide/environment-variables.md) | 沙箱环境变量作用域、注入方式与直接执行语义 |
| [故障排查](guide/troubleshooting.md) | 常见问题与解决方案 |
| [Agent Skill 安装与分发](guide/agent-skill-installation.md) | 把静态 SKILL.md 指南安装到 Qoder / Claude Code / Cursor / Qwen Code / Codex |
| [Agents API](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/agents-api.md) | 在沙箱里跑 Codex、Qwen Code，以及之后扩充的 Agent CLI。会话、回合和条目由服务端解析 |
| [测试与完成定义](guide/testing-e2e.md) | 三层验证（单元、差分、真实云 E2E）与完成定义（Definition of Done） |
| [命令与 SDK 对照](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/command-map.md) | `abx` 与 Python SDK 的职责和对应入口 |

### [`reference/`](reference/) — CLI / 配置参考

| 文档 | 说明 |
|------|------|
| [CLI 命令参考](reference/cli-commands.md) | 统一命令树与命令职责 |
| [CLI 参考](reference/cli-reference.md) | 所有 CLI 命令速查 |
| [配置参考](reference/configuration.md) | CLI 环境变量、配置文件、优先级 |
| [引擎 HTTP API](reference/engine-api.md) | 让所有 SDK 共用同一批提供商的本地引擎：发现文件、令牌、路由、错误 |
| [错误码](reference/error-codes.md) | 本页为 E1xxx–E7xxx。提供方错误 E8001–E8030 在 [Python SDK 索引](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/reference/error-codes.md) |

## 设计文档

改 CLI 时再看这里。日常使用从上面的用户文档进入。

| # | 文档 | 说明 |
|---|------|------|
| 1 | [CLI 架构](design/architecture.md) | 分层、`src/` 结构、命令组、输出与退出码、构建 / SEA 二进制 / 发布、一致性契约 |
| 2 | [CLI 命令体系](design/cli-design.md) | 命令树、全局选项、模板编写与部署职责 |
| 3 | [MCP Server](design/mcp-server.md) | 本地 IDE 工具、会话归属、STDIO/HTTP 传输与可编辑 MCP 模板 |
| 4 | [模板目录](design/templates-catalog.md) | 官方模板集合形态契约、发布流程、离线校验、模板命令面 |
| 5 | [模板构建模式](design/template-build-modes.md) | 清单构建模式、显式 Dockerfile 配方、可复用产物与准备期限 |
| 6 | [Node 提供方架构](design/node-provider-architecture.md) | 四种提供方类型、kit、进程内 / 引擎 / exec，以及引擎为什么是 HTTP、SSE 和 WebSocket |

汇总索引见 [DESIGN.md](DESIGN.md)。历史提供方与凭据规格是 [providers-and-credentials-cli.md](../design/providers-and-credentials-cli.md)。历史中文副本是 [providers-and-credentials-cli.md](design/providers-and-credentials-cli.md)。移植规则在 [PORTING.md](../PORTING.md)。

## 项目规划

| 文档 | 说明 |
|------|------|
| [设计索引](DESIGN.md) | 设计专题索引与实现状态 |
| [Python 到 Node 移植](../PORTING.md) | 一致性契约与测试台账 |

---

## 快速导航

### 按角色

- **CLI 用户**：[快速开始](guide/getting-started.md) → [操作指南](guide/operations.md) → [最佳实践](guide/best-practices.md) → [CLI 教程](guide/cli-tutorial.md)
- **模板作者**：[模板编写](guide/authoring-templates.md) → [部署与构建](guide/deploy-and-build.md) → [端到端模板工作流](guide/e2e-template-workflow.md)
- **AI Agent 开发者**：[Agents API](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/agents-api.md) → [MCP 集成](guide/mcp-integration.md) → [MCP Server](design/mcp-server.md)
- **CLI 贡献者**：[CLI 架构](design/architecture.md) → [Python 到 Node 移植](../PORTING.md)

### 按功能

- **自然语言编写模板**：[CLI 教程](guide/cli-tutorial.md)
- **项目直接部署**：[部署与构建](guide/deploy-and-build.md)
- **MCP 集成（Cursor/Claude）**：[MCP 集成](guide/mcp-integration.md)

### 其他资源

- **模板真源（awesome-templates）**：[alibaba-agent-sandbox/awesome-templates](https://github.com/alibaba-agent-sandbox/awesome-templates) — 官方与社区模板内容、索引（`awesome-templates.yaml`）与发布的唯一真源，通过 `abx template list` / `abx template init --from` 使用
- **English Documentation**：[English docs](../en/README.md)

## 相关 SDK 文档

Python SDK、沙箱内 Server SDK 与共享的平台契约的文档位于 [`python-sdk` 仓库](https://github.com/alibaba-agent-sandbox/python-sdk)：

- [文档中心](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/README.md)
- [SDK 使用指南](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/sdk-usage.md) 与 [SDK API 设计](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/design/sdk-api-design.md)
- [系统架构](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/design/architecture.md) — SDK 的六层架构
- [模板体系](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/design/template-system.md) 与 [template.yaml 规范](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/reference/template-yaml-spec.md)
- [声明式用法](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/declarative-usage.md)、[会话持久化](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/session-persistence.md)、[E2B 迁移](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/migrate-from-e2b.md)

当前单一命令面以[CLI 命令参考](reference/cli-commands.md)为准；[E2B 迁移指南](guide/migrate-from-e2b.md)说明如何迁移已有用法。

- [本地暂停与快照验收](guide/conditional-acceptance.md)
