# Agent Sandbox CLI — 设计文档索引

> **版本**：v3.0 | **最后更新**：2026-10-12
>
> 本文档是 `abx` CLI（本仓库）设计文档的入口和索引。详细设计位于 [`design/`](design/) 目录下的各专题文档中。Python SDK 的设计文档位于 [`python-sdk` 仓库](https://github.com/alibaba-agent-sandbox/python-sdk)，见 [相关 SDK 文档](#相关-sdk-文档)。

---

## 项目概述

**`abx`**（npm 包名 `@agent-sandbox/cli`）是面向阿里云 FC Agent 沙箱服务的命令行客户端，同时服务人类开发者和 AI Agent。它以 Node.js / TypeScript 实现，并承载向 IDE Agent 暴露沙箱的 MCP Server。

### 核心设计原则

1. **命令面保持稳定** — 命令名、选项、帮助文本、错误文本、输出通道和退出码（0–6）保持稳定，并由黄金文件守护
2. **AI-First** — 自然语言创建沙箱、`--json` / `--quiet` / `--ci` 输出模式、MCP Server 是一等公民
3. **零配置默认** — 安装、导出 API Key、创建沙箱

### 快速上手

```bash
npm install -g @agent-sandbox/cli   # abx CLI（需要 Node.js 20+）
export ABX_SANDBOX_API_KEY=your-api-key
abx create --template base
abx list
```

---

## 架构概览

CLI 采用严格的分层结构——下层从不导入上层。完整说明（分层表、源码目录、构建与发布、一致性契约）见 [CLI 架构](design/architecture.md)。

```mermaid
graph TB
    BIN["bin — abx 入口"]
    subgraph Front["命令行"]
        FW["framework — 兼容 click 的命令框架"]
        CLI["cli — main、OutputManager、格式化"]
        CMD["cli/commands — 命令组"]
    end
    subgraph Services["宿主侧服务"]
        AG["agent — MCP Server、模板编写"]
        SES["session — LocalSessionStore"]
    end
    subgraph Core["客户端核心"]
        API["api — Sandbox、文件、代码、命令、模板"]
        PRO["protocol"]
        TRA["transport — HTTP、WebSocket、认证"]
        MOD["models + utils"]
    end
    BIN --> CLI --> FW
    CLI --> CMD
    CMD --> AG
    CMD --> SES
    CMD --> API
    AG --> API
    SES --> API
    API --> PRO --> TRA --> MOD
```

---

## 设计专题索引

[Provider 管理命令契约](design/provider-commands.md) · [阿里云能力矩阵](design/alicloud-provider-commands.md)

### 架构与命令

| 专题 | 文档 | 摘要 |
|------|------|------|
| **CLI 架构** | [architecture.md](design/architecture.md) | 分层、`src/` 目录结构、命令组、输出与退出码、配置/凭证、构建 / SEA 二进制 / 发布、一致性契约 |
| **CLI 命令体系** | [cli-design.md](design/cli-design.md) | 命令树（45 个命令）、全局选项、自然语言创建、OutputManager、AI Friendly 设计 |
| **模板目录** | [templates-catalog.md](design/templates-catalog.md) | 单一真源（SSOT）：awesome-templates 目录仓库、远程索引客户端、缓存/降级行为、fixture 边界、模板命令面 |
| **模板构建模式** | [template-build-modes.md](design/template-build-modes.md) | 一次发布只走一条路：本地 Dockerfile，或把 `template.yaml` 的 `build:` 展开成 `CreateTemplate` 的 `sandboxConfig.steps` |
| **提供方模板部署** | [provider-template-deploy.md](design/provider-template-deploy.md) | 仅设计：按提供方做 `abx template deploy`。极速版的构建/推送/注册层、四个目录 API，以及提议的 `template.deploy` 功能。[英文](../design/provider-template-deploy.md) |
| **Node 提供方架构** | [node-provider-architecture.md](design/node-provider-architecture.md) | 一份 Node/TypeScript 提供方层：四种类型、kit、CLI 进程内与本机引擎与 exec，以及 HTTP/SSE/WebSocket 契约 |

### AI 与 Agent 集成

| 专题 | 文档 | 摘要 |
|------|------|------|
| **MCP Server** | [mcp-server.md](design/mcp-server.md) | 7 个 P0 MCP 工具、STDIO 与 Streamable HTTP 传输、FC 部署产物、会话绑定 |
| **Agents API** | [agents-api.md](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/agents-api.md) | 沙箱内的 Agent 会话。目前是 Codex 和 Qwen Code，之后在同一组路由上扩充 |

### 移植、布局与提供方规格

[`PORTING.md`](../PORTING.md) 和 [`repository-layout.md`](../design/repository-layout.md) 是英文。测试读取的提供方规格英文原稿在 [`docs/design/providers-and-credentials-cli.md`](../design/providers-and-credentials-cli.md)。中文副本是 [`docs/zh/design/providers-and-credentials-cli.md`](design/providers-and-credentials-cli.md)。接线记录同样成对：[英文](../design/provider-wiring-plan.md)、[中文](design/provider-wiring-plan.md)。

| 专题 | 文档 | 摘要 |
|------|------|------|
| **Python 到 Node 移植** | [PORTING.md](../PORTING.md) | 逐模块移植规则、一致性门禁、测试台账 |
| **仓库布局** | [repository-layout.md](../design/repository-layout.md) | CLI 仓库布局评审与文档归属规则 |
| **Provider 与凭证（CLI 规格）** | [providers-and-credentials-cli.md](design/providers-and-credentials-cli.md) | provider 层的 CLI 语法、JSON 形态与测试 |
| **Provider 评审记录** | [providers-and-credentials-cli-review.md](design/providers-and-credentials-cli-review.md) | 上述规格的评审记录 |

---

## 实现状态

| 功能 | 状态 | 备注 |
|------|------|------|
| CLI（45 个命令） | **已实现** | 详见 [cli-design.md](design/cli-design.md) |
| MCP Server（STDIO） | **已实现** | 7 个 P0 工具 |
| MCP Server（Streamable HTTP） | **已实现** | `agent/mcp_http.ts` |
| `abx mcp deploy`（FC 产物生成） | **已实现** | 生成部署产物并打印手动 FC 部署步骤。详见 [mcp-server.md](design/mcp-server.md#7-fc-部署) |
| 模板 build/push/create 流水线 | **已实现** | 通过官方 CreateTemplate API |
| 单文件二进制（Node SEA） | **已实现** | 详见 [二进制安装](guide/binary-installation.md) |
| Provider 命令 | **已实现**（`alicloud-express`，以及已安装的 `node`、`exec`、`rest` 提供商：`opensandbox`、`e2b`、`cubesandbox`、`alicloud-container`） | `abx --provider <id>` 加载已安装的插件；既不是内置也未安装的 id 以 `E8001` 退出。见[提供商](guide/providers.md)和[Node 提供商架构](design/node-provider-architecture.md) |

---

## 相关资源

| 资源 | 位置 |
|------|------|
| 架构决策记录 (ADR) | [`.agents/notes/`](../../.agents/notes/README.md) |
| CLI 黄金文件证据 | [`.agents/evidence/`](../../.agents/evidence/) |
| Agents API | [python-sdk `docs/zh/guide/agents-api.md`](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/agents-api.md) |
| 用户指南 | [`docs/zh/guide/`](guide/) |
| CLI 参考 | [`docs/zh/reference/`](reference/) |
| English design index | [`docs/en/DESIGN.md`](../en/DESIGN.md) |

## 相关 SDK 文档

Python SDK（`agent-sandbox`）、沙箱内 Server SDK 与平台契约的文档位于 [`python-sdk` 仓库](https://github.com/alibaba-agent-sandbox/python-sdk)。CLI 读者最常需要的页面：

- [系统架构](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/design/architecture.md) — SDK 的六层架构，CLI 的客户端核心与之对应
- [SDK API 设计](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/design/sdk-api-design.md) 与 [沙箱类型体系](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/design/sandbox-types.md)
- [模板体系](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/design/template-system.md) 与 [template.yaml 规范](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/reference/template-yaml-spec.md) — `template.yaml` 契约
- [内置 Agent](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/design/built-in-agents.md) 与 [Server API](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/design/server-api.md)
