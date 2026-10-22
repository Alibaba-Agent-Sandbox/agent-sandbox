# 部署与构建

本指南介绍 CLI 的构建与发布工作流：**模板生命周期**（`abx template scaffold` → `abx deploy` → `abx create`）。Python SDK 不构建也不部署任何东西，它只负责启动结果（见[相关 SDK 文档](#相关-sdk-文档)）。

---

## 模板生命周期

一个沙箱模板要经过三步，每一步只做一件事，**“模板是什么”写在 `template.yaml` 里**，而不是命令行参数里。

| 步骤 | 命令 | 输入 | 是否用 AI |
|------|------|------|-----------|
| 1. 编写 | `abx template scaffold` / `abx template scaffold --prompt "描述"` / `abx template scaffold --adopt [目录]` | 脚手架 case、一句描述，或一个已有项目 | 可选 |
| 2. 发布 | `abx deploy [PATH]` | 模板目录（`Dockerfile`、`template.yaml` 等） | 从不 |
| 3. 启动 | `abx create <TEMPLATE_ID>` | 模板 ID | 从不 |

`abx create --prompt "描述"` 是 1 + 2 + 3 合在一条命令里（推送任何东西之前都会先确认）。

```bash
# 1a. 已有项目：文件写回同一个目录
abx template scaffold --adopt ./app --hint "监听 8080"
abx deploy ./app --acr-namespace my-ns

# 1b. 用一句话新建项目：文件落在 ./<name>/
abx template scaffold --prompt "一个 Python 数据分析环境"
abx deploy ./<name> --acr-namespace my-ns

abx create <TEMPLATE_ID>               # 3. 启动沙箱
```

`--adopt` 会把项目源码的一份副本发给模型（密钥已排除），写回的只有模板文件。规则、预览和 `--dry-run` 见 [编写模板 — 适配已有项目](authoring-templates.md#适配已有项目)。

否则你要在部署时对 AI 说明的那些内容——服务是什么、端口、资源、能力、环境变量、自定义命令——都在第 1 步写进 `template.yaml`（以及 `Dockerfile` / `commands.py`），在那里可以审阅、纳入版本管理。描述只需要在编写时说一次。

### abx deploy — 发布步骤

`abx deploy` 是一次**固定、确定性的发布**，**不需要 LLM，也不需要 LLM Key**。`--build` 选择路径（默认 `auto`）：

| `--build` | 实际执行 |
|-----------|----------|
| `dockerfile` | `docker build`，推到 ACR，用推上去的镜像调用 `CreateTemplate`，等到就绪 |
| `steps` | 不跑本地 Docker，不推 ACR。`CreateTemplate` 收到 `base.image` 和 `sandboxConfig.steps` |
| `auto` | 有 Dockerfile 走 `dockerfile`。否则有 `build:` 就走 `steps` |

`steps` 读取 `template.yaml` 的 `build.apt_install`、`pip_install`、`npm_install`、`env`、`run` 和原始 `build.steps`。需要 `base.image`，并且只能走官方 API。`--build steps` 再加 `--acr-namespace` 是用法错误。只出现在环境变量里的 `ACR_NAMESPACE` 会被忽略。规范见 [模板构建模式](../design/template-build-modes.md)。

它与 `abx template deploy DIR` 是同一条流水线，只是 `PATH` 默认为 `.`，并接受后者的全部选项（`--acr-namespace`、`--alias`、`--yes`、`-v/--verbose`、`--region` 等）。它从 `template.yaml` 读取模板 `name`（未指定 `--acr-repo` 时用作 ACR 仓库名）、`resources.cpu`、`resources.memory`、`generation`、`start_cmd` 和 `ready_cmd`。`base` 可以是 `base.image`，也可以是镜像字符串。命令行选项优先于文件。在阿里云 Express 上，目录里有 `commands.py` 且没有 `generation` 时，按 generation 2 发布，并带上提供者的 start / ready 命令，因此 `abx template deploy . -y` 不需要额外参数就能启动 `agent-sandbox-server`。`abx template scaffold` 用这一行安装服务：`RUN pip install --no-cache-dir "agent-sandbox-server @ https://github.com/Alibaba-Agent-Sandbox/python-sdk/archive/61c43e0be65a1f57aa09186d578e7b399e48429b.tar.gz#subdirectory=server-sdk"`。`agent-sandbox-server` 不在 PyPI 上（PyPI 上的 `agent-sandbox` 是另一个项目）。Dockerfile 里已经钉了任意 `python-sdk/archive/<40位十六进制>.tar.gz#subdirectory=server-sdk` 时，按原文安装，部署不会请求 PyPI；`ABX_SERVER_SDK_SOURCE` 仍会替换这一行，不论 SHA。`ABX_SERVER_SDK_SOURCE` 仍会从本地 `server-sdk` 打 wheel，并在构建时替换这一行。没有 wheel 时，构建前会去掉遗留的 `COPY *.whl`，因此没有 buildx 的旧构建器也能构建。只有 `docker buildx version` 成功时才会加上 `--provenance=false`，并打印“已自动添加”的提示。`--force` 会替换同名的 generation 1 模板；不加它时，错误信息会打印 `abx template delete <id> -y`。

交互式终端上，构建、推送和等待 READY 各自显示 `message... 12s` 标题，标题下方以灰色滚动最近六行日志，长时间的 `docker build` 不会只剩一个停住的转圈。某一步暂时没有输出时，耗时仍每秒刷新。`--verbose` 改为逐行打印完整日志。`--json`、`--quiet`、CI 和非 TTY 仍只留一行 progress。创建沙箱、上传、下载、拉取模板、用镜像注册模板、安装 coding-agent，以及 `abx kill --all`，在终端上使用同一套会走动的标题。Agent 工作时，灰色行会带上一小段已脱敏的工具详情（命令、url、查询或路径）；其余时候是路径、阶段和构建输出。文件内容、思考内容和凭证保持隐藏。这些命令在非终端上不为标题打印任何内容。

```bash
abx deploy --acr-namespace my-ns          # 用 ./Dockerfile 发布 ./
abx deploy ./my-template --build steps --yes
abx deploy ./my-template --yes -v         # 非交互，输出调试日志
```

目录里既没有 `Dockerfile` 也没有 `build:` 步骤时，命令会停下，并提示使用 `abx template scaffold --adopt`（已有项目）、`abx template scaffold --prompt "描述"`，或 `abx template scaffold -t`。


---

## 下一步

- [编写模板](authoring-templates.md) — 通过 template.yaml 定义模板

---

## 相关 SDK 文档

- [SDK 使用指南](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/sdk-usage.md) 与 [API 参考](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/reference/api-reference.md)

## 显式原生极速版入口

CLI0.4.1 增加首个全局选项 `--native`，选择项目原生命令界面。官方极速版模板清单、状态回读、清理和规范平台 step 验收使用此入口：

```bash
abx --native --json template list
abx --native template deploy ./my-template --build steps --yes
# 模板目录的验收脚本使用：
export ABX='abx --native'
```

所选 Provider 和命令参数仍执行原有原生能力/配置检查。默认入口遵循固定的标准命名空间。远程命令参数中的 `--native` 按字面保留。
