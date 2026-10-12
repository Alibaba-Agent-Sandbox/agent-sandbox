# 提供方与凭证 —— CLI 规格（面向 Node.js `ebx`）

> **读者**：在 **Python→Node 移植达到对等之后**应用本规格的 CLI 工作者（见 [`../../PORTING.md`](../../PORTING.md)）。移植本身保留每个旧键名和旧行为；本文是在其之上的增量。
>
> **设计的规范性来源**：`python-sdk/docs/en/design/providers-and-credentials.md`（命名方案、优先级、别名表、提供方契约、安全模型）。本文把它落实为精确的 CLI 语法、帮助文本、JSON 形状、退出码、模块布局和测试。**可执行的参考实现**：Python SDK 实现了键注册表、解析器、清单、存储 / 安装器（目录树摘要！）和 EPP 客户端；其测试向量镜像在 `docs/design/fixtures/` 中，**Node 测试必须原样运行它们**。
>
> **关于本译文**：这是[英文版](../../design/providers-and-credentials-cli.md)的中文版，章节编号一致。命令输出文本、帮助文本、错误信息和 JSON 键是产品字符串，保持英文原样；两者有差异时以英文版为准。
>
> 从移植继承的硬性规则：golden 文件**只在**本规格明确说明的地方改变；stdout / stderr 通道策略、`--json/--quiet/--ci/--no-color` 和退出码 0–6 不变；现有的键 / 环境变量 / 选项都不会失效。

## 0. 从不接触提供方的用户会看到什么变化

| 位置 | 变化 | 理由 |
|---|---|---|
| `ebx config list`（文本和 `--json`） | `api_url`→`sandbox_base_url`、`domain`→`sandbox_domain` 以规范名显示；新键有新的分组行（§2.3）。`--legacy-names`（以及 `EBX_CONFIG_LEGACY_NAMES=1`）再保留一个版本，打印旧名字 | 这**就是**被要求的重命名。列表中的其他内容逐字节相同 |
| `ebx config get/set/delete <legacy>` | stdout 与之前相同；在交互式 TTY 上多一行 stderr 提示（§3.4） | 唯一有文档的默认提示 |
| dotenv 优先级（当 `./.env` 与 `~/.ebx/.env` 为同一个键设置了两个*不同的名字*） | 规范化为**先按层**：更近的文件获胜，与它使用哪个别名无关（旧顺序会让低优先级文件通过排在前面的名字获胜）。写入 CHANGELOG；没有现有测试固定旧怪癖 | 可预测性；优先级说明的一部分 |
| `ebx --help` | 一行 `Related commands` 提到 `ebx provider` | 可发现性 |
| `ebx info` | 内置提供方不变；**只有**非内置提供方才增加一行 `Provider` | 消除歧义 |
| 所有其他命令 | stdout / stderr **没有**变化 | 除非 `EBX_WARN_DEPRECATED=1`，legacy 名保持静默 |
| 使用内置提供方的 `ebx list --json`、`ebx create --json` 等 | **逐字节相同**（没有 `provider` 字段） | 脚本不能被破坏 |

需要重新生成的 golden：`config list`（文本 + JSON）、`config get`/`set` 帮助文本（新键）、`ebx --help`（出现 `provider` 命令）、`ebx config --help`。为 `provider` 命令新增 golden。

---

## 1. 规范键注册表（要内嵌的数据——镜像 `easy_sandbox.utils.config_keys.export_schema()`）

作为一个 TypeScript 模块 `src/utils/config_keys.ts` 内嵌，由 `docs/design/fixtures/config-keys.json`（由 `python -m easy_sandbox.utils.config_keys --json` 生成）生成并与之对照测试。JSON 就是契约；**不要手工维护第二份拷贝**。

### 1.1 记录形状

```ts
interface ConfigKey {
  key: string;                    // 规范名，snake_case
  scope: "core" | { provider: string };
  type: "str" | "url" | "int" | "float" | "bool" | "enum" | "path" | "csv";
  secret: boolean;                // 输出时遮蔽，存入 ~/.ebx/.env (0600)
  credential: boolean;            // 需要时缺失 -> E1003 / 退出码 3
  env: string;                    // 规范环境变量名 (EBX_...)
  aliases: { name: string; kind: "compat" | "native" | "legacy"; surface: "env" | "config" | "kwarg" | "flag" }[]; // 按优先级顺序
  storage_phase1: { file: "env" | "toml"; name: string; section?: string };  // config_format != 2 时 `config set` 写入的位置
  storage_phase2: { file: "env" | "toml"; name: string; section?: string };  // `config migrate` 之后
  default?: string | number | boolean;
  group: string;                  // `config list` 的分组标题
  description: string;            // 一行帮助文本
}
```

### 1.2 核心键（精确）

核心键的完整表格（`provider`、`sandbox_api_key`、`sandbox_base_url`、`sandbox_domain`、`http_timeout`、`http2`、`max_retries`、`log_level`、`default_template`、`llm_*`、`github_token`、`template_*`、`mcp_*`）与英文版 §1.2 逐行一致，列为：键、类型、是否密钥、规范环境变量、compat / native 环境变量（顺序）、legacy 环境变量（顺序）、legacy 配置 / 选项名、阶段 1 存储、阶段 2 存储、默认值。以 `config-keys.json` 为准。要点：

* `sandbox_api_key`：规范 `EBX_SANDBOX_API_KEY`；compat `E2B_API_KEY`；legacy `SANDBOX_API_KEY`；legacy 配置名 `api_key`（今天静默别名）、选项 `--api-key`；阶段 1 存为 `~/.ebx/.env` 的 `E2B_API_KEY`，阶段 2 存为 `EBX_SANDBOX_API_KEY`。
* `sandbox_base_url`：`EBX_SANDBOX_BASE_URL` / `E2B_API_URL` / `SANDBOX_API_BASE_URL`；legacy 配置 `api_url`、`api_base_url`；选项 `--api-url`；阶段 1 为 `[transport] api_url`，阶段 2 为 `[transport] sandbox_base_url`；默认由区域推导。
* `sandbox_domain`：`EBX_SANDBOX_DOMAIN` / `E2B_DOMAIN`；legacy 配置 `domain`、选项 `--domain`；默认由区域推导。
* `github_token`：`EBX_GITHUB_TOKEN`，native `GITHUB_TOKEN`，选项 `--token`；阶段 1 存为 `.env` 的 `GITHUB_TOKEN`，阶段 2 为 `EBX_GITHUB_TOKEN`。
* `llm_api_key`：`EBX_LLM_API_KEY`，native `BAILIAN_CODING_PLAN_API_KEY`、`DASHSCOPE_API_KEY`、`OPENAI_API_KEY`，legacy `EBX_QWEN_CODE_API_KEY`；`llm_base_url` / `llm_model`：native `OPENAI_BASE_URL` / `OPENAI_MODEL`，legacy toml `qwen_code_base_url` / `qwen_code_model`。
* `template_index_url`、`template_dir`、`mcp_*`：不能用 `config set` 设置（和今天一样只用环境变量）。

连接池 / WS / 退避调优（`max_connections`、`max_keepalive_connections`、`keepalive_expiry`、`ws_ping_interval`、`retry_base_delay`）：只在文件里（`[transport]`），环境变量 `EBX_<KEY>`，本版本**不**通过 `config set` 暴露（和今天一样）。

### 1.3 内置 `alicloud-express` 的提供方作用域键

`region`、`access_key_id`、`access_key_secret`（密钥）、`acr_namespace`、`acr_registry`、`acr_repo`、`acr_username`、`acr_password`（密钥）、`acr_instance_id`、`acr_vpc_id`、`acr_vswitch_ids`、`acr_security_group_id`、`team_id` —— 规范环境变量 `EBX_ALICLOUD_EXPRESS_<KEY>`；native `ALICLOUD_ACCESS_KEY_ID` / `ALICLOUD_ACCESS_KEY_SECRET`；legacy `SANDBOX_REGION`、`AccessKey`、`AccessSecret`、`ACR_NAMESPACE`、`ACR_REGISTRY`、`ACR_REPO`、`ACR_USERNAME`、`ACR_PASSWORD`、`ACREE_INSTANCE_ID`、`ACR_VPC_ID`、`ACR_VSWITCH_IDS`、`ACR_SECURITY_GROUP_ID`、`TEAM_ID`，compat `E2B_TEAM_ID`。每个键的精确顺序和存储以 `config-keys.json` 为准（它是来源）。阶段 1 存储：密钥和类凭证值以其 **legacy** 名存入 `~/.ebx/.env`（`ALICLOUD_ACCESS_KEY_ID`、`ACR_NAMESPACE`、`ACR_PASSWORD`…）；`region` 存入 `[transport] region`；其他新的可设置键（`acr_registry`、`acr_repo`、`acr_username`、`acr_instance_id`、`acr_vpc_id`、`acr_vswitch_ids`、`acr_security_group_id`、`team_id`）存入 `[providers.alicloud-express]`。

核心键的使用：内置提供方隐式使用 `sandbox_api_key`、`sandbox_base_url`、`sandbox_domain`、`http_timeout`、`http2`、`max_retries`（+ 调优键）。**其他所有提供方**只使用非密钥的调优键；它们只能通过其清单的 `[core] inherit` 列表**与**用户在安装 / 更新时同意的列表（`receipt.consented.inherit`）的**交集**收到 `sandbox_api_key` / `sandbox_base_url` / `sandbox_domain`。这就是凭证隔离规则（设计 §4.6）：切换默认提供方绝不会把阿里云密钥发给插件。

### 1.4 保留字

以 `shortcuts` 开头的键名，以及表名 `core`、`transport`、`providers` 是保留的。提供方 id 不得与它们冲突（SDK 的 `RESERVED_PROVIDER_IDS` 在 JSON 导出里）。

---

## 2. 解析（必须与 Python 解析器逐位一致）

### 2.1 算法

```text
resolve(key K, provider P, sources S):
  names_env(K,P)  = [EBX_<P>_<K> 若 K 属于 P 的作用域,
                     EBX_<K>（核心键；对 P != builtin 只有当 K 是调优键或 K ∈ effective_inherit(P)）,
                     ...按顺序的 compat/native 环境变量名,
                     ...按顺序的 legacy 环境变量名]
  layers = [ S.overrides, S.environ, S.dotenv[0] (./.env), S.dotenv[1] (~/.ebx/.env), S.toml, default ]
  for layer in layers:                      # 先按层
      for name in names(layer):             # 名字顺序，最具体的优先
          v = layer[name]; 若 v 是非空白字符串 / 非 null：返回 (v, layer, name)
  return unset
```

* 空白 / 只含空格 = 在每一层（包括 overrides）都视为未设置。
* `S.dotenv` = 按顺序每个存在的候选文件（先 `./.env`，再 `~/.ebx/.env`）；按 dotenv 语义解析（`KEY=VALUE`、引号、`export` 前缀、注释），值做 `.trim()`。
* `K` 的 TOML 名字：`[providers.<P>].K`、`[transport].K`、`[transport].<legacy toml 名>`、顶层扁平 legacy 键（**仅当文件没有 `[transport]` 表**）。
* 数值 / 布尔强制转换与 SDK 相同（`float(text)` / 非法数值 → 写日志警告并视为未设置；布尔 `true/1/yes/on` / `false/0/no/off`）。
* **推导默认值**（由 `region` 推导 `sandbox_base_url`、`sandbox_domain`）：只对其 schema 声明了 `[endpoint.derive]` 的提供方生效，并且只有当基础 URL 没有被 override 或**进程环境变量**（任何名字）显式设置时才生效。每个推导出的键使用"设置默认值"语义（已有的 `.env` / toml 值保留）。保留这个怪癖：当 URL 由 override / 环境变量显式给出时，域名*不会*由区域推导。
* `config list` 的 `source` 标签：override→（不显示）、environ→`(env)`、dotenv/toml→`(user)`、derived / 内置→`(default)`、没有→`(not set)`。

### 2.2 提供方选择

`explicit (--provider or provider:ref) > EBX_PROVIDER env > EBX_PROVIDER in ./.env > EBX_PROVIDER in ~/.ebx/.env > [core] provider > alicloud-express`。未知的 id → `E8001`（退出码 4），并点名 `ebx provider list` / `ebx provider install`。

### 2.3 `config list`

分组和顺序（每组的键列表；键只有对**当前提供方**适用时才出现——对内置默认提供方，下面所有键都出现，与今天相同再加上新键）：

| 分组标题 | 键 |
|---|---|
| `Provider` | `provider` |
| `Sandbox authentication` | `sandbox_api_key` |
| `Alibaba Cloud credentials`（非内置时用当前提供方的显示名：`<display_name> credentials`） | 标记为 `credential` 的提供方键，然后是 `acr_namespace` |
| `Alibaba Cloud registry (ACR)`（仅内置） | `acr_registry`、`acr_repo`、`acr_username`、`acr_password`、`acr_instance_id`、`acr_vpc_id`、`acr_vswitch_ids`、`acr_security_group_id`、`team_id` |
| `Connection` | `sandbox_base_url`、`region`、`sandbox_domain`、`http_timeout`、`http2`、`max_retries` |
| `LLM` | `llm_api_key`、`llm_model`、`llm_base_url` |
| `Integrations` | `github_token` |
| `Shortcuts` | 不变 |

*新的*分组 / 键（`Provider`、ACR registry 分组）只有当其中至少一个键有值，或用户传了 `--all` 时才列出；因此**从未设置它们的用户看到的是旧列表，只是被重命名的行不同**（让 golden 差异最小）。`--json` 是以规范键为键的扁平 `{key: value}` 映射（`--legacy-names` 把被重命名的键换回去）。密钥的遮蔽与今天完全相同。

---

## 3. `ebx config`

### 3.1 新增 / 变化的选项（所有子命令 `get`、`set`、`delete`、`list`）

* `--provider ID` —— 针对提供方 `ID` 而不是默认提供方解析**裸提供方键**以及 list / get。限定键忽略它。
* 限定键 `providers.<id>.<key>` 适用于 `get/set/delete`。

### 3.2 `KEY` 的解析顺序（失败时退出码 2，错误风格与今天相同）

1. `shortcuts`、`shortcuts.*` → 不变。
2. 规范核心键或 legacy 别名（`api_key`→`sandbox_api_key`、`api_url`/`api_base_url`→`sandbox_base_url`、`domain`→`sandbox_domain`）。
3. `providers.<id>.<key>`（限定）—— `<id>` 必须是内置或已安装的（`E8001`），`<key>` ∈ 该提供方的 schema 或它继承的核心键（`effective_inherit`，见 §1.3）—— 对被继承的核心键，限定形式是一个*覆盖*：`providers.<id>.sandbox_base_url` 存入 `[providers.<id>]`，只对该提供方优先于通用键。
4. 当前提供方 schema 中的裸键（`--provider`，否则默认提供方）。未找到 → `Unknown config key: 'x'`，建议 `Available keys: …`（格式与今天相同，现在列出核心键 + 当前提供方键），并且当其他已安装提供方声明了它时，再加第二句：`Did you mean 'providers.<id>.x'?`。
5. 已移除的键（`qwen_code_*`）→ 信息不变。

### 3.3 `set` 时的存储

当 `[core] config_format` 缺失或为 `1` 时按 `storage_phase1`，为 `2` 时按 `storage_phase2`。写入方在写规范名时，永远不会删除同一个键以 legacy 名存储的值，**除非** `config_format = 2`；此时写入键 K 会删除 K 的 legacy 命名副本（像今天的 llm 迁移一样），所以过期的 legacy 值不会再出现。清除（`set K ""` / `delete`）会删除 K 的**每一个**已存储名字（规范和 legacy，toml 和 env）——把今天 `llm_api_key` 的行为扩展到所有键。消息字符串不变（`Set sandbox_base_url = …`、`Cleared sandbox_base_url (falls back to default: …)`）；当用户键入的是 legacy 键时，成功行回显**用户键入的键**（现有脚本的 stdout 不变）。

### 3.4 交互提示（唯一默认开启的信号）

在正常的 stdout 行之后，当且仅当 **stderr 是 TTY**，并且没有 `--json`/`--quiet`/`--ci`/CI 环境，并且键入的键是被重命名的 legacy 配置键（`api_key`、`api_url`、`api_base_url`、`domain`）时，向 **stderr** 打印：

```
note: 'api_url' is now 'sandbox_base_url' (the old name keeps working).
```

### 3.5 `ebx config check`

```
Usage: ebx config check [--strict] [--json]

Report legacy names in use (environment, ./.env, ~/.ebx/.env, ~/.ebx/config.toml) and their canonical replacements. Values are never printed.
```

文本输出（每个发现一行，输出到 stdout；干净时除了 `No legacy names in use.` 什么都不输出）：

```
env      SANDBOX_API_KEY            -> EBX_SANDBOX_API_KEY (sandbox_api_key)
config   [transport] api_url        -> sandbox_base_url
```

`--json`：`[{"where":"env","name":"SANDBOX_API_KEY","canonical_key":"sandbox_api_key","canonical_name":"EBX_SANDBOX_API_KEY","kind":"legacy"}]`。只报告 `legacy` 类（绝不报告 `compat` / `native`）。退出码 0；带 `--strict` 且列表非空时退出码 1。

### 3.6 `ebx config migrate`

```
Usage: ebx config migrate [--yes] [--dry-run]

Rewrite stored names in ~/.ebx/config.toml and ~/.ebx/.env to the canonical names (config_format = 2).
Older ebx/easy-sandbox versions will no longer read the migrated values.
```

备份 `config.toml.bak` / `.env.bak`（0600，覆盖之前的备份），除非 `--yes` 否则提示（非 TTY 且没有 `--yes` → 退出码 2），支持 `--dry-run`（打印 `would rename X -> Y` 行，不写任何东西）。设置 `[core] config_format = 2`。幂等。Python SDK 提供参考实现（`transport.config.plan_migration()` / `apply_migration()`）；对同样的输入，Node 的计划输出必须与 Python 的计划相等（向量 `migration-*.json`）。

### 3.7 `ebx config init`

对内置提供方，提示文本**不变**（仍写 `sandbox_api_key / E2B_API_KEY`、"Alibaba Cloud AccessKey ID" 等）——golden 稳定。当默认提供方不是内置的（或 `--provider ID`）时，向导由提供方的 schema 生成：按清单顺序每个字段一个提示（`i/N Description (key[, ENV_NAME])`，密钥遮蔽，必填项标 `*`），然后 `Stored <key> in ~/.ebx/.env` / `Set <key> = <value>`，最后 `Configuration complete. Review it with 'ebx config list --provider ID'.`。

### 3.8 帮助文本增量

`ebx config get --help` / `set --help` 的 "Available keys" 块在现有条目之后（并重命名 `api_url` / `domain` 行）按此顺序增加：`provider`、`sandbox_base_url`、`sandbox_domain`、`acr_*` 键、`team_id`、`providers.<id>.<key>`。措辞（逐字）：

```
sandbox_base_url   Platform API URL, any E2B-protocol endpoint (e.g.
                   https://api.cn-hangzhou.e2b.fc.aliyuncs.com). Old name:
                   api_url (still accepted).
sandbox_domain     Envd data-plane domain (e.g. cn-hangzhou.e2b.fc.aliyuncs.com).
                   Old name: domain (still accepted).
provider           Default provider id (see 'ebx provider list'; default:
                   alicloud-express).
providers.<id>.<key>
                   Provider-scoped value; bare keys such as 'region' refer to the
                   default provider (or --provider ID).
```

`ebx config --help` 的第一段不变；增加示例 `ebx config set providers.my-cloud.cluster prod`。

---

## 4. `--provider`、`--opt` 与选项别名

### 4.1 `--provider`

* 接受为**根选项**（`ebx --provider ID <cmd> …`），也接受为每个与提供方通信的命令上的**命令级选项**；命令级的值优先。帮助：`--provider ID  Provider for this command (default: 'ebx provider default' value, else alicloud-express)`。
* 接受它的命令（及其需要的特性）：`create`/`sandbox create`（`sandbox.lifecycle`）、`list`/`sandbox list`、`info`、`kill`、`connect`、`exec`、`run`、`shell`、`shell-stream`（`exec.run`/`exec.stream`）、`upload`/`download`/`files`（`files.rw`）、`sandbox process …`（`process.manage`）、`sandbox system …`、`sandbox timeout`（`sandbox.timeout`）、`sandbox pause/resume`（`sandbox.pause`）、`template list/info/build/deploy/delete/install/push/create` 和 `deploy`（`templates.read`/`templates.build`）、`mcp install/start/deploy`（`sandbox.lifecycle`）。
* 不绑定提供方（永不接受）：`config`（有自己的 `--provider` 用于限定范围）、`template init/search`、`mcp status`、`provider *`。
* 拼写提示：未知的 id 会在 `E8001` 的建议里加上 `Did you mean 'X'?`（对内置 / 已安装 id 的编辑距离 ≤ 2）。缺少特性 → 在任何副作用**之前**失败：退出码 1，`[E8004] Provider 'ID' does not support 'FEATURE'.` + 建议 `Run 'ebx provider info ID' to see supported features.`（JSON：`{"status":"error","code":"E8004","message":…,"suggestion":…}`）。
* 内置提供方的提供方作用域选项（`--region/-r`、`--acr-*`、`--team-id`、`--vpc-id`、`--vswitch-ids`、`--security-group-id`）只有当生效的提供方声明了对应的键时才被接受；否则退出码 2：`Option '--region' is not supported by provider 'ID'.`，建议 `Use '--opt KEY=VALUE' for provider options (see 'ebx provider info ID').`

### 4.2 `--opt KEY=VALUE`（可重复）

为本次调用设置提供方作用域的键（override 层）。`KEY` ∈ 生效提供方的 schema（或一个被继承的核心键，作为对该提供方的覆盖）。语法错误 / 未知键 → 退出码 2（`E8002`）。`--opt` 的值会出现在 argv 里：对 `secret` 字段，CLI 拒绝（`E8002`：`Field 'KEY' is secret; set it with 'ebx provider config ID set KEY' or the EBX_<ID>_<KEY> environment variable.`）。

### 4.3 选项别名（同一个选项、同一个环境变量、同样的行为）

| 规范 | 别名 | 命令 |
|---|---|---|
| `--sandbox-api-key` | `--api-key` | `mcp install`、`mcp start`（以及下面获得它的命令） |
| `--sandbox-base-url` | `--api-url` | 同上 |
| `--sandbox-domain` | `--domain` | 同上 |
| `--acr-instance-id` | `--acree-instance-id` | 模板命令 |

绑定到选项的环境变量遵循 §2（选项的 envvar 列表 = 规范 + compat + legacy，按顺序）。现有 `mcp install` 把 `E2B_API_URL` / `SANDBOX_REGION` 复制到编辑器配置的行为保持不变；当它们在进程环境变量里设置时，还会复制 `EBX_SANDBOX_BASE_URL` / `EBX_ALICLOUD_EXPRESS_REGION`，**使用 legacy 名**（编辑器配置可能被旧版本读取），除非 `config_format = 2`。

### 4.4 限定的沙箱引用

输入语法：每个接受沙箱 id 的命令（`info`、`kill`、`exec`、`connect`、`upload`、`download`、`files`、`sandbox process/system …`）都接受 `[provider:]sandbox_id`。只有当第一个 `:` 之前的部分符合提供方 id 语法**并且**等于某个内置 / 已安装的提供方 id 时，才解析前缀；否则整个字符串就是 id。输出格式规则（Python / Node 相同）：**旧格式**（裸 id，没有 `provider` 字段）**只有当**环境提供方（配置的默认值，忽略 `--provider`）**和**生效提供方都是 `alicloud-express` 时才使用。其他所有情况下，文本模式（表格和 `--quiet`）里打印的 id 是限定的（`local-process:sbx-1`），`--json` 的行增加 `"provider"`（裸 id 仍在 `sandbox_id`/`ID` 里）。理由：从输出里粘贴的 id 在默认提供方之后被更改时仍必须无歧义，而只用内置提供方的脚本看不到任何变化。`--provider P` + 引用 `Q:id` 且 `P≠Q` → 退出码 2 `[E8030] Sandbox reference 'Q:id' conflicts with --provider P.`

`ebx list --all-providers` —— 增加 `Provider` 列 / 键，查询每个已配置（其 `credential` 字段能解析）的提供方，跳过失败的提供方并向 stderr 打印警告（`warning: provider 'ID' skipped: <message>`），至少一个成功则退出码 0，否则为第一个错误的退出码。

---

## 5. `ebx provider`

```
Usage: ebx provider [OPTIONS] COMMAND [ARGS]...

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
  ebx provider list
  ebx provider install ./my-provider
  ebx provider install https://github.com/acme/ebx-provider-acme.git --ref 4f1c2ab9e0d5c3b7a1f2e8d9c0b1a2f3e4d5c6b7
  ebx provider default acme
  ebx create --provider acme --template base
```

相关命令（也作为 `ebx --help` 的最后一段打印）：`ebx config`、`ebx info`。

每个子命令都遵守 `--json/--quiet/--ci/--no-color/--verbose` 和标准的 `-h/--help`。

### 5.1 `list`

`ebx provider list` → 标准表格，表头 `["ID", "Name", "Version", "Kind", "Trust", "Default"]`，行先内置，然后已安装的按 id 排序；`Default` 为 `yes` 或空；`Kind` ∈ `builtin|rest|exec`；`Trust` ∈ `builtin|pinned|local|link|unpinned`。`--json` = 表格的对象列表（沿用既有风格，键是表头字符串）。始终至少有内置行。`--quiet` 只打印 id（每行一个；标准的 quiet 表格输出是制表符分隔的行——这里**覆盖**：只输出 id，已文档化）。

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
                     "default": "cn-hangzhou", "env": "EBX_ALICLOUD_EXPRESS_REGION",
                     "aliases": ["SANDBOX_REGION"], "description": "…", "description_zh": "…"}],
  "inherit": ["sandbox_api_key", "…"],
  "install": null
}
```

对已安装的提供方，`install` = 回执对象（设计 §7.6），其中 `source.url` 的凭证已被遮蔽。未知 id → 退出码 4 `[E8001] Provider 'x' is not installed.`（建议 `Run 'ebx provider list'; install with 'ebx provider install <path-or-git-url>'.`）。

### 5.3 `install SOURCE`

```
Usage: ebx provider install [OPTIONS] SOURCE

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
Source        https://github.com/acme/ebx-provider-local-process.git @ 4f1c2ab9… (pinned)
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
| 清单缺失 / 无效 | E8014 | 1 | `Invalid ebx-provider.toml: <reason>.` |
| id 被保留 / 没有 `--force` 就冲突 | E8003 | 1 | `Provider id 'x' is already installed.` / `reserved` |
| 摘要不匹配 | E8011 | 1 | `Tree digest mismatch: expected <a>, got <b>.` |
| 非交互且没有 `--yes` | E8012 | 2 | `Installing a provider requires confirmation.` / `Re-run with --yes after reviewing: ebx provider install <source> --ref <commit>` |
| 非交互下未固定的 git 且没有 `--allow-unpinned` | E8012 | 2 | `Refusing an unpinned git source in non-interactive mode.` / `Pass --ref <40-hex commit> or --sha256 <digest>.` |
| `--link` 没有 `--yes`，或在 Windows 上 | E8012 | 2 | `--link requires --yes (the linked code is not pinned).` / `--link is not supported on Windows.` |
| 不安全的传输 / URL 中有凭证 | E8012 | 2 | `Insecure provider source 'git://…'.` / `Credentials in URLs are not accepted; use an SSH agent or a git credential helper.` |
| 不兼容的 `requires` / 协议 | E8013 | 1 | `Provider requires ebx cli >=0.4 (this is 0.3.0).` |
| 路径 / 大小 / 符号链接违规 | E8010 | 1 | `Unsafe entry 'a/../b' in provider source.` 等 |

### 5.4 `uninstall ID`

选项 `--purge`（同时从 `~/.ebx/.env` 删除 `[providers.<id>]` 和 `EBX_<ID>_*`，并删除 `data/` 目录）、`-y/--yes`。提示 `Remove provider 'ID'? [y/N]`（非交互且没有 `--yes` → 退出码 2 `E8012`）。内置 → 退出码 2 `[E8003] The built-in provider cannot be removed.`。如果它是默认提供方：stderr 提示 `Default provider reset to 'alicloud-express'.`。未知 → 退出码 4 `E8001`。成功 `Removed provider 'ID'`。

### 5.5 `update [ID | --all]`

选项：`--ref TEXT`、`--check`、`--all`、`-y/--yes`。`--check` 打印 `ID  installed → available (changes: runtime, security)` 行（表头 `["ID","Installed","Available","Changes"]`），不改动任何东西（退出码 0）。更新遵循设计 §7.6（仅当运行命令 / 安全 / 特性 / 配置字段变化时才重新同意，已固定的需要 `--ref`，`initialize` 失败则回滚）。`link` 和 `local` 安装：`[E8010] Provider 'ID' was installed from a local directory; reinstall it with 'ebx provider install --force <path>'.`（退出码 1）。无需更新：`All providers are up to date.`

### 5.6 `default [ID]`

* 无参数：打印生效的默认 id（stdout，一行；`--json` → `{"default":"…","source":"env|dotenv|config|builtin"}`），退出码 0。
* `ID`：校验它存在，写入 `[core] provider = "ID"`，打印 `Default provider set to 'ID'`（如果设置了 `EBX_PROVIDER` 且覆盖了它，则向 stderr 额外警告：`note: EBX_PROVIDER=… overrides this at runtime.`）。
* `--unset`：删除该键，打印 `Default provider reset to 'alicloud-express'`。
* 设置内置 id 不写任何特殊内容（删除该键）。

### 5.7 `config ID …`

```
ebx provider config ID list           # == ebx config list --provider ID
ebx provider config ID get KEY        # == ebx config get providers.ID.KEY
ebx provider config ID set KEY [VALUE]# masked prompt for secrets, same rules as `ebx config set`
ebx provider config ID unset KEY      # == ebx config delete providers.ID.KEY
ebx provider config ID init           # guided prompts from the schema (as §3.7)
```

`set` 的校验：按清单字段类型强制转换；`enum` 成员检查；`url` 必须能解析；`path` 原样存储；`required` 字段只在命令运行时才强制检查。错误 → 退出码 2 `E8002`（`Invalid value for 'KEY': <reason>.`）。

### 5.8 `doctor [ID]`

无副作用地运行：清单有效、摘要与回执一致、`requires` 正常、配置完整性（`required` 字段由哪个来源解析——只输出名字）、启动插件、`initialize`、比较宣告的特性与声明的特性。输出行 `ok|warn|fail  <check>  <detail>`；全部 ok / warn 时退出码 0，任何 fail 时退出码 1。`--json` → `[{"check":"digest","status":"ok","detail":"…"}]`。当通用 `sandbox_api_key` 会被发送给该提供方，并且它同时也是另一个已配置提供方的生效键时发出警告。

---

## 6. Node 架构（建议；保持与 Python 模块对应的规则）

| 模块 | 职责 |
|---|---|
| `src/utils/config_keys.ts` | 来自 `config-keys.json` 的注册表；`resolve()`；`exportSchema()`；别名辅助函数 |
| `src/transport/config.ts` | `loadConfig`、`explainConfig`、`auditConfig`、`planMigration`/`applyMigration`；遵守 Python 测试打补丁的同样接缝 |
| `src/providers/base.ts` | `Provider`、`ProviderFeature`、`ConfigField`、`ProviderInfra` |
| `src/providers/registry.ts` | 内置 + 已安装发现，选择优先级（§2.2） |
| `src/providers/builtin.ts` | 包装今天代码路径的 `alicloud-express`（行为不变） |
| `src/providers/manifest.ts` | TOML 解析（`smol-toml`）+ 全部校验规则 + 版本比较器 |
| `src/providers/store.ts`、`installer.ts` | 布局、锁、回执、**目录树摘要**、git clone 加固、文件系统安全检查、同意界面、更新 / 回滚 |
| `src/providers/exec_provider.ts` | EPP/1 客户端（基于 `child_process.spawn` 的 NDJSON JSON-RPC，`shell:false`，清理过的环境，进程组终止），错误映射表 |
| `src/providers/rest_provider.ts` | 基于现有 envd 传输、由清单驱动的端点预设 |
| `src/cli/commands/provider.ts` | §5 的命令 |
| `src/cli/commands/config_cmd.ts` | §3 的增量 |

接口（线上字段保持 `snake_case`）：

```ts
export interface Provider {
  id: string; displayName: string; displayNameZh: string; version: string;
  kind: "builtin" | "rest" | "exec";
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

1. `tests/utils/config_keys.test.ts` —— 注册表等于 `config-keys.json`；设计 §5 的每个别名行都能解析；id 语法和保留 id；环境变量名推导（`EBX_ALICLOUD_EXPRESS_ACR_VPC_ID`）。
2. `tests/transport/config_resolution.test.ts` —— **所有向量**；dotenv 先按层；空白值；legacy 扁平 toml；推导怪癖；提供方作用域优先于通用；无跨提供方泄露；`http_timeout_configured` 的等价物。
3. `tests/cli/test_config_cmd_providers.test.ts` —— 键解析顺序（§3.2），包括 `--provider`、限定键、歧义建议；阶段 1 与阶段 2 的存储；清除会删除每个已存储名字；按用户键入回显；仅 TTY 的提示（TTY 开：stderr 一行，TTY 关 / `--json` / `--quiet` / `--ci`：什么都没有）；`config list` golden（被重命名的行；`--legacy-names`；`--all`）；`config check`（+ `--strict`、JSON，绝不报告 compat / native，绝不打印值）；`config migrate`（预演、幂等、备份 0600、与计划向量一致、非 TTY 没有 `--yes` 就拒绝）。
4. `tests/cli/test_legacy_names_silent.test.ts` —— 对每个 legacy 环境变量 / 配置 / 选项名：命令输出与使用规范名的运行逐字节相同；设置 `EBX_WARN_DEPRECATED=1` 时每个 legacy 名一行 stderr；`compat` / `native` 永不警告。
5. `tests/providers/manifest.test.ts` —— 设计 §7.5 的每条校验规则（每条一个测试）、版本比较器表、命令逃逸规则。
6. `tests/providers/store_installer.test.ts` —— 本地目录；通过临时裸仓库的 git（`file://` 用 `--allow-insecure-transport`）；已固定 / 未固定 / `--sha256`；符号链接 / 硬链接 / 穿越 / 大小写冲突 / 大小 / 文件数拒绝；URL 凭证拒绝 + 遮蔽；`--link` 需要 `--yes`；`ls-tree` 校验在写任何 blob **之前**拒绝符号链接 / 子模块 / 超大条目；未固定措辞（`tag/branch installs are not pinned`）；**目录树摘要向量**；金丝雀测试（插件被执行会写文件 → 安装后绝不能存在）；编辑文件后的完整性失败；更新重新同意矩阵；回滚；卸载 / purge；默认值回退；锁竞争；原子交换的崩溃安全（在暂存和交换之间终止，旧安装保持完好）。
7. `tests/providers/exec_provider.test.ts` —— 针对 `examples/providers/local-process`（从 python-sdk 复制）：握手、版本不匹配（`E8013`）、特性门控、**错误映射表**、超时、崩溃附 stderr 末尾、格式错误 / 超长的行、环境清理（插件回显环境：没有 `EBX_*`/`E2B_*`/`ALICLOUD_*`）、密钥只经 `initialize`、进程组终止、取消、带 `envd_url` 的混合模式；**插件 stderr 被遮蔽**（插件向 stderr 回显密钥：该密钥绝不会到达 CLI 的 stderr、doctor 输出或错误信息），并且 `initialize` 请求绝不会写入调试 / 日志输出。
8. `tests/cli/test_provider_cmd.test.ts` —— §5 的每个命令：帮助 golden、表格 / JSON 形状、quiet 覆盖、退出码、错误表、同意界面 golden、非交互拒绝、`default` 消息（含 `EBX_PROVIDER` 提示）、`doctor` 输出。
9. `tests/cli/test_provider_flag.test.ts` —— `--provider` 根级 + 叶子级的优先级，缺少特性在副作用之前失败（断言没有 HTTP / Docker 调用），提供方作用域选项的拒绝文本，`--opt` 密钥拒绝，限定引用，`E8030`，`list --all-providers` 部分失败，JSON 的 `provider` 键只对非内置提供方出现。
10. **差分（oracle）用例**放在 `parity/diff/` 下：只用内置提供方时，每个现有用例都逐字节相同，`config list` 用例除外（golden 按 §0 更新）。新增用例：设置 legacy 环境变量与设置规范环境变量 → 针对 stub 的 `list`、`create`、`kill` 输出相同。
11. 跨实现一致性：用 **Node** 安装器安装来自 Python 仓库的 `examples/providers/local-process`，然后用 **Python** SDK 加载它（反过来亦然）：回执摘要相同，两者都接受对方的回执。

---

## 8. CLI 后续事项清单（有序）

1. 等待移植达到对等（所有 ledger 测试通过，`parity:coverage` 干净）。
2. 把夹具从 `python-sdk/client-sdk/tests/fixtures/` 复制到 `docs/design/fixtures/` 和 `tests/fixtures/`（Python 仓库是事实来源）；增加夹具同一性测试。
3. 实现 `config_keys.ts` + 先按层的解析器；把 `config_cmd.ts` 移植到它上面；对 legacy 名保留**所有**旧行为；重新生成 `config list` 的 golden。
4. 给每个选项的 `envvar` 列表加上规范环境变量名，加上 `--sandbox-*` 选项别名，通过 `config set` 支持 `acr_*` 键。
5. 增加 `config check`、`config migrate`、TTY 提示、`--legacy-names`、`EBX_WARN_DEPRECATED`。
6. 实现提供方：清单 → 存储 / 安装器（+ 摘要）→ 注册表 / 内置 → `exec_provider` / `rest_provider` → `ebx provider …` → `--provider/--opt` 接线 → 限定引用 → `list --all-providers`。
7. 更新 CLI 文档（`cli-design`、`cli-reference`、`configuration`、`environment-variables`、`authentication`，新的 `providers` 指南）及其 zh 镜像；`SKILL.md`；`llms.txt`；CHANGELOG。
8. 让 `mcp install` 的复制规则（§4.3）和 MCP server 环境（`EBX_PROVIDER` 会被转发）保持一致。
9. 由没有编写该切片的对抗者进行一轮评审（按 PORTING.md），把发现追加到 `parity/review-log.md`。
10. 留待以后的事项（现在不要做）：OS 级的插件约束、钥匙串密钥存储、注册表 / 市场来源、长期运行的插件守护进程（EPP/2）、gRPC 传输。

---

## 9. 来自 Python 实现的说明（与上文不一致之处以此为准）

Python SDK 一侧是在本规格评审之后实现的。以下几点是实现时做出的决定；Node 实现必须与之一致（共享夹具编码了其中大部分）。

1. **E8005 `ProviderResourceNotFoundError`** 已存在。EPP `-32002` 映射到 `data.sdk_code` 指定的类（E2001、E4001…）；没有 `sdk_code` 时映射到 E8005（而不是 E2000）。退出码 4。`exit_code_for` 顺序：认证 → 3，未找到系列（E8001、E8005、`TemplateNotFoundError`、`FileNotFound_`）→ 4，超时（`CommandTimeoutError`、E8022）→ 5，配额 → 6，配置 / 信任 / 不匹配（E8002、E8012、E8030）→ 2，其他 → 1。以 `epp-error-mapping.json` 为准。
2. **`sandbox.kill` 在宿主适配器处是幂等的**：`sandbox.kill` 返回的 E8005 被吞掉（沙箱已经不存在），所以对已消失沙箱执行 `ebx kill` 的行为与内置提供方相同。插件自己也应该让 kill 幂等；契约套件会检查。
3. **没有 envd 的提供方**把标记 URL `epp://<provider>/<sandbox_id>` 当作沙箱的 envd URL；每个会调用 envd 的代码路径（命令列表、认证检查、终端）都必须跳过 `epp://` URL，改用提供方的数据面方法。
4. **清单 `command`**：以 `./` 开头的元素在插件目录内解析，不得逃逸；同意界面按原样打印 argv（`python3 ./provider.py`）。
5. **插件环境**额外带 `PYTHONDONTWRITEBYTECODE=1`（解释器不得往受摘要校验的目录里写东西）。顶层 `data/` 保留给插件状态，并排除在目录树摘要之外；`update` 会保留 `data/`。
6. **进程清理**：插件退出之后（无论是否正常），宿主仍会终止进程组，所以孙进程不能活过一次会话（`EppClient.close`）。
7. **`close()`**：提供方进程由 sandbox 对象持有；Python API 增加了 `Sandbox.close()`。CLI 调用必须在每条退出路径（包括 `Ctrl-C`）上关闭其提供方。
8. **迁移**：当移走键之后 `[transport]` 表变空时，`apply_migration` 会删除它；备份是 `config.toml.bak` / `.env.bak`（权限 0600）；`sandbox_api_key` 的阶段 1 存储名是 `E2B_API_KEY`，`sandbox_base_url` 是 `api_url`（`[transport]`），迁移会重命名它们。`migration-vectors.json` 编码了精确的前后文件。
9. **`python -m easy_sandbox.providers`** 是 `ebx provider` 只用 SDK 的孪生版本（相同布局、相同回执、相同摘要）。一个工具安装的提供方必须能被另一个加载（§7 第 11 项）。
10. **Python 中未实现（后续事项，CLI 同样适用）**：`sandbox.yaml` 的 `provider:` / `provider_options:` 和 `@sandbox(provider=...)`；OS 约束；SDK 中的 `list --all-providers` 聚合辅助（SDK 只提供按提供方的 `Sandbox.list(provider=...)`）。
