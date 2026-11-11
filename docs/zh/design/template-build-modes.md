# 模板构建模式

状态：当前源码的 Sandbox 模板准备行为。以下模式规则针对极速版适配器；其他 Provider 具有各自支持的准备能力。托管应用构建请参见[托管应用指南](../guide/managed-applications.md)。

## 命令与产物

```bash
abx template build ./project --out ./.abx/build.json --timeout 600 --yes
abx deploy --build ./.abx/build.json --name my-app --yes
# 也可以直接准备并部署：
abx deploy ./project --name my-app --build-timeout 600 --yes
```

`template build` 准备可复用产物，不创建实例。`deploy --build FILE` 消费该产物，`--build` 不是模式选择参数。直接 `deploy SOURCE` 则准备源码并创建具名部署。源码发布是独立的 `template publish SOURCE --tag VERSION` 操作。

## 选择准备路径

极速版通过 `template.yaml` 中的 `build.mode` 选择 `auto`、`dockerfile` 或 `steps`。未显式选择 Dockerfile 配方时，适配器使用该字段；省略时使用 `auto`。

| 清单模式 | 准备操作 |
|---|---|
| `dockerfile` | 本机构建 Dockerfile，将镜像推送到配置的仓库，再注册模板。 |
| `steps` | 注册 `base.image` 与展开后的平台步骤，不做本地 Docker 构建或 ACR 推送。 |
| `auto` | 优先使用已有 Dockerfile；没有时使用声明的平台步骤。 |

同时存在两种配方时，`auto` 选择 Dockerfile，并提示没有发送平台步骤。显式 `steps` 不使用 Dockerfile，也不使用环境中的 ACR namespace。通过 `abx config init --build` 或受支持配置输入准备构建凭据；公开的模板编写命令不再提供原适配器专用构建选项。

`template build` 或 `deploy` 的 `--build-profile NAME` 选择源码中声明的具名 Dockerfile 配方：

```yaml
build_profiles:
  portable:
    dockerfile: Dockerfile.portable
    context: .
```

Dockerfile 必须是项目根目录中的文件名，context 必须为 `.`。显式选择后使用该 Dockerfile；准备失败不会回退到其他配方。

## 平台步骤

Sandbox 模板使用 `spec_version: 5`。在服务、资源和启动声明之外，极速版平台步骤配方可包含：

```yaml
base:
  image: python:3.12-slim
build:
  mode: steps
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

适配器按以下顺序展开声明，最后追加原始 `build.steps`：

| 声明 | 平台步骤 |
|---|---|
| `apt_install` | 执行 apt update/install 并清理包列表的 `RUN` |
| `pip_install` | 使用 `pip install --no-cache-dir` 的 `RUN` |
| `npm_install` | 使用 `npm install -g` 的 `RUN` |
| `env` | 每个变量一条 `ENV`，键和值是独立参数 |
| `run` | 每条命令一条 `RUN` |
| `steps` | 显式 `{ type, args }` 条目；`args` 为字符串数组 |

平台步骤需要基础镜像和至少一个步骤。`base: IMAGE` 与 `base.image` 等价。Dockerfile 模式则使用 Dockerfile 的 `FROM`。缺少配方、模式非法或选定的 Dockerfile 不存在时，准备失败。

平台步骤不上传本地文件上下文，也不自动生成 `COPY`。构建需要本地应用文件时使用 Dockerfile 配方。依赖命令按提供的内容执行；构建前应审阅生成源码。

Express 原生 `ENV` 不保证变量进入后续 `RUN` 或运行进程。对于显式启动/就绪命令，适配器使用正确引用的 `/usr/bin/env` 包装传入最后声明的步骤环境，同名变量以后声明的值为准。运行时输入应放在模板的 `env` 声明或显式部署输入中。具名应用命令属于应用代码，不是构建步骤。

## 就绪、期限与清理

可复用构建和直接源码部署都会等待模板准备就绪。原生注册提交成功本身不代表就绪。可用 `abx --provider alicloud-express provider run template.get --input-file template-get.json` 检查原生状态，文件包含 `template_id` 及可选的 `team_id`。

Sandbox 准备使用 `template build --timeout SECONDS` 或 `deploy --build-timeout SECONDS` 设置预算：默认 600 秒，大于零且不超过 3600 秒。`deploy --sandbox-timeout` 单独设置实例存活时间，`--request-timeout` 配置请求期限。本地到期不证明远端工作已经停止，也不证明结果不确定的创建可以安全重试。

具名部署失败后先用 `status` 和 `recover` 查看，再用 `delete` 清理其拥有的资源。单独准备的构建保持独立：先删除消费者，再执行 `template build --clean BUILD_FILE --yes`，并检查提示中需要手工清理的镜像。详见[模板编写](../guide/authoring-templates.md)和[部署边界](../guide/template-launch.md)。

模型辅助编写使用 `template init --prompt` 或 `--adopt`，完成源码文件后即结束。SDK 创建沙箱不会执行这条构建流水线。
