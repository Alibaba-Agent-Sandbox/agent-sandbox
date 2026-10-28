# Agent Sandbox CLI

**中文** | [English](README.md)

[![CI](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/workflows/ci.yml/badge.svg)](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@agent-sandbox/cli)](https://www.npmjs.com/package/@agent-sandbox/cli)

`abx` 为 AI Agent 创建和管理隔离的云端运行环境。通过终端执行命令、传输文件、连接远程终端，以及启动可复用的应用模板。

默认后端为阿里云极速版（`alicloud-express`），也可以安装[提供方插件](https://github.com/Alibaba-Agent-Sandbox/awesome-providers)使用其他后端。

[官网](https://www.agent-sandbox.cn) · [使用文档](docs/zh/README.md) · [模板目录](https://registry.agent-sandbox.cn/templates/)

## 安装

macOS 和 Linux：

```bash
curl -fsSL https://www.agent-sandbox.cn/install.sh | sh
```

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/Alibaba-Agent-Sandbox/agent-sandbox/main/install.ps1 | iex
```

或使用 npm 安装（需要 Node.js 20+）：

```bash
npm install -g @agent-sandbox/cli --registry=https://registry.npmjs.org
abx --version
```

按安装器提示设置 PATH；Windows 安装后需新开终端。支持平台、校验和、版本选择及源码安装见[二进制安装指南](docs/zh/guide/binary-installation.md)。当前应用模板需要 CLI 0.5.8 或更新版本。

## 快速开始

配置提供方，再创建沙箱：

```bash
abx config init
abx create base --detach
```

极速版需要对应账号和地域的 Sandbox API Key。[凭据与权限指南](docs/zh/guide/permissions.md)说明凭据来源、所需授权，以及可选的 AccessKey 准备方式。交互输入的配置保存在本机，后续命令复用。

将下面的 `<sandbox-id>` 替换为创建时返回的 ID：

```bash
abx exec <sandbox-id> echo hello
abx info <sandbox-id>
abx connect <sandbox-id>
abx kill <sandbox-id>
```

`connect` 打开远程终端，退出终端后沙箱仍在运行；`kill` 删除沙箱。文件操作、后台进程等用法见 [CLI 教程](docs/zh/guide/cli-tutorial.md)。

## 启动应用模板

模板封装浏览器自动化、编码 Agent、Web 服务等工具。从[模板目录](https://registry.agent-sandbox.cn/templates/)选择模板，按其说明准备配置：

```bash
abx template search python
abx --provider alicloud-express template launch Alibaba-Agent-Sandbox/awesome-templates//python-hello
```

源码模板需要对应提供方的构建环境。启动命令会运行模板声明的服务，并返回沙箱 ID。CLI 自动生成并在本机保存默认应用认证令牌；使用模型的模板还需配置相应模型凭据。

结束后执行 `abx kill <sandbox-id>`。构建的镜像或模板可能保留以便复用，配置与资源清理见[模板使用指南](docs/zh/guide/using-templates.md)。

## 接入 AI 工具

执行 `abx mcp start`，通过 MCP 暴露沙箱操作。本仓库还提供供 AI 编码工具使用的 [Agent Skill](SKILL.md)。

- [MCP 集成](docs/zh/guide/mcp-integration.md)
- [安装 Agent Skill](docs/zh/guide/agent-skill-installation.md)

## 文档

| 任务 | 指南 |
| --- | --- |
| 配置凭据与默认值 | [交互配置](docs/zh/guide/guided-configuration.md) |
| 选择或安装后端 | [提供方](docs/zh/guide/providers.md) |
| 构建和发布模板 | [编写模板](docs/zh/guide/authoring-templates.md) |
| 查询命令与选项 | [CLI 参考](docs/zh/reference/cli-reference.md) |
| 迁移现有阿里云 E2B CLI 配置 | [迁移指南](docs/zh/guide/migrate-from-e2b.md) |
| 处理运行错误 | [故障排查](docs/zh/guide/troubleshooting.md) |

更多内容见[完整文档索引](docs/README.md)与[更新日志](CHANGELOG.md)。

## Python SDK

在应用代码中控制沙箱，请使用 [Python SDK](https://github.com/Alibaba-Agent-Sandbox/python-sdk)。[Node.js SDK](https://github.com/Alibaba-Agent-Sandbox/nodejs-sdk)用于调用已经启动的沙箱应用服务。

## 参与贡献

开发环境、检查命令和贡献流程见[贡献指南](.github/CONTRIBUTING.md)。CLI 问题请提交到 [Issues](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues)。

## 许可证

[Apache-2.0](LICENSE)，署名信息见 [NOTICE](NOTICE)。
