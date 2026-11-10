# 开始使用

先按[安装指南](binary-installation.md)安装，再运行 `abx --version` 和 `abx --help`。本文对应当前源码；旧发行版可能使用不同命令。

用 `config init` 配置所选 Provider。交互引导说明每种凭据的来源与用途，并保存输入。Express 的 Sandbox API Key 用于运行时调用，云 AccessKey 用于平台管理；应用令牌和模型 Key 分开使用。

```bash
abx config init
abx deploy --template-id base --name my-sandbox --yes
abx status my-sandbox
abx sandbox exec my-sandbox -- echo 'Hello from sandbox'
abx delete my-sandbox --yes
```

运行应用时，从目录选择模板：

```bash
abx template list python
abx template info python-hello
abx deploy python-hello --name hello
abx sandbox command list hello
abx sandbox command run hello hello --arg name=Ada
abx delete hello --yes
```

CLI 准备源码、启动服务并验证声明的就绪条件。需要 Docker、镜像仓库或模型访问的模板仍需配置这些条件。模板声明应用认证时，CLI 自动生成并保存令牌。外部 HTTP 客户端使用返回的服务端点，并携带应用令牌及 Provider 要求的网关请求头。

已有平台模板使用 `--template-id`，其值是 Provider 的模板或受支持的镜像引用。本机部署名称是保存在当前主机的管理入口；SDK 使用 `status` 显示的实际沙箱 ID 连接。

后续见[模板编写](authoring-templates.md)、[配置引导](guided-configuration.md)、[Sandbox 操作](operations.md)和[托管应用](managed-applications.md)。
