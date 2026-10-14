# 提供方接线计划（对现有 CLI 模块的后续修改）

> 状态（2026-10-13）：**沙箱路径的接线已经完成；本文现在是原计划的记录，加上仍未解决的事项清单**。`provider` 已是命令组，`--provider` / `--opt` / `--all-providers` 和带前缀的 id 可用，`Sandbox.create/connect/list/killById` 会选择提供商，`SandboxNotFoundError`（`E2009`）已存在，`network.resolve` 走 `ports.url`，并且已从 CLI 端到端驱动过一个 OpenSandbox 服务器（[验证记录](../../.agents/evidence/verify/2026-10-13-opensandbox-provider-e2e.md)）。下面第 1 到 8 节保留为原计划，代码已经做到的条目请忽略。未解决事项见「10. 已知缺口」。此前的状态：交接说明，没有修改任何现有命令模块。本文按评审修复合入之后的应用顺序，列出剩余的精确修改。语法、帮助文本和 JSON 形状由 [`providers-and-credentials-cli.md`](providers-and-credentials-cli.md) 负责；本文只说明每一部分**接在哪里**。
>
> 这是[英文版](../../design/provider-wiring-plan.md)的中文版，章节编号一致。命令名、键名、错误码和代码标识符保持英文原样；两者有差异时以英文版为准。

## 0. 已有内容（不要重写）

| 领域 | 模块 | 需要调用的入口 |
|---|---|---|
| 键注册表 | `src/utils/config_keys.ts`（由 `scripts/gen-config-keys.mjs` 从 `tests/fixtures/config-keys.json` 生成）、`src/utils/config_resolver.ts` | `findKeyByAlias`、`envNames`、`aliasNames`、`providerEnvName`；`resolveKey`、`resolveProviderId`（层优先） |
| 分层配置 | `src/transport/config_layers.ts` | `loadLayeredConfig`、`LayeredConfig.toTransportConfig()`、`explainConfig`、`auditConfig`、`planMigration`、`applyMigration`、`warnLegacyOnce` |
| 提供方核心 | `src/providers/`（`index.ts` 汇总导出） | `getProvider`、`listProviders`、`resolveProviderId`、`ambientProviderId`、`parseSandboxRef`、`qualify`、`install`、`update`、`uninstall`、`doctor`、`defineProviderContractTests`、`runContractSuite`、`exitCodeFor` |
| 内置提供方 | `src/providers/builtin.ts` | `AlicloudExpressProvider` 原样包装现有的 `HttpClient` 与各 Protocol |
| 插件 | `exec_provider.ts`（EPP/1）、`rest_provider.ts` | 按清单 `kind` 选择 |

下面都是接线工作。名称沿用 Python 的名称，线上字段为 snake_case。

## 1. 前置条件

1. **版本号**：`package.json` 及 `src/**` 中的版本升到 `0.3.0`，与 `python-sdk` 同步。参考插件声明 `compat.requires = { cli = ">=0.3" }`；当前测试显式传入 `hostVersion: "0.3.0"`。升级后删除 `tests/_support/plugins.ts` 中的 `TEST_HOST_VERSION` 覆盖。
2. **`package.json`**：`files` 已包含 `dist`，`src/providers/**` 会编译进去，无需修改。清单解析器使用仓库内的 `src/utils/toml_plain.ts`，没有新增依赖。
3. **`models/errors.ts`**：新增 `SandboxNotFoundError`（错误码 `E2009`，对应 Python `models/errors.py`）。`providers/errors.ts#exitCodeFor` 须将其映射为退出码 4。
4. **`protocol/sandbox.ts`**：`get`、`connect`、`set_timeout`、`pause`、`resume` 遇到 HTTP 404 时抛出 `SandboxNotFoundError`（`kill` 仍返回 `false`），与 Python 一致。
5. **`models/sandbox.ts`**：`SandboxConfig` 增加 `secure?: boolean` 和 `provider_options?: Record<string, unknown>`（内置适配器目前用 `Object.assign` 携带，需换成真正的字段）。`ProcessInfo.pid` 改为 `number | string`（exec 提供方使用字符串 `process_id`）。
6. **`api/network.ts`**：增加 `resolve(port)` / `resolve_url(port)`，非 envd 提供方通过 `ports.url` 解析（对应 Python `api/network.py`）。内置行为不变。

## 2. `src/api/sandbox.ts`（API 层）

现状：顶部的 `_buildInfra(opts)` 依次构建 `loadConfig` → `createAuthProvider` → `HttpClient` → `SandboxProtocol`，`Sandbox.create/connect/list/killById` 调用它。

修改：

1. `BuildInfraOptions` 增加 `provider?: string | null` 与 `provider_options?: Record<string, unknown> | null`。
2. `_buildInfra`：`const p = getProvider(resolveProviderId(opts.provider))`；**若 `p.id === BUILTIN_PROVIDER_ID` 则原样走现有代码路径**（保证所有基于 mock/spy 的测试字节级不变）；否则 `await p.buildInfra(loadLayeredConfig(overrides))` 并映射为同样的元组。仅插件分支是异步的；保留内置的同步快路径，或在 4 个调用点统一 `await`。
3. `Sandbox.create(template, { provider, provider_options, secure, ... })`：将 `provider_options` 与 `secure` 传入 `SandboxConfig`；功能门控已在 `ExecProvider` 适配器内部完成。
4. `Sandbox.connect(ref)` / `killById(ref)`：`parseSandboxRef(ref)` 得到 `[pid, sid]`；前缀决定提供方，与显式 `--provider` 冲突时抛 `E8030`（`ProviderMismatchError`）。无前缀的 id 使用环境默认提供方。
5. `Sandbox.list({ provider })` 对单个提供方不变。新增静态方法 `listAllProviders()`：遍历 `listProviders()`，容忍单个提供方失败（返回 `{ results, errors }`），用 `qualify(providerId, id)` 标记每一行。
6. exec 提供方返回 `envd_url` 时，继续使用现有 envd 传输做 exec / 文件 / PTY（混合模式，已在 `ExecProvider` 中实现）。
7. 取消 `tests/test_providers/test_sandbox_provider.test.ts` 中两个 `it.todo` 的占位（`Sandbox.connect('provider:id')` 冲突 → `E8030`，以及内置默认路径）。

`api/commands.ts`：路由不变；只需让 `kill/connect/send_stdin` 的签名接受字符串 pid（随 `ProcessInfo.pid` 的放宽而改）。

## 3. `src/cli/main.ts` 与 `command_surface.ts`

1. 注册命令组：在 `src/cli/command_surface.ts` 的 `GROUP_COMMANDS` 中增加 `provider: "commands/provider:provider"`；`abx --help` 把它列在单独的 **Providers** 标题下。
2. 根命令选项（根级与叶子级均可，叶子级优先；规格 §4）：
   - `--provider ID`（`envvar: "ABX_PROVIDER"`），按 id 语法校验，存入 click 上下文 `ctx.obj.provider`。
   - `--opt KEY=VALUE`（可重复），用 `src/providers/testing.ts` 中的 `parseProviderOptions` 解析（也可挪到 `providers/options.ts`）。涉及密钥字段（`ConfigField.secret`）时按规格以退出码 2 拒绝。
3. `abx --help` 结尾加入 `Related commands` 行（规格 §0），重新生成根帮助 golden。
4. 顶层错误处理：**仅对提供方类型的错误**使用 `exitCodeFor(err)`，其余保持现有映射（golden 不变）：认证 3、未找到 4（现在包含 `SandboxNotFoundError`）、超时 5、配额 6、配置 / 信任 / 不匹配 2，其余 1。
5. `ABX_WARN_DEPRECATED=1`：`main.ts` 无需改动，`warnLegacyOnce` 在调用时读取环境变量。CLI 测试的 setup 中需调用 `_resetDeprecationWarnings()`。

## 4. 新文件 `src/cli/commands/provider.ts`

一个 `provider` 组及子命令，每个都是对库的薄封装（命名见规格 §5；均支持 `--json/--quiet/--ci/--no-color`）：

| 命令 | 调用 | 说明 |
|---|---|---|
| `list` | `listProviders()` | 列按规格 §5.1；标出默认项 |
| `info ID` | `getProvider(id)` + 清单 / 回执 | 显示功能、字段（密钥遮蔽）、信任级别、摘要 |
| `install SOURCE [--ref --sha256 --subdir --link --yes --allow-insecure-transport --force]` | `install(source, { confirm, verify: verifyHandshake, … })` | `confirm` 打印 `InstallPlan` 同意界面；非 TTY 且无 `--yes` → 退出码 2 |
| `uninstall ID [--purge]` | `uninstall` | 除非 `--purge`，否则保留 `data/`；若为默认提供方则重置并提示 |
| `update [ID \| --all] [--check] [--yes] [--allow-insecure-transport]` | `update` | `--check` 只读；风险项变化（`diffAspects`）需重新同意 |
| `default [ID]` | 写入 config.toml 的 `[core] provider`（用 `toml_write.ts`） | 显示生效值与来源；`ABX_PROVIDER` 覆盖时给出提示 |
| `config ID [KEY [VALUE]]` | `providerSchema(id)` | 存储规则见规格 §3.3 |
| `doctor [ID]` | `doctor(id, { handshake: true })` | 展示 installed/integrity/config/handshake 检查；任一失败退出码 1 |
| `test ID [--opt …] [-k FILTER]` | `runContractSuite(id, { options, filter })` + `summarizeContract` | 逐用例输出 ok/skip/fail；失败退出码 1；`SkipContractTest` 记为跳过 |

库抛出的是带 `code`（`E80xx`）和 `suggestion` 的 `ProviderError` 子类；用现有错误格式化器渲染，并通过 `exitCodeFor` 退出。

## 5. `src/cli/commands/config_cmd.ts`

`config_cmd.ts` 按每个键唯一的名字解析。用这条规则替换旧的多名字表，顺序如下：

1. 键解析（`get/set/delete KEY`）：层优先的 `resolveKey` 查找该键唯一的环境变量。限定形式 `providers.<id>.<key>` 和 `--provider` 选择提供方。未知键以退出码 2 结束，并列出存在的键（规格 §3.2）。
2. 读取：`get`/`list` 使用 `loadLayeredConfig()`/`explainConfig()`（来源标签）。输出通道与格式不变。
3. 写入：`config set` 写入该键唯一的环境变量（密钥在 `~/.abx/.env`，其他键用配置键名写入 `config.toml`）。`delete` 删除该已存值。
4. `get/set/delete/list` 接受 `--provider` 和 `--all`。`config list` 显示 `sandbox_base_url`、`sandbox_domain` 以及注册表里的其他键。
5. `explainConfig()` 报告决定每个键的那一个变量。密钥脱敏。
6. `config list` 显示每个键那一个名字，并脱敏密钥。没有第二个名字需要审计或改写。
7. 提供方作用域的键（`acr_*`、`team_id`、`region`、插件字段）：`config set <provider>:<key>` 或配合 `--provider`；密钥写入 `~/.abx/.env`（0600）。

需先补的缺口：`config-keys.json` 没有 `description_zh`/`required`；若 `config list` 需要中文描述，请从 Python 仓库重新生成该 fixture（漂移测试会强制更新）。

## 6. `src/cli/commands/sandbox.ts`

修改位置（行号会漂移，按命令名查找）：

- `create`：增加 `--provider`、可重复的 `--opt`、`--secure/--no-secure`；把 `provider`、`provider_options`、`secure` 传给 `Sandbox.create`。作用域为内置提供方的选项（`--region`、`--access-key-*` 等）用于其他提供方时，按规格文本以退出码 2 拒绝。输出 `qualify(providerId, id)`，且**仅当提供方不是内置时**才在 `--json` 中加入 `"provider"`（否则字节级不变）。
- `list`（`list_cmd`）：增加 `--provider` 与 `--all-providers`（JSON：仅非内置或全提供方模式下每行加 `provider` 键；单个提供方失败以 stderr 警告输出，除非全部失败否则退出码 0）。
- `kill`、`connect`，以及所有接受沙箱 id 的命令（`sandbox_files.ts`、`sandbox_process.ts`、`sandbox_system.ts`）：通过 `parseSandboxRef` 接受限定的 `provider:id`，调用 `Sandbox.connect(ref, { provider })`。
- `loadConfig({ region })` 调用点（create/kill）：内置提供方保持不变；非内置走 `loadLayeredConfig`。
- `info`：仅对非内置提供方增加 `Provider` 行。
- 根级 `--provider`/`--opt` 从 `ctx.obj` 读取，叶子级覆盖。

`sandbox.yaml`（`provider:` 键）：在沙箱规格加载器（`src/cli/commands/sandbox.ts` 的声明式创建路径及 `src/api/_yaml.ts` 的使用方）中增加可选的 `provider: <id>` 和 `provider_options: {…}`；优先级：命令行选项 > `sandbox.yaml` > 环境默认。未知或密钥类选项名与 `--opt` 一样以退出码 2 拒绝。

## 7. `src/cli/commands/mcp.ts`

- 服务端环境（`mcp start` 构建 `env` 处，`_spawnBackground` 附近）仅在进程环境中显式存在时转发 `ABX_PROVIDER` 与 `ABX_<P>_*` 提供方变量；**绝不**把 LLM / GitHub 密钥转发给提供方（注册表在构造提供方时已强制，无需额外处理）。
- 认证令牌辅助函数中的 `loadConfig().api_key`（约 162 行）保持不变：它是 MCP 认证使用的内置密钥查找。
- 创建 / 列出 / 终止沙箱的 MCP 工具：在 `sandbox_create`、`sandbox_list`、`sandbox_kill`、`sandbox_connect` 的工具 schema 中增加可选字符串参数 `provider`，接受限定 id；JSON 结果仅对非内置提供方加入 `provider`。
- `mcp install` 复制规则（规格 §4.3）：生成的客户端配置只通过 `ABX_PROVIDER` 保留提供方选择，绝不包含密钥。

## 8. 文档与 golden

- 重新生成 golden：`config list`（文本 / JSON）、`config --help`、`abx --help`；为 `provider` 命令新增 golden。
- 更新 `docs/en/reference`、`docs/en/guide/{environment-variables,authentication,troubleshooting}.md`，新增 `docs/{en,zh}/guide/providers.md`；中英文镜像同步；`SKILL.md`、`llms.txt`、`README*.md`。
- 文档中不得出现本地绝对路径（`scripts/check-no-local-paths.sh`）。

## 9. 接线后的验证清单

1. `npx tsc -p tsconfig.json --noEmit` 与 `npm run lint`。
2. `npx vitest run tests/test_providers tests/test_transport/test_config_names.test.ts tests/test_utils`（当前 providers 为 338 通过、2 todo）。
3. 仅内置提供方时 `parity/diff/` 下的差分用例：除 `config list` 外字节级一致。
4. 对 `local-process`、`e2b-compatible` 以及（本地 OpenSandbox 服务在运行时）`opensandbox` 运行 `abx provider test <id>`；最后一个在服务不可用时礼貌跳过。
5. 跨实现：用 Node 安装器安装插件后由 Python SDK 加载（摘要相同），反向亦然。

## 10. 已知缺口（带入评审）

2026-10-13 OpenSandbox 实测之后仍未解决的事项（每条都有已验证的现象）：

- **`template` 命令忽略 `--provider`。** `abx --provider opensandbox template deploy ...` 会走阿里云 ACR 流程（`ACR credentials missing`）。它们应当检查 `templates.read` / `templates.build`，像其他受特性约束的命令一样返回 `E8004`。
- **能力集合不是从提供商的特性推导出来的。** 对 OpenSandbox，`abx sandbox capabilities` 和 `sandbox.capabilities` 报告 `code, files, shell`，而它并未声明 `code.interpret`；`Provider.capabilities()` 与 `FEATURE_TO_CAPABILITY` 存在，但没有任何调用方。基于镜像的提供商每次 create 还会打印 `Could not resolve capabilities for template '<image>'`。
- **在没有 HTTP 数据面的插件上执行 `abx sandbox command run`** 会以 `this._http_client._createEnvdClient is not a function` 失败。Python SDK 有 `_require_data_plane("named commands")`，并返回 `E8004`；应把同样的保护移植到 `src/api/sandbox.ts` 的 `_callServerCommand`。
- **`SandboxInfo` 的默认值**（`region = "cn-hangzhou"`、`timeout = 300`）属于内置平台。`recordToInfo` 现在对插件覆盖了这两个值，所以既不报告区域也不报告生命周期的插件会显示空的 Region 行和请求时的 timeout；模型应当把二者改为可选。
- **没有 pause/resume 的 CLI 命令**：`Sandbox.pause()` / `resume()` 可用（已在 Python 中验证），但这个树里没有 `abx sandbox pause`。
- **目录改名已经完成。** 目录仓库带的是 `abx-provider.toml`。`opensandbox`、`e2b`、`cubesandbox`、`alicloud-container` 都是 `runtime.kind = "node"`。用 `abx provider install alibaba-agent-sandbox/awesome-providers//<id>` 安装。旧的 `ebx-provider.toml` 改名补丁不在这棵树里。

更早的缺口：

- `FilesystemProtocol.watchDir` 仅支持原生；exec 提供方的 `files.watch` 返回 `E8004`，除非走混合模式。
- 提供方错误类位于 `providers/errors.ts`；若框架要求单一错误模块，请迁移或重新导出。
- 旧的 `transport/config.ts` 通过 `LayeredConfig.toTransportConfig()` 桥接；待 `config_cmd.ts` 与 `mcp.ts` 不再导入 `loadConfig` 后即可移除。
- Node 中没有基于入口点的提供方发现（只有已安装的插件和 `registerProvider()`）。
