# 沙箱中的环境变量（CLI）

本指南说明如何通过 `abx` CLI 在沙箱内设置和读取环境变量，以及发送给沙箱的命令适用哪些执行规则。底层模型——每个沙箱内有两个相互独立的进程作用域——对 CLI 和 Python SDK 是一致的；包含 SDK 与沙箱内 Server 代码示例的完整说明见文末链接的 SDK 文档。

> **想了解 CLI 自身的配置变量**（`E2B_API_KEY`、`ALIBABA_CLOUD_REGION_ID`、`ABX_LLM_API_KEY` 等）？这些变量用于配置 `abx` 本身，而不是沙箱。每个键只有一个变量。见[配置参考](../reference/configuration.md)。

---

## 两个进程作用域

每个沙箱内部有两棵相互独立的进程树，各自拥有自己的环境：

| 作用域 | 进程所有者 | 环境变量如何传播 |
|--------|-----------|------------------|
| **envd 作用域** | `envd` 守护进程（PID 1） | 创建沙箱时设置的变量，会被通过 envd 启动的所有进程继承——`abx exec`、`abx run`、代码执行和终端会话 |
| **Server 作用域** | 沙箱内的 `SandboxServer` 进程（可选） | 通过 Server 的 `/env` 接口所做的修改，只影响 Server 自己派生的子进程 |

两个作用域互不泄漏：通过 Server 的 `/env` 接口写入的变量对 `abx exec` 不可见，反之亦然。按设计不存在统一的"设置环境变量"命令。

---

## 创建时设置变量（envd 作用域）

`abx create` 接受可重复的 `--env` / `-e KEY=VALUE`。这些变量会注入 envd 根进程，并在沙箱生命周期内被后续所有命令继承：

```bash
abx create base --env MY_KEY=value --env LOG_LEVEL=debug
```

创建之后没有任何 CLI 命令可以修改 envd 变量。如果某条命令需要不同的值，请显式包装：`abx exec <sandbox-id> "sh -c 'MY_KEY=other python app.py'"`。

> **密钥提示：** `--env` 的值会通过 HTTPS 发送到平台 API。避免把密钥写进 shell 历史；优先从你自己的环境读取（`--env "TOKEN=$TOKEN"`），且切勿提交到仓库。不要把它与 CLI 自身的凭据混淆，后者通过 `abx config set` 保存。

## 读取变量

```bash
# 读取单个变量，即进程所见的值（无需 shell）
abx exec <sandbox-id> "printenv MY_KEY"

# 沙箱内 Server 报告的环境，可按名称过滤
abx sandbox system env <sandbox-id> --filter PATH,HOME,LANG
```

`abx sandbox system env` 会自动排除名称中包含 `TOKEN`、`SECRET`、`KEY`、`PASSWORD` 或 `CREDENTIAL` 的变量。

---

## 直接执行（direct-exec）语义

通过 envd 发送的命令以直接 `exec` 方式执行，而不是经过 shell。未加引号的 shell 操作符（`|`、`;`、`&&`、`||`、`>`、`<`、`(...)`、`$(...)`）会被识别，并自动包装为 `sh -c`。其他情况需要显式写 `sh -c '...'`：

| 无需 `sh -c` | 需要 `sh -c '...'` |
|--------------|---------------------|
| 管道、重定向、`&&`、`\|\|`、`;`、子 shell、`$(...)` | 变量展开（`$VAR`、`${VAR}`）、反引号、通配符（`*`、`?`、`[...]`） |

```bash
abx exec <sandbox-id> "ls /tmp | grep log"             # 管道：自动包装
abx exec <sandbox-id> "sh -c 'echo \$HOME'"            # 变量展开：显式 sh -c
abx exec <sandbox-id> "sh -c 'ls *.py'"                # 通配符：显式 sh -c
abx exec <sandbox-id> "printenv HOME"                  # 读取单个变量的最简方式
```

由于 `$VAR` 不会被展开，`abx exec <id> "echo $VAR"` 输出的是字面文本，除非你**本地**的 shell 先展开了它——请给整条命令加引号，并使用 `printenv VAR` 或 `sh -c`。

---

## 速查表

| 做什么 | 如何做 | 作用域 | 生命周期 |
|--------|--------|--------|----------|
| 创建时设置 | `abx create --env KEY=VALUE` | envd | 沙箱生命周期 |
| 读取单个变量 | `abx exec <id> "printenv KEY"` | envd | — |
| 读取 Server 视角 | `abx sandbox system env <id>` | Server | — |

---

## 相关 SDK 文档

完整模型——逐次调用的 `env` 字典、`run_code(envs=)`、`@sandbox(envs=)` 装饰器、Server 的 `GET/POST /env` 接口（读取、设置、受保护与脱敏变量）以及推荐模式——见 `python-sdk` 仓库中 SDK 的[环境变量指南](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/environment-variables.md)。
