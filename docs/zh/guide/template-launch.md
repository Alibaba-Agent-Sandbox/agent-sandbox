# 启动模板

spec v5 模板需要 CLI 0.5.0。CLI 与模板目录需同步升级。

配置好 [Provider](providers.md) 后，直接启动 Registry 中的源码模板：

```sh
abx --provider opensandbox template launch Alibaba-Agent-Sandbox/awesome-templates//python-hello --yes
```

CLI 准备模板、创建一个沙箱、执行启动命令、等待已声明的 `ready_cmd`，并解析全部服务端点。Agent Sandbox Server v2 服务还会检查健康状态与协议发现；其他协议不会自动进行协议探测。输出包含沙箱 ID 和所有服务地址；业务命令在启动后按需调用。OpenSandbox 需要可访问的服务端、Docker、可写镜像仓库及 Docker 仓库登录；服务端也必须能拉取该镜像。极速版使用 `--provider alicloud-express`，并配置平台和 ACR 凭据。

官方源码模板沿用已有的原生基础镜像配方。OpenSandbox 默认解析为 `fc-e2b-registry.cn-hangzhou.cr.aliyuncs.com/runtime/base:v0.0.49`；可以用 `ABX_BASE_IMAGE_REGION` 和 `ABX_BASE_IMAGE_TAG` 覆盖。这是镜像来源配置，与 OpenSandbox 服务部署地域无关。Docker 从所选 Dockerfile 已固定的 SDK 提交构建 wheel，并交给原有安装步骤。不需要另行克隆 Python SDK，也不需要宿主 Python 构建工具。CLI 只准备临时副本，保留应用指令和最终 `USER`。

需要应用认证的模板应在启动前设置 `ABX_SERVER_TOKEN`。OpenSandbox 服务端代理连接需要 CLI 0.4.16 或更新版本。CLI 保留 Bearer 认证；网关未占用 `X-Access-Token` 时，还会通过该请求头发送同一个显式应用令牌，不会替换网关凭据。

常用选项：

- `--timeout SECONDS`：构建和准备时限，默认 600，最大 3600 秒。
- `--sandbox-timeout SECONDS`：沙箱存活时间，默认 300 秒。
- `--alias NAME`：用于关联构建资源的名称。
- `--build-profile ID`：显式选择其他 Dockerfile，例如 `portable`；CLI 不会静默切换。

省略 `--yes` 时会交互确认计费的构建与创建。也可以用本地源码目录代替 Registry 引用。自定义基础镜像必须完整，未知占位符会在构建前报错。自定义多阶段构建需要自行提供 Dockerfile 所复制的 wheel。

启动成功后，沙箱保留到主动删除或超时。启动失败时，CLI 尝试删除本次创建的沙箱。保留的镜像、平台模板会记录在命令输出的资源日志中。远端请求超时后先核对日志再重试，因为资源可能已经创建。

模板 HTTP API、shell 执行、PTY 终端和持久解释器是独立功能，模板 HTTP API 不要求平台解释器。清单与协议细节见[模板启动](template-workflows.md)。

## 应用请求等待时间

CLI 0.4.17 会将 `ABX_HTTP_TIMEOUT` 应用于应用发现、健康检查、命令列表与命令调用。例如，执行耗时应用命令前设置 `ABX_HTTP_TIMEOUT=330`。它控制每次 HTTP 请求的等待时间，不改变模板构建时限，也不取消远端已经开始的任务。见[配置说明](../reference/configuration.md)。
