# CLI 模块退役

npm 包提供 `abx` 可执行程序，内部 `dist/` 模块不是独立 Node SDK API。
Node HTTP SDK 在 https://github.com/alibaba-agent-sandbox/nodejs-sdk，
Python SDK 在 https://github.com/alibaba-agent-sandbox/python-sdk。

以下 Python 移植实现未被 CLI 使用，本次将其移除。直接导入这些内部路径的用户
需要先迁移，这是内部深层导入的兼容性变化；本次没有删除 CLI 命令。

| 退役源文件 | 替代方式与归属 |
|---|---|
| `api/image.ts`、`api/template.ts` | Dockerfile、`template.yaml` 与 `abx template build`、`push`、`create`、`deploy`；保留 DockerBuilder 与官方 FC 模板适配器 |
| `api/session_manager.ts`、`session/local.ts`、`models/session.ts` | Python SDK 命名会话持久化；保留 CLI 的交互式 `abx connect` |
| `models/config.ts` | `transport/config.ts` 分层配置与 `abx config` |
| `utils/keychain.ts` | CLI 凭据配置；这个未使用的 SecretStore 不参与命令凭据解析 |
| `utils/retry.ts` | 不添加通用自动重试；重试必须考虑具体操作是否可安全重放 |
| `protocol/port.ts` | CLI 使用的 `api/network.ts` 与提供方 URL 方法 |
| `TemplateProtocol.create(dockerfile)` | 删除已废弃、只创建元数据的 `POST /templates`；保留当前镜像构建 v3/v2 与官方模板 API |

从可执行入口检查 TypeScript 导入图（包含类型导入、字面量动态导入），并以构建
图交叉验证。独立 MCP 入口 `agent/mcp_main.ts` 保留；仅有 barrel 导出不能证明
有可执行消费者。活跃的下划线兼容辅助模块保留。现有功能 PR 变基时须复核影响。

只删除专门验证退役实现的测试。原始 CLI parity 台账、黄金快照和历史证据全部
保留。测试数量减少表示实现覆盖随实现退役，不能算作这些删除用例测试通过。
新验证见[仓库记录](../../../.agents/notes/implemented/architecture/2026-10-18-retire-orphan-cli.md)。

[English](../../en/design/cli-module-retirement.md)
