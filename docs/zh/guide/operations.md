# 操作指南

二进制注册五个命令组：`sandbox`、`template`、`config`、`mcp`、`provider`。`deploy` 是顶层快捷方式，不是命令组。每一行是做这件事时要运行的那一条命令。旗标、退出码和完整选项在链接的参考里。

`ebx create`、`ebx install` 这类顶层名字是快捷方式。它们和组里的那条命令是同一个对象（`ebx create` 就是 `ebx sandbox create`）。在 `~/.ebx/config.toml` 的 `[shortcuts]` 里可以改映射。见[快捷方式别名](../reference/cli-reference.md#快捷方式别名shortcutsalias)。

`ebx <组> -h` 打印该组的命令。

## `sandbox` — 正在运行的沙箱

| 要做的事 | 命令 | 参考 |
|---|---|---|
| 用模板创建沙箱 | `ebx create --template base` | [ebx create](../reference/cli-reference.md#ebx-create) |
| 用一句话创建（先生成模板，再创建沙箱） | `ebx create "一个带 pandas 的 Python 环境"` | [ebx create](../reference/cli-reference.md#ebx-create) |
| 列出沙箱 | `ebx list` | [ebx list](../reference/cli-reference.md#ebx-list) |
| 查看一个沙箱 | `ebx info <SANDBOX_ID>` | [ebx info](../reference/cli-reference.md#ebx-info) |
| 销毁沙箱 | `ebx kill <SANDBOX_ID>` | [ebx kill](../reference/cli-reference.md#ebx-kill) |
| 运行一条 shell 命令 | `ebx exec <SANDBOX_ID> "echo hello"` | [ebx exec](../reference/cli-reference.md#ebx-exec) |
| 打开交互式 shell | `ebx connect <SANDBOX_ID>` | [ebx connect](../reference/cli-reference.md#ebx-connect) |
| 把文件拷进去 | `ebx upload <本地> <SANDBOX_ID>:<远程>` | [ebx upload](../reference/cli-reference.md#ebx-upload) |
| 把文件拷出来 | `ebx download <SANDBOX_ID>:<远程> <本地>` | [ebx download](../reference/cli-reference.md#ebx-download) |
| 运行模板里的命名命令 | `ebx run <SANDBOX_ID> <NAME>` | [ebx run](../reference/cli-reference.md#ebx-run) |
| 列出沙箱内的文件 | `ebx sandbox files list <SANDBOX_ID> --path /app` | [sandbox files](../reference/cli-reference.md#ebx-sandbox-files--文件操作) |
| 列出进程 | `ebx sandbox process list <SANDBOX_ID>` | [sandbox process](../reference/cli-reference.md#ebx-sandbox-process--进程管理) |
| 读取主机指标与环境 | `ebx sandbox system info <SANDBOX_ID>` | [sandbox system](../reference/cli-reference.md#ebx-sandbox-system--系统信息) |
| 查看哪些能力组开着 | `ebx sandbox capabilities <SANDBOX_ID>` | [sandbox capabilities](../reference/cli-reference.md#ebx-sandbox-capabilities--能力组状态) |
| 用 HTTP 流式跑一条 shell | `ebx sandbox shell-stream <SANDBOX_ID> "echo hello"` | [shell-stream](../reference/cli-reference.md#ebx-sandbox-shell-stream--http-流式-shell) |

`files` 还有 `stat`、`mkdir`、`rm`、`mv`、`search`。`process` 还有 `start`、`info`、`signal`。`system` 还有 `env`、`ports`、`packages`、`metrics`。同一页列出了这些子命令。

## `template` — 本地工程与云端模板

| 要做的事 | 命令 | 参考 |
|---|---|---|
| 脚手架生成一个模板目录 | `ebx template init -t python ./my-template` | [template init](../reference/cli-reference.md#ebx-template-init) |
| 用一句话写出模板文件，然后停 | `ebx template init "一个 Python 数据分析环境"` | [template init](../reference/cli-reference.md#ebx-template-init) |
| 给已有源码的项目补上模板文件 | `ebx template init --adopt .` | [template init](../reference/cli-reference.md#ebx-template-init) |
| 构建、推送并注册 | `ebx template deploy ./my-template` | [template deploy](../reference/cli-reference.md#ebx-template-deploy) |
| 只构建镜像 | `ebx template build ./my-template` | [template build](../reference/cli-reference.md#ebx-template-build) |
| 推送镜像 | `ebx template push <IMAGE>` | [template push](../reference/cli-reference.md#ebx-template-push) |
| 注册已经在仓库里的镜像 | `ebx template create <IMAGE> --name <NAME>` | [template create](../reference/cli-reference.md#ebx-template-create) |
| 搜索目录 | `ebx template search pandas` | [template search](../reference/cli-reference.md#ebx-template-search) |
| 安装目录里的模板 | `ebx template install python-hello` | [template install](../reference/cli-reference.md#ebx-template-install) |
| 列出已注册的模板 | `ebx template list` | [template list](../reference/cli-reference.md#ebx-template-list) |
| 查看一个模板 | `ebx template info <NAME>` | [template info](../reference/cli-reference.md#ebx-template-info) |
| 删除模板 | `ebx template delete <NAME>` | [template delete](../reference/cli-reference.md#ebx-template-delete) |

`ebx init` 就是 `ebx template init`。`ebx install` 就是 `ebx template install`。

## `deploy` — 构建、推送、注册的快捷方式

| 要做的事 | 命令 | 参考 |
|---|---|---|
| 部署当前目录 | `ebx deploy` | [ebx deploy](../reference/cli-reference.md#部署命令--ebx-deploy) |
| 部署你指定的目录 | `ebx deploy ./my-template` | [ebx deploy](../reference/cli-reference.md#部署命令--ebx-deploy) |

这和 `ebx template deploy` 是同一条流水线。它注册为快捷方式（`deploy`），不是第六个命令组。

## `config` — 这台机器上的键

| 要做的事 | 命令 | 参考 |
|---|---|---|
| 引导式初次配置 | `ebx config init` | [config init](../reference/cli-reference.md#ebx-config-init) |
| 保存一个键 | `ebx config set llm_model qwen3-coder-plus` | [config set](../reference/cli-reference.md#ebx-config-set) |
| 读取一个键 | `ebx config get region` | [config get](../reference/cli-reference.md#ebx-config-get) |
| 显示每个键及其来源 | `ebx config list` | [config list](../reference/cli-reference.md#ebx-config-list) |
| 删掉一个已保存的值 | `ebx config delete acr_namespace` | [config delete](../reference/cli-reference.md#ebx-config-delete) |
| 列出正在使用的旧名称 | `ebx config check` | [提供商 — 迁移名称](providers.md#发现并迁移旧名称) |
| 把已保存的名称改成规范名 | `ebx config migrate --dry-run` | [提供商 — 迁移名称](providers.md#发现并迁移旧名称) |

没有 `ebx config reset`。清掉一个键用 `ebx config delete <KEY>` 或 `ebx config set <KEY> ""`。

## `mcp` — IDE 代理工具

| 要做的事 | 命令 | 参考 |
|---|---|---|
| 写出 IDE 配置片段 | `ebx mcp install` | [mcp install](../reference/cli-reference.md#ebx-mcp-install) |
| 运行 stdio 服务 | `ebx mcp start` | [mcp start](../reference/cli-reference.md#ebx-mcp-start) |
| 停掉本 CLI 启动的服务 | `ebx mcp stop` | [mcp stop](../reference/cli-reference.md#ebx-mcp-stop) |
| 查看是否在运行 | `ebx mcp status` | [mcp status](../reference/cli-reference.md#ebx-mcp-status) |
| 部署 HTTP MCP 应用 | `ebx mcp deploy` | [mcp deploy](../reference/cli-reference.md#ebx-mcp-deploy) |

## `provider` — 沙箱后端

安装了插件，或把非内置提供者设成默认之后，这个组才会出现在 `ebx --help` 里。命令本身一直可以调用。它们写在[提供商](providers.md)；命令参考不再重复。

| 要做的事 | 命令 | 参考 |
|---|---|---|
| 查看内置和已安装的提供者 | `ebx provider list` | [安装、查看、移除](providers.md#安装查看移除) |
| 开发时安装本地目录 | `ebx provider install ./my-cloud --link --yes` | [编写提供商](authoring-providers.md#3-开发与验证) |
| 从 git 安装并钉住 commit | `ebx provider install <git-url> --ref <40 位十六进制>` | [编写提供商 — 从 git 安装](authoring-providers.md#4-发布并从-git-安装) |
| 查看用户将要同意的清单 | `ebx provider info <id>` | [安装、查看、移除](providers.md#安装查看移除) |
| 把一个提供者设成默认 | `ebx provider default <id>` | [选择提供商](providers.md#选择提供商) |
| 检查清单、配置和握手 | `ebx provider doctor <id>` | [安装、查看、移除](providers.md#安装查看移除) |
| 跑契约测试 | `ebx provider test <id>` | [安装、查看、移除](providers.md#安装查看移除) |
| 让这一条沙箱命令使用该提供者 | `ebx --provider <id> create --template base` | [选择提供商](providers.md#选择提供商) |

何时使用 `--provider`、`--model`、`llm_model`，以及何时安装独立二进制，见[最佳实践](best-practices.md)。
