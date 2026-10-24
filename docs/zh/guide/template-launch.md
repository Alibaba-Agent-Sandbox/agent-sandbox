# 启动模板

默认 OpenSandbox 配方与可选的 Provider 源码占位符说明需要 CLI 0.4.15 或更新版本。

配置好 [Provider](providers.md) 后，直接启动 Registry 中的源码模板：

```sh
abx --provider opensandbox template launch Alibaba-Agent-Sandbox/awesome-templates//python-hello --yes
```

CLI 会构建镜像、创建沙箱、启动应用，并检查其 API 是否可访问。后续命令使用返回的沙箱 ID。OpenSandbox 需要可访问的服务端、Docker、可写镜像仓库及 Docker 仓库登录；服务端也必须能拉取该镜像。极速版使用 `--provider alicloud-express`，并配置平台和 ACR 凭据。

官方源码模板沿用已有的原生基础镜像配方。OpenSandbox 默认解析为 `fc-e2b-registry.cn-hangzhou.cr.aliyuncs.com/runtime/base:v0.0.49`；可以用 `ABX_BASE_IMAGE_REGION` 和 `ABX_BASE_IMAGE_TAG` 覆盖。这是镜像来源配置，与 OpenSandbox 服务部署地域无关。Docker 从所选 Dockerfile 已固定的 SDK 提交构建 wheel，并交给原有安装步骤。不需要另行克隆 Python SDK，也不需要宿主 Python 构建工具。CLI 只准备临时副本，保留应用指令和最终 `USER`。

常用选项：

- `--timeout SECONDS`：构建和准备时限，默认 600，最大 3600 秒。
- `--sandbox-timeout SECONDS`：沙箱存活时间，默认 300 秒。
- `--alias NAME`：用于关联构建资源的名称。
- `--workflow ID`：选择模板声明的其他工作流。
- `--build-profile ID`：显式选择其他 Dockerfile，例如 `portable`；CLI 不会静默切换。

省略 `--yes` 时会交互确认计费的构建与创建。也可以用本地源码目录代替 Registry 引用。自定义基础镜像必须完整，未知占位符会在构建前报错。自定义多阶段构建需要自行提供 Dockerfile 所复制的 wheel。

启动成功后，沙箱保留到主动删除或超时。启动失败时，CLI 尝试删除本次创建的沙箱。保留的镜像、平台模板会记录在命令输出的资源日志中。远端请求超时后先核对日志再重试，因为资源可能已经创建。

模板 HTTP API、shell 执行、PTY 终端和持久解释器是独立功能，模板 HTTP API 不要求平台解释器。清单与协议细节见[模板工作流](template-workflows.md)。
