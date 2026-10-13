# 配置参考

本文档列出 Easy Sandbox 的所有配置项、环境变量、默认值和优先级规则。

---

## 配置优先级

配置按以下优先级加载（从高到低）：

```text
1. 显式选项 / 参数（CLI 选项如 --region；SDK 关键字参数）   ← 最高
2. 进程环境变量
3. .env 文件（先 ./.env，然后 ~/.ebx/.env）
4. ~/.ebx/config.toml
5. 内置默认值                                  ← 最低
```

每个键只有一个环境变量。第一个设置了该变量的层决定结果。

`.env` 文件按**键**合并。同一个键两边都有时，`./.env` 优先于 `~/.ebx/.env`。项目文件里没有的键，仍然来自 `~/.ebx/.env`。

空白或只含空格的值不算已配置，也不会挡住下一层。

## 凭证解析

每项凭证在真正使用时都按这个顺序。`ebx config list` 会标出来源：`(env)`、`(user)`、`(default)` 或 `(not set)`。

每个键只有一个名字。产品自己的设置用 `EBX_<KEY>`。厂商已经公布的变量就用那个变量：阿里云 AccessKey 是 `ALICLOUD_ACCESS_KEY_ID` 和 `ALICLOUD_ACCESS_KEY_SECRET`，地域是 `ALIBABA_CLOUD_REGION_ID`，ACR 是 `ACR_NAMESPACE` 以及对应的 `ACR_*`，GitHub token 是 `GITHUB_TOKEN`。`team_id` 可选，不是必填项；它的环境变量是 `EBX_ALICLOUD_EXPRESS_TEAM_ID`。

| 要用的值 | 键 | 环境变量 |
|---|---|---|
| 沙箱 API Key | `sandbox_api_key` | `EBX_SANDBOX_API_KEY` |
| 沙箱 API 地址 | `sandbox_base_url` | `EBX_SANDBOX_BASE_URL` |
| 数据平面域名 | `sandbox_domain` | `EBX_SANDBOX_DOMAIN` |
| 地域 | `region` | `ALIBABA_CLOUD_REGION_ID` |
| 阿里云 AK / SK | `access_key_id` / `access_key_secret` | `ALICLOUD_ACCESS_KEY_ID` / `ALICLOUD_ACCESS_KEY_SECRET` |
| ACR 命名空间 / 密码 | `acr_namespace` / `acr_password` | `ACR_NAMESPACE` / `ACR_PASSWORD` |
| GitHub token | `github_token` | `GITHUB_TOKEN` |
| LLM API Key | `llm_api_key` | `EBX_LLM_API_KEY` |
| LLM 地址 | `llm_base_url` | `EBX_LLM_BASE_URL` |
| LLM 模型 | `llm_model` | `EBX_LLM_MODEL` |
| 默认提供方 | `provider` | `EBX_PROVIDER` |
| 团队 id（可选） | `team_id` | `EBX_ALICLOUD_EXPRESS_TEAM_ID` |

下面这些调用读的是同一条链：

- 自然语言 `ebx create`（编码代理）
- `ebx template install` / `ebx template search`（GitHub token）
- `ebx mcp install`（写入编辑器配置的沙箱 API Key）

`ebx mcp install` 把 `EBX_SANDBOX_API_KEY` 写入 Cursor 和 Claude 的配置。`EBX_SANDBOX_BASE_URL` 和 `ALIBABA_CLOUD_REGION_ID` 只有在进程环境变量里设置了才会写进同一份文件。`ebx mcp start` 会再次读取 `~/.ebx`，所以用 `ebx config set region` 保存的区域在编辑器启动 server 时仍然生效。

`ebx config list` 把进程环境变量标成 `(env)`，把 `./.env` 和 `~/.ebx` 标成 `(user)`。表里命中的那一列就是命令真正会用的值。

---

## 环境变量

### 通用（SDK 与 CLI）

| 环境变量 | 配置键 | 说明 |
|---------------------|-------------|-------------|
| `EBX_PROVIDER` | `provider` | 默认提供方 id |
| `EBX_SANDBOX_API_KEY` | `sandbox_api_key` | 沙箱 API Key |
| `EBX_SANDBOX_BASE_URL` | `sandbox_base_url` | 平台 API URL |
| `EBX_SANDBOX_DOMAIN` | `sandbox_domain` | 数据平面域名 |
| `ALIBABA_CLOUD_REGION_ID` | `region` | 地域 |
| `EBX_HTTP_TIMEOUT` | `http_timeout` | HTTP 超时秒数 |
| `EBX_LOG_LEVEL` | `log_level` | SDK 日志级别 |
| `EBX_DEFAULT_TEMPLATE` | `default_template` | 默认模板 |
| `ALICLOUD_ACCESS_KEY_ID` | `access_key_id` | 阿里云 AccessKey ID |
| `ALICLOUD_ACCESS_KEY_SECRET` | `access_key_secret` | 阿里云 AccessKey Secret |
| `ACR_NAMESPACE` | `acr_namespace` | ACR 命名空间（`ebx config set acr_namespace`，或 `ebx config init`） |
| `ACR_REGISTRY` | `acr_registry` | ACR 仓库地址 |
| `ACR_REPO` | `acr_repo` | ACR 仓库 |
| `ACR_USERNAME` | `acr_username` | ACR 用户名 |
| `ACR_PASSWORD` | `acr_password` | ACR 密码 |
| `ACREE_INSTANCE_ID` | `acr_instance_id` | ACR 企业版实例 |
| `ACR_VPC_ID` | `acr_vpc_id` | ACR VPC |
| `ACR_VSWITCH_IDS` | `acr_vswitch_ids` | ACR 交换机 id（逗号分隔） |
| `ACR_SECURITY_GROUP_ID` | `acr_security_group_id` | ACR 安全组 |
| `EBX_ALICLOUD_EXPRESS_TEAM_ID` | `team_id` | 团队 id。可选。不是必填项。 |
| `GITHUB_TOKEN` | `github_token` | GitHub token（模板下载用；用 `ebx config set github_token` 保存；CI 以 Secret 注入） |
| `EBX_LLM_API_KEY` | `llm_api_key` | LLM API Key（用 `ebx config set llm_api_key` 保存） |
| `EBX_LLM_BASE_URL` | `llm_base_url` | LLM 地址 |
| `EBX_LLM_MODEL` | `llm_model` | LLM 模型名 |

每一行都是该键唯一的环境变量。完整链路见[凭证解析](#凭证解析)。

### CLI 显示

这些变量改变终端上显示的内容。`ebx config` 不存储它们。

| 环境变量 | 默认值 | 说明 |
|---------------------|---------|-------------|
| `EBX_ACTIVITY_LINES` | `4` | `message... 12s` 标题下方的灰色行数（整数 1–10）。部署、创建、上传、下载、拉取模板、用镜像注册模板、安装 coding-agent 和 `ebx kill --all` 都会用到。 |

`--json`、`--quiet`、`--ci`、`TERM=dumb` 和非 TTY 不绘制该标题。见[命令运行期间](../guide/cli-tutorial.md#命令运行期间)。

## config.toml 配置

配置文件路径：`~/.ebx/config.toml`

```toml
[core]
provider = "alicloud-express"

[transport]
sandbox_base_url = "https://api.cn-hangzhou.e2b.fc.aliyuncs.com"
sandbox_domain = "cn-hangzhou.e2b.fc.aliyuncs.com"
http_timeout = 30.0
max_retries = 3

[providers.alicloud-express]
region = "cn-hangzhou"

[shortcuts]
init = "template init"          # 命令路径，不要写成 "ebx template init"
ps   = "sandbox process list"
```

`[shortcuts]` 把顶层别名映射到一条命令路径。值不包含 `ebx` 前缀。`ebx config set shortcuts.ps "ebx sandbox process list"` 会被拒绝；应写成 `"sandbox process list"`。文件里已经写错的行在下次启动时被跳过，其他别名仍然有效。见[快捷方式别名](cli-reference.md#快捷方式别名shortcutsalias)。

---

## CLI 配置命令

用 `ebx config` 管理配置：

```bash
# 查看全部配置（带来源标注）
ebx config list

# 读取单个值
ebx config get sandbox_api_key

# 设置一个值
ebx config set sandbox_api_key your-new-key
ebx config set region cn-beijing
ebx config set http_timeout 60

# 模板下载用的 GitHub token（省略 VALUE 时以星号提示输入）
ebx config set github_token
ebx config set github_token ghp_xxxxxxxxxxxx

# 清除单个已保存的值（回到默认 / 未设置）
ebx config set region ""
ebx config set github_token ""
```

这里设置的 `region` 是区域命令的**持久默认值**。单次调用可以用命令级 `--region`/`-r` 覆盖（`ebx list`、`ebx kill --all`、模板控制面命令和 `ebx mcp deploy` 都接受）。解析优先级：命令 `--region` > `ALIBABA_CLOUD_REGION_ID` > `ebx config set region` > `cn-hangzhou`。

### 可通过 ebx config 配置的键

| 配置键 | 环境变量 | 说明 |
|-----------|-------------|-------------|
| `sandbox_api_key` | `EBX_SANDBOX_API_KEY` | 沙箱服务 API Key（存在 `~/.ebx/.env`） |
| `sandbox_base_url` | `EBX_SANDBOX_BASE_URL` | 平台 API URL |
| `region` | `ALIBABA_CLOUD_REGION_ID` | 地域 |
| `http_timeout` | `EBX_HTTP_TIMEOUT` | HTTP 超时秒数 |
| `max_retries` | `EBX_MAX_RETRIES` | 最大重试次数 |
| `sandbox_domain` | `EBX_SANDBOX_DOMAIN` | 数据平面域名 |
| `llm_api_key` | `EBX_LLM_API_KEY` | LLM API Key，供自然语言推理和编码代理使用 |
| `llm_model` | `EBX_LLM_MODEL` | LLM 模型名称（默认 `qwen3-coder-plus`） |
| `llm_base_url` | `EBX_LLM_BASE_URL` | LLM API Base URL（默认 DashScope compatible-mode） |
| `access_key_id` | `ALICLOUD_ACCESS_KEY_ID` | 阿里云 AccessKey ID（🧪 实验性 AK/SK 认证） |
| `access_key_secret` | `ALICLOUD_ACCESS_KEY_SECRET` | 阿里云 AccessKey Secret（🧪 实验性 AK/SK 认证） |
| `acr_namespace` | `ACR_NAMESPACE` | `ebx install` / `ebx template deploy` 用的 ACR 命名空间 |
| `github_token` | `GITHUB_TOKEN` | GitHub token（模板下载用，`ebx template install` / `ebx template search`；存 `~/.ebx/.env`，脱敏显示） |
| `team_id` | `EBX_ALICLOUD_EXPRESS_TEAM_ID` | 团队 id。可选。不是必填项。 |

### 引导式配置（ebx config init）

```bash
ebx config init
```

交互式向导依次提示：沙箱 API Key、默认区域、LLM API Key、ACR 命名空间（`ACR_NAMESPACE`）、AccessKey ID、AccessKey Secret。直接回车跳过该项。密钥和命名空间以每个键唯一的变量写入 `~/.ebx/.env`，区域写入 `~/.ebx/config.toml`。非 TTY 环境或 `--yes` 下不阻塞，打印等效的 `ebx config set` 命令。

### AK/SK 认证配置（实验性）

`access_key_id` 和 `access_key_secret` 通过 `ebx config set` 设置后，以 `ALICLOUD_ACCESS_KEY_ID` 和 `ALICLOUD_ACCESS_KEY_SECRET` 存储在 `~/.ebx/.env` 中。用于 AK/SK → API Key 的 token 交换认证。

> **注意**：此功能为实验性支持，token 交换端点待 FC 平台确认。详见 [认证详解](../guide/authentication.md#aksk-阿里云扩展认证-)。

---

## .env 文件

CLI 会读取这两个 `.env` 并按键合并：

1. 当前目录下的 `.env`（写了该键时优先）
2. `~/.ebx/.env`（项目文件没有的键用这里的值）

`.env` 文件格式。每个键使用它那一个变量：

```bash
EBX_SANDBOX_API_KEY=your-api-key
ALIBABA_CLOUD_REGION_ID=cn-beijing
```

`ebx config set sandbox_api_key <KEY>` 命令将 API Key 以 `EBX_SANDBOX_API_KEY` 保存到 `~/.ebx/.env`（文件权限 600）。`github_token` 存为 `GITHUB_TOKEN`。

---

## 配置文件位置汇总

| 文件 | 路径 | 说明 |
|------|------|------|
| config.toml | `~/.ebx/config.toml` | CLI 扩展配置（`[core]`、`[transport]`、`[providers.<id>]`、`[shortcuts]`、LLM 默认值） |
| .env | `~/.ebx/.env` | 认证凭证（`ebx config set` 写入） |
| .env（本地） | `./.env` | 项目级环境变量 |
| 会话存储 | `~/.ebx/sessions/*.json` | 本地会话数据 |
| 模板缓存 | `~/.ebx/templates/` | 已安装的模板 |

---

## 相关 SDK 文档

`TransportConfig` 字段表（类型、默认值、自动区域推导）、SDK 参数覆盖、沙箱内 Server 变量（`EBX_SERVER_*`、`EBX_PTY_PORT`、`EBX_MAX_UPLOAD_SIZE`）以及部署相关的 LLM 变量，记录在 `python-sdk` 仓库中 SDK 的[配置参考](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/zh/reference/configuration.md)里。
