# 提供商（Providers）

**提供商** 是一个沙箱后端。`ebx` 内置一个提供商，并可通过可安装的插件驱动更多后端。本页是 CLI 视角：如何在命令行安装、选择、配置并使用提供商。共享概念（清单、信任模型、EPP/1 协议、能力矩阵）只在 Python SDK 仓库中记录一次：[Providers 指南](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/zh/guide/providers.md) 与 [提供商与凭证设计](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/zh/design/providers-and-credentials.md)。编写插件请见 [编写提供商](authoring-providers.md)。

| Id | 名称 | 类型 | 默认 |
|---|---|---|---|
| `alicloud-express` | 阿里云极速版 (Alibaba Cloud Express Edition) | 内置 | 是 |

> **不使用提供商时，一切照旧。** 没有安装任何插件、也没有选择提供商时，所有命令、每一个输出字节与每一个环境变量的行为都与 0.2.x 相同。在安装插件或设置非内置默认提供商之前，`provider` 命令组不会出现在 `ebx --help` 中（但始终可以调用）。CLI 包版本为 0.3.0；`python-sdk` 中的 Python SDK 版本钉是另一条发布线。

---

## 安装、查看、移除

```bash
ebx provider list                                    # 内置在前，然后是已安装的
ebx provider install ./my-provider                   # 本地目录
ebx provider install https://github.com/acme/ebx-provider-acme.git \
  --ref 4f1c2ab9e0d5c3b7a1f2e8d9c0b1a2f3e4d5c6b7     # 钉到完整 commit 的 git URL
ebx provider info my-cloud                           # 清单、特性、选项、信任、摘要
ebx provider update --check                          # 查看将发生的变化（只读）
ebx provider update my-cloud
ebx provider uninstall my-cloud                      # 除非 --purge，否则保留设置
```

`install` 做什么、不做什么：

- **安装期间不会执行插件的任何代码。** git 源只获取不检出，每个树条目都经过校验（仅普通文件，限制大小与数量），由安装器自己写入文件。
- 会打印 **同意界面**（id、版本、来源、commit 与摘要、将运行的命令、声明的安全块、特性、选项，以及你的通用沙箱凭证是否会发送给插件）。没有终端或使用 `--json` 时必须加 `--yes`（退出码 2，`E8012`）。
- 来源通过完整的 40 位十六进制 `--ref` 或 `--sha256 <树摘要>` 来 **钉住**。标签或分支属于未钉住，需要 `--allow-unpinned`。`--link` 表示原地开发安装，不做完整性检查。`--allow-insecure-transport` 启用 `file://`、`git://` 与 `http://`（仅用于测试与开发）。带内嵌凭证的 URL 会被拒绝（`E8012`）。
- 每次插件启动都会校验树摘要（文件被改动时报 `E8011`）。`--force` 替换同一 id 的现有安装。

无副作用地检查一个提供商：

```bash
ebx provider doctor my-cloud            # 已安装 / 完整性 / 配置 / 握手，失败时退出码 1
ebx provider test my-cloud -o region=eu # 通过 CLI 使用的同一批适配器运行契约测试
```

---

## 选择提供商

优先级从高到低：

| 位置 | 示例 |
|---|---|
| 限定引用 | `ebx kill my-cloud:sbx-1` |
| 标志（任意位置） | `ebx create --provider my-cloud --template base` |
| 进程环境变量 | `export EBX_PROVIDER=my-cloud` |
| `./.env`，然后 `~/.ebx/.env` | `EBX_PROVIDER=my-cloud` |
| `~/.ebx/config.toml` | `[core]` `provider = "my-cloud"`（`ebx provider default my-cloud`、`ebx config set provider my-cloud`） |
| 内置 | `alicloud-express` |

```bash
ebx provider default                   # 当前生效的默认值，一行（--json：{"default": ..., "source": ...}）
ebx provider default my-cloud          # 持久化
ebx provider default --unset           # 恢复为 alicloud-express
```

未知 id 以退出码 4 结束（`E8001`）。单条命令的提供商选项用 `--opt KEY=VALUE` 传入（可重复、任意位置）；清单中标记为 `secret` 的选项在命令行上会被拒绝（`E8002`），避免密钥进入 shell 历史，请改用 `ebx config set providers.<id>.<key>`。

### 沙箱 ID 是限定的

每个接受沙箱 id 的命令都接受 `[provider:]sandbox_id`；只有前缀恰好是已知提供商时才算前缀。`--provider P` 与引用 `Q:id` 同时出现且 `P` 与 `Q` 不同，则以 `E8030` 失败（退出码 2）。

打印 id 遵循同一条规则：只有当配置的默认提供商与实际生效的提供商都是 `alicloud-express` 时，才使用 **旧格式**（裸 id、无 `provider` 字段），因此只用内置提供商的脚本看不到任何变化。其他情况下，文本模式打印 `local-process:sbx-1`，`--json` 行增加 `"provider"`。

```bash
ebx --provider local-process create --template base      # ID: local-process:sbx-1
ebx exec local-process:sbx-1 "echo hello"
ebx list --all-providers                                 # 所有已配置的提供商，带 Provider 列
ebx kill local-process:sbx-1 --yes
```

`list --all-providers` 会跳过失败的提供商（例如缺少凭证），并在 stderr 打印 `warning: provider 'ID' skipped: ...`；只要有一个提供商响应成功就以 0 退出。`--region` 等内置提供商标志，若提供商没有声明对应的键，会被拒绝：`Option '--region' is not supported by provider 'ID'.`

如果命令需要提供商未声明的特性（例如在没有 `process.*` 的提供商上使用 `ebx sandbox process`），会在发出任何请求之前以 `E8004` 失败。

---

## 凭证与配置键

每个键只有一个 **规范名称**；旧名称继续可用。

| 键 | 规范环境变量 | 旧名称 / 兼容名称 |
|---|---|---|
| `provider` | `EBX_PROVIDER` | - |
| `sandbox_api_key` | `EBX_SANDBOX_API_KEY` | `E2B_API_KEY`、`SANDBOX_API_KEY` |
| `sandbox_base_url` | `EBX_SANDBOX_BASE_URL` | `E2B_API_URL`、`SANDBOX_API_BASE_URL`、配置项 `api_url` |
| `sandbox_domain` | `EBX_SANDBOX_DOMAIN` | `E2B_DOMAIN`、配置项 `domain` |
| `region` | `EBX_ALICLOUD_EXPRESS_REGION` | `SANDBOX_REGION` |
| `access_key_id`、`access_key_secret` | `EBX_ALICLOUD_EXPRESS_ACCESS_KEY_ID`、`..._SECRET` | `ALICLOUD_ACCESS_KEY_ID`/`_SECRET`（原生）、`AccessKey`、`AccessSecret` |
| `acr_*`、`team_id` | `EBX_ALICLOUD_EXPRESS_<KEY>` | `ACR_NAMESPACE`、`ACR_PASSWORD` 等 |
| 插件选项 `<key>` | `EBX_<PROVIDER_ID>_<KEY>`（短横线变下划线） | 插件声明的 `env` 名称 |

单个键的解析顺序：命令行覆盖、进程环境变量、`./.env`、`~/.ebx/.env`、`~/.ebx/config.toml` 中的 `[providers.<id>]` 与 `[transport]`、派生值、默认值。空白值视为未设置。插件 **只** 会收到它声明的选项以及你在安装时同意的通用键（`[core] inherit`），其余一概不会进入它的环境。

`ebx config` 可以操作所有这些键：

```bash
ebx config set sandbox_base_url https://api.example.com      # 规范名；"api_url" 仍然可用，并按输入原样回显
ebx config set acr_repo my-repo                              # 内置提供商的键（存放在 [providers.alicloud-express]）
ebx config set providers.my-cloud.region eu-1                # 限定名：某个提供商的选项
ebx config set --provider my-cloud region eu-1 # 当前提供商的裸键
ebx config set providers.my-cloud.token                      # 密钥：掩码提示，存放在 ~/.ebx/.env
ebx config get providers.my-cloud.token                      # 始终掩码
ebx config list --provider my-cloud                          # 该提供商的键以及每个值的来源
```

仅存在于另一个已安装提供商中的裸键会被拒绝，并提示 `Did you mean 'providers.<id>.<key>'?`。`ebx provider config <id> list|get|set|unset|init` 是限定到单个提供商的同一套能力。

### 发现并迁移旧名称

```bash
ebx config check              # 列出正在使用的旧名称（只列名称，不显示值）；--strict 在存在时退出码 1
ebx config migrate --dry-run  # 打印 "would rename X -> Y"
ebx config migrate --yes      # 重写 ~/.ebx/config.toml 与 ~/.ebx/.env，保留 *.bak（权限 0600），设置 config_format = 2
```

`migrate` 是幂等的。迁移之后，`ebx config list` 显示规范名称（`sandbox_base_url`、`sandbox_domain`）；`--legacy-names`（或 `EBX_CONFIG_LEGACY_NAMES=1`）在下一个版本内仍可打印旧名称。**更旧版本的 ebx / easy-sandbox 不再读取迁移后的值。** 旧名称默认静默，设置 `EBX_WARN_DEPRECATED=1` 后每个名称在 stderr 打印一行。在终端中，`ebx config set api_url ...` 会在 stderr 追加 `note: 'api_url' is now 'sandbox_base_url' (the old name keeps working).`

---

## 退出码与错误

| 代码 | 退出码 | 含义 |
|---|---|---|
| `E8001` 提供商未找到 | 4 | 未安装；见 `ebx provider list` |
| `E8002` 配置 | 2 | 未知或无效的选项、命令行上的密钥 |
| `E8003` 冲突 | 1 | 已安装（使用 `--force`） |
| `E8004` 特性不支持 | 1 | 提供商未实现该特性 |
| `E8005` 资源未找到 | 4 | 提供商找不到沙箱/模板/文件 |
| `E8010`-`E8014` 安装、完整性、信任、版本、清单 | 1 或 2 | `E8012` 与 `E8002` 类的信任问题退出码 2 |
| `E8020`-`E8022` 协议、进程、超时 | 1 或 5 | 插件行为异常或超时（超时退出码 5） |
| `E8030` 引用不匹配 | 2 | `--provider P` 搭配 `Q:id` |
| `E2009` 沙箱未找到 | 4 | 已被终止或已过期的沙箱 |

完整列表：[错误码](../reference/error-codes.md)。每个 `provider` 子命令都支持 `--json`、`--quiet`、`--ci` 与 `--no-color`。

---

## 本地试用

仓库提供了一个端到端脚本，安装参考插件并通过它们驱动真实沙箱：[`e2e/README.zh-CN.md`](../../../e2e/README.zh-CN.md)（`e2e/providers/run.sh`）。
