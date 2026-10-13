# 提供方与凭证 —— CLI 规格评审记录

被评审的文档：[`providers-and-credentials-cli.md`](./providers-and-credentials-cli.md)。它是 Python SDK 设计的 CLI 对应文档；SDK 一侧的评审（两轮，附流程说明）见 `python-sdk/docs/zh/design/providers-and-credentials-review.md`。

> **关于本译文**：这是[英文版](../../design/providers-and-credentials-cli-review.md)的中文版，编号一致；以英文版为准。完整的英文原表另含第 1–2 轮对 CLI 规格的逐条发现（C1–C13 之前的条目），这里只重复英文文件中保留的最后部分和实现阶段补充。

## 第 2 轮的 CLI 规格发现（节选，C4–C13）

| # | 轮次 | 发现 | 处理 |
|---|---|---|---|
| C4 | 1 | 清除一个键后，legacy 命名的副本"回来了" | §3.3 清除时删除每一个已存储的名字 |
| C5 | 1 | `config set api_url` 的回显文本必须逐字节不变 | §3.3 按用户键入回显键 |
| C6 | 2 | 提供方覆盖槽（`uses_core`）让插件可以隐式读取通用凭证 | §1.3 / §2.1 改为 `core.inherit` ∩ 已同意列表；同意界面的 `Inherit` 警告行；`info` 显示 `Inherits` |
| C7 | 2 | `--link` 不固定任何东西 | §5.3 需要 `--yes`，横幅，仅 POSIX；增加错误行 |
| C8 | 2 | `Security` 行看起来像是被强制执行的 | §5.3 标注为"declared by the plugin (not enforced)" |
| C9 | 2 | 只对非内置提供方使用限定 id，在默认提供方改变之后仍可能误导 | §4.4 只有当环境**和**生效提供方都是 `alicloud-express` 时才使用旧格式 |
| C10 | 2 | `--provider` 拼写错误给出的错误信息没有帮助 | §4.1 `Did you mean` 提示 |
| C11 | 2 | `provider` 的可发现性，以及哪个提供方做了回答 | §0：`abx --help` 的相关命令行，`abx info` 的 `Provider` 行（仅非内置） |
| C12 | 2 | 插件 stderr / `initialize` 可能泄露密钥 | §7 测试 7：stderr 遮蔽 + 不记录 `initialize` |
| C13 | 2 | 安装器顺序：校验必须先于任何文件写入 | §7 测试 6：在写 blob 之前做 `ls-tree` 校验 |

留给 CLI 工作者确认的事项：确认 Node 的 `smol-toml` 能处理 `examples/providers/` 里的每个清单；确认最低支持的 git 版本（2.20）上有 `git cat-file --batch`。

## 实现阶段补充（第 3 轮，实现 Python 一侧时发现）

| # | 发现 | 处理 |
|---|---|---|
| I1 | `-32002` 被映射到 `SandboxCreationError`（E2000，退出码 1），与文档里的退出码 4 矛盾 | 新增 E8005 `ProviderResourceNotFoundError`；映射和 `epp-error-mapping.json` 已更新；规格 §9.1 |
| I2 | 契约套件在 `kill` 对未知 id 抛错的提供方上失败 | 宿主适配器在 kill 上吞掉 E8005；套件要求 kill 幂等；规格 §9.2 |
| I3 | 对没有 envd 的沙箱（`epp://` 标记），`list_commands` 崩溃 | 对标记 URL 跳过 envd 认证 / 列出；规格 §9.3 |
| I4 | 正常退出的插件会让孙进程继续存活 | `EppClient.close` 总是回收进程组；规格 §9.6 |
| I5 | Python 解释器往受摘要校验的插件目录里写 `__pycache__`，使第二次运行完整性失败 | 清理后的环境里加入 `PYTHONDONTWRITEBYTECODE=1`；规格 §9.5 |
| I6 | `Sandbox` 没有办法释放插件进程 | `Sandbox.close()`；规格 §9.7 |
| I7 | 迁移留下空的 `[transport]` 表 | 删除；`migration-vectors.json` 覆盖；规格 §9.8 |
| I8 | `sandbox.yaml` / `@sandbox` 的提供方接线位于另一个工作流负责的文件中 | 推迟；列在 §9.10 和 CLI 清单里 |
