# Easy Sandbox

[English](README.md) | **中文**

<!-- badges -->
[![CI](https://github.com/Easy-Sandbox/easy-sandbox/actions/workflows/ci.yml/badge.svg)](https://github.com/Easy-Sandbox/easy-sandbox/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@easy-sandbox/cli)](https://www.npmjs.com/package/@easy-sandbox/cli)
[![Node 20+](https://img.shields.io/node/v/@easy-sandbox/cli)](https://www.npmjs.com/package/@easy-sandbox/cli)
[![License](https://img.shields.io/github/license/easy-sandbox/easy-sandbox)](LICENSE)

> 为 AI Agent 打造的云沙箱 —— 秒级创建、执行、管理隔离环境。

**Easy Sandbox** 是基于阿里云函数计算（FC）Agent Sandbox 服务的命令行工具（`ebx`）。
Python SDK 位于 [`python-sdk` 仓库](https://github.com/Easy-Sandbox/python-sdk)（见 [Python SDK](#python-sdk)）。
兼容 **E2B 协议**，同时扩展了阿里云生态能力（OSS、VPC、自定义域名）。

---

## 特性

- **CLI (`ebx`)** —— 创建、查看、执行、上传/下载、部署，从终端管理沙箱。
- **模板系统** —— 可复用的沙箱镜像（Python、Node、浏览器自动化、AI Agent Harness……）。
- **MCP Server** —— 将沙箱操作暴露为 MCP 工具，供 LLM Agent 调用。
- **Agent Skill** —— 静态 Agent Skills 指南（[`SKILL.md`](SKILL.md)），适用于 Qoder、Claude Code、Cursor、Qwen Code、Codex。
- **随处可跑** —— Node.js >= 20（npm / `npx`），或无需任何运行时的独立二进制。

SDK 侧特性（异步优先的 `Sandbox` API、`run` / `run_code` / `custom` 三种执行原语、`@sandbox` 声明式装饰器、会话持久化、E2B 兼容层）见 [Python SDK](#python-sdk) 一节。

## 安装

需要 **Node.js >= 20**。

```bash
# 从 npm 全局安装
npm install -g @easy-sandbox/cli

# 或免安装直接运行
npx @easy-sandbox/cli --help
```

### 独立二进制（无需 Node.js）

`ebx` 同时以**预编译独立二进制**形式发布，覆盖 macOS（Apple Silicon / Intel）、
Linux（x64 与 arm64）与 Windows（x64，`.exe`）—— **无需安装 Node.js 环境**。二进制文件随每个
版本发布在 [GitHub Releases](https://github.com/Easy-Sandbox/easy-sandbox/releases)。

macOS / Linux（把 `0.3.0` 换成目标版本，`OS` 与 `ARCH` 自动检测）：

```bash
VERSION=0.3.0
OS=$(uname -s | tr '[:upper:]' '[:lower:]')   # darwin 或 linux
ARCH=$(uname -m); case "$ARCH" in
  x86_64) ARCH=x64 ;;
  arm64|aarch64) ARCH=arm64 ;;
esac

# 先下载到当前用户可写的目录，再安装到 PATH 上。
curl -fsSL -o "$HOME/ebx" \
  "https://github.com/Easy-Sandbox/easy-sandbox/releases/download/v${VERSION}/ebx-${VERSION}-${OS}-${ARCH}"
chmod +x "$HOME/ebx"
sudo mv "$HOME/ebx" /usr/local/bin/ebx
```

Windows（PowerShell）：

```powershell
$VERSION = "0.3.0"
$asset = "ebx-$VERSION-windows-x64.exe"

# 下载 Release 资产
Invoke-WebRequest `
  -Uri "https://github.com/Easy-Sandbox/easy-sandbox/releases/download/v$VERSION/$asset" `
  -OutFile $asset

# 移动到 PATH 中的目录（不存在则先创建）
$installDir = "$env:LOCALAPPDATA\Programs\ebx"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Move-Item $asset "$installDir\ebx.exe"
```

校验和、完整平台矩阵与二进制/npm 对比详见 [二进制安装](docs/zh/guide/binary-installation.md)（[English](docs/en/guide/binary-installation.md)）。

## 配合 AI 编码工具使用

仓库内置静态 Agent Skills 指南（[`SKILL.md`](SKILL.md)），教 Qoder、Claude Code、Cursor、Qwen Code、Codex 等工具如何操作 Easy Sandbox——**可先于（或无需）`ebx` CLI 安装**：

```bash
# 快捷方式（需 Node.js）；把 qoder 换成 claude-code / cursor / qwen-code / codex，
# 加 -g 安装到用户级，加 --list 仅预览
npx skills add easy-sandbox/easy-sandbox --skill easy-sandbox -a qoder -y
```

没有 Node.js？把 `SKILL.md` 复制到你的工具技能目录（例如 `~/.qoder/skills/easy-sandbox/SKILL.md`）。完整工具目录矩阵、版本锁定、升级、卸载与安全提示见 [Agent Skill 安装与分发](docs/zh/guide/agent-skill-installation.md)（[English](docs/en/guide/agent-skill-installation.md)）。

## CLI (`ebx`)

```bash
# 配置凭证
ebx config set sandbox_api_key <YOUR_API_KEY>

# 沙箱生命周期
ebx create --template python-base       # 创建沙箱
ebx list                                 # 列出运行中的沙箱
ebx info <sandbox-id>                    # 查看沙箱详情
ebx exec <sandbox-id> "echo hello"       # 执行 Shell 命令
ebx connect <sandbox-id>                 # 交互式 Shell

# 文件传输
ebx upload <sandbox-id> ./local.txt /remote/path.txt
ebx download <sandbox-id> /remote/path.txt ./local.txt

# 模板管理
ebx template list                        # 列出模板
ebx template info python-base            # 模板详情
ebx install owner/repo                   # 从 GitHub 安装

# 模板部署（阿里云模板 API，已内置于 CLI）
ebx template create registry.cn-hangzhou.aliyuncs.com/ns/repo:tag --name my-tpl
ebx template deploy ./examples/templates/python-hello \
    --acr-namespace my-ns --acr-repo python-hello

# 模板生命周期：编写 -> 发布 -> 启动
ebx template init --adopt ./app --hint "端口 8080"     # 1a. 适配已有项目
ebx template init "一个 Python Web 服务"               # 1b. AI 生成 ./<name>/（可选）
ebx deploy ./app --acr-namespace my-ns                 # 2. 构建、推送 ACR、注册（无需 LLM）
ebx create --template <TEMPLATE_ID>                    # 3. 启动沙箱

# MCP 服务
ebx mcp start                            # 启动 MCP 工具服务

# 清理
ebx kill <sandbox-id>
```

> **环境变量：** envd 使用直接执行（direct exec）—— Shell 特性（`$VAR` 展开、管道、重定向）需要 `sh -c '...'`。用 `printenv VAR` 读取变量值。详见[环境变量指南（中文）](docs/zh/guide/environment-variables.md) | [Environment Variables (EN)](docs/en/guide/environment-variables.md)。

## 模板

官方与社区模板统一维护在
[`Easy-Sandbox/awesome-templates`](https://github.com/Easy-Sandbox/awesome-templates)
仓库——模板内容、索引与发布的唯一真源。通过远程索引发现与安装：

```bash
# 通过远程索引发现模板
$ ebx template search web
Name      Description       Tags           Status
node-web  Node.js web app   nodejs, web    official

$ ebx template install node-web                                        # 按索引名安装
$ ebx template install Easy-Sandbox/awesome-templates//node-web@v1.0.0 # 或锁定版本
```

[`examples/templates/`](https://github.com/Easy-Sandbox/python-sdk/tree/main/examples/templates)（位于 `python-sdk` 仓库）仅保留一个最小的 `python-hello`
**测试夹具（fixture）**用于离线测试，并非模板发布真源。夹具契约与索引行为
（缓存、离线回退、锁定版本）详见 [examples/templates/README.md](https://github.com/Easy-Sandbox/python-sdk/blob/main/examples/templates/README.md)。

## Python SDK

Python SDK —— 异步优先的 `Sandbox` API、`@sandbox` 声明式装饰器、会话持久化、E2B 兼容层，以及其分层架构 —— 位于 [`python-sdk` 仓库](https://github.com/Easy-Sandbox/python-sdk)。快速开始、执行 API（`sandbox.run()` / `sandbox.run_code()` / `sandbox.custom()`）与架构文档均在该仓库维护。

```bash
# 客户端 SDK（import easy_sandbox）
pip install easy-sandbox

# 模板镜像内使用的服务端运行时（import easy_sandbox.server）
pip install easy-sandbox-server
```

`easy-sandbox-server` 是容器内运行时：模板的 Dockerfile 与 `commands.py` 通过 `pip install easy-sandbox-server` 安装它。`ebx` CLI 不再随 Python 包发布（不存在 `[cli]` extra），请使用 `npm install -g @easy-sandbox/cli` 安装。

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
| 自带 Agent（BYO）集成 | [自带 Agent（BYO）集成](docs/zh/guide/byo-agent-integration.md) |
| Agent Skill 安装与分发 | [Agent Skill 安装与分发](docs/zh/guide/agent-skill-installation.md) |
| MCP 集成 | [MCP 集成](docs/zh/guide/mcp-integration.md) |
| 故障排查 | [故障排查](docs/zh/guide/troubleshooting.md) |

### 参考手册

| 文档 | 链接 |
|------|------|
| CLI 参考 | [CLI 参考](docs/zh/reference/cli-reference.md) |
| 配置说明 | [配置说明](docs/zh/reference/configuration.md) |
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

Python SDK、沙箱内 Server SDK 与共享的平台契约的文档位于 [`python-sdk` 仓库](https://github.com/Easy-Sandbox/python-sdk)：[文档中心](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/zh/README.md)、[SDK 使用](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/zh/guide/sdk-usage.md)、[架构设计](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/zh/design/architecture.md)、[SDK API 设计](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/zh/design/sdk-api-design.md)、[模板系统](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/zh/design/template-system.md)、[Template YAML 规范](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/zh/reference/template-yaml-spec.md)、[声明式用法](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/zh/guide/declarative-usage.md)、[会话持久化](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/zh/guide/session-persistence.md)、[从 E2B 迁移](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/zh/guide/migrate-from-e2b.md) 与 [`examples/`](https://github.com/Easy-Sandbox/python-sdk/tree/main/examples)。

### 其他资源

| 资源 | 链接 |
|------|------|
| 更新日志 | [CHANGELOG.md](CHANGELOG.md) |
| 贡献指南 | [CONTRIBUTING.md](.github/CONTRIBUTING.md) |
| 许可证 | [Apache-2.0](LICENSE) |

## 与 Python 版 CLI 的差异

此前 CLI 随 Python 包一起发布（`pip install "easy-sandbox[cli]"`），现为独立的 Node.js / TypeScript 包。
下表差异均由此切换所必然引起且为有意为之；**其余一切——命令、参数、输出、退出码、配置及文件位置——均保持一致**。

| 方面 | Python 版 CLI（此前） | Node.js 版 CLI（现在） |
|------|----------------------|------------------------|
| 实现语言 | Python 3.10+（Click / Rich） | Node.js >= 20 上的 TypeScript（ESM） |
| 安装渠道 | `pip install "easy-sandbox[cli]"` | `npm install -g @easy-sandbox/cli` / `npx @easy-sandbox/cli` |
| 独立二进制 | PyInstaller | Node SEA（esbuild 打包 + 单可执行文件）；Release 资产名不变 `ebx-{version}-{os}-{arch}[.exe]` |
| 软件包 | PyPI 上的 `easy-sandbox`（`[cli]`、`[alicloud]` extras） | npm 上的 `@easy-sandbox/cli`（已含阿里云模板 API，无 extras） |
| 仓库 | 与 SDK 同一仓库 | 本仓库；Python SDK 已迁至 [`python-sdk` 仓库](https://github.com/Easy-Sandbox/python-sdk) |

## 贡献

欢迎贡献！请阅读 [贡献指南](.github/CONTRIBUTING.md) 了解详情。

## 许可证

[Apache-2.0](LICENSE) —— 版权信息见 [`NOTICE`](NOTICE)。
