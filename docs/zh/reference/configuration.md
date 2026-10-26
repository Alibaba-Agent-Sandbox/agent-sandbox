# 配置参考

> 范围：本页说明原生 provider/MCP 的配置和错误。原生配置使用 `ABX_SANDBOX_API_KEY`、`ABX_SANDBOX_BASE_URL`、`ABX_SANDBOX_DOMAIN`。标准极速版命令入口额外接受 `E2B_API_KEY`、`E2B_API_URL`、`E2B_DOMAIN`，仅在该入口映射，并回退到项目配置。标准命令选项、终端环境变量和错误行为见[迁移指南](../guide/migrate-from-e2b.md)。

本文档列出 Agent Sandbox 的所有配置项、环境变量、默认值和优先级规则。

---

## 配置优先级

配置按以下优先级加载（从高到低）：

```text
1. 显式选项 / 参数（CLI 选项如 --region；SDK 关键字参数）   ← 最高
2. 进程环境变量
3. .env 文件（先 ./.env，然后 ~/.abx/.env）
4. ~/.abx/config.toml
5. 内置默认值                                  ← 最低
```

每个键只有一个环境变量。第一个设置了该变量的层决定结果。内置提供方读取 `ABX_SANDBOX_API_KEY`、`ABX_SANDBOX_BASE_URL`、`ABX_SANDBOX_DOMAIN`、`ALICLOUD_ACCESS_KEY_ID`、`ALICLOUD_ACCESS_KEY_SECRET` 和 `ALIBABA_CLOUD_REGION_ID`。不读取 `E2B_API_KEY`、`E2B_API_URL`、`E2B_DOMAIN`、`AccessKey`、`AccessSecret`、`ALIBABA_CLOUD_ACCESS_KEY_ID`、`ALIBABA_CLOUD_ACCESS_KEY_SECRET`。

`.env` 文件按**键**合并。同一个键两边都有时，`./.env` 优先于 `~/.abx/.env`。项目文件里没有的键，仍然来自 `~/.abx/.env`。

空白或只含空格的值不算已配置，也不会挡住下一层。

## 凭证解析

每项凭证在真正使用时都按这个顺序。`abx config list` 会标出来源：`(env)`、`(user)`、`(default)` 或 `(not set)`。

每个键只有一个名字。产品自己的设置用 `ABX_<KEY>`。厂商已经公布的变量就用那个变量：阿里云 AccessKey 是 `ALICLOUD_ACCESS_KEY_ID` 和 `ALICLOUD_ACCESS_KEY_SECRET`，地域是 `ALIBABA_CLOUD_REGION_ID`，ACR 是 `ACR_NAMESPACE` 以及对应的 `ACR_*`，GitHub token 是 `GITHUB_TOKEN`。`team_id` 可选，不是必填项；它的环境变量是 `ABX_ALICLOUD_EXPRESS_TEAM_ID`。

| 要用的值 | 键 | 环境变量 |
|---|---|---|
| 沙箱 API Key | `sandbox_api_key` | `ABX_SANDBOX_API_KEY` |
| 沙箱 API 地址 | `sandbox_base_url` | `ABX_SANDBOX_BASE_URL` |
| 数据平面域名 | `sandbox_domain` | `ABX_SANDBOX_DOMAIN` |
| 地域 | `region` | `ALIBABA_CLOUD_REGION_ID` |
| 阿里云 AK / SK | `access_key_id` / `access_key_secret` | `ALICLOUD_ACCESS_KEY_ID` / `ALICLOUD_ACCESS_KEY_SECRET` |
| ACR 命名空间 / 密码 | `acr_namespace` / `acr_password` | `ACR_NAMESPACE` / `ACR_PASSWORD` |
| 应用访问令牌 | `server_token` | `ABX_SERVER_TOKEN` |
| GitHub token | `server_token` | `ABX_SERVER_TOKEN` | CLI 应用令牌；初始化时自动生成，保存在 `~/.abx/.env`，显示时脱敏 |
| `github_token` | `GITHUB_TOKEN` |
| LLM API Key | `llm_api_key` | `ABX_LLM_API_KEY` |
| LLM 地址 | `llm_base_url` | `ABX_LLM_BASE_URL` |
| LLM 模型 | `llm_model` | `ABX_LLM_MODEL` |
| 默认提供方 | `provider` | `ABX_PROVIDER` |
| 团队 id（可选） | `team_id` | `ABX_ALICLOUD_EXPRESS_TEAM_ID` |

下面这些调用读的是同一条链：

- 自然语言 `abx create`（编码代理）
- `abx template install` / `abx template search`（GitHub token）
- `abx mcp install` / `abx mcp start`（解析 Sandbox 访问，不把密钥复制到 IDE 文件）

`abx mcp install` 不把 Sandbox 凭证复制到 Cursor、Claude 或 VS Code 文件；它记录启动命令及适用的非密钥目标信息。编辑器启动 `abx mcp start` 时会重新解析用户和 Provider 配置。仅本次输入不会传到之后的进程；需要后续启动使用时应明确保存。就地补填、持久化、来源冲突和自动化边界见[配置引导](../guide/guided-configuration.md)。

`abx config list` 把进程环境变量标成 `(env)`，把 `./.env` 和 `~/.abx` 标成 `(user)`。表里命中的那一列就是命令真正会用的值。

---

沙箱调用需要 `ABX_SANDBOX_API_KEY`；AK/SK 用于独立官方控制面，不能替代沙箱密钥。见[鉴权迁移](../guide/authentication.md)。

## 环境变量

### 与 Python SDK 共用

| 环境变量 | 配置键 | 说明 |
|---------------------|-------------|-------------|
| `ABX_PROVIDER` | `provider` | 默认提供方 id |
| `ABX_SANDBOX_API_KEY` | `sandbox_api_key` | 沙箱 API Key |
| `ABX_SANDBOX_BASE_URL` | `sandbox_base_url` | 平台 API URL |
| `ABX_SANDBOX_DOMAIN` | `sandbox_domain` | 数据平面域名 |
| `ALIBABA_CLOUD_REGION_ID` | `region` | 地域 |
| `ABX_HTTP_TIMEOUT` | `http_timeout` | HTTP 超时秒数 |
| `ABX_LOG_LEVEL` | `log_level` | SDK 日志级别 |
| `ABX_DEFAULT_TEMPLATE` | `default_template` | 默认模板 |
| `ALICLOUD_ACCESS_KEY_ID` | `access_key_id` | 阿里云 AccessKey ID |
| `ALICLOUD_ACCESS_KEY_SECRET` | `access_key_secret` | 阿里云 AccessKey Secret |
| `GITHUB_TOKEN` | `github_token` | GitHub token（模板下载用；用 `abx config set github_token` 保存；CI 以 Secret 注入） |

从 CLI 0.4.17 起，`ABX_HTTP_TIMEOUT` 也作用于 `abx run` 及命令发现的每次应用 HTTP 请求，默认 30 秒。长任务可以在调用前设置，例如 `ABX_HTTP_TIMEOUT=330 abx run "$SANDBOX_ID" qwen --json-args '{"prompt":"检查已上传的项目","command_timeout":300}'`。HTTP 超时只停止等待响应，不会取消远端命令。

### 仅 CLI：模板构建与生成

Python SDK 是运行时客户端，不声明这些键；CLI 在 `src/utils/cli_config_keys.ts` 中声明它们。

| 环境变量 | 配置键 | 说明 |
|---------------------|-------------|-------------|
| `ACR_NAMESPACE` | `acr_namespace` | ACR 命名空间（`abx config set acr_namespace`，或 `abx config init`） |
| `ACR_REGISTRY` | `acr_registry` | ACR 仓库地址 |
| `ACR_REPO` | `acr_repo` | ACR 仓库 |
| `ACR_USERNAME` | `acr_username` | ACR 用户名 |
| `ACR_PASSWORD` | `acr_password` | ACR 密码 |
| `ACREE_INSTANCE_ID` | `acr_instance_id` | ACR 企业版实例 |
| `ACR_VPC_ID` | `acr_vpc_id` | ACR VPC |
| `ACR_VSWITCH_IDS` | `acr_vswitch_ids` | ACR 交换机 id（逗号分隔） |
| `ACR_SECURITY_GROUP_ID` | `acr_security_group_id` | ACR 安全组 |
| `ABX_ALICLOUD_EXPRESS_TEAM_ID` | `team_id` | 团队 id。可选。不是必填项。 |
| `ABX_LLM_API_KEY` | `llm_api_key` | LLM API Key（用 `abx config set llm_api_key` 保存） |
| `ABX_LLM_BASE_URL` | `llm_base_url` | LLM 地址 |
| `ABX_LLM_MODEL` | `llm_model` | LLM 模型名 |

每一行都是该键唯一的环境变量。完整链路见[凭证解析](#凭证解析)。

### CLI 显示

这些变量改变终端上显示的内容。`abx config` 不存储它们。

| 环境变量 | 默认值 | 说明 |
|---------------------|---------|-------------|
| `ABX_ACTIVITY_LINES` | `4` | `message... 12s` 标题下方的灰色行数（整数 1–10）。部署、创建、上传、下载、拉取模板、用镜像注册模板、安装 coding-agent 和 `abx kill --all` 都会用到。 |

`--json`、`--quiet`、`--ci`、`TERM=dumb` 和非 TTY 不绘制该标题。见[命令运行期间](../guide/cli-tutorial.md#命令执行时看到什么)。

## config.toml 配置

配置文件路径：`~/.abx/config.toml`

```toml
[core]
provider = "alicloud-express"

[transport]
sandbox_base_url = "https://api.cn-hangzhou.e2b.fc.aliyuncs.com"
sandbox_domain = "cn-hangzhou.e2b.fc.aliyuncs.com"
http_timeout = 30.0

[providers.alicloud-express]
region = "cn-hangzhou"
```

顶层快捷方式固定在 CLI 中，没有配置段。

---

## CLI 配置命令

用 `abx config` 管理配置：

```bash
# 查看全部配置（带来源标注）
abx config list

# 读取单个值
abx config get sandbox_api_key

# 设置一个值
abx config set sandbox_api_key your-new-key
abx config set region cn-beijing
abx config set http_timeout 60

# 模板下载用的 GitHub token（省略 VALUE 时以星号提示输入）
abx config set github_token
abx config set github_token ghp_xxxxxxxxxxxx

# 清除单个已保存的值（回到默认 / 未设置）
abx config set region ""
abx config set github_token ""
```

这里设置的 `region` 是区域命令的**持久默认值**。单次调用可以用命令级 `--region`/`-r` 覆盖（`abx list`、`abx kill --all`、模板控制面命令和 `abx mcp deploy` 都接受）。解析优先级：命令 `--region` > `ALIBABA_CLOUD_REGION_ID` > `abx config set region` > `cn-hangzhou`。

### 可通过 abx config 配置的键

| 配置键 | 环境变量 | 说明 |
|-----------|-------------|-------------|
| `sandbox_api_key` | `ABX_SANDBOX_API_KEY` | 沙箱服务 API Key（存在 `~/.abx/.env`） |
| `sandbox_base_url` | `ABX_SANDBOX_BASE_URL` | 平台 API URL |
| `region` | `ALIBABA_CLOUD_REGION_ID` | 地域 |
| `http_timeout` | `ABX_HTTP_TIMEOUT` | HTTP 超时秒数 |
| `sandbox_domain` | `ABX_SANDBOX_DOMAIN` | 数据平面域名 |
| `llm_api_key` | `ABX_LLM_API_KEY` | LLM API Key，供自然语言推理和编码代理使用 |
| `llm_model` | `ABX_LLM_MODEL` | LLM 模型名称（默认 `qwen3-coder-plus`） |
| `llm_base_url` | `ABX_LLM_BASE_URL` | LLM API Base URL（默认 DashScope compatible-mode） |
| `access_key_id` | `ALICLOUD_ACCESS_KEY_ID` | 阿里云 AccessKey ID（官方控制面凭据） |
| `access_key_secret` | `ALICLOUD_ACCESS_KEY_SECRET` | 阿里云 AccessKey Secret（官方控制面凭据） |
| `acr_namespace` | `ACR_NAMESPACE` | `abx template install` / `abx template deploy` 用的（用 `abx config init --build` 设置） ACR 命名空间 |
| `github_token` | `GITHUB_TOKEN` | GitHub token（模板下载用，`abx template install` / `abx template search`；存 `~/.abx/.env`，脱敏显示） |
| `team_id` | `ABX_ALICLOUD_EXPRESS_TEAM_ID` | 团队 id。可选。不是必填项。 |

### 引导式配置（abx config init）

```bash
abx config init
```

交互式向导依次提示：沙箱 API Key、默认区域、LLM API Key、ACR 命名空间（`ACR_NAMESPACE`）、AccessKey ID、AccessKey Secret。直接回车跳过该项。密钥和命名空间以每个键唯一的变量写入 `~/.abx/.env`，区域写入 `~/.abx/config.toml`。非 TTY 环境或 `--yes` 下不阻塞，打印等效的 `abx config set` 命令。

### AK/SK 控制面配置

`access_key_id` 和 `access_key_secret` 通过 `abx config set` 设置后，以 `ALICLOUD_ACCESS_KEY_ID` 和 `ALICLOUD_ACCESS_KEY_SECRET` 存储在 `~/.abx/.env` 中。用于官方模板/镜像/ACR 控制面操作，不会自动交换沙箱 API Key。

配置列表、读取结果和设置确认会对 AccessKey ID 与 Secret 脱敏，包括 JSON 和指定 Provider 的命令；认证使用的存储值仍然完整。

沙箱运行时仍须独立配置 API Key。详见 [认证详解](../guide/authentication.md#aksk-阿里云扩展认证-)。

---

## .env 文件

CLI 会读取这两个 `.env` 并按键合并：

1. 当前目录下的 `.env`（写了该键时优先）
2. `~/.abx/.env`（项目文件没有的键用这里的值）

`.env` 文件格式。每个键使用它那一个变量：

```bash
ABX_SANDBOX_API_KEY=your-api-key
ALIBABA_CLOUD_REGION_ID=cn-beijing
```

`abx config set sandbox_api_key <KEY>` 命令将 API Key 以 `ABX_SANDBOX_API_KEY` 保存到 `~/.abx/.env`（文件权限 600）。`github_token` 存为 `GITHUB_TOKEN`。

---

## 配置文件位置汇总

| 文件 | 路径 | 说明 |
|------|------|------|
| config.toml | `~/.abx/config.toml` | CLI 扩展配置（`[core]`、`[transport]`、`[providers.<id>]`、LLM 默认值） |
| .env | `~/.abx/.env` | 认证凭证（`abx config set` 写入） |
| .env（本地） | `./.env` | 项目级环境变量 |
| 会话存储 | `~/.abx/sessions/*.json` | 本地会话数据 |
| 模板缓存 | `~/.abx/templates/` | 已安装的模板 |

---

## 相关 SDK 文档

`TransportConfig` 字段表（类型、默认值、自动区域推导）、SDK 参数覆盖、沙箱内 Server 变量（`ABX_SERVER_*`、`ABX_PTY_PORT`、`ABX_MAX_UPLOAD_SIZE`）以及部署相关的 LLM 变量，记录在 `python-sdk` 仓库中 SDK 的[配置参考](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/reference/configuration.md)里。

### 传输尝试

内置平台/envd HTTP 每次只执行一次传输尝试，提供方引擎的读取恢复独立处理。应用重试安全读取时应限制次数；写操作结果未知时，应先核对远端状态，再决定是否重新执行。
