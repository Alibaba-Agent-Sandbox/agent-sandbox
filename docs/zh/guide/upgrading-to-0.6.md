# 从 CLI 0.5.10 升级到 0.6 预览版本

0.6 预览版本调整了命令布局与自动化授权规则。请显式选择预览版本，并在修改脚本前确认安装结果：

```bash
npm install -g @agent-sandbox/cli@0.6.0-alpha.2 --registry=https://registry.npmjs.org
abx --version
abx --help
```

npm `next` 通道用于预览版本，`latest` 保持 0.5.10。需要可重复执行的自动化时，请固定完整版本号。独立二进制可通过 [GitHub 安装器](binary-installation.md) 指定 `ABX_VERSION=0.6.0-alpha.2`。默认稳定版安装器及官网镜像不会自动选择预览版本。

已下载的 alpha.0 或 alpha.1 二进制请替换为 alpha.2。托管 FC 应用的构建与部署需要 npm 安装及 Node.js 20+；二进制保留 `deploy --plan` 预览。完整要求见[托管应用前置条件](managed-applications.md)。

## 更新命令

| 任务 | 0.6 预览版本命令 |
|---|---|
| 从 Provider 模板创建实例（原 `create`） | `abx create --template TEMPLATE --name demo --yes` |
| 启动目录模板或本地源码模板（原 `template launch`） | `abx deploy TEMPLATE_OR_DIRECTORY --name demo --yes` |
| 查看实例（原 `info`） | `abx status TARGET` |
| 删除实例（原 `kill`） | `abx delete TARGET --yes` |
| 创建本地模板项目（原 `template scaffold`） | `abx template init DIRECTORY` |
| 执行程序 | `abx exec TARGET -- PROGRAM ARGS` |
| 打开终端 | `abx connect TARGET` |
| 传输文件 | `abx upload TARGET LOCAL_PATH REMOTE_PATH` / `abx download TARGET REMOTE_PATH LOCAL_PATH` |
| 管理文件与进程 | `abx files --help` / `abx process --help` |
| 发现 Provider 原生操作 | `abx --provider PROVIDER provider run --help` |

`TARGET` 是已有的 Sandbox ID 或保存在本机的部署名称。平台工具使用根命令。`abx sandbox TARGET --help` 则从显式绑定的本地 OpenAPI 契约发现业务操作；`abx sandbox TARGET OPERATION --help` 查看操作契约，`abx sandbox TARGET OPERATION` 发起调用。绑定方式、支持的输入与鉴权见 [Sandbox API 操作](sandbox-api.md)。调用操作不会创建实例，也不会把未知操作当作 Shell 命令执行。

`app` 命令树、`--native` 解析器选择、`sandbox command list/run` 以及重叠的生命周期别名已移除。托管应用请按照[托管应用指南](managed-applications.md)，通过 `deploy`、`status`、`logs`、`recover`、`delete` 管理。旧 `app` 子命令并非逐项替换关系。`recover` 观察中断操作，不重复创建或发布；重试变更前先检查不确定结果。

已有 Server SDK 装饰器与 HTTP 路由继续使用各自的接口。旧的具名命令调用若要使用新的业务操作 CLI，需要显式绑定 OpenAPI；直接 HTTP 与 SDK 接入仍以应用文档为准。

## alpha.2 新增与修正

声明过的标量参数可以使用 `--id`、`--message` 等直接选项；字段有歧义时，操作帮助会显示带位置前缀的名称。嵌套 JSON 继续使用 `--body @request.json`，管道输入使用 `--body -`。成功的二进制响应可以通过 `--output FILE` 保存，已有文件不会被覆盖。完整 body 与逐字段选项不能混用。

正常模板部署仅在实际服务及端口已验证时复用应用令牌。其他应用仍可显式绑定契约与凭据，详见 [Sandbox API 操作](sandbox-api.md)。

MCP 会话删除会明确报告未完成的清理，客户端可重试同一会话。协议版本请求头必须匹配协商后的受支持版本，详见 [MCP 关闭与重试](mcp-session-shutdown.md)。

## 检查自动化授权

0.5.10 的 `--ci` 可以授权 Express 托管管理 Key 的创建或续期。0.6 预览版本的 `--ci` 用于选择非交互、机器可读输出，**不代表授权变更**。需要确认的操作必须使用自身的显式 `--yes` 选项；云端管理 Key 的创建与续期仍保留该授权要求。非交互执行前须准备凭据及必需配置。

```bash
abx --ci create --template base --name demo --yes
abx --ci status demo
abx --ci delete demo --yes
```

配置项、Sandbox API 凭据、应用令牌与模型凭据分别管理。目标需要哪些配置请参阅[配置引导](guided-configuration.md)及 [Provider 指南](providers.md)。

## 更新运行时时重新构建应用镜像

新生成的 Server SDK 模板使用 `agent-sandbox-server==0.5.0a1`；MCP 应用使用 `agent-sandbox-client[mcp]==0.5.0a1`，无需安装 Server SDK。已有 MCP 应用需要更新客户端依赖并重新部署，才能使用会话清理与协议版本请求头修复。已有 Server SDK 应用要使用文件上传修复，需要更新 `agent-sandbox-server` 依赖并重新构建、部署镜像；单独更新 CLI 不会替换运行中应用的代码。上传与下载接口仍在内存中缓冲 JSON/base64 内容，策略限制见 [Server SDK 文件指南](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/v0.5.0a1/docs/zh/guide/server-sdk.md)。

## 继续使用现有 0.5.10 脚本

在完成脚本迁移前，固定 `@agent-sandbox/cli@0.5.10` 并使用该版本的 `--help`。安装旧版 CLI 不会撤销其他版本已创建的资源或部署记录；请保留创建资源时所用版本及其本机记录，以便清理资源。
