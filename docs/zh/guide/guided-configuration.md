# 配置引导

## 初始化、查找并创建

安装后运行 `abx config init`。向导会说明所选 Provider 的凭证去哪里获取，并保存填写的值。缺少应用访问令牌时会生成并保存，已有令牌会保留。选择 **Find and launch a template**，按名称或用途搜索，再选择模板。实际构建还缺哪些值，会在同一次操作里补齐，然后才开始云端工作。创建成功会显示沙箱信息、应用命令和清理方法。

也可以直接运行不带引用的 `abx template launch` 打开同一个选择器，或用 `abx template launch opencode` 选择已知目录条目。自动化须先提供模板引用和所需值，再使用 `--yes`；不会打开选择器。

`ABX_SERVER_TOKEN` 用于保护沙箱内运行的应用 API，是你自行设置或由 CLI 随机生成的私有令牌，与 Sandbox API Key、云 AccessKey 和模型 API Key 分开，无需去云控制台申请。交互启动时选择 **Save for future commands**，在应用令牌输入处按回车即可生成并保存；也可以隐藏输入自己的令牌。选择 **Only this command** 时，须输入一个后续调用应用时也能提供的令牌。

`server_token` 是 CLI 自有配置键，以 `ABX_SERVER_TOKEN` 存在受保护的用户 dotenv 文件中。模板创建、应用验证和后续 `abx run` 使用同一个值；修改时运行 `abx config set server_token` 隐藏输入。没有声明应用令牌的模板不受影响。只有模板声明且默认值为空的模型输入才能继承 CLI 已保存的模型配置，显式运行时值和模板默认值仍然优先。

Python SDK 是库，通过参数以及已支持的环境变量、dotenv 和配置来源取值。它不运行这个向导，不询问缺项，也没有新增 SDK 初始化命令。


执行操作前，`abx` 会根据所选 Provider 和本次构建或执行计划检查配置。交互终端中可以就地补齐缺失值，再继续本次操作。权限、配额、网络故障或不支持的能力仍会给出对应诊断，不会统一当成缺少 API Key。

完整字段和优先级见[配置参考](../reference/configuration.md)、[认证配置](authentication.md)和[Providers 指南](providers.md)。标准与原生命令入口的边界见[迁移指南](migrate-from-e2b.md)。

## 补齐配置并继续

正常运行命令即可进入适用的引导：

```bash
abx create dev-services
abx template deploy ./dev-services --alias dev-services
```

收集凭证前会显示当前生效的 Provider、地域和 API 主机；不会展示 URL 中的用户名、密码或查询参数。引导列出缺失字段，并统一选择一次作用范围：

1. **仅本次命令**，默认选项：配置随当前操作的后续阶段传递，不写入用户配置或项目 dotenv 文件。
2. **保存供以后使用**：按所选 Provider 声明的位置写入用户配置，重新读取确认后继续。
3. **取消**：在开始业务操作前停止。

用 **↑/↓** 移动、**回车** 选择，**Ctrl+C** 取消。认证方式和模板项目准备方式采用相同菜单操作。配置菜单输出到 stderr；CI、JSON、quiet 和 `--yes` 路径不会打开菜单。脚本输入仍兼容编号选择。

密钥隐藏输入；类型不符时可以原地重输。收集缺失值时空回车表示取消，不会删除已有凭证。所有输入先收集完再开始持久化。受支持的单文件写入采用原子替换，但多个字段的保存不是整体事务：后续字段写入或旧副本清理失败时，会说明已完成的字段或可能已写入的字段，并停止操作。

仅本次命令的值不会传给之后独立执行的命令。例如，临时构建凭证不会保存给下次 deploy；MCP 安装时临时输入的 Sandbox API Key 也不会变成编辑器进程的环境变量。

保存后会显示真实位置和后续修改命令。环境变量和项目 `.env` 保持原有优先级；如果它们覆盖了新保存的值，会指出冲突，不会宣称新值已经生效。

## 按本次任务询问

| 操作 | 检查的配置 |
| --- | --- |
| 标准极速版沙箱命令 | Sandbox API Key 和实际服务目标 |
| 官方 Dockerfile 部署 | 平台 AccessKey 对、该路径需要的 ACR namespace 和凭证，以及本机 Docker 条件 |
| 平台 build steps | 平台凭证、实际地域和二代模板；不要求本机 Docker 或 ACR |
| 推送镜像 | 推送路径实际使用的镜像仓库配置；不会仅因其他操作需要而索要模板注册身份 |
| 从现成镜像部署 | 对应 Provider 的平台配置；显式私有镜像模式下补齐成对的拉取凭证；不要求本机 Docker 构建 |
| 生成模板或真实适配项目 | 编码工具与 LLM 配置；只有继续部署或创建沙箱时才追加云配置 |
| template launch | 先检查已知 Provider 和创建身份，获取源和构建计划后再补构建要求 |
| 内置脚手架、本地预览、仅下载 | 本地输入；不会为查看或下载文件要求云凭证 |
| Provider 操作 | 声明的必填字段和一组可用的认证组合，复用已有值 |

创建或连接沙箱使用的 Sandbox API Key，与平台构建使用的阿里云 AccessKey 对用途不同。极速版缺凭证时给出 ABX 配置引导，不会要求登录 E2B。标准入口保留文档中的兼容环境变量，但不把无关的 `~/.e2b/config.json` 登录态作为本项目身份。

Provider 自有字段独立解析，即便名称与主机设置中的 `region`、`http2` 相同，也不会借用后者。一组完整的认证组合即可满足要求，不会再要求另一组。Provider 声明缺失或无法满足时会说明合同问题，不会借用另一 Provider 的凭证。发现、doctor 和多 Provider 聚合继续承担报告职责，详见[Provider 操作](provider-commands.md)。

## 自动化与输出模式

配置问答要求 stdin、stdout、stderr 都连接终端。在 CI、JSON、quiet、管道和已有的 `--yes`/`-y` 操作模式下，不会等待配置输入。缺少必填数据时，会一次列出缺项和已有配置命令；`-y` 不能代替 namespace 或凭空生成密钥。

也可以主动配置：

```bash
abx config init
abx config init --build
abx config init --llm
abx config init -y
```

`config init -y` 只打印等价配置命令，不收集或写入值；机器输出保持可解析。标准极速版解析器仍按原合同拒绝原生入口专属的全局选项，配置引导不会让原本不支持 `--json`、`--ci` 的标准命令突然接受这些选项。

已有的目录创建例外保留：build/deploy 在 `-y` 或 CI 授权下可以直接为缺失目录生成 Python 项目并继续。已有文件仍需遵守独立的冲突和覆盖确认。项目文件创建成功不代表部署成功。

需要交互补填配置时，去掉 `-y`：`abx template deploy ./codex --alias codex`。连续执行准备、部署和创建时，用 `&&` 连接，避免部署失败后继续创建。目录名不会选择 Registry 模板；先获取源码：`abx template scaffold ./codex --from alibaba-agent-sandbox/awesome-templates//codex`。部署成功后执行 `abx create codex --detach`；`--template` 是 scaffold 的选项。

## 查看和修改已保存配置

```bash
abx config list
abx config set sandbox_api_key
abx config set access_key_id
abx config set access_key_secret
abx config set acr_namespace
abx config set llm_api_key
```

省略 VALUE 可在终端输入，密钥尤其建议这样修改，避免进入 shell 历史。交互时空回车保留旧值。需要明确删除时，使用 delete 或 unset：

```bash
abx config delete llm_api_key
abx provider config PROVIDER list
abx provider config PROVIDER set KEY
abx provider config PROVIDER unset KEY
```

Provider 字段使用实际 schema 中的存储名。例如极速版 `access_key_secret` 使用 `ALICLOUD_ACCESS_KEY_SECRET`；Provider 范围内继承的 Sandbox API Key 使用对应的 scoped 变量。完成提示显示真实文件路径。用户凭证 dotenv 文件使用仅文件所有者可读写的权限。不支持的插值表达式或控制字符会在替换文件前拒绝；普通空格、井号、引号、反斜杠和受支持的多行值可正确保存。

TOML/dotenv 损坏或不可读时会指出来源，不展示密钥内容。显式布尔值、数字、枚举或 URL 无效时会诊断，而不是悄悄使用默认值。请修复指出的来源；引导不会用空配置覆盖损坏文件。

## 项目和本机工具

缺失的构建或部署目录可以确认后创建。已有目录既没有 Dockerfile 也没有平台构建步骤时，可选择生成脚手架、让模型适配现有代码、改用另一目录或取消。显式错误的 Dockerfile 路径和损坏 YAML 会报出原因，不会覆盖；文件预览和替换授权仍保留。更多模板见[模板 Registry](https://registry.agent-sandbox.cn/templates/)。

Docker 检查会区分未安装命令与 daemon/context 不可访问。修复本机环境后，可以选择重新检查，再开始构建。CLI 不会替用户执行 sudo、切换 Docker context 或启动系统服务。GitHub 限流恢复只重试安全的源读取；权限不足和引用不存在继续给出不同诊断。

云平台的 build steps 仅支持二代模板。请在项目的 `template.yaml` 中设置 `generation: 2`，或传入 `--generation 2`，并使用支持该运行方式的镜像和启动配置。配置引导不会静默转换已有一代模板或更换其镜像。

## MCP 引导与离线工作

`abx mcp install` 可以先引导配置 Sandbox 访问，也允许继续离线注册。Cursor、Claude 和 VS Code 配置均不复制 Sandbox API Key；它们保留启动命令及适用的非密钥目标信息，服务启动时再读取凭证。编辑器注册完成不代表云端访问已验证。临时配置不会进入之后由 IDE 启动的进程。

STDIO 服务执行期间绝不弹出配置问答，不会用 JSON-RPC 输入收集配置，stdout 只用于协议消息。交互式 HTTP 启动可在开始服务前补齐 Sandbox 访问或非 loopback 的 Bearer token；非 loopback 监听仍必须有 token，自动化应通过已有选项或环境变量提供。

`abx mcp deploy --generate-token --output-dir ./mcp-artifact` 生成部署文件。缺少 Sandbox Key 时，明确继续离线可以得到暂时不能创建沙箱的产物；Bearer token 仍然必需。生成的 `config.yaml` 包含部署凭证，须妥善保管；与 IDE 注册不同，该文件就是明确的部署目标。产物创建会分别报告是否部署、是否验证服务，不会宣称已把服务部署到云端。详见[MCP 集成](mcp-integration.md)。

## 安全继续的边界

配置补齐后只继续尚未开始的阶段，保留 Provider、原来受支持的参数、生成文件和已知资源引用。后续请求失败时，不会自动重新运行模型生成、Docker 构建、镜像推送、模板注册或沙箱创建。云提交超时或结果不明时，先检查提示的资源并使用已有查询命令核实，再决定重试。配置向导不会授予账号权限、开通不可用的服务；本地字段完整也不等于远程凭证已验证。

## 极速版凭证选择

缺少运行凭证时可选已有 API Key 或 AK/SK。在 `config init` 跳过 API Key 会提示补齐 AccessKey。初始化本身不创建云端 Key；首次运行操作单独确认创建/续期，只有显式 `--ci` 自动确认。[权限及示例](permissions.md)。
