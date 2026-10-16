> 极速版标准命令以[E2B 迁移契约](../guide/migrate-from-e2b.md)为准：create 位置参数为模板，--prompt 请求生成，template create 使用 E2B 构建语义，from-image 创建阿里云镜像模板。

# CLI 参考手册

## 命令总览

每个动作只有一条规范的 `abx GROUP VERB` 路径，外加一小组**固定**的顶层快捷方式。完整命令树、用法行和已移除写法见[CLI 命令参考（规范命令树）](cli-commands.md)；本页记录各命令的选项。

```
abx
├── 沙箱快捷方式（9 个 + deploy）   create / list / info / kill / exec / connect / upload / download / run / deploy
├── sandbox
│   ├── create / list / info / kill / exec / connect / upload / download / capabilities
│   ├── files:   list / stat / mkdir / rm / mv / search
│   ├── process: list / info / signal
│   ├── command: list / run
│   └── system:  info / env / ports / packages / metrics
├── template   init / search / info / list / build / push / create / delete / deploy / install
├── config     init / get / set / list / delete
├── mcp        install / start / status / stop / deploy
└── provider   （见 Provider 指南）
```

> 快捷方式是**硬编码的，不可配置**：`abx --help` 把每一个标注为“Same as 'abx …'”（`abx run` = `abx sandbox command run`，`abx deploy` = `abx template deploy`）。不存在 `[shortcuts]` 配置，也没有顶层 `abx init` / `abx install`；请使用 `abx template scaffold` 与 `abx template install`。

### 已移除的命令组（0.1.0 之前迁移）

早期预发布版本中的以下命令组在首个正式版 `0.1.0` 之前已被移除——它们属于 **breaking change**，均有明确的替代路径：

| 已移除 | 替代路径 |
|--------|----------|
| `abx auth login/logout/status/switch` | 用 `abx config set sandbox_api_key <value>` 持久化凭证，或直接使用 `E2B_API_KEY` 环境变量；用 `abx config list` 查看生效状态 |
| `abx secret create/list/delete/inject` | 用环境变量或 `.env` 文件管理凭证与密钥；沙箱环境注入用 `abx create --env KEY=VALUE` |
| `abx session` / `abx sessions list/info/rename/export/import/clean` | 会话数据仍由 `LocalSessionStore` 存储在本地 `~/.abx/sessions/`；在程序中用 SDK 的 `Sandbox.connect()`（交互式 REPL `abx connect <SANDBOX_ID>` 仍可用） |
| `abx skill search/install/list/create/publish` | 模板是当前的能力分发机制（`abx template search` / `abx template install`）；仓库根目录的 `SKILL.md` 面向 Agent 使用说明 |

完整的 breaking change 清单与迁移说明见仓库 `CHANGELOG.md` 的 `Unreleased` 节。

### 该用哪个命令？—— `config init`、`template init` 与 `create`

| 目标 | 命令 | 做什么 | 访问云端？ |
|------|------|--------|-----------|
| 首次使用前存储凭证与端点 | `abx config init` | 交互式引导向导（平台 API Key 与区域；`--build` 增加 ACR/AccessKey 部分，`--llm` 增加模板生成用的 LLM Key）；非 TTY 或加 `--yes` 时打印等效的 `abx config set` 命令 | 否 |
| 脚手架生成本地模板工程 | `abx template scaffold [DIRECTORY]` / `abx template scaffold --prompt "描述"` / `abx template scaffold --adopt [DIRECTORY]` | 路径参数脚手架生成可编辑的 `template.yaml` + `Dockerfile`（及 `commands.py`）。含空白或中文的描述则由 Qwen Code 生成可直接使用的模板：`Dockerfile`、`commands.py`（`SandboxServer` HTTP 入口）、`template.yaml` 与 `README.md`。`--adopt` 用于**已有源码**的项目：Agent 只看到一份副本，写回的只有这些模板文件（外加自动生成的 `.dockerignore`）。不构建、不推送、不部署、不启动沙箱 | 否 |
| 创建云端沙箱 | `abx create --template <名称>` / `abx create --prompt "描述"` | `--template 名称` 直接启动已有模板（默认沙箱用 `base`）；仅提供自然语言描述时先走 research-first 澄清流程（Agent 自行检索公开事实，交互下每轮只问一个无法自行推断的问题），再走 Qwen Code 生成模板 → 构建部署 → 创建。交互式终端会先询问是否改走 `abx template scaffold`，只留下本地文件。裸 `abx create`（无 `--template` 也无描述）会报显式用法错误，不会隐式启动 `base` | 是 |

```bash
# 1. 引导式凭证配置（首次使用先执行）
abx config init

# 2. 用默认模板创建沙箱
abx create

# 3. 用已有模板创建（不经过模板生成）
abx create --template python-hello

# 4. 用自然语言创建（模板生成：Qwen Code 写出并部署模板）
abx create --prompt "一个预装 pandas 和 jupyter 的 Python 数据分析环境"

# 5. 脚手架生成本地模板工程，自行编辑与部署
abx template scaffold -t python ./my-template

# 6. 自然语言，只生成模板文件（不构建、不推送、不创建沙箱）
abx template scaffold --prompt "一个预装 pandas 和 jupyter 的 Python 数据分析环境"
```

---

## 全局选项

```text
abx [全局选项] <子命令> [子命令选项]
```

| 选项 | 简写 | 说明 |
|------|------|------|
| `--json` | `-j` | 以 JSON 格式输出 |
| `--quiet` | `-q` | 最小化输出 |
| `--verbose` | `-v` | 详细输出（DEBUG 级别日志） |
| `--no-color` | | 禁用彩色输出 |
| `--log-level` | | 设置日志级别：`debug`/`info`/`warning`/`error` |
| `--ci` | | CI/CD 模式（等同 `--quiet --no-color --json`） |
| `--version` | | 显示版本号 |
| `--help` | `-h` | 显示帮助并退出（所有命令与子命令组均可用） |

> 没有全局 `--timeout`，也没有 `--profile`。沙箱生命周期是 `abx create` 的 `--timeout`；命令超时是 `abx exec` 的 `--timeout`。

> **`-h` / `--help` 在每个层级均可用**：别名在根命令处集中启用一次，并由整棵命令树继承，因此 `abx -h`、`abx sandbox -h`、`abx sandbox files list -h` 都会显示所指向命令的帮助。若某命令自身占用了 `-h` 参数，该参数保持不变——Click 只在那一处移除别名，`--help` 仍然可用。

> **区域是命令级选项，而非全局选项**：只有访问区域控制面的命令才接受 `--region`/`-r` —— [`abx list`](#abx-list)、[`abx kill`](#abx-kill)、模板控制面命令（`list`/`info`/`create`/`push`/`build`/`install`/`delete`）以及 [`abx mcp deploy`](#abx-mcp-deploy)。解析优先级：命令 `--region` > `ALIBABA_CLOUD_REGION_ID` > `abx config set region` > `cn-hangzhou`。凭证顺序见 [凭证解析](configuration.md#凭证解析)。持久默认值请通过 `abx config set region` 设置。

---

## 沙箱生命周期命令

### abx create

创建新沙箱。

**路由规则**（决定走哪条路径）：

| 调用方式 | 路径 |
|---------|------|
| `abx create`（无参数） | **拒绝执行** —— 显式用法错误（退出码 2），列出三种合法路由选项；裸 create 不再默认 `base` |
| `abx create --template <名称>` | 直接模板路径（不经过 模板生成） |
| `abx create --prompt "自然语言描述"` | 生成路径：交互式终端会先询问是否改走 template init（只留本地文件）。否则：research-first 澄清（Agent 在自身原生会话上先检索公开事实，交互下每轮只问一个无法自行推断的问题）→ Qwen Code 生成 Dockerfile + commands.py（SandboxServer）+ template.yaml → 构建部署 → 创建沙箱。`--yes` 跳过这次询问并走完整流程 |
| `abx create --prompt "描述" --template <名称>` | **拒绝执行** —— `DESCRIPTION` 与 `--template` 互斥；抛出用法错误（退出码 2），绝不静默忽略描述 |

互斥是有意设计：否则必须静默丢弃描述或模板中的一个，因此 CLI 直接拒绝该组合。

生成路径需要本机可用的 Qwen Code CLI 与 DashScope/ModelStudio 凭证。未安装时会在交互式终端提示安装官方 standalone 版本（经 SHA256 校验后安装到 `~/.abx/bin`）；非交互环境必须显式传入 `--yes`。终端上这次安装是 `Installing ... 12s` 标题，下方以灰色显示下载、校验和解压阶段；压缩包内容和 API key 不会出现。创建沙箱本身使用 `Creating sandbox... 12s`（只有带 `--upload` 时，文件名才会出现在标题下方）。

生成之前，Agent 会在同一个原生会话上执行两阶段澄清：先跑一轮普通**检索轮**（用它自己的工具确认可公开查证的事实——工具技术栈、官方安装方式、常见依赖；检索不到时采用安全合理默认值），再做一次**结构化评估**（完整度目标 80%）。低于阈值时，交互式会话每轮只问 **一个问题**，以 `Question 1`、`Question 2` 逐次编号（不显示总数；内部 5 轮上限仅在触达时提示）；每次回答都恢复同一会话并基于完整描述 + 全部问答历史重新评估，已问过的主题不会重复，回答“你自己决定”“采用默认”等授权语义会让 Agent 自行采用安全合理默认值。非交互会话未传 `--yes` 时快速失败并抛 `E2008`，列出缺失项与可直接套用的示例描述；`--yes` 完全跳过检索与评估。检索轮有上限（默认 20 个 agent 轮次、240 秒，可用 `ABX_QWEN_RESEARCH_TIMEOUT` 覆盖）；超时或轮次耗尽时 CLI 会带上原因告警并按安全默认值继续，随后评估会新开一个会话。评估不可用（超时、崩溃、无法解析）时打印 warning 并直接生成。Agent 工作期间，TTY 上会显示形如 `Researching public facts... 12s` / `Assessing description... 12s` 的标题，标题下方另起六行以灰色显示 Agent 最近的动态（近期文本，以及一小段已脱敏的工具详情——命令、url、查询或路径；按行滚动；`ABX_ACTIVITY_LINES` 为 1–10；`--verbose` 下同样如此；文件内容、思考内容和凭证保持隐藏）；这些内容不会写入 stdout，也不会出现在 `--json` / `--quiet` / CI 模式。

```bash
abx create [DESCRIPTION] [选项]
```

| 选项 | 简写 | 说明 |
|------|------|------|
| `--template` | `-T` | 模板 ID 或别名（默认 `base`）；提供后跳过 模板生成；不能与 DESCRIPTION 同时使用 |
| `--upload` | `-u` | 创建后自动上传的本地文件/目录 |
| `--timeout` | `-t` | 沙箱生命周期秒数（正整数，默认 300） |
| `--request-timeout` | | HTTP 请求超时秒数（下限 120s 或已配置的 `http_timeout`） |
| `--env` | `-e` | 环境变量 `KEY=VALUE`（可重复） |
| `--metadata` | `-m` | 元数据 `KEY=VALUE`（可重复） |
| `--yes` | `-y` | 跳过交互确认与 research-first 澄清流程（Qwen Code 安装、凭证输入、描述检索/评估、构建/部署确认）；非交互环境必填 |
| `--acr-namespace` | | 模板生成构建推送所用的 ACR 命名空间（env: `ACR_NAMESPACE`） |
| `--dir` | | 模板生成的 `Dockerfile` / `template.yaml` 所在的父目录，其中会新建 `<name>-<时间戳>-<id>/` 子目录（默认 `~/.abx/generated`）。未指定时交互式终端会询问（回车即用默认值）；`--yes` / `--json` / 非 TTY 静默使用默认值。需要给出 `DESCRIPTION`；切换为仅生成本地模板时会被忽略（并给出警告） |
| `--verbose` | `-v` | 详细输出（DEBUG 级别） |

```bash
# 使用默认 base 模板创建沙箱
abx create --template base

# 模板生成并创建（交互式；非交互环境需 -y）
abx create --prompt "一个 Python 数据分析环境"
abx create -y "a node.js api server"

# 非交互下描述不完整 → E2008（缺失项 + 示例）
# abx create --prompt "run python"

# 创建并上传文件
abx create --upload ./app --timeout 600 --env MY_KEY=value

# 拒绝：DESCRIPTION 与 --template 不能同时提供（退出码 2）
# abx create --prompt "a node.js api server" --template base

# 拒绝：裸 `abx create`（无 --template 也无描述，退出码 2）
# abx create
```

生成路径失败（未安装 `E2005`、缺少凭证 `E2006`、生成失败 `E2007`）时不会静默降级为 `base`，而是打印 Quick Setup 与下一步命令。

### abx list

列出沙箱，可按生命周期状态过滤。

```bash
abx list [选项]
```

| 选项 | 简写 | 说明 |
|------|------|------|
| `--status` | `-s` | 按状态过滤：`running`/`stopped`/`creating`/`paused`/`error` |
| `--limit` | `-l` | 最大结果数（正整数，默认 20） |
| `--region` | `-r` | 本次调用的区域覆盖（默认：`abx config set region` 值，否则 cn-hangzhou） |

### abx info

查看沙箱状态、模板、区域、超时和 URL。

```bash
abx info <SANDBOX_ID>
```

### abx kill

永久销毁一个沙箱或所有运行中的沙箱。需要确认，除非传入 `--yes`。终端上 `--all` 显示 `Killing N sandbox(es)... 12s`，灰色行为 `i/N <id>`；销毁单个沙箱只显示会走动的标题。非 TTY 只打印成功或错误行。

```bash
abx kill [SANDBOX_ID] [选项]
abx kill --all [选项]
```

| 选项 | 简写 | 说明 |
|------|------|------|
| `--all` | | 销毁所有运行中的沙箱 |
| `--yes` | `-y` | 跳过确认 |
| `--region` | `-r` | `--all` 控制面调用的区域覆盖（默认：`abx config set region` 值，否则 cn-hangzhou） |

### abx exec

在沙箱中执行一条命令（`abx sandbox exec` 的别名）。默认等待并以远端退出码退出。

```bash
abx exec <SANDBOX_ID> [选项] -- <COMMAND>...
```

| 选项 | 简写 | 说明 |
|------|------|------|
| `--cwd` | | 工作目录 |
| `--env` | `-e` | 环境变量 `KEY=VALUE`（可重复） |
| `--timeout` | `-t` | 命令超时秒数（正整数，默认 60） |
| `--background` | | 启动命令、打印 pid 并立即返回（不能与 `--stream` 同用） |
| `--stream` | | 命令运行期间实时打印 stdout/stderr |
| `--verbose` | `-v` | 详细输出（DEBUG 级别） |

`--` 之后的命令按原样执行，不经过 shell；单个带引号的参数按命令行解析，仅含管道或重定向时才使用 shell。需要变量展开时用 `sh -c '...'`。后台进程用 `abx sandbox process list|info|signal` 查看或发信号。

```bash
abx exec abc123 -- python --version
abx exec abc123 --cwd /app --env DEBUG=1 --timeout 300 -- pytest -q
abx exec abc123 --stream -- pip install numpy
abx exec abc123 --background -- python -m http.server 8000
```

### abx connect

连接到沙箱的交互式命令 REPL。这是**逐行** REPL，不是 PTY 也不是完整 SSH 会话：每行命令在新进程中执行（30 秒超时），`cd`、环境变量等 shell 状态不会跨命令保持（请使用 `cd /path && <cmd>` 单行写法，或 `abx exec --cwd`）。

在支持行编辑的交互式终端上会启用基础行编辑与历史快捷键（Up/Down 历史、Ctrl+R 搜索、Ctrl+A/E）。输入 `exit`/`quit` 或按 `Ctrl+D` 断开连接；`Ctrl+C` 也会断开。命令失败时只给出一条友好提示，不会显示原始 HTTP 错误、完整沙箱 URL 或 MDN 链接。

```bash
abx connect <SANDBOX_ID>
```

```bash
abx connect abc123
```

---

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
| `sandbox_api_key` | 沙箱服务 API Key（存 `~/.abx/.env` 的 `E2B_API_KEY`，输出时脱敏） |
| `access_key_id` | 阿里云 AccessKey ID（模板部署、ACR 推送） |
| `access_key_secret` | 阿里云 AccessKey Secret（输出时脱敏） |
| `acr_namespace` | 模板构建、推送、安装用的 ACR 命名空间（存为 `ACR_NAMESPACE`） |
| `api_url` | 平台 API URL |
| `domain` | envd 数据面域名 |
| `region` | 默认区域 |
| `http_timeout` | HTTP 请求超时秒数 |
| `http2` | 启用 HTTP/2（true/false） |
| `max_retries` | 最大重试次数 |
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

- 交互式终端中依次提示；敏感值（API Key 与 AccessKey Secret）在终端支持时以星号反馈（每个字符一个 `*`，绝不回显原文），不支持时安全降级为无回显输入并明确提示。直接回车跳过该项。密钥存储到 `~/.abx/.env`（`E2B_API_KEY`、`ABX_LLM_API_KEY`、`ALICLOUD_ACCESS_KEY_ID`、`ALICLOUD_ACCESS_KEY_SECRET`）；ACR 命名空间也存在该文件，变量名为 `ACR_NAMESPACE`；区域写入 `~/.abx/config.toml`。
- 需要尚未配置的设置（ACR 命名空间、AccessKey、LLM Key）的功能，会打印一行指向 `abx config init --build` 或 `abx config init --llm` 的提示；`config init` 结束时也会对跳过的部分打印同样的提示。
- Enter 接受当前值/跳过提示，退格编辑，Ctrl-C / EOF（Ctrl-D）干净地中止向导。
- 非 TTY 环境（CI、管道输入）、`--yes` 与 `--ci` 不阻塞：打印等效的非交互 `abx config set` 命令并以 0 退出。

```bash
abx config init --build --llm
# 1/6 Sandbox API key (sandbox_api_key / E2B_API_KEY, input masked)
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
| `--official-api/--legacy-api` | | 使用官方 API（默认）或旧 v3/v2 API |
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

支持两种模式：`--official-api`（默认，需 AK/SK 和已内置的 `@alicloud/fcsandbox20260509` 客户端）和 `--legacy-api`（旧 v3/v2 平台 API——保留在显式 flag 之后，非默认）。旧命令名 `abx template build-local` 已在 `0.1.0` 之前移除，替代命令为 `abx template build`（同一流水线、同一选项）。

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

### abx template list

列出当前账号注册的自定义模板。默认查询平台端点；传入 `--official-api` 使用阿里云 FCSandbox API（AK/SK）。

```bash
abx template list [选项]
```

| 选项 | 说明 |
|------|------|
| `--official-api` | 使用阿里云官方 FCSandbox API（AK/SK） |
| `--region` | 本次调用的区域覆盖（默认：`abx config set region` 值，否则 cn-hangzhou） |

### abx template info

查看模板详情。传入 `--official-api` 使用阿里云 FCSandbox GetTemplate API。

```bash
abx template info <TEMPLATE_ID> [选项]
```

| 选项 | 说明 |
|------|------|
| `--official-api` | 使用阿里云官方 FCSandbox API（AK/SK） |
| `--region` | 本次调用的区域覆盖（默认：`abx config set region` 值，否则 cn-hangzhou） |

### abx template delete

删除远端自定义模板（不可逆）。不移除本地缓存。需要确认。

```bash
abx template delete <TEMPLATE_ID> [选项]
```

| 选项 | 简写 | 说明 |
|------|------|------|
| `--yes` | `-y` | 跳过确认 |
| `--region` | `-r` | 本次调用的区域覆盖（默认：`abx config set region` 值，否则 cn-hangzhou） |

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
| `--api-key` | 注入到 FC 环境变量的 E2B_API_KEY |
| `--custom-domain` | 自定义域名 |
| `--output-dir` | 部署产物输出目录 |

```bash
abx mcp deploy --generate-token --api-key $E2B_API_KEY --output-dir ./deploy-artifact
abx mcp deploy --auth-token-file ./token.txt --region cn-shanghai --output-dir ./artifact
```

---

## 部署命令 — abx deploy

发布模板项目：`docker build` → 推送 ACR → 注册模板 → 等待就绪。固定流水线，**没有描述参数，无需 LLM，也无需 LLM Key**。它是模板生命周期的第 2 步（`abx template scaffold` → **`abx deploy`** → `abx create --template`）；“模板是什么”写在 `template.yaml` 里。

```bash
abx deploy [PATH] [选项]
```

`PATH` 为模板目录（默认 `.`），必须包含 `Dockerfile`，除非指定了 `--dockerfile`。`template.yaml` 提供 `name`（ACR 仓库名）、`resources.cpu`、`resources.memory` 和 `generation`；命令行选项优先。

`abx deploy` 接受 **`abx template deploy` 的全部选项**（`--acr-registry`、`--acr-namespace`、`--acr-repo`、`--alias -a`、`--tag -t`、`--cpu`、`--memory`、`--dockerfile -f`、`--yes -y`、`--verbose -v`、`--region -r` 等，见 `abx deploy --help`）。

```bash
abx template scaffold --prompt "一个 Python 数据分析环境"     # 1. 编写（AI 可选）
abx deploy ./<name> --acr-namespace my-ns       # 2. 发布
abx create --template <TEMPLATE_ID>             # 3. 启动
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

| 退出码 | 含义 |
|--------|------|
| 0 | 成功 |
| 1 | 一般错误 |
| 2 | 参数错误：flag 或参数有误、相互冲突，包括命令在解析之后做的检查（例如没有终端时必须加 `--yes`） |
| 3 | 认证失败 |
| 4 | 资源未找到 |
| 5 | 超时 |
| 6 | 配额超限 |
