# 提供商（Providers）

**提供商** 是一个沙箱后端。`abx` 内置一个提供商，并可通过可安装的插件驱动更多后端。官网是 <https://www.agent-sandbox.cn>。提供方注册站是 <https://registry.agent-sandbox.cn>。CLI 从 `alibaba-agent-sandbox/awesome-providers//<id>` 安装目录提供方。Python SDK 安装器拉取 `https://registry.agent-sandbox.cn/providers/index.json`（`ABX_PROVIDER_REGISTRY` 可以改这个地址）。本页是 CLI 视角：如何在命令行安装、选择、配置并使用提供商。共享概念（清单、信任模型、EPP/1 协议、能力矩阵）只在 Python SDK 仓库中记录一次：[Providers 指南](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/providers.md) 与 [提供商与凭证设计](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/design/providers-and-credentials.md)。编写插件请见 [编写提供商](authoring-providers.md)。

| Id | 名称 | 类型 | 默认 |
|---|---|---|---|
| `alicloud-express` | 阿里云极速版 (Alibaba Cloud Express Edition) | 内置 | 是 |

> **不使用提供商时，一切照旧。** 没有安装任何插件、也没有选择提供商时，所有命令、每一个输出字节与每一个环境变量的行为都与 0.2.x 相同。在安装插件或设置非内置默认提供商之前，`provider` 命令组不会出现在 `abx --help` 中（但始终可以调用）。CLI 包版本为 0.3.0；`python-sdk` 中的 Python SDK 版本钉是另一条发布线。

---

## Provider 边界与不同的能力集合

选择 Provider 就是选择它的配置和协议适配器。不支持的操作应在该 Provider 上返回 E8004，不能改用极速版重试。provider:sandbox-id 引用保留资源归属，不受默认 Provider 切换影响。未知前缀在后端请求前返回 E8001，空沙箱 ID 返回 E8002；显式 Provider 与资源前缀冲突返回 E8030。

标准 E2B 命令前端仅用于极速版，带 Provider 前缀的沙箱引用进入 Provider 路由。其他 Provider 目前仍使用项目 CLI 参数；选择它们不代表全部 E2B 专有选项和返回模型都已适配。template scaffold 的本地生成可以采用通用 Docker profile，但这只是镜像约定，不是切换云端后端。

能力声明不是实现。原生 FC/ACR 模板处理器明确属于极速版；其他 Provider 即使声明 templates.read/build，在真正的 Provider 模板适配器交付前仍返回 E8004。这一检查也覆盖自然语言云端部署和内部部署辅助函数，并发生在代码生成、Docker、凭据读取和云端操作之前。

内置 Provider 明确列出自身已实现的适配能力；增加全局能力不能自动把极速版标记为支持。当前适配器不把 storage.mount、network.vpc、ports.domain 宣称为通用沙箱操作。这不代表阿里云没有对应能力：资源管理和挂载集成需要各自已实现、已验证的入口。暂停还受运行时/函数开通条件限制，静态声明不等于账号实际可用。

| 能力情况 | 必须采取的行为 |
|---|---|
| 当前 Provider 实现了通用操作 | 调用它自己的适配器，即使极速版没有同类能力 |
| 当前 Provider 没有该操作 | 返回 E8004，不跨 Provider 回退 |
| 只有其他 Provider 实现 | 用户显式选择那个 Provider，不静默借用后端 |
| 后端/账号/模板/版本前提未满足 | 报告前提条件或保留后端错误，不伪装成功 |
| Provider 特有云端管理能力 | 使用已声明类型的命令及其真实 Provider handler |

已合并的 [CLI 提供商管理命令](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/35) 和 [SDK 配套变更](https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/38) 提供发现、schema 与显式 provider 处理器。注册不会自动授予云端权限，也不能替代真实 E2E。管理命令与固定能力注册表各司其职。


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

- **同意前只读取静态声明，不执行插件。** git 源只获取不检出，每个树条目都经过校验（仅普通文件，限制大小与数量），由安装器自己写入文件。同意后，默认安装验证可能导入并初始化插件，完成握手。
- 会打印 **同意界面**（id、版本、来源、commit 与摘要、将运行的命令、声明的安全块、特性、选项，以及你的通用沙箱凭证是否会发送给插件）。没有终端或使用 `--json` 时必须加 `--yes`（退出码 2，`E8012`）。
- 来源通过完整的 40 位十六进制 `--ref` 或 `--sha256 <树摘要>` 来 **钉住**。标签或分支属于未钉住：只有你在终端里读过同意界面（不加 `--yes`）才会接受，或者显式加 `--allow-unpinned`；单独的 `--yes` 会拒绝（`E8012`）并打印应当钉住的提交。`abx provider update` 适用同一规则。`--link` 表示原地开发安装，不做完整性检查。`--allow-insecure-transport` 启用 `file://`、`git://` 与 `http://`（仅用于测试与开发）。带内嵌凭证的 URL 会被拒绝（`E8012`）。
- 每次插件启动都会校验树摘要（文件被改动时报 `E8011`）。`--force` 替换同一 id 的现有安装。

安装与更新会在 stderr 显示源码检查、Git 拉取、文件/清单/摘要校验、写入安装及确认后的握手验证阶段。交互终端还会显示当前阶段已等待的秒数。`--yes` 跳过确认但保留进度；`--json` 和 `--quiet` 不显示进度。每个 Git 操作超时为 120 秒；超时、网络和认证失败不会自动重试，仅当服务端明确不支持浅拉取时，提示后去掉深度限制重试一次。拉取超时可检查到源码主机的网络（SSH 地址还需检查 SSH agent），或自行克隆仓库后从本地插件目录安装。安装完成不会自动启动 OpenSandbox 服务或创建云端沙箱。

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
| 标志（exec 放在沙箱 ID 前） | `abx create --provider my-cloud --template base` |
| 进程环境变量 | `export ABX_PROVIDER=my-cloud` |
| `./.env`，然后 `~/.abx/.env` | `ABX_PROVIDER=my-cloud` |
| `~/.abx/config.toml` | `[core]` `provider = "my-cloud"`（`abx provider default my-cloud`、`abx config set provider my-cloud`） |
| 内置 | `alicloud-express` |

```bash
abx provider default                   # 当前生效的默认值，一行（--json：{"default": ..., "source": ...}）
abx provider default my-cloud          # 持久化
abx provider default --unset           # 恢复为 alicloud-express
```

未知 id 以退出码 4 结束（`E8001`）。单条命令的提供商选项用 `--opt KEY=VALUE` 传入（可重复；exec 放在沙箱 ID 前）；清单中标记为 `secret` 的选项在命令行上会被拒绝（`E8002`），避免密钥进入 shell 历史，请改用 `abx config set providers.<id>.<key>`。

### 沙箱 ID 是限定的

每个接受沙箱 id 的命令都接受 `[provider:]sandbox_id`；只有前缀恰好是已知提供商时才算前缀。`--provider P` 与引用 `Q:id` 同时出现且 `P` 与 `Q` 不同，则以 `E8030` 失败（退出码 2）。

所有 Provider 的文本 ID 输出统一使用 `provider:sandbox_id`，JSON 行包含 `provider` 并保留裸 ID 字段。

```bash
abx --provider local-process create --template base      # ID: local-process:sbx-1
abx exec local-process:sbx-1 "echo hello"
abx list --all-providers                                 # 所有已配置的提供商，带 Provider 列
abx kill local-process:sbx-1 --yes
```

`list --all-providers` 是显式原生项目扩展，即使默认选择极速版也使用原生路由；普通 list 筛选仍遵循标准迁移契约。它会跳过失败的提供商（例如缺少凭证），并在 stderr 打印 `warning: provider 'ID' skipped: ...`；只要有一个提供商响应成功就以 0 退出。`--region` 等内置提供商标志，若提供商没有声明对应的键，会被拒绝：`Option '--region' is not supported by provider 'ID'.`

如果命令需要提供商未声明的特性（例如在没有 `process.manage` 的提供商上使用 `abx sandbox process`），会在发出任何请求之前以 `E8004` 失败。

---

## 安装之后能用什么

安装一个提供商，并不会打开全部 `abx` 命令。CLI 和 Python SDK 调用的是**同一份已安装插件**，插件清单里写了它实现哪些能力。`abx provider info <id>` 会打印这份清单。缺了对应能力的命令以 `E8004` 失败（退出码 1），不会去访问后端。没有选择插件时，内置 Provider 仅声明自身适配器已实现的能力；全局注册不代表 CLI 入口已接通或当前账号实际可用。

| 提供商必须声明的能力 | CLI 命令 | Python SDK |
|---|---|---|
| `sandbox.lifecycle` | `create`、`list`、`info`、`kill`、`connect` | `Sandbox.create`、`connect`、`list`、`kill`、`info` |
| `sandbox.timeout` | 创建时的生命周期参数；无通用 timeout 命令 | `set_timeout` |
| `sandbox.pause` | 极速版标准 pause/resume；通用 Provider CLI 入口尚未接入 | ProviderSandbox `pause`、`resume` |
| `exec.run` | `exec`、`run` | `commands.run`、`sandbox.run` |
| `exec.stream` | `sandbox exec --stream` | `commands.stream` |
| `process.manage` | `sandbox process list/info/signal`；用 `exec --background` 启动 | `commands.list`、`kill`、`send_input` |
| `pty` | 极速版 connect 为 PTY；项目 Provider connect 仍是逐行 REPL | `get_terminal` |
| `files.rw` | `upload`、`download`、`sandbox files ...` | `files.read/write/list/stat/mkdir/remove/move` |
| `files.watch` | — | `files.watch` |
| `files.transfer` | — | 带签名的上传和下载 URL |
| 具体 `code.*` 操作 | 解释器执行与各项上下文操作分别检查 | `run_code` |
| `templates.read` | `template list`、`template info` | 模板读取 API |
| `templates.build` | `template build/push/create/deploy/install/delete`、`deploy`、`install` | 镜像构建和模板注册 |
| `ports.url` | 无独立 URL 命令 | Provider 感知的 `network.resolve` / `resolve_url` |
| `ports.domain` | 当前适配器未实现 | 需要已验证的后端专有适配器 |
| `storage.mount` | 本次没有通用挂载命令 | 独立挂载集成，本次未实现 |
| `network.vpc` | 仅 FC 模板参数，不是通用 Provider 操作 | 独立的 Provider 专有配置 |
| `sessions` | `connect <provider:id>` 重新连接 | 对已有 id 调用 `Sandbox.connect` |

`abx provider list` 只显示每个提供商声明了多少项特性（表格要在 80 列下保持可读）；`--json` 里是完整列表的单个字符串，例如 `sandbox(lifecycle,timeout,pause) exec(run,stream) process(manage) files(rw) ports(url) sessions`。`abx provider info <id>` 打印完整清单。

CLI 如何跟随当前提供商：

- `abx template list|info` 需要 `templates.read`；`build`、`push`、`create`、`deploy`、`install`（`--download-only` 除外）、`delete` 以及顶层 `abx deploy` 需要 `templates.build`。缺少时在任何镜像仓库、Docker 或 ACR 操作之前返回 `E8004`。
- `abx sandbox command run|list` 需要通向沙箱的 HTTP 数据面。通过 EPP 路由的提供商会返回 `E8004`，并写明 `named commands`。
- 工作流就绪判断使用具体 Provider 操作与客户端协议支持，详见[模板工作流](template-workflows.md)。
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

上表及规则适用于原生 provider 和 MCP。标准极速版入口还在自身边界映射 `E2B_API_KEY`、`E2B_API_URL`、`E2B_DOMAIN`，其余回退到项目配置；见[迁移指南](migrate-from-e2b.md)。

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

项目 Provider 的 exec 将 --provider/--opt 放在沙箱 ID 前；远程命令含选项时在命令前使用 `--`。远程参数不能切换后端；不受支持的本地参数解析会在后端操作前报错。
## Provider 专属管理命令

Provider 可在固定命名空间下声明带参数类型的管理命令，与沙箱内的应用命令区分。

```bash
abx provider command list alicloud-express
abx provider command info alicloud-express volume.create
abx --json provider command run alicloud-express volume.list --input '{"max_results":10}'
```

写入和删除要求 `--yes`。凭证通过配置提供，`--opt` 拒绝密钥字段；复杂输入使用 `--input-file`。发现命令不需要云凭证。FC 管理操作要求阿里云 AK/SK，不能用沙箱 API Key 鉴权。完整规范见[命令契约](../design/provider-commands.md)和[阿里云能力矩阵](../design/alicloud-provider-commands.md)，包含域名能力边界和 API Key 安全导出。

挂载已有 FC Volume 时，使用原生 Python SDK 的 `Sandbox.create(volume_mounts={"/mnt/workspace": "workspace"})` 参数，详见 [SDK API 参考](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/zh/reference/api-reference.md)。默认标准极速版 CLI 未暴露原生 `--volume-mount` 选项。
按 Volume 名称选择，要求配置其所属 Team 的沙箱 API Key 和存储访问角色，不创建底层存储。
Volume 目前需要邀测开通，请按[官方 OSS Volume 指南](https://help.aliyun.com/zh/agent-sandbox/user-guide/create-oss-volume)提交阿里云工单确认。
角色配置和挂载验证见能力矩阵。
应选择支持挂载的模板；自定义 MicroVM 源镜像须预装 ossfs2 2.0.10 或以上版本，
参见[官方挂载指南](https://help.aliyun.com/zh/agent-sandbox/mount-oss-volume-1)。

## 迁移与 provider 更新

见[迁移、职责及更新设计](../design/provider-portability-and-updates.md)：已有资源接入边界、旧 FC 模板保护、provider 镜像工厂，以及 Git、手动与内置更新的区别。

原生终端在访问会话或协议之前检查所选 Provider 的 PTY 声明。Express 内部模板部署在
读取凭据或项目文件之前检查归属；自然语言部署在生成前检查对应适配器。仅声明
`templates.build` 不会授权 FC/ACR 操作。恢复连接仅在端点返回404/405时回退；
权限、冲突、限流和服务错误会直接保留，不会通过读取元数据伪装成成功。

见[自动准备并启动项目](template-launch.md)：各后端准备条件、引用传递、就绪与清理。

Provider 扩展命令的两端共同发现，以及极速版暂停/快照用法，见 [Provider 命令指南](provider-commands.md)。
