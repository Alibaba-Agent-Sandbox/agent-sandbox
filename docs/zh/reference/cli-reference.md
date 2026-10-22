# CLI 参考

极速版标准入口遵循阿里云支持的 E2B CLI 2.20.0 行为，协议客户端固定为 2.50.0。完整边界见[迁移指南](../guide/migrate-from-e2b.md)。标准命令参数以固定版本的 --help 为准，下文单独说明项目扩展。

## 命令总览

| 入口 | 用途 |
|---|---|
| `abx sandbox` | 标准生命周期、终端、执行与查询；项目 files/process/system 扩展 |
| `abx template` | 标准 SDK init/create/list；项目 scaffold/from-image/build/deploy/install 扩展 |
| `abx config`、`abx provider`、`abx mcp` | 项目配置、Provider 安装及 MCP 工具 |

`abx config init` 配置凭据；`abx template init` 生成标准 SDK 构建文件，其中 Python 使用 agent_sandbox；`abx template scaffold` 生成项目 template.yaml/server 文件。自然语言明确使用 --prompt。Node SDK 迁移不在本次范围。

## 全局选项

项目扩展按各自帮助支持 --json、--quiet/-q、--verbose、--ci。标准命令使用固定版本自身的参数，例如 list/info --format json；CI=true 不会把标准 stdout 改成项目 JSON 信封。配置 E2B_API_KEY、E2B_API_URL、E2B_DOMAIN，或使用项目配置存储。AK/SK 用于项目镜像管理，标准 E2B 入口需要 API Key。

## 沙箱生命周期命令

### abx create

```bash
abx create [template] --detach --timeout 300
abx create code-interpreter-v1              # 交互 PTY
abx create --prompt "Python 数据分析环境"   # 项目生成
```

位置参数是模板，默认 base。--detach 打印 ID；不传则打开真实终端。默认生命周期在终端退出后请求一秒超时，阿里云可能取整到约 60 秒。显式 timeout/lifecycle 参数保持固定版本行为。--lifecycle.ontimeout 见帮助。标准入口没有 --template、--upload、--yes；环境变量和元数据等创建参数以该固定 CLI 的帮助为准。

### abx list

```bash
abx list --state running --metadata project=demo --limit 100 --format json
```

状态、元数据筛选、分页收集与输出格式遵循固定版本。状态使用 --state，不使用 --status。

### abx info

```bash
abx info <sandbox-id> --format json
```

文本标签包含 Sandbox ID、Template ID、State、Envd version。JSON 使用标准客户端模型，不是项目的 ID/Status 信封。

### abx kill

```bash
abx kill <sandbox-id>
abx sandbox kill <id-one> <id-two>
```

立即删除，没有确认提示或 --yes。--all 支持状态/元数据筛选，也会立即执行，仅在确认所选集合都是目标资源时使用。不存在的 ID 保留参考 CLI 的提示和成功退出码。

### abx exec

```bash
abx exec --cwd /tmp --env MODE=test <sandbox-id> sh -c 'printf "$MODE"; exit 7'
abx exec --background <sandbox-id> python -m http.server 8000
```

所有本地选项放在沙箱 ID 前，之后的全部参数归远程命令，包括名为 --provider、--prompt 的参数。执行默认流式输出 stdout/stderr，并返回远程退出码；后台 PID 写入 stderr。固定版本没有本地 --stream、--timeout。多参数中的 shell 语法使用显式 sh -c。管道 stdin 取决于后端 envd 版本，保留与参考客户端相同的警告和版本检查。

### abx connect

```bash
abx connect <sandbox-id>
```

连接真实 PTY，工作目录、环境变量和终端状态在命令之间持续。退出终端后现有沙箱继续运行。需要终端，E2E 使用真实本地 PTY 验证，不用逐行输入模拟终端行为。

### 有条件的生命周期能力

sandbox pause/resume 保持标准选项，受阿里云运行时/白名单限制。快照、网络能力见迁移指南。暴露客户端命令本身不代表服务能力已经启用。

## 文件操作命令

### abx upload

上传本地文件或目录到沙箱。

```bash
abx upload <SANDBOX_ID> <LOCAL_PATH> <REMOTE_PATH>
```

```bash
abx upload abc123 ./script.py /app/script.py
abx upload abc123 ./data/ /app/data/
```

交互式终端上，目录上传显示 `Uploading ... 12s`，灰色行为每个相对路径。不会打印文件内容。`--json`、`--quiet`、CI 和非 TTY 只打印成功行。

### abx download

从沙箱下载文件到本地。

```bash
abx download <SANDBOX_ID> <REMOTE_PATH> <LOCAL_PATH>
```

```bash
abx download abc123 /app/result.csv ./result.csv
abx download abc123 /app/output.log .
```

交互式终端上，传输显示 `Downloading <path>... 12s`。不会打印文件内容。

---

## 具名命令

只有一种机制：注册在**沙箱内服务器**上的命令（`SandboxServer` 的 `CommandRegistry`，通过 `GET /commands` 与 `POST /commands/{name}` 提供）。它们不在 `template.yaml` 中声明。沙箱内没有运行中的服务器时，报告 `No SandboxServer reachable` 并以非零码退出。

### abx sandbox command list

```bash
abx sandbox command list <SANDBOX_ID> [--server-port PORT]
```

列出已注册命令及其参数与描述。

### abx run

等同于 `abx sandbox command run`。

```bash
abx run <SANDBOX_ID> <COMMAND_NAME> [选项]
```

| 选项 | 简写 | 说明 |
|------|------|------|
| `--arg` | `-a` | 参数 `KEY=VALUE`（可重复；服务器按声明的类型转换字符串） |
| `--json-args` | | 以 JSON 对象传入参数（保留类型） |
| `--server-port` | | 沙箱内服务器端口（默认 9000） |

```bash
abx sandbox command list abc123
abx run abc123 build --arg target=staging --arg n=2
abx run abc123 add --json-args '{"x": 1, "y": 2}'
```

在沙箱内用装饰器注册命令：

```python
from agent_sandbox.server.registry import registry

@registry.command("greet")
def greet(name: str) -> str:
    return f"Hello, {name}!"

registry.freeze()
```

字符串结果原样输出，其他值输出为 JSON（`--json` 包装为 `{"result": ...}`）。命令在服务器端失败时退出码为 1；名称不存在时退出码为 2（`CommandNotFoundError`）。

---

## 配置命令 — abx config

管理持久化凭证和 CLI 默认配置。值存储在 `~/.abx/config.toml` 和 `~/.abx/.env` 中。运行时环境变量仍可覆盖已存储的配置。

### abx config get

```bash
abx config get <KEY>
```

可用配置键：

| 键 | 说明 |
|---|------|
| `sandbox_api_key` | 沙箱服务 API Key（存 `~/.abx/.env` 的 `ABX_SANDBOX_API_KEY`，输出时脱敏） |
| `access_key_id` | 阿里云 AccessKey ID（模板部署、ACR 推送） |
| `access_key_secret` | 阿里云 AccessKey Secret（输出时脱敏） |
| `acr_namespace` | 模板构建、推送、安装用的 ACR 命名空间（存为 `ACR_NAMESPACE`） |
| `api_url` | 平台 API URL |
| `domain` | envd 数据面域名 |
| `region` | 默认区域 |
| `http_timeout` | HTTP 请求超时秒数 |
| `http2` | 启用 HTTP/2（true/false） |
| `llm_api_key` | LLM API Key，供自然语言推理和编码代理使用（输出时脱敏；存为 `ABX_LLM_API_KEY`） |
| `llm_model` | LLM 模型名称（默认 `qwen3-coder-plus`） |
| `llm_base_url` | LLM API 基地址，OpenAI 兼容（默认 DashScope compatible-mode） |
| `github_token` | 模板下载用 GitHub 令牌（`abx template install` / `abx template search`；存储在 `~/.abx/.env`，映射 `GITHUB_TOKEN`，输出脱敏） |

### abx config init

引导式配置。默认只询问**凭证与区域**；`--build` 与 `--llm` 追加相应部分。

```bash
abx config init                 # 沙箱 API Key + 区域
abx config init --build         # + ACR 命名空间与阿里云 AccessKey（template build / push / deploy / install 需要）
abx config init --llm           # + LLM API Key（模板生成）
abx config init --yes           # 非交互：打印等效的 abx config set 命令
```

- 交互式终端中依次提示；敏感值（API Key 与 AccessKey Secret）在终端支持时以星号反馈（每个字符一个 `*`，绝不回显原文），不支持时安全降级为无回显输入并明确提示。直接回车跳过该项。密钥存储到 `~/.abx/.env`（`ABX_SANDBOX_API_KEY`、`ABX_LLM_API_KEY`、`ALICLOUD_ACCESS_KEY_ID`、`ALICLOUD_ACCESS_KEY_SECRET`）；ACR 命名空间也存在该文件，变量名为 `ACR_NAMESPACE`；区域写入 `~/.abx/config.toml`。
- 需要尚未配置的设置（ACR 命名空间、AccessKey、LLM Key）的功能，会打印一行指向 `abx config init --build` 或 `abx config init --llm` 的提示；`config init` 结束时也会对跳过的部分打印同样的提示。
- Enter 接受当前值/跳过提示，退格编辑，Ctrl-C / EOF（Ctrl-D）干净地中止向导。
- 非 TTY 环境（CI、管道输入）、`--yes` 与 `--ci` 不阻塞：打印等效的非交互 `abx config set` 命令并以 0 退出。

```bash
abx config init --build --llm
# 1/6 Sandbox API key (sandbox_api_key / ABX_SANDBOX_API_KEY, input masked)
# 2/6 Region (默认 cn-hangzhou)
# 3/6 ACR namespace (needed by abx template install / build / deploy)
# 4/6 Alibaba Cloud AccessKey ID (template deploy / ACR push)
# 5/6 Alibaba Cloud AccessKey Secret (input masked)
# 6/6 LLM API key (DashScope/ModelStudio, input masked)
```

### abx config set

```bash
abx config set <KEY> <VALUE>
```

配置存储在 `~/.abx/config.toml`，凭证（`sandbox_api_key`、`access_key_id`、`access_key_secret`、`acr_namespace`、`llm_api_key`、`github_token`）写入 `~/.abx/.env`（权限 600）。

传入空 `<VALUE>` 时改为清除该键的持久化值：回落到内置业务默认值或变为 not set。 空字符串绝不会作为凭证或覆盖值写入。若仍有环境变量在运行时覆盖该键，命令会明确提示（但不打印其值）。

交互终端下可省略 `<VALUE>`：敏感键（`github_token`、`sandbox_api_key`、`access_key_secret`、`llm_api_key`）改用星号（脱敏）输入且不回显输入内容，其他键使用可见输入。在提示处直接回车则取消且不修改任何值；非交互环境必须显式传入 `<VALUE>`（否则以退出码 2 结束并提示等效命令）。

```bash
abx config set sandbox_api_key YOUR_API_KEY
abx config set access_key_id YOUR_ACCESS_KEY_ID
abx config set acr_namespace YOUR_ACR_NAMESPACE
abx config set region cn-hangzhou
abx config set http_timeout 120
abx config set region ""        # 清除已存储的 region（回落默认）
abx config set sandbox_api_key ""       # 删除已存储的 API Key（变为 not set）
abx config set github_token            # 星号脱敏输入（交互终端可省略 VALUE）
abx config set github_token YOUR_GITHUB_TOKEN
abx config set github_token ""         # 删除已存储的 token
```

### abx config list

```bash
abx config list
```

显示所有生效的配置值及其来源：`(env)` 进程环境变量、`(user)` `./.env` 或 `abx config set` 保存的值、`(default)` 内置业务默认值、`(not set)` 任何来源都无值。已设置的环境变量优先于这两个文件。`./.env` 写了的键优先于 `~/.abx`。完整顺序见 [凭证解析](configuration.md#凭证解析)。有真实业务默认的键（如 `llm_base_url`、`llm_model`）显示具体默认值；`llm_api_key` 与 `sandbox_api_key` 未设置时显示 `(not set)`。敏感值始终脱敏。

### abx config delete

```bash
abx config delete <KEY>
```

删除一项已保存的值。该键回到内置默认值，或变为 not set。`abx config set KEY ""` 做的是同一件事。仍在覆盖该键的环境变量不会被删掉，输出里只写出变量名，不打印它的值。这个命令不删除 `~/.abx`，也不会一次清掉所有键；没有 `abx config reset`。

```bash
abx config delete acr_namespace
abx config delete access_key_secret
```

---

## 模板命令 — abx template

发现、脚手架、构建和管理沙箱模板。

### abx template scaffold

从内置案例脚手架生成新模板目录，根据自然语言描述生成模板文件，或用 `--adopt` 适配一个已有项目。这些路径都不构建、不推送、不部署、不创建沙箱。

```bash
abx template scaffold [DIRECTORY] [选项]
```

| 选项 | 简写 | 说明 |
|------|------|------|
| `--template` | `-t` | 内置脚手架案例（`python`、`node`、`minimal`） |
| `--from` | | 从 registry 引用拉取模板源码。本地目录如果没有 `template.yaml` 会被拒绝，请改用 `--adopt` |
| `--name` | | 模板名称 |
| `--list` | | 列出可用脚手架案例 |
| `--force` | | 覆盖已存在的文件。`--adopt` 加 `--yes` 时，替换已有 Dockerfile 也需要它 |
| `--adopt` | | 适配 DIRECTORY 里的已有项目（默认 `.`）：由 Qwen Code 补上模板文件 |
| `--hint` | | 配合 `--adopt`：端口、依赖服务等代码里看不出来的信息 |
| `--dry-run` | | 配合 `--adopt`：列出将要发送的文件。不发送，也不写入 |
| `-v` / `--verbose` | | 调试日志 |
| `--yes` | `-y` | 跳过确认。非交互的 模板生成（含 `--adopt`）必须带它 |

**DIRECTORY 行为**：省略时在当前目录下新建 `./<name>` 子目录。`<name>` 按优先级：`--name` > 脚手架案例名 > `--from` 拉取到的模板名 > 生成名。

路径记号（`my-app`、`./my app`）表示目录。含空白或中文的文本是描述：Qwen Code 把 `Dockerfile` 与 `template.yaml` 写到 `./<name>/` 后停止。交互式终端会先问 `Directory for the template project`：回车保持 `./<name>/`（设置了 `--name` 时是 `./<--name>/`），其他路径就是项目目录本身。`--yes`、`--json` 和非交互终端跳过这个问题。这与在 `abx create --prompt "描述"` 的切换问题上回答「是」的结果相同（切换路径不会再问一次，直接写到 `./<name>/`）。

```bash
abx template scaffold --list
abx template scaffold -t python
abx template scaffold -t python --name myapp
abx template scaffold -t python ./my-template
abx template scaffold --from owner/repo
abx template scaffold --prompt "一个 Python 数据分析环境"
abx template scaffold -y --prompt "a node.js api server"
abx template scaffold --adopt . --hint "监听 8080"
abx template scaffold --adopt ./app --dry-run
abx template scaffold --adopt ./app -y          # 非交互；然后 abx deploy ./app
```

`--adopt` 会把候选文件复制到临时目录，并在发送给模型之前征求确认。`.env`、密钥、以及内容看起来像密钥的文件不会进入这份副本。Agent 不能修改项目本身：确认之后（或加 `--yes`）只会写回 `Dockerfile`、`commands.py`、`template.yaml`，以及在你还没有 `.dockerignore` 时自动生成的那一份。被替换的文件保留为 `*.abx-bak`。模型进程不会继承云凭证（`ALICLOUD_*`、`E2B_*`、`ACR_*` 等）。这会把项目源码发给模型，暴露面比 `abx template scaffold --prompt "描述"`（只发送你输入的那句话）更大。

> 引导式凭证配置是 `abx config init`；不存在顶层 `abx init`。
>
> 未知顶层命令会得到针对性提示：拼写相近时给出 `Did you mean '…'?` 建议；否则错误信息指向命令列表（`abx --help`）、`abx template scaffold|install`，以及具名命令的 `abx run SANDBOX NAME`。

### abx template deploy

一键部署：本地 Docker 构建 → ACR 推送 → 创建沙箱模板（`template build` 的别名）。

> **云端副作用与成本**：ACR 推送与远端模板注册是云端操作，可能产生阿里云费用（ACR 存储/流量、模板资源）。任何云端操作开始前都需要交互确认（或 `--yes`）；非交互环境会快速失败而不是静默部署。

需要：Docker daemon 运行中、ACR 凭证、ACR 命名空间。AK/SK 凭证从 `ALICLOUD_ACCESS_KEY_ID` / `ALICLOUD_ACCESS_KEY_SECRET` 读取（当 `--acr-username`/`--acr-password` 未传时）。

```bash
abx template deploy <TEMPLATE_DIR> [选项]
```

| 选项 | 简写 | 说明 |
|------|------|------|
| `--acr-registry` | | ACR 注册中心主机 |
| `--acr-namespace` | | ACR 命名空间（CLI > 环境变量 `ACR_NAMESPACE` > `.env`） |
| `--acr-repo` | | ACR 仓库名（默认 `template.yaml` 的 `name` 或目录名） |
| `--acr-username` / `--acr-password` | | ACR 凭证 |
| `--acree-instance-id` | | ACR EE 实例 ID |
| `--vpc-id` | | VPC ID |
| `--vswitch-ids` | | VSwitch ID 列表（逗号分隔） |
| `--security-group-id` | | 安全组 ID |
| `--alias` | `-a` | 模板别名 |
| `--tag` | `-t` | Docker 镜像标签 |
| `--platform` | | 目标平台 |
| `--cpu` | | CPU 核数（默认 `template.yaml` → 2） |
| `--memory` | | 内存 MB（默认 `template.yaml` → 2048） |
| `--start-cmd` / `--ready-cmd` | | 启动/就绪命令 |
| `--timeout` | | 构建超时秒数 |
| `--dockerfile` | `-f` | 自定义 Dockerfile 路径 |
| `--disk-size` | | 磁盘大小 MB（仅官方 API） |
| `--internet-access/--no-internet-access` | | 联网访问（仅官方 API） |
| `--team-id` | | Team ID |
| `--envd-inject/--no-envd-inject` | | envd 注入（默认关闭） |
| `--generation` | | 沙箱代数（1=一代 rund，2=二代 MicroVM；默认 `template.yaml` → 1） |
| `--target-image` | | envd copy 目标镜像 ref |
| `--yes` | `-y` | 跳过确认 |
| `--verbose` | `-v` | 详细输出 |
| `--region` | `-r` | 本次调用的区域覆盖（默认：`abx config set region` 值，否则 cn-hangzhou） |

```bash
abx template deploy ./examples/templates/python-hello \
  --acr-namespace my-ns --acr-repo python-hello

abx template deploy ./my-template --acr-namespace prod --yes
```

#### 参数默认值与优先级

`template build` / `template deploy` 的参数按 **5 级优先级链**解析（从高到低）：

| 优先级 | 来源 |
|--------|------|
| 1 | CLI 显式传入 |
| 2 | 操作系统环境变量 |
| 3 | 当前工作目录的 `.env` 文件 |
| 4 | 模板目录下的 `template.yaml` |
| 5 | 硬编码兜底值 |

> **自动化 / CI**：请在命令行显式传入 `--acr-namespace` 与模板目录，而不是依赖 `ACR_NAMESPACE` / `ABX_DEFAULT_TEMPLATE_DIR` 环境变量或 `.env` 文件，避免构建随环境漂移。对 `template install` / `install`，要么显式传 `--acr-namespace`，要么在流程不应触碰云端时使用 `--download-only`。

### abx template build

构建 Docker 镜像 + 推送到 ACR + 创建沙箱模板。

> **云端副作用与成本**：默认流水线为本地 Docker 构建 → ACR 推送 → 官方 CreateTemplate API 注册模板。ACR 推送与远端注册是云端操作，可能产生阿里云费用（ACR 存储/流量、模板资源）。云端操作开始前需要交互确认（或 `--yes`）。

模板构建使用官方 CreateTemplate API，需要 AK/SK；`@alicloud/fcsandbox20260509` 客户端已内置。

```bash
abx template build <TEMPLATE_DIR> [选项]
```

参数与 `template deploy` 相同。

### abx template push

推送已有本地镜像到 ACR。

```bash
abx template push <IMAGE> [选项]
```

| 选项 | 说明 |
|------|------|
| `--acr-registry` | ACR 注册中心主机 |
| `--acr-namespace` | ACR 命名空间 |
| `--acr-username` / `--acr-password` | ACR 凭证 |
| `--acree-instance-id` | ACR EE 实例 ID |
| `--region` | 本次调用的区域覆盖（默认：`abx config set region` 值，否则 cn-hangzhou） |

```bash
abx template push python-hello:latest --acr-namespace my-ns
```

### abx template from-image

从已有容器镜像创建沙箱模板。使用阿里云 FCSandbox 官方 CreateTemplate API（需 AK/SK 和已内置的 `@alicloud/fcsandbox20260509` 客户端）。

```bash
abx template from-image <IMAGE> --name <NAME> [选项]
```

| 选项 | 简写 | 说明 |
|------|------|------|
| `--name` | `-n` | 模板名称（必需） |
| `--team-id` | | Team ID |
| `--cpu` | | CPU 核数（默认 2，FLOAT） |
| `--memory` | | 内存 MB（默认 2048） |
| `--disk-size` | | 磁盘大小 MB |
| `--internet-access/--no-internet-access` | | 联网访问 |
| `--generation` | | 沙箱代数 |
| `--envd-inject/--no-envd-inject` | | envd 注入 |
| `--target-image` | | envd copy 目标镜像 ref |
| `--registry-type` | | 镜像仓库类型：`acr` / `acree`（自动检测） |
| `--acree-instance-id` | | ACR EE 实例 ID |
| `--registry-username` | | 镜像仓库用户名 |
| `--registry-password` | | 镜像仓库密码 |
| `--start-cmd` | | 容器启动命令 |
| `--ready-cmd` | | 容器就绪检查命令 |
| `--region` | `-r` | 本次调用的区域覆盖（默认：`abx config set region` 值，否则 cn-hangzhou） |

```bash
abx template from-image registry.cn-hangzhou.aliyuncs.com/ns/repo:tag --name my-template

abx template from-image registry.cn-hangzhou.aliyuncs.com/ns/repo:tag \
  --name my-tpl --cpu 4 --memory 4096 --disk-size 10240 --internet-access
```

交互式终端上，CreateTemplate 调用显示 `Creating template <name>... 12s`。不会打印镜像仓库密码。

### abx template install

下载模板并（默认）构建 + 部署。使用 `--download-only` 仅下载到本地缓存（`~/.abx/templates/`）。使用 `--dir` 下载到自定义目录。

默认的构建 + 部署步骤会执行本地 Docker 构建、ACR 推送与 CreateTemplate 注册——这些云端操作可能产生阿里云费用（ACR 存储/流量、模板资源）；`--download-only` 可完全跳过。云端操作开始前需要交互确认（或 `--yes`）；非交互环境下前置条件缺失时会快速失败并提示 `--download-only`。

`TEMPLATE_REF` 可以是远程索引中的**裸模板名**（来自真源仓库 `alibaba-agent-sandbox/awesome-templates`），也可以是 registry 引用（`owner/repo[//subdir][@ref]`）。裸名解析顺序：本地路径 → 内置模板（`base` / `code-interpreter-v1`，不触网）→ 远程索引（命中后打印 `Resolved '<name>' via the template index: ...`）。索引条目可声明 `ref` 锁定版本，锁定值会被遵守；裸名未命中时会强制刷新一次索引，新发布模板无需等待缓存过期。

```bash
abx template install <TEMPLATE_REF> [选项]
```

| 选项 | 简写 | 说明 |
|------|------|------|
| `--registry-url` | | Registry URL（默认 GitHub） |
| `--registry-type` | | `github` / `local`（自动检测） |
| `--token` | | GitHub 令牌：私有仓库访问 + 远程索引限流额度提升（环境变量：`GITHUB_TOKEN`）。仅作临时覆盖 —— 推荐 `abx config set github_token`；`--token` 可能泄漏到 shell history 或进程列表 |
| `--alias` | `-a` | 模板别名 |
| `--download-only` | | 仅下载（跳过构建和部署） |
| `--dir` | | 下载到自定义目录 |
| `--acr-namespace` | | 部署用 ACR 命名空间 |
| `--cpu` | | CPU 核数 |
| `--memory` | | 内存 MB |
| `--yes` | `-y` | 跳过确认 |
| `--region` | `-r` | 本次调用的区域覆盖（默认：`abx config set region` 值，否则 cn-hangzhou） |

```bash
abx template install owner/repo --acr-namespace my-ns    # 下载 + 构建 + 部署
abx template install owner/repo --download-only          # 仅下载
abx template install owner/repo//subdir --dir ./local    # 子目录 + 自定义路径
abx template install node-web --download-only            # 裸名经远程索引解析
abx template install alibaba-agent-sandbox/awesome-templates//node-web@v1.0.0 --download-only  # 锁定版本
```

token 优先级：`--token` > 进程环境变量 `GITHUB_TOKEN` > `./.env` > 持久化的 `github_token`（`abx config set github_token`；星号脱敏输入，存储在 `~/.abx/.env`）> 无 token。匿名限流（E5000）时错误信息完整保留 `owner/repo//subdir@ref`（含子目录与锁定版本），并展示经官方文档核验的 fine-grained PAT 预填 URL（公共仓库无需额外权限，建议 90 天有效期）。仅在交互终端下引导一次星号（脱敏）配置 `github_token`，并 **只自动重试一次**；CI / 非交互环境则提示通过 Secret 注入 `GITHUB_TOKEN` 或在交互终端执行 `abx config set github_token`。token 不会被打印或记录。

### abx template init

<a id="abx-template-create"></a>
<a id="abx-template-list"></a>

`template init --name demo --language python-sync`（或 python-async）生成本地 SDK 文件；template create 保留标准 Dockerfile 构建行为；template list --format json 保留标准模型/输出，实际受阿里云能力和权限限制。项目镜像注册使用 template from-image，template.yaml/server 生成使用 template scaffold。

### abx template info

通过阿里云官方 FCSandbox GetTemplate API 查看模板详情。

```bash
abx template info <TEMPLATE_ID> [选项]
```

| 选项 | 说明 |
|------|------|
| `--region` | 本次调用的区域覆盖（默认：`abx config set region` 值，否则 cn-hangzhou） |

### abx template delete

标准命令的确认方式和参数见该固定版本的 --help。通过项目扩展信封管理阿里云镜像时，`abx --json template delete <id> --yes` 保留这一显式选择的项目接口。删除模板/快照仍受后端所有权与占用规则约束。

### abx template search

按名称、标签或描述搜索模板，查询真源仓库 [`alibaba-agent-sandbox/awesome-templates`](https://github.com/alibaba-agent-sandbox/awesome-templates) 的 `awesome-templates.yaml` 索引 。索引缓存于 `~/.abx/index/`（TTL 1 小时，新鲜缓存不触网）；网络失败/限流时回退 过期缓存并打印 warning。无缓存时，匿名限流（E5000）给出统一引导 —— `abx config set github_token` / `GITHUB_TOKEN`、fine-grained PAT 预填 URL、`--token` 泄漏提醒与镜像提示；仅在交互终端下引导一次星号（脱敏）配置并只自动重试一次（绝不循环）；非交互环境提示通过 Secret 注入或在交互终端执行 `abx config set github_token`。

```bash
abx template search <QUERY> [选项]
```

| 选项 | 简写 | 说明 |
|------|------|------|
| `--tag` | `-t` | 按标签过滤 |
| `--status` | `-s` | 按状态过滤：`official` / `community` / `experimental` |
| `--index-url` | | 索引位置：HTTP(S) URL 或本地文件路径（环境变量：`ABX_DEFAULT_TEMPLATE_INDEX_URL`；默认：官方远程索引） |
| `--token` | | GitHub 令牌（私有镜像 / 提升限流额度；环境变量：`GITHUB_TOKEN`）。仅作临时覆盖 —— 推荐 `abx config set github_token` |
| `--refresh` | | 强制重新拉取索引，忽略本地缓存 |

```bash
abx template search python
abx template search browser --status official
abx template search qwen --tag deploy
abx template search python --refresh              # 绕过本地缓存
abx template search web --index-url https://mirror.example/idx.yaml  # 内网镜像
```

---

## MCP 命令 — abx mcp

配置和运行 Agent Sandbox MCP Server。支持本地 STDIO 传输（IDE 集成）和 Streamable HTTP 部署产物（手动部署到 FC）。

### abx mcp install

将 MCP Server 配置写入目标 IDE 的配置文件。

```bash
abx mcp install --target <cursor|claude|vscode>
```

| 选项 | 说明 |
|------|------|
| `--target` | 目标 IDE（`cursor` / `claude` / `vscode`，必选） |

### abx mcp start

启动本地 MCP Server。默认是 STDIO：说明、配置和停止方式写到 stderr，stdout 只输出 JSON-RPC。进程会停在 stdin 上等待，这是正在运行。Ctrl-C 或 `abx mcp stop` 结束它。`--background` 把 HTTP server 放到后台（STDIO 脱离终端后无法继续服务）。

```bash
abx mcp start [选项]
abx mcp start --http --background
```

| 选项 | 说明 |
|------|------|
| `--template` | 默认沙箱模板（默认 `code-interpreter-v1`） |
| `--api-key` | API Key 覆盖 |
| `--api-url` | API URL 覆盖 |
| `--domain` | Domain 覆盖 |
| `--http` | 使用 Streamable HTTP，而不是 STDIO |
| `--host` | HTTP 绑定地址（默认 `127.0.0.1`）。非回环地址必须带非空 `--auth-token` |
| `--port` | HTTP 端口（默认 `9000`） |
| `--auth-token` | HTTP Bearer token（环境变量 `ABX_MCP_AUTH_TOKEN`） |
| `--background` | 分离 HTTP server，之后用 `abx mcp stop` 停止 |

### abx mcp stop

停止 `abx mcp start` 记录的本地进程（前台 STDIO 或后台 HTTP）。向 pid 发送 SIGTERM，并等它退出。没有在运行的 server 时打印 `MCP server is not running.`。

```bash
abx mcp stop
```

### abx mcp status

显示 MCP 工具列表、认证状态、本地 server 是否在运行（`mcp_running`）和各 IDE 安装状态。

```bash
abx mcp status
```

### abx mcp deploy

生成阿里云 FC 部署产物（Streamable HTTP ASGI）。不调用 FC 部署 API。

`POST /mcp` 处理请求，`DELETE /mcp` 终止会话。`GET /mcp` 返回 405（SSE 通知尚未实现）。部署必须提供非空 Bearer token。

```bash
abx mcp deploy [选项]
```

| 选项 | 说明 |
|------|------|
| `--name` | FC 函数名（默认 `agent-sandbox-mcp`） |
| `--region` | FC 区域（命令 `--region` > `ALIBABA_CLOUD_REGION_ID` > `abx config set region` > `cn-hangzhou`） |
| `--template` | 默认沙箱模板 |
| `--memory` | FC 函数内存 MB |
| `--timeout` | FC 函数超时秒数 |
| `--auth-token-file` | Bearer Token 文件路径 |
| `--generate-token` | 自动生成随机 Bearer Token |
| `--enable-session-affinity/--no-session-affinity` | Mcp-Session-Id 会话亲和（默认开启） |
| `--api-key` | 注入到 FC 环境变量的 ABX_SANDBOX_API_KEY |
| `--custom-domain` | 自定义域名 |
| `--output-dir` | 部署产物输出目录 |

```bash
abx mcp deploy --generate-token --api-key $ABX_SANDBOX_API_KEY --output-dir ./deploy-artifact
abx mcp deploy --auth-token-file ./token.txt --region cn-shanghai --output-dir ./artifact
```

---

## 部署命令 — abx deploy

发布模板项目：`docker build` → 推送 ACR → 注册模板 → 等待就绪。固定流水线，**没有描述参数，无需 LLM，也无需 LLM Key**。它是模板生命周期的第 2 步（`abx template scaffold` → **`abx deploy`** → `abx create <template>`）；“模板是什么”写在 `template.yaml` 里。

```bash
abx deploy [PATH] [选项]
```

`PATH` 为模板目录（默认 `.`），必须包含 `Dockerfile`，除非指定了 `--dockerfile`。`template.yaml` 提供 `name`（ACR 仓库名）、`resources.cpu`、`resources.memory` 和 `generation`；命令行选项优先。

`abx deploy` 接受 **`abx template deploy` 的全部选项**（`--acr-registry`、`--acr-namespace`、`--acr-repo`、`--alias -a`、`--tag -t`、`--cpu`、`--memory`、`--dockerfile -f`、`--yes -y`、`--verbose -v`、`--region -r` 等，见 `abx deploy --help`）。

```bash
abx template scaffold --prompt "一个 Python 数据分析环境"     # 1. 编写（AI 可选）
abx deploy ./<name> --acr-namespace my-ns       # 2. 发布
abx create <TEMPLATE_ID>             # 3. 启动
```

没有说明参数，也没有 `--agent`：模板只需在编写时描述一次。

---

## sandbox 子命令组

`abx sandbox` 是沙箱操作的规范入口（create / list / info / kill / exec / connect / upload / download / capabilities）；顶层 `abx create` … `abx download` 是它们的固定快捷方式。下面的子组只存在于这里。

### abx sandbox files — 文件操作

| 子命令 | 说明 | 主要选项 |
|--------|------|----------|
| `list` | 列出目录内容 | `--path -p`、`--recursive -r` |
| `stat` | 查看文件/目录信息 | `--path -p`（必选） |
| `mkdir` | 创建目录（含父目录） | `--path -p`（必选） |
| `rm` | 删除文件/目录 | `--path -p`（必选）、`--yes -y` |
| `mv` | 移动/重命名 | `--source -s`（必选）、`--dest -d`（必选） |
| `search` | 按 glob 搜索 | `--path -p`（必选）、`--pattern`（必选）、`--max-depth`（默认 5） |

```bash
abx sandbox files list abc123 --path /app --recursive
abx sandbox files stat abc123 --path /app/main.py
abx sandbox files mkdir abc123 --path /app/data
abx sandbox files rm abc123 --path /app/temp.log --yes
abx sandbox files mv abc123 --source /app/old.py --dest /app/new.py
abx sandbox files search abc123 --path /app --pattern "*.py"
```

### abx sandbox process — 进程查看

标准后台执行返回的 ID 可能是 envd 句柄，不是操作系统 PID。项目 process info 扩展优先查询 envd 已登记的句柄，显示已知 PID/命令/状态，不虚构操作系统字段；未登记的 OS PID 保留 ps 查询。


只用于查看与控制进程；启动进程请用 `abx exec --background`（打印 pid）。

| 子命令 | 说明 | 主要选项 |
|--------|------|----------|
| `list` | 列出运行中的进程 | — |
| `info` | 查看 PID 进程详情 | `PID` |
| `signal` | 发送信号 | `PID`（`process list` 显示的 envd 进程 ID）、`--signal -s`（默认 15/SIGTERM；仅支持 15 与 9/SIGKILL，其他编号在发送请求前即被拒绝） |

```bash
abx sandbox process list abc123
abx sandbox process info abc123 1234
abx sandbox process signal abc123 1234 --signal 9
```

### abx sandbox system — 系统信息

| 子命令 | 说明 | 主要选项 |
|--------|------|----------|
| `info` | 系统信息（OS、CPU、内存、磁盘） | — |
| `env` | 环境变量（自动过滤敏感信息） | `--filter -f`（逗号分隔变量名） |
| `ports` | 监听中的 TCP 端口 | — |
| `packages` | 已安装包（pip/npm） | `--manager -m`（默认 `pip`） |
| `metrics` | 资源使用（CPU 负载、磁盘用量） | — |

```bash
abx sandbox system info abc123
abx sandbox system env abc123 --filter PATH,HOME,LANG
abx sandbox system ports abc123
abx sandbox system packages abc123 --manager npm
abx sandbox system metrics abc123
```

### abx sandbox capabilities — 能力组状态

查看沙箱可用的能力组（shell、files、code、terminal、ports）。内置 provider 读取沙箱模板的声明；插件 provider 由其声明的 features 推导（`abx provider info <ID>`）。

```bash
abx sandbox capabilities <SANDBOX_ID>
```

---

## 退出码

标准 exec 返回远程进程退出码；标准解析/API 错误遵循固定 E2B CLI（通常为 1）。下表描述项目扩展错误，不适用于标准 E2B 命令。


| 退出码 | 含义 |
|--------|------|
| 0 | 成功 |
| 1 | 一般错误 |
| 2 | 参数错误：flag 或参数有误、相互冲突，包括命令在解析之后做的检查（例如没有终端时必须加 `--yes`） |
| 3 | 认证失败 |
| 4 | 资源未找到 |
| 5 | 超时 |
| 6 | 配额超限 |
