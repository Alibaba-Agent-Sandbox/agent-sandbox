# 验证模板、代码仓库、预览和第三方工具流程

这些按需运行的场景连接已配置的真实 Express 账号，创建临时资源，并在成功或失败后只清理本轮创建的资源。结果不能证明所有 Provider 都支持相同流程。

先用锁文件安装并构建 CLI（`npm ci && npm run build`），准备已有环境配置：`ALICLOUD_ACCESS_KEY_ID`、`ALICLOUD_ACCESS_KEY_SECRET`、`ALIBABA_CLOUD_REGION_ID`、`E2B_API_KEY`、`E2B_API_URL` 和 `E2B_DOMAIN`。Python 场景还需要在所用 Python 环境中安装与源码兼容的 `agent-sandbox-client`，安装方法见 [SDK 说明](https://github.com/Alibaba-Agent-Sandbox/python-sdk#installation)。账号凭据不会进入沙箱或证据文件。

## OCI 构建、业务验收和模板回退

选择一个已经 Ready、允许复用其 OCI 镜像和启动配置的二代模板。场景只读取源模板的元数据，不修改它；如果源模板包含私有镜像仓库配置，会停止，不会复制凭据。

```bash
export ABX_SKILL_SOURCE_TEMPLATE_ID=REPLACE_ME
node e2e/skill-template-acceptance.mjs --output ./template-acceptance-new.json
```

可用 `ABX_BIN` 选择其他 CLI 构建，默认使用当前仓库的 `dist/bin/abx.js`。`ABX_SKILL_RUN_PREFIX` 可指定简短的小写资源标签前缀，场景会自动追加随机后缀。

场景生成符合 spec5 的清单，使用 `provides: {}`，因为该测试只承诺 shell 和文件操作，不声明应用服务。它通过真实的 `--build steps` 路径注册两个独立模板，等待 Ready 后按 v1 → v2 → v1 创建沙箱，每个沙箱都必须返回正确的构建版本和业务计算结果 `385`。重新选择保留的 v1 模板验证回退方法。同时提交一个明确以 `42` 退出的构建，要求平台进入错误状态，客户端能够说明失败的退出码。只收到注册成功响应不算交付成功。

最终 JSON 记录沙箱独立查询 HTTP404，以及模板的官方 GetTemplate404 和本轮模板名称从列表中消失。提交结果不确定会判为失败，并保留资源归属记录供对账。此测试不证明本地 Dockerfile 构建、外部 VM 快照转换、生产流量迁移或缓存与预热池自动刷新。

## 仓库应用、限时预览和第三方 MCP

```bash
# 在 python-sdk 仓库中运行：
python3 e2e/skill_tools_acceptance.py --output ./tools-acceptance-new.json
```

[此脚本归 Python SDK 仓库维护](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/e2e/skill_tools_acceptance.py)。可通过 `ABX_SKILL_RUNTIME_TEMPLATE` 选择已有运行时模板，默认使用平台内置别名 `code-interpreter-v1`。运行时需要 Python、Node.js、Git，以及访问代码仓库和软件包的出站网络能力。

场景拉取固定提交的 Agent Sandbox 模板仓库，检查无需额外依赖的 Node 应用，启动后验证完整 HTTP 响应。应用代理提供有效期为20秒的预览，外部请求必须表现为：有效签名200、缺失签名403、篡改签名403、到期后403。这是应用层 HMAC 验证和过期控制，不是平台网关原生签名链接。沙箱以 `secure=False` 创建，便于外部浏览器访问应用自己的认证入口；示例应用不含敏感数据，验证后会删除沙箱。

同一沙箱安装真实 npm 文件系统 MCP 服务2026.7.10，完成协议初始化和工具发现，调用 `read_file` 读取限定目录里的测试文件，结果必须包含预期业务值 `385`。之后更新到2026.8.31并重复协议和工具调用，查看日志，再清理软件包、数据和进程。这个具体的第三方服务不需要外部凭据；需要凭据的工具应单独验收。此场景也不覆盖所有第三方 Skill 或其他 MCP 软件包。

每次运行使用新的证据文件名，脚本不会覆盖已有记录。必须检查失败项、受阻项和独立清理结果后再报告完成。某次测试通过只代表该时间点和该测试范围，不会自动补齐 Provider 尚未支持的操作。
