# Agent Sandbox CLI

**中文** | [English](README.md)

[![CI](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/workflows/ci.yml/badge.svg)](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@agent-sandbox/cli)](https://www.npmjs.com/package/@agent-sandbox/cli)

`abx` 为 AI Agent 创建和管理隔离的云端运行环境。通过终端执行命令、传输文件、连接远程终端，以及启动可复用的应用模板。

默认后端为阿里云极速版（`alicloud-express`），也可以安装[提供方插件](https://github.com/Alibaba-Agent-Sandbox/awesome-providers)使用其他后端。

[官网](https://www.agent-sandbox.cn) · [使用文档](docs/zh/README.md) · [模板目录](https://registry.agent-sandbox.cn/templates/)

> **预览版说明：** Agent Sandbox 目前处于预览阶段，可能会有不兼容变更。预计于 **2026 年 11 月 15 日**发布 **1.0.0 正式版**，敬请期待！

## 安装

以下命令需要当前源码 CLI；已发布的 0.5.10 使用原命令布局。使用 Node.js 20+ 从源码安装：

```bash
git clone https://github.com/Alibaba-Agent-Sandbox/agent-sandbox.git
cd agent-sandbox
npm ci
npm run build
npm link
cd ..
abx --help
```

已发布的 0.5.10 仍可通过 `npm install -g @agent-sandbox/cli@0.5.10` 安装，其命令布局以该版本的 `--help` 为准。

## 快速开始

配置提供方，再创建沙箱：

```bash
abx config init
abx sandbox create --template base --yes
```

极速版需要对应账号和地域的 Sandbox API Key。[凭据与权限指南](docs/zh/guide/permissions.md)说明凭据来源、所需授权，以及可选的 AccessKey 准备方式。交互输入的配置保存在本机，后续命令复用。

后续操作使用创建返回的 Sandbox ID：

```bash
abx sandbox exec SANDBOX_ID -- echo hello
abx status SANDBOX_ID
abx sandbox connect SANDBOX_ID
abx sandbox delete SANDBOX_ID --yes
```

`sandbox connect` 打开远程终端，退出终端后沙箱仍在运行；`delete` 删除沙箱。文件操作、后台进程等用法见 [CLI 教程](docs/zh/guide/cli-tutorial.md)。

## 启动应用模板

如需部署统一 Gateway 地址、每个 Session 独立使用 Sandbox 的 Agents API，请参阅
[托管应用指南](docs/zh/guide/managed-applications.md)。

模板封装浏览器自动化、编码 Agent、Web 服务等工具。从[模板目录](https://registry.agent-sandbox.cn/templates/)选择模板，按其说明准备配置：

```bash
abx template init ./python-hello --from python-hello
cd python-hello
abx deploy . --name hello --yes
python run.py --template TEMPLATE_ID
```

源码模板需要对应提供方的构建环境。deploy 返回准备好的模板资源 ID；将其填入 TEMPLATE_ID，由模板的 run.py 创建实例并启动服务。Python SDK、应用认证和模型配置按模板 README 操作。

结束后使用 `abx sandbox delete SANDBOX_ID --yes` 删除运行实例，再执行 `abx delete hello --yes` 清理拥有的模板；借用的构建产物及需手动清理的镜像保留。配置与资源清理见[模板使用指南](docs/zh/guide/using-templates.md)。

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

## 交流与反馈

欢迎加入 **Agent Sandbox 开发者工具交流群**，交流使用经验、分享建议与反馈。[点击加入钉钉群](https://qr.dingtalk.com/action/joingroup?code=v1,k1,LSusypYdoGm4U0xoz1p1QSlgoBHeoi/kgpsl4uQ8qus=&_dt_no_comment=1&origin=1)，或搜索钉钉群号 **213605001586**。

也可以使用钉钉扫描二维码加入：

<a href="https://qr.dingtalk.com/action/joingroup?code=v1,k1,LSusypYdoGm4U0xoz1p1QSlgoBHeoi/kgpsl4uQ8qus=&amp;_dt_no_comment=1&amp;origin=1"><img src="assets/dingtalk-group.jpg" alt="钉钉交流群二维码" width="235" /></a>

## 参与贡献

开发环境、检查命令和贡献流程见[贡献指南](.github/CONTRIBUTING.md)。CLI 问题请提交到 [Issues](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues)。

## 许可证

[Apache-2.0](LICENSE)，署名信息见 [NOTICE](NOTICE)。
