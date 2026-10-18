# CLI 教程

本教程带你从安装开始，逐步掌握 `abx` CLI 的完整沙箱生命周期、模板使用和 MCP 集成。

---

## 第一步：安装

```bash
npm install -g @agent-sandbox/cli
```

安装后即可使用 `abx` 命令：

```bash
abx --version
```

---

## 第二步：认证

### 通过 config 设置 API Key

```bash
abx config set sandbox_api_key your-api-key
```

### 或通过环境变量

```bash
export ABX_SANDBOX_API_KEY="your-api-key"
```

> 运行时 API Key 配置（.env、config.toml）与独立控制面 AK/SK详见 [认证详解](authentication.md)。

---

## 第三步：创建沙箱

### 快速区分：`config init`、`template init` 与 `create`

| 我想要…… | 命令 |
|----------|------|
| 存储凭证与端点（首次使用先执行） | `abx config init` —— 交互式引导向导 |
| 创建云端沙箱（默认模板、已有模板或 模板生成） | `abx create [DESCRIPTION]` |
| 脚手架生成本地可编辑的模板工程 | `abx template init [DIRECTORY]` 或 `abx template init "描述"` —— 只写本地文件，不构建、不部署。描述会先询问项目目录（回车保持 `./<name>/`） |
| 把已有项目变成模板 | `abx template init --adopt [DIRECTORY]` —— 在原目录补上模板文件；不构建、不部署 |

### 使用默认模板

```bash
abx create --template base
# 输出类似：
# ✓ Sandbox created: sbx-xxxx
```

### 自然语言创建（模板生成）

```bash
# 首次使用：凭证与区域（`--build` 追加 ACR，`--llm` 追加此处用到的 LLM Key）
# abx config init --llm --build

# Qwen Code 生成 Dockerfile、commands.py（HTTP 服务）与 template.yaml → 构建部署 → 创建沙箱。
# 交互式终端会先询问是否改走 template init（只留本地文件）。--yes 保持完整流程。
abx create "一个 Python 数据分析环境"

# 只生成模板文件 —— 不构建、不推送、不部署、不创建沙箱
abx template init "一个 Python 数据分析环境"
```

生成之前，Agent 会先自行检索描述中**可公开查证的事实**——工具是否基于 Node.js、官方安装方式、常见运行时与依赖——再评估描述完整度（目标 80%）。只有用户偏好、私有约束和无法推断的业务决策才会成为问题，**每次只问一个**，以 `Question 1`、`Question 2` 逐次编号（不显示总数）；直接回车即可取消：

```text
Description is about 40% complete. I'll ask for the missing details one question at a time — press Enter to cancel.
Question 1: Which region and resource size should the sandbox use?
```

回答“你自己决定”“采用默认”等即视为授权 Agent 处理（采用安全合理默认值），已回答过的主题不会再次提问。

非交互环境（CI、管道输入）必须加 `-y` 跳过确认与澄清评估，否则安装/凭证/构建环节会直接报错并打印 Quick Setup；描述低于完整度阈值时则以 `E2008` 快速失败（附带缺失项与可直接套用的示例描述）：

```bash
# abx create -y "a node.js api server"
# abx create "run python"    # 非交互、描述不完整 → E2008
```

显式 `--template` 会跳过 模板生成，走直接模板路径（`abx create --template <名称>`）。`DESCRIPTION` 与 `--template` 互斥 —— 同时提供会被拒绝（用法错误），而不是静默忽略其中一个：

```bash
# abx create "a node.js api server" --template base   # 拒绝执行（退出码 2）
```

### 创建时上传文件

```bash
abx create --template base --upload ./project/ --env MY_KEY=value
```

---

## 第四步：查看与管理沙箱

### 列出所有沙箱

```bash
abx list
abx list --status running
abx list --limit 5
```

### 查看详情

```bash
abx info sbx-xxxx
```

---

## 第五步：在沙箱中执行命令

### 执行单条命令

```bash
abx exec sbx-xxxx -- echo Hello World
abx exec sbx-xxxx --timeout 120 -- pip install flask
abx exec sbx-xxxx --stream -- pip install flask         # 实时输出
abx exec sbx-xxxx --background -- python -m http.server 8000   # 打印 pid
```

### 交互式连接

```bash
abx connect sbx-xxxx
```

这是逐行 REPL，不是 PTY 也不是 SSH 会话：每行命令在独立进程中执行（30 秒
超时），`cd`、环境变量和 shell 状态不会跨行保持（请使用
`cd /path && <cmd>` 单行写法，或 `abx exec --cwd`）。交互式终端支持基础行编辑
与历史快捷键（Up/Down、Ctrl+R、Ctrl+A/E）。输入 `exit`、`quit` 或按
`Ctrl+D` 退出；`Ctrl+C` 也会断开。命令失败时只给出一条友好提示。

```text
abx:sbx-xxxx> ls /app
main.py  data/
abx:sbx-xxxx> cd /app && python main.py
Hello from main.py
abx:sbx-xxxx> exit
Disconnected.
```

---

## 第六步：文件操作

### 上传

```bash
abx upload sbx-xxxx ./script.py /app/script.py
abx upload sbx-xxxx ./data/ /app/data/
```

终端上，目录上传显示 `Uploading ... 12s`，灰色行为相对路径。不会打印文件内容。

### 下载

```bash
abx download sbx-xxxx /app/result.csv ./result.csv
```

终端上，传输显示 `Downloading /app/result.csv... 12s`。不会打印文件内容。

---

## 第七步：运行具名命令

具名命令在沙箱内运行的 Python 代码（沙箱内 `SandboxServer`）中注册，不在 `template.yaml` 中声明。

```python
from agent_sandbox.server.registry import registry

@registry.command("greet")
def greet(name: str) -> str:
    return f"Hello, {name}!"

registry.freeze()
```

列出并运行：

```bash
abx sandbox command list sbx-xxxx
abx run sbx-xxxx greet --arg name=World          # 等同于：abx sandbox command run
abx run sbx-xxxx add --json-args '{"x": 1, "y": 2}'
```

> `registry` 属于沙箱内 Server SDK，其文档位于 SDK 仓库（见 [相关 SDK 文档](#相关-sdk-文档)）。沙箱内没有运行中的服务器时会报告 `No SandboxServer reachable`。

---

## 第八步：销毁沙箱

```bash
# 销毁单个沙箱
abx kill sbx-xxxx

# 销毁所有沙箱（需确认）
abx kill --all

# 跳过确认
abx kill --all --yes
```

---

## 使用模板

### 从 GitHub 安装模板

```bash
abx template install owner/repo
abx template install owner/repo@v1.0
abx template install owner/repo//subdir
```

### 使用已安装的模板

```bash
abx create --template my-template
```

### 本地脚手架生成模板

```bash
# 基于内置 python 案例生成 ./python/
abx template init -t python

# 或生成到指定目录
abx template init -t python ./my-template
```

引导式凭证配置是 `abx config init`；不存在顶层 `abx init`。

#### 适配已有项目

```bash
# Qwen Code 给 ./my-app 补上 Dockerfile、commands.py 和 template.yaml
abx template init --adopt ./my-app --hint "监听 8080"

# 列出将要发送的文件。不调用模型，也不写文件
abx template init --adopt ./my-app --dry-run

# 然后发布（无需 LLM）
abx deploy ./my-app --acr-namespace my-ns
```

`--adopt` 会先把项目复制到临时目录。`.env`、密钥和内容看起来像密钥的文件不会进入这份副本，预览确认后才写回模板文件。非交互终端需要 `-y`。细节见 [编写模板](authoring-templates.md#适配已有项目)。

#### 交互式案例选择

- **TTY**：不带 `-t` 执行 `abx template init` 时，会出现内置案例的上下键（↑/↓）选择器；`Enter` 确认，`Ctrl+C` 中止且不写任何文件。
- **非 TTY / CI / `--json`**：选择器绝不阻塞——命令快速失败并列出可用案例（请使用 `-t python|node|minimal` 或 `--list`），保证脚本行为确定。

#### 固定的顶层快捷方式

`abx --help` 在 **Sandbox shortcuts** 下列出一组固定的快捷方式：`create`、`list`、`info`、`kill`、`exec`、`connect`、`upload`、`download`、`run`、`deploy`。每一个都标注为“Same as 'abx …'”（`abx create` = `abx sandbox create`，`abx run` = `abx sandbox command run`，`abx deploy` = `abx template deploy`）。它们是硬编码的：没有配置项，也没有顶层 `init` 或 `install`。

未知顶层命令会得到针对性提示：`abx crate` → `Did you mean 'create'?`；无相近候选时，错误信息指向 `abx --help`、`abx template init|install` 与 `abx run SANDBOX NAME`。完整命令树见 [CLI 命令参考](../reference/cli-commands.md)。

### 一键部署自定义模板

```bash
abx template deploy ./my-template \
  --acr-namespace my-ns --acr-repo my-template
```

`template deploy` 会自动完成：本地 Docker 构建 → ACR 推送 → 调用 CreateTemplate API。终端上，每一步都是会走动的 `message... 12s` 标题，下方以灰色显示最近六行日志。见 [命令执行时看到什么](#命令执行时看到什么)，模板文件见 [模板编写指南](authoring-templates.md)。

---

## 配置管理

```bash
# 查看配置
abx config list
abx config get sandbox_api_key

# 设置配置
abx config set region cn-beijing
abx config set http_timeout 60

# 清除单个已存储的值（回到默认值 / not set）
abx config set region ""
```

可用配置键：`sandbox_api_key`、`api_url`、`region`、`http_timeout`、`max_retries`、`domain`、`llm_api_key`、`llm_model`、`llm_base_url`、`github_token`、`access_key_id`、`access_key_secret`、`acr_namespace`。`api_key` 仍可作为 `sandbox_api_key` 的别名。

> **提示：** 在使用 `abx template search` / `abx template install` 时遇到 GitHub 匿名限流？在交互式终端执行 `abx config set github_token`（星号掩码输入，存入 `~/.abx/.env`），或在 CI 中以 Secret 注入 `GITHUB_TOKEN`。`--token` 优先级说明见[认证详解](authentication.md)与 CLI 参考。
>
> **本地预检：** 推送前运行 `make ci`——它在单个本地 Node.js 版本上等价复刻 GitHub Actions 流水线（类型检查、构建、非 integration 全量测试、parity 覆盖检查）。

---

## MCP 集成

将 Agent Sandbox 作为本地 STDIO MCP Server 提供给 AI IDE 使用。STDIO 模式不需要 HTTP 传输依赖：

```bash
# 安装到 Cursor
abx mcp install --target cursor

# 安装到 Claude Desktop
abx mcp install --target claude

# 查看 MCP 状态
abx mcp status

# 手动启动：配置写到 stderr，停在 stdin 上等 JSON-RPC
abx mcp start --template code-interpreter-v1
# 另一个终端：abx mcp stop
# 后台 HTTP：abx mcp start --http --background
```

### 远程 MCP Server 部署产物

生成用于手动部署到阿里云 FC 的 Streamable HTTP MCP 产物。该命令不会调用 FC 部署 API：

```bash
# 使用新生成的 Bearer Token 创建产物
abx mcp deploy --generate-token --api-key $ABX_SANDBOX_API_KEY \
  --output-dir ./deploy-artifact
```

HTTP 运行时需安装 `agent-sandbox[mcp]`。随后使用阿里云 FC 官方控制台或 SDK 打包产物、创建函数与 HTTP Trigger。`config.yaml` 是与平台 API 无关的检查清单，不是 FC API 请求体；请通过官方界面转换其中的设置。将输出的 IDE 模板中的 URL 与 token 占位符替换为部署后的实际值。

客户端结束会话时应调用 `DELETE /mcp`。`GET /mcp` 返回 405，SSE 服务端通知尚未实现。`abx mcp deploy` 在没有非空 Bearer token 时会拒绝生成产物。`config.yaml` 可能包含明文凭证，请勿将部署产物或填入凭证后的 IDE 配置提交到版本库。

---

## 命令执行时看到什么

可能停住的步骤在 **stderr** 上画一块：

```text
Building Docker image locally: my-template:latest... 12s
#5 [1/2] FROM ubuntu:22.04
#5 DONE 0.1s
```

标题上的耗时大约每秒走一次，工具暂时没有输出时也一样。灰色行是最近六行（`ABX_ACTIVITY_LINES`，1 到 10）。创建沙箱、上传、下载、拉取模板或模板索引、用镜像注册模板、安装 coding-agent CLI、`abx kill --all`，以及部署的每个阶段（构建、推送、等到 READY），都用这一块。

灰色行会带上一小段已脱敏的工具详情（命令、url、查询或路径），以及相对路径、安装阶段（镜像源、校验和、解压）、docker 或轮询输出，还有销毁时的 `i/N <id>`。文件内容、思考内容和凭证保持隐藏。ACR token 和 `--build-arg` 的值不会出现。

`--json`、`--quiet`、`--ci`、`TERM=dumb` 和非 TTY 不画这个标题。这些模式下，部署仍是每个阶段一行 progress。`--verbose` 改为打印完整的部署日志；其余命令在终端上仍保留标题。结果留在 stdout。

## 全局选项

`abx` 命令支持以下全局选项，可在任何子命令前使用：

| 选项 | 说明 |
|------|------|
| `--json` / `-j` | 以 JSON 格式输出，方便脚本解析 |
| `--quiet` / `-q` | 最小化输出 |
| `--no-color` | 禁用彩色输出 |
| `--ci` | CI/CD 模式（等同 `--quiet --no-color --json`） |

详细全局选项列表（含 `--verbose`、`--log-level`、`--timeout` 等）参见 [CLI 参考手册 — 全局选项](../reference/cli-reference.md#全局选项)。注意 `--region`/`-r` 是命令级选项（`abx list`、`abx kill`、模板控制面命令与 `abx mcp deploy` 支持），并非全局选项；持久默认值请通过 `abx config set region` 设置。

---

## CI/CD 模式

在自动化环境中使用 `--ci` 标志：

```bash
abx --ci create --template base
# 等同于 --quiet --no-color --json
```

结合 `--json` 可获取机器可读的输出：

```bash
abx --json list | jq '.[] | .sandbox_id'
```

---

## 下一步

- [认证详解](authentication.md) — 深入了解认证方式和配置优先级
- [模板使用](using-templates.md) — 了解模板的查找、安装和使用
- [CLI 参考手册](../reference/cli-reference.md) — 所有命令的完整参考

## 相关 SDK 文档

- [SDK 使用指南](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/sdk-usage.md) — 在 Python 代码中使用 Agent Sandbox
- [Server API](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/design/server-api.md) — `@registry.command` 背后的沙箱内 Server SDK（机制 B）

