# Provider 迁移、职责边界与更新

状态：提案。实现已抽取到 Provider 契约之后，详见[实现边界](provider-isolation.md)，
交付门禁以最新证据为准。

## 迁移承诺

Agent Sandbox 是现有云后端之上的客户端和工具层，不是另一个需要搬迁资源的云。
极速版用户可以继续使用原账号、地域、Team、沙箱 API Key、模板 ID、Volume 和 RAM
角色，无需因为更换客户端就重建模板或复制数据。但它**不是 E2B SDK 的零改动替代品**：
导入、配置名称、部分方法、结果和错误类型需要核对。连接现有沙箱需要同 Team 凭据和
有效租期；连接不代表取得资源独占所有权，也不自动授权清理它。

Python 仓库的[极速版迁移指南](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/31c8b5c60badba9436e7400f75b32f6d13253a5c/docs/zh/guide/migrate-from-alicloud-express.md)
列出具体差异和显式环境变量映射。不要增加静默的 `E2B_*` 凭据别名，以免把另一后端的
密钥发送给极速版。目前没有已实现的“一键迁移”命令，不应宣传为无需修改。

还需区分语言：公开的 `nodejs-sdk` 当前只有配置名称和 9000 端口 `ServerClient`，
没有云端 `Sandbox.create` 或 provider 生命周期。E2B JavaScript 应用不能只换成该包的
导入。CLI 使用 TypeScript 实现不代表公开 Node SDK 已功能对齐。见
[Node SDK 范围](https://github.com/Alibaba-Agent-Sandbox/nodejs-sdk/blob/main/README.md)。

## 职责审计

| 内容 | 归属及现状 |
| --- | --- |
| 命令注册、JSON、schema、校验、确认、完整性、超时和清理 | 通用 CLI/host，不应加入供应商端点分支。 |
| 后端端点、认证签名、字段映射、轮询状态、模板/镜像含义和不支持项 | 所选 provider；只接收自身配置及明确同意继承的配置。 |
| 极速版管理操作 | 内置 `providers/alicloud_express/commands.ts` 和 `sdk.ts`，历史路径仅保留兼容导出。 |
| FC 模板部署及部分原生生命周期/认证 | 归属 `providers/alicloud_express/`；共享协议位于 `providers/shared/e2b/`。 |
| 构建计划、Docker 本地构建/推送、模板缓存 | 可复用宿主服务，参数由 provider 决定，不能默认假定 ACR/FC。 |
| 镜像编写约定 | provider 的 `[template]` profile；它不等于部署接口。 |
| 模板页面适配表 | 模板作者维护的使用前提，需结合适配器能力；不等于原生后端 E2E 通过。 |
| Provider 创建示例 | provider 自己维护、不会执行的 `catalog.json`，目录只渲染数据。 |

配置过滤是路由约定，不是进程沙箱。Node 插件是受信任的宿主代码，可以访问宿主资源；
声明的能力和 effect 不能替代云端 IAM/RAM 权限或安装时的信任判断。

模板命令调用所选 Provider 的可选模板工厂或专用 CLI 扩展。缺失实现会在云端初始化
之前返回 E8004。极速版构建和部署位于其适配器，通用代码不会回退 FC。

## 模板接口及待交付工作

复用 [CLI PR #42](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/42) 中独立的
`templates.deploy` / `buildTemplates(ctx)` 契约，不再设计第二套 SDK 或任意 shell 透传。
输入是已推送镜像及标准化资源、启动、就绪、镜像仓库配置，输出为允许字段中的 ready
结果。API、单位换算、轮询和拒绝选项由 provider 负责。镜像工厂不能自动推导为支持本地
目录、Dockerfile、构建步骤或另一后端的启动语义；不支持的输入须在 I/O 前拒绝。

| Provider | 当前可安装版本的流程 | 补充实现及剩余门禁 |
| --- | --- | --- |
| 极速版 | 原模板 ID/别名、旧 FC 部署流程 | 已抽取到内置极速版模板适配器，真实验收单独记录。 |
| 容器版 | 已有 sandbox-manager 模板 ID | 宿主不能凭空提供集群/SandboxSet 创建 API。 |
| CubeSandbox | 已有集群模板 ID，未声明 PTY | [PR #10](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/pull/10) 有尚未启用的原生镜像适配器，缺真实授权 Cube/KVM 后端验收。 |
| E2B | 已有 E2B 模板 ID | [PR #5](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/pull/5) 有尚未启用的官方 SDK 镜像适配器，缺原生 E2B 验收。 |
| OpenSandbox | provider 解析镜像 URI/别名 | Docker 镜像创建与 golden-image 模板服务是不同能力，后者需对应运行时验收。 |

宿主、共享 schema、UI/目录和适配器必须兼容后才能启用。草稿 PR 不等于已安装或公开
发布。不能因为后端有同名模型或 mock 通过，就添加部署能力标记。

## 极速版覆盖和 AI 调用

[FC 能力矩阵](alicloud-provider-commands.md) 定义已接入的管理命令。
[现有真实存储记录](../../../.agents/evidence/verify/2026-10-16-provider-volume-live.md)
证明了其记录配置下的 OSS Volume 创建/查询/列表/删除、真实挂载和读写、沙箱销毁重建后
持久化、Team/密钥/配额生命周期及本次资源清理，不能证明每个功能、地域和模板均已验收。
`volume.update` 状态转换仍未验证；域名、动态追加挂载、STS 管理凭据和较新 JuiceFS
字段不在已验证的适配能力中。“20 项方法映射”不能称为极速版全部能力已测试。

AI 应先读取 `provider info --json`、静态命令 list/info 和输入 schema。读取授权不等于
写入授权；写删要求显式确认。凭据放入受保护配置/文件，不能出现在 argv 或日志中。
写入超时意味着结果未知，应先查本次资源状态再决定是否重试。记录本次创建的确切资源，
只清理这些资源，不清理复用的 Team、密钥和模板。管理命令 MCP 入口明确延期，沙箱
MCP 不会自动获得账号管理权限。

## 更新生命周期

| 安装方式 | 操作及结果 |
| --- | --- |
| Git 插件 | `abx provider update ID --check` 检查，审阅后 `--yes` 应用；保留来源/ref、摘要、最低宿主版本及完整描述的风险确认，验证失败回滚。 |
| 固定 Git 版本 | 未显式指定 `--ref` 时保持 `pinned`，不自动跟随分支或最新版。 |
| 本地复制/开发 link | 用 `--force` 从审阅的来源重新安装；CLI 批量更新报告 `manual`。link 是受信任的开发模式。 |
| Python catalog 安装 | Python 安装器按记录目录更新；CLI 返回手动处理/重装提示，不静默更换来源。 |
| CLI 内置极速版 | `abx provider update alicloud-express --check` 返回 `bundled`、当前宿主版本、`available: null` 和升级指引，不查询最新宿主版本或替换程序。 |
| Python 内置极速版 | `python -m agent_sandbox.providers --json update alicloud-express --check` 返回 `bundled`；按原安装方式升级匹配的 client/server，Node 管理操作还需兼容的 abx。 |

`--all` 不吞掉 Git 下载/握手错误，也不把本地/catalog 来源说成最新版。内置 provider
不能用插件 `--ref` 单独选版本。Provider 命令不执行 npm/pip、不覆盖运行中的二进制、
不强行移动固定版本、不杀未知引擎。宿主按原固定版本安装方式升级，只重启自己管理的
引擎，然后检查版本、doctor、能力发现及对应验收。替换本地 provider 不会重建或升级云端
已有沙箱。回滚保留上一宿主/provider 发布版本及兼容配置；持久插件数据不放在替换树中。

## 剩余验收

抽取后的模板、生命周期和认证保留公开导出兼容层，配置、会话、CLI/AI 隔离均有回归
覆盖，详见[实现边界](provider-isolation.md)。可选工厂在原生后端验收通过后启用。SDK 冷加载已移到测试准备阶段，
未扩大超时预算；已记录的本机整仓失败仍须解决。核对最新提交的
CI/review 后先合入共享宿主，再合入消费者。
本设计不豁免任何门禁。

当前隔离实现保留显式沙箱 API Key 认证和独立 CLI 错误渲染；URL 辅助方法作为协议
适配器的兼容入口保留，详见[实现边界](provider-isolation.md)。
