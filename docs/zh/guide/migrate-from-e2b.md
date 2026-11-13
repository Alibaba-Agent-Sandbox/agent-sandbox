# 从 E2B CLI 迁移

当前 abx 使用统一命令入口，选择 Express 或其他 Provider 不会切换解析器。迁移时需要调整命令路径，不能只替换可执行文件名称。Python 标准客户端的导入与兼容范围见 [Python 迁移指南](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/zh/guide/migrate-from-e2b.md)。

```bash
abx sandbox create --template code-interpreter-v1 --yes
abx --json list
abx sandbox exec --cwd /tmp SANDBOX_ID -- sh -c 'printf hello; exit 7'
abx sandbox connect SANDBOX_ID
abx status SANDBOX_ID
abx sandbox delete SANDBOX_ID --yes
```

`sandbox create` 创建实例并返回 Sandbox ID，不自动打开终端。`sandbox connect` 连接终端，退出不会自动删除借用的实例。`sandbox exec` 的本地选项放在目标前，目标后的参数属于远端程序；远端退出码与输出保留。删除需明确资源归属，自动化使用 `--yes`。

Express 仍接受其文档中支持的 `E2B_API_KEY`、`E2B_API_URL`、`E2B_DOMAIN`，也支持项目的 `ABX_SANDBOX_*` 配置。使用配置中的阿里云身份，不需要 E2B 浏览器登录或 Team 管理。不要把 Express 凭据发给另一个 Provider。

模板目录使用 `template list/info`，源码使用 `template init/build/publish`，资源准备使用 `deploy`，动态实例使用 `sandbox create`。原生云模板管理下沉到 `provider run template.list/get/create/delete`，先看对应操作的 `--help` 和权限要求，不能把公共目录列表当作云账号资源。

暂停、恢复、快照、网络与终端的支持取决于 Provider、运行时和账号准入。API 存在不保证默认模板或账号已开通。某些后端不支持 stdin EOF；这类错误仍会保留，不能把本机结束输入当作远端已结束。

使用 [操作速查](operations.md)、[权限说明](permissions.md)和当前 `--help`。已安装的旧发行版可能保留原命令；当前源码不提供旧命令兼容别名。
