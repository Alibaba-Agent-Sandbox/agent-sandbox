# 沙箱中的环境变量（CLI）

[English](../../en/guide/environment-variables.md)

CLI 自身配置与沙箱进程环境是不同输入。项目配置使用 `ABX_SANDBOX_API_KEY`、`ABX_SANDBOX_BASE_URL`、`ABX_SANDBOX_DOMAIN`；固定的标准极速版入口还接受其文档中的 E2B 配置。参见[配置参考](../reference/configuration.md)和[标准迁移指南](migrate-from-e2b.md)。本页针对当前公开 CLI 0.5.7；提供方扩展以所选提供方实际支持的操作为准。

## 在启动前配置应用

应用模板由一个入口负责启动。在 `abx template launch` 前，配置目标模板已声明的环境变量。安全设置 `ABX_SERVER_TOKEN`，并按目标模板 README 设置所需模型配置，然后启动：

```bash
abx --provider alicloud-express template launch Alibaba-Agent-Sandbox/awesome-templates//python-hello --yes
abx --provider alicloud-express run <sandbox-id> hello --arg name=Ada
```

将 `<sandbox-id>` 替换为返回的 ID。`abx run` 通过 HTTP 调用命名命令应用，不是 envd shell 命令。应用读取启动环境，调用方的 `ABX_SERVER_TOKEN` 用于请求认证。再启动一个客户端不会重新配置已有应用。配置和自有沙箱、模板、镜像清理参见[模板启动指南](template-workflows.md)。

创建输入、单次进程环境和已运行应用的环境各有作用范围。应用本身也可能通过 envd 启动；不能断言每个沙箱都有两棵独立进程树，或 envd 一定是 PID 1。进程后续修改环境不会改写已有父进程或兄弟进程。一个变量继承成功不代表所有变量都如此：提供方／运行时可能仍采用平台的 `PATH`。

## 标准极速版入口的终端变量

`abx create` 和 `abx connect` 接受可重复的 `--env` / `-e KEY=VALUE`，用于终端会话：

```bash
abx --provider alicloud-express create base --env APP_ENV=staging
abx --provider alicloud-express connect --env APP_ENV=staging <sandbox-id>
```

第一条命令创建实例并打开终端；`--env` 传给终端，不传入实例生命周期的创建请求。`create --detach` 不打开终端，也不会把 `--env` 变成实例全局注入。Python 创建时的 `ProviderSandbox.create(envs=...)` 见 [SDK 环境指南](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/zh/guide/environment-variables.md)；不要把终端选项的语义套到其他提供方的创建接口上。

使用结束后仅删除自己拥有的实例，例如 `abx --provider alicloud-express kill <sandbox-id>`。连接他人的沙箱不会转移资源归属。

## 覆盖或读取单次进程环境

标准极速版 exec 选项放在沙箱 ID 前。单次覆盖只影响该进程和子进程，不影响已运行应用或之后的兄弟命令：

```bash
abx --provider alicloud-express exec --env MY_KEY=one <sandbox-id> printenv MY_KEY
abx --provider alicloud-express exec <sandbox-id> printenv HOME
abx --provider alicloud-express sandbox system env <sandbox-id> --filter PATH,HOME,LANG
```

`abx sandbox system env` 在沙箱中新执行 `env`，然后过滤输出。它**不会**调用应用的 `GET /env`，也不代表任意已有服务进程的环境。该命令排除名称含 `TOKEN`、`SECRET`、`KEY`、`PASSWORD` 或 `CREDENTIAL` 的变量。不要用未过滤的进程命令打印密钥。

其他提供方使用其声明的进程操作及支持的参数，具体以对应帮助为准。进程需要特定 `PATH` 时，可以显式传入单次进程的 `env`，而不是假设创建时一定能覆盖平台值。

## Shell 行为取决于入口

标准极速版 exec 入口把渲染后的远程命令交给 `/bin/bash -l -c`。单个带引号的命令字符串作为 shell 输入；多个参数在组装字符串时逐个引用。登录 shell 的初始化也可能影响最终环境。项目原生进程路径对简单命令直接执行，并把检测到的未引用 shell 操作符包装成 `sh -c`；不能把其简单 `$VAR` 和通配符规则当成所有 `abx exec` 入口的行为。

读取单个变量优先用 `printenv`。需要 shell 语法时明确写出，并避免本地先展开远程表达式：

```bash
abx --provider alicloud-express exec <sandbox-id> sh -c 'printf "%s\n" "$HOME"'
abx --provider alicloud-express exec <sandbox-id> sh -c 'ls /tmp | head -n 5'
```

外层单引号把 `$HOME` 留给远程 shell 处理。Shell 执行和进程能力仍由所选提供方决定；这些写法或能力声明不代表尚未实测的后端已经通过验证。

## 读取或修改已运行应用的环境

应用必须开放环境端点，并允许当前身份访问。用已发布 Python SDK 连接运行中的沙箱，通过 `await sandbox.application_client(9000, token=...)` 绑定应用，再使用已有的 `application.system.env(...)` / `application.system.set_env(...)` 方法。[SDK 环境指南](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/zh/guide/environment-variables.md#server-作用域--getpost-env)提供带认证的示例及策略前提。

应用凭据与提供方网关凭据各自独立，只有网关头不等于已提供应用令牌。`POST /env` 影响该应用及之后的子进程，不改变父进程或兄弟进程，也不会自动重新初始化启动时已缓存的配置。应用保护系统变量和 `ABX_*` 设置。模型凭据和其他只在启动时读取的值应在启动前配置。

## 速查表

| 任务 | 入口 | 范围 |
|---|---|---|
| 配置模板应用 | 在 `template launch` 前配置已声明名称 | 该应用的启动过程 |
| 配置标准极速版终端 | `create --env` 或 `connect --env` | 终端会话 |
| 覆盖单次进程 | 标准入口在沙箱 ID 前传 `exec --env` | 该进程及其子进程 |
| 读取进程环境 | `exec ... printenv` 或 `sandbox system env` | 新执行的进程 |
| 读取或修改应用变量 | 带认证的 SDK 应用绑定 | 已运行应用及之后的子进程 |
