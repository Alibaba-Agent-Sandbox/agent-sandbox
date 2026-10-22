# 无需复制云模板 ID 的模板启动

`template launch` 是显式的项目扩展：下载目录模板或读取本地目录，检查所选提供方声明的能力，请适配器准备项目，再用它返回的真实引用创建沙箱。不会把一朵云的 ID 当作另一朵云的 ID。
镜像适配器在构建、推送与登记之间传递剩余准备时间；剩余秒数含小数时，本地工具仍可正常启动。


```sh
abx --provider e2b template launch alibaba-agent-sandbox/awesome-templates//python-hello --yes
abx --provider opensandbox template launch ./my-project --yes
```

`--alias NAME` 指定构建名称；`--timeout SECONDS` 指定准备期限，默认 600 秒、最多 3600 秒；`--sandbox-timeout SECONDS` 指定沙箱寿命，默认 300 秒。`--yes` 授权构建、登记和可能计费的沙箱创建。JSON 成功结果仅包含 `sandbox_id`、`provider`、`template_reference`，不输出密钥或原始构建日志。

## 安装包含此入口的 CLI

先运行 `abx template launch --help`。已发布的 0.4.0 npm 版本早于此功能，版本号不能证明已有入口。在包含此功能的版本发布前，使用已审查的 main 源码构建：

```sh
git clone https://github.com/Alibaba-Agent-Sandbox/agent-sandbox.git
cd agent-sandbox
npm ci
npm run build
node dist/bin/abx.js template launch --help
```

源码版可用 `node /absolute/path/to/agent-sandbox/dist/bin/abx.js` 替代命令里的 `abx`。标准模板命令的原有含义不变。

## 提供方只需配置一次

按提供方文档从 Git 安装或更新插件；固定提交的安装仍保持固定。新项目适配器需要宿主提供通用项目工具，旧宿主会提示更新。第三方全部保留 **Beta**，维护者暂缓其正式原生验收；流程可调用不代表已经通过真实后端验收。

| 路径 | 一次性准备条件 | 自动返回的引用 |
| --- | --- | --- |
| 内置极速版 | 原有 AK/SK、沙箱密钥、地域和部署配置 | 已就绪的平台模板 ID |
| E2B | 独立的 `ABX_E2B_API_KEY`，Node 22+ 和可选 e2b SDK；FROM 有占位符时配置 `ABX_E2B_BUILD_BASE_IMAGE` | 官方 SDK 构建返回的模板 ID |
| CubeSandbox | Docker、可写 `ABX_CUBESANDBOX_IMAGE_REPOSITORY`、Docker 仓库登录、原生 `ABX_CUBESANDBOX_BUILD_BASE_IMAGE` 和 Cube API 配置 | 原生构建已就绪的模板 ID |
| OpenSandbox | Docker、可写 `ABX_OPENSANDBOX_IMAGE_REPOSITORY`、仓库登录及可达服务；FROM 有占位符时设置 `ABX_OPENSANDBOX_BUILD_BASE_IMAGE` | 不可变镜像引用 |
| 容器版 | Docker/仓库、`ABX_ALICLOUD_CONTAINER_IMAGE_REPOSITORY`、kubectl 权限；`ABX_ALICLOUD_CONTAINER_KUBE_NAMESPACE` 与 API Key 所属空间一致；基础 SandboxSet 名称默认 `code-interpreter`，有多个容器时指定主容器 | 适配器管理的 SandboxSet 名称 |

基础镜像须保留目标后端要求的运行时，包括已声明能力所需的 envd/Jupyter。宿主不会猜厂商镜像或替换成通用基础镜像。容器版从基础 SandboxSet 读取原生镜像，保留运行时注入、初始化容器、卷和探针；不修改基础资源，生成资源仅在归属和镜像匹配时复用。零副本池通过后端的 create-on-no-stock 扩展直接创建沙箱。

项目在独立临时副本中构建，不修改原目录。提供方显式允许模板规范里的可选 wheel 输入缺失，保留 Dockerfile 已固定的安装回退路径。本地 OCI 构建复用 Docker 仓库登录，以内容哈希生成不可变标签，不打印工具原始输出，不把极速版凭据用于其他后端。私有镜像拉取认证单独放在对应提供方命名空间中。

## 能力、就绪与清理

模板要求终端而提供方未声明 `pty` 时，构建前就拒绝；代码、文件和端口能力同样检查。引用转换不会补齐能力，OpenSandbox 当前未声明 `code.interpret`，因此仍拒绝要求该能力的模板。

E2B 等待官方 SDK 构建完成，Cube 等待确切原生构建任务，极速版对异步登记执行轮询后才报告就绪。适配器可要求启动项目服务并执行就绪命令。新沙箱启动或就绪失败时，CLI 只尝试删除本次创建的沙箱，报告是否确认清理，并关闭客户端。

成功沙箱继续运行，直到寿命到期或显式删除。镜像、已登记模板等构建产物会保留，可能继续计费，不会自动删除。准备超时也可能遗留已提交的远端产物；成功时会输出真实引用，失败时通过后端控制台或已知归属名称核对。Registry 构建和网页不接收访客云密钥，也不替访客创建云资源。

## 适配器契约

可选的 `ProviderTemplateManager.prepareProject(directory, options)` 由 `templates.build` 门禁保护，返回 `{reference,status:"ready",metadata?,provider_options?,startup_command?,ready_command?}`。宿主拒绝无效就绪引用和凭据覆盖，引用可为 ID、原生名称或镜像。极速版通过提供方自有 CLI 组合扩展接入，node/1 插件实现各自管理器。`kit.project.stage`、`buildImage`、`runTool` 仅提供通用文件、进程、OCI 工具，没有厂商 ID、API 路径或认证策略；厂商认证、SDK/API 映射、私仓拉取字段和 Kubernetes 资源仍由适配器维护。
