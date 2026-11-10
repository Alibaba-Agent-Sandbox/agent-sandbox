# 配置引导

运行 `abx config init` 配置所选 Provider，也可以继续查找并部署模板。交互输入的受支持配置保存到当前用户的本机配置，后续复用，不再询问保存范围。已有命令选项和环境变量覆盖值不会自动写入保存的配置。

```bash
abx config init
abx config init --build
abx config init --llm
abx config list
abx --provider PROVIDER config init
```

运行时调用需要所选 Provider 的 API 凭据和端点。构建可能还需要云 AccessKey、Docker 和镜像仓库权限。`template init --from` 获取源码及内置模板初始化不需要云凭据。模型辅助的 `template init --prompt` 或 `--adopt` 需要编码工具和模型 Key；生成源码后即结束，不自动部署。

| 凭据 | 用途与来源 |
| --- | --- |
| Sandbox API Key | 访问运行时，从所选 Provider 获取 |
| 云 AccessKey 对 | 平台管理，从具有所需授权的 RAM 身份获取 |
| 模型 API Key | 模型调用，从模型服务获取 |
| 应用令牌 `ABX_SERVER_TOKEN` | 保护应用 API，由 CLI 本机生成，不是去云控制台申请的 Key |
| GitHub Token | 读取私有源码或提高读取限额，从 GitHub 获取适当权限的令牌 |

模板声明空应用令牌时，部署自动生成随机值、私密保存并在后续命令中复用，`--yes` 同样适用。需要自定义时，通过 `abx config set server_token` 隐藏输入。外部客户端将该应用令牌与 Provider 流量认证分开传递。修改本机配置不会改变已经运行的应用环境。

交互提示按需显示 Provider、地域和 API 主机。空输入或 Ctrl+C 会在保存前取消收集。敏感信息隐藏输入；无效的已保存配置会明确报错，不会静默覆盖。详细来源见 `--verbose` 和[配置参考](../reference/configuration.md)。

```bash
abx config set sandbox_api_key
abx config set llm_api_key
abx config set llm_base_url
abx config set llm_model
abx config delete llm_api_key
```

自动化在 `--yes` 前提供所需配置。JSON、quiet、CI 和管道调用不弹出配置问题。`config init --yes` 只打印配置方法，不收集值。权限、配额、网络或 Provider 能力缺失不能靠填造配置解决。云管理 Key 的创建或续期仍需独立确认；把 AccessKey 保存到本机不等于同意创建云 Key。

MCP 编辑器注册可以离线完成，不向 IDE 文件写入云密钥。远端 HTTP MCP 服务需要应用认证和运行时 Provider 配置；先用 `abx template init ./mcp --template mcp` 初始化，再审阅部署。见 [MCP 接入](mcp-integration.md)。

缺少工程时，显式运行 `template init`。部署失败后查看 `status` 与 `recover`；不能因为补齐配置就重放结果未知的云请求。
