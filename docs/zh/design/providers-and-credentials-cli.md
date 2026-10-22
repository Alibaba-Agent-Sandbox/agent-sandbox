# 提供方与凭证 —— CLI 规格（Node.js `abx`）

> **状态：对目录提供方已被取代**——本页把 gRPC 传输列为以后的工作时，以这句为准。现行设计是 Node 引擎：`127.0.0.1` 上的 HTTP、SSE 和 WebSocket，协议 `abx-engine/1`。见 [cli/docs/zh/reference/engine-api.md](../reference/engine-api.md) 和 [Node 提供方架构](node-provider-architecture.md)。下面清单里的对应条目作为历史保留。

> **读者**：落实本规格的 CLI 实现。
>
> **设计的规范性来源**：`python-sdk/docs/en/design/providers-and-credentials.md`（命名方案、优先级、提供方契约、安全模型）。本文把它落实为精确的 CLI 语法、帮助文本、JSON 形状、退出码、模块布局和测试。
>
> **命名规则**：每个配置键只有一个环境变量。读取方只接受这个变量，`abx config set` 也写入这个名字。没有第二个名字，也没有迁移命令。
>
> **关于本译文**：章节编号与英文版一致。表格与英文版逐项对应；两者出现差异时以[英文版](../../design/providers-and-credentials-cli.md)为准。

## 0. 用户看到什么

| 位置 | 规则 |
|---|---|
| `abx config list` | 键是 §1 中的名字（`sandbox_api_key`、`sandbox_base_url`、`sandbox_domain` 等）。密钥脱敏。 |
| `abx config get/set/delete` | 接受这些键名、限定形式 `providers.<id>.<key>`，或当前提供方的裸键。 |
| dotenv | 先按层。`./.env` 写了该键时优先于 `~/.abx/.env`，使用该键唯一的变量。 |
| `abx --help` | `Related commands` 一行提到 `abx provider`。 |
| `abx info` | 只有非内置提供方才增加 `Provider` 行。 |

---

## 1. 规范键注册表

内嵌为 TypeScript 模块 `src/utils/config_keys.ts`，由 `docs/design/fixtures/config-keys.json` 生成并对照测试。JSON 是契约。每条记录只有一个 `env` 字符串。

### 1.1 记录形状

```ts
interface ConfigKey {
  key: string;
  scope: "core" | { provider: string };
  type: "str" | "url" | "int" | "float" | "bool" | "enum" | "path" | "csv";
  secret: boolean;
  credential: boolean;
  env: string;                    // 唯一的环境变量
  storage: { file: "env" | "toml"; name: string; section?: string };
  default?: string | number | boolean;
  group: string;
  description: string;
}
```

### 1.2 核心键

| 键 | 类型 | 密钥 | 环境变量 | 存储 | 默认值 |
|---|---|---|---|---|---|
| `provider` | str | 否 | `ABX_PROVIDER` | toml `[core] provider` | `alicloud-express` |
| `sandbox_api_key` | str | 是 | `ABX_SANDBOX_API_KEY` | env `ABX_SANDBOX_API_KEY` | — |
| `sandbox_base_url` | url | 否 | `ABX_SANDBOX_BASE_URL` | toml `[transport] sandbox_base_url` | 由地域推导 |
| `sandbox_domain` | str | 否 | `ABX_SANDBOX_DOMAIN` | toml `[transport] sandbox_domain` | 由地域推导 |
| `http_timeout` | float | 否 | `ABX_HTTP_TIMEOUT` | toml `[transport]` | 30.0 |
| `http2` | bool | 否 | `ABX_HTTP2` | toml | true |
| `log_level` | enum | 否 | `ABX_LOG_LEVEL` | toml | `WARNING` |
| `default_template` | str | 否 | `ABX_DEFAULT_TEMPLATE` | toml `[transport]` | `base` |
| `llm_api_key` | str | 是 | `ABX_LLM_API_KEY` | env `ABX_LLM_API_KEY` | — |
| `llm_base_url` | url | 否 | `ABX_LLM_BASE_URL` | toml | DashScope 兼容模式 |
| `llm_model` | str | 否 | `ABX_LLM_MODEL` | toml | `qwen3-coder-plus` |
| `github_token` | str | 是 | `GITHUB_TOKEN` | env `GITHUB_TOKEN` | — |
| `template_index_url`、`template_dir` | url/path | 否 | `ABX_TEMPLATE_INDEX_URL`、`ABX_TEMPLATE_DIR` | 不能用 `config set` 写入 | |
| `mcp_auth_token`、`mcp_allowed_origins`、`mcp_runtime_dir` | | token 是 | `ABX_MCP_*` | 不能用 `config set` 写入 | |

连接池 / WS / 退避调优（`max_connections`、`max_keepalive_connections`、`keepalive_expiry`、`ws_ping_interval`）：只在文件（`[transport]`），环境变量 `ABX_<KEY>`，`config set` 不暴露。

### 1.3 内置 `alicloud-express` 的提供方作用域键

| 键 | 环境变量 | 说明 |
|---|---|---|
| `region` | `ALIBABA_CLOUD_REGION_ID` | toml `[providers.alicloud-express] region`。默认 `cn-hangzhou`。 |
| `access_key_id` | `ALICLOUD_ACCESS_KEY_ID` | `~/.abx/.env` |
| `access_key_secret` | `ALICLOUD_ACCESS_KEY_SECRET` | 密钥，`~/.abx/.env` |
| `acr_namespace` | `ACR_NAMESPACE` | |
| `acr_registry` | `ACR_REGISTRY` | |
| `acr_repo` | `ACR_REPO` | |
| `acr_username` | `ACR_USERNAME` | |
| `acr_password` | `ACR_PASSWORD` | 密钥 |
| `acr_instance_id` | `ACREE_INSTANCE_ID` | |
| `acr_vpc_id` | `ACR_VPC_ID` | |
| `acr_vswitch_ids` | `ACR_VSWITCH_IDS` | |
| `acr_security_group_id` | `ACR_SECURITY_GROUP_ID` | |
| `team_id` | `ABX_ALICLOUD_EXPRESS_TEAM_ID` | 可选。不是必填项。 |

内置提供方隐式使用 `sandbox_api_key`、`sandbox_base_url`、`sandbox_domain`、`http_timeout`、`http2`（以及调优键）。**其他每个提供方**只使用非密钥调优键；它收到 `sandbox_api_key` / `sandbox_base_url` / `sandbox_domain` 的唯一途径是清单 `[core] inherit` 与用户在安装 / 更新时同意的列表的交集（`receipt.consented.inherit`）。切换默认提供方不会把阿里云密钥发给插件（设计 §4.6）。

### 1.4 保留字

以 `shortcuts` 开头的键名，以及表名 `core`、`transport`、`providers`，都是保留的。提供方 id 不能与它们冲突。

---

## 2. 解析

### 2.1 算法

```text
resolve(key K, provider P, sources S):
  name = §1 中 K 的那一个环境变量
         （插件自己的字段用 ABX_<P>_<K>）
  layers = [ S.overrides, S.environ, S.dotenv[0] (./.env), S.dotenv[1] (~/.abx/.env), S.toml, default ]
  for layer in layers:
      v = layer[name]; if v 是非空白字符串 / 非空: return (v, layer, name)
  return unset
```

* 空白或只含空格在每一层都视为未设置，包括覆盖层。
* `S.dotenv` 按顺序取每个存在的候选文件（先 `./.env`，然后 `~/.abx/.env`）。
* `K` 的 TOML 名字：`[providers.<P>].K`，然后 `[transport].K`。
* 数值 / 布尔转换与 SDK 相同。
* **推导默认值**（由 `region` 推导 `sandbox_base_url`、`sandbox_domain`）：只对声明了 `[endpoint.derive]` 的提供方生效，且仅当基础 URL 没有被覆盖层或进程环境变量显式设置。
* `config list` 的来源标签：environ→`(env)`，dotenv/toml→`(user)`，推导 / 内置→`(default)`，没有→`(not set)`。

### 2.2 提供方选择

`显式（--provider 或 provider:ref） > ABX_PROVIDER 环境变量 > ./.env 中的 ABX_PROVIDER > ~/.abx/.env 中的 ABX_PROVIDER > [core] provider > alicloud-express`。未知 id → `E8001`（退出码 4），并提示 `abx provider list` / `abx provider install`。

### 2.3 `config list`

| 分组标题 | 键 |
|---|---|
| `Provider` | `provider` |
| `Sandbox authentication` | `sandbox_api_key` |
| `Alibaba Cloud credentials` | 标记为 `credential` 的提供方键，然后 `acr_namespace` |
| `Alibaba Cloud registry (ACR)`（仅内置） | `acr_registry`、`acr_repo`、`acr_username`、`acr_password`、`acr_instance_id`、`acr_vpc_id`、`acr_vswitch_ids`、`acr_security_group_id`、`team_id` |
| `Connection` | `sandbox_base_url`、`region`、`sandbox_domain`、`http_timeout`、`http2` |
| `LLM` | `llm_api_key`、`llm_model`、`llm_base_url` |
| `Integrations` | `github_token` |
| `Shortcuts` | 不变 |

`--json` 是扁平的 `{key: value}`。密钥脱敏。

---

## 3. `abx config`

### 3.1 选项

* `--provider ID` — 针对提供方 `ID` 而不是默认提供方解析裸键并列出 / 读取。限定键忽略它。
* 限定键 `providers.<id>.<key>` 可用于 `get/set/delete`。

### 3.2 `KEY` 的解析顺序（失败时退出码 2）

1. `shortcuts`、`shortcuts.*`。
2. §1.2 中的核心键（`sandbox_api_key`、`sandbox_base_url`、`sandbox_domain` 等）。
3. `providers.<id>.<key>`（限定）—— `<id>` 必须是内置或已安装（`E8001`），`<key>` 属于该提供方的 schema 或它继承的核心键。
4. 生效提供方 schema 中的裸键（`--provider`，否则默认提供方）。找不到 → `Unknown config key: 'x'`，建议 `Available keys: …`；其他已安装提供方声明了它时再加 `Did you mean 'providers.<id>.x'?`。

### 3.3 `set` 的存储

`config set` 写入 §1 中那一个存储名。清除（`set K ""` / `delete`）删除该已存值。消息：`Set sandbox_base_url = …`、`Cleared sandbox_base_url (falls back to default: …)`。

### 3.4 `abx config init`

内置提供方的向导提示沙箱 API Key（`ABX_SANDBOX_API_KEY`）、地域（`ALIBABA_CLOUD_REGION_ID`）、LLM API Key（`ABX_LLM_API_KEY`）和 AccessKey 对（`ALICLOUD_ACCESS_KEY_ID`、`ALICLOUD_ACCESS_KEY_SECRET`）。默认提供方不是内置的（或 `--provider ID`）时，向导由提供方 schema 生成：按清单顺序每个字段一个提示（`i/N Description (key, ENV_NAME)`，密钥脱敏，必填标 `*`），然后 `Stored <key> in ~/.abx/.env` / `Set <key> = <value>`，最后 `Configuration complete. Review it with 'abx config list --provider ID'.`。

### 3.5 帮助文本

`abx config get --help` / `set --help` 列出 §1 的键：

```
sandbox_api_key    Sandbox API key (env: ABX_SANDBOX_API_KEY).
sandbox_base_url   Platform API URL (env: ABX_SANDBOX_BASE_URL).
sandbox_domain     Envd data-plane domain (env: ABX_SANDBOX_DOMAIN).
provider           Default provider id (see 'abx provider list'; default:
                   alicloud-express).
providers.<id>.<key>
                   Provider-scoped value; bare keys such as 'region' refer to the
                   default provider (or --provider ID).
```

---

## 4. `--provider`、`--opt` 与选项

### 4.1 `--provider`

* 接受为**根选项**（`abx --provider ID <cmd> …`），也接受为每个与提供方通信的命令上的**命令级选项**；命令级的值优先。帮助：`--provider ID  Provider for this command (default: 'abx provider default' value, else alicloud-express)`。
* 接受它的命令（及其需要的特性）：`create`/`sandbox create`（`sandbox.lifecycle`）、`list`/`sandbox list`、`info`、`kill`、`connect`、`exec`（`exec.run`；`exec --stream` 需要 `exec.stream`）、`run`、`shell`、`upload`/`download`/`files`（`files.rw`）、`sandbox process …`（`process.manage`）、`sandbox system …`、`sandbox timeout`（`sandbox.timeout`）、`sandbox pause/resume`（`sandbox.pause`）、`template list/info/build/deploy/delete/install/push/create` 和 `deploy`（`templates.read`/`templates.build`）、`mcp install/start/deploy`（`sandbox.lifecycle`）。
* 不绑定提供方（永不接受）：`config`（有自己的 `--provider` 用于限定范围）、`template init/search`、`mcp status`、`provider *`。
* 拼写提示：未知的 id 会在 `E8001` 的建议里加上 `Did you mean 'X'?`（对内置 / 已安装 id 的编辑距离 ≤ 2）。缺少特性 → 在任何副作用**之前**失败：退出码 1，`[E8004] Provider 'ID' does not support 'FEATURE'.` + 建议 `Run 'abx provider info ID' to see supported features.`（JSON：`{"status":"error","code":"E8004","message":…,"suggestion":…}`）。
* 内置提供方的提供方作用域选项（`--region/-r`、`--acr-*`、`--team-id`、`--vpc-id`、`--vswitch-ids`、`--security-group-id`）只有当生效的提供方声明了对应的键时才被接受；否则退出码 2：`Option '--region' is not supported by provider 'ID'.`，建议 `Use '--opt KEY=VALUE' for provider options (see 'abx provider info ID').`

### 4.2 `--opt KEY=VALUE`（可重复）

为本次调用设置提供方作用域的键（override 层）。`KEY` ∈ 生效提供方的 schema（或一个被继承的核心键，作为对该提供方的覆盖）。语法错误 / 未知键 → 退出码 2（`E8002`）。`--opt` 的值会出现在 argv 里：对 `secret` 字段，CLI 拒绝（`E8002`：`Field 'KEY' is secret; set it with 'abx provider config ID set KEY' or the ABX_<ID>_<KEY> environment variable.`）。

### 4.3 选项

| 选项 | 环境变量 | 命令 |
|---|---|---|
| `--sandbox-api-key` | `ABX_SANDBOX_API_KEY` | `mcp install`、`mcp start` |
| `--sandbox-base-url` | `ABX_SANDBOX_BASE_URL` | 同上 |
| `--sandbox-domain` | `ABX_SANDBOX_DOMAIN` | 同上 |
| `--acr-instance-id` | `ACREE_INSTANCE_ID` | 模板命令 |

`abx mcp install` 把 `ABX_SANDBOX_API_KEY` 复制进编辑器配置。只有进程环境变量设置了 `ABX_SANDBOX_BASE_URL` 和 `ALIBABA_CLOUD_REGION_ID` 时，才把这两个名字写进同一份文件。

### 4.4 限定的沙箱引用

输入语法：每个接受沙箱 id 的命令（`info`、`kill`、`exec`、`connect`、`upload`、`download`、`files`、`sandbox process/system …`）都接受 `[provider:]sandbox_id`。只有当第一个 `:` 之前的部分符合提供方 id 语法**并且**等于某个内置 / 已安装的提供方 id 时，才解析前缀；否则整个字符串就是 id。文本输出统一使用 `provider:sandbox_id`，JSON 行包含 `provider` 并保留裸 ID 字段。`--provider P` + 引用 `Q:id` 且 `P≠Q` → 退出码 2 `[E8030] Sandbox reference 'Q:id' conflicts with --provider P.`

`abx list --all-providers` —— 增加 `Provider` 列 / 键，查询每个已配置（其 `credential` 字段能解析）的提供方，跳过失败的提供方并向 stderr 打印警告（`warning: provider 'ID' skipped: <message>`），至少一个成功则退出码 0，否则为第一个错误的退出码。

---

## 5. `abx provider`

```
Usage: abx provider [OPTIONS] COMMAND [ARGS]...

  Manage sandbox providers (backends).

  The built-in provider is 'alicloud-express' (Alibaba Cloud Express Edition,
  阿里云极速版). Install more with a directory or a git URL.

Commands:
  list       List built-in and installed providers
  info       Show a provider's manifest, features and configuration
  install    Install a provider plugin from a directory or git URL
  uninstall  Remove an installed provider
  update     Update installed providers
  default    Show or set the default provider
  config     Show or edit a provider's configuration
  doctor     Check a provider (integrity, handshake, features)

Examples:
  abx provider list
  abx provider install ./my-provider
  abx provider install https://github.com/acme/abx-provider-acme.git --ref 4f1c2ab9e0d5c3b7a1f2e8d9c0b1a2f3e4d5c6b7
  abx provider default acme
  abx create --provider acme --template base
```

相关命令（也作为 `abx --help` 的最后一段打印）：`abx config`、`abx info`。

每个子命令都遵守 `--json/--quiet/--ci/--no-color/--verbose` 和标准的 `-h/--help`。

### 5.1 `list`

`abx provider list` → 标准表格，表头 `["ID", "Name", "Version", "Kind", "Trust", "Default"]`，行先内置，然后已安装的按 id 排序；`Default` 为 `yes` 或空；`Kind` ∈ `builtin|rest|exec`；`Trust` ∈ `builtin|pinned|local|link|unpinned`。`--json` = 表格的对象列表（沿用既有风格，键是表头字符串）。始终至少有内置行。`--quiet` 只打印 id（每行一个；标准的 quiet 表格输出是制表符分隔的行——这里**覆盖**：只输出 id，已文档化）。

### 5.2 `info ID`

文本（`print_dict` 风格的键 / 值，然后是若干块）：

```
ID           alicloud-express
Name         Alibaba Cloud Express Edition (阿里云极速版)
Version      0.3.0
Kind         builtin
Default      yes
Trust        builtin
Features     sandbox.lifecycle, sandbox.timeout, …
Config       region, access_key_id, access_key_secret (secret), …
Inherits     sandbox_api_key, sandbox_base_url, … (built-in: all; plugins: consented subset)
```

已安装的提供方增加 `Source`、`Commit`、`Digest`、`Runtime`（命令行）、`Security`（声明的、**建议性**权限）、`Installed`、`Inherits`（生效的已同意列表）。`--json` 形状：

```json
{
  "id": "alicloud-express", "name": "Alibaba Cloud Express Edition", "name_zh": "阿里云极速版",
  "version": "0.3.0", "kind": "builtin", "default": true, "trust": "builtin",
  "features": ["sandbox.lifecycle", "…"],
  "config_fields": [{"key": "region", "type": "str", "secret": false, "credential": false, "required": false,
                     "default": "cn-hangzhou", "env": "ALIBABA_CLOUD_REGION_ID",
                     "description": "…", "description_zh": "…"}],
  "inherit": ["sandbox_api_key", "…"],
  "install": null
}
```

对已安装的提供方，`install` = 回执对象（设计 §7.6），其中 `source.url` 的凭证已被遮蔽。未知 id → 退出码 4 `[E8001] Provider 'x' is not installed.`（建议 `Run 'abx provider list'; install with 'abx provider install <path-or-git-url>'.`）。

### 5.3 `install SOURCE`

```
Usage: abx provider install [OPTIONS] SOURCE

  Install a provider plugin. SOURCE is a local directory or a git URL
  (https://, ssh://, git@host:path). Nothing from the plugin is executed
  during installation.

Options:
  --ref TEXT                     Git tag, branch or commit (full 40-hex commit pins the install)
  --subdir TEXT                  Plugin directory inside the repository
  --sha256 TEXT                  Expected tree digest; the install fails if it differs (pins the install)
  --link                         Link a local directory for development (no copy, no integrity check; requires --yes; POSIX only)
  --force                        Replace an installed provider with the same id
  --allow-unpinned               Allow a tag/branch install without --sha256 in non-interactive mode
  --allow-insecure-transport     Allow file://, git:// and http:// sources (testing only)
  -y, --yes                      Skip the confirmation prompt (required in non-interactive mode)
```

`--link` 记录 `trust = link`：目录原地使用，每次启动都重新读取清单 / 完整性；因为没有任何东西固定代码，它始终需要 `--yes`（即使交互式也会打印红色的 `unpinned, development only` 横幅），并且在 Windows 上被拒绝。同意界面里的 `Security` 行是插件的**自我声明**，打印为 `declared by the plugin (not enforced)`。

行为 = 设计 §7.6。同意界面（stdout；`--json` 模式下无法提示，所以需要 `--yes`，否则退出码 2）：

```
Provider      local-process 0.1.0  (Local Process)
Source        https://github.com/acme/abx-provider-local-process.git @ 4f1c2ab9… (pinned)
Digest        sha256:ab12…
Runs          python3 ./provider.py
Features      sandbox.lifecycle, exec.run, files.rw
Security      network: none · filesystem: data_dir · spawns processes: yes
Config        workdir_root, token (secret)
Inherit       sandbox_api_key, sandbox_base_url   <- your generic sandbox credentials WILL BE SENT to this plugin (omitted when the manifest inherits nothing)

This plugin runs as a program on your machine with your credentials for this provider.
Install and trust it? [y/N]
```

成功：`Installed provider 'local-process' 0.1.0 (pinned)`；`--json` → `{"status":"success","message":"…","id":"local-process","version":"0.1.0","trust":"pinned","commit":"…","tree_sha256":"…"}`。

错误（stderr，`[CODE] message` + `Suggestion:`），退出码：

| 条件 | 码 | 退出码 | 信息 |
|---|---|---|---|
| 来源不存在 / clone 失败 | E8010 | 1 | `Cannot fetch provider source: <reason>.` |
| 清单缺失 / 无效 | E8014 | 1 | `Invalid abx-provider.toml: <reason>.` |
| id 被保留 / 没有 `--force` 就冲突 | E8003 | 1 | `Provider id 'x' is already installed.` / `reserved` |
| 摘要不匹配 | E8011 | 1 | `Tree digest mismatch: expected <a>, got <b>.` |
| 非交互且没有 `--yes` | E8012 | 2 | `Installing a provider requires confirmation.` / `Re-run with --yes after reviewing: abx provider install <source> --ref <commit>` |
| 非交互下未固定的 git 且没有 `--allow-unpinned` | E8012 | 2 | `Refusing an unpinned git source in non-interactive mode.` / `Pass --ref <40-hex commit> or --sha256 <digest>.` |
| `--link` 没有 `--yes`，或在 Windows 上 | E8012 | 2 | `--link requires --yes (the linked code is not pinned).` / `--link is not supported on Windows.` |
| 不安全的传输 / URL 中有凭证 | E8012 | 2 | `Insecure provider source 'git://…'.` / `Credentials in URLs are not accepted; use an SSH agent or a git credential helper.` |
| 不兼容的 `requires` / 协议 | E8013 | 1 | `Provider requires abx cli >=0.4 (this is 0.3.0).` |
| 路径 / 大小 / 符号链接违规 | E8010 | 1 | `Unsafe entry 'a/../b' in provider source.` 等 |

### 5.4 `uninstall ID`

选项 `--purge`（同时从 `~/.abx/.env` 删除 `[providers.<id>]` 和 `ABX_<ID>_*`，并删除 `data/` 目录）、`-y/--yes`。提示 `Remove provider 'ID'? [y/N]`（非交互且没有 `--yes` → 退出码 2 `E8012`）。内置 → 退出码 2 `[E8003] The built-in provider cannot be removed.`。如果它是默认提供方：stderr 提示 `Default provider reset to 'alicloud-express'.`。未知 → 退出码 4 `E8001`。成功 `Removed provider 'ID'`。

### 5.5 `update [ID | --all]`

选项：`--ref TEXT`、`--check`、`--all`、`-y/--yes`。`--check` 打印 `ID  installed → available (changes: runtime, security)` 行（表头 `["ID","Installed","Available","Changes"]`），不改动任何东西（退出码 0）。更新遵循设计 §7.6（仅当运行命令 / 安全 / 特性 / 配置字段变化时才重新同意，已固定的需要 `--ref`，`initialize` 失败则回滚）。`link` 和 `local` 安装：`[E8010] Provider 'ID' was installed from a local directory; reinstall it with 'abx provider install --force <path>'.`（退出码 1）。无需更新：`All providers are up to date.`

### 5.6 `default [ID]`

* 无参数：打印生效的默认 id（stdout，一行；`--json` → `{"default":"…","source":"env|dotenv|config|builtin"}`），退出码 0。
* `ID`：校验它存在，写入 `[core] provider = "ID"`，打印 `Default provider set to 'ID'`（如果设置了 `ABX_PROVIDER` 且覆盖了它，则向 stderr 额外警告：`note: ABX_PROVIDER=… overrides this at runtime.`）。
* `--unset`：删除该键，打印 `Default provider reset to 'alicloud-express'`。
* 设置内置 id 不写任何特殊内容（删除该键）。

### 5.7 `config ID …`

```
abx provider config ID list           # == abx config list --provider ID
abx provider config ID get KEY        # == abx config get providers.ID.KEY
abx provider config ID set KEY [VALUE]# masked prompt for secrets, same rules as `abx config set`
abx provider config ID unset KEY      # == abx config delete providers.ID.KEY
abx provider config ID init           # guided prompts from the schema (as §3.7)
```

`set` 的校验：按清单字段类型强制转换；`enum` 成员检查；`url` 必须能解析；`path` 原样存储；`required` 字段只在命令运行时才强制检查。错误 → 退出码 2 `E8002`（`Invalid value for 'KEY': <reason>.`）。

### 5.8 `doctor [ID]`

无副作用地运行：清单有效、摘要与回执一致、`requires` 正常、配置完整性（`required` 字段由哪个来源解析——只输出名字）、启动插件、`initialize`、比较宣告的特性与声明的特性。输出行 `ok|warn|fail  <check>  <detail>`；全部 ok / warn 时退出码 0，任何 fail 时退出码 1。`--json` → `[{"check":"digest","status":"ok","detail":"…"}]`。当通用 `sandbox_api_key` 会被发送给该提供方，并且它同时也是另一个已配置提供方的生效键时发出警告。

---

## 6. Node 架构（建议；保持与 Python 模块对应的规则）

| 模块 | 职责 |
|---|---|
| `src/utils/config_keys.ts` | 来自 `config-keys.json` 的注册表；`resolve()`；`exportSchema()` |
| `src/transport/config.ts` | `loadConfig`、`explainConfig`、`auditConfig`、`planMigration`/`applyMigration`；遵守 Python 测试打补丁的同样接缝 |
| `src/providers/base.ts` | `Provider`、`ProviderFeature`、`ConfigField`、`ProviderInfra` |
| `src/providers/registry.ts` | 内置 + 已安装发现，选择优先级（§2.2） |
| `src/providers/builtin.ts` | 包装今天代码路径的 `alicloud-express`（行为不变） |
| `src/providers/manifest.ts` | TOML 解析（`smol-toml`）+ 全部校验规则 + 版本比较器 |
| `src/providers/store.ts`、`installer.ts` | 布局、锁、回执、**目录树摘要**、git clone 加固、文件系统安全检查、同意界面、更新 / 回滚 |
| `src/providers/exec_provider.ts` | EPP/1 客户端（基于 `child_process.spawn` 的 NDJSON JSON-RPC，`shell:false`，清理过的环境，进程组终止），错误映射表。第三方插件；可选 `pty.*` |
| `src/providers/node_provider.ts` | 进程内的 `node/1` 模块（`provider.mjs`，`create(kit)`）。目录提供方 `opensandbox`、`e2b`、`cubesandbox`、`alicloud-container` |
| `src/providers/rest_provider.ts` | 基于现有 envd 传输、由清单驱动的端点预设 |
| `src/engine/server.ts` | 给其他语言用的本机引擎：`127.0.0.1` 上的 HTTP、SSE 和 WebSocket，协议 `abx-engine/1` |
| `src/cli/commands/provider.ts` | §5 的命令 |
| `src/cli/commands/config_cmd.ts` | §3 的增量 |

接口（线上字段保持 `snake_case`）：

```ts
export interface Provider {
  id: string; displayName: string; displayNameZh: string; version: string;
  kind: "builtin" | "node" | "rest" | "exec";
  features: ReadonlySet<ProviderFeature>;
  configFields: readonly ConfigField[];
  usesCore: readonly string[];
  require(feature: ProviderFeature): void;           // throws ProviderFeatureNotSupportedError (E8004)
  buildInfra(config: TransportConfig): Promise<ProviderInfra>;
}
```

`exec` 提供方的 `buildInfra` 返回其方法发出 EPP 调用的适配器；当 `SandboxRecord` 带有 `envd_url` 时，CLI 对 exec / 文件 / PTY 使用其**现有的** envd 传输（混合模式）——此时不要让数据面流量经过插件。

启动规则（精确、有测试）：`spawn(cmd[0], cmd.slice(1), {cwd: dataDir, env: scrubbedEnv, stdio: ['pipe','pipe','pipe'], shell: false, windowsHide: true, detached: process.platform !== 'win32'})`；以 `./` 开头的第一个元素在插件目录内解析（realpath 必须留在目录内）；分帧：按 `\n` 切分 stdout，拒绝超过 8 MiB 的行；stderr 环形缓冲 64 KiB；握手超时 `startup_timeout_ms`；调用超时；终止：`shutdown` → 关闭 stdin → 3 秒 → SIGTERM（进程组）→ 3 秒 → SIGKILL（Windows 上用 `taskkill /T /F`）。

---

## 7. CLI 工作者必须新增的测试

命名遵循移植规则（`tests/<path>.test.ts`、`describe("<Class>")`、`it("<name>")`）。

**夹具（从 `docs/design/fixtures/` 原样复制）**：`config-keys.json`、`config-resolution-vectors.json`、`tree-digest-vectors.json`、`epp-error-mapping.json`、`migration-vectors.json`。当两个仓库并排检出时，如果某个夹具与 Python 仓库里的拷贝不同，测试失败。

1. `tests/utils/config_keys.test.ts` —— 注册表等于 `config-keys.json`；每个键都有 §1 中那一个环境变量；id 语法和保留 id；ACR 环境变量是 `ACR_*` / `ACREE_INSTANCE_ID`，地域是 `ALIBABA_CLOUD_REGION_ID`。
2. `tests/transport/config_resolution.test.ts` —— **所有向量**；dotenv 先按层；空白值；推导；提供方作用域优先于通用；无跨提供方泄露；`http_timeout_configured` 的等价物。获胜的 `name` 是该键唯一的变量。
3. `tests/cli/test_config_cmd_providers.test.ts` —— 键解析顺序（§3.2），包括 `--provider`、限定键、歧义建议；`config set` 写入那一个存储名；清除删除该已存值；`config list` golden。
5. `tests/providers/manifest.test.ts` —— 设计 §7.5 的每条校验规则（每条一个测试）、版本比较器表、命令逃逸规则。
6. `tests/providers/store_installer.test.ts` —— 本地目录；通过临时裸仓库的 git（`file://` 用 `--allow-insecure-transport`）；已固定 / 未固定 / `--sha256`；符号链接 / 硬链接 / 穿越 / 大小写冲突 / 大小 / 文件数拒绝；URL 凭证拒绝 + 遮蔽；`--link` 需要 `--yes`；`ls-tree` 校验在写任何 blob **之前**拒绝符号链接 / 子模块 / 超大条目；未固定措辞（`tag/branch installs are not pinned`）；**目录树摘要向量**；金丝雀测试（插件被执行会写文件 → 安装后绝不能存在）；编辑文件后的完整性失败；更新重新同意矩阵；回滚；卸载 / purge；默认值回退；锁竞争；原子交换的崩溃安全（在暂存和交换之间终止，旧安装保持完好）。
7. `tests/providers/exec_provider.test.ts` —— 针对 `examples/providers/local-process`（从 python-sdk 复制）：握手、版本不匹配（`E8013`）、特性门控、**错误映射表**、超时、崩溃附 stderr 末尾、格式错误 / 超长的行、环境清理（插件回显环境：没有 `ABX_*`/`E2B_*`/`ALICLOUD_*`）、密钥只经 `initialize`、进程组终止、取消、带 `envd_url` 的混合模式；**插件 stderr 被遮蔽**（插件向 stderr 回显密钥：该密钥绝不会到达 CLI 的 stderr、doctor 输出或错误信息），并且 `initialize` 请求绝不会写入调试 / 日志输出。
8. `tests/cli/test_provider_cmd.test.ts` —— §5 的每个命令：帮助 golden、表格 / JSON 形状、quiet 覆盖、退出码、错误表、同意界面 golden、非交互拒绝、`default` 消息（含 `ABX_PROVIDER` 提示）、`doctor` 输出。
9. `tests/cli/test_provider_flag.test.ts` —— `--provider` 根级 + 叶子级的优先级，缺少特性在副作用之前失败（断言没有 HTTP / Docker 调用），提供方作用域选项的拒绝文本，`--opt` 密钥拒绝，限定引用，`E8030`，`list --all-providers` 部分失败，JSON 的 `provider` 键只对非内置提供方出现。
10. **差分（oracle）用例**放在 `parity/diff/` 下：只用内置提供方时，针对 stub 的 `list`、`create`、`kill` 使用 §1 中那一个环境变量。
11. 跨实现一致性：用 **Node** 安装器安装来自 Python 仓库的 `examples/providers/local-process`，然后用 **Python** SDK 加载它（反过来亦然）：回执摘要相同，两者都接受对方的回执。

---

## 8. CLI 后续事项清单（有序）

1. 等待移植达到对等（所有 ledger 测试通过，`parity:coverage` 干净）。
2. 把夹具从 `python-sdk/client-sdk/tests/fixtures/` 复制到 `docs/design/fixtures/` 和 `tests/fixtures/`（Python 仓库是事实来源）；增加夹具同一性测试。
3. 实现 `config_keys.ts` + 先按层的解析器；把 `config_cmd.ts` 移植到它上面；每个键只有一个环境变量；重新生成 `config list` 的 golden。
4. 每个选项绑定那一个环境变量。通过 `config set` 支持 `acr_*` 键。
5. `abx config set` 写入 §1 中那一个存储名。
6. 实现提供方：清单 → 存储 / 安装器（+ 摘要）→ 注册表 / 内置 → `exec_provider` / `rest_provider` → `abx provider …` → `--provider/--opt` 接线 → 限定引用 → `list --all-providers`。
7. 更新 CLI 文档（`cli-design`、`cli-reference`、`configuration`、`environment-variables`、`authentication`，新的 `providers` 指南）及其 zh 镜像；`SKILL.md`；`llms.txt`；CHANGELOG。
8. 让 `mcp install` 的复制规则（§4.3）和 MCP server 环境（`ABX_PROVIDER` 会被转发）保持一致。
9. 由没有编写该切片的对抗者进行一轮评审（按 PORTING.md），把发现追加到 `parity/review-log.md`。
10. 留待以后的事项（现在不要做）：OS 级的插件约束、钥匙串密钥存储、注册表 / 市场来源、长期运行的插件守护进程（EPP/2）。gRPC 作为 SDK 到提供方的传输已经评估过，目录提供方没有采用（见本页顶部的状态；现行设计是 Node 引擎，HTTP / SSE / WebSocket，[cli/docs/zh/reference/engine-api.md](../reference/engine-api.md)）。

---

## 9. 来自 Python 实现的说明（与上文不一致之处以此为准）

Python SDK 一侧是在本规格评审之后实现的。以下几点是实现时做出的决定；Node 实现必须与之一致（共享夹具编码了其中大部分）。

1. **E8005 `ProviderResourceNotFoundError`** 已存在。EPP `-32002` 映射到 `data.sdk_code` 指定的类（E2001、E4001…）；没有 `sdk_code` 时映射到 E8005（而不是 E2000）。退出码 4。`exit_code_for` 顺序：认证 → 3，未找到系列（E8001、E8005、`TemplateNotFoundError`、`FileNotFound_`）→ 4，超时（`CommandTimeoutError`、E8022）→ 5，配额 → 6，配置 / 信任 / 不匹配（E8002、E8012、E8030）→ 2，其他 → 1。以 `epp-error-mapping.json` 为准。
2. **`sandbox.kill` 在宿主适配器处是幂等的**：`sandbox.kill` 返回的 E8005 被吞掉（沙箱已经不存在），所以对已消失沙箱执行 `abx kill` 的行为与内置提供方相同。插件自己也应该让 kill 幂等；契约套件会检查。
3. **没有 envd 的提供方**把标记 URL `epp://<provider>/<sandbox_id>` 当作沙箱的 envd URL；每个会调用 envd 的代码路径（命令列表、认证检查、终端）都必须跳过 `epp://` URL，改用提供方的数据面方法。
4. **清单 `command`**：以 `./` 开头的元素在插件目录内解析，不得逃逸；同意界面按原样打印 argv（`python3 ./provider.py`）。
5. **插件环境**额外带 `PYTHONDONTWRITEBYTECODE=1`（解释器不得往受摘要校验的目录里写东西）。顶层 `data/` 保留给插件状态，并排除在目录树摘要之外；`update` 会保留 `data/`。
6. **进程清理**：插件退出之后（无论是否正常），宿主仍会终止进程组，所以孙进程不能活过一次会话（`EppClient.close`）。
7. **`close()`**：提供方进程由 sandbox 对象持有；Python API 增加了 `Sandbox.close()`。CLI 调用必须在每条退出路径（包括 `Ctrl-C`）上关闭其提供方。
8. **存储**：`abx config set sandbox_api_key` 把 `ABX_SANDBOX_API_KEY` 写入 `~/.abx/.env`（权限 0600）。`sandbox_base_url` 存为 `[transport] sandbox_base_url`。每个键只有这一个存储名。
9. **`python -m agent_sandbox.providers`** 是 `abx provider` 在 SDK 一侧的孪生版本（相同布局、相同回执、相同摘要）。一个工具安装的 `node` 插件能被另一个加载：CLI 导入 `provider.mjs`，Python SDK 通过 `abx provider engine serve` 使用它。`kind = "python"` 的清单会被拒绝（用 `node`、`exec` 或 `rest`）。进程内的 `Provider` 子类在 Python SDK 里仍然可以登记。它们不是可安装的目录插件。
10. **Python 中未实现（后续事项，CLI 同样适用）**：`sandbox.yaml` 的 `provider:` / `provider_options:` 和 `@sandbox(provider=...)`；OS 约束；SDK 中的 `list --all-providers` 聚合辅助（SDK 只提供按提供方的 `Sandbox.list(provider=...)`）。
