# 部署与构建

本指南介绍 CLI 的构建与发布工作流：**模板生命周期**（`ebx template init` → `ebx deploy` → `ebx create`）。仅 SDK 提供的代码构建方式（`Sandbox.deploy`、`Image` 链式构建）记录在 SDK 仓库中——见[相关 SDK 文档](#相关-sdk-文档)。

---

## 模板生命周期

一个沙箱模板要经过三步，每一步只做一件事，**“模板是什么”写在 `template.yaml` 里**，而不是命令行参数里。

| 步骤 | 命令 | 输入 | 是否用 AI |
|------|------|------|-----------|
| 1. 编写 | `ebx template init` / `ebx template init "描述"` / `ebx template init --adopt [目录]` | 脚手架 case、一句描述，或一个已有项目 | 可选 |
| 2. 发布 | `ebx deploy [PATH]` | 模板目录（`Dockerfile`、`template.yaml` 等） | 从不 |
| 3. 启动 | `ebx create --template <TEMPLATE_ID>` | 模板 ID | 从不 |

`ebx create "描述"` 是 1 + 2 + 3 合在一条命令里（推送任何东西之前都会先确认）。

```bash
# 1a. 已有项目：文件写回同一个目录
ebx template init --adopt ./app --hint "监听 8080"
ebx deploy ./app --acr-namespace my-ns

# 1b. 用一句话新建项目：文件落在 ./<name>/
ebx template init "一个 Python 数据分析环境"
ebx deploy ./<name> --acr-namespace my-ns

ebx create --template <TEMPLATE_ID>               # 3. 启动沙箱
```

`--adopt` 会把项目源码的一份副本发给模型（密钥已排除），写回的只有模板文件。规则、预览和 `--dry-run` 见 [编写模板 — 适配已有项目](authoring-templates.md#适配已有项目)。

否则你要在部署时对 AI 说明的那些内容——服务是什么、端口、资源、能力、环境变量、自定义命令——都在第 1 步写进 `template.yaml`（以及 `Dockerfile` / `commands.py`），在那里可以审阅、纳入版本管理。描述只需要在编写时说一次。

### ebx deploy — 发布步骤

`ebx deploy` 是一条**固定、确定性的流水线**，**不需要 LLM，也不需要 LLM Key**：

1. `docker build` 项目的 `Dockerfile`
2. 把镜像推送到阿里云 ACR
3. 注册为模板（`CreateTemplate`）
4. 等待模板就绪

它与 `ebx template deploy DIR` 是同一条流水线，只是 `PATH` 默认为 `.`，并接受后者的全部选项（`--acr-namespace`、`--alias`、`--yes`、`-v/--verbose`、`--region` 等）。它从 `template.yaml` 读取模板 `name`（未指定 `--acr-repo` 时用作 ACR 仓库名）、`resources.cpu`、`resources.memory` 和 `generation`；命令行选项优先。

交互式终端上，构建、推送和等待 READY 各自显示 `message... 12s` 标题，标题下方以灰色滚动最近六行日志，长时间的 `docker build` 不会只剩一个停住的转圈。某一步暂时没有输出时，耗时仍每秒刷新。`--verbose` 改为逐行打印完整日志。`--json`、`--quiet`、CI 和非 TTY 仍只留一行 progress。创建沙箱、上传、下载、拉取模板、用镜像注册模板、安装 coding-agent，以及 `ebx kill --all`，在终端上使用同一套会走动的标题。Agent 工作时，灰色行会带上一小段已脱敏的工具详情（命令、url、查询或路径）；其余时候是路径、阶段和构建输出。文件内容、思考内容和凭证保持隐藏。这些命令在非终端上不为标题打印任何内容。

```bash
ebx deploy --acr-namespace my-ns          # 发布 ./（需要 ./Dockerfile）
ebx deploy ./my-template --yes -v         # 非交互，输出调试日志
```

目录里没有 `Dockerfile` 时命令会停下，并提示使用 `ebx template init --adopt`（已有项目）、`ebx template init "描述"`，或 `ebx template init -t`。

> **迁移说明。** 旧版本的 `ebx deploy ./p "说明"` 会在云端沙箱里启动 Agent，并要求 `BAILIAN_CODING_PLAN_API_KEY` / `DASHSCOPE_API_KEY` / `OPENAI_API_KEY`。`ebx deploy` 不再接受说明文字：请用 `ebx template init --adopt` 或 `ebx template init "描述"` 编写模板，再用 `ebx deploy` 发布。沙箱内 Agent 流程仍以 SDK 接口 `Sandbox.deploy()` 保留（见下）。`--traditional` 已弃用并被忽略。

---

## 下一步

- [编写模板](authoring-templates.md) — 通过 template.yaml 定义模板

---

## 相关 SDK 文档

- [构建与部署（SDK）](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/zh/guide/build-and-deploy.md) — `Sandbox.deploy()`（沙箱内 Agent，需要 LLM key）、`Image` 链式构建、Docker 构建流程与构建相关错误
- [SDK 使用指南](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/zh/guide/sdk-usage.md) 与 [API 参考](https://github.com/Easy-Sandbox/python-sdk/blob/main/docs/zh/reference/api-reference.md)
