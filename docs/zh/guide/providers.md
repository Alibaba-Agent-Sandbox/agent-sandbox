# 提供商（Providers）

**提供商** 是一个沙箱后端。`abx` 内置一个提供商，并可通过可安装的插件驱动更多后端。官网是 <https://www.agent-sandbox.com>。提供方注册站是 <https://registry.agent-sandbox.com>。CLI 从 `alibaba-agent-sandbox/awesome-providers//<id>` 安装目录提供方。Python SDK 安装器拉取 `https://registry.agent-sandbox.cn/providers/index.json`（`ABX_PROVIDER_REGISTRY` 可以改这个地址）。本页是 CLI 视角：如何在命令行安装、选择、配置并使用提供商。共享概念（清单、信任模型、EPP/1 协议、能力矩阵）只在 Python SDK 仓库中记录一次：[Providers 指南](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/providers.md) 与 [提供商与凭证设计](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/design/providers-and-credentials.md)。编写插件请见 [编写提供商](authoring-providers.md)。

| Id | 名称 | 类型 | 默认 |
|---|---|---|---|
| `alicloud-express` | 阿里云极速版 (Alibaba Cloud Express Edition) | 内置 | 是 |

> **不使用提供商时，一切照旧。** 没有安装任何插件、也没有选择提供商时，所有命令、每一个输出字节与每一个环境变量的行为都与 0.2.x 相同。在安装插件或设置非内置默认提供商之前，`provider` 命令组不会出现在 `abx --help` 中（但始终可以调用）。CLI 包版本为 0.3.0；`python-sdk` 中的 Python SDK 版本钉是另一条发布线。

---

## 安装、查看、移除

```bash
abx provider list                                    # 内置在前，然后是已安装的，并列出各自声明的特性
abx provider install ./my-provider                   # 本地目录
abx provider install https://github.com/acme/abx-provider-acme.git \
  --ref 4f1c2ab9e0d5c3b7a1f2e8d9c0b1a2f3e4d5c6b7     # 钉到完整 commit 的 git URL
abx provider info my-cloud                           # 清单、特性、选项、信任、摘要
abx provider update --check                          # 查看将发生的变化（只读）
abx provider update my-cloud
abx provider uninstall my-cloud                      # 除非 --purge，否则保留设置
```

`install` 做什么、不做什么：

- **安装期间不会执行插件的任何代码。** git 源只获取不检出，每个树条目都经过校验（仅普通文件，限制大小与数量），由安装器自己写入文件。
- 会打印 **同意界面**（id、版本、来源、commit 与摘要、将运行的命令、声明的安全块、特性、选项，以及你的通用沙箱凭证是否会发送给插件）。没有终端或使用 `--json` 时必须加 `--yes`（退出码 2，`E8012`）。
- 来源通过完整的 40 位十六进制 `--ref` 或 `--sha256 <树摘要>` 来 **钉住**。标签或分支属于未钉住：只有你在终端里读过同意界面（不加 `--yes`）才会接受，或者显式加 `--allow-unpinned`；单独的 `--yes` 会拒绝（`E8012`）并打印应当钉住的提交。`abx provider update` 适用同一规则。`--link` 表示原地开发安装，不做完整性检查。`--allow-insecure-transport` 启用 `file://`、`git://` 与 `http://`（仅用于测试与开发）。带内嵌凭证的 URL 会被拒绝（`E8012`）。
- 每次插件启动都会校验树摘要（文件被改动时报 `E8011`）。`--force` 替换同一 id 的现有安装。

无副作用地检查一个提供商：

```bash
abx provider doctor my-cloud            # 已安装 / 完整性 / 配置 / 握手，失败时退出码 1
abx provider test my-cloud -o region=eu # 通过 CLI 使用的同一批适配器运行契约测试
```

---

## 选择提供商

优先级从高到低：

| 位置 | 示例 |
|---|---|
| 限定引用 | `abx kill my-cloud:sbx-1` |
| 标志（任意位置） | `abx create --provider my-cloud --template base` |
| 进程环境变量 | `export ABX_PROVIDER=my-cloud` |
| `./.env`，然后 `~/.abx/.env` | `ABX_PROVIDER=my-cloud` |
| `~/.abx/config.toml` | `[core]` `provider = "my-cloud"`（`abx provider default my-cloud`、`abx config set provider my-cloud`） |
| 内置 | `alicloud-express` |

```bash
abx provider default                   # 当前生效的默认值，一行（--json：{"default": ..., "source": ...}）
abx provider default my-cloud          # 持久化
abx provider default --unset           # 恢复为 alicloud-express
```

未知 id 以退出码 4 结束（`E8001`）。单条命令的提供商选项用 `--opt KEY=VALUE` 传入（可重复、任意位置）；清单中标记为 `secret` 的选项在命令行上会被拒绝（`E8002`），避免密钥进入 shell 历史，请改用 `abx config set providers.<id>.<key>`。

### 沙箱 ID 是限定的

每个接受沙箱 id 的命令都接受 `[provider:]sandbox_id`；只有前缀恰好是已知提供商时才算前缀。`--provider P` 与引用 `Q:id` 同时出现且 `P` 与 `Q` 不同，则以 `E8030` 失败（退出码 2）。

打印 id 遵循同一条规则：只有当配置的默认提供商与实际生效的提供商都是 `alicloud-express` 时，才使用 **旧格式**（裸 id、无 `provider` 字段），因此只用内置提供商的脚本看不到任何变化。其他情况下，文本模式打印 `local-process:sbx-1`，`--json` 行增加 `"provider"`。

```bash
abx --provider local-process create --template base      # ID: local-process:sbx-1
abx exec local-process:sbx-1 "echo hello"
abx list --all-providers                                 # 所有已配置的提供商，带 Provider 列
abx kill local-process:sbx-1 --yes
```

`list --all-providers` 会跳过失败的提供商（例如缺少凭证），并在 stderr 打印 `warning: provider 'ID' skipped: ...`；只要有一个提供商响应成功就以 0 退出。`--region` 等内置提供商标志，若提供商没有声明对应的键，会被拒绝：`Option '--region' is not supported by provider 'ID'.`

如果命令需要提供商未声明的特性（例如在没有 `process.manage` 的提供商上使用 `abx sandbox process`），会在发出任何请求之前以 `E8004` 失败。

---

## 安装之后能用什么

安装一个提供商，并不会打开全部 `abx` 命令。CLI 和 Python SDK 调用的是**同一份已安装插件**，插件清单里写了它实现哪些能力。`abx provider info <id>` 会打印这份清单。缺了对应能力的命令以 `E8004` 失败（退出码 1），不会去访问后端。没有选择插件时，内置提供商 `alicloud-express` 声明了下表的全部能力，命令集和以前一样。

| 提供商必须声明的能力 | CLI 命令 | Python SDK |
|---|---|---|
| `sandbox.lifecycle` | `create`、`list`、`info`、`kill`、`connect` | `Sandbox.create`、`connect`、`list`、`kill`、`info` |
| `sandbox.timeout` | `sandbox timeout` | `set_timeout` |
| `sandbox.pause` | `sandbox pause`、`sandbox resume` | `pause`、`resume` |
| `exec.run` | `exec`、`run` | `commands.run`、`sandbox.run` |
| `exec.stream` | `sandbox exec --stream` | `commands.stream` |
| `process.manage` | `sandbox process list/info/signal`；用 `exec --background` 启动 | `commands.list`、`kill`、`send_stdin` |
| `pty` | PTY 会话（`connect` 仍是按行 REPL） | `get_terminal` |
| `files.rw` | `upload`、`download`、`sandbox files ...` | `files.read/write/list/stat/mkdir/remove/move` |
| `files.watch` | — | `files.watch` |
| `files.transfer` | — | 带签名的上传和下载 URL |
| `code.interpret` | `sandbox code` | `run_code` |
| `templates.read` | `template list`、`template info` | 模板读取 API |
| `templates.build` | `template build/push/create/deploy/install/delete`、`deploy`、`install` | 镜像构建和模板注册 |
| `ports.url` | `sandbox url` | `network.get_url` |
| `ports.domain` | — | 自定义域名 |
| `storage.mount` | — | OSS 挂载 |
| `network.vpc` | `--vpc-id` 及相关参数 | VPC 配置 |
| `sessions` | `connect <provider:id>` 重新连接 | 对已有 id 调用 `Sandbox.connect` |

`abx provider list` 只显示每个提供商声明了多少项特性（表格要在 80 列下保持可读）；`--json` 里是完整列表的单个字符串，例如 `sandbox(lifecycle,timeout,pause) exec(run,stream) process(manage) files(rw) ports(url) sessions`。`abx provider info <id>` 打印完整清单。

CLI 如何跟随当前提供商：

- `abx template list|info` 需要 `templates.read`；`build`、`push`、`create`、`deploy`、`install`（`--download-only` 除外）、`delete` 以及顶层 `abx deploy` 需要 `templates.build`。缺少时在任何镜像仓库、Docker 或 ACR 操作之前返回 `E8004`。
- `abx sandbox command run|list` 需要通向沙箱的 HTTP 数据面。通过 EPP 路由的提供商会返回 `E8004`，并写明 `named commands`。
- `abx sandbox capabilities` 由提供商声明的特性推导 `shell`、`files`、`code`、`terminal`、`ports`（内置提供商从沙箱模板读取）。
- 提供商没有上报区域或超时时，`abx info` 和 `abx list` 显示 `-`。

`kind = "python"` 的清单不可安装。Python SDK 里以代码方式构造的 `Provider` 子类仍然可用，但从磁盘安装的插件不会以 Python 运行。

### 目录里的提供方

四个目录提供方都能在 CLI 和所有 SDK 里使用，因为它们都跑在 Node.js 里，由 CLI 宿主承载：

- `opensandbox`、`e2b`、`cubesandbox`、`alicloud-container` 都是 `node` 插件：一个 ES 模块，由宿主在进程内通过一个小的 kit 加载（见 [编写提供商](authoring-providers.md)）。

```bash
abx provider install alibaba-agent-sandbox/awesome-providers//e2b
abx provider install alibaba-agent-sandbox/awesome-providers//cubesandbox
abx provider install alibaba-agent-sandbox/awesome-providers//alicloud-container
abx provider install alibaba-agent-sandbox/awesome-providers//opensandbox
abx --provider cubesandbox --opt base_url=http://127.0.0.1:3000 create
```

非交互安装需要 `--yes`。未钉扎的 git ref 还要 `--allow-unpinned`，或者写成 40 位十六进制的 `--ref`。Python SDK 安装器是 `python -m agent_sandbox.providers install registry:<id> --yes`。

Python SDK（以及之后的 Node、Go、Java SDK）通过本地引擎 `abx provider engine serve` 使用同一批插件，引擎按需启动。见 [引擎 HTTP API](../reference/engine-api.md)。

| Id | 类型 | 页面 |
|---|---|---|
| `opensandbox` | `node` | [OpenSandbox 提供方](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/tree/main/opensandbox) |
| `alicloud-container` | `node` | [容器版](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/tree/main/alicloud-container) |
| `cubesandbox` | `node` | [CubeSandbox 提供方](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/tree/main/cubesandbox) |
| `e2b` | `node` | [E2B 提供方](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/tree/main/e2b) |

OpenSandbox 连接本机服务。设置 `ABX_OPENSANDBOX_BASE_URL`（默认 `http://127.0.0.1:8080`）；服务要求密钥时再设 `ABX_OPENSANDBOX_API_KEY`。能力对照以该页为准，包括会返回 `E8004` 的调用。

---

## 凭证与配置键

每个键只有一个名称。Agent Sandbox 自己的设置用 `ABX_`。厂商已经规定了变量名的，直接用那个名字，不再套一层 `ABX_`。

| 键 | 环境变量 | 为什么是这个名字 |
|---|---|---|
| `provider` | `ABX_PROVIDER` | 产品自己的设置 |
| `sandbox_api_key` | `ABX_SANDBOX_API_KEY` | 产品自己的沙箱密钥 |
| `sandbox_base_url` | `ABX_SANDBOX_BASE_URL` | 产品自己的平台地址 |
| `sandbox_domain` | `ABX_SANDBOX_DOMAIN` | 产品自己的数据面域名 |
| `llm_api_key` | `ABX_LLM_API_KEY` | 产品自己的代码生成密钥。启动 Qwen Code 时会写进子进程的 `OPENAI_API_KEY`，因为 `qwen` 程序读的是这个变量 |
| `github_token` | `GITHUB_TOKEN` | GitHub 官方变量 |
| `region` | `ALIBABA_CLOUD_REGION_ID` | 阿里云官方地域变量 |
| `access_key_id` | `ALICLOUD_ACCESS_KEY_ID` | 阿里云官方 AccessKey ID |
| `access_key_secret` | `ALICLOUD_ACCESS_KEY_SECRET` | 阿里云官方 AccessKey Secret |
| `acr_namespace` | `ACR_NAMESPACE` | 镜像仓库命名空间 |
| `acr_registry` | `ACR_REGISTRY` | 镜像仓库地址 |
| `acr_repo` | `ACR_REPO` | 镜像仓库名 |
| `acr_username` | `ACR_USERNAME` | 镜像仓库用户名 |
| `acr_password` | `ACR_PASSWORD` | 镜像仓库密码 |
| `acr_instance_id` | `ACREE_INSTANCE_ID` | 企业版实例 |
| `acr_vpc_id` | `ACR_VPC_ID` | 企业版 VPC |
| `acr_vswitch_ids` | `ACR_VSWITCH_IDS` | 企业版交换机 |
| `acr_security_group_id` | `ACR_SECURITY_GROUP_ID` | 企业版安全组 |
| `team_id` | `ABX_ALICLOUD_EXPRESS_TEAM_ID` | 没有对应的阿里云官方变量，所以用提供商前缀 |
| 插件选项 `<key>` | `ABX_<PROVIDER_ID>_<KEY>` | 第三方提供商没有统一的官方变量名时，用这个形式 |

单个键的解析顺序：命令行覆盖、进程环境变量、`./.env`、`~/.abx/.env`、`~/.abx/config.toml` 中的 `[providers.<id>]` 与 `[transport]`、派生值、默认值。空白值视为未设置。插件 **只** 会收到它声明的选项以及你在安装时同意的通用键（`[core] inherit`），其余一概不会进入它的环境。

`abx config` 可以操作所有这些键：

```bash
abx config set sandbox_base_url https://api.example.com
abx config set acr_repo my-repo                              # 内置提供商的键（存放在 [providers.alicloud-express]）
abx config set providers.my-cloud.region eu-1                # 限定名：某个提供商的选项
abx config set --provider my-cloud region eu-1 # 当前提供商的裸键
abx config set providers.my-cloud.token                      # 密钥：掩码提示，存放在 ~/.abx/.env
abx config get providers.my-cloud.token                      # 始终掩码
abx config list --provider my-cloud                          # 该提供商的键以及每个值的来源
```

仅存在于另一个已安装提供商中的裸键会被拒绝，并提示 `Did you mean 'providers.<id>.<key>'?`。`abx provider config <id> list|get|set|unset|init` 是限定到单个提供商的同一套能力。

`abx config list` 打印的就是上表里的名字。不在表里的名字不会被读取。内置提供方实际读取的是 `ABX_SANDBOX_API_KEY`、`ABX_SANDBOX_BASE_URL`、`ABX_SANDBOX_DOMAIN`、`ALICLOUD_ACCESS_KEY_ID`、`ALICLOUD_ACCESS_KEY_SECRET` 和 `ALIBABA_CLOUD_REGION_ID`。`E2B_API_KEY`、`E2B_API_URL`、`E2B_DOMAIN`、`AccessKey`、`AccessSecret`、`ALIBABA_CLOUD_ACCESS_KEY_ID`、`ALIBABA_CLOUD_ACCESS_KEY_SECRET` 不会被读取。缺少凭证时，错误信息会列出被读取的名字。

---

## 退出码与错误

| 代码 | 退出码 | 含义 |
|---|---|---|
| `E8001` 提供商未找到 | 4 | 未安装；见 `abx provider list` |
| `E8002` 配置 | 2 | 未知或无效的选项、命令行上的密钥 |
| `E8003` 冲突 | 1 | 已安装（使用 `--force`） |
| `E8004` 特性不支持 | 1 | 提供商未实现该特性 |
| `E8005` 资源未找到 | 4 | 提供商找不到模板、文件或进程（沙箱不存在是 `E2009`） |
| `E8010`-`E8014` 安装、完整性、信任、版本、清单 | 1 或 2 | `E8012` 与 `E8002` 类的信任问题退出码 2 |
| `E8020`-`E8022` 协议、进程、超时 | 1 或 5 | 插件行为异常或超时（超时退出码 5） |
| `E8030` 引用不匹配 | 2 | `--provider P` 搭配 `Q:id` |
| `E2009` 沙箱未找到 | 4 | 不存在、已被终止或已过期的沙箱；所有提供商（内置和插件）一致 |

完整列表：[错误码](../reference/error-codes.md)。每个 `provider` 子命令都支持 `--json`、`--quiet`、`--ci` 与 `--no-color`。

---

## 本地试用

仓库提供了一个端到端脚本，安装参考插件并通过它们驱动真实沙箱：[`e2e/README.zh-CN.md`](../../../e2e/README.zh-CN.md)（`e2e/providers/run.sh`）。
