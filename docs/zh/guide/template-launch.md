# 模板部署与清理

```bash
abx --provider PROVIDER deploy SOURCE --name my-app --yes
abx status my-app
abx logs my-app
abx delete my-app --yes
```

SOURCE 可以是目录名称、本地工程或固定 Git 引用。使用已有原生模板时改用 `abx create --template TEMPLATE_ID`。当前源码使用统一命令入口；旧发行版可能不同，请检查 `abx --help`。

Sandbox 模板准备后创建一个实例，执行声明的启动和就绪条件，并解析 `provides` 中所有端点。Server v2 服务会进行健康和协议发现，但不会执行业务命令。其他 HTTP 协议依赖声明的就绪条件，不会被自动认证为应用协议兼容。托管应用使用不同的生命周期，见[托管应用](managed-applications.md)。

配置所选 Provider 后再部署。对于 Express Dockerfile 源码，`deploy` 会在询问计费确认前检查 Docker。检查失败时运行 `docker info`，核对守护进程、context 和权限。Express 源码构建还可能需要平台与镜像仓库权限；OpenSandbox 需要可达服务、Docker、可写镜像仓库，以及运行端的拉取权限。官方配方可解析已知基础镜像占位符，`ABX_BASE_IMAGE_REGION` 和 `ABX_BASE_IMAGE_TAG` 仅控制镜像输入。普通构建不需要另行检出 Python SDK；仅有意测试本地开发 wheel 时使用 `ABX_SERVER_SDK_SOURCE`。

部署的 `--build-timeout` 约束准备期限，`--sandbox-timeout` 设置实例期限，`--build-profile` 选择已声明配方。HTTP 请求等待和远端任务终止是不同概念；超时不证明远端副作用没有发生。

缺少应用令牌时，CLI 自动生成并私密保存。外部客户端分别传应用令牌与 Provider 端点认证；代理前缀、签名查询及网关请求头不能随意丢弃。

本机配置或 Docker 检查失败时，修正后可重新尝试。如果准备阶段提示恢复文件，先查看文件并运行 `abx recover my-app` 核对已记录的资源操作，再清理或重试。不要把网络、401/403 或服务器错误当作资源不存在。源构建不会自动重放，失败清理结果和保留资源以命令输出为准。

Docker 下载问题应检查构建容器内的 DNS、HTTPS、代理、CA 和 MTU；宿主下载成功不能证明容器网络正常。不要关闭 TLS 校验或改依赖版本掩盖网络问题。`--verbose` 可用于本机诊断，日志可能含应用自行打印的私密数据。

[清单与启动语义](template-workflows.md) · [构建复用](authoring-templates.md)
