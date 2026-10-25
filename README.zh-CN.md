# Agent Sandbox

[English](README.md) | **中文**

[标准 E2B 迁移契约](docs/zh/guide/migrate-from-e2b.md)

<!-- badges -->
[![CI](https://github.com/alibaba-agent-sandbox/agent-sandbox/actions/workflows/ci.yml/badge.svg)](https://github.com/alibaba-agent-sandbox/agent-sandbox/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@agent-sandbox/cli)](https://www.npmjs.com/package/@agent-sandbox/cli)
[![Node 20+](https://img.shields.io/node/v/@agent-sandbox/cli)](https://www.npmjs.com/package/@agent-sandbox/cli)
[![License](https://img.shields.io/github/license/agent-sandbox/agent-sandbox)](LICENSE)

> 为 AI Agent 打造的云沙箱 —— 秒级创建、执行、管理隔离环境。

**Agent Sandbox** 是命令行工具（`abx`）。默认提供方是阿里云极速版（`alicloud-express`）。CLI 还会加载已安装的 `node`、`exec` 和 `rest` 插件。目录提供方 `opensandbox`、`alicloud-container`、`cubesandbox` 和 `e2b` 都是 `node` 插件：导出 `create(kit)` 的 ES 模块 `provider.mjs`。用 `abx provider install alibaba-agent-sandbox/awesome-providers//<id>` 安装（本地路径或 git URL 也可以），再用 `abx --provider <id>` 运行。既不是内置也未安装的 id 以 `E8001` 退出。`runtime.kind = "python"` 的清单不能安装。Python SDK 里以代码方式构造的 `Provider` 子类仍然可用；SDK 通过本机引擎（`abx provider engine serve`；`abx` 在 `PATH` 上或由 `ABX_BIN` 指定）使用同一批 `node` 插件。`exec`（stdio 上的 EPP/1，任意语言，可选 `pty.*`）留给第三方插件。
Python SDK 位于 [`python-sdk` 仓库](https://github.com/alibaba-agent-sandbox/python-sdk)（见 [Python SDK](#python-sdk)）。
模板的构建和部署在这个 CLI 里。运行时客户端是 Python SDK。那边的方法名接近 E2B，便于迁移；标准 CLI 与 SDK 遵循阿里云支持版本的 E2B 行为契约，后端条件能力见[迁移指南](docs/zh/guide/migrate-from-e2b.md)。


模板整体启动：`abx --provider PROVIDER template launch TEMPLATE --yes`。spec v5 删除 workflow 选择，返回全部声明的服务。spec v5 需要 CLI 0.5.1 或更新版本；CLI 与模板目录需同步升级。见[启动与迁移](docs/zh/guide/template-workflows.md)。

自然语言创建极速版模板时，`--build steps` 的提供方准备和最终源码传输由 CLI 确定性组装，模型负责业务代码与依赖安装命令。新生成的应用安装 server `0.4.0a1` alpha。见[自然语言创建](docs/zh/guide/using-templates.md)。

## 网站

| 网站 | 地址 |
|---|---|
| 官网 | https://www.agent-sandbox.cn |
| 提供方注册站 | https://registry.agent-sandbox.cn |

CLI 从 git 树 `alibaba-agent-sandbox/awesome-providers//<id>` 安装这些目录提供方。Python SDK 安装器（`python -m agent_sandbox.providers install registry:<id> --yes`）拉取 `https://registry.agent-sandbox.cn/providers/index.json`。`ABX_PROVIDER_REGISTRY` 可以改 SDK 安装器使用的这个地址。

---

## 特性

- **CLI (`abx`)** —— 创建、查看、执行、上传/下载、部署，从终端管理沙箱。
- **模板系统** —— 可复用的沙箱镜像（Python、Node、浏览器自动化、AI Agent Harness……）。
- **MCP Server** —— 将沙箱操作暴露为 MCP 工具，供 LLM Agent 调用。
- **Agent Skill** —— 静态 Agent Skills 指南（[`SKILL.md`](SKILL.md)），适用于 Qoder、Claude Code、Cursor、Qwen Code、Codex。
- **独立二进制，或 Node.js >= 20 从源码构建** —— Release 二进制不需要 Node.js。npm 安装需要 Node.js 20+。

SDK 侧特性（同步 `Sandbox`／异步 `AsyncSandbox` API、`run` / `run_code` 执行原语、`@sandbox` 声明式装饰器、会话持久化、E2B 兼容层）见 [Python SDK](#python-sdk) 一节。

## 安装

### macOS 与 Linux

```bash
curl -fsSL https://www.agent-sandbox.cn/install.sh | sh
```

### Windows（PowerShell）

```powershell
irm https://raw.githubusercontent.com/Alibaba-Agent-Sandbox/agent-sandbox/main/install.ps1 | iex
```

macOS/Linux 下载二进制时会在终端显示进度条和百分比；重定向日志时保持简洁。

安装脚本会选择 `darwin-arm64`、`darwin-x64`、`linux-arm64`、`linux-x64` 或 `windows-x64`，校验 `.sha256`，并且不需要 `sudo`。macOS 和 Linux 在 `/usr/local/bin` 可写时装到那里，否则装到 `$HOME/.local/bin`。Windows 装到 `%LOCALAPPDATA%\Programs\abx`，并把它加到用户 `PATH`。`ABX_INSTALL_DIR` 选择目录。macOS/Linux 官网安装入口默认使用最新已完整镜像的版本，从官网域名下载二进制和校验文件，无需访问 GitHub 查询版本。[镜像清单](https://www.agent-sandbox.cn/releases/latest.json) 列出可用版本及文件。`ABX_VERSION` 选择版本；显式指定较早版本时仍默认从 GitHub 下载。`ABX_DOWNLOAD_BASE` 可覆盖产物下载前缀。Windows PowerShell 安装脚本仍使用 GitHub。

官网从完整稳定版 GitHub Release 复制五个平台的二进制、npm 归档及 SHA-256 文件，大小和校验和验证通过后才发布。新版本在镜像部署完成后成为官网默认版本。请用 `abx --version` 确认安装版本，模板目录建议使用 CLI 0.5.1 或更新版本。

### 手动下载

从官网镜像 `https://www.agent-sandbox.cn/releases/download/v<version>/`（版本及文件见[清单](https://www.agent-sandbox.cn/releases/latest.json)）或 [GitHub Releases](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/releases) 下载 `abx-<version>-<os>-<arch>[.exe]` 和对应的 `.sha256`，校验摘要后，以 `abx` 为名放到 `PATH` 上。命令、校验和与平台表见 [二进制安装](docs/zh/guide/binary-installation.md)（[English](docs/en/guide/binary-installation.md)）。

发行包内嵌极速版 SDK，可脱离源码目录使用。交付件验证及 `abx --licenses` 归属信息见安装指南。

### npm（Node.js 20+）

先检查公开版本，再安装：

```bash
npm view @agent-sandbox/cli version --registry=https://registry.npmjs.org
npm install -g @agent-sandbox/cli --registry=https://registry.npmjs.org
abx --version
```

官方索引返回 HTTP404 表示该入口暂时无法提供这个包；PR合并或构建成功并不代表已经发布。索引可读前使用二进制或源码安装。如果全局目录不可写，可用 `npm install -g --prefix "$HOME/.local" @agent-sandbox/cli`，并将 `$HOME/.local/bin` 加到 PATH；这种方式不需要 sudo。

### 从源码安装

需要 Node.js 20 或更新版本，直接构建并安装当前检出版本：

```bash
git clone https://github.com/Alibaba-Agent-Sandbox/agent-sandbox.git
cd agent-sandbox
npm ci
npm run build
npm install --global --prefix "$HOME/.local" .
export PATH="$HOME/.local/bin:$PATH"
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
abx create base --detach  # 默认模板
abx create python-base --detach  # 目录里的 Python 镜像
abx list                                 # 列出运行中的沙箱
abx info <sandbox-id>                    # 查看沙箱详情
abx exec <sandbox-id> echo hello       # 执行命令（--cwd/--env/--background 放在 ID 前）
abx run <sandbox-id> <name> --arg k=v    # 调用沙箱内服务器上注册的具名命令
abx connect <sandbox-id>                 # 真实 PTY；shell 状态持续（每行一个新进程，不是 PTY）

# 文件传输
abx upload <sandbox-id> ./local.txt /remote/path.txt
abx download <sandbox-id> /remote/path.txt ./local.txt

# 模板管理
abx template list                        # 列出模板
abx template info python-base            # 模板详情
abx template install owner/repo          # 从 GitHub 安装

# 模板部署（阿里云模板 API，已内置于 CLI）
abx template from-image registry.cn-hangzhou.aliyuncs.com/ns/repo:tag --name my-tpl
abx template deploy ./examples/templates/python-hello \
    --acr-namespace my-ns --acr-repo python-hello

# 模板生命周期：编写 -> 发布 -> 启动
abx template scaffold --adopt ./app --hint "端口 8080"     # 1a. 适配已有项目
abx template scaffold "一个 Python Web 服务"               # 1b. 模板生成写出 ./<name>/（可选）
abx deploy ./app --acr-namespace my-ns                 # 2. 构建、推送 ACR、注册（无需 LLM）
abx create <TEMPLATE_ID> --detach  # 3. 启动沙箱

# MCP 服务
abx mcp start                            # 启动 MCP 工具服务

# 清理
abx kill <sandbox-id>
```

`abx --help` 会先说明每个快捷命令的用途，再以 `(alias: abx …)` 备注对应的完整命令。

更多模板可浏览 [Registry](https://registry.agent-sandbox.cn/templates/)。`provider` 与其他命令组一起列出。
新项目先运行 `abx template scaffold --template python ./my-template`，再运行 `abx deploy ./my-template`。
构建或部署目录不存在时，可确认创建后继续；`-y` 或 CI 模式会自动创建 Python 模板项目并继续。已有项目保持原样；生成脚手架时覆盖已有条目仍须确认，`-y` 本身不授权覆盖。
部署后使用 `abx create TEMPLATE --detach` 创建沙箱。

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

Python SDK —— 同步 `Sandbox`／异步 `AsyncSandbox` API、`@sandbox` 声明式装饰器、会话持久化、E2B 兼容层，以及其分层架构 —— 位于 [`python-sdk` 仓库](https://github.com/alibaba-agent-sandbox/python-sdk)。快速开始、执行 API（`sandbox.commands.run()` / `sandbox.run_code()` / `sandbox.run()`）与架构文档均在该仓库维护。

```bash
# 客户端 SDK（import agent_sandbox）
python -m pip install \
  "agent-sandbox-server @ https://github.com/Alibaba-Agent-Sandbox/python-sdk/archive/cceb318d58fad0096def8809165d6646029a35e2.tar.gz#subdirectory=server-sdk" \
  "agent-sandbox-client @ https://github.com/Alibaba-Agent-Sandbox/python-sdk/archive/cceb318d58fad0096def8809165d6646029a35e2.tar.gz#subdirectory=client-sdk"

# 模板镜像内使用的服务端运行时（import agent_sandbox.server）
python -m pip install "agent-sandbox-server @ https://github.com/Alibaba-Agent-Sandbox/python-sdk/archive/cceb318d58fad0096def8809165d6646029a35e2.tar.gz#subdirectory=server-sdk"
```

`agent-sandbox-server` 是容器内运行时：模板的 Dockerfile 与 `commands.py` 通过 [paired source installation](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/en/guide/install-python.md) 安装它。`abx` CLI 不再随 Python 包发布（不存在 `[cli]` extra）。请用[二进制安装脚本](docs/zh/guide/binary-installation.md)安装。npm 官方元数据可读后再使用上述 npm 安装方式。

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
| Provider 操作帮助与执行 | [帮助、默认值、JSON 输入与更新](docs/zh/guide/provider-commands.md) |
| 编写提供商 | [编写提供商](docs/zh/guide/authoring-providers.md) |
| 二进制安装 | [二进制安装](docs/zh/guide/binary-installation.md) |
| CLI 教程 | [CLI 教程](docs/zh/guide/cli-tutorial.md) |
| 认证配置 | [认证配置](docs/zh/guide/authentication.md) |
| 配置引导 | [就地补填、自动化与安全继续](docs/zh/guide/guided-configuration.md) |
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


## 发布就绪范围

CLI 0.5.1 修复公开目录原生模板名称解析，并保证模板启动的 JSON 输出可直接解析。请分别核对 GitHub 资产与 npm 元数据；已发布的版本标签和包保持不变。见[公开发行验证](.agents/evidence/verify/2026-10-25-cli-051-public-release.md)。

运行证据对应实际测试的模板与平台组合。发行记录明确说明 CLI 交付件及极速版内置 base 的实测范围；各模板文档说明其平台要求和服务 API。维护中的公开站点是[官网](https://www.agent-sandbox.cn)和[Registry](https://registry.agent-sandbox.cn)。

[自动准备并启动目录模板，无需复制云 ID](docs/zh/guide/template-launch.md).

暂停/恢复和快照命令由 Provider 注册，CLI 与 SDK 共用实现，见[注册与使用说明](docs/zh/guide/provider-commands.md)。

原生极速版模板清单与平台 step 验收从 CLI0.4.1 起可使用首个全局选项 `abx --native`，参见[原生部署操作](docs/zh/guide/deploy-and-build.md#显式原生极速版入口)。

Current API / 当前接口: [development contract](docs/zh/guide/current-api.md).
