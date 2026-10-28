# 启动模板

当前 spec v5 模板建议使用 CLI 0.5.7 或更新版本。CLI 与模板目录需同步升级。

CLI 0.5.6 会读取公开目录中的原生模板。使用 `abx --provider alicloud-express template launch base --yes` 启动极速版内置模板。源码模板与平台原生模板共用这个启动命令；原生模板没有可下载的源码目录。

独立二进制已包含极速版内置 Provider，不需要旁边另放 Provider 文件。启动回执记录可执行文件的实际内容指纹；npm 安装和外部插件记录已安装 Provider 目录的内容指纹，并在创建资源前再次核对。

配置好 [Provider](providers.md) 后，直接启动 Registry 中的源码模板：

```sh
abx --provider opensandbox template launch Alibaba-Agent-Sandbox/awesome-templates//python-hello --yes
```

CLI 准备模板、创建一个沙箱、执行启动命令、等待已声明的 `ready_cmd`，并解析全部服务端点。Agent Sandbox Server v2 服务还会检查健康状态与协议发现；其他协议不会自动进行协议探测。输出包含沙箱 ID 和所有服务地址；业务命令在启动后按需调用。OpenSandbox 需要可访问的服务端、Docker、可写镜像仓库及 Docker 仓库登录；服务端也必须能拉取该镜像。极速版使用 `--provider alicloud-express`，并配置平台和 ACR 凭据。

官方源码模板沿用已有的原生基础镜像配方。OpenSandbox 默认解析为 `fc-e2b-registry.cn-hangzhou.cr.aliyuncs.com/runtime/base:v0.0.49`；可以用 `ABX_BASE_IMAGE_REGION` 和 `ABX_BASE_IMAGE_TAG` 覆盖。这是镜像来源配置，与 OpenSandbox 服务部署地域无关。所选 Dockerfile 安装自身声明的公开 server 发行包。显式指定本地 SDK 源码时可以构建并注入开发 wheel；普通构建不需要另行克隆 Python SDK，也不需要宿主 Python 构建工具。CLI 只准备临时副本，保留应用指令和最终 `USER`。

应用认证缺省时由 CLI 自动生成并保存在本机，后续 `abx run` 自动复用，无需单独配置；`--yes` 启动也适用。自动化须预先配置平台凭据。自定义应用令牌及外部客户端用法见[配置引导](guided-configuration.md)。OpenSandbox 服务端代理连接需要 CLI 0.4.16 或更新版本。CLI 保留 Bearer 认证；网关未占用 `X-Access-Token` 时，还会通过该请求头发送同一个显式应用令牌，不会替换网关凭据。

常用选项：

- `--timeout SECONDS`：构建和准备时限，默认 600，最大 3600 秒。
- `--sandbox-timeout SECONDS`：沙箱存活时间，默认 300 秒。
- `--alias NAME`：用于关联构建资源的名称。
- `--build-profile ID`：显式选择其他 Dockerfile，例如 `portable`；CLI 不会静默切换。

省略 `--yes` 时会交互确认计费的构建与创建。也可以用本地源码目录代替 Registry 引用。自定义基础镜像必须完整，未知占位符会在构建前报错。自定义多阶段构建需要自行提供 Dockerfile 所复制的 wheel。

启动成功后，沙箱保留到主动删除或超时。启动失败时，CLI 尝试删除本次创建的沙箱。保留的镜像、平台模板会记录在命令输出的资源日志中。远端请求超时后先核对日志再重试，因为资源可能已经创建。

极速版原生模板详情在官方确认模板不存在时返回现有错误 `E2001`、退出状态 `4`。网络、权限或服务端失败不能作为资源不存在的证明。

模板 HTTP API、shell 执行、PTY 终端和持久解释器是独立功能，模板 HTTP API 不要求平台解释器。清单与协议细节见[模板启动](template-workflows.md)。

## 应用请求等待时间

CLI 0.4.17 会将 `ABX_HTTP_TIMEOUT` 应用于应用发现、健康检查、命令列表与命令调用。例如，执行耗时应用命令前设置 `ABX_HTTP_TIMEOUT=330`。它控制每次 HTTP 请求的等待时间，不改变模板构建时限，也不取消远端已经开始的任务。见[配置说明](../reference/configuration.md)。

## 源码构建失败

CLI 0.5.7 会保留 Docker 构建（`E7020`）、镜像仓库认证（`E7022`）、推送（`E7021`）以及平台模板准备（`E7010`/`E7011`）的错误类型，不再全部替换成配置错误。Docker 构建会提示网络超时、TLS 信任、依赖解析、磁盘空间或 Dockerfile 解析等受控诊断。pip 在索引访问失败后输出“No matching distribution found”时，网络诊断优先。最终错误不包含可能夹带凭证的原始工具输出。

请在 **Docker 构建网络内部**检查软件包索引 HTTPS、DNS、代理、CA 信任与 MTU；宿主机访问成功不能证明容器网络可用。必要时将 Docker 网络 MTU 与实际宿主网络匹配，不要关闭 TLS 校验或修改依赖版本掩盖网络故障。重试前先查看命令给出的资源日志。确认重试时可用 `--verbose` 查看构建输出；构建指令可能输出私有值，请在本地检查。CLI 不会自动重放构建、推送或注册操作。
