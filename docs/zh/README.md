# Easy Sandbox CLI — 文档中心

`ebx` 是 Easy Sandbox 云端沙箱服务（阿里云函数计算）的命令行客户端：创建与管理沙箱、执行代码与命令、编写与部署模板，并通过 MCP Server 向 IDE Agent 暴露沙箱。本页索引 CLI（`@easy-sandbox/cli`）的文档。Python SDK 的文档位于 [`python-sdk` 仓库](https://github.com/Easy-Sandbox/python-sdk)，见 [相关 SDK 文档](#相关-sdk-文档)。

---

## 设计文档

| # | 文档 | 说明 |
|---|------|------|
| 1 | [CLI 架构](design/architecture.md) | 分层、`src/` 结构、命令组、输出与退出码、构建 / SEA 二进制 / 发布、一致性契约 |
| 2 | [CLI 命令体系](design/cli-design.md) | 命令树、全局选项、自然语言创建、OutputManager、AI Friendly 原则 |
| 3 | [MCP Server](design/mcp-server.md) | 7 个 P0 工具定义、会话绑定、STDIO 与 Streamable HTTP 传输、IDE 配置、FC 部署 |
| 4 | [模板目录](design/templates-catalog.md) | 官方模板集合形态契约、发布流程、离线校验、模板命令面 |

汇总索引见 [DESIGN.md](DESIGN.md)。仅有英文的维护者文档（移植规则、仓库布局、provider 草案）在该索引中列出，位于 [`docs/design/`](../design/) 与 [`docs/PORTING.md`](../PORTING.md)。

## 用户文档

### [`guide/`](guide/) — 使用教程与 How-to 指南

| 文档 | 说明 |
|------|------|
| [快速开始](guide/getting-started.md) | 安装、配置、第一个沙箱 |
| [二进制安装](guide/binary-installation.md) | 单文件 `ebx` 二进制（Node SEA），无需 Node.js |
| [认证配置](guide/authentication.md) | API Key / AK-SK 认证与 `ebx config` |
| [CLI 教程](guide/cli-tutorial.md) | 命令行快速上手 |
| [模板使用](guide/using-templates.md) | 官方与社区模板使用 |
| [模板编写](guide/authoring-templates.md) | 自定义模板；已有项目用 `ebx template init --adopt` |
| [部署与构建](guide/deploy-and-build.md) | 模板生命周期（`template init` / `--adopt` → `deploy` → `create`） |
| [端到端模板工作流](guide/e2e-template-workflow.md) | 从零构建模板到沙箱使用完整指南 |
| [MCP 集成](guide/mcp-integration.md) | Cursor / Claude Desktop / VS Code 集成 |
| [环境变量](guide/environment-variables.md) | 沙箱环境变量作用域、注入方式与直接执行语义 |
| [故障排查](guide/troubleshooting.md) | 常见问题与解决方案 |
| [Agent Skill 安装与分发](guide/agent-skill-installation.md) | 把静态 SKILL.md 指南安装到 Qoder / Claude Code / Cursor / Qwen Code / Codex |
| [自带 Agent（BYO）集成](guide/byo-agent-integration.md) | 在沙箱内运行自带 Agent CLI：职责边界、custom_commands 契约、凭证白名单、版本锁定与许可边界 |
| [测试与完成定义](guide/testing-e2e.md) | 三层验证（单元、差分、真实云 E2E）与完成定义（Definition of Done） |

### [`reference/`](reference/) — CLI / 配置参考

| 文档 | 说明 |
|------|------|
| [CLI 参考](reference/cli-reference.md) | 所有 CLI 命令速查 |
| [配置参考](reference/configuration.md) | CLI 环境变量、配置文件、优先级 |
| [错误码](reference/error-codes.md) | E1xxx–E6xxx 错误码与 CLI 退出码 |

## 项目规划

| 文档 | 说明 |
|------|------|
| [设计索引](DESIGN.md) | 设计专题索引与实现状态 |
| [Python 到 Node 移植](../PORTING.md) | 一致性契约与测试台账 |

---

## 快速导航

### 按角色

- **CLI 用户**：[快速开始](guide/getting-started.md) → [CLI 教程](guide/cli-tutorial.md) → [CLI 命令体系](design/cli-design.md)
- **模板作者**：[模板编写](guide/authoring-templates.md) → [部署与构建](guide/deploy-and-build.md) → [端到端模板工作流](guide/e2e-template-workflow.md)
- **AI Agent 开发者**：[自带 Agent（BYO）集成](guide/byo-agent-integration.md) → [MCP 集成](guide/mcp-integration.md) → [MCP Server](design/mcp-server.md)
- **CLI 贡献者**：[CLI 架构](design/architecture.md) → [Python 到 Node 移植](../PORTING.md)

### 按功能

- **自然语言创建沙箱**：[CLI](design/cli-design.md#3-自然语言创建ai-模板生成)
- **项目直接部署**：[CLI 部署命令](design/cli-design.md#ebx-deploy)（`ebx deploy` 为固定的 build+push+创建模板流水线；模板由 `ebx template init` 编写，可用脚手架、一句描述或 `--adopt`）
- **MCP 集成（Cursor/Claude）**：[MCP Server](design/mcp-server.md#5-安装方式与-cli)

### 其他资源

- **模板真源（awesome-templates）**：[Easy-Sandbox/awesome-templates](https://github.com/Easy-Sandbox/awesome-templates) — 官方与社区模板内容、索引（`awesome-templates.yaml`）与发布的唯一真源，通过 `ebx template search` / `ebx template install` 使用
- **English Documentation**：[English docs](../en/README.md)

## 相关 SDK 文档

Python SDK、沙箱内 Server SDK 与共享的平台契约的文档位于 [`python-sdk` 仓库](https://github.com/Easy-Sandbox/python-sdk)：

- [文档中心](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/zh/README.md)
- [SDK 使用指南](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/zh/guide/sdk-usage.md) 与 [SDK API 设计](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/zh/design/sdk-api-design.md)
- [系统架构](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/zh/design/architecture.md) — SDK 的六层架构
- [模板体系](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/zh/design/template-system.md) 与 [template.yaml 规范](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/zh/reference/template-yaml-spec.md)
- [声明式用法](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/zh/guide/declarative-usage.md)、[会话持久化](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/zh/guide/session-persistence.md)、[E2B 迁移](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/zh/guide/migrate-from-e2b.md)
