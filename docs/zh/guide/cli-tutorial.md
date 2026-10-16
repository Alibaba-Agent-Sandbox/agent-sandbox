# CLI 教程

本教程带你从安装开始，逐步掌握 `abx` CLI 的完整沙箱生命周期、模板使用和 MCP 集成。

---

## 第一步：安装

```bash
# 新版本发布前从当前检出目录构建
npm ci
npm run build
node dist/bin/abx.js --version
```

以下示例使用已安装二进制的 abx 名称；从检出目录运行时，将前缀替换为 `node /绝对路径/dist/bin/abx.js`：

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
export E2B_API_KEY="your-api-key"
```

> 更多认证方式（AK/SK、.env 文件、config.toml 等）详见 [认证详解](authentication.md)。

---

## 第三步：创建沙箱

极速版标准命令遵循[固定 E2B 契约](migrate-from-e2b.md)。位置参数是模板，默认 base。为便于后续操作，创建后台沙箱并保存打印的 ID：

```bash
abx create base --detach --timeout 300
```

不传 --detach 时 create 打开真实 PTY；默认退出策略会缩短租期（阿里云最短 TTL 仍适用）。连接已有沙箱时，connect 打开真实 PTY，退出终端后沙箱继续运行。

自然语言是显式项目扩展：

```bash
abx create --prompt "一个 Python 数据分析环境"
abx create --prompt "一个 Node.js API 服务" -y
abx template scaffold --prompt "一个 Python 数据分析环境"
```

项目生成路径可以调研需求、询问缺失的用户偏好，并在确认后构建/部署。scaffold 只写本地文件；template init --name demo --language python-sync 则生成标准 SDK 构建文件，Python 使用 agent_sandbox。已有模板无需 LLM 或 --template。文件单独上传：

```bash
abx upload <sandbox-id> ./project /home/user/project
```

## 第四步：查看和管理沙箱

```bash
abx list --state running --limit 5 --format json
abx info <sandbox-id> --format json
```

标准输出使用 E2B 模型与 --format，项目全局 JSON 信封是另一个扩展接口。保留已配置的 E2B_API_KEY、E2B_API_URL、E2B_DOMAIN。

## 第五步：在沙箱中执行命令

```bash
abx exec <sandbox-id> echo Hello World
abx exec --cwd /tmp --env MODE=test <sandbox-id> sh -c 'printf "$MODE"; exit 7'
abx exec --background <sandbox-id> python -m http.server 8000
abx connect <sandbox-id>
```

本地选项放在沙箱 ID 前，之后所有参数归远程命令。默认流式输出；前台返回远程退出码，后台 PID 写入 stderr。固定版本没有本地 --timeout、--stream。connect 使用真实终端，cwd 与环境变量跨命令保持。依赖管道 EOF 的输入需要后端支持，见迁移指南。

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
abx kill <sandbox-id>
```

标准 kill 没有确认提示或 --yes。--all 会立即删除筛选出的运行中沙箱；清理时使用 ID 或严格的状态/元数据筛选。暂停、快照成功路径需要已启用的函数和受支持的运行时/账号。

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
abx create my-template --detach
```

### 本地脚手架生成模板

```bash
# 基于内置 python 案例生成 ./python/
abx template scaffold -t python

# 或生成到指定目录
abx template scaffold -t python ./my-template
```

引导式凭证配置是 `abx config init`；不存在顶层 `abx init`。

#### 适配已有项目

```bash
# Qwen Code 给 ./my-app 补上 Dockerfile、commands.py 和 template.yaml
abx template scaffold --adopt ./my-app --hint "监听 8080"

# 列出将要发送的文件。不调用模型，也不写文件
abx template scaffold --adopt ./my-app --dry-run

# 然后发布（无需 LLM）
abx deploy ./my-app --acr-namespace my-ns
```

`--adopt` 会先把项目复制到临时目录。`.env`、密钥和内容看起来像密钥的文件不会进入这份副本，预览确认后才写回模板文件。非交互终端需要 `-y`。细节见 [编写模板](authoring-templates.md#适配已有项目)。

#### 交互式案例选择

- **TTY**：不带 `-t` 执行 `abx template scaffold` 时，会出现内置案例的上下键（↑/↓）选择器；`Enter` 确认，`Ctrl+C` 中止且不写任何文件。
- **非 TTY / CI / `--json`**：选择器绝不阻塞——命令快速失败并列出可用案例（请使用 `-t python|node|minimal` 或 `--list`），保证脚本行为确定。

#### 固定的顶层快捷方式

`abx --help` 在 **Sandbox shortcuts** 下列出一组固定的快捷方式：`create`、`list`、`info`、`kill`、`exec`、`connect`、`upload`、`download`、`run`、`deploy`。每一个都标注为“Same as 'abx …'”（`abx create` = `abx sandbox create`，`abx run` = `abx sandbox command run`，`abx deploy` = `abx template deploy`）。它们是硬编码的：没有配置项，也没有顶层 `init` 或 `install`。

未知顶层命令会得到针对性提示：`abx crate` → `Did you mean 'create'?`；无相近候选时，错误信息指向 `abx --help`、`abx template scaffold|install` 与 `abx run SANDBOX NAME`。完整命令树见 [CLI 命令参考](../reference/cli-commands.md)。

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
abx mcp deploy --generate-token --api-key $E2B_API_KEY \
  --output-dir ./deploy-artifact
```

HTTP 运行时需安装 `agent-sandbox-client[mcp]`。随后使用阿里云 FC 官方控制台或 SDK 打包产物、创建函数与 HTTP Trigger。`config.yaml` 是与平台 API 无关的检查清单，不是 FC API 请求体；请通过官方界面转换其中的设置。将输出的 IDE 模板中的 URL 与 token 占位符替换为部署后的实际值。

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

项目扩展按帮助支持 --json/-j、--quiet/-q、--no-color、--verbose、--ci。标准 E2B 命令保留固定参数，例如 list/info --format json。标准后端地址使用 E2B_API_URL/E2B_DOMAIN；region 参数仅适用于帮助中明确提供它的项目管理命令。

见 [CLI 参考 — 全局选项](../reference/cli-reference.md#全局选项)。

## CI/CD 模式

自动化使用后台创建和明确的标准 JSON 格式：

```bash
abx create base --detach --timeout 300
abx list --format json | jq '.[].sandboxId'
```

项目扩展的 --ci 选择自身 JSON/静默接口，不是迁移已有 E2B CLI 脚本的必要步骤。远程 exec 命令参数保留在沙箱 ID 后。

---

## 下一步

- [认证详解](authentication.md) — 深入了解认证方式和配置优先级
- [模板使用](using-templates.md) — 了解模板的查找、安装和使用
- [CLI 参考手册](../reference/cli-reference.md) — 所有命令的完整参考

## 相关 SDK 文档

- [SDK 使用指南](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/sdk-usage.md) — 在 Python 代码中使用 Agent Sandbox
- [Server API](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/design/server-api.md) — `@registry.command` 背后的沙箱内 Server SDK（机制 B）

