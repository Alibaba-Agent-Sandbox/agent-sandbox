# Agent Sandbox

[English](README.md) | **中文**

<!-- badges -->
[![CI](https://github.com/alibaba-agent-sandbox/agent-sandbox/actions/workflows/ci.yml/badge.svg)](https://github.com/alibaba-agent-sandbox/agent-sandbox/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@agent-sandbox/cli)](https://www.npmjs.com/package/@agent-sandbox/cli)
[![Node 20+](https://img.shields.io/node/v/@agent-sandbox/cli)](https://www.npmjs.com/package/@agent-sandbox/cli)
[![License](https://img.shields.io/github/license/agent-sandbox/agent-sandbox)](LICENSE)

> 为 AI Agent 打造的云沙箱 —— 秒级创建、执行、管理隔离环境。

**Agent Sandbox** 是命令行工具（`abx`）。默认提供方是阿里云极速版（`alicloud-express`）。CLI 还会加载已安装的 `node`、`exec` 和 `rest` 插件。目录提供方 `opensandbox`、`alicloud-container`、`cubesandbox` 和 `e2b` 都是 `node` 插件：导出 `create(kit)` 的 ES 模块 `provider.mjs`。用 `abx provider install alibaba-agent-sandbox/awesome-providers//<id>` 安装（本地路径或 git URL 也可以），再用 `abx --provider <id>` 运行。既不是内置也未安装的 id 以 `E8001` 退出。`runtime.kind = "python"` 的清单不能安装。Python SDK 里以代码方式构造的 `Provider` 子类仍然可用；SDK 通过本机引擎（`abx provider engine serve`；`abx` 在 `PATH` 上或由 `ABX_BIN` 指定）使用同一批 `node` 插件。`exec`（stdio 上的 EPP/1，任意语言，可选 `pty.*`）留给第三方插件。
Python SDK 位于 [`python-sdk` 仓库](https://github.com/alibaba-agent-sandbox/python-sdk)（见 [Python SDK](#python-sdk)）。
模板的构建和部署在这个 CLI 里。运行时客户端是 Python SDK。那边的方法名接近 E2B，便于迁移；CLI 和 SDK 都不是 E2B 协议的直接替代。

## 网站

| 网站 | 地址 |
|---|---|
| 官网 | https://www.agent-sandbox.com |
| 提供方注册站 | https://registry.agent-sandbox.com |

CLI 从 git 树 `alibaba-agent-sandbox/awesome-providers//<id>` 安装这些目录提供方。Python SDK 安装器（`python -m agent_sandbox.providers install registry:<id> --yes`）拉取 `https://registry.agent-sandbox.cn/providers/index.json`。`ABX_PROVIDER_REGISTRY` 可以改 SDK 安装器使用的这个地址。

---

## 特性

- **CLI (`abx`)** —— 创建、查看、执行、上传/下载、部署，从终端管理沙箱。
- **模板系统** —— 可复用的沙箱镜像（Python、Node、浏览器自动化、AI Agent Harness……）。
- **MCP Server** —— 将沙箱操作暴露为 MCP 工具，供 LLM Agent 调用。
- **Agent Skill** —— 静态 Agent Skills 指南（[`SKILL.md`](SKILL.md)），适用于 Qoder、Claude Code、Cursor、Qwen Code、Codex。
- **独立二进制，或 Node.js >= 20 从源码构建** —— Release 二进制不需要 Node.js。npm 包尚未发布。

SDK 侧特性（异步优先的 `Sandbox` API、`run` / `run_code` 执行原语、`@sandbox` 声明式装饰器、会话持久化、E2B 兼容层）见 [Python SDK](#python-sdk) 一节。

## 安装

### macOS 与 Linux

```bash
curl -fsSL https://raw.githubusercontent.com/Alibaba-Agent-Sandbox/agent-sandbox/main/install.sh | sh
```

### Windows（PowerShell）

```powershell
irm https://raw.githubusercontent.com/Alibaba-Agent-Sandbox/agent-sandbox/main/install.ps1 | iex
```

安装脚本会选择 `darwin-arm64`、`darwin-x64`、`linux-arm64`、`linux-x64` 或 `windows-x64`，校验 `.sha256`，并且不需要 `sudo`。macOS 和 Linux 在 `/usr/local/bin` 可写时装到那里，否则装到 `$HOME/.local/bin`。Windows 装到 `%LOCALAPPDATA%\Programs\abx`，并把它加到用户 `PATH`。`ABX_VERSION` 选择版本（默认最新 Release）。`ABX_INSTALL_DIR` 选择目录。网站以后可以把这两份脚本放到自己的域名上；命令仍然是一行，只改 URL。

这两行命令需要资产名为 `abx-*` 的 GitHub Release。v0.2.0 的资产名是 `ebx-*`，v0.3.0 还没有发布。在那个 Release 出现之前，请从源码安装（见下）。

### 手动下载

从 [GitHub Releases](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/releases) 下载 `abx-<version>-<os>-<arch>[.exe]` 和对应的 `.sha256`，校验摘要后，以 `abx` 为名放到 `PATH` 上。命令、校验和与平台表见 [二进制安装](docs/zh/guide/binary-installation.md)（[English](docs/en/guide/binary-installation.md)）。

### npm（即将提供）

`npm install -g @agent-sandbox/cli` **即将提供，包尚未发布**。包名还没有定。部分 npm 镜像（包括 npmmirror）上有一个无关的 `@agent-sandbox/cli@0.2.2`，它的 bin 是 `agent-sandbox`，不是 `abx`。

### 从源码安装

需要 Node.js 20 或更新版本。2026-10-15 在 Linux x64、Node.js 22.14.0 上验证过（`npm pack` 生成 `agent-sandbox-cli-0.3.0.tgz`；`abx --version` 输出 `abx, version 0.3.0`）：

```bash
git clone https://github.com/Alibaba-Agent-Sandbox/agent-sandbox.git
cd agent-sandbox
npm ci
npm run build
npm pack
npm install -g ./agent-sandbox-cli-<version>.tgz
abx --version
```

### 故障排查：abx: command not found

安装目录不在 `PATH` 上时，把安装脚本打印的那一行 `export PATH=...` 加进去（Windows 上在 `install.ps1` 之后新开一个终端）。如果 `npm install -g @agent-sandbox/cli` 装上了镜像里的 `@agent-sandbox/cli@0.2.2`，用 `npm uninstall -g @agent-sandbox/cli` 卸掉；那个包的命令是 `agent-sandbox`。详见 [二进制安装](docs/zh/guide/binary-installation.md#故障排查abx-command-not-found)。

## 配合 AI 编码工具使用

仓库内置静态 Agent Skills 指南（[`SKILL.md`](SKILL.md)），教 Qoder、Claude Code、Cursor、Qwen Code、Codex 等工具如何操作 Agent Sandbox——**可先于（或无需）`abx` CLI 安装**：

```bash
# 快捷方式（需 Node.js）；把 qoder 换成 claude-code / cursor / qwen-code / codex，
# 加 -g 安装到用户级，加 --list 仅预览
npx skills add agent-sandbox/agent-sandbox --skill agent-sandbox -a qoder -y
```

没有 Node.js？把 `SKILL.md` 复制到你的工具技能目录（例如 `~/.qoder/skills/agent-sandbox/SKILL.md`）。完整工具目录矩阵、版本锁定、升级、卸载与安全提示见 [Agent Skill 安装与分发](docs/zh/guide/agent-skill-installation.md)（[English](docs/en/guide/agent-skill-installation.md)）。

## CLI (`abx`)

```bash
# 配置凭证
abx config init                          # 凭证 + 区域（--build / --llm 追加相应部分）
abx config set sandbox_api_key <YOUR_API_KEY>   # 或直接设置单个密钥

# 沙箱生命周期
abx create --template base             # 默认模板
abx create --template python-base      # 目录里的 Python 镜像
abx list                                 # 列出运行中的沙箱
abx info <sandbox-id>                    # 查看沙箱详情
abx exec <sandbox-id> -- echo hello       # 执行命令（--cwd/--env/--timeout/--stream/--background）
abx run <sandbox-id> <name> --arg k=v    # 调用沙箱内服务器上注册的具名命令
abx connect <sandbox-id>                 # 逐行命令 REPL（每行一个新进程，不是 PTY）

# 文件传输
abx upload <sandbox-id> ./local.txt /remote/path.txt
abx download <sandbox-id> /remote/path.txt ./local.txt

# 模板管理
abx template list                        # 列出模板
abx template info python-base            # 模板详情
abx template install owner/repo          # 从 GitHub 安装

# 模板部署（阿里云模板 API，已内置于 CLI）
abx template create registry.cn-hangzhou.aliyuncs.com/ns/repo:tag --name my-tpl
abx template deploy ./examples/templates/python-hello \
    --acr-namespace my-ns --acr-repo python-hello

# 模板生命周期：编写 -> 发布 -> 启动
abx template init --adopt ./app --hint "端口 8080"     # 1a. 适配已有项目
abx template init "一个 Python Web 服务"               # 1b. 模板生成写出 ./<name>/（可选）
abx deploy ./app --acr-namespace my-ns                 # 2. 构建、推送 ACR、注册（无需 LLM）
abx create --template <TEMPLATE_ID>                    # 3. 启动沙箱

# MCP 服务
abx mcp start                            # 启动 MCP 工具服务

# 清理
abx kill <sandbox-id>
```

> **环境变量：** envd 使用直接执行（direct exec）—— Shell 特性（`$VAR` 展开、管道、重定向）需要 `sh -c '...'`。用 `printenv VAR` 读取变量值。详见[环境变量指南（中文）](docs/zh/guide/environment-variables.md) | [Environment Variables (EN)](docs/en/guide/environment-variables.md)。

## 模板

官方与社区模板统一维护在
[`alibaba-agent-sandbox/awesome-templates`](https://github.com/alibaba-agent-sandbox/awesome-templates)
仓库——模板内容、索引与发布的唯一真源。通过远程索引发现与安装：

```bash
# 通过远程索引发现模板
$ abx template search web
Name      Description       Tags           Status
node-web  Node.js web app   nodejs, web    official

$ abx template install node-web                                        # 按索引名安装
$ abx template install alibaba-agent-sandbox/awesome-templates//node-web@v1.0.0 # 或锁定版本
```

[`examples/templates/`](https://github.com/alibaba-agent-sandbox/python-sdk/tree/main/examples/templates)（位于 `python-sdk` 仓库）仅保留一个最小的 `python-hello`
**测试夹具（fixture）**用于离线测试，并非模板发布真源。夹具契约与索引行为
（缓存、离线回退、锁定版本）详见 [examples/templates/README.md](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/examples/templates/README.md)。

## Python SDK

Python SDK —— 异步优先的 `Sandbox` API、`@sandbox` 声明式装饰器、会话持久化、E2B 兼容层，以及其分层架构 —— 位于 [`python-sdk` 仓库](https://github.com/alibaba-agent-sandbox/python-sdk)。快速开始、执行 API（`sandbox.commands.run()` / `sandbox.run_code()` / `sandbox.run()`）与架构文档均在该仓库维护。

```bash
# 客户端 SDK（import agent_sandbox）
pip install agent-sandbox-client

# 模板镜像内使用的服务端运行时（import agent_sandbox.server）
pip install agent-sandbox-server
```

`pip install agent-sandbox` 会安装一个无关项目。`agent-sandbox-server` 是容器内运行时：模板的 Dockerfile 与 `commands.py` 通过 `pip install agent-sandbox-server` 安装它。`abx` CLI 不再随 Python 包发布（不存在 `[cli]` extra）。请用[二进制安装脚本](docs/zh/guide/binary-installation.md)安装。`npm install -g @agent-sandbox/cli` 即将提供，包尚未发布。

## 文档

> 完整文档索引：[`docs/README.md`](docs/README.md)（双语导航）

### 教程与指南

| 指南 | 链接 |
|------|------|
| 快速入门 | [快速入门](docs/zh/guide/getting-started.md) |
| 最佳实践 | [最佳实践](docs/zh/guide/best-practices.md) |
| 无障碍 | [无障碍说明](ACCESSIBILITY.md) |
| 操作指南 | [操作指南](docs/zh/guide/operations.md) |
| 提供商 | [提供商](docs/zh/guide/providers.md) |
| 编写提供商 | [编写提供商](docs/zh/guide/authoring-providers.md) |
| 二进制安装 | [二进制安装](docs/zh/guide/binary-installation.md) |
| CLI 教程 | [CLI 教程](docs/zh/guide/cli-tutorial.md) |
| 认证配置 | [认证配置](docs/zh/guide/authentication.md) |
| 环境变量 | [环境变量](docs/zh/guide/environment-variables.md) |
| 使用模板 | [使用模板](docs/zh/guide/using-templates.md) |
| 编写模板 | [编写模板](docs/zh/guide/authoring-templates.md) |
| 部署与构建 | [部署与构建](docs/zh/guide/deploy-and-build.md) |
| 端到端模板工作流 | [端到端模板工作流](docs/zh/guide/e2e-template-workflow.md) |
| Agents API | [Agents API](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/agents-api.md) |
| Agent Skill 安装与分发 | [Agent Skill 安装与分发](docs/zh/guide/agent-skill-installation.md) |
| MCP 集成 | [MCP 集成](docs/zh/guide/mcp-integration.md) |
| 故障排查 | [故障排查](docs/zh/guide/troubleshooting.md) |

### 参考手册

| 文档 | 链接 |
|------|------|
| CLI 命令体系（规范命令树） | [CLI 命令参考](docs/zh/reference/cli-commands.md) |
| CLI 参考 | [CLI 参考](docs/zh/reference/cli-reference.md) |
| 配置说明 | [配置说明](docs/zh/reference/configuration.md) |
| 引擎 HTTP API（各 SDK 通过它使用提供商） | [引擎 HTTP API](docs/zh/reference/engine-api.md) |
| 错误码 | [错误码](docs/zh/reference/error-codes.md) |

### 设计与架构

| 文档 | 链接 |
|------|------|
| 设计索引 | [设计索引](docs/zh/DESIGN.md) |
| CLI 架构 | [CLI 架构](docs/zh/design/architecture.md) |
| CLI 设计 | [CLI 设计](docs/zh/design/cli-design.md) |
| MCP Server | [MCP Server](docs/zh/design/mcp-server.md) |
| 模板目录 | [模板目录](docs/zh/design/templates-catalog.md) |

### 相关 SDK 文档

Python SDK、沙箱内 Server SDK 与共享的平台契约的文档位于 [`python-sdk` 仓库](https://github.com/alibaba-agent-sandbox/python-sdk)：[文档中心](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/README.md)、[SDK 使用](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/sdk-usage.md)、[架构设计](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/design/architecture.md)、[SDK API 设计](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/design/sdk-api-design.md)、[模板系统](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/design/template-system.md)、[Template YAML 规范](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/reference/template-yaml-spec.md)、[声明式用法](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/declarative-usage.md)、[会话持久化](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/session-persistence.md)、[从 E2B 迁移](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/migrate-from-e2b.md) 与 [`examples/`](https://github.com/alibaba-agent-sandbox/python-sdk/tree/main/examples)。

### 其他资源

| 资源 | 链接 |
|------|------|
| 更新日志 | [CHANGELOG.md](CHANGELOG.md) |
| 贡献指南 | [CONTRIBUTING.md](.github/CONTRIBUTING.md) |
| 许可证 | [Apache-2.0](LICENSE) |

## 贡献

欢迎贡献！请阅读 [贡献指南](.github/CONTRIBUTING.md) 了解详情。

## 许可证

[Apache-2.0](LICENSE) —— 版权信息见 [`NOTICE`](NOTICE)。
