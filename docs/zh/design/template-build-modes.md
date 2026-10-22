# 模板构建模式

状态：现行规范。规定一个模板目录如何注册成沙箱模板。

一次发布只走一条路。用户可以选择。默认根据目录内容决定。

## 模式

`abx template build`、`abx template deploy` 和 `abx deploy` 的 `--build` 取值是 `auto`（默认）、`dockerfile`、`steps`。`template.yaml` 的 `build.mode` 用同样的三个值。命令行覆盖文件。命令行是 `auto` 且文件写了模式时，用文件里的模式。

| 模式 | 实际执行 | `CreateTemplate` 请求 |
|---|---|---|
| `dockerfile` | 本地 `docker build`，推到 ACR，再注册 | `sandboxConfig.image` 是推上去的镜像。不带 `steps`。 |
| `steps` | 不跑本地 Docker，不推 ACR | `sandboxConfig.image` 是 `base.image`。`sandboxConfig.steps` 是展开后的步骤。 |
| `auto` | 有 `Dockerfile` 走 `dockerfile`。否则只要有构建声明就走 `steps`。 | 与所选模式相同。 |

`auto` 同时看到 `Dockerfile` 和构建声明时，走 Dockerfile，并说明平台步骤这次没有发送。

`steps` 不读取目录里的 `Dockerfile`。环境变量里的 `ACR_NAMESPACE` 被忽略。`--build steps` 再加 `--acr-namespace` 是用法错误，退出码 2。平台步骤只走官方 `CreateTemplate`。

## template.yaml

已经生效的字段保持不变（`name`、`capabilities`、`ports`、`resources`、`server`、`env`）。具名命令仍在 `commands.py`，不是构建步骤。

`base` 可以是映射，也可以是字符串。字符串就是镜像引用（`base: python:3.12-slim` 与 `base.image` 相同）。`generation`、`start_cmd`、`ready_cmd` 可选。`abx template deploy` 会把它们发给 `CreateTemplate`。命令行（`--generation`、`--start-cmd`、`--ready-cmd`）覆盖文件。当前提供者用平台命令启动服务，且目录里有 `commands.py` 时，缺省的 `generation` 为 `2`，缺省的 `start_cmd` / `ready_cmd` 取该提供者配置。其他模板默认 generation 1，不带启动命令。generation 1 拒绝 start command。同名模板若已是 generation 1，deploy 会停下来并打印 `abx template delete <id> -y`，然后再部署一次。`--force` 会删掉那个模板再创建。`-y` 不会删。

```yaml
name: python-data
base:
  image: python:3.12-slim
build:
  mode: auto
  apt_install: [build-essential]
  pip_install: ["pandas>=2.0"]
  npm_install: []
  env:
    PYTHONUNBUFFERED: "1"
  run:
    - python -c "import pandas"
  steps:
    - type: RUN
      args: ["echo done"]
```

声明按这个顺序展开，然后原样追加手写的 `build.steps`：

| 声明 | 平台步骤 |
|---|---|
| `apt_install` | `{ "type": "RUN", "args": ["apt-get update && apt-get install -y <包> && rm -rf /var/lib/apt/lists/*"] }` |
| `pip_install` | `{ "type": "RUN", "args": ["pip install --no-cache-dir <包>"] }` |
| `npm_install` | `{ "type": "RUN", "args": ["npm install -g <包>"] }` |
| `env` | 每个变量一条 `{ "type": "ENV", "args": ["KEY", "VAL"] }` |
| `run` | 每条命令一步 `{ "type": "RUN", "args": ["<命令>"] }` |
| `steps` | 按 `{ type, args }` 原样复制 |

官方类型里 `type` 的示例是 `RUN`，`args` 是字符串数组。Express 的 `ENV` 要求键和值分别作为两个参数；值中的空格或等号保留在同一个参数中。平台拒绝某个 `type` 时，CLI 退出码 1，并带上平台返回的信息。平台不会可靠地把原生 `ENV` 传递给后续构建 `RUN` 或运行进程。对于显式的第二代启动/就绪命令，CLI 使用正确引用的 `/usr/bin/env` shell 包装传入最后声明的 ENV 值。值按字面保留，同名变量以后声明的值为准。没有显式运行命令时（例如第一代沙箱），运行环境行为仍由平台决定。不生成 `COPY`：本地文件不在云上构建上下文里。要拷贝文件就用 `dockerfile` 模式。

`steps` 模式必须有 `base.image`，它成为 `sandboxConfig.image`。`dockerfile` 模式的基础镜像以 Dockerfile 的 `FROM` 为准，不发送 `base.image`。

## 错误

| 情况 | 退出码 |
|---|---|
| `auto`，没有 Dockerfile，也没有构建声明 | 2 |
| `dockerfile`，没有 Dockerfile | 2 |
| `steps`，缺少 `base.image` 或没有任何步骤 | 2 |
| `steps` 同时有 `--acr-namespace` | 2 |
| `build.mode` 不是 `auto`、`dockerfile`、`steps` | 2 |
| 平台拒绝某个步骤 | 1 |

## SDK

这套规则由 CLI 实现。Python 客户端不部署模板。`Sandbox.create` 不选择构建模式。
