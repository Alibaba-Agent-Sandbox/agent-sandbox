# 开始使用

先按[安装指南](binary-installation.md)安装，再运行 `abx --version` 和 `abx --help`。本文对应当前源码；旧发行版可能使用不同命令。

用 `config init` 配置所选 Provider。交互引导说明每种凭据的来源与用途，并保存输入。Express 的 Sandbox API Key 用于运行时调用，云 AccessKey 用于平台管理；应用令牌和模型 Key 分开使用。

```bash
abx config init
abx sandbox create --template base --yes
abx status SANDBOX_ID
abx sandbox exec SANDBOX_ID -- echo 'Hello from sandbox'
abx sandbox delete SANDBOX_ID --yes
```

运行应用时，从目录选择模板：

```bash
abx template list python
abx template info python-hello
abx template init ./python-hello --from python-hello
cd python-hello
abx deploy . --name hello --yes
python run.py --template TEMPLATE_ID
abx sandbox delete SANDBOX_ID --yes
abx delete hello --yes
```

部署只准备可复用模板，从资源结果读取 TEMPLATE_ID；模板的 run.py 创建动态实例并启动服务，从运行结果读取 SANDBOX_ID。Python SDK 前提和私有应用认证按所选模板 README 配置。实例租期和运行环境属于显式创建参数，不属于 deploy。

继续阅读[模板创作](authoring-templates.md)、[配置](guided-configuration.md)和[沙箱操作](operations.md)。
