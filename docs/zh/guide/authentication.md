# 认证详解

沙箱运行时请求需要 **API Key**；**AK/SK（阿里云 AccessKey）**用于独立的官方控制面操作。

> **历史说明**：`abx auth` CLI 命令组（`login`/`logout`/`status`/`switch`）已在首个正式版 `0.1.0` 之前移除。凭证通过下方介绍的环境变量与 `abx config set sandbox_api_key` 配置；用 `abx config list` 查看生效状态。

---

## 认证方式总览

Agent Sandbox 存在三条认证路径，适用于不同场景：

- **API Key 模式**：最常用。通过 `Authorization: Bearer {api_key}` 请求头访问平台 API。适用于个人开发、CI/CD 等绝大多数场景。
- **AK/SK 控制面**：用于官方模板、镜像与 ACR 操作，不会自动创建或交换沙箱 API Key。
- **envd 内部认证**：沙箱创建后，CLI 与沙箱内部 envd 服务之间的通信认证。使用 `envdAccessToken`（从创建响应中获取），由 CLI 自动管理，用户无需手动处理（请求头说明见文末链接的 SDK 文档）。

---

## API Key 认证

API Key 是最常用的认证方式，通过 `Authorization: Bearer {api_key}` 请求头发送到平台 API。

### 配置方式

#### 1. 环境变量（优先于 `~/.abx`）

```bash
export ABX_SANDBOX_API_KEY="your-api-key"
```

`ABX_SANDBOX_API_KEY` 是沙箱 API Key 唯一的环境变量。不读取 `E2B_API_KEY`。API 地址是 `ABX_SANDBOX_BASE_URL`，数据平面域名是 `ABX_SANDBOX_DOMAIN`（不读取 `E2B_API_URL` 和 `E2B_DOMAIN`）。

#### 2. abx config set（持久化到本地文件）

```bash
abx config set sandbox_api_key your-api-key
# 写入到 ~/.abx/.env
# 文件权限: 600（仅所有者可读写）
```

存储格式为 `ABX_SANDBOX_API_KEY=your-key`，位于 `~/.abx/.env`。

#### 3. .env 文件

在项目根目录创建 `.env` 文件：

```dotenv
ABX_SANDBOX_API_KEY=your-api-key
```

CLI 按键合并 `.env`。`./.env` 写了该键时优先；没写的键仍然来自 `~/.abx/.env`。

1. 当前目录下的 `.env`
2. `~/.abx/.env`

#### 4. config.toml 文件

在 `~/.abx/config.toml` 中设置：

```toml
[transport]
sandbox_base_url = "https://api.cn-hangzhou.e2b.fc.aliyuncs.com"
sandbox_domain = "cn-hangzhou.e2b.fc.aliyuncs.com"
```

沙箱 API Key 存在 `~/.abx/.env` 的 `ABX_SANDBOX_API_KEY`，不放在 `config.toml`。

<a id="aksk-阿里云扩展认证-"></a>
## AK/SK 控制面与迁移

过去自动将 AK/SK 换成沙箱密钥的默认路径已删除。仅配置 AccessKey 时，沙箱鉴权
会在本地、任何交换请求或网络请求之前抛出 `InvalidAPIKeyError`（E1001）。
沙箱创建、连接、列表及运行时请求请配置 `ABX_SANDBOX_API_KEY`，或显式传入
`sandbox_api_key=` / `api_key=`。

官方模板、镜像和 ACR 控制面仍使用 `ALICLOUD_ACCESS_KEY_ID`、
`ALICLOUD_ACCESS_KEY_SECRET` 与对应区域；这些操作使用独立客户端，已有支持的
端点不变。需要运行时和模板部署的工作流，可以同时配置 API Key 与 AccessKey。

锁定的官方 FCSandbox SDK 确实有 `CreateApiKey`，但其模型是
`POST /pop/2026-05-09/api-keys`，返回结构化 `apiKey.apiKeyValue`。这个凭据资源
API 不能证明存在 STS 式的一小时交换或安全自动刷新生命周期。因此退役旧的猜测式
RPC GET、签名与解析实现，运行时不会隐式创建凭据。

CLI 不提供自定义 token 服务开关。程序化自定义鉴权适配见
[Python SDK](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/zh/guide/authentication.md)。
直接导入旧 CLI 私有交换/签名辅助函数的代码，应迁移到应用自行确认的服务契约。

---

## 配置优先级链

认证凭证按以下优先级解析（从高到低）：

```mermaid
flowchart TD
    A["1. 显式选项或参数 (--token / --acr-namespace / --region / ...)"] --> B["2. 进程环境变量"]
    B --> C["3. ./.env（按键合并，没有的键继续往下）"]
    C --> D["4. ~/.abx（.env，然后 config.toml）"]
    D --> E["5. 内置默认值；沙箱密钥缺失时抛 InvalidAPIKeyError E1001"]
```

LLM 密钥、GitHub token 和区域走同一条链。空白或只含空格的值会被跳过。变量名和默认值见 [凭证解析](../reference/configuration.md#凭证解析)。

沙箱 API Key 不会由 AK/SK 自动生成。同时配置时，运行时使用 API Key：
- 若同时提供了 `sandbox_api_key` 和 `access_key_id`，使用 API Key
- 若同时设置了 `ABX_SANDBOX_API_KEY` 和 `ALICLOUD_ACCESS_KEY_ID`，使用 `ABX_SANDBOX_API_KEY`

---

## CLI 认证管理

```bash
# 设置 API Key
abx config set sandbox_api_key your-api-key

# 设置 AK/SK（实验性）
abx config set access_key_id your-access-key-id
abx config set access_key_secret your-access-key-secret

# 查看生效配置以及每个值的来源
abx config list
# (env) 进程环境变量，(user) ./.env 或 ~/.abx，(default)，(not set)

abx config get sandbox_api_key
abx config get access_key_id
```

---

## 密钥存储（基于文件）

密钥存储在 `~/.abx/secrets.json` 中，这是一个明文 JSON 文件，通过 `chmod 600` 文件权限保护。仅适合本地开发使用。

> **⚠️ 警告**：`secrets.json` 以**明文**存储密钥。仅依赖 POSIX 文件权限（`chmod 600`）控制访问。生产环境请使用专用密钥管理服务。

通过环境变量或配置命令管理密钥：

```bash
# 通过环境变量设置 API Key（推荐）
export ABX_SANDBOX_API_KEY="your-api-key"

# 或通过 abx config 持久化
abx config set sandbox_api_key your-api-key
```

创建沙箱时通过 `--env` 参数注入密钥：

```bash
abx create --template base --env MY_TOKEN=your-secret-value --env ANOTHER_SECRET=another-value
```

> **历史说明**：macOS Keychain 集成已在过度设计清理中移除（ADR 2026-09-23）。`abx secret` CLI 命令组也已被移除。所有密钥管理现通过环境变量、`.env` 文件或 `abx config set` 完成。

---

## 常见问题

### InvalidAPIKeyError (E1001)

```text
[E1001] API key cannot be empty
  Suggestion: Check your ABX_SANDBOX_API_KEY environment variable or pass sandbox_api_key.
```

**解决**：确保通过上述任一方式配置了有效的 API Key。

### InvalidCredentialsError (E1003)

```text
[E1003] AccessKey ID and Secret cannot be empty
  Suggestion: Check ALICLOUD_ACCESS_KEY_ID and ALICLOUD_ACCESS_KEY_SECRET environment variables.
```

**解决**：确保同时设置了 AK ID 和 AK Secret。

### TokenExpiredError (E1002)

```text
[E1002] envdAccessToken not available. Sandbox may not be created or connected.
```

**解决**：重新连接以获得有效 envd token，或检查显式配置的自定义交换；API Key 不会自动创建或刷新。

---

## 相关 SDK 文档

以代码参数传递凭据（`Sandbox.create(sandbox_api_key=...)`、`access_key_id=` / `access_key_secret=`）以及 envd 请求头的说明，见 `python-sdk` 仓库中 SDK 的[认证指南](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/authentication.md)。
