# CLI 操作示例

这些示例使用[当前源码 CLI](../README.zh-CN.md#安装)。先运行 `abx --help` 核对当前版本命令。
凭据通过正常配置或环境变量提供，不把值放进脚本或 Issue。

检查本地安装并搜索模板，不创建云资源：

```bash
abx --version
abx provider list
abx template list python
```

创建自己的沙箱，使用后销毁：

```bash
abx deploy --template-id base --name demo
# 后续操作使用本机保存的部署名称。
abx sandbox exec demo -- echo hello
abx delete demo --yes
```

详细选项和插件编写方式见[CLI 参考](../docs/zh/reference/cli-reference.md)
与[Provider 指南](../docs/zh/guide/providers.md)。
[英文示例](README.md)说明相同操作。
