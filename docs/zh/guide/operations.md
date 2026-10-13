# 操作指南

二进制注册五个命令组：`sandbox`、`template`、`config`、`mcp`、`provider`。`deploy` 是顶层快捷方式，不是命令组。每一行是做这件事时要运行的那一条命令。旗标、退出码和完整选项在链接的参考里。

顶层名字 `abx create`、`list`、`info`、`kill`、`exec`、`connect`、`upload`、`download`、`run`、`deploy` 是一组固定的快捷方式，在 `abx --help` 的 **Sandbox shortcuts** 下列出。每一个都和组里的那条命令是同一个命令（`abx create` 就是 `abx sandbox create`）。它们不能被配置。见 [CLI 命令参考](../reference/cli-commands.md)。

`abx <组> -h` 打印该组的命令。

## `sandbox` — 正在运行的沙箱

| 要做的事 | 命令 | 参考 |
|---|---|---|
| 用模板创建沙箱 | `abx create --template base` | [abx create](../reference/cli-reference.md#abx-create) |
| 用一句话创建（先生成模板，再创建沙箱） | `abx create "一个带 pandas 的 Python 环境"` | [abx create](../reference/cli-reference.md#abx-create) |
| 列出沙箱 | `abx list` | [abx list](../reference/cli-reference.md#abx-list) |
| 查看一个沙箱 | `abx info <SANDBOX_ID>` | [abx info](../reference/cli-reference.md#abx-info) |
| 销毁沙箱 | `abx kill <SANDBOX_ID>` | [abx kill](../reference/cli-reference.md#abx-kill) |
| 运行一条命令 | `abx exec <SANDBOX_ID> -- echo hello` | [abx exec](../reference/cli-reference.md#abx-exec) |
| 打开交互式 shell | `abx connect <SANDBOX_ID>` | [abx connect](../reference/cli-reference.md#abx-connect) |
| 把文件拷进去 | `abx upload <SANDBOX_ID> <本地> <远程>` | [abx upload](../reference/cli-reference.md#abx-upload) |
| 把文件拷出来 | `abx download <SANDBOX_ID> <远程> <本地>` | [abx download](../reference/cli-reference.md#abx-download) |
| 列出 / 运行注册在沙箱内服务器上的命名命令 | `abx sandbox command list <SANDBOX_ID>` / `abx run <SANDBOX_ID> <NAME>` | [具名命令](../reference/cli-reference.md#具名命令) |
| 列出沙箱内的文件 | `abx sandbox files list <SANDBOX_ID> --path /app` | [sandbox files](../reference/cli-reference.md#abx-sandbox-files--文件操作) |
| 列出进程 | `abx sandbox process list <SANDBOX_ID>` | [sandbox process](../reference/cli-reference.md#abx-sandbox-process--进程查看) |
| 读取主机指标与环境 | `abx sandbox system info <SANDBOX_ID>` | [sandbox system](../reference/cli-reference.md#abx-sandbox-system--系统信息) |
| 查看哪些能力组开着 | `abx sandbox capabilities <SANDBOX_ID>` | [sandbox capabilities](../reference/cli-reference.md#abx-sandbox-capabilities--能力组状态) |
| 实时输出 / 后台启动 | `abx exec <SANDBOX_ID> --stream -- CMD` / `abx exec <SANDBOX_ID> --background -- CMD` | [abx exec](../reference/cli-reference.md#abx-exec) |

`files` 还有 `stat`、`mkdir`、`rm`、`mv`、`search`。`process` 还有 `info`、`signal`。`system` 还有 `env`、`ports`、`packages`、`metrics`。同一页列出了这些子命令。

## `template` — 本地工程与云端模板

| 要做的事 | 命令 | 参考 |
|---|---|---|
| 脚手架生成一个模板目录 | `abx template init -t python ./my-template` | [template init](../reference/cli-reference.md#abx-template-init) |
| 用一句话写出模板文件，然后停 | `abx template init "一个 Python 数据分析环境"` | [template init](../reference/cli-reference.md#abx-template-init) |
| 给已有源码的项目补上模板文件 | `abx template init --adopt .` | [template init](../reference/cli-reference.md#abx-template-init) |
| 构建、推送并注册 | `abx template deploy ./my-template` | [template deploy](../reference/cli-reference.md#abx-template-deploy) |
| 只构建镜像 | `abx template build ./my-template` | [template build](../reference/cli-reference.md#abx-template-build) |
| 推送镜像 | `abx template push <IMAGE>` | [template push](../reference/cli-reference.md#abx-template-push) |
| 注册已经在仓库里的镜像 | `abx template create <IMAGE> --name <NAME>` | [template create](../reference/cli-reference.md#abx-template-create) |
| 搜索目录 | `abx template search pandas` | [template search](../reference/cli-reference.md#abx-template-search) |
| 安装目录里的模板 | `abx template install python-hello` | [template install](../reference/cli-reference.md#abx-template-install) |
| 列出已注册的模板 | `abx template list` | [template list](../reference/cli-reference.md#abx-template-list) |
| 查看一个模板 | `abx template info <NAME>` | [template info](../reference/cli-reference.md#abx-template-info) |
| 删除模板 | `abx template delete <NAME>` | [template delete](../reference/cli-reference.md#abx-template-delete) |

没有顶层 `abx init` 或 `abx install`；请使用 `abx template init` 与 `abx template install`。

## `deploy` — 构建、推送、注册的快捷方式

| 要做的事 | 命令 | 参考 |
|---|---|---|
| 部署当前目录 | `abx deploy` | [abx deploy](../reference/cli-reference.md#部署命令--abx-deploy) |
| 部署你指定的目录 | `abx deploy ./my-template` | [abx deploy](../reference/cli-reference.md#部署命令--abx-deploy) |

这和 `abx template deploy` 是同一条流水线。它注册为快捷方式（`deploy`），不是第六个命令组。

## `config` — 这台机器上的键

| 要做的事 | 命令 | 参考 |
|---|---|---|
| 引导式初次配置 | `abx config init` | [config init](../reference/cli-reference.md#abx-config-init) |
| 保存一个键 | `abx config set llm_model qwen3-coder-plus` | [config set](../reference/cli-reference.md#abx-config-set) |
| 读取一个键 | `abx config get region` | [config get](../reference/cli-reference.md#abx-config-get) |
| 显示每个键及其来源 | `abx config list` | [config list](../reference/cli-reference.md#abx-config-list) |
| 删掉一个已保存的值 | `abx config delete acr_namespace` | [config delete](../reference/cli-reference.md#abx-config-delete) |
| 查看当前配置名 | `abx config list` | [提供商 — 凭证与配置键](providers.md#凭证与配置键) |

没有 `abx config reset`。清掉一个键用 `abx config delete <KEY>` 或 `abx config set <KEY> ""`。

## `mcp` — IDE 代理工具

| 要做的事 | 命令 | 参考 |
|---|---|---|
| 写出 IDE 配置片段 | `abx mcp install` | [mcp install](../reference/cli-reference.md#abx-mcp-install) |
| 运行 stdio 服务 | `abx mcp start` | [mcp start](../reference/cli-reference.md#abx-mcp-start) |
| 停掉本 CLI 启动的服务 | `abx mcp stop` | [mcp stop](../reference/cli-reference.md#abx-mcp-stop) |
| 查看是否在运行 | `abx mcp status` | [mcp status](../reference/cli-reference.md#abx-mcp-status) |
| 部署 HTTP MCP 应用 | `abx mcp deploy` | [mcp deploy](../reference/cli-reference.md#abx-mcp-deploy) |

## `provider` — 沙箱后端

安装了插件，或把非内置提供者设成默认之后，这个组才会出现在 `abx --help` 里。命令本身一直可以调用。它们写在[提供商](providers.md)；命令参考不再重复。

| 要做的事 | 命令 | 参考 |
|---|---|---|
| 查看内置和已安装的提供者 | `abx provider list` | [安装、查看、移除](providers.md#安装查看移除) |
| 开发时安装本地目录 | `abx provider install ./my-cloud --link --yes` | [编写提供商](authoring-providers.md#3-开发与验证) |
| 从 git 安装并钉住 commit | `abx provider install <git-url> --ref <40 位十六进制>` | [编写提供商 — 从 git 安装](authoring-providers.md#4-发布并从-git-安装) |
| 查看用户将要同意的清单 | `abx provider info <id>` | [安装、查看、移除](providers.md#安装查看移除) |
| 把一个提供者设成默认 | `abx provider default <id>` | [选择提供商](providers.md#选择提供商) |
| 检查清单、配置和握手 | `abx provider doctor <id>` | [安装、查看、移除](providers.md#安装查看移除) |
| 跑契约测试 | `abx provider test <id>` | [安装、查看、移除](providers.md#安装查看移除) |
| 让这一条沙箱命令使用该提供者 | `abx --provider <id> create --template base` | [选择提供商](providers.md#选择提供商) |

何时使用 `--provider`、`--model`、`llm_model`，以及何时安装独立二进制，见[最佳实践](best-practices.md)。
