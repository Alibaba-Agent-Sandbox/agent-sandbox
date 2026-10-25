> 极速版标准命令以[E2B 迁移契约](../guide/migrate-from-e2b.md)为准：create 位置参数为模板，--prompt 请求生成，template create 使用 E2B 构建语义，from-image 创建阿里云镜像模板。

# CLI 命令参考（规范命令树）

每个操作只有**一个规范路径**，写作 `abx 组 动词`。在此之上只有一小组**固定**的顶层快捷方式，对应最常用的命令。
这组快捷方式写死在代码里：不能通过配置增加、改名或删除，也没有按用户配置的别名表。

<!-- fixed-set -->

顶层命令仅有这些：`abx sandbox`、`abx template`、`abx config`、`abx mcp`、`abx provider`、`abx create`、`abx list`、`abx info`、`abx kill`、`abx exec`、`abx connect`、`abx upload`、`abx download`、`abx run`、`abx deploy`。

`abx --help` 分两段列出：**Command groups**（`sandbox`、`template`、`config`、`mcp`、`provider`）和
**Sandbox shortcuts**（十个快捷方式，先说明用途，再以 `(alias: abx …)` 备注完整命令）。
之后显示当前 Provider 的操作摘要。更多模板可浏览 [Registry](https://registry.agent-sandbox.cn/templates/)，
或运行 `abx template search 关键词`。

## 模板项目目录

先创建模板源码目录，再部署，最后通过位置参数指定已部署的模板：

```sh
abx template scaffold --template python ./dev-services --name dev-services
abx template deploy ./dev-services -y --alias dev-services
abx create dev-services --detach
```

内置脚手架可选择 `python`、`node`、`minimal`；其他模板源码可在 Registry 中查找。
构建或部署目录不存在时，交互终端会询问是否创建，可选择内置模板，确认后继续原来的操作。
`--yes`/`-y`、`--ci` 或 CI 环境会自动创建 Python 模板项目并继续，保留别名和 Provider 参数。
已有目录直接使用；非交互且未指定 yes/CI 时只提示创建命令。自动化中需要其他运行时，可先用
`--template node` 或 `--template minimal` 生成项目。生成脚手架前仍会提示目录非空及可能覆盖的条目，
覆盖须确认；`-y` 本身不授权覆盖，脚本须显式添加 `--force`。拒绝后保留原文件。
标准创建命令使用 `abx create TEMPLATE`，`--template` 是生成脚手架的选项。

项目命令在 `CI=true` 或 `--ci` 模式下输出 JSON：错误写入 stdout，同时返回非零退出码。文本模式的错误写入 stderr。

因此可以直接部署一个新项目：

```sh
abx template deploy ./dev-services -y --alias dev-services
# CI 模式也会确认创建和部署：
abx --ci template deploy ./ci-services --alias ci-services
```

## 快捷方式

| 快捷方式 | 等价于 |
|---|---|
| `abx create` | `abx sandbox create` |
| `abx list` | `abx sandbox list` |
| `abx info` | `abx sandbox info` |
| `abx kill` | `abx sandbox kill` |
| `abx exec` | `abx sandbox exec` |
| `abx connect` | `abx sandbox connect` |
| `abx upload` | `abx sandbox upload` |
| `abx download` | `abx sandbox download` |
| `abx run` | `abx sandbox command run` |
| `abx deploy` | `abx template deploy` |

没有顶层的 `abx init` 和 `abx install`：请用 `abx template scaffold`、`abx template install`（凭证配置是 `abx config init`）。

## 规范命令树

```
abx
├── sandbox
│   ├── create [template]            list            info SANDBOX_ID        kill [SANDBOX_ID]
│   ├── exec SANDBOX_ID COMMAND...      connect SANDBOX_ID
│   ├── upload SANDBOX_ID LOCAL REMOTE  download SANDBOX_ID REMOTE LOCAL
│   ├── capabilities SANDBOX_ID
│   ├── files    list | mkdir | mv | rm | search | stat
│   ├── process  list | info | signal            （只查看/控制；启动进程用 exec --background）
│   ├── command  list | run                      （沙箱内服务端注册的具名命令）
│   └── system   env | info | metrics | packages | ports
├── template     init | create | list | delete | scaffold | from-image | search | info | build | push | deploy | install
├── config       init | get | set | list | delete
├── mcp          deploy | install | start | status | stop
└── provider     list | show | info | install | uninstall | update | default | config | doctor | test | engine | command | run
```

`abx provider --help` 列出管理命令和当前 Provider 的操作。使用
`abx provider run OPERATION --help` 查看 JSON 字段、Schema 和操作影响，再通过同一路径执行。
默认/显式选择、自动发现和兼容 JSON 目录见[Provider 操作](../guide/provider-commands.md)。
操作 ID 保持完整，不会替换固定的宿主管理命令。这些上下文入口需要包含本次改动的构建；
发布边界见对应指南。

用法行（取自 `abx … --help`）：

| 命令 | 用法 |
|---|---|
| `abx sandbox create` | `create [options] [template]` |
| `abx sandbox list` | `list [OPTIONS]` |
| `abx sandbox info` | `info [OPTIONS] SANDBOX_ID` |
| `abx sandbox kill` | `kill [OPTIONS] [SANDBOX_ID]` |
| `abx sandbox exec` | `exec [OPTIONS] SANDBOX_ID COMMAND...` |
| `abx sandbox connect` | `connect [OPTIONS] SANDBOX_ID` |
| `abx sandbox upload` | `upload [OPTIONS] SANDBOX_ID LOCAL_PATH REMOTE_PATH` |
| `abx sandbox download` | `download [OPTIONS] SANDBOX_ID REMOTE_PATH LOCAL_PATH` |
| `abx sandbox capabilities` | `capabilities [OPTIONS] SANDBOX_ID` |
| `abx sandbox files list\|mkdir\|mv\|rm\|search\|stat` | `files <动词> [OPTIONS] SANDBOX_ID`（路径选项 `-p/--path`、`-s/--source`、`-d/--dest`） |
| `abx sandbox process list` | `process list [OPTIONS] SANDBOX_ID` |
| `abx sandbox process info\|signal` | `process <动词> [OPTIONS] SANDBOX_ID PID` |
| `abx sandbox command list` | `command list [OPTIONS] SANDBOX_ID` |
| `abx sandbox command run` | `command run [OPTIONS] SANDBOX_ID COMMAND_NAME` |
| `abx sandbox system env\|info\|metrics\|packages\|ports` | `system <动词> [OPTIONS] SANDBOX_ID` |
| `abx template scaffold` | `init [OPTIONS] [DIRECTORY]` |
| `abx template search` | `search [OPTIONS] QUERY` |
| `abx template info` / `delete` | `<动词> [OPTIONS] TEMPLATE_ID` |
| `abx template list` | `list [OPTIONS]` |
| `abx template build` / `deploy` | `<动词> [OPTIONS] TEMPLATE_DIR`（顶层 `abx deploy` 的 `[PATH]` 可省略，默认 `.`） |
| `abx template push` / `create` | `<动词> [OPTIONS] IMAGE` |
| `abx template install` | `install [OPTIONS] TEMPLATE_REF` |
| `abx config init\|list` | `<动词> [OPTIONS]` |
| `abx config get\|delete` | `<动词> [OPTIONS] KEY` |
| `abx config set` | `set [OPTIONS] KEY [VALUE]` |
| `abx mcp deploy\|install\|start\|status\|stop` | `<动词> [OPTIONS]` |

## 全局选项

`-j/--json`、`-q/--quiet`、`-v/--verbose`、`--no-color`、`--log-level [debug|info|warning|error]`、`--ci`、
`--version`、`-h/--help`。它们写在命令之前（`abx --json list`）。

没有全局 `--timeout`，也没有 `--profile`。沙箱**生命周期**是 `abx create` 独有的 `--timeout SECONDS`；
标准 exec 没有本地命令超时参数。

## 标准执行与终端

```bash
abx exec --cwd /app --env MODE=test SANDBOX_ID pytest -q
abx exec --background SANDBOX_ID python -m http.server 8000
abx connect SANDBOX_ID
```

exec 的本地选项全部放在沙箱 ID 前，默认流式输出，返回远程退出码；后台 PID 写入 stderr。标准入口没有本地 --stream、--timeout。connect 使用真实 PTY，工作目录、环境变量跨命令保持；退出 connect 后沙箱仍运行。交互 create 使用参考版本生命周期；后续需要 ID 时传 --detach。见[完整标准参考](cli-reference.md)。

## 具名命令：`abx run` / `abx sandbox command`

只有一种机制：注册在**沙箱内服务端**的命令（`CommandRegistry`、`GET /commands`、`POST /commands/{name}`）。
它们不写在 `template.yaml` 里。

```bash
abx sandbox command list SANDBOX_ID                                  # 名称、参数、说明
abx run SANDBOX_ID build --arg target=staging --arg n=2              # 等价于 abx sandbox command run
abx run SANDBOX_ID add --json-args '{"x": 1, "y": 2}'                # 带类型的值
```

| 选项 | 含义 |
|---|---|
| `-a/--arg KEY=VALUE` | 命令参数（可重复；服务端按声明的类型转换字符串） |
| `--json-args JSON` | 以 JSON 对象传参 |
| `--server-port PORT` | 沙箱内服务端端口（默认 9000） |

字符串结果原样打印，其他值以 JSON 打印（`--json` 时包装为 `{"result": ...}`）。命令在服务端执行失败时退出码为 1。
使用 `--json` 时，参数校验或执行失败只输出一个错误对象，包含 `status: "error"`、错误码 `E3000`，以及 `message` 中的服务端诊断；成功结果仍使用 `{"result": ...}`。
名称不存在时保留 `E3005`，退出码为 2；沙箱里没有运行中的服务端时提示 "No SandboxServer reachable" 并以非零退出。

## 初始化：`abx config init`

`abx config init` 默认只询问**凭证和区域**。两个选项追加配置段：

| 选项 | 追加内容 |
|---|---|
| `--build` | ACR 命名空间与阿里云 AccessKey（`template build`/`deploy`/`install` 需要） |
| `--llm` | 模板生成使用的 LLM API Key（`abx create --prompt "描述"`、`abx template scaffold --prompt "描述"`） |

缺少相应设置时，功能会打印一行指向 `abx config init --build` 或 `abx config init --llm` 的提示。
无终端（或带 `--yes`/`--ci`）时命令不会提示输入，而是打印等价的 `abx config set …`。

## 已移除的写法

| 已移除 | 替代 |
|---|---|
| 顶层 `abx init`、`abx install` | `abx template scaffold`、`abx template install` |
| `abx sandbox process start` | `abx exec --background` |
| `abx sandbox shell-stream` | `abx exec`（默认流式） |
| `abx sandbox run` | `abx run` / `abx sandbox command run` |
| 全局 `-t/--timeout`、全局 `-p/--profile` | `abx create --timeout`；`--profile` 无替代 |
| `config.toml` 中的 `[shortcuts]`、`abx config set shortcuts.<name>` | 无（快捷方式固定） |
| `template.yaml` 中的 `custom_commands` | 在沙箱内服务端注册具名命令 |
| `abx deploy --traditional` | 无（流水线固定） |

[标准生命周期、终端、参数和退出码参考](cli-reference.md)。标准本地选项放在沙箱 ID 前。

## 原生 Provider 镜像工厂

`abx --provider PROVIDER template from-image IMAGE --name NAME -y` 是独立于标准模板构建器的原生扩展。见[提供方镜像部署](../guide/template-launch.md)。未启用的提供方返回 E8004。
